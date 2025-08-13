// Package Delivery Tracker (Mock)
// - Mock tracking data (3 demo numbers)
// - Map via Leaflet (OpenStreetMap tiles)
// - Timeline, ETA countdown, dark mode, notifications, toast
// - Shareable: ?tn=TRACKING_NUMBER
// - Auto-polls every 10s and advances status based on elapsed time

const $ = id => document.getElementById(id);

// DOM
const trackingInput = $('trackingInput');
const trackBtn = $('trackBtn');
const themeToggle = $('themeToggle');
const notifyBtn = $('notifyBtn');

const statusText = $('statusText');
const lastUpdateEl = $('lastUpdate');
const carrierEl = $('carrier');
const trackingNumEl = $('trackingNum');

const etaCountdown = $('etaCountdown');
const etaExact = $('etaExact');

const timelineEl = $('timeline');
const toastContainer = $('toastContainer');

// Map
let map, pathLine, marker;

// Local storage keys
const LS_THEME = 'pkg_theme';
const LS_START_PREFIX = 'pkg_startTime:'; // track start time per TN
const LS_LAST_STATUS_PREFIX = 'pkg_lastStatus:';

// === Dark Mode ===
if (localStorage.getItem(LS_THEME) === 'dark') document.body.classList.add('dark');
themeToggle.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem(LS_THEME, document.body.classList.contains('dark') ? 'dark' : 'light');
};

// === Notifications ===
notifyBtn.onclick = async () => {
  if (!('Notification' in window)) { showToast('Notifications not supported'); return; }
  const p = await Notification.requestPermission();
  showToast(p === 'granted' ? 'Notifications enabled' : 'Notifications blocked');
};

function showToast(msg, timeout = 4000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 350); }, timeout);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.value = 0.2;
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 180);
  } catch(_) {}
}

async function notify(title, body) {
  showToast(`${title} — ${body}`);
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

// === Mock Data ===
// Each event has: title, tsOffsetMin (minutes from start), lat, lng, location, statusKey
// Delivered event also carries eta flag (we use final timestamp as ETA)
const MOCK_DB = {
  "TM123456789": {
    carrier: "MockExpress",
    route: [
      { title: "Label created",        tsOffsetMin: 0,   lat: 34.0522, lng: -118.2437, location:"Los Angeles, CA", statusKey:"created" },
      { title: "Picked up",            tsOffsetMin: 60,  lat: 34.10,   lng: -118.30,   location:"Los Angeles, CA", statusKey:"picked" },
      { title: "In transit",           tsOffsetMin: 240, lat: 36.1699, lng: -115.1398, location:"Las Vegas, NV",   statusKey:"in_transit" },
      { title: "Arrived at facility",  tsOffsetMin: 360, lat: 39.7392, lng: -104.9903, location:"Denver, CO",      statusKey:"facility" },
      { title: "Out for delivery",     tsOffsetMin: 1320,lat: 39.742,  lng: -104.99,   location:"Denver, CO",      statusKey:"out_for_delivery" },
      { title: "Delivered",            tsOffsetMin: 1440,lat: 39.742,  lng: -104.99,   location:"Denver, CO",      statusKey:"delivered" }
    ]
  },
  "TM987654321": {
    carrier: "RapidShip",
    route: [
      { title:"Label created", tsOffsetMin:0, lat:40.7128,lng:-74.0060, location:"New York, NY", statusKey:"created" },
      { title:"In transit", tsOffsetMin:180, lat:41.2033,lng:-77.1945, location:"Pennsylvania, USA", statusKey:"in_transit" },
      { title:"Arrived at facility", tsOffsetMin:360, lat:39.9526,lng:-75.1652, location:"Philadelphia, PA", statusKey:"facility" },
      { title:"Out for delivery", tsOffsetMin:1260, lat:39.9526,lng:-75.1652, location:"Philadelphia, PA", statusKey:"out_for_delivery" },
      { title:"Delivered", tsOffsetMin:1380, lat:39.9526,lng:-75.1652, location:"Philadelphia, PA", statusKey:"delivered" }
    ]
  },
  "TM555000111": {
    carrier: "ParcelGo",
    route: [
      { title:"Label created", tsOffsetMin:0, lat:47.6062,lng:-122.3321, location:"Seattle, WA", statusKey:"created" },
      { title:"Picked up", tsOffsetMin:90, lat:47.7,lng:-122.33, location:"Seattle, WA", statusKey:"picked" },
      { title:"In transit", tsOffsetMin:360, lat:45.5152,lng:-122.6784, location:"Portland, OR", statusKey:"in_transit" },
      { title:"Arrived at facility", tsOffsetMin:720, lat:44.0521,lng:-123.0868, location:"Eugene, OR", statusKey:"facility" },
      { title:"Out for delivery", tsOffsetMin:1320, lat:37.7749,lng:-122.4194, location:"San Francisco, CA", statusKey:"out_for_delivery" },
      { title:"Delivered", tsOffsetMin:1440, lat:37.7749,lng:-122.4194, location:"San Francisco, CA", statusKey:"delivered" }
    ]
  }
};

// Get or start a "start time" per tracking number, so timeline progresses over real time
function getStartTime(tracking) {
  const key = LS_START_PREFIX + tracking;
  let v = localStorage.getItem(key);
  if (v) return parseInt(v, 10);
  const now = Date.now() - (Math.floor(Math.random()*240) * 60 * 1000); // backdate a bit
  localStorage.setItem(key, String(now));
  return now;
}

function getMockTracking(tracking) {
  const pkg = MOCK_DB[tracking];
  if (!pkg) return null;
  const startTime = getStartTime(tracking);
  // compute current index based on elapsed minutes
  const elapsedMin = Math.max(0, Math.floor((Date.now() - startTime) / 60000));
  const route = pkg.route;
  let idx = 0;
  for (let i=0; i<route.length; i++) {
    if (elapsedMin >= route[i].tsOffsetMin) idx = i;
  }
  // ETA is the last event's absolute time
  const etaMs = startTime + route[route.length - 1].tsOffsetMin * 60000;
  return {
    carrier: pkg.carrier,
    route,
    currentIndex: idx,
    nowEvent: route[idx],
    eta: etaMs
  };
}

// === Map Setup ===
function ensureMap() {
  if (!map) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }
}

function updateMap(route, currentIdx) {
  ensureMap();
  const latlngs = route.map(r => [r.lat, r.lng]);
  if (pathLine) pathLine.remove();
  pathLine = L.polyline(latlngs, { weight: 4 }).addTo(map);

  const pos = latlngs[currentIdx];
  if (!marker) marker = L.marker(pos).addTo(map);
  else marker.setLatLng(pos);

  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [20,20] });
}

// === Timeline ===
function renderTimeline(route, currentIdx) {
  timelineEl.innerHTML = '';
  route.forEach((ev, i) => {
    const li = document.createElement('li');
    const dt = new Date(Date.now() + (ev.tsOffsetMin - route[currentIdx].tsOffsetMin) * 60000); // relative-ish
    const ts = new Date(getStartTime(currentTracking) + ev.tsOffsetMin * 60000).toLocaleString();
    li.innerHTML = `
      <div class="line"></div>
      <div class="title">
        ${ev.title}
        ${ev.statusKey === 'delivered' ? '<span class="status-pill status-delivered" style="margin-left:8px;">Delivered</span>' :
          ev.statusKey === 'out_for_delivery' ? '<span class="status-pill status-out" style="margin-left:8px;">Out for delivery</span>' :
          ev.statusKey === 'in_transit' ? '<span class="status-pill status-in-transit" style="margin-left:8px;">In transit</span>' :
          '<span class="status-pill status-info" style="margin-left:8px;">Info</span>'}
      </div>
      <div class="time">${ts}</div>
      <div class="loc">${ev.location} · (${ev.lat.toFixed(3)}, ${ev.lng.toFixed(3)})</div>
    `;
    if (i === currentIdx) li.style.borderLeftColor = 'var(--good)';
    timelineEl.appendChild(li);
  });
}

// === Status & ETA ===
function formatCountdown(ms) {
  if (ms <= 0) return 'Arrived';
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400);
  const h = Math.floor((s%86400)/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

let currentTracking = null;
let pollTimer = null;

function updateUI(tracking) {
  const data = getMockTracking(tracking);
  if (!data) {
    showToast('Tracking number not found');
    return;
  }
  currentTracking = tracking;

  const nowEv = data.nowEvent;
  const nowLabel = nowEv.title;
  const lastKey = LS_LAST_STATUS_PREFIX + tracking;
  const prevStatus = localStorage.getItem(lastKey);

  statusText.textContent = nowLabel;
  lastUpdateEl.textContent = 'Last update: ' + new Date().toLocaleString();
  carrierEl.textContent = 'Carrier: ' + data.carrier;
  trackingNumEl.textContent = 'Tracking: ' + tracking;

  // alerts on status change
  if (prevStatus && prevStatus !== nowEv.statusKey) {
    notify('Status changed', `${tracking}: ${nowLabel}`);
  }
  localStorage.setItem(lastKey, nowEv.statusKey);

  // ETA
  const msLeft = data.eta - Date.now();
  etaCountdown.textContent = formatCountdown(msLeft);
  etaExact.textContent = 'Estimated delivery: ' + new Date(data.eta).toLocaleString();

  // Map & timeline
  updateMap(data.route, data.currentIndex);
  renderTimeline(data.route, data.currentIndex);
}

function startPolling(tracking) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => updateUI(tracking), 10000); // 10s
}

function setURLParam(tracking) {
  const url = new URL(window.location.href);
  url.searchParams.set('tn', tracking);
  history.replaceState(null, '', url.toString());
}

function loadFromParam() {
  const url = new URL(window.location.href);
  const tn = url.searchParams.get('tn');
  return tn;
}

// Wire UI
trackBtn.onclick = () => {
  const tn = trackingInput.value.trim().toUpperCase();
  if (!tn) { showToast('Enter a tracking number'); return; }
  if (!MOCK_DB[tn]) { showToast('Not found in demo. Use one of the sample numbers.'); return; }
  setURLParam(tn);
  updateUI(tn);
  startPolling(tn);
};
document.querySelectorAll('.chip').forEach(btn => {
  btn.onclick = () => {
    trackingInput.value = btn.dataset.tn;
    trackBtn.click();
  };
});

// Init map and app
window.addEventListener('load', () => {
  ensureMap();

  // Auto-load from ?tn= or default demo
  const tnParam = loadFromParam();
  const defaultTN = tnParam && MOCK_DB[tnParam] ? tnParam : 'TM123456789';
  trackingInput.value = defaultTN;
  updateUI(defaultTN);
  startPolling(defaultTN);
});

const byId = id => document.getElementById(id);
const signInPanel = byId('signInPanel');
const approvalPanel = byId('approvalPanel');
const incidentSection = byId('incidentSection');
let refreshHandle = null;

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function showSignIn(message = '') {
  signInPanel.classList.remove('hidden');
  approvalPanel.classList.add('hidden');
  incidentSection.classList.add('hidden');
  byId('sessionLabel').textContent = 'Sign in required';
  byId('refreshLabel').textContent = 'Waiting for sign in';
  byId('controlLoginError').textContent = message;
  byId('controlSignOut').classList.add('hidden');
  if (refreshHandle) clearInterval(refreshHandle);
}

function showNotApproved(username) {
  signInPanel.classList.add('hidden');
  incidentSection.classList.add('hidden');
  approvalPanel.classList.remove('hidden');
  byId('approvalMessage').textContent = `The account “${username}” is signed in, but an administrator has not approved it for Control Room access.`;
  byId('sessionLabel').textContent = username;
  byId('controlSignOut').classList.remove('hidden');
  byId('refreshLabel').textContent = 'Access not approved';
  if (refreshHandle) clearInterval(refreshHandle);
}

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : '—';
}

function makeIncidentCard(item) {
  const card = document.createElement('article');
  card.className = 'control-incident-card';
  const top = document.createElement('div');
  top.className = 'incident-card-top';
  const title = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'eyebrow';
  label.textContent = 'CRASH ALERT';
  const heading = document.createElement('h3');
  heading.textContent = item.deviceName || 'Registered vehicle';
  title.append(label, heading);
  const badge = document.createElement('span');
  badge.className = 'incident-active-badge';
  badge.textContent = 'Emergency alert';
  top.append(title, badge);
  card.append(top);

  const details = document.createElement('div');
  details.className = 'control-alert-details';
  const detailRows = [
    ['Incident ID', item.alert?.incidentId || '—'],
    ['Peak impact', item.alert?.peakG == null ? '—' : `${item.alert.peakG} g`],
    ['Peak rotation', item.alert?.peakGyro == null ? '—' : `${item.alert.peakGyro} °/s`],
    ['Last device report', item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—']
  ];
  detailRows.forEach(([name, value]) => {
    const row = document.createElement('div');
    const key = document.createElement('span'); key.textContent = name;
    const val = document.createElement('strong'); val.textContent = String(value);
    row.append(key, val); details.append(row);
  });
  if (item.alert?.reason) {
    const reason = document.createElement('p');
    reason.className = 'control-reason';
    reason.textContent = item.alert.reason;
    details.append(reason);
  }
  card.append(details);

  const location = document.createElement('div');
  location.className = 'control-location';
  const locationHead = document.createElement('div');
  locationHead.className = 'location-heading';
  const locationTitle = document.createElement('h4'); locationTitle.textContent = 'Reported location';
  const fixLabel = document.createElement('span');
  fixLabel.className = `location-fix ${item.location?.hasFix ? 'has-fix' : ''}`;
  fixLabel.textContent = item.location?.hasFix ? 'GPS fix' : 'Last reported';
  locationHead.append(locationTitle, fixLabel);
  location.append(locationHead);
  if (item.location?.available) {
    const coords = document.createElement('p');
    coords.className = 'control-coordinates';
    coords.textContent = `${formatCoordinate(item.location.latitude)}, ${formatCoordinate(item.location.longitude)}`;
    location.append(coords);
    const map = document.createElement('a');
    map.className = 'control-map-link';
    map.href = `https://www.google.com/maps?q=${encodeURIComponent(item.location.latitude)},${encodeURIComponent(item.location.longitude)}`;
    map.target = '_blank'; map.rel = 'noopener noreferrer'; map.textContent = 'Open location in Maps ↗';
    location.append(map);
  } else {
    const empty = document.createElement('p');
    empty.className = 'control-no-location';
    empty.textContent = 'No GPS coordinates were reported with this alert.';
    location.append(empty);
  }
  card.append(location);
  return card;
}

async function refreshIncidents() {
  byId('refreshLabel').textContent = 'Updating…';
  try {
    const { incidents = [] } = await api('/api/control-room/incidents');
    byId('activeCount').textContent = `${incidents.length} active ${incidents.length === 1 ? 'alert' : 'alerts'}`;
    const list = byId('incidentList');
    if (!incidents.length) {
      const empty = document.createElement('div');
      empty.className = 'control-empty';
      const title = document.createElement('strong'); title.textContent = 'No active crash alerts';
      const text = document.createElement('p'); text.textContent = 'The Control Room will show a vehicle here when its device reports an emergency alert.';
      empty.append(title, text); list.replaceChildren(empty);
    } else {
      list.replaceChildren(...incidents.map(makeIncidentCard));
    }
    byId('refreshLabel').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (error.status === 401) return showSignIn('Your session expired. Please sign in again.');
    byId('refreshLabel').textContent = error.message;
    if (error.status === 403) showNotApproved(byId('sessionLabel').textContent);
  }
}

async function initialize() {
  try {
    const status = await api('/api/auth/status');
    if (!status.authenticated) return showSignIn();
    if (!status.controlRoom) return showNotApproved(status.username || 'this account');
    signInPanel.classList.add('hidden');
    approvalPanel.classList.add('hidden');
    incidentSection.classList.remove('hidden');
    byId('sessionLabel').textContent = status.username;
    byId('controlSignOut').classList.remove('hidden');
    await refreshIncidents();
    refreshHandle = setInterval(refreshIncidents, 5000);
  } catch (error) {
    showSignIn(error.message);
  }
}

byId('controlLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('controlLoginButton'); button.disabled = true;
  byId('controlLoginError').textContent = '';
  try {
    await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: byId('controlUsername').value, password: byId('controlPassword').value }) });
    byId('controlPassword').value = '';
    await initialize();
  } catch (error) {
    byId('controlLoginError').textContent = error.message;
  } finally { button.disabled = false; }
});

byId('controlSignOut').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  showSignIn();
});

initialize();

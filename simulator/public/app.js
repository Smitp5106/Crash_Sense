/**
 * CrashSense Interactive Simulator Dashboard Client
 *
 * Connects via Server-Sent Events (SSE) to receive real-time 20Hz telematics.
 * Handles:
 * - Dynamic UI rendering of 6-DOF IMU gauges, GPS, and SIM7600 modem states.
 * - Web Audio API synthesized active piezo buzzer beeps during countdown.
 * - User interactions (cancellation button, scenario triggers, fault injections, AT console).
 */

// Audio Buzzer Synthesizer using Web Audio API
class AudioBuzzer {
  constructor() {
    this.audioCtx = null;
    this.oscillator = null;
    this.gainNode = null;
    this.intervalId = null;
    this.isEnabled = true;
    this.isPlaying = false;
  }

  _initContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
    }
  }

  startBeeping() {
    if (!this.isEnabled || this.isPlaying) return;
    this._initContext();
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.isPlaying = true;
    let beeping = false;

    // Beep pattern: 2600Hz piezo pulse, 150ms ON, 150ms OFF
    this.intervalId = setInterval(() => {
      if (!this.isPlaying || !this.isEnabled) return;
      try {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'square'; // Piezo active buzzer harmonic signature
        osc.frequency.setValueAtTime(2600, this.audioCtx.currentTime);

        gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.12);
      } catch (e) {
        // Audio error suppression
      }
    }, 250);
  }

  stopBeeping() {
    this.isPlaying = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  toggle() {
    this.isEnabled = !this.isEnabled;
    if (!this.isEnabled) this.stopBeeping();
    return this.isEnabled;
  }
}

const buzzer = new AudioBuzzer();

// DOM References
const emergencyBanner = document.getElementById('emergencyBanner');
const countdownTimerVal = document.getElementById('countdownTimerVal');
const cancelAlarmBtn = document.getElementById('cancelAlarmBtn');
const masterStateBadge = document.getElementById('masterStateBadge');
const connectionStatusBadge = document.getElementById('connectionStatusBadge');
const audioToggleBtn = document.getElementById('audioToggleBtn');

const accelMagVal = document.getElementById('accelMagVal');
const accelMagBar = document.getElementById('accelMagBar');
const jerkVal = document.getElementById('jerkVal');
const valAx = document.getElementById('valAx');
const valAy = document.getElementById('valAy');
const valAz = document.getElementById('valAz');
const barAx = document.getElementById('barAx');
const barAy = document.getElementById('barAy');
const barAz = document.getElementById('barAz');

const gyroMagVal = document.getElementById('gyroMagVal');
const gyroMagBar = document.getElementById('gyroMagBar');
const valRoll = document.getElementById('valRoll');
const valPitch = document.getElementById('valPitch');

const classificationVal = document.getElementById('classificationVal');
const classificationReason = document.getElementById('classificationReason');
const sensorHealthBadge = document.getElementById('sensorHealthBadge');

const gpsFixBadge = document.getElementById('gpsFixBadge');
const gpsCoords = document.getElementById('gpsCoords');
const gpsFixAge = document.getElementById('gpsFixAge');
const gpsSats = document.getElementById('gpsSats');
const gpsHdop = document.getElementById('gpsHdop');
const gpsMapLink = document.getElementById('gpsMapLink');
const gpsStaleWarning = document.getElementById('gpsStaleWarning');

const modemRegBadge = document.getElementById('modemRegBadge');
const modemPowerVal = document.getElementById('modemPowerVal');
const modemSimVal = document.getElementById('modemSimVal');
const modemCsqVal = document.getElementById('modemCsqVal');
const modemCarrierVal = document.getElementById('modemCarrierVal');
const modemSentCount = document.getElementById('modemSentCount');
const smsPayloadText = document.getElementById('smsPayloadText');
const smsStatusTag = document.getElementById('smsStatusTag');

const atConsole = document.getElementById('atConsole');
const atInput = document.getElementById('atInput');
const historyTableBody = document.getElementById('historyTableBody');
const nearbyServicesList = document.getElementById('nearbyServicesList');

// User Audio Toggle
audioToggleBtn.addEventListener('click', () => {
  const enabled = buzzer.toggle();
  audioToggleBtn.textContent = enabled ? '🔊 Buzzer: ON' : '🔇 Buzzer: MUTED';
  audioToggleBtn.classList.toggle('btn-outline', enabled);
  audioToggleBtn.classList.toggle('btn-warning', !enabled);
});

// Driver Physical / Simulator Cancel Button
cancelAlarmBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Driver pressed physical dashboard button' })
    });
    const data = await res.json();
    if (data.success) {
      appendATLog('DRIVER_CONTROL', 'Cancellation command received. Aborting emergency dispatch.', 'sys');
      buzzer.stopBeeping();
    }
  } catch (err) {
    console.error('Cancel request error:', err);
  }
});

// Setup Server-Sent Events (SSE)
function setupSSE() {
  const eventSource = new EventSource('/events');

  eventSource.onopen = () => {
    connectionStatusBadge.textContent = 'SSE CONNECTED';
    connectionStatusBadge.className = 'badge badge-success';
  };

  eventSource.onerror = () => {
    connectionStatusBadge.textContent = 'RECONNECTING...';
    connectionStatusBadge.className = 'badge badge-warning';
  };

  eventSource.addEventListener('telemetry', (e) => {
    const data = JSON.parse(e.data);
    updateDashboard(data);
  });

  eventSource.addEventListener('countdown_tick', (e) => {
    const data = JSON.parse(e.data);
    countdownTimerVal.textContent = data.remainingSec;
  });

  eventSource.addEventListener('state_changed', (e) => {
    const data = JSON.parse(e.data);
    handleStateChange(data);
  });

  eventSource.addEventListener('at_transaction', (e) => {
    const data = JSON.parse(e.data);
    appendATLog(data.cmd, data.response, data.status === 'ERROR' ? 'err' : 'resp');
  });

  eventSource.addEventListener('sms_sent', (e) => {
    const data = JSON.parse(e.data);
    smsStatusTag.textContent = 'SENT';
    smsStatusTag.className = 'tag tag-sent';
    refreshIncidentLogs();
  });

  eventSource.addEventListener('sms_failed', (e) => {
    const data = JSON.parse(e.data);
    smsStatusTag.textContent = 'FAILED';
    smsStatusTag.className = 'tag tag-failed';
    refreshIncidentLogs();
  });
}

function handleStateChange(transition) {
  masterStateBadge.textContent = transition.currentState;

  if (transition.currentState === 'COUNTDOWN') {
    emergencyBanner.classList.remove('hidden');
    masterStateBadge.className = 'badge badge-danger';
    buzzer.startBeeping();
  } else if (transition.currentState === 'ALERT_PENDING' || transition.currentState === 'SENDING') {
    emergencyBanner.classList.remove('hidden');
    masterStateBadge.className = 'badge badge-warning';
    countdownTimerVal.textContent = '0';
    buzzer.stopBeeping();
  } else if (transition.currentState === 'CANCELLED') {
    emergencyBanner.classList.add('hidden');
    masterStateBadge.className = 'badge badge-warning';
    buzzer.stopBeeping();
    refreshIncidentLogs();
  } else if (transition.currentState === 'SENT') {
    emergencyBanner.classList.add('hidden');
    masterStateBadge.className = 'badge badge-success';
    buzzer.stopBeeping();
    refreshIncidentLogs();
  } else if (transition.currentState === 'FAILED') {
    emergencyBanner.classList.add('hidden');
    masterStateBadge.className = 'badge badge-danger';
    buzzer.stopBeeping();
    refreshIncidentLogs();
  } else if (transition.currentState === 'SENSOR_FAULT') {
    masterStateBadge.className = 'badge badge-danger';
    buzzer.stopBeeping();
  } else {
    emergencyBanner.classList.add('hidden');
    masterStateBadge.className = 'badge badge-state-idle';
    buzzer.stopBeeping();
  }
}

function updateDashboard(data) {
  const { sensor, detection, gps, modem, alert } = data;

  // 1. Sensor Telemetry
  if (sensor.isConnected) {
    sensorHealthBadge.textContent = 'I2C ONLINE';
    sensorHealthBadge.className = 'badge badge-success';

    accelMagVal.innerHTML = `${sensor.magnitude.toFixed(2)} <span class="unit">g</span>`;
    const magPercent = Math.min(100, (sensor.magnitude / 5.0) * 100);
    accelMagBar.style.width = `${magPercent}%`;

    jerkVal.textContent = sensor.jerk.toFixed(1);
    valAx.textContent = `${sensor.ax.toFixed(2)} g`;
    valAy.textContent = `${sensor.ay.toFixed(2)} g`;
    valAz.textContent = `${sensor.az.toFixed(2)} g`;

    barAx.style.width = `${Math.min(100, Math.max(0, (sensor.ax + 4) / 8 * 100))}%`;
    barAy.style.width = `${Math.min(100, Math.max(0, (sensor.ay + 4) / 8 * 100))}%`;
    barAz.style.width = `${Math.min(100, Math.max(0, (sensor.az + 4) / 8 * 100))}%`;

    gyroMagVal.innerHTML = `${sensor.gyroMagnitude.toFixed(1)} <span class="unit">°/s</span>`;
    const gyroPercent = Math.min(100, (sensor.gyroMagnitude / 300.0) * 100);
    gyroMagBar.style.width = `${gyroPercent}%`;

    valRoll.textContent = `${sensor.roll.toFixed(1)}°`;
    valPitch.textContent = `${sensor.pitch.toFixed(1)}°`;
  } else {
    sensorHealthBadge.textContent = 'I2C DISCONNECTED';
    sensorHealthBadge.className = 'badge badge-danger';
    accelMagVal.innerHTML = `ERR <span class="unit">g</span>`;
    gyroMagVal.innerHTML = `ERR <span class="unit">°/s</span>`;
  }

  // 2. Detection Pipeline Status
  classificationVal.textContent = detection.classification;
  classificationReason.textContent = detection.reason;

  if (detection.classification === 'NORMAL_MOVEMENT') {
    classificationVal.style.color = '#00e676';
  } else if (detection.classification === 'POSSIBLE_IMPACT') {
    classificationVal.style.color = '#ffab00';
  } else if (detection.classification === 'SUSPECTED_ACCIDENT' || detection.classification === 'HIGH_SEVERITY_CANDIDATE') {
    classificationVal.style.color = '#ff1744';
  } else if (detection.classification === 'FALSE_ALARM') {
    classificationVal.style.color = '#79c0ff';
  } else if (detection.classification === 'SENSOR_FAULT') {
    classificationVal.style.color = '#f85149';
  }

  // 3. GNSS / GPS Status
  if (gps.status === 'VALID_FIX') {
    gpsFixBadge.textContent = 'VALID FIX';
    gpsFixBadge.className = 'badge badge-success';
    gpsStaleWarning.classList.add('hidden');
    gpsCoords.textContent = `${gps.location.lat.toFixed(5)}, ${gps.location.lng.toFixed(5)}`;
    gpsFixAge.textContent = `${gps.location.fixAgeSec}s`;
    gpsMapLink.href = gps.location.mapUrl;
    gpsMapLink.style.pointerEvents = 'auto';
    gpsMapLink.style.opacity = '1.0';
  } else if (gps.status === 'STALE_FIX') {
    gpsFixBadge.textContent = 'STALE FIX';
    gpsFixBadge.className = 'badge badge-warning';
    gpsStaleWarning.classList.remove('hidden');
    gpsCoords.textContent = `${gps.location.lat.toFixed(5)}, ${gps.location.lng.toFixed(5)} (LAST KNOWN)`;
    gpsFixAge.textContent = `${gps.location.fixAgeSec}s (STALE)`;
    gpsMapLink.href = gps.location.mapUrl;
    gpsMapLink.style.pointerEvents = 'auto';
    gpsMapLink.style.opacity = '1.0';
  } else {
    gpsFixBadge.textContent = 'NO FIX';
    gpsFixBadge.className = 'badge badge-danger';
    gpsStaleWarning.classList.add('hidden');
    gpsCoords.textContent = 'Searching Satellites...';
    gpsFixAge.textContent = 'N/A';
    gpsMapLink.href = '#';
    gpsMapLink.style.pointerEvents = 'none';
    gpsMapLink.style.opacity = '0.5';
  }

  gpsSats.textContent = gps.satellites;
  gpsHdop.textContent = gps.hdop.toFixed(2);

  // 4. SIM7600 Modem Status
  modemPowerVal.textContent = modem.isPowered ? 'ON' : 'OFF';
  modemPowerVal.style.color = modem.isPowered ? '#00e676' : '#ff1744';

  modemSimVal.textContent = modem.simStatus;
  modemCsqVal.textContent = `${modem.signalStrengthCSQ} (~ ${-113 + (modem.signalStrengthCSQ * 2)} dBm)`;
  modemCarrierVal.textContent = modem.operator;
  modemSentCount.textContent = modem.totalSent;

  if (modem.isRegistered && modem.isPowered) {
    modemRegBadge.textContent = 'CREG: REGISTERED';
    modemRegBadge.className = 'badge badge-success';
  } else {
    modemRegBadge.textContent = 'CREG: NO SERVICE';
    modemRegBadge.className = 'badge badge-danger';
  }

  // Active Incident SMS Preview update
  if (alert.activeIncident) {
    const inc = alert.activeIncident;
    smsStatusTag.textContent = inc.communication.smsStatus;
    if (inc.communication.smsStatus === 'SENT') smsStatusTag.className = 'tag tag-sent';
    else if (inc.communication.smsStatus === 'FAILED') smsStatusTag.className = 'tag tag-failed';
    else smsStatusTag.className = 'tag tag-pending';

    const locText = inc.location?.location?.lat
      ? `Loc: ${inc.location.location.lat.toFixed(5)}, ${inc.location.location.lng.toFixed(5)}\nMap: ${inc.location.location.mapUrl}`
      : 'GPS: NO_FIX (Searching satellites)';

    smsPayloadText.textContent = `CRASHSENSE ALERT!\nID: ${inc.incidentId}\nSeverity: ${inc.severity}\nPeak: ${inc.telemetry.peakMagnitude.toFixed(1)}g\n${locText}\nDriver unresp.`;
  }
}

// Scenario Trigger API
async function triggerScenario(scenario) {
  try {
    await fetch('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, durationMs: 3000 })
    });
    appendATLog('PHYSICS_SIM', `Scenario triggered: ${scenario}`, 'sys');
  } catch (err) {
    console.error('Trigger scenario error:', err);
  }
}

// Fault Injection APIs
async function toggleSensor(connected) {
  await fetch('/api/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorConnected: connected })
  });
}

async function toggleGpsFix(hasFix) {
  await fetch('/api/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gpsHasFix: hasFix })
  });
}

async function makeGpsStale() {
  await fetch('/api/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gpsStaleAgeSec: 150 })
  });
  appendATLog('GNSS_SIM', 'GPS fix forced to STALE (Age: 150s)', 'sys');
}

async function toggleModemPower(powered) {
  await fetch('/api/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modemPower: powered })
  });
}

async function toggleModemReg(registered) {
  await fetch('/api/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modemRegistered: registered })
  });
}

async function toggleModemFailure(forceFail) {
  await fetch('/api/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modemForceFailure: forceFail })
  });
}

async function resetSimulator() {
  await fetch('/api/reset', { method: 'POST' });
  document.getElementById('chkSensorOnline').checked = true;
  document.getElementById('chkGpsFix').checked = true;
  document.getElementById('chkModemPower').checked = true;
  document.getElementById('chkModemReg').checked = true;
  document.getElementById('chkModemFail').checked = false;
  appendATLog('SYSTEM', 'Simulator baseline successfully restored.', 'sys');
  buzzer.stopBeeping();
  refreshIncidentLogs();
}

// AT Terminal Controls
function appendATLog(cmd, resp, type = 'resp') {
  const lineCmd = document.createElement('div');
  lineCmd.className = 'log-line at';
  lineCmd.textContent = `> ${cmd}`;
  atConsole.appendChild(lineCmd);

  if (resp) {
    const lineResp = document.createElement('div');
    lineResp.className = `log-line ${type}`;
    lineResp.textContent = `< ${resp}`;
    atConsole.appendChild(lineResp);
  }

  atConsole.scrollTop = atConsole.scrollHeight;
}

function clearATConsole() {
  atConsole.innerHTML = '<div class="log-line sys">[SYSTEM] AT Terminal Cleared</div>';
}

async function sendCustomAT() {
  const cmd = atInput.value.trim();
  if (!cmd) return;
  atInput.value = '';

  try {
    const res = await fetch('/api/at_command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();
    appendATLog(cmd, data.response, data.success ? 'resp' : 'err');
  } catch (err) {
    appendATLog(cmd, 'FETCH ERROR', 'err');
  }
}

function handleAtKey(event) {
  if (event.key === 'Enter') {
    sendCustomAT();
  }
}

// Incident Logs Management
async function refreshIncidentLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    historyTableBody.innerHTML = '';

    if (!data.incidents || data.incidents.length === 0) {
      historyTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888;">No incidents recorded yet.</td></tr>';
      return;
    }

    data.incidents.forEach(inc => {
      const tr = document.createElement('tr');
      const timeStr = new Date(inc.timestamp).toLocaleTimeString();
      const peakG = inc.telemetry?.peakMagnitude?.toFixed(1) || 'N/A';
      const gpsState = inc.location?.status || 'N/A';
      const smsState = inc.communication?.smsStatus || 'N/A';

      tr.innerHTML = `
        <td>${timeStr}</td>
        <td><code>${inc.incidentId}</code></td>
        <td><span class="tag tag-${inc.status.toLowerCase()}">${inc.status}</span></td>
        <td>${peakG}g</td>
        <td>${gpsState}</td>
        <td>${smsState}</td>
      `;
      historyTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

async function clearIncidentLogs() {
  await fetch('/api/logs', { method: 'DELETE' });
  refreshIncidentLogs();
}

// Nearby Emergency Services Directory
async function refreshNearbyServices() {
  try {
    const res = await fetch('/api/nearby_services');
    const data = await res.json();
    nearbyServicesList.innerHTML = '';

    if (!data.results || data.results.length === 0) {
      nearbyServicesList.innerHTML = '<div style="color:#888; font-size:0.75rem;">No facilities discovered.</div>';
      return;
    }

    data.results.forEach(fac => {
      const item = document.createElement('div');
      item.className = 'service-item';
      item.innerHTML = `
        <div>
          <div class="service-name">${fac.name}</div>
          <div style="font-size: 0.68rem; color: #8b949e;">${fac.distanceKm} km away | ${fac.source}</div>
        </div>
        <div style="text-align: right;">
          <div class="service-contact">${fac.contact}</div>
          <span class="service-type-badge">${fac.type.replace(/_/g, ' ')}</span>
        </div>
      `;
      nearbyServicesList.appendChild(item);
    });
  } catch (err) {
    console.error('Error refreshing nearby services:', err);
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  setupSSE();
  refreshIncidentLogs();
  refreshNearbyServices();
});

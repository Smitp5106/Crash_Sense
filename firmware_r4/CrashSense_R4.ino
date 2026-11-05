#include "Arduino_LED_Matrix.h"
#include "WiFiS3.h"
#include <TinyGPS++.h>
#include <Wire.h>
#include <math.h>

// =============================================================================
// CrashSense — Intelligent Accident Detection, Location Tracking & Wi-Fi Alerts
// Target Board: Arduino UNO R4 WiFi
// Hardware: Arduino UNO R4 WiFi + MPU6500 (I2C) + NEO-6M GPS (Serial1 on D0/D1)
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Wi-Fi Configuration
// -----------------------------------------------------------------------------
// Enter your Wi-Fi router or phone mobile hotspot credentials:
const char *WIFI_SSID = "WifiAn";       // <-- Enter Wi-Fi Name / Hotspot
const char *WIFI_PASSWORD = "51020062"; // <-- Enter Wi-Fi Password

// Standalone Access Point fallback (if router is unavailable or outside):
const char *AP_SSID = "CrashSense-R4-AP";
const char *AP_PASS = "password123";

WiFiServer server(80);

// -----------------------------------------------------------------------------
// 2. Hardware Pin Definitions (Arduino UNO R4)
// -----------------------------------------------------------------------------
#define PIN_BUZZER 8 // Optional: Active Piezo Buzzer (+ to D8, - to GND)
#define PIN_CANCEL_BUTTON                                                      \
  2 // Optional: Physical Cancel Button (D2 to GND, uses INPUT_PULLUP)

ArduinoLEDMatrix statusMatrix;

uint8_t MATRIX_STATUS_ON[8][12] = {
    {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
    {0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0}, {0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0},
    {0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0}, {0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0},
    {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}};

uint8_t MATRIX_STATUS_OFF[8][12] = {{0}};

void setStatusMatrix(bool on) {
  if (on) {
    statusMatrix.renderBitmap(MATRIX_STATUS_ON, 8, 12);
  } else {
    statusMatrix.renderBitmap(MATRIX_STATUS_OFF, 8, 12);
  }
}

// MPU6500 I2C Configuration
#define MPU_ADDR 0x68

// GPS Configuration (Connected to D0/RX and D1/TX -> Serial1 on UNO R4)
TinyGPSPlus gps;

// -----------------------------------------------------------------------------
// 3. Multi-Stage Accident Detection Thresholds
// -----------------------------------------------------------------------------
#define ACCEL_THRESHOLD_G 3.0f       // High-G impact collision threshold (g)
#define JERK_THRESHOLD_G_PER_S 18.0f // Rate of change in acceleration (g/s)
#define GYRO_THRESHOLD_DEG_S 120.0f  // Rotational tumble threshold (deg/s)
#define ROLLOVER_TILT_DEG 40.0f      // Permanent rollover tilt threshold (deg)
#define POTHOLE_MAX_MS 120 // Transient shock window for bumps/potholes (ms)
#define CANCELLATION_SECONDS 15 // Driver cancellation countdown (seconds)

// -----------------------------------------------------------------------------
// 4. System State Machine
// -----------------------------------------------------------------------------
enum SystemState {
  STATE_IDLE,
  STATE_CANDIDATE,
  STATE_COUNTDOWN,
  STATE_EMERGENCY_ALERT,
  STATE_CANCELLED
};

SystemState currentState = STATE_IDLE;
String classificationReason = "Normal Driving - Kinematics within safe limits";

// Timing & Telemetry variables
unsigned long lastSampleTime = 0;
unsigned long lastSerialDisplay = 0;
unsigned long countdownStartTime = 0;
int countdownRemainingSec = 0;
unsigned long candidateStartTime = 0;
bool candidateActive = false;

float lastTotalG = 1.0f;
float peakAccelG = 1.0f;
float peakGyroDegS = 0.0f;
float peakJerk = 0.0f;

// Live Sensor Readings
float ax = 0.0, ay = 0.0, az = 1.0;
float gx = 0.0, gy = 0.0, gz = 0.0;
float totalG = 1.0;
float gyroMag = 0.0;
float currentJerk = 0.0;
float currentRoll = 0.0;
float currentPitch = 0.0;

// GPS Cache
double lastValidLat = 0.0;
double lastValidLng = 0.0;
float lastValidSpeedKmh = 0.0;
unsigned long lastValidFixTime = 0;
bool hasValidGpsFix = false;
bool mpuReady = false;

// Active Incident Data
struct IncidentData {
  String id;
  String timestamp;
  float peakG;
  float peakGyro;
  float speedKmh;
  double latitude;
  double longitude;
  String mapUrl;
  String status;
  String reason;
};

IncidentData activeIncident;

// Buzzer & LED non-blocking state
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;

// Forward Function Declarations
int16_t read16(byte reg);
void writeReg(byte reg, byte value);
bool initMPU6500();
void handleHttpClient(WiFiClient &client);
void triggerCrash(const char *reason, float simulatedPeakG = 0,
                  float simulatedGyro = 0);
void cancelCountdown(const char *reason);
void dispatchEmergencyAlert();
void resetSystem();
void evaluateKinematics();

// -----------------------------------------------------------------------------
// 5. MPU6500 Low-Level Driver (Using your verified register logic)
// -----------------------------------------------------------------------------
int16_t read16(byte reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);

  Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)2);
  if (Wire.available() < 2)
    return 0;

  uint8_t highByte = Wire.read();
  uint8_t lowByte = Wire.read();
  return (int16_t)((highByte << 8) | lowByte);
}

void writeReg(byte reg, byte value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

bool initMPU6500() {
  Wire.begin();
  delay(100);

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75); // WHO_AM_I register
  Wire.endTransmission(false);

  Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)1);
  if (!Wire.available()) {
    Serial.println(F("[MPU] Sensor not detected on I2C bus! Check wiring."));
    return false;
  }

  byte id = Wire.read();
  Serial.print(F("[MPU] WHO_AM_I returned: 0x"));
  Serial.println(id, HEX);

  // MPU6500 is 0x70, MPU6050 is 0x68, MPU9250 is 0x71/0x73
  if (id != 0x70 && id != 0x68 && id != 0x71 && id != 0x73) {
    Serial.println(F("[MPU] Note: Unexpected chip ID, proceeding with "
                     "compatible register setup."));
  }

  // Wake up sensor (clear sleep bit in PWR_MGMT_1)
  writeReg(0x6B, 0x00);
  delay(30);

  // Accelerometer +/- 8G (4096 LSB/g)
  writeReg(0x1C, 0x10);

  // Gyroscope +/- 500 degrees/sec (65.5 LSB/(deg/s))
  writeReg(0x1B, 0x08);

  delay(50);
  Serial.println(
      F("[MPU] MPU6500 initialized successfully (+/-8G, +/-500 deg/s)."));
  return true;
}

// -----------------------------------------------------------------------------
// 6. Responsive Web Page HTML (Stored in Flash Memory for UNO R4)
// -----------------------------------------------------------------------------
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CrashSense R4 Telematics</title>
  <style>
    :root {
      --bg: #090d16; --card: #121929; --border: #1f2c47;
      --cyan: #00e5ff; --green: #00e676; --amber: #ffab00; --red: #ff1744;
      --text: #f0f6fc; --muted: #8b949e;
      --mono: 'Consolas', 'Courier New', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding-bottom: 25px; }
    header { background: #0c1322; border-bottom: 1px solid var(--border); padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    .brand { display: flex; align-items: center; gap: 8px; }
    .pulse-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--green); box-shadow: 0 0 10px var(--green); animation: pulse 1.8s infinite; }
    @keyframes pulse { 0% { transform: scale(0.9); opacity: 0.8; } 50% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(0.9); opacity: 0.8; } }
    h1 { font-size: 1.15rem; color: var(--cyan); letter-spacing: 0.5px; }
    .tag { font-size: 0.72rem; font-weight: 700; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; }
    .tag-idle { background: #1c2b48; color: #58a6ff; border: 1px solid #388bfd50; }
    .tag-countdown { background: #700b18; color: #ff8a80; border: 1px solid #ff1744; animation: flash-red 0.8s infinite alternate; }
    .tag-emergency_alert { background: #ff1744; color: #fff; border: 1px solid #fff; box-shadow: 0 0 15px var(--red); }
    @keyframes flash-red { from { opacity: 0.8; } to { opacity: 1; } }

    #emergencyBanner { display: none; background: linear-gradient(135deg, #42040c 0%, #7a0919 100%); border: 2px solid var(--red); padding: 18px; margin: 12px 18px; border-radius: 8px; text-align: center; box-shadow: 0 0 25px rgba(255,23,68,0.5); }
    #emergencyBanner.active { display: block; }
    .banner-title { font-size: 1.3rem; font-weight: 800; color: #fff; }
    .countdown-val { font-size: 3.2rem; font-family: var(--mono); font-weight: 900; color: #fff; text-shadow: 0 0 15px var(--red); margin: 6px 0; }
    .btn-cancel { background: linear-gradient(180deg, #ff1744, #b71c1c); color: #fff; border: 2px solid #fff; font-size: 1.05rem; font-weight: 800; padding: 12px 24px; border-radius: 6px; cursor: pointer; margin-top: 8px; box-shadow: 0 0 15px rgba(255,23,68,0.8); }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; padding: 12px 18px; max-width: 1200px; margin: 0 auto; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .card-title { font-size: 0.9rem; font-weight: 700; color: #c9d1d9; border-bottom: 1px solid var(--border); padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }

    .metric-big { background: #0c1322; border: 1px solid #1a2740; border-radius: 6px; padding: 10px; text-align: center; }
    .metric-label { font-size: 0.72rem; color: var(--muted); font-weight: 700; }
    .metric-number { font-size: 2.0rem; font-family: var(--mono); font-weight: 800; color: var(--cyan); margin: 3px 0; }
    .metric-unit { font-size: 0.85rem; color: var(--muted); }
    .bar-bg { height: 7px; background: #162238; border-radius: 4px; overflow: hidden; margin-top: 5px; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--cyan), var(--amber), var(--red)); width: 25%; transition: width 0.15s; }

    .rows-box { display: flex; flex-direction: column; gap: 6px; background: #0c1322; border: 1px solid #1a2740; border-radius: 6px; padding: 10px; font-size: 0.82rem; }
    .row { display: flex; justify-content: space-between; }
    .row-val { font-family: var(--mono); font-weight: 700; color: #e6edf3; }

    .btn-maps { background: #1f6feb; color: #fff; text-decoration: none; font-weight: 700; font-size: 0.82rem; padding: 10px; border-radius: 6px; text-align: center; display: block; }
    .btn-maps:hover { background: #388bfd; }

    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .btn-action { background: #1a253c; border: 1px solid #2b3b5f; color: #c9d1d9; font-size: 0.78rem; font-weight: 700; padding: 8px; border-radius: 6px; cursor: pointer; }
    .btn-action:hover { background: #263659; color: #fff; }

    footer { text-align: center; font-size: 0.72rem; color: var(--muted); margin-top: 15px; }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="pulse-dot"></div>
      <div>
        <h1>CrashSense Telematics</h1>
        <div style="font-size:0.72rem; color:var(--muted);">Arduino UNO R4 WiFi + MPU6500 + NEO-6M GPS</div>
      </div>
    </div>
    <div style="display:flex; gap:8px; align-items:center;">
      <span id="connectionTag" class="tag tag-idle">CONNECTING</span>
      <span id="stateTag" class="tag tag-idle">IDLE</span>
    </div>
  </header>

  <section id="emergencyBanner">
    <div class="banner-title" id="bannerTitle">⚠️ CRASH SUSPECTED</div>
    <div style="color:#ffcdd2; font-size:0.85rem;" id="bannerReason">Check the vehicle and cancel if this is a false alarm.</div>
    <div class="countdown-val" id="countdownVal">15</div>
    <button id="cancelButton" class="btn-cancel" onclick="cancelAlert()">🛑 CANCEL FALSE ALARM (I AM OK)</button>
  </section>

  <main class="grid">

    <div class="card">
      <div class="card-title">
        <span>📊 MPU6500 Motion Telemetry</span>
        <span id="motionStatusTag" style="font-size:0.72rem; color:var(--amber);">CHECKING SENSOR</span>
      </div>

      <div class="metric-big">
        <div class="metric-label">TOTAL ACCELERATION</div>
        <div class="metric-number" id="valTotalG">1.00 <span class="metric-unit">g</span></div>
        <div class="bar-bg"><div id="barTotalG" class="bar-fill" style="width: 20%;"></div></div>
        <div style="font-size:0.7rem; color:var(--muted); margin-top:3px;">Threshold: 3.0g | Jerk: <span id="valJerk">0.0</span> g/s</div>
      </div>

      <div class="rows-box">
        <div class="row"><span>Linear Ax (Longitudinal):</span><span class="row-val" id="valAx">0.00 g</span></div>
        <div class="row"><span>Linear Ay (Lateral):</span><span class="row-val" id="valAy">0.00 g</span></div>
        <div class="row"><span>Linear Az (Vertical/Gravity):</span><span class="row-val" id="valAz">1.00 g</span></div>
        <div class="row"><span>Gyro Magnitude (&omega;):</span><span class="row-val" id="valGyroMag">0.0 °/s</span></div>
        <div class="row"><span>Roll &amp; Pitch Tilt:</span><span class="row-val"><span id="valRoll">0.0</span>° / <span id="valPitch">0.0</span>°</span></div>
      </div>

      <div style="background:#0c1322; border:1px solid #1a2740; border-radius:4px; padding:8px; font-size:0.78rem;">
        <span style="color:var(--muted); font-size:0.7rem; font-weight:700;">CLASSIFICATION:</span>
        <div id="valClass" style="font-family:var(--mono); font-weight:700; color:var(--green);">NORMAL_MOVEMENT</div>
        <div id="valClassReason" style="font-size:0.72rem; color:var(--muted);">Kinematics within safe bounds.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>🛰️ NEO-6M GNSS Location</span>
        <span id="gpsStatusTag" style="font-size:0.72rem; color:var(--amber);">SEARCHING...</span>
      </div>

      <div class="metric-big">
        <div class="metric-label">VEHICLE SPEED</div>
        <div class="metric-number" id="valSpeed">0.0 <span class="metric-unit">km/h</span></div>
        <div style="font-size:0.7rem; color:var(--muted);">Satellites: <strong id="valSats" style="color:#fff;">0</strong></div>
      </div>

      <div class="rows-box">
        <div class="row"><span>Latitude:</span><span class="row-val" id="valLat">--.------</span></div>
        <div class="row"><span>Longitude:</span><span class="row-val" id="valLng">--.------</span></div>
        <div class="row"><span>Fix Freshness:</span><span class="row-val" id="valFixAge">Waiting...</span></div>
      </div>

      <a id="btnMapLink" class="btn-maps" href="#" target="_blank">📍 Open Location in Google Maps</a>

    </div>

    <div class="card" style="grid-column: 1 / -1;">
      <div class="card-title">
        <span>🚨 Latest Incident</span>
        <span id="incidentStatusTag" style="font-size:0.72rem; color:var(--muted);">IDLE</span>
      </div>

      <div id="alertPayloadBox" style="background:#0c1322; border-left:4px solid var(--cyan); border-radius:4px; padding:10px; font-family:var(--mono); font-size:0.8rem; color:#79c0ff; white-space:pre-wrap;">No incident recorded. The board is monitoring its motion sensor.</div>
      <div class="actions" style="max-width:320px;">
        <button class="btn-action" onclick="resetSystem()">🔄 Reset alert state</button>
      </div>
    </div>

  </main>

  <footer>
    CrashSense UNO R4 WiFi | Local dashboard over Wi-Fi · No cellular alert module
  </footer>

  <script>
    async function fetchData() {
      try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error('Dashboard request failed');
        const d = await res.json();
        const connectionTag = document.getElementById('connectionTag');
        connectionTag.innerText = 'BOARD ONLINE';
        connectionTag.style.color = 'var(--green)';

        const motionStatusTag = document.getElementById('motionStatusTag');
        motionStatusTag.innerText = d.motion.sensorReady ? 'MPU6500 READY' : 'MPU6500 NOT DETECTED';
        motionStatusTag.style.color = d.motion.sensorReady ? 'var(--green)' : 'var(--red)';

        // Update Motion
        document.getElementById('valTotalG').innerHTML = d.motion.totalG.toFixed(2) + ' <span class="metric-unit">g</span>';
        const percent = Math.min(100, (d.motion.totalG / 5.0) * 100);
        document.getElementById('barTotalG').style.width = percent + '%';
        document.getElementById('valJerk').innerText = d.motion.jerk.toFixed(1);

        document.getElementById('valAx').innerText = d.motion.ax.toFixed(2) + ' g';
        document.getElementById('valAy').innerText = d.motion.ay.toFixed(2) + ' g';
        document.getElementById('valAz').innerText = d.motion.az.toFixed(2) + ' g';
        document.getElementById('valGyroMag').innerText = d.motion.gyroMag.toFixed(1) + ' °/s';
        document.getElementById('valRoll').innerText = d.motion.roll.toFixed(1);
        document.getElementById('valPitch').innerText = d.motion.pitch.toFixed(1);

        document.getElementById('valClass').innerText = d.detection.classification;
        document.getElementById('valClassReason').innerText = d.detection.reason;

        // Update GPS
        document.getElementById('valSpeed').innerHTML = d.gps.speedKmh.toFixed(1) + ' <span class="metric-unit">km/h</span>';
        document.getElementById('valSats').innerText = d.gps.satellites;
        const hasCoordinates = d.gps.latitude !== 0 || d.gps.longitude !== 0;
        document.getElementById('valLat').innerText = hasCoordinates ? d.gps.latitude.toFixed(6) : 'Waiting for fix';
        document.getElementById('valLng').innerText = hasCoordinates ? d.gps.longitude.toFixed(6) : 'Waiting for fix';
        document.getElementById('valFixAge').innerText = d.gps.hasFix ? d.gps.fixAgeSec + 's ago' : 'No current fix';

        const gpsTag = document.getElementById('gpsStatusTag');
        if (d.gps.hasFix) {
          gpsTag.innerText = 'GPS FIX';
          gpsTag.style.color = 'var(--green)';
        } else {
          gpsTag.innerText = 'WAITING SATELLITES';
          gpsTag.style.color = 'var(--amber)';
        }

        const mapBtn = document.getElementById('btnMapLink');
        if (d.gps.mapUrl && d.gps.mapUrl.length > 5) {
          mapBtn.href = d.gps.mapUrl;
          mapBtn.style.opacity = '1.0';
          mapBtn.style.pointerEvents = 'auto';
        } else {
          mapBtn.href = '#';
          mapBtn.style.opacity = '0.5';
          mapBtn.style.pointerEvents = 'none';
        }

        // Update State Tag
        const stateTag = document.getElementById('stateTag');
        stateTag.innerText = d.system.state.replace('_', ' ');
        stateTag.className = 'tag tag-' + d.system.state.toLowerCase();

        // Countdown Banner
        const banner = document.getElementById('emergencyBanner');
        if (d.system.state === 'COUNTDOWN' || d.system.state === 'EMERGENCY_ALERT') {
          banner.classList.add('active');
          const countingDown = d.system.state === 'COUNTDOWN';
          document.getElementById('bannerTitle').innerText = countingDown ? '⚠️ CRASH SUSPECTED' : '🚨 EMERGENCY ALERT ACTIVE';
          document.getElementById('countdownVal').style.display = countingDown ? 'block' : 'none';
          document.getElementById('countdownVal').innerText = d.system.countdownSec;
          document.getElementById('cancelButton').style.display = countingDown ? 'inline-block' : 'none';
          document.getElementById('bannerReason').innerText = d.detection.reason;
        } else {
          banner.classList.remove('active');
        }

        // Incident Payload
        if (d.incident && d.incident.id) {
          document.getElementById('incidentStatusTag').innerText = d.incident.status;
          document.getElementById('incidentStatusTag').style.color = d.incident.status === 'EMERGENCY_ALERT' ? 'var(--red)' : 'var(--amber)';
          
          let alertText = "CRASHSENSE INCIDENT\n" +
                          "Incident ID: " + d.incident.id + "\n" +
                          "Peak Impact: " + d.incident.peakG.toFixed(2) + " g | Gyro: " + d.incident.peakGyro.toFixed(1) + " deg/s\n" +
                          "Speed: " + d.incident.speedKmh.toFixed(1) + " km/h\n" +
                          "Coordinates: " + (d.incident.latitude || d.incident.longitude ? d.incident.latitude.toFixed(6) + ", " + d.incident.longitude.toFixed(6) : "No GPS fix") + "\n" +
                          "Status: " + d.incident.status + " (" + d.incident.reason + ")";
          if (d.incident.mapUrl && d.incident.mapUrl.startsWith('https://')) alertText += "\nMap: " + d.incident.mapUrl;
          document.getElementById('alertPayloadBox').innerText = alertText;
        } else {
          document.getElementById('incidentStatusTag').innerText = 'NO INCIDENT';
          document.getElementById('alertPayloadBox').innerText = 'No incident recorded. The board is monitoring its motion sensor.';
        }

      } catch (err) {
        const connectionTag = document.getElementById('connectionTag');
        connectionTag.innerText = 'BOARD OFFLINE';
        connectionTag.style.color = 'var(--red)';
      }
    }

    async function cancelAlert() {
      try { await fetch('/api/cancel', { method: 'POST' }); fetchData(); } catch (e) {}
    }
    async function resetSystem() {
      try { await fetch('/api/reset', { method: 'POST' }); await fetchData(); } catch (e) {}
    }

    setInterval(fetchData, 1000);
    window.addEventListener('DOMContentLoaded', fetchData);
  </script>
</body>
</html>
)rawliteral";

// -----------------------------------------------------------------------------
// 7. HTTP Request Dispatcher for WiFiS3
// -----------------------------------------------------------------------------
void handleHttpClient(WiFiClient &client) {
  String reqLine = "";
  unsigned long timeout = millis() + 1500;

  while (client.connected() && millis() < timeout) {
    if (client.available()) {
      char c = client.read();
      if (c == '\n')
        break;
      if (c != '\r')
        reqLine += c;
    }
  }

  // Discard remaining headers
  while (client.available()) {
    client.read();
  }

  // 1. API: Data Telemetry JSON
  if (reqLine.indexOf("GET /api/data") >= 0) {
    client.println(F("HTTP/1.1 200 OK"));
    client.println(F("Content-Type: application/json"));
    client.println(F("Connection: close"));
    client.println();

    float curSpeed = gps.speed.isValid() ? gps.speed.kmph() : lastValidSpeedKmh;
    unsigned long fixAge = gps.location.isValid()
                               ? (gps.location.age() / 1000)
                               : ((millis() - lastValidFixTime) / 1000);

    String stateStr = "IDLE";
    if (currentState == STATE_COUNTDOWN)
      stateStr = "COUNTDOWN";
    else if (currentState == STATE_EMERGENCY_ALERT)
      stateStr = "EMERGENCY_ALERT";
    else if (currentState == STATE_CANCELLED)
      stateStr = "CANCELLED";

    client.print(F("{\"motion\":{"));
    client.print(F("\"sensorReady\":"));
    client.print(mpuReady ? F("true") : F("false"));
    client.print(F(","));
    client.print(F("\"ax\":"));
    client.print(ax, 3);
    client.print(F(","));
    client.print(F("\"ay\":"));
    client.print(ay, 3);
    client.print(F(","));
    client.print(F("\"az\":"));
    client.print(az, 3);
    client.print(F(","));
    client.print(F("\"totalG\":"));
    client.print(totalG, 3);
    client.print(F(","));
    client.print(F("\"gyroMag\":"));
    client.print(gyroMag, 2);
    client.print(F(","));
    client.print(F("\"jerk\":"));
    client.print(currentJerk, 2);
    client.print(F(","));
    client.print(F("\"roll\":"));
    client.print(currentRoll, 1);
    client.print(F(","));
    client.print(F("\"pitch\":"));
    client.print(currentPitch, 1);
    client.print(F("},\"gps\":{"));
    client.print(F("\"hasFix\":"));
    client.print(gps.location.isValid() ? F("true") : F("false"));
    client.print(F(","));
    // Public local HTTP API intentionally omits exact position. The board's
    // local Wi-Fi server has no authenticated TLS session for private GPS.
    client.print(F("\"latitude\":0"));
    client.print(F(","));
    client.print(F("\"longitude\":0"));
    client.print(F(","));
    client.print(F("\"speedKmh\":"));
    client.print(curSpeed, 1);
    client.print(F(","));
    client.print(F("\"satellites\":"));
    client.print(gps.satellites.value());
    client.print(F(","));
    client.print(F("\"fixAgeSec\":"));
    client.print(fixAge);
    client.print(F(","));
    client.print(F("\"mapUrl\":\"\""));
    client.print(F("},\"system\":{"));
    client.print(F("\"state\":\""));
    client.print(stateStr);
    client.print(F("\","));
    client.print(F("\"countdownSec\":"));
    client.print(countdownRemainingSec);
    client.print(F("},\"detection\":{"));
    client.print(F("\"classification\":\""));
    if (currentState == STATE_IDLE) {
      client.print(F("NORMAL_MOVEMENT"));
    } else if (currentState == STATE_COUNTDOWN) {
      client.print(F("SUSPECTED_CRASH"));
    } else {
      client.print(stateStr);
    }
    client.print(F("\","));
    client.print(F("\"reason\":\""));
    client.print(classificationReason);
    client.print(F("\""));
    client.print(F("},\"incident\":{"));
    client.print(F("\"id\":\""));
    client.print(activeIncident.id);
    client.print(F("\","));
    client.print(F("\"status\":\""));
    client.print(activeIncident.status);
    client.print(F("\","));
    client.print(F("\"reason\":\""));
    client.print(activeIncident.reason);
    client.print(F("\","));
    client.print(F("\"peakG\":"));
    client.print(activeIncident.peakG, 2);
    client.print(F(","));
    client.print(F("\"peakGyro\":"));
    client.print(activeIncident.peakGyro, 1);
    client.print(F(","));
    client.print(F("\"speedKmh\":"));
    client.print(activeIncident.speedKmh, 1);
    client.print(F(","));
    client.print(F("\"latitude\":0"));
    client.print(F(","));
    client.print(F("\"longitude\":0"));
    client.print(F(","));
    client.print(F("\"mapUrl\":\"\""));
    client.print(F("}}"));
  }
  // 2. API: Cancel
  else if (reqLine.indexOf("/api/cancel") >= 0) {
    cancelCountdown("Cancelled by user from Web Dashboard");
    client.println(F("HTTP/1.1 200 OK"));
    client.println(F("Content-Type: application/json"));
    client.println(F("Connection: close"));
    client.println();
    client.println(F("{\"success\":true}"));
  }
  // 3. API: Reset
  else if (reqLine.indexOf("/api/reset") >= 0) {
    resetSystem();
    client.println(F("HTTP/1.1 200 OK"));
    client.println(F("Content-Type: application/json"));
    client.println(F("Connection: close"));
    client.println();
    client.println(F("{\"success\":true}"));
  }
  // 4. Root Web Page
  else {
    client.println(F("HTTP/1.1 200 OK"));
    client.println(F("Content-Type: text/html"));
    client.println(F("Connection: close"));
    client.println();
    client.print(INDEX_HTML);
  }

  delay(5);
  client.stop();
}

// -----------------------------------------------------------------------------
// 8. Crash Detection & State Machine Logic
// -----------------------------------------------------------------------------
void triggerCrash(const char *reason, float simulatedPeakG,
                  float simulatedGyro) {
  if (currentState == STATE_COUNTDOWN ||
      currentState == STATE_EMERGENCY_ALERT) {
    return;
  }

  currentState = STATE_COUNTDOWN;
  countdownStartTime = millis();
  countdownRemainingSec = CANCELLATION_SECONDS;
  classificationReason = String(reason);

  activeIncident.id = "INC-" + String(millis() / 1000);
  activeIncident.timestamp = String(millis() / 1000) + "s uptime";
  activeIncident.peakG = (simulatedPeakG > 0) ? simulatedPeakG : peakAccelG;
  activeIncident.peakGyro = (simulatedGyro > 0) ? simulatedGyro : peakGyroDegS;
  activeIncident.speedKmh =
      gps.speed.isValid() ? gps.speed.kmph() : lastValidSpeedKmh;
  activeIncident.latitude =
      gps.location.isValid() ? gps.location.lat() : lastValidLat;
  activeIncident.longitude =
      gps.location.isValid() ? gps.location.lng() : lastValidLng;
  if (activeIncident.latitude != 0.0) {
    activeIncident.mapUrl =
        "https://www.google.com/maps?q=" + String(activeIncident.latitude, 6) +
        "," + String(activeIncident.longitude, 6);
  } else {
    activeIncident.mapUrl = "Location Unavailable (Searching satellites)";
  }
  activeIncident.status = "COUNTDOWN_ACTIVE";
  activeIncident.reason = reason;

  Serial.println(F("\n**************************************************"));
  Serial.println(F("  [ALERT] SUSPECTED VEHICULAR COLLISION DETECTED! "));
  Serial.print(F("  Reason: "));
  Serial.println(reason);
  Serial.print(F("  Peak Impact: "));
  Serial.print(activeIncident.peakG);
  Serial.println(F(" g"));
  Serial.print(F("  Countdown: "));
  Serial.print(CANCELLATION_SECONDS);
  Serial.println(F(" seconds before Wi-Fi dispatch."));
  Serial.println(F("  Press CANCEL button on Webpage or D2 to cancel!"));
  Serial.println(F("**************************************************\n"));
}

void cancelCountdown(const char *reason) {
  if (currentState != STATE_COUNTDOWN)
    return;

  currentState = STATE_CANCELLED;
  classificationReason = String(reason);
  activeIncident.status = "CANCELLED";

  // Turn off buzzer
  digitalWrite(PIN_BUZZER, LOW);

  Serial.print(F("\n[SAFE] False alarm cancelled: "));
  Serial.println(reason);

  delay(200);
  currentState = STATE_IDLE;
  candidateActive = false;
  classificationReason = "Normal Driving - Resumed after cancellation";
}

void dispatchEmergencyAlert() {
  currentState = STATE_EMERGENCY_ALERT;
  activeIncident.status = "EMERGENCY_ALERT";
  classificationReason =
      "CRASH CONFIRMED - Local Wi-Fi dashboard alert is active; no cellular dispatch.";

  digitalWrite(PIN_BUZZER, HIGH);

  Serial.println(
      F("\n========================================================"));
  Serial.println(F("  🚨 CRASHSENSE EMERGENCY ALERT DISPATCHED VIA WI-FI!   "));
  Serial.println(F("========================================================"));
  Serial.print(F("  Incident ID: "));
  Serial.println(activeIncident.id);
  Serial.print(F("  Peak Impact: "));
  Serial.print(activeIncident.peakG);
  Serial.println(F(" g"));
  Serial.print(F("  Gyro Angular Rate: "));
  Serial.print(activeIncident.peakGyro);
  Serial.println(F(" deg/s"));
  Serial.print(F("  Vehicle Speed: "));
  Serial.print(activeIncident.speedKmh);
  Serial.println(F(" km/h"));
  Serial.print(F("  Latitude:  "));
  Serial.println(activeIncident.latitude, 6);
  Serial.print(F("  Longitude: "));
  Serial.println(activeIncident.longitude, 6);
  Serial.print(F("  Google Maps URL: "));
  Serial.println(activeIncident.mapUrl);
  Serial.println(
      F("========================================================\n"));
}

void resetSystem() {
  currentState = STATE_IDLE;
  candidateActive = false;
  digitalWrite(PIN_BUZZER, LOW);
  classificationReason = "System reset to normal baseline";
  Serial.println(F("[SYSTEM] Baseline reset executed."));
}

// -----------------------------------------------------------------------------
// 9. Process Sensor Samples & Kinematic Evaluation (50 Hz)
// -----------------------------------------------------------------------------
void evaluateKinematics() {
  unsigned long now = millis();
  float dt = (now - lastSampleTime) / 1000.0f;
  if (dt <= 0.001f)
    dt = 0.02f;
  lastSampleTime = now;

  // Read accelerometer (+/- 8G, 4096 LSB/g)
  ax = read16(0x3B) / 4096.0f;
  ay = read16(0x3D) / 4096.0f;
  az = read16(0x3F) / 4096.0f;

  // Read gyroscope (+/- 500 deg/s, 65.5 LSB/(deg/s))
  gx = read16(0x43) / 65.5f;
  gy = read16(0x45) / 65.5f;
  gz = read16(0x47) / 65.5f;

  // Calculate Total Acceleration Magnitude (g)
  totalG = sqrtf(ax * ax + ay * ay + az * az);

  // Calculate Linear Jerk (g/s)
  currentJerk = fabsf(totalG - lastTotalG) / dt;
  lastTotalG = totalG;

  // Calculate Gyroscope Magnitude (deg/s)
  gyroMag = sqrtf(gx * gx + gy * gy + gz * gz);

  // Calculate Pitch and Roll (deg)
  currentPitch = atan2f(ax, sqrtf(ay * ay + az * az)) * (180.0f / PI);
  currentRoll = atan2f(ay, sqrtf(ax * ax + az * az)) * (180.0f / PI);

  // Update GPS cache
  if (gps.location.isValid()) {
    lastValidLat = gps.location.lat();
    lastValidLng = gps.location.lng();
    lastValidFixTime = millis();
    hasValidGpsFix = true;
  }
  if (gps.speed.isValid()) {
    lastValidSpeedKmh = gps.speed.kmph();
  }

  // If already in countdown or alert, don't re-trigger
  if (currentState == STATE_COUNTDOWN ||
      currentState == STATE_EMERGENCY_ALERT) {
    return;
  }

  // Multi-Stage Candidate Evaluation
  if (candidateActive) {
    unsigned long elapsed = now - candidateStartTime;
    if (totalG > peakAccelG)
      peakAccelG = totalG;
    if (gyroMag > peakGyroDegS)
      peakGyroDegS = gyroMag;

    // Check for transient bump / pothole (< 120ms shock, low gyro, vehicle
    // continues)
    if (elapsed > POTHOLE_MAX_MS && elapsed < 400) {
      if (peakGyroDegS < 70.0f && totalG < 1.35f) {
        candidateActive = false;
        classificationReason =
            "Transient pothole/bump dismissed as FALSE_ALARM";
        return;
      }
    }

    // Check for hard braking: longitudinal deceleration with low rotational
    // tumbling
    if (elapsed > 400 && ax < -1.4f && peakGyroDegS < 40.0f) {
      candidateActive = false;
      classificationReason =
          "Sudden braking evaluated and dismissed as safe deceleration";
      return;
    }

    // Check for confirmed collision (High-G + Gyro Tumble OR Rollover)
    bool hasImpact = peakAccelG >= ACCEL_THRESHOLD_G;
    bool hasTumble = peakGyroDegS >= GYRO_THRESHOLD_DEG_S;
    bool hasRollover = fabsf(currentRoll) >= ROLLOVER_TILT_DEG;

    if (elapsed >= 500 && hasImpact && (hasTumble || hasRollover)) {
      candidateActive = false;
      triggerCrash(hasRollover ? "Vehicle Rollover Detected"
                               : "High-G Vehicular Collision Verified");
      return;
    }

    if (elapsed > 1200) {
      candidateActive = false;
      classificationReason =
          "Shock dismissed: lacked sustained collision dynamics";
    }
  } else {
    // Stage 1 Trigger Check
    bool isCandidateShock =
        (totalG >= ACCEL_THRESHOLD_G) ||
        (currentJerk >= JERK_THRESHOLD_G_PER_S && totalG >= 2.2f);
    if (isCandidateShock) {
      candidateActive = true;
      candidateStartTime = now;
      peakAccelG = totalG;
      peakGyroDegS = gyroMag;
      classificationReason =
          "Potential impact detected. Verifying kinematics...";
    }
  }
}

// -----------------------------------------------------------------------------
// 10. Arduino UNO R4 Setup
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println(
      F("\n========================================================"));
  Serial.println(F("  CrashSense — Intelligent Vehicular Telematics System  "));
  Serial.println(F("  Target: Arduino UNO R4 WiFi                          "));
  Serial.println(F("  Sensors: MPU6500 (I2C) + NEO-6M GPS (Serial1 on D0/D1)"));
  Serial.println(F("========================================================"));

  // GPIO Pins setup
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  statusMatrix.begin();
  setStatusMatrix(false);

  pinMode(PIN_CANCEL_BUTTON, INPUT_PULLUP); // D2 to GND

  // GPS on Serial1 (Pins D0 and D1 on Arduino UNO R4)
  Serial1.begin(9600);
  Serial.println(F("[GPS] Serial1 initialized at 9600 baud on pins D0/D1."));

  // Initialize MPU6500 on I2C
  mpuReady = initMPU6500();
  if (!mpuReady) {
    Serial.println(
        F("[WARN] MPU6500 check failed. Please check SDA/SCL wiring."));
  }

  // ---------------------------------------------------------------------------
  // Wi-Fi Setup for Arduino UNO R4 WiFi (WiFiS3)
  // ---------------------------------------------------------------------------
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println(
        F("[WIFI] Critical: Communication with WiFi module failed!"));
  } else {
    if (strlen(WIFI_SSID) > 0 && String(WIFI_SSID) != "YOUR_WIFI_NAME") {
      Serial.print(F("[WIFI] Connecting to Wi-Fi: "));
      Serial.println(WIFI_SSID);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

      int timeout = 0;
      while (WiFi.status() != WL_CONNECTED && timeout < 25) {
        delay(500);
        Serial.print(F("."));
        timeout++;
      }

      if (WiFi.status() == WL_CONNECTED) {
        Serial.println(F("\n[WIFI] Connected successfully!"));
        Serial.print(F("[WIFI] Web Dashboard URL: http://"));
        Serial.println(WiFi.localIP());
      } else {
        Serial.println(F("\n[WIFI] Could not connect to router. Starting "
                         "Access Point fallback..."));
        WiFi.beginAP(AP_SSID, AP_PASS);
        Serial.print(F("[WIFI] AP Started: "));
        Serial.println(AP_SSID);
        Serial.print(F("[WIFI] AP Web Dashboard URL: http://"));
        Serial.println(WiFi.localIP());
      }
    } else {
      Serial.println(F("[WIFI] Starting Standalone Access Point mode..."));
      WiFi.beginAP(AP_SSID, AP_PASS);
      Serial.print(F("[WIFI] Connect your phone/laptop to Wi-Fi '"));
      Serial.print(AP_SSID);
      Serial.println(F("' (Password: password123)"));
      Serial.print(F("[WIFI] Then open http://"));
      Serial.println(WiFi.localIP());
    }
  }

  // Start HTTP Server
  server.begin();
  Serial.println(F("[HTTP] Web Server active on port 80."));
  Serial.println(
      F("[READY] CrashSense active. Type 'CRASH' in Serial Monitor to test."));
}

// -----------------------------------------------------------------------------
// 11. Arduino Main Loop
// -----------------------------------------------------------------------------
void loop() {
  // 1. Service Incoming GPS Stream continuously
  while (Serial1.available()) {
    gps.encode(Serial1.read());
  }

  // 2. Service Incoming Web Clients (WiFiS3)
  WiFiClient client = server.available();
  if (client) {
    handleHttpClient(client);
  }

  // 3. Sample MPU6500 Kinematics at 50 Hz (every 20ms)
  if (millis() - lastSampleTime >= 20) {
    evaluateKinematics();
  }

  // 4. Physical Cancellation Button Check (Pin D2 to GND)
  if (digitalRead(PIN_CANCEL_BUTTON) == LOW) {
    if (currentState == STATE_COUNTDOWN) {
      cancelCountdown("Physical button on D2 pressed by driver");
      delay(300); // debounce
    }
  }

  // 5. Countdown State Ticker
  if (currentState == STATE_COUNTDOWN) {
    unsigned long elapsed = millis() - countdownStartTime;
    countdownRemainingSec = CANCELLATION_SECONDS - (elapsed / 1000);

    // Beep buzzer pattern (150ms ON, 150ms OFF)
    if (millis() - lastBuzzerToggle >= 150) {
      lastBuzzerToggle = millis();
      buzzerState = !buzzerState;
      digitalWrite(PIN_BUZZER, buzzerState ? HIGH : LOW);
      setStatusMatrix(buzzerState);
    }

    if (countdownRemainingSec <= 0) {
      dispatchEmergencyAlert();
    }
  }

  // 6. Serial Commands for Quick Testing
  while (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if (cmd == "CRASH") {
      triggerCrash("Simulated High-G Crash (Serial Command)", 4.8f, 220.0f);
    } else if (cmd == "CANCEL") {
      cancelCountdown("Serial Monitor Cancel Command");
    } else if (cmd == "RESET") {
      resetSystem();
    } else if (cmd == "STATUS") {
      Serial.println(F("\n--- CrashSense R4 Status ---"));
      Serial.print(F("State: "));
      Serial.println(currentState == STATE_IDLE
                         ? F("IDLE")
                         : (currentState == STATE_COUNTDOWN
                                ? F("COUNTDOWN")
                                : F("EMERGENCY_ALERT")));
      Serial.print(F("Total G: "));
      Serial.print(totalG);
      Serial.println(F(" g"));
      Serial.print(F("GPS Speed: "));
      Serial.print(gps.speed.kmph());
      Serial.println(F(" km/h"));
      Serial.print(F("GPS Sats: "));
      Serial.println(gps.satellites.value());
      Serial.print(F("Web Dashboard URL: http://"));
      Serial.println(WiFi.localIP());
      Serial.println(F("-----------------------------\n"));
    }
  }

  // 7. Periodic 1-Second Serial Diagnostic Heartbeat
  if (millis() - lastSerialDisplay >= 1000) {
    lastSerialDisplay = millis();

    setStatusMatrix(true);
    delay(15);
    setStatusMatrix(false);

    if (currentState == STATE_COUNTDOWN) {
      Serial.print(F("⚠️ [COUNTDOWN] "));
      Serial.print(countdownRemainingSec);
      Serial.println(F(
          "s remaining before alert dispatch! Press D2 or cancel on webpage."));
    }
  }
}

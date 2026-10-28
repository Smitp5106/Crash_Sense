/**
 * CrashSense Interactive Simulator Server
 *
 * Built with standard Node.js HTTP module (zero external npm runtime dependencies required).
 * Provides:
 * - Static file serving for the Web Dashboard (index.html, style.css, app.js).
 * - Real-time Server-Sent Events (SSE) telemetry stream (/events).
 * - RESTful control API (/api/scenario, /api/cancel, /api/fault, /api/reset, /api/logs, /api/at_command).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const CONFIG = require('./src/config');
const SensorEngine = require('./src/sensorEngine');
const AccidentDetector = require('./src/detector');
const GPSEngine = require('./src/gpsEngine');
const ModemEngine = require('./src/modemEngine');
const AlertManager = require('./src/alertManager');
const EmergencyLookup = require('./src/emergencyLookup');

// Initialize Core Subsystems
const sensor = new SensorEngine(CONFIG);
const detector = new AccidentDetector(CONFIG);
const gps = new GPSEngine(CONFIG);
const modem = new ModemEngine(CONFIG);
const alertManager = new AlertManager(sensor, detector, gps, modem, CONFIG);
const lookup = new EmergencyLookup();

// Active SSE client connections
const sseClients = new Set();

function broadcastEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Attach event listeners to broadcast state changes
alertManager.on('state_changed', (t) => broadcastEvent('state_changed', t));
alertManager.on('countdown_tick', (t) => broadcastEvent('countdown_tick', t));
modem.on('at_transaction', (entry) => broadcastEvent('at_transaction', entry));
modem.on('sms_sent', (msg) => broadcastEvent('sms_sent', msg));
modem.on('sms_failed', (msg) => broadcastEvent('sms_failed', msg));
detector.on('classification_changed', (c) => broadcastEvent('classification_changed', c));

// Telemetry Sampling Loop (20 Hz = 50ms)
setInterval(() => {
  const sample = sensor.sample();
  const detection = detector.processSample(sample);
  const gpsStatus = gps.getLocationStatus();
  const modemStatus = modem.getStatus();

  const telemetry = {
    timestamp: Date.now(),
    sensor: sample,
    detection,
    gps: gpsStatus,
    modem: modemStatus,
    alert: {
      state: alertManager.currentState,
      buzzerActive: alertManager.buzzerActive,
      countdownRemainingSec: alertManager.countdownRemainingSec,
      activeIncident: alertManager.activeIncident
    }
  };

  broadcastEvent('telemetry', telemetry);
}, CONFIG.SAMPLING_INTERVAL_MS);

// Helper to serve static files
function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Request body helper
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// HTTP Request Handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers for local development flexibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE Stream Endpoint
  if (pathname === '/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // --- API Routes ---
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');

    try {
      // 1. Get Telemetry Snapshot
      if (pathname === '/api/telemetry' && method === 'GET') {
        const sample = sensor.sample();
        res.writeHead(200);
        res.end(JSON.stringify({
          sensor: sample,
          detection: detector.processSample(sample),
          gps: gps.getLocationStatus(),
          modem: modem.getStatus(),
          alert: {
            state: alertManager.currentState,
            buzzerActive: alertManager.buzzerActive,
            countdownRemainingSec: alertManager.countdownRemainingSec,
            activeIncident: alertManager.activeIncident
          }
        }));
        return;
      }

      // 2. Set Physics Scenario
      if (pathname === '/api/scenario' && method === 'POST') {
        const body = await parseJsonBody(req);
        const scenario = body.scenario || 'NORMAL_DRIVING';
        const duration = body.durationMs || 3000;
        sensor.setScenario(scenario, duration);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, scenario, durationMs: duration }));
        return;
      }

      // 3. Cancel Driver Countdown
      if (pathname === '/api/cancel' && method === 'POST') {
        const body = await parseJsonBody(req);
        const reason = body.reason || 'User cancelled via Dashboard button';
        const result = alertManager.cancelCountdown(reason);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // 4. Reset Simulator
      if (pathname === '/api/reset' && method === 'POST') {
        sensor.setScenario('NORMAL_DRIVING', 0);
        sensor.clearManualOverride();
        sensor.setSensorConnection(true);
        gps.setFixState(true);
        gps.setHardwareSignal(true);
        modem.setPower(true);
        modem.setRegistration(true);
        modem.setFailureInjection(false);
        modem.setSignalCSQ(22);
        alertManager.reset();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Simulator reset to initial baseline' }));
        return;
      }

      // 5. Fault Injection Control
      if (pathname === '/api/fault' && method === 'POST') {
        const body = await parseJsonBody(req);

        if (body.sensorConnected !== undefined) {
          sensor.setSensorConnection(body.sensorConnected);
        }
        if (body.gpsHasFix !== undefined) {
          gps.setFixState(body.gpsHasFix);
        }
        if (body.gpsStaleAgeSec !== undefined) {
          gps.setStaleAgeSec(body.gpsStaleAgeSec);
        }
        if (body.modemPower !== undefined) {
          modem.setPower(body.modemPower);
        }
        if (body.modemRegistered !== undefined) {
          modem.setRegistration(body.modemRegistered);
        }
        if (body.modemForceFailure !== undefined) {
          modem.setFailureInjection(body.modemForceFailure);
        }
        if (body.modemSignalCSQ !== undefined) {
          modem.setSignalCSQ(body.modemSignalCSQ);
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          sensorConnected: sensor.isConnected,
          gps: gps.getLocationStatus(),
          modem: modem.getStatus()
        }));
        return;
      }

      // 6. Manual Sensor Override
      if (pathname === '/api/manual_sensor' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (body.clear) {
          sensor.clearManualOverride();
        } else {
          sensor.setManualOverride(body);
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, isManual: sensor.isManualOverride }));
        return;
      }

      // 7. Update Threshold Config
      if (pathname === '/api/config' && method === 'POST') {
        const body = await parseJsonBody(req);
        detector.updateConfig(body);
        if (body.CANCELLATION_TIMEOUT_SEC !== undefined) {
          alertManager.config.CANCELLATION_TIMEOUT_SEC = Number(body.CANCELLATION_TIMEOUT_SEC);
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, detectorConfig: detector.config, alertConfig: alertManager.config }));
        return;
      }

      // 8. Execute Raw AT Command
      if (pathname === '/api/at_command' && method === 'POST') {
        const body = await parseJsonBody(req);
        const cmd = body.command || 'AT';
        const result = modem.executeAT(cmd);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // 9. Incident Logs
      if (pathname === '/api/logs' && method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({
          totalIncidents: alertManager.incidentHistory.length,
          incidents: alertManager.incidentHistory
        }));
        return;
      }

      if (pathname === '/api/logs' && method === 'DELETE') {
        alertManager.clearLogs();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Incident logs cleared' }));
        return;
      }

      // 10. Nearby Emergency Service Lookup
      if (pathname === '/api/nearby_services' && method === 'GET') {
        const lat = parseFloat(parsedUrl.query.lat) || gps.lat;
        const lng = parseFloat(parsedUrl.query.lng) || gps.lng;
        const result = lookup.lookupNearby(lat, lng);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'API route not found' }));
      return;
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // --- Static Web Assets ---
  const publicDir = path.join(__dirname, 'public');
  let targetPath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  let contentType = 'text/plain';
  if (ext === '.html') contentType = 'text/html';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.js') contentType = 'application/javascript';
  else if (ext === '.json') contentType = 'application/json';
  else if (ext === '.svg') contentType = 'image/svg+xml';

  serveStatic(res, targetPath, contentType);
});

// Export server instance for programmatic tests, or listen when executed directly
if (require.main === module) {
  server.listen(CONFIG.PORT, () => {
    console.log(`========================================================`);
    console.log(`  CrashSense PC Telematics Simulator Running`);
    console.log(`  URL: http://localhost:${CONFIG.PORT}`);
    console.log(`  Mode: Pure Standard Node.js Engine (Zero Dependencies)`);
    console.log(`========================================================`);
  });
}

module.exports = { server, sensor, detector, gps, modem, alertManager, lookup };

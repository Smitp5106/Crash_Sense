/**
 * CrashSense Automated Test Suite
 *
 * Verifies all 17 mandatory telematics scenarios defined in Section 7 of the specification:
 * 1. Normal movement -> No accident alert
 * 2. Sudden braking -> Candidate evaluated; no automatic assumption of a crash
 * 3. Pothole or bump -> False-alarm logic evaluated
 * 4. Sharp turn -> No automatic crash classification from tilt alone
 * 5. Simulated severe impact -> Candidate detection and countdown begin
 * 6. Button pressed during countdown -> Alert cancelled and logged
 * 7. Countdown expires -> Alert workflow starts
 * 8. GPS has no fix -> Alert reports unavailable location or approved stale-location handling
 * 9. GPS fix is stale -> Location clearly marked stale
 * 10. Modem unavailable -> Failure recorded; retry or fallback policy applied
 * 11. SMS succeeds -> Message status recorded as successful
 * 12. SMS fails -> Failure and retry behavior recorded
 * 13. Repeated trigger -> Duplicate alert prevention works
 * 14. Restart during incident -> State recovery follows documented behavior
 * 15. Network returns -> Recovery proceeds without duplicate alerts
 * 16. Sensor disconnected -> Fault is reported; no false claim of crash detection
 * 17. Nearby emergency-service lookup -> Discovers verified facilities safely
 */

const assert = require('assert');
const SensorEngine = require('../src/sensorEngine');
const AccidentDetector = require('../src/detector');
const GPSEngine = require('../src/gpsEngine');
const ModemEngine = require('../src/modemEngine');
const AlertManager = require('../src/alertManager');
const EmergencyLookup = require('../src/emergencyLookup');

function createTestHarness(customConfig = {}) {
  const sensor = new SensorEngine();
  const detector = new AccidentDetector({
    POST_IMPACT_STATIONARY_WINDOW_MS: 300, // Faster window for unit test speed
    POTHOLE_MAX_DURATION_MS: 80,
    CANCELLATION_TIMEOUT_SEC: 2,           // 2-second countdown for tests
    DEDUPLICATION_COOLDOWN_SEC: 3,
    ...customConfig
  });
  const gps = new GPSEngine(customConfig);
  const modem = new ModemEngine({
    MODEM_RETRY_LIMIT: 2,
    ...customConfig
  });
  modem.simulatedDelayMs = 10; // Fast for tests

  const alertManager = new AlertManager(sensor, detector, gps, modem, {
    CANCELLATION_TIMEOUT_SEC: 2,
    DEDUPLICATION_COOLDOWN_SEC: 3,
    LOG_JSONL_PATH: './logs/test_incidents.jsonl',
    LOG_CSV_PATH: './logs/test_incidents.csv',
    ...customConfig
  });

  const lookup = new EmergencyLookup();

  return { sensor, detector, gps, modem, alertManager, lookup };
}

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runScenarioTests() {
  const results = [];

  async function test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      const durationMs = Date.now() - start;
      results.push({ name, passed: true, durationMs, error: null });
    } catch (err) {
      const durationMs = Date.now() - start;
      results.push({ name, passed: false, durationMs, error: err.message });
    }
  }

  // --- Scenario 1: Normal Movement ---
  await test('Scenario 1: Normal Movement -> No accident alert', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('NORMAL_DRIVING', 500);

    for (let i = 0; i < 10; i++) {
      const sample = sensor.sample();
      const res = detector.processSample(sample);
      assert.strictEqual(res.classification, 'NORMAL_MOVEMENT');
      assert.strictEqual(alertManager.currentState, 'IDLE');
      assert.strictEqual(alertManager.buzzerActive, false);
      await sleep(10);
    }
  });

  // --- Scenario 2: Sudden Braking ---
  await test('Scenario 2: Sudden Braking -> Candidate evaluated; no automatic assumption of a crash', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('SUDDEN_BRAKING', 200);

    let hadCrashAlert = false;
    alertManager.on('state_changed', (t) => {
      if (t.currentState === 'COUNTDOWN' || t.currentState === 'SENT') hadCrashAlert = true;
    });

    for (let i = 0; i < 15; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(20);
    }

    assert.strictEqual(hadCrashAlert, false, 'Sudden braking must not trigger accident countdown or alert');
    assert.ok(alertManager.currentState === 'IDLE' || alertManager.currentState === 'CANDIDATE');
  });

  // --- Scenario 3: Pothole or Bump ---
  await test('Scenario 3: Pothole or Bump -> False-alarm logic evaluated', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('POTHOLE_BUMP', 300);

    let dismissedAsFalseAlarm = false;
    detector.on('candidate_dismissed', (d) => {
      if (d.classification === 'FALSE_ALARM') dismissedAsFalseAlarm = true;
    });

    for (let i = 0; i < 20; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
    }

    assert.strictEqual(alertManager.currentState, 'IDLE');
    assert.strictEqual(alertManager.buzzerActive, false);
    assert.strictEqual(dismissedAsFalseAlarm, true, 'Pothole must be classified and dismissed as FALSE_ALARM');
  });

  // --- Scenario 4: Sharp Turn ---
  await test('Scenario 4: Sharp Turn -> No automatic crash classification from tilt alone', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('SHARP_TURN', 250);

    for (let i = 0; i < 15; i++) {
      const sample = sensor.sample();
      const res = detector.processSample(sample);
      assert.notStrictEqual(res.classification, 'HIGH_SEVERITY_CANDIDATE');
      assert.notStrictEqual(res.classification, 'SUSPECTED_ACCIDENT');
      await sleep(15);
    }

    assert.strictEqual(alertManager.currentState, 'IDLE');
    assert.strictEqual(alertManager.buzzerActive, false);
  });

  // --- Scenario 5: Simulated Severe Impact ---
  await test('Scenario 5: Simulated Severe Impact -> Candidate detection and countdown begin', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('SIMULATED_CRASH', 500);

    let countdownStarted = false;
    alertManager.on('state_changed', (t) => {
      if (t.currentState === 'COUNTDOWN') countdownStarted = true;
    });

    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (countdownStarted) break;
    }

    assert.strictEqual(countdownStarted, true, 'Severe crash must trigger cancellation countdown');
    assert.strictEqual(alertManager.buzzerActive, true, 'Buzzer must be active during countdown');
    assert.ok(alertManager.activeIncident !== null);
    alertManager.reset();
  });

  // --- Scenario 6: Button Pressed During Countdown ---
  await test('Scenario 6: Button Pressed During Countdown -> Alert cancelled and logged', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('SIMULATED_CRASH', 500);

    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    assert.strictEqual(alertManager.currentState, 'COUNTDOWN');
    const cancelResult = alertManager.cancelCountdown('Driver physical push button pressed');
    assert.strictEqual(cancelResult.success, true);
    assert.strictEqual(alertManager.currentState, 'CANCELLED');
    assert.strictEqual(alertManager.buzzerActive, false);
    assert.strictEqual(cancelResult.incident.cancellation.cancelled, true);
    alertManager.reset();
  });

  // --- Scenario 7: Countdown Expires ---
  await test('Scenario 7: Countdown Expires -> Alert workflow starts and dispatches', async () => {
    const { sensor, detector, alertManager, modem } = createTestHarness();
    sensor.setScenario('SIMULATED_CRASH', 500);

    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    assert.strictEqual(alertManager.currentState, 'COUNTDOWN');
    // Wait for 2s countdown to expire and SMS to dispatch
    await sleep(2300);

    assert.strictEqual(alertManager.currentState, 'SENT');
    assert.strictEqual(modem.sentMessages.length >= 1, true);
    assert.strictEqual(modem.sentMessages[0].status, 'SENT');
    alertManager.reset();
  });

  // --- Scenario 8: GPS Has No Fix ---
  await test('Scenario 8: GPS Has No Fix -> Alert reports unavailable location', async () => {
    const { sensor, detector, alertManager, gps, modem } = createTestHarness();
    gps.setFixState(false);
    gps.lastValidFix = { lat: null, lng: null, timestamp: 0, mapUrl: null };

    sensor.setScenario('SIMULATED_CRASH', 500);
    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    await sleep(2300); // Wait for countdown to expire
    assert.strictEqual(alertManager.currentState, 'SENT');
    const sentMsg = modem.sentMessages[0];
    assert.ok(sentMsg.messageText.includes('GPS: NO_FIX'), 'SMS message must explicitly indicate GPS: NO_FIX');
    assert.ok(!sentMsg.messageText.includes('Map: https://maps.google.com/?q=0.000000,0.000000'), 'Never invent 0,0 map URL');
    alertManager.reset();
  });

  // --- Scenario 9: GPS Fix is Stale ---
  await test('Scenario 9: GPS Fix is Stale -> Location clearly marked stale', async () => {
    const { sensor, detector, alertManager, gps, modem } = createTestHarness();
    gps.setStaleAgeSec(150); // Fix is 150s old (threshold is 60s)

    sensor.setScenario('SIMULATED_CRASH', 500);
    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    await sleep(2300);
    assert.strictEqual(alertManager.currentState, 'SENT');
    const sentMsg = modem.sentMessages[0];
    assert.ok(sentMsg.messageText.includes('LAST KNOWN Loc'), 'Must label as LAST KNOWN Loc');
    assert.ok(sentMsg.messageText.includes('STALE'), 'Must explicitly label location as STALE');
    alertManager.reset();
  });

  // --- Scenario 10: Modem Unavailable ---
  await test('Scenario 10: Modem Unavailable -> Failure recorded; retry or fallback policy applied', async () => {
    const { sensor, detector, alertManager, modem } = createTestHarness();
    modem.setPower(false); // Modem hardware powered down

    sensor.setScenario('SIMULATED_CRASH', 500);
    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    await sleep(2300);
    assert.strictEqual(alertManager.currentState, 'FAILED');
    assert.strictEqual(alertManager.activeIncident.communication.smsStatus, 'FAILED');
    assert.strictEqual(alertManager.activeIncident.communication.error, 'MODEM_POWERED_OFF');
    alertManager.reset();
  });

  // --- Scenario 11: SMS Succeeds ---
  await test('Scenario 11: SMS Succeeds -> Message status recorded as successful', async () => {
    const { sensor, detector, alertManager, modem } = createTestHarness();
    sensor.setScenario('SIMULATED_CRASH', 500);

    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    await sleep(2300);
    assert.strictEqual(alertManager.currentState, 'SENT');
    assert.strictEqual(modem.sentMessages[0].status, 'SENT');
    assert.strictEqual(typeof modem.sentMessages[0].referenceId, 'number');
    alertManager.reset();
  });

  // --- Scenario 12: SMS Fails ---
  await test('Scenario 12: SMS Fails -> Failure and retry behavior recorded', async () => {
    const { sensor, detector, alertManager, modem } = createTestHarness();
    modem.setFailureInjection(true); // Force SIM7600 CMS ERROR 500

    sensor.setScenario('SIMULATED_CRASH', 500);
    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    await sleep(2500);
    assert.strictEqual(alertManager.currentState, 'FAILED');
    assert.strictEqual(alertManager.activeIncident.communication.smsStatus, 'FAILED');
    assert.strictEqual(alertManager.activeIncident.communication.smsAttempts, 2);
    alertManager.reset();
  });

  // --- Scenario 13: Repeated Trigger ---
  await test('Scenario 13: Repeated Trigger -> Duplicate alert prevention works', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('SIMULATED_CRASH', 500);

    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    const firstIncidentId = alertManager.activeIncident.incidentId;
    alertManager.cancelCountdown('Test cancellation');

    // Attempt second trigger immediately while in cooldown window
    let suppressed = false;
    alertManager.on('incident_suppressed', () => { suppressed = true; });

    sensor.setScenario('SIMULATED_CRASH', 500);
    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
    }

    assert.strictEqual(suppressed, true, 'Immediate subsequent trigger must be suppressed by cooldown deduplication');
    alertManager.reset();
  });

  // --- Scenario 14: Restart During Incident ---
  await test('Scenario 14: Restart During Incident -> State recovery follows documented behavior', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setScenario('SIMULATED_CRASH', 500);

    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    assert.strictEqual(alertManager.currentState, 'COUNTDOWN');
    // Simulate abrupt system reboot / brownout
    alertManager.reset();

    assert.strictEqual(alertManager.currentState, 'IDLE');
    assert.strictEqual(alertManager.buzzerActive, false);
    assert.strictEqual(alertManager.activeIncident, null);
    assert.strictEqual(detector.currentClassification, 'NORMAL_MOVEMENT');
  });

  // --- Scenario 15: Network Returns ---
  await test('Scenario 15: Network Returns -> Recovery proceeds without duplicate alerts', async () => {
    const { sensor, detector, alertManager, modem } = createTestHarness();
    modem.setRegistration(false); // Out of coverage

    sensor.setScenario('SIMULATED_CRASH', 500);
    for (let i = 0; i < 25; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(15);
      if (alertManager.currentState === 'COUNTDOWN') break;
    }

    await sleep(2400);
    assert.strictEqual(alertManager.currentState, 'FAILED');
    const failedIncidentCount = alertManager.incidentHistory.length;

    // Cellular network returns
    modem.setRegistration(true);

    // Normal driving resumes
    sensor.setScenario('NORMAL_DRIVING', 500);
    for (let i = 0; i < 10; i++) {
      const sample = sensor.sample();
      detector.processSample(sample);
      await sleep(10);
    }

    assert.strictEqual(alertManager.incidentHistory.length, failedIncidentCount, 'No duplicate alert sent after network restored');
    alertManager.reset();
  });

  // --- Scenario 16: Sensor Disconnected ---
  await test('Scenario 16: Sensor Disconnected -> Fault is reported; no false claim of crash detection', async () => {
    const { sensor, detector, alertManager } = createTestHarness();
    sensor.setSensorConnection(false); // Disconnect I2C bus

    const sample = sensor.sample();
    const result = detector.processSample(sample);

    assert.strictEqual(result.classification, 'SENSOR_FAULT');
    assert.strictEqual(alertManager.currentState, 'SENSOR_FAULT');
    assert.strictEqual(alertManager.buzzerActive, false);
    assert.strictEqual(alertManager.activeIncident, null, 'Never create an accident incident for sensor disconnect');
  });

  // --- Scenario 17: Emergency Service Lookup ---
  await test('Scenario 17: Emergency Service Lookup -> Discovers verified facilities safely', async () => {
    const { lookup } = createTestHarness();
    const sfLat = 37.7749;
    const sfLng = -122.4194;

    const res = lookup.lookupNearby(sfLat, sfLng, { maxRadiusKm: 15.0 });
    assert.strictEqual(res.success, true);
    assert.ok(res.totalFound >= 2, 'Should discover nearby verified mock facilities');
    assert.strictEqual(res.requiresApprovalBeforeContact, true);
    assert.ok(res.results.some(r => r.type.includes('HOSPITAL')));
    assert.ok(res.results.some(r => r.type.includes('AMBULANCE')));
  });

  return results;
}

module.exports = { runScenarioTests };

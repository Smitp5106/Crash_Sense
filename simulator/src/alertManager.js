/**
 * CrashSense Alert Manager
 *
 * Coordinates the master system state machine:
 * IDLE -> CANDIDATE -> COUNTDOWN -> ALERT_PENDING -> SENDING -> SENT / FAILED / CANCELLED
 *
 * Manages:
 * - Driver cancellation countdown with simulated buzzer.
 * - Deduplication and suppression of repeated vibration triggers.
 * - Integration with GPSEngine, ModemEngine, and EmergencyLookup.
 * - Persistent logging in JSON Lines (JSONL) and CSV formats.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class AlertManager extends EventEmitter {
  constructor(sensorEngine, detector, gpsEngine, modemEngine, config = {}) {
    super();
    this.sensorEngine = sensorEngine;
    this.detector = detector;
    this.gpsEngine = gpsEngine;
    this.modemEngine = modemEngine;

    this.config = {
      CANCELLATION_TIMEOUT_SEC: config.CANCELLATION_TIMEOUT_SEC ?? 15,
      DEDUPLICATION_COOLDOWN_SEC: config.DEDUPLICATION_COOLDOWN_SEC ?? 60,
      LOG_JSONL_PATH: config.LOG_JSONL_PATH ?? path.join(__dirname, '../logs/incidents.jsonl'),
      LOG_CSV_PATH: config.LOG_CSV_PATH ?? path.join(__dirname, '../logs/incidents.csv'),
      LOG_RETENTION_MAX_ENTRIES: config.LOG_RETENTION_MAX_ENTRIES ?? 500,
      DEFAULT_EMERGENCY_RECIPIENT: config.DEFAULT_EMERGENCY_RECIPIENT ?? "+15550192834",
      ...config
    };

    // State Machine
    this.currentState = 'IDLE'; // IDLE, CANDIDATE, COUNTDOWN, ALERT_PENDING, SENDING, SENT, FAILED, CANCELLED
    this.countdownRemainingSec = 0;
    this.countdownTimer = null;
    this.buzzerActive = false;

    // Active Incident Tracking
    this.activeIncident = null;
    this.lastTriggerTime = 0;
    this.incidentSequence = 1000;

    // Incident Memory & History
    this.incidentHistory = [];

    this._ensureLogDirectory();
    this._attachListeners();
  }

  _ensureLogDirectory() {
    const dir = path.dirname(this.config.LOG_JSONL_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Write CSV header if file doesn't exist
    if (!fs.existsSync(this.config.LOG_CSV_PATH)) {
      const header = 'Timestamp,IncidentID,Status,Severity,Reason,MagnitudeG,GyroDegS,GPS_Status,Latitude,Longitude,FixAgeSec,SMS_Status,SMS_Attempts\n';
      fs.writeFileSync(this.config.LOG_CSV_PATH, header, 'utf8');
    }
  }

  _attachListeners() {
    // Listen to detector events
    this.detector.on('candidate_started', (info) => {
      if (this.currentState === 'IDLE') {
        this.setState('CANDIDATE', info.reason);
      }
    });

    this.detector.on('candidate_dismissed', (info) => {
      if (this.currentState === 'CANDIDATE') {
        this.setState('IDLE', info.reason);
      }
    });

    this.detector.on('accident_detected', (details) => {
      this.handleAccidentDetected(details);
    });

    this.detector.on('classification_changed', (info) => {
      if (info.classification === 'SENSOR_FAULT' && this.currentState !== 'COUNTDOWN' && this.currentState !== 'SENDING') {
        this.setState('SENSOR_FAULT', info.reason);
      }
    });
  }

  setState(newState, reason = '') {
    const previousState = this.currentState;
    this.currentState = newState;

    if (newState === 'COUNTDOWN') {
      this.buzzerActive = true;
    } else if (newState === 'IDLE' || newState === 'CANCELLED' || newState === 'SENT' || newState === 'FAILED') {
      this.buzzerActive = false;
    }

    const transition = {
      timestamp: Date.now(),
      previousState,
      currentState: newState,
      reason,
      buzzerActive: this.buzzerActive,
      countdownRemainingSec: this.countdownRemainingSec
    };

    this.emit('state_changed', transition);
    return transition;
  }

  handleAccidentDetected(details) {
    const now = Date.now();

    // Deduplication check: prevent repeated collision triggers within cooldown period
    if (now - this.lastTriggerTime < (this.config.DEDUPLICATION_COOLDOWN_SEC * 1000)) {
      this.emit('incident_suppressed', {
        reason: 'Deduplication cooldown active. Repeated trigger ignored.',
        elapsedSec: Math.floor((now - this.lastTriggerTime) / 1000)
      });
      return;
    }

    // Check if an incident is already in progress
    if (this.currentState === 'COUNTDOWN' || this.currentState === 'SENDING') {
      return;
    }

    this.lastTriggerTime = now;
    this.incidentSequence++;
    const incidentId = `INC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${this.incidentSequence}`;

    const locationInfo = this.gpsEngine.getLocationStatus();

    this.activeIncident = {
      incidentId,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      status: 'COUNTDOWN',
      severity: details.severity || 'HIGH',
      reason: details.reason,
      telemetry: {
        peakMagnitude: details.peakMagnitude,
        peakGyro: details.peakGyro,
        peakJerk: details.peakJerk,
        rollDelta: details.rollDelta
      },
      location: locationInfo,
      cancellation: {
        cancelled: false,
        cancelledAt: null,
        reason: null
      },
      communication: {
        smsStatus: 'PENDING',
        smsAttempts: 0,
        voiceStatus: 'NOT_INITIATED',
        error: null
      }
    };

    this.countdownRemainingSec = this.config.CANCELLATION_TIMEOUT_SEC;
    this.setState('COUNTDOWN', `Suspected accident detected: ${details.reason}. Countdown started.`);

    // Start 1-second countdown ticker
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      this.countdownRemainingSec--;
      this.emit('countdown_tick', {
        remainingSec: this.countdownRemainingSec,
        incidentId: this.activeIncident.incidentId
      });

      if (this.countdownRemainingSec <= 0) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.executeAlertDispatch();
      }
    }, 1000);
  }

  cancelCountdown(reason = 'Driver physical button pressed') {
    if (this.currentState !== 'COUNTDOWN' || !this.activeIncident) {
      return { success: false, message: 'No active countdown to cancel' };
    }

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.activeIncident.status = 'CANCELLED';
    this.activeIncident.cancellation = {
      cancelled: true,
      cancelledAt: Date.now(),
      reason
    };

    this.setState('CANCELLED', `False alarm cancelled by driver: ${reason}`);
    this._persistIncident(this.activeIncident);

    const cancelledIncident = { ...this.activeIncident };
    // Cooldown reset after short delay
    setTimeout(() => {
      if (this.currentState === 'CANCELLED') {
        this.setState('IDLE', 'System returned to normal monitoring.');
        this.activeIncident = null;
      }
    }, 2000);

    return { success: true, incident: cancelledIncident };
  }

  async executeAlertDispatch() {
    if (!this.activeIncident) return;

    this.setState('ALERT_PENDING', 'Countdown expired. Preparing emergency message packet.');
    this.setState('SENDING', 'Dispatching emergency alert via 4G LTE modem...');

    // Refresh current GPS status
    const locStatus = this.gpsEngine.getLocationStatus();
    this.activeIncident.location = locStatus;

    // Compose emergency alert message
    const alertText = this._composeAlertSMS(this.activeIncident);

    // Dispatch SMS via Modem Engine
    const smsResult = await this.modemEngine.sendSMS(
      this.config.DEFAULT_EMERGENCY_RECIPIENT,
      alertText,
      { retryLimit: this.config.MODEM_RETRY_LIMIT }
    );

    this.activeIncident.communication.smsStatus = smsResult.status;
    this.activeIncident.communication.smsAttempts = smsResult.attempts;
    this.activeIncident.communication.error = smsResult.error || null;

    if (smsResult.success) {
      this.activeIncident.status = 'SENT';
      this.setState('SENT', `Emergency alert successfully delivered via SMS (Ref: ${smsResult.referenceId}).`);

      // Mock voice escalation initiation
      const voiceResult = await this.modemEngine.initiateVoiceCall(this.config.DEFAULT_EMERGENCY_RECIPIENT);
      this.activeIncident.communication.voiceStatus = voiceResult.status;
    } else {
      this.activeIncident.status = 'FAILED';
      this.setState('FAILED', `Emergency alert transmission failed: ${smsResult.error}`);
    }

    this._persistIncident(this.activeIncident);
    this.emit('incident_completed', this.activeIncident);
  }

  _composeAlertSMS(incident) {
    const id = incident.incidentId;
    const severity = incident.severity;
    const loc = incident.location;

    let locString = "GPS: NO_FIX (Searching satellites)";
    let mapLink = "";

    if (loc.status === 'VALID_FIX' && loc.location) {
      locString = `Loc: ${loc.location.lat.toFixed(5)}, ${loc.location.lng.toFixed(5)}`;
      mapLink = `\nMap: ${loc.location.mapUrl}`;
    } else if (loc.status === 'STALE_FIX' && loc.location) {
      locString = `LAST KNOWN Loc: ${loc.location.lat.toFixed(5)}, ${loc.location.lng.toFixed(5)} (STALE, Age: ${loc.location.fixAgeSec}s)`;
      mapLink = `\nMap: ${loc.location.mapUrl}`;
    }

    return `CRASHSENSE ALERT!\nID:${id}\nSev:${severity}\nPeak:${incident.telemetry.peakMagnitude.toFixed(1)}g\n${locString}${mapLink}\nDriver unresp.`;
  }

  _persistIncident(incident) {
    this.incidentHistory.unshift(incident);
    if (this.incidentHistory.length > this.config.LOG_RETENTION_MAX_ENTRIES) {
      this.incidentHistory.pop();
    }

    // 1. JSON Lines
    try {
      const line = JSON.stringify(incident) + '\n';
      fs.appendFileSync(this.config.LOG_JSONL_PATH, line, 'utf8');
    } catch (err) {
      console.error('Failed to append to incidents.jsonl:', err.message);
    }

    // 2. CSV
    try {
      const lat = incident.location?.location?.lat ?? 'N/A';
      const lng = incident.location?.location?.lng ?? 'N/A';
      const fixAge = incident.location?.location?.fixAgeSec ?? 'N/A';
      const csvRow = `"${incident.isoTime}","${incident.incidentId}","${incident.status}","${incident.severity}","${incident.reason.replace(/"/g, '""')}","${incident.telemetry.peakMagnitude}","${incident.telemetry.peakGyro}","${incident.location?.status}","${lat}","${lng}","${fixAge}","${incident.communication?.smsStatus}","${incident.communication?.smsAttempts}"\n`;
      fs.appendFileSync(this.config.LOG_CSV_PATH, csvRow, 'utf8');
    } catch (err) {
      console.error('Failed to append to incidents.csv:', err.message);
    }
  }

  clearLogs() {
    this.incidentHistory = [];
    try {
      if (fs.existsSync(this.config.LOG_JSONL_PATH)) fs.unlinkSync(this.config.LOG_JSONL_PATH);
      if (fs.existsSync(this.config.LOG_CSV_PATH)) fs.unlinkSync(this.config.LOG_CSV_PATH);
      this._ensureLogDirectory();
    } catch (e) {
      console.error('Error clearing logs:', e.message);
    }
  }

  reset() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.currentState = 'IDLE';
    this.countdownRemainingSec = 0;
    this.buzzerActive = false;
    this.activeIncident = null;
    this.detector.reset();
    this.emit('state_changed', {
      timestamp: Date.now(),
      previousState: 'RESET',
      currentState: 'IDLE',
      reason: 'Full system reset executed.',
      buzzerActive: false,
      countdownRemainingSec: 0
    });
  }
}

module.exports = AlertManager;


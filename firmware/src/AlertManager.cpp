#include "AlertManager.h"

AlertManager::AlertManager(AccidentDetector& detector, GPSManager& gps, SIM7600_Modem& modem)
    : _detector(detector),
      _gps(gps),
      _modem(modem),
      _state(STATE_IDLE),
      _countdownStartMs(0),
      _lastTriggerMs(0),
      _incidentCounter(100),
      _lastBuzzerToggleMs(0),
      _buzzerState(false),
      _lastLedToggleMs(0),
      _ledState(false),
      _lastButtonCheckMs(0),
      _lastButtonState(HIGH) {
    memset(&_activeIncident, 0, sizeof(_activeIncident));
}

void AlertManager::begin() {
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);

    pinMode(PIN_BUTTON_CANCEL, INPUT_PULLUP);

    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, LOW);
}

void AlertManager::transitionTo(SystemState newState, const char* logReason) {
    SystemState oldState = _state;
    _state = newState;

    Serial.printf("[STATE] %s -> %s | Reason: %s\r\n",
                  systemStateToString(oldState),
                  systemStateToString(newState),
                  logReason);

    if (newState != STATE_COUNTDOWN) {
        digitalWrite(PIN_BUZZER, LOW);
        _buzzerState = false;
    }
}

uint32_t AlertManager::getCountdownRemainingSec() const {
    if (_state != STATE_COUNTDOWN) return 0;
    uint32_t elapsed = millis() - _countdownStartMs;
    if (elapsed >= CANCELLATION_TIMEOUT_MS) return 0;
    return (CANCELLATION_TIMEOUT_MS - elapsed) / 1000;
}

void AlertManager::triggerAccident(const DetectionOutcome& outcome) {
    uint32_t now = millis();

    // Deduplication check
    if (now - _lastTriggerMs < DEDUPLICATION_COOLDOWN_MS) {
        Serial.println("[ALERT] Repeated impact trigger suppressed by cooldown logic.");
        return;
    }

    if (_state == STATE_COUNTDOWN || _state == STATE_SENDING) {
        return;
    }

    _lastTriggerMs = now;
    _incidentCounter++;

    snprintf(_activeIncident.incidentId, sizeof(_activeIncident.incidentId), "INC-%lu-%lu", (unsigned long)(now / 1000), (unsigned long)_incidentCounter);
    _activeIncident.timestampMs = now;
    _activeIncident.state = STATE_COUNTDOWN;
    _activeIncident.severity = outcome.isHighSeverity ? "HIGH" : "MEDIUM";
    _activeIncident.reason = outcome.reason;
    _activeIncident.peakMagnitude = outcome.peakMagnitude;
    _activeIncident.peakGyro = outcome.peakGyro;
    _activeIncident.peakJerk = outcome.peakJerk;
    _activeIncident.rollDelta = outcome.rollDelta;
    _activeIncident.location = _gps.getLocation();
    _activeIncident.smsSent = false;
    _activeIncident.retries = 0;

    _countdownStartMs = now;
    transitionTo(STATE_COUNTDOWN, "Suspected collision verified. Countdown ticker active.");
}

bool AlertManager::cancelCountdown(const char* reason) {
    if (_state != STATE_COUNTDOWN) {
        return false;
    }

    _activeIncident.state = STATE_CANCELLED;
    transitionTo(STATE_CANCELLED, reason);

    digitalWrite(PIN_BUZZER, LOW);
    _buzzerState = false;

    // Return to IDLE after brief hold
    delay(100);
    transitionTo(STATE_IDLE, "System resumed normal operation.");
    return true;
}

void AlertManager::composeAlertSMS(const IncidentRecord& incident, char* outBuffer, size_t maxLen) {
    char locBuf[80];
    if (incident.location.fixState == GPS_VALID_FIX) {
        snprintf(locBuf, sizeof(locBuf), "Loc: %.5f, %.5f\nMap: %s",
                 incident.location.latitude,
                 incident.location.longitude,
                 incident.location.mapUrl);
    } else if (incident.location.fixState == GPS_STALE_FIX) {
        uint32_t ageSec = (millis() - incident.location.fixTimestampMs) / 1000;
        snprintf(locBuf, sizeof(locBuf), "LAST KNOWN Loc: %.5f, %.5f (STALE, Age: %lus)\nMap: %s",
                 incident.location.latitude,
                 incident.location.longitude,
                 (unsigned long)ageSec,
                 incident.location.mapUrl);
    } else {
        snprintf(locBuf, sizeof(locBuf), "GPS: NO_FIX (Searching satellites)");
    }

    snprintf(outBuffer, maxLen,
             "CRASHSENSE ALERT!\nID:%s\nSev:%s\nPeak:%.1fg\n%s\nDriver unresp.",
             incident.incidentId,
             incident.severity,
             incident.peakMagnitude,
             locBuf);
}

void AlertManager::executeDispatch() {
    transitionTo(STATE_ALERT_PENDING, "Countdown expired. Formatting emergency telemetry packet.");
    transitionTo(STATE_SENDING, "Dispatching cellular alert via SIM7600...");

    // Refresh location
    _activeIncident.location = _gps.getLocation();

    char smsMessage[200];
    composeAlertSMS(_activeIncident, smsMessage, sizeof(smsMessage));

    Serial.println("----------------------------------------");
    Serial.println("[CELLULAR DISPATCH PAYLOAD]");
    Serial.println(smsMessage);
    Serial.println("----------------------------------------");

    bool sent = _modem.sendSMS(DEFAULT_TEST_RECIPIENT, smsMessage, MODEM_RETRY_LIMIT);

    if (sent) {
        _activeIncident.smsSent = true;
        _activeIncident.state = STATE_SENT;
        transitionTo(STATE_SENT, "Emergency alert SMS successfully delivered.");

        // Safe mock voice call escalation
        _modem.initiateMockVoiceCall(DEFAULT_TEST_RECIPIENT);
    } else {
        _activeIncident.smsSent = false;
        _activeIncident.state = STATE_FAILED;
        transitionTo(STATE_FAILED, "Modem SMS dispatch failed after retry limit.");
    }
}

void AlertManager::checkCancelButton() {
    uint32_t now = millis();
    if (now - _lastButtonCheckMs < 50) return; // 50ms debounce
    _lastButtonCheckMs = now;

    bool currentButtonState = digitalRead(PIN_BUTTON_CANCEL);
    if (_lastButtonState == HIGH && currentButtonState == LOW) {
        // Falling edge detected (button pressed)
        if (_state == STATE_COUNTDOWN) {
            cancelCountdown("Physical push button pressed by driver");
        }
    }
    _lastButtonState = currentButtonState;
}

void AlertManager::updateBuzzerAndLed() {
    uint32_t now = millis();

    // 1. Buzzer acoustic feedback during countdown (200ms ON / 200ms OFF)
    if (_state == STATE_COUNTDOWN) {
        if (now - _lastBuzzerToggleMs >= 200) {
            _lastBuzzerToggleMs = now;
            _buzzerState = !_buzzerState;
            digitalWrite(PIN_BUZZER, _buzzerState ? HIGH : LOW);
        }
    } else {
        if (_buzzerState) {
            _buzzerState = false;
            digitalWrite(PIN_BUZZER, LOW);
        }
    }

    // 2. LED Status Patterns
    uint32_t blinkInterval = 1000;
    if (_state == STATE_COUNTDOWN) blinkInterval = 150;
    else if (_state == STATE_SENDING) blinkInterval = 50;
    else if (_state == STATE_SENSOR_FAULT) blinkInterval = 300;

    if (now - _lastLedToggleMs >= blinkInterval) {
        _lastLedToggleMs = now;
        _ledState = !_ledState;
        digitalWrite(PIN_STATUS_LED, _ledState ? HIGH : LOW);
    }
}

void AlertManager::update() {
    checkCancelButton();
    updateBuzzerAndLed();

    // Check Countdown expiration
    if (_state == STATE_COUNTDOWN) {
        if (millis() - _countdownStartMs >= CANCELLATION_TIMEOUT_MS) {
            executeDispatch();
        }
    }
}

void AlertManager::reset() {
    _state = STATE_IDLE;
    digitalWrite(PIN_BUZZER, LOW);
    _buzzerState = false;
    _detector.reset();
    transitionTo(STATE_IDLE, "Full firmware reset executed.");
}

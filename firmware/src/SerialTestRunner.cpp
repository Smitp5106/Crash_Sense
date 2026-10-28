#include "SerialTestRunner.h"

SerialTestRunner::SerialTestRunner(AccidentDetector& detector, AlertManager& alertManager, GPSManager& gps, SIM7600_Modem& modem)
    : _detector(detector),
      _alertManager(alertManager),
      _gps(gps),
      _modem(modem),
      _mockActive(false),
      _mockStartTime(0),
      _mockDurationMs(0),
      _mockScenario(""),
      _inputIndex(0) {
    memset(&_mockFrame, 0, sizeof(_mockFrame));
}

void SerialTestRunner::begin() {
    printHelp();
}

void SerialTestRunner::printHelp() {
    Serial.println("\r\n========================================================");
    Serial.println("  CrashSense Interactive ESP32 Serial Test Console");
    Serial.println("========================================================");
    Serial.println("Commands:");
    Serial.println("  CRASH     - Simulate severe vehicular impact (4.5g, 220 deg/s)");
    Serial.println("  ROLLOVER  - Simulate vehicle rollover (320 deg/s, 80 deg roll)");
    Serial.println("  BRAKE     - Simulate hard braking (-1.6g, low gyro)");
    Serial.println("  POTHOLE   - Simulate transient bump/pothole (2.4g, <120ms)");
    Serial.println("  CANCEL    - Simulate pressing driver cancel button");
    Serial.println("  GPS_FIX   - Inject valid GPS coordinates (37.7749, -122.4194)");
    Serial.println("  GPS_LOST  - Simulate GPS signal loss (0 satellites)");
    Serial.println("  STATUS    - Print full diagnostic status");
    Serial.println("  RESET     - Reset firmware to clean baseline");
    Serial.println("  HELP      - Display this command menu");
    Serial.println("========================================================\r\n");
}

void SerialTestRunner::triggerMockScenario(const char* name, float ax, float ay, float az, float gx, float gy, float gz, uint32_t durationMs) {
    _mockActive = true;
    _mockStartTime = millis();
    _mockDurationMs = durationMs;
    _mockScenario = name;

    _mockFrame.isValid = true;
    _mockFrame.timestampMs = millis();
    _mockFrame.ax = ax;
    _mockFrame.ay = ay;
    _mockFrame.az = az;
    _mockFrame.gx = gx;
    _mockFrame.gy = gy;
    _mockFrame.gz = gz;
    _mockFrame.magnitude = sqrtf(ax*ax + ay*ay + az*az);
    _mockFrame.gyroMagnitude = sqrtf(gx*gx + gy*gy + gz*gz);
    _mockFrame.jerk = 25.0f;
    _mockFrame.pitch = atan2f(ax, sqrtf(ay*ay + az*az)) * (180.0f / PI);
    _mockFrame.roll = atan2f(ay, sqrtf(ax*ax + az*az)) * (180.0f / PI);

    Serial.printf("[MOCK] Injected scenario '%s' (Mag: %.2fg, Gyro: %.1f deg/s, Dur: %lums)\r\n",
                  name, _mockFrame.magnitude, _mockFrame.gyroMagnitude, (unsigned long)durationMs);
}

void SerialTestRunner::printStatus() {
    GPSLocation loc = _gps.getLocation();
    ModemDiagnostics mod = _modem.getDiagnostics();

    Serial.println("\r\n--- CRASHSENSE SYSTEM STATUS ---");
    Serial.printf("System State:       %s\r\n", systemStateToString(_alertManager.getState()));
    Serial.printf("Classification:     %s\r\n", classificationToString(_detector.getCurrentClassification()));
    if (_alertManager.getState() == STATE_COUNTDOWN) {
        Serial.printf("Countdown Left:     %lu sec\r\n", (unsigned long)_alertManager.getCountdownRemainingSec());
    }
    Serial.printf("GPS Status:         %s (Sats: %u, HDOP: %.2f)\r\n", gpsFixStateToString(loc.fixState), loc.satellites, loc.hdop);
    if (loc.hasFix) {
        Serial.printf("Coordinates:        %.6f, %.6f\r\n", loc.latitude, loc.longitude);
        Serial.printf("Map URL:            %s\r\n", loc.mapUrl);
    }
    Serial.printf("SIM7600 Modem:      Power=%s, SIM=%s, Reg=%s, CSQ=%u\r\n",
                  mod.isPowered ? "ON" : "OFF",
                  mod.isSimReady ? "READY" : "NO",
                  mod.isNetworkRegistered ? "YES" : "NO",
                  mod.signalCSQ);
    Serial.printf("SMS Total:          Sent=%u, Failed=%u\r\n", mod.totalSmsSent, mod.totalSmsFailed);
    Serial.println("--------------------------------\r\n");
}

void SerialTestRunner::processCommand(const char* cmd) {
    if (strcasecmp(cmd, "CRASH") == 0) {
        triggerMockScenario("Severe Collision", -4.2f, 2.1f, 2.8f, 210.0f, -180.0f, 240.0f, 600);
    } else if (strcasecmp(cmd, "ROLLOVER") == 0) {
        triggerMockScenario("Rollover Event", 1.8f, 3.2f, 2.2f, 320.0f, 140.0f, 180.0f, 800);
    } else if (strcasecmp(cmd, "BRAKE") == 0) {
        triggerMockScenario("Hard Braking", -1.6f, 0.05f, 1.05f, 5.0f, -12.0f, 4.0f, 800);
    } else if (strcasecmp(cmd, "POTHOLE") == 0) {
        triggerMockScenario("Road Pothole", 0.1f, 0.1f, 2.45f, 15.0f, 12.0f, 10.0f, 90);
    } else if (strcasecmp(cmd, "CANCEL") == 0) {
        bool ok = _alertManager.cancelCountdown("Serial console driver cancel button command");
        Serial.println(ok ? "[MOCK] Countdown CANCELLED successfully." : "[MOCK] No active countdown to cancel.");
    } else if (strcasecmp(cmd, "GPS_FIX") == 0) {
        _gps.injectMockLocation(37.774929, -122.419416, 8);
        Serial.println("[MOCK] Injected valid GPS fix (37.774929, -122.419416, 8 sats).");
    } else if (strcasecmp(cmd, "GPS_LOST") == 0) {
        _gps.injectMockLocation(0, 0, 0);
        Serial.println("[MOCK] Simulated GPS signal loss.");
    } else if (strcasecmp(cmd, "STATUS") == 0) {
        printStatus();
    } else if (strcasecmp(cmd, "RESET") == 0) {
        _mockActive = false;
        _alertManager.reset();
        Serial.println("[MOCK] System reset completed.");
    } else if (strcasecmp(cmd, "HELP") == 0) {
        printHelp();
    } else {
        Serial.printf("[MOCK] Unknown command '%s'. Type HELP for menu.\r\n", cmd);
    }
}

void SerialTestRunner::update() {
    // Check if mock scenario duration has elapsed
    if (_mockActive) {
        if (millis() - _mockStartTime >= _mockDurationMs) {
            _mockActive = false;
            Serial.printf("[MOCK] Scenario '%s' concluded. Returning to sensor hardware.\r\n", _mockScenario);
        }
    }

    // Read USB Serial characters non-blockingly
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\r') continue;
        if (c == '\n') {
            _inputBuffer[_inputIndex] = '\0';
            if (_inputIndex > 0) {
                processCommand(_inputBuffer);
            }
            _inputIndex = 0;
        } else if (_inputIndex < sizeof(_inputBuffer) - 1) {
            _inputBuffer[_inputIndex++] = c;
        }
    }
}

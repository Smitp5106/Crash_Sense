#ifndef CRASHSENSE_SERIAL_TEST_RUNNER_H
#define CRASHSENSE_SERIAL_TEST_RUNNER_H

#include <Arduino.h>
#include "types.h"
#include "AccidentDetector.h"
#include "AlertManager.h"
#include "GPSManager.h"
#include "SIM7600_Modem.h"

class SerialTestRunner {
public:
    SerialTestRunner(AccidentDetector& detector, AlertManager& alertManager, GPSManager& gps, SIM7600_Modem& modem);
    void begin();
    void update();
    bool isMockActive() const { return _mockActive; }
    SensorFrame getMockFrame() const { return _mockFrame; }

private:
    AccidentDetector& _detector;
    AlertManager& _alertManager;
    GPSManager& _gps;
    SIM7600_Modem& _modem;

    bool _mockActive;
    SensorFrame _mockFrame;
    uint32_t _mockStartTime;
    uint32_t _mockDurationMs;
    const char* _mockScenario;

    char _inputBuffer[64];
    uint8_t _inputIndex;

    void processCommand(const char* cmd);
    void printHelp();
    void printStatus();
    void triggerMockScenario(const char* name, float ax, float ay, float az, float gx, float gy, float gz, uint32_t durationMs);
};

#endif // CRASHSENSE_SERIAL_TEST_RUNNER_H

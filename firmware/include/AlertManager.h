#ifndef CRASHSENSE_ALERT_MANAGER_H
#define CRASHSENSE_ALERT_MANAGER_H

#include <Arduino.h>
#include "types.h"
#include "config.h"
#include "AccidentDetector.h"
#include "GPSManager.h"
#include "SIM7600_Modem.h"

class AlertManager {
public:
    AlertManager(AccidentDetector& detector, GPSManager& gps, SIM7600_Modem& modem);
    void begin();
    void update();

    void triggerAccident(const DetectionOutcome& outcome);
    bool cancelCountdown(const char* reason = "Driver physical button pressed");
    void reset();

    SystemState getState() const { return _state; }
    uint32_t getCountdownRemainingSec() const;
    const IncidentRecord& getActiveIncident() const { return _activeIncident; }

private:
    AccidentDetector& _detector;
    GPSManager& _gps;
    SIM7600_Modem& _modem;

    SystemState _state;
    uint32_t _countdownStartMs;
    uint32_t _lastTriggerMs;
    uint32_t _incidentCounter;
    IncidentRecord _activeIncident;

    // Non-blocking Buzzer and LED state
    uint32_t _lastBuzzerToggleMs;
    bool _buzzerState;
    uint32_t _lastLedToggleMs;
    bool _ledState;

    // Debounced button
    uint32_t _lastButtonCheckMs;
    bool _lastButtonState;

    void updateBuzzerAndLed();
    void checkCancelButton();
    void executeDispatch();
    void composeAlertSMS(const IncidentRecord& incident, char* outBuffer, size_t maxLen);
    void transitionTo(SystemState newState, const char* logReason);
};

#endif // CRASHSENSE_ALERT_MANAGER_H

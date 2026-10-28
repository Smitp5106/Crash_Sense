#include "AccidentDetector.h"

AccidentDetector::AccidentDetector()
    : _currentClassification(CLASS_NORMAL),
      _candidateActive(false),
      _candidateStartTimeMs(0),
      _peakMagnitude(0.0f),
      _peakJerk(0.0f),
      _peakGyro(0.0f),
      _baselineRoll(0.0f),
      _baselinePitch(0.0f) {}

void AccidentDetector::reset() {
    _currentClassification = CLASS_NORMAL;
    _candidateActive = false;
    _candidateStartTimeMs = 0;
    _peakMagnitude = 0.0f;
    _peakJerk = 0.0f;
    _peakGyro = 0.0f;
}

DetectionOutcome AccidentDetector::processSample(const SensorFrame& frame) {
    DetectionOutcome outcome;
    outcome.classification = CLASS_NORMAL;
    outcome.reason = "Normal movement";
    outcome.peakMagnitude = frame.magnitude;
    outcome.peakGyro = frame.gyroMagnitude;
    outcome.peakJerk = frame.jerk;
    outcome.rollDelta = 0.0f;
    outcome.isConfirmedAccident = false;
    outcome.isHighSeverity = false;

    // 1. Sensor Health Check - Never treat disconnected/invalid sensor as an accident
    if (!frame.isValid || isnan(frame.magnitude)) {
        _currentClassification = CLASS_SENSOR_FAULT;
        _candidateActive = false;
        outcome.classification = CLASS_SENSOR_FAULT;
        outcome.reason = "I2C Sensor Disconnected or Invalid Data";
        return outcome;
    }

    if (_currentClassification == CLASS_SENSOR_FAULT && frame.isValid) {
        _currentClassification = CLASS_NORMAL;
    }

    uint32_t now = frame.timestampMs;

    // 2. Active Verification Window
    if (_candidateActive) {
        uint32_t elapsed = now - _candidateStartTimeMs;
        if (frame.magnitude > _peakMagnitude) _peakMagnitude = frame.magnitude;
        if (frame.jerk > _peakJerk) _peakJerk = frame.jerk;
        if (frame.gyroMagnitude > _peakGyro) _peakGyro = frame.gyroMagnitude;

        float rollDelta = fabsf(frame.roll - _baselineRoll);
        bool isRolloverAttitude = rollDelta >= TILT_CHANGE_THRESHOLD_DEG;

        // Check for transient bump / pothole (< 120ms shock, low gyro, normal resumption)
        if (elapsed > POTHOLE_MAX_DURATION_MS && elapsed < 400) {
            bool isTransientShock = (_peakGyro < (GYRO_MAG_THRESHOLD_DEG_S * 0.5f)) &&
                                    (frame.magnitude < 1.35f) &&
                                    (rollDelta < 15.0f);
            if (isTransientShock) {
                _candidateActive = false;
                _currentClassification = CLASS_FALSE_ALARM;
                outcome.classification = CLASS_FALSE_ALARM;
                outcome.reason = "Transient road pothole/bump dismissed";
                outcome.peakMagnitude = _peakMagnitude;
                outcome.peakGyro = _peakGyro;
                return outcome;
            }
        }

        // Verification Window Expiration
        if (elapsed >= POST_IMPACT_STATIONARY_MS || (isRolloverAttitude && elapsed >= 600)) {
            _candidateActive = false;

            bool hasSevereAcceleration = _peakMagnitude >= ACCEL_MAG_THRESHOLD_G;
            bool hasRotationalTumble = _peakGyro >= GYRO_MAG_THRESHOLD_DEG_S;

            if (hasSevereAcceleration && (hasRotationalTumble || isRolloverAttitude)) {
                bool highSeverity = (_peakMagnitude >= (ACCEL_MAG_THRESHOLD_G * 1.3f)) || isRolloverAttitude;
                _currentClassification = highSeverity ? CLASS_HIGH_SEVERITY : CLASS_SUSPECTED_ACCIDENT;

                outcome.classification = _currentClassification;
                outcome.isConfirmedAccident = true;
                outcome.isHighSeverity = highSeverity;
                outcome.peakMagnitude = _peakMagnitude;
                outcome.peakGyro = _peakGyro;
                outcome.peakJerk = _peakJerk;
                outcome.rollDelta = rollDelta;
                outcome.reason = isRolloverAttitude ? "Vehicle Rollover Confirmed" : "High-G Vehicular Collision Confirmed";
                return outcome;
            } else {
                // Evaluated as False Alarm (e.g. hard braking or rough road vibration)
                _currentClassification = CLASS_FALSE_ALARM;
                outcome.classification = CLASS_FALSE_ALARM;
                outcome.reason = "False alarm: Lacked rotational tumble or post-impact stoppage";
                outcome.peakMagnitude = _peakMagnitude;
                outcome.peakGyro = _peakGyro;
                return outcome;
            }
        }

        outcome.classification = CLASS_POSSIBLE_IMPACT;
        outcome.reason = "Evaluating collision kinematics...";
        outcome.peakMagnitude = _peakMagnitude;
        return outcome;
    }

    // 3. Stage 1 Candidate Trigger Check
    bool isTrigger = (frame.magnitude >= ACCEL_MAG_THRESHOLD_G) ||
                     (frame.jerk >= ACCEL_JERK_THRESHOLD_G_PER_S && frame.magnitude >= 2.4f);

    if (isTrigger) {
        _candidateActive = true;
        _candidateStartTimeMs = now;
        _peakMagnitude = frame.magnitude;
        _peakJerk = frame.jerk;
        _peakGyro = frame.gyroMagnitude;
        _baselineRoll = frame.roll;
        _baselinePitch = frame.pitch;

        _currentClassification = CLASS_POSSIBLE_IMPACT;
        outcome.classification = CLASS_POSSIBLE_IMPACT;
        outcome.reason = "Kinematic candidate shock detected. Initiating verification.";
        outcome.peakMagnitude = _peakMagnitude;
        return outcome;
    }

    _currentClassification = CLASS_NORMAL;
    outcome.classification = CLASS_NORMAL;
    outcome.reason = "Within safe operational thresholds";
    return outcome;
}

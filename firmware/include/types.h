#ifndef CRASHSENSE_TYPES_H
#define CRASHSENSE_TYPES_H

#include <Arduino.h>

enum SystemState {
    STATE_IDLE,
    STATE_CANDIDATE,
    STATE_COUNTDOWN,
    STATE_ALERT_PENDING,
    STATE_SENDING,
    STATE_SENT,
    STATE_FAILED,
    STATE_CANCELLED,
    STATE_SENSOR_FAULT
};

inline const char* systemStateToString(SystemState state) {
    switch (state) {
        case STATE_IDLE:          return "IDLE";
        case STATE_CANDIDATE:     return "CANDIDATE";
        case STATE_COUNTDOWN:     return "COUNTDOWN";
        case STATE_ALERT_PENDING: return "ALERT_PENDING";
        case STATE_SENDING:       return "SENDING";
        case STATE_SENT:          return "SENT";
        case STATE_FAILED:        return "FAILED";
        case STATE_CANCELLED:     return "CANCELLED";
        case STATE_SENSOR_FAULT:  return "SENSOR_FAULT";
        default:                  return "UNKNOWN";
    }
}

enum ClassificationType {
    CLASS_NORMAL,
    CLASS_POSSIBLE_IMPACT,
    CLASS_FALSE_ALARM,
    CLASS_SUSPECTED_ACCIDENT,
    CLASS_HIGH_SEVERITY,
    CLASS_SENSOR_FAULT
};

inline const char* classificationToString(ClassificationType clf) {
    switch (clf) {
        case CLASS_NORMAL:             return "NORMAL_MOVEMENT";
        case CLASS_POSSIBLE_IMPACT:    return "POSSIBLE_IMPACT";
        case CLASS_FALSE_ALARM:        return "FALSE_ALARM";
        case CLASS_SUSPECTED_ACCIDENT: return "SUSPECTED_ACCIDENT";
        case CLASS_HIGH_SEVERITY:      return "HIGH_SEVERITY_CANDIDATE";
        case CLASS_SENSOR_FAULT:       return "SENSOR_FAULT";
        default:                       return "UNKNOWN";
    }
}

enum GPSFixState {
    GPS_NO_FIX,
    GPS_VALID_FIX,
    GPS_STALE_FIX
};

inline const char* gpsFixStateToString(GPSFixState state) {
    switch (state) {
        case GPS_NO_FIX:    return "NO_FIX";
        case GPS_VALID_FIX: return "VALID_FIX";
        case GPS_STALE_FIX: return "STALE_FIX";
        default:            return "UNKNOWN";
    }
}

struct SensorFrame {
    uint32_t timestampMs;
    bool isValid;
    float ax; // g
    float ay; // g
    float az; // g
    float gx; // deg/s
    float gy; // deg/s
    float gz; // deg/s
    float magnitude;     // g
    float jerk;          // g/s
    float gyroMagnitude; // deg/s
    float pitch;         // deg
    float roll;          // deg
};

struct GPSLocation {
    GPSFixState fixState;
    bool hasFix;
    double latitude;
    double longitude;
    uint8_t satellites;
    float hdop;
    uint32_t fixTimestampMs;
    char mapUrl[80];
};

struct IncidentRecord {
    char incidentId[24];
    uint32_t timestampMs;
    SystemState state;
    const char* severity;
    const char* reason;
    float peakMagnitude;
    float peakGyro;
    float peakJerk;
    float rollDelta;
    GPSLocation location;
    bool smsSent;
    uint8_t retries;
};

#endif // CRASHSENSE_TYPES_H

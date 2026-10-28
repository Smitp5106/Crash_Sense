#ifndef CRASHSENSE_ACCIDENT_DETECTOR_H
#define CRASHSENSE_ACCIDENT_DETECTOR_H

#include <Arduino.h>
#include "types.h"
#include "config.h"

struct DetectionOutcome {
    ClassificationType classification;
    const char* reason;
    float peakMagnitude;
    float peakGyro;
    float peakJerk;
    float rollDelta;
    bool isConfirmedAccident;
    bool isHighSeverity;
};

class AccidentDetector {
public:
    AccidentDetector();
    DetectionOutcome processSample(const SensorFrame& frame);
    void reset();

    ClassificationType getCurrentClassification() const { return _currentClassification; }
    bool isCandidateActive() const { return _candidateActive; }

private:
    ClassificationType _currentClassification;
    bool _candidateActive;
    uint32_t _candidateStartTimeMs;
    float _peakMagnitude;
    float _peakJerk;
    float _peakGyro;
    float _baselineRoll;
    float _baselinePitch;
};

#endif // CRASHSENSE_ACCIDENT_DETECTOR_H

/**
 * CrashSense Accident Detection Engine
 *
 * Multi-Stage Verification Pipeline:
 * Stage 1: Continuous Baseline & Sensor Health Check (detects disconnect/NaN)
 * Stage 2: Peak Acceleration Magnitude & Jerk Assessment
 * Stage 3: Gyroscopic Angular Rate & Rollover Attitude Verification
 * Stage 4: Transient Window vs Sustained Post-Impact Stoppage Analysis
 *
 * Classifications:
 * - NORMAL_MOVEMENT
 * - POSSIBLE_IMPACT (transient shock)
 * - FALSE_ALARM (pothole/bump/brake dismissed)
 * - SUSPECTED_ACCIDENT
 * - HIGH_SEVERITY_CANDIDATE (rollover/high-energy collision)
 * - SENSOR_FAULT
 */

const EventEmitter = require('events');

class AccidentDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      ACCEL_MAGNITUDE_THRESHOLD_G: config.ACCEL_MAGNITUDE_THRESHOLD_G ?? 3.2,
      ACCEL_JERK_THRESHOLD_G_PER_S: config.ACCEL_JERK_THRESHOLD_G_PER_S ?? 18.0,
      GYRO_MAGNITUDE_THRESHOLD_DEG_S: config.GYRO_MAGNITUDE_THRESHOLD_DEG_S ?? 150.0,
      TILT_CHANGE_THRESHOLD_DEG: config.TILT_CHANGE_THRESHOLD_DEG ?? 45.0,
      POTHOLE_MAX_DURATION_MS: config.POTHOLE_MAX_DURATION_MS ?? 120,
      POST_IMPACT_STATIONARY_WINDOW_MS: config.POST_IMPACT_STATIONARY_WINDOW_MS ?? 2000,
      POST_IMPACT_MAX_MOTION_G: config.POST_IMPACT_MAX_MOTION_G ?? 0.40,
      ...config
    };

    this.currentClassification = 'NORMAL_MOVEMENT';
    this.candidateActive = false;
    this.candidateStartTime = 0;
    this.peakMagnitude = 0;
    this.peakJerk = 0;
    this.peakGyro = 0;
    this.baselineRoll = 0;
    this.baselinePitch = 0;
    this.transientWindowCount = 0;

    // Buffer for evaluating post-impact rest
    this.postImpactSamples = [];
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.emit('config_updated', this.config);
  }

  processSample(sample) {
    const now = sample.timestamp || Date.now();

    // 1. Sensor Health Check - Never treat sensor fault as an accident
    if (!sample.isConnected || isNaN(sample.magnitude)) {
      if (this.currentClassification !== 'SENSOR_FAULT') {
        this.currentClassification = 'SENSOR_FAULT';
        this.candidateActive = false;
        this.emit('classification_changed', {
          classification: 'SENSOR_FAULT',
          reason: 'I2C communication failure or NaN readings',
          timestamp: now
        });
      }
      return {
        classification: 'SENSOR_FAULT',
        reason: 'Sensor hardware disconnected or invalid data',
        confidence: 0.0
      };
    }

    // Recover from SENSOR_FAULT if back online
    if (this.currentClassification === 'SENSOR_FAULT' && sample.isConnected) {
      this.currentClassification = 'NORMAL_MOVEMENT';
      this.emit('classification_changed', {
        classification: 'NORMAL_MOVEMENT',
        reason: 'Sensor connection restored',
        timestamp: now
      });
    }

    // 2. Active Candidate Evaluation Window
    if (this.candidateActive) {
      const elapsed = now - this.candidateStartTime;
      this.peakMagnitude = Math.max(this.peakMagnitude, sample.magnitude);
      this.peakJerk = Math.max(this.peakJerk, sample.jerk || 0);
      this.peakGyro = Math.max(this.peakGyro, sample.gyroMagnitude || 0);
      this.postImpactSamples.push(sample);

      // Check if this was a transient bump / pothole (< 120ms shock followed by normal motion)
      if (elapsed > this.config.POTHOLE_MAX_DURATION_MS && elapsed < 400) {
        const isTransientShock = (this.peakGyro < this.config.GYRO_MAGNITUDE_THRESHOLD_DEG_S * 0.5) &&
                                 (sample.magnitude < 1.35) &&
                                 (Math.abs(sample.roll - this.baselineRoll) < 15);

        if (isTransientShock) {
          // Dismissed as false alarm pothole/bump
          this.candidateActive = false;
          this.currentClassification = 'FALSE_ALARM';
          const details = {
            classification: 'FALSE_ALARM',
            reason: `Transient impulse (${this.peakMagnitude.toFixed(2)}g) with low angular rate (${this.peakGyro.toFixed(1)}°/s); driving resumed.`,
            peakMagnitude: this.peakMagnitude,
            peakGyro: this.peakGyro,
            timestamp: now
          };
          this.emit('candidate_dismissed', details);
          this.emit('classification_changed', details);
          return details;
        }
      }

      // Check for Severe Rollover Attitude
      const rollDelta = Math.abs(sample.roll - this.baselineRoll);
      const isRolloverAttitude = rollDelta >= this.config.TILT_CHANGE_THRESHOLD_DEG;

      // Complete Verification Window
      if (elapsed >= this.config.POST_IMPACT_STATIONARY_WINDOW_MS || (isRolloverAttitude && elapsed >= 600)) {
        this.candidateActive = false;

        // Verify multi-factor accident criteria:
        // 1. Extreme peak acceleration (>= threshold)
        // 2. Significant rotational tumble (gyro magnitude >= threshold) OR permanent attitude roll
        const hasSevereAcceleration = this.peakMagnitude >= this.config.ACCEL_MAGNITUDE_THRESHOLD_G;
        const hasRotationalTumble = this.peakGyro >= this.config.GYRO_MAGNITUDE_THRESHOLD_DEG_S;

        if (hasSevereAcceleration && (hasRotationalTumble || isRolloverAttitude)) {
          const isHighSeverity = this.peakMagnitude >= (this.config.ACCEL_MAGNITUDE_THRESHOLD_G * 1.3) || isRolloverAttitude;
          this.currentClassification = isHighSeverity ? 'HIGH_SEVERITY_CANDIDATE' : 'SUSPECTED_ACCIDENT';

          const confirmedDetails = {
            classification: this.currentClassification,
            severity: isHighSeverity ? 'HIGH' : 'MEDIUM',
            reason: isRolloverAttitude
              ? `Vehicle Rollover Detected (Roll Δ: ${rollDelta.toFixed(1)}°, Gyro: ${this.peakGyro.toFixed(1)}°/s)`
              : `High-G Impact Verified (${this.peakMagnitude.toFixed(2)}g, Gyro: ${this.peakGyro.toFixed(1)}°/s, Jerk: ${this.peakJerk.toFixed(1)}g/s)`,
            peakMagnitude: this.peakMagnitude,
            peakGyro: this.peakGyro,
            peakJerk: this.peakJerk,
            rollDelta: Number(rollDelta.toFixed(1)),
            timestamp: now
          };

          this.emit('accident_detected', confirmedDetails);
          this.emit('classification_changed', confirmedDetails);
          return confirmedDetails;
        } else {
          // High vibration or hard braking without angular tumble or sustained stop
          this.currentClassification = 'FALSE_ALARM';
          const dismissedDetails = {
            classification: 'FALSE_ALARM',
            reason: `False Alarm: Impact peak ${this.peakMagnitude.toFixed(2)}g lacked collision kinematics (Gyro: ${this.peakGyro.toFixed(1)}°/s, Roll Δ: ${rollDelta.toFixed(1)}°)`,
            peakMagnitude: this.peakMagnitude,
            peakGyro: this.peakGyro,
            timestamp: now
          };
          this.emit('candidate_dismissed', dismissedDetails);
          this.emit('classification_changed', dismissedDetails);
          return dismissedDetails;
        }
      }

      return {
        classification: 'POSSIBLE_IMPACT',
        reason: 'Verifying candidate dynamics against false-alarm criteria...',
        elapsedMs: elapsed,
        peakMagnitude: this.peakMagnitude
      };
    }

    // 3. Stage 1 Baseline Candidate Trigger
    // Trigger candidate evaluation if acceleration magnitude or jerk exceeds candidate threshold
    const isImpactCandidate = (sample.magnitude >= this.config.ACCEL_MAGNITUDE_THRESHOLD_G) ||
                             (sample.jerk >= this.config.ACCEL_JERK_THRESHOLD_G_PER_S && sample.magnitude >= 2.4);

    if (isImpactCandidate) {
      this.candidateActive = true;
      this.candidateStartTime = now;
      this.peakMagnitude = sample.magnitude;
      this.peakJerk = sample.jerk || 0;
      this.peakGyro = sample.gyroMagnitude || 0;
      this.baselineRoll = sample.roll || 0;
      this.baselinePitch = sample.pitch || 0;
      this.postImpactSamples = [sample];

      this.currentClassification = 'POSSIBLE_IMPACT';
      const candidateInfo = {
        classification: 'POSSIBLE_IMPACT',
        reason: `Potential collision impulse detected (${sample.magnitude.toFixed(2)}g, jerk ${sample.jerk.toFixed(1)}g/s). Initiating verification window.`,
        peakMagnitude: this.peakMagnitude,
        timestamp: now
      };
      this.emit('candidate_started', candidateInfo);
      this.emit('classification_changed', candidateInfo);
      return candidateInfo;
    }

    // Normal driving vibration
    if (this.currentClassification !== 'NORMAL_MOVEMENT') {
      this.currentClassification = 'NORMAL_MOVEMENT';
    }

    return {
      classification: 'NORMAL_MOVEMENT',
      reason: 'Kinematics within safe vehicular thresholds',
      magnitude: sample.magnitude
    };
  }

  reset() {
    this.currentClassification = 'NORMAL_MOVEMENT';
    this.candidateActive = false;
    this.candidateStartTime = 0;
    this.peakMagnitude = 0;
    this.peakJerk = 0;
    this.peakGyro = 0;
    this.postImpactSamples = [];
  }
}

module.exports = AccidentDetector;


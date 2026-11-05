/**
 * CrashSense Sensor Engine - MPU-6050 6-DOF Physics Simulator
 *
 * Models 3-axis accelerometer (ax, ay, az in g) and 3-axis gyroscope (gx, gy, gz in deg/s).
 * Simulates gravitational vector, Gaussian road noise, transient shocks, and vehicular dynamics.
 */

const EventEmitter = require('events');

class SensorEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.isConnected = true;
    this.currentScenario = 'NORMAL_DRIVING';
    this.scenarioStartTime = Date.now();
    this.scenarioDurationMs = 0;

    // Sensor reading state (baseline: vehicle level, stationary 1g along Z)
    this.ax = 0.0;
    this.ay = 0.0;
    this.az = 1.0;
    this.gx = 0.0;
    this.gy = 0.0;
    this.gz = 0.0;

    this.lastMagnitude = 1.0;
    this.lastTimestamp = Date.now();
    this.currentJerk = 0.0;
    this.pitch = 0.0; // degrees
    this.roll = 0.0;  // degrees

    // Custom override state
    this.isManualOverride = false;
    this.overrideValues = null;
  }

  setScenario(name, durationMs = 3000) {
    this.currentScenario = name;
    this.scenarioStartTime = Date.now();
    this.scenarioDurationMs = durationMs;
    this.isManualOverride = false;
    this.emit('scenario_changed', { scenario: name, durationMs });
  }

  setSensorConnection(connected) {
    this.isConnected = Boolean(connected);
    this.emit('sensor_status_changed', { isConnected: this.isConnected });
  }

  setManualOverride(values) {
    this.isManualOverride = true;
    this.overrideValues = { ...values };
  }

  clearManualOverride() {
    this.isManualOverride = false;
    this.overrideValues = null;
  }

  // Generate deterministic noise (-amp to +amp)
  _noise(amp = 0.04) {
    return (Math.random() * 2 - 1) * amp;
  }

  // Update physical telemetry based on active scenario and elapsed time
  sample() {
    const now = Date.now();
    const dt = Math.max((now - this.lastTimestamp) / 1000, 0.001);
    this.lastTimestamp = now;

    if (!this.isConnected) {
      return {
        timestamp: now,
        isConnected: false,
        ax: NaN,
        ay: NaN,
        az: NaN,
        gx: NaN,
        gy: NaN,
        gz: NaN,
        magnitude: NaN,
        jerk: NaN,
        pitch: NaN,
        roll: NaN,
        error: "ERR_I2C_BUS_DISCONNECTED"
      };
    }

    if (this.isManualOverride && this.overrideValues) {
      this.ax = this.overrideValues.ax ?? 0;
      this.ay = this.overrideValues.ay ?? 0;
      this.az = this.overrideValues.az ?? 1;
      this.gx = this.overrideValues.gx ?? 0;
      this.gy = this.overrideValues.gy ?? 0;
      this.gz = this.overrideValues.gz ?? 0;
    } else {
      const elapsed = now - this.scenarioStartTime;
      const isWithinScenario = elapsed < this.scenarioDurationMs;

      switch (this.currentScenario) {
        case 'NORMAL_DRIVING':
          // Mild road vibrations, 1g Z gravity, gentle cruising
          this.ax = 0.02 + this._noise(0.05);
          this.ay = 0.01 + this._noise(0.04);
          this.az = 1.00 + this._noise(0.06);
          this.gx = this._noise(3.0);
          this.gy = this._noise(3.0);
          this.gz = this._noise(4.0);
          break;

        case 'SUDDEN_BRAKING':
          if (isWithinScenario) {
            // Rapid longitudinal deceleration (-1.4g to -1.8g) with nose dip pitch
            this.ax = -1.55 + this._noise(0.08);
            this.ay = this._noise(0.05);
            this.az = 1.05 + this._noise(0.08);
            this.gx = this._noise(6.0);
            this.gy = -12.0 + this._noise(5.0); // nose dip pitch
            this.gz = this._noise(5.0);
          } else {
            this.currentScenario = 'NORMAL_DRIVING';
          }
          break;

        case 'POTHOLE_BUMP':
          // Sharp transient vertical impulse (<120ms), vehicle continues driving
          if (elapsed < 110) {
            this.ax = this._noise(0.1);
            this.ay = this._noise(0.1);
            this.az = 2.45 + this._noise(0.15); // sharp vertical shock
            this.gx = this._noise(15.0);
            this.gy = this._noise(15.0);
            this.gz = this._noise(10.0);
          } else {
            // Immediately returns to normal driving vibration
            this.ax = 0.02 + this._noise(0.05);
            this.ay = 0.01 + this._noise(0.05);
            this.az = 1.00 + this._noise(0.06);
            this.gx = this._noise(4.0);
            this.gy = this._noise(4.0);
            this.gz = this._noise(4.0);
            if (elapsed > this.scenarioDurationMs) {
              this.currentScenario = 'NORMAL_DRIVING';
            }
          }
          break;

        case 'SHARP_TURN':
          if (isWithinScenario) {
            // Lateral centripetal acceleration, sustained yaw rate, moderate roll
            this.ax = -0.1 + this._noise(0.04);
            this.ay = 1.25 + this._noise(0.08); // Lateral g-force
            this.az = 1.00 + this._noise(0.05);
            this.gx = 10.0 + this._noise(4.0);
            this.gy = this._noise(4.0);
            this.gz = 75.0 + this._noise(8.0); // High yaw rate
          } else {
            this.currentScenario = 'NORMAL_DRIVING';
          }
          break;

        case 'SIMULATED_CRASH':
          if (elapsed < 150) {
            // Extreme collision impact shock wave: 4.5g - 6.0g peak, violent jerk, rotational tumble
            this.ax = -4.20 + this._noise(0.3);
            this.ay = 2.10 + this._noise(0.3);
            this.az = 2.80 + this._noise(0.3);
            this.gx = 210.0 + this._noise(25.0);
            this.gy = -180.0 + this._noise(25.0);
            this.gz = 240.0 + this._noise(30.0);
          } else if (elapsed < 600) {
            // Rebound & secondary deceleration
            this.ax = 0.8 + this._noise(0.2);
            this.ay = -0.6 + this._noise(0.2);
            this.az = 1.2 + this._noise(0.2);
            this.gx = 40.0 + this._noise(10.0);
            this.gy = 30.0 + this._noise(10.0);
            this.gz = 50.0 + this._noise(10.0);
          } else {
            // Post-crash resting state: vehicle comes to a complete halt
            this.ax = 0.05 + this._noise(0.02);
            this.ay = 0.03 + this._noise(0.02);
            this.az = 0.98 + this._noise(0.02); // stationary gravity
            this.gx = this._noise(1.0);
            this.gy = this._noise(1.0);
            this.gz = this._noise(1.0);
          }
          break;

        case 'ROLLOVER':
          if (elapsed < 400) {
            // Violent roll rate > 300 deg/s, multi-axis g-force
            this.ax = 1.8 + this._noise(0.2);
            this.ay = 3.2 + this._noise(0.3);
            this.az = 2.2 + this._noise(0.3);
            this.gx = 320.0 + this._noise(30.0); // High roll rate
            this.gy = 140.0 + this._noise(20.0);
            this.gz = 180.0 + this._noise(25.0);
          } else {
            // Resting upside down or on its side: Az inverted or Ay = 1g
            this.ax = 0.10 + this._noise(0.02);
            this.ay = 0.95 + this._noise(0.02); // resting on its side!
            this.az = 0.05 + this._noise(0.02);
            this.gx = this._noise(1.0);
            this.gy = this._noise(1.0);
            this.gz = this._noise(1.0);
          }
          break;

        default:
          this.currentScenario = 'NORMAL_DRIVING';
          break;
      }
    }

    // Magnitude: sqrt(ax^2 + ay^2 + az^2)
    const magnitude = Math.sqrt(this.ax * this.ax + this.ay * this.ay + this.az * this.az);
    this.currentJerk = Math.abs((magnitude - this.lastMagnitude) / dt);
    this.lastMagnitude = magnitude;

    // Pitch and Roll calculation from gravity vector (in degrees)
    this.pitch = Math.atan2(this.ax, Math.sqrt(this.ay * this.ay + this.az * this.az)) * (180.0 / Math.PI);
    this.roll = Math.atan2(this.ay, Math.sqrt(this.ax * this.ax + this.az * this.az)) * (180.0 / Math.PI);

    // Gyroscope angular rate magnitude: sqrt(gx^2 + gy^2 + gz^2)
    const gyroMagnitude = Math.sqrt(this.gx * this.gx + this.gy * this.gy + this.gz * this.gz);

    const reading = {
      timestamp: now,
      isConnected: true,
      ax: Number(this.ax.toFixed(3)),
      ay: Number(this.ay.toFixed(3)),
      az: Number(this.az.toFixed(3)),
      gx: Number(this.gx.toFixed(2)),
      gy: Number(this.gy.toFixed(2)),
      gz: Number(this.gz.toFixed(2)),
      magnitude: Number(magnitude.toFixed(3)),
      jerk: Number(this.currentJerk.toFixed(2)),
      gyroMagnitude: Number(gyroMagnitude.toFixed(2)),
      pitch: Number(this.pitch.toFixed(1)),
      roll: Number(this.roll.toFixed(1)),
      scenario: this.currentScenario
    };

    return reading;
  }
}

module.exports = SensorEngine;


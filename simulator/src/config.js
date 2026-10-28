/**
 * CrashSense Telematics Simulator - Configuration & Threshold Tuning
 *
 * All acceleration values are documented in Standard Gravitational Units (1g = 9.80665 m/s²).
 * All angular velocities are in degrees per second (deg/s).
 */

const CONFIG = {
  // Detection Engine Thresholds
  ACCEL_MAGNITUDE_THRESHOLD_G: 3.2,       // Impact magnitude threshold (g)
  ACCEL_JERK_THRESHOLD_G_PER_S: 18.0,     // Rate of change in acceleration (g/s)
  GYRO_MAGNITUDE_THRESHOLD_DEG_S: 150.0,  // Rotational rate threshold (deg/s)
  TILT_CHANGE_THRESHOLD_DEG: 45.0,        // Attitude / rollover change threshold (deg)
  POTHOLE_MAX_DURATION_MS: 120,           // Duration limit for transient bumps/potholes (ms)
  HARD_BRAKE_MAX_GYRO_DEG_S: 40.0,        // Max rotation permitted during pure deceleration
  POST_IMPACT_STATIONARY_WINDOW_MS: 2000, // Window to evaluate vehicle stoppage (ms)
  POST_IMPACT_MAX_MOTION_G: 0.40,         // Dynamic variance permitted during stationary rest (g)

  // System & Alert Timers
  CANCELLATION_TIMEOUT_SEC: 15,           // Driver countdown window before SMS dispatch (seconds)
  DEDUPLICATION_COOLDOWN_SEC: 60,         // Incident suppression cooldown to avoid duplicate alerts (s)
  SAMPLING_INTERVAL_MS: 50,               // 20 Hz telematics polling loop in simulator

  // GNSS / GPS Configuration
  GPS_DEFAULT_LAT: 37.774929,             // Default test latitude (San Francisco)
  GPS_DEFAULT_LNG: -122.419416,           // Default test longitude
  GPS_STALE_THRESHOLD_SEC: 60,            // Fix age beyond which coordinates are flagged STALE
  GPS_TTFF_SIMULATED_SEC: 5,              // Simulated Time-To-First-Fix (cold start)

  // SIM7600 Cellular Modem Configuration
  MODEM_PORT: "COM5",                     // Virtual / hardware port identifier
  MODEM_BAUD: 115200,
  MODEM_RETRY_LIMIT: 3,                   // Maximum bounded retries before marking FAILED
  MODEM_RETRY_INTERVAL_MS: 2000,          // Interval between retry attempts (ms)
  DEFAULT_EMERGENCY_RECIPIENT: "+15550192834", // Safe mock test recipient
  CELLULAR_OPERATOR: "MockTel 4G LTE",

  // Logging & Storage
  LOG_JSONL_PATH: "./logs/incidents.jsonl",
  LOG_CSV_PATH: "./logs/incidents.csv",
  LOG_RETENTION_MAX_ENTRIES: 500,

  // Server
  PORT: process.env.PORT || 3000
};

module.exports = CONFIG;

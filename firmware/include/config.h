#ifndef CRASHSENSE_CONFIG_H
#define CRASHSENSE_CONFIG_H

#include <Arduino.h>

// ============================================================================
// CrashSense Firmware Configuration & Pin Assignment
// Target: ESP32 DevKit V1 (30-pin or 36-pin)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Hardware Pin Definitions
// ----------------------------------------------------------------------------
// I2C Interface for MPU-6050
#define PIN_I2C_SDA             21  // ESP32 default I2C Data
#define PIN_I2C_SCL             22  // ESP32 default I2C Clock
#define MPU6050_I2C_ADDR        0x68 // AD0 connected to GND

// UART2 Interface for NEO-6M GPS Receiver
#define PIN_GPS_RX              16  // ESP32 Rx2 <- GPS Tx
#define PIN_GPS_TX              17  // ESP32 Tx2 -> GPS Rx
#define GPS_BAUD_RATE           9600

// UART1 Interface for SIM7600 4G LTE Modem
#define PIN_MODEM_RX            26  // ESP32 Rx1 <- Modem Tx (level-shifted)
#define PIN_MODEM_TX            27  // ESP32 Tx1 -> Modem Rx (level-shifted)
#define MODEM_BAUD_RATE         115200

// User Interface & Actuators
#define PIN_BUZZER              25  // Active Piezo Buzzer (Transistor base)
#define PIN_BUTTON_CANCEL       19  // Push Button (Internal Pull-Up, active LOW)
#define PIN_STATUS_LED          2   // On-board LED indicator

// ----------------------------------------------------------------------------
// 2. Accident Detection Kinematic Thresholds
// ----------------------------------------------------------------------------
// Acceleration Magnitude: sqrt(ax^2 + ay^2 + az^2) in standard g (1g = 9.80665 m/s^2)
#define ACCEL_MAG_THRESHOLD_G       3.20f   // High-G impact threshold
#define ACCEL_JERK_THRESHOLD_G_PER_S 18.0f  // Acceleration rate of change threshold
#define GYRO_MAG_THRESHOLD_DEG_S    150.0f  // Rotational angular rate threshold
#define TILT_CHANGE_THRESHOLD_DEG   45.0f   // Rollover attitude change threshold
#define POTHOLE_MAX_DURATION_MS     120     // Transient shock window (ms)
#define POST_IMPACT_STATIONARY_MS   2000    // Post-impact stoppage evaluation window (ms)

// ----------------------------------------------------------------------------
// 3. System Timers & Safety Limits
// ----------------------------------------------------------------------------
#define CANCELLATION_TIMEOUT_MS     15000   // 15 seconds driver cancellation window
#define DEDUPLICATION_COOLDOWN_MS   60000   // 60 seconds suppression of repeated triggers
#define GPS_STALE_TIMEOUT_MS        60000   // 60 seconds before GPS fix is considered stale
#define MODEM_RETRY_LIMIT           3       // Max SMS/AT dispatch retry attempts
#define SENSOR_SAMPLE_INTERVAL_MS   20      // 50 Hz telematics sampling loop
#define STATUS_HEARTBEAT_MS         1000    // 1 Hz heartbeat diagnostic pulse

// ----------------------------------------------------------------------------
// 4. Safe Test Recipient & Safety Guards
// ----------------------------------------------------------------------------
#define DEFAULT_TEST_RECIPIENT      "+15550192834" // Mock approved test phone number
#define TEST_MODE_ACTIVE            true           // Prevents live emergency calls

#endif // CRASHSENSE_CONFIG_H

#include <Arduino.h>
#include "config.h"
#include "types.h"
#include "MPU6050_Driver.h"
#include "AccidentDetector.h"
#include "GPSManager.h"
#include "SIM7600_Modem.h"
#include "AlertManager.h"
#include "SerialTestRunner.h"

// System Subsystems
MPU6050_Driver  sensorDriver;
AccidentDetector detector;
GPSManager       gpsManager;
SIM7600_Modem    modem;
AlertManager     alertManager(detector, gpsManager, modem);
SerialTestRunner serialTestRunner(detector, alertManager, gpsManager, modem);

// Timing variables
uint32_t lastSampleMs = 0;
uint32_t lastHeartbeatMs = 0;

void printSystemBanner() {
    Serial.println("\r\n========================================================");
    Serial.println("  CrashSense — Intelligent Vehicular Telematics System");
    Serial.println("  Target: ESP32 DevKit V1 | Firmware Version: 1.0.0");
    Serial.println("========================================================");
    Serial.println("Pin Allocations:");
    Serial.printf("  MPU-6050 IMU:    SDA=GPIO%d, SCL=GPIO%d (I2C 0x68)\r\n", PIN_I2C_SDA, PIN_I2C_SCL);
    Serial.printf("  NEO-6M GPS:      RX=GPIO%d, TX=GPIO%d (UART2 9600)\r\n", PIN_GPS_RX, PIN_GPS_TX);
    Serial.printf("  SIM7600 4G LTE:  RX=GPIO%d, TX=GPIO%d (UART1 115200)\r\n", PIN_MODEM_RX, PIN_MODEM_TX);
    Serial.printf("  Actuators:       Buzzer=GPIO%d, Button=GPIO%d, LED=GPIO%d\r\n", PIN_BUZZER, PIN_BUTTON_CANCEL, PIN_STATUS_LED);
    Serial.println("--------------------------------------------------------\r\n");
}

void setup() {
    // 1. Initialize Debug USB Serial
    Serial.begin(115200);
    delay(500);
    printSystemBanner();

    // 2. Initialize Actuators & User Controls
    alertManager.begin();
    Serial.println("[INIT] Actuators and cancellation button initialized.");

    // 3. Initialize MPU-6050 IMU Driver
    Serial.print("[INIT] Initializing MPU-6050 on I2C... ");
    if (sensorDriver.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000)) {
        Serial.println("SUCCESS. Calibrating baseline...");
        sensorDriver.calibrate(100);
        Serial.println("[INIT] MPU-6050 calibration complete.");
    } else {
        Serial.println("FAILED! (Sensor not detected on I2C bus)");
        Serial.println("[WARN] System entering SENSOR_FAULT state. Interactive Serial Mock Mode available.");
    }

    // 4. Initialize NEO-6M GPS Receiver
    Serial.print("[INIT] Initializing NEO-6M GNSS receiver on UART2... ");
    gpsManager.begin(Serial2, GPS_BAUD_RATE, PIN_GPS_RX, PIN_GPS_TX);
    Serial.println("SUCCESS.");

    // 5. Initialize SIM7600 4G LTE Modem
    Serial.print("[INIT] Initializing SIM7600 Modem on UART1... ");
    if (modem.begin(Serial1, MODEM_BAUD_RATE, PIN_MODEM_RX, PIN_MODEM_TX)) {
        Serial.println("SUCCESS.");
        ModemDiagnostics diag = modem.getDiagnostics();
        Serial.printf("[INIT] Modem: SIM=%s, Reg=%s, Signal CSQ=%u\r\n",
                      diag.isSimReady ? "READY" : "NOT_READY",
                      diag.isNetworkRegistered ? "HOME_REGISTERED" : "SEARCHING",
                      diag.signalCSQ);
    } else {
        Serial.println("OFFLINE/NOT_DETECTED (Will proceed with mock cellular pipeline)");
    }

    // 6. Initialize Serial Test Console
    serialTestRunner.begin();

    Serial.println("[READY] CrashSense telematics engine active.");
}

void loop() {
    uint32_t now = millis();

    // 1. Service Incoming GPS NMEA Stream
    gpsManager.update();

    // 2. Service Interactive Serial Test Commands
    serialTestRunner.update();

    // 3. Service Alert State Machine (Countdown ticker, Buzzer, LED, Button)
    alertManager.update();

    // 4. Telematics Sensor Sampling Loop (50 Hz = 20ms)
    if (now - lastSampleMs >= SENSOR_SAMPLE_INTERVAL_MS) {
        lastSampleMs = now;

        SensorFrame frame;
        if (serialTestRunner.isMockActive()) {
            // Use active mock injection from Serial Console
            frame = serialTestRunner.getMockFrame();
        } else {
            // Read physical MPU-6050
            sensorDriver.readSensor(frame);
        }

        // Process through Multi-Stage Accident Detection Engine
        DetectionOutcome outcome = detector.processSample(frame);

        // Check if verified collision occurred
        if (outcome.isConfirmedAccident) {
            alertManager.triggerAccident(outcome);
        }
    }

    // 5. Diagnostic Heartbeat Pulse (1 Hz)
    if (now - lastHeartbeatMs >= STATUS_HEARTBEAT_MS) {
        lastHeartbeatMs = now;

        if (alertManager.getState() == STATE_COUNTDOWN) {
            Serial.printf("[COUNTDOWN] Emergency dispatch in %lu seconds! Press button to cancel.\r\n",
                          (unsigned long)alertManager.getCountdownRemainingSec());
        }
    }
}

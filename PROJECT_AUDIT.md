# CrashSense: Project Audit & Baseline Assessment

**Project Title:** CrashSense — Intelligent Accident Detection, Location Tracking, and Emergency Alert System  
**Date of Audit:** October 28, 2026  
**Auditor / Role:** Senior Embedded Systems Engineer & IoT Architect  
**Workspace Directory:** `c:\Users\HP\OneDrive\Desktop\iot\New folder (3)\iot_project`  
**Git Status:** Initialized empty repository; fresh build checkpoint.

---

## 1. Executive Summary

This audit assesses the initial workspace, runtime environment, hardware configuration, architectural risks, and algorithmic requirements for building **CrashSense**. CrashSense is a mission-critical IoT and embedded telematics system designed to detect vehicular collisions using 6-DOF inertial measurements, suppress false alarms via multi-stage sensor verification and an interactive driver cancellation countdown, acquire high-integrity GNSS coordinates, and transmit real-time emergency telemetry over cellular 4G LTE (SIM7600) and Web interfaces.

Prior to this assessment, the workspace directory was verified to be empty. A clean Git repository was initialized, and a complete engineering audit was executed across the local toolchains, target hardware specifications, mathematical crash models, communication protocols, and safety constraints.

---

## 2. Environment & Toolchain Inspection

A forensic inspection of the host environment was performed:

| Tool / Runtime | Version / Path | Operational Status | Strategic Decision |
|---|---|---|---|
| **Node.js** | `v24.11.1` | **Fully Functional** | Primary runtime for the PC Simulator, interactive Web GUI, WebSocket telemetry, and automated test harness. |
| **npm** | `11.17.0` | **Fully Functional** | Package manager for simulator dependencies (Express, ws, dotenv, etc.). |
| **Git** | `2.46.2.windows.1` | **Fully Functional** | Version control for state checkpoints, commits, and project tracking. |
| **Python** | Missing (Windows Store stub) | Not installed | Simulator implemented in pure Node.js to ensure immediate zero-friction execution. |
| **GCC (MinGW)** | `C:\MinGW\bin\gcc.exe` | System DLL relocation failure | Avoid reliance on host MinGW; firmware will use standard PlatformIO / Arduino ESP32 toolchains. |
| **Embedded Framework** | ESP-IDF / Arduino on ESP32 | Standard C++17 | ESP32 firmware structured with clear hardware abstraction layer (HAL) compatible with PlatformIO and Arduino IDE. |

---

## 3. Hardware Bill of Materials (BOM) & Pinout Audit

### Target Hardware Profile:
1. **Microcontroller:** ESP32 DevKit V1 (Xtensa Dual-Core 32-bit LX6, 240 MHz, 520 KB SRAM, 4 MB Flash).
2. **Inertial Measurement Unit (IMU):** InvenSense MPU-6050 (3-axis accelerometer $\pm 2g / \pm 4g / \pm 8g / \pm 16g$, 3-axis gyroscope $\pm 250^\circ/s$ to $\pm 2000^\circ/s$, $I^2C$ interface).
3. **GNSS / GPS Receiver:** u-blox NEO-6M (50-channel engine, UART 9600 baud, NMEA-0183 output, internal backup battery).
4. **Cellular Modem:** SIMCOM SIM7600 4G LTE Development Board (UART 115200 baud, AT command set, SMS, Voice, TCP/IP).
5. **Local Audio Alert:** 5V Active Piezo Buzzer (driven via NPN transistor or logic-level MOSFET).
6. **Cancellation Control:** Momentary Tactile Push Button (GPIO input with internal pull-up / hardware debounce).
7. **Power Subsystem:** Dedicated high-current regulated power supply (5V, $\ge 2.5\text{A}$ rating).

### Pin Mapping Matrix & Rationale:

| ESP32 GPIO | Peripheral | Peripheral Pin | Direction / Mode | Hardware Rationale & Precautions |
|---|---|---|---|---|
| **GPIO 21** | MPU-6050 | SDA | Bi-directional (Open-drain) | Standard default $I^2C$ data line on ESP32. Requires $4.7\text{k}\Omega$ pull-up to 3.3V (often on breakout). |
| **GPIO 22** | MPU-6050 | SCL | Output (Open-drain) | Standard default $I^2C$ clock line on ESP32 ($100\text{kHz}$ standard or $400\text{kHz}$ fast mode). |
| **GPIO 16** | NEO-6M GPS | TXD (Module Tx $\to$ ESP32 Rx) | Input (UART2 Rx) | Dedicated Hardware Serial2 Rx. Clean, isolated from USB flashing serial. |
| **GPIO 17** | NEO-6M GPS | RXD (Module Rx $\leftarrow$ ESP32 Tx)| Output (UART2 Tx) | Hardware Serial2 Tx. Optional configuration commands to GPS. |
| **GPIO 26** | SIM7600 Modem | TXD (Modem Tx $\to$ ESP32 Rx) | Input (UART1 Rx) | Dedicated Hardware Serial1 Rx. Connected to modem's level-shifted Tx. |
| **GPIO 27** | SIM7600 Modem | RXD (Modem Rx $\leftarrow$ ESP32 Tx)| Output (UART1 Tx) | Hardware Serial1 Tx. Connected to modem's level-shifted Rx. |
| **GPIO 25** | Active Buzzer | VCC/Base | Output (Digital/PWM) | Piezo acoustic alert during accident candidate & cancellation countdown. |
| **GPIO 19** | Push Button | SW1 | Input (Pull-up) | Driver false-alarm cancellation switch. Debounced in firmware. |
| **GPIO 2** | Status LED | Built-in LED | Output | Visual heartbeat & state indicator (blinking patterns per state). |

---

## 4. Algorithmic Crash Detection & False-Alarm Prevention Audit

A fatal flaw in naive IoT accident detection systems is triggering emergency alerts from a single accelerometer threshold. A dropped phone, rough pothole, or hard brake can easily produce high instantaneous $g$-peaks.

### CrashSense Multi-Stage Classification Pipeline:
1. **Stage 1: Continuous Baseline Acquisition & Calibration**
   - High-rate sampling ($50\text{ Hz} - 100\text{ Hz}$).
   - Baseline gravitational compensation ($1.0g$ static vector removal or orientation tracking).
   - Sensor validity check (detect I2C lockups, static frozen values, disconnected sensor).

2. **Stage 2: Impact Magnitude Peak Detection**
   $$\text{accel\_magnitude} = \sqrt{a_x^2 + a_y^2 + a_z^2}$$
   - Threshold evaluation: Normal driving $< 1.8g$; Severe bump/pothole $2.0g - 2.8g$; Vehicular collision $> 3.2g$ (configurable).

3. **Stage 3: Jerk Rate & Gyroscope Angular Rate Verification**
   - Jerk ($da/dt$): Real crashes exhibit extreme rate of change in acceleration ($> 15g/\text{s}$).
   - Angular velocity magnitude $\omega = \sqrt{\omega_x^2 + \omega_y^2 + \omega_z^2}$: Collisions and rollovers generate high rotational rates ($> 120^\circ/\text{s}$ to $300^\circ/\text{s}$), whereas a dropped phone or vertical pothole produces negligible angular velocity.

4. **Stage 4: Post-Impact Attitude & Inactivity Verification**
   - Following an impact candidate, the system checks whether the vehicle has come to a stop or undergone a permanent orientation roll/tilt change ($> 45^\circ$).
   - A pothole or speed bump is immediately followed by resumption of normal vibration and driving speed, allowing rapid suppression.

5. **Stage 5: Driver Cancellation Countdown (Fail-Safe)**
   - Prior to cellular transmission, a countdown timer starts (configurable, default: 20 seconds).
   - Local active buzzer sounds rapid warning beeps.
   - If the driver presses the physical button (or simulator CANCEL button), the event is marked `CANCELLED_BY_USER`, the incident is logged with sensor telemetry, and cellular transmission is aborted.

---

## 5. Critical Hardware & Power Risk Assessment

| Risk Category | Hazard / Symptom | Engineering Mitigation |
|---|---|---|
| **Power Supply Brownouts** | SIM7600 requires peak currents up to $2.0\text{A}$ during 4G RF uplink burst. Powering SIM7600 from ESP32 3.3V or USB 500mA rail causes ESP32 brownout reset loops. | **Mandatory:** Power SIM7600 via dedicated external 5V/3A buck converter or high-discharge LiPo battery with common ground shared with ESP32. Place a $1000\mu\text{F}$ low-ESR electrolytic capacitor near modem VCC. |
| **UART Voltage Incompatibility** | SIM7600 core module operates at $1.8\text{V}$ logic levels. Applying ESP32 $3.3\text{V}$ directly will damage native SIM7600 GPIOs. | Confirm carrier board has on-board TXS0108E / TXB0104 / transistor bidirectional level shifters. If bare module, use resistive divider or level shifter. |
| **GPS Fix Latency & Multipath** | Cold start TTFF (Time-To-First-Fix) can take $35 - 90\text{ s}$. In parking garages or tunnels, GPS fix is lost. | Firmware must maintain a timestamped `last_known_valid_fix`. When no fix exists, alerts explicitly state `GPS: NO_FIX (Satellite Acquisition in Progress)` or report `LAST_KNOWN_LOCATION (Age: X s)`. Coordinates `0.0, 0.0` must never be sent as real coordinates. |
| **Emergency Number Safety** | Accidental dialing of public emergency dispatch (911, 112, 999) during development is illegal and dangerous. | Strict software interlock: Firmware and simulator enforce `TEST_MODE=true` by default. Outgoing SMS and voice simulation are routed to mock consoles or strictly to pre-approved user test phone numbers. Real emergency services are never contacted. |

---

## 6. Audit Verdict & Architecture Next Steps

- **Baseline Codebase:** Clean slate.
- **Simulator Priority:** Build an interactive PC Simulator first (browser UI + Node.js backend) to test and tune the multi-stage algorithm across 17 required scenarios without requiring physical collision testing.
- **Firmware Strategy:** Modular C++ firmware adhering to non-blocking state machine architecture, compatible with PlatformIO and Arduino IDE.
- **Documentation Strategy:** Comprehensive specifications, circuit diagrams, testing reports, and deployment instructions.

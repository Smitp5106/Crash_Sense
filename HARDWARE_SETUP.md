# CrashSense: Hardware Setup & Deployment Guide

**Target Hardware:** ESP32 DevKit V1 + MPU-6050 + NEO-6M + SIM7600  
**Document Version:** 1.0.0  

---

## 1. Hardware Bill of Materials (BOM)

| Item | Component Description | Recommended Model / Specification | Purpose |
|---|---|---|---|
| **1** | Microcontroller | ESP32 DevKit V1 (30 or 36 pin) | Master telematics processor |
| **2** | 6-DOF Inertial Sensor | InvenSense MPU-6050 (GY-521 breakout) | Accelerometer & Gyroscope collision detection |
| **3** | GNSS / GPS Receiver | u-blox NEO-6M with ceramic patch antenna | Satellite location tracking |
| **4** | Cellular Modem | SIMCOM SIM7600 (SIM7600E / SIM7600A / SIM7600G) | 4G LTE SMS & Telematics transmission |
| **5** | DC-DC Step-Down Regulator | LM2596S, MP1584, or XL4015 (5V / 3A output) | Stable power supply from vehicle 12V rail |
| **6** | Audio Actuator | 5V Active Piezo Buzzer | Cancellation countdown acoustic alert |
| **7** | Driver Cancel Switch | Momentary Tactile Push Button | Driver false-alarm cancellation |
| **8** | Switching Transistor | 2N2222 or BC547 NPN Transistor | Low-side driver for 5V buzzer |
| **9** | Buffer Capacitor | $1000\mu\text{F} / 16\text{V}$ Low-ESR Electrolytic | Cellular RF uplink burst current buffer |
| **10**| Resistors & Diodes | $1\text{k}\Omega$ (base), $1\text{N}4148$ (flyback diode) | Circuit protection |

---

## 2. SIM Card & Cellular Configuration

Before inserting the SIM card into the SIM7600 carrier board:
1. **Remove SIM PIN:** Insert the SIM card into a standard smartphone, go to `Settings -> Security -> SIM Lock`, and disable the SIM PIN. The SIM7600 cannot send SMS if blocked by a PIN request.
2. **Verify SMS Plan:** Confirm the SIM has an active prepaid or postpaid plan with SMS and cellular data enabled.
3. **Check Regional 4G Bands:**
   - **SIM7600A:** North America (B2, B4, B12).
   - **SIM7600E:** Europe / Asia / India (B1, B3, B7, B8, B20, B40).
   - **SIM7600G:** Global version (covers all standard regional bands).
4. **Insert Orientation:** Carefully insert the Nano-SIM or Micro-SIM into the spring-loaded slot with the gold contacts facing downwards towards the board.

---

## 3. Physical Antenna Placement & RF Isolation

> [!IMPORTANT]
> **RF INTERFERENCE PRECAUTION:**  
> The 4G LTE cellular transmitter operates at high transmit power ($\approx 23\text{ dBm}$ / $200\text{ mW}$).  
> Always maintain at least **$15\text{ cm}$ physical separation** between the 4G LTE whip/PCB antenna and the NEO-6M GPS ceramic patch antenna. Placing the antennas directly adjacent will jam the weak satellite signals ($-130\text{ dBm}$), resulting in persistent `NO_FIX` states.

- **GPS Antenna:** Mount the ceramic square patch antenna flat with the ceramic element facing directly upwards towards the vehicle windshield or open sky.
- **4G LTE Antenna:** Mount the omni-directional cellular whip antenna vertically.

---

## 4. Step-by-Step Electrical Assembly

1. **Step 1: Set Buck Converter Voltage:** Before connecting any microcontrollers or sensors, power the DC-DC buck converter from your 12V bench supply and use a digital multimeter to tune the potentiometer until the output reads exactly **$5.05\text{V}$**.
2. **Step 2: Solder Electrolytic Capacitor:** Solder the $1000\mu\text{F}$ capacitor across the SIM7600 board 5V VCC and GND pins (observe correct polarity: negative stripe to GND).
3. **Step 3: Establish Star Ground:** Connect a central ground bus linking ESP32 GND, SIM7600 GND, MPU6050 GND, GPS GND, and Buck Converter GND.
4. **Step 4: Connect MPU-6050:**
   - VCC $\to$ ESP32 3.3V
   - GND $\to$ Common GND
   - SDA $\to$ ESP32 GPIO 21
   - SCL $\to$ ESP32 GPIO 22
   - AD0 $\to$ Common GND
5. **Step 5: Connect NEO-6M GPS:**
   - VCC $\to$ ESP32 3.3V
   - GND $\to$ Common GND
   - TX $\to$ ESP32 GPIO 16 (UART2 Rx)
   - RX $\to$ ESP32 GPIO 17 (UART2 Tx)
6. **Step 6: Connect SIM7600:**
   - 5V In $\to$ Buck Converter 5V Output
   - GND $\to$ Common GND
   - TX $\to$ ESP32 GPIO 26 (UART1 Rx)
   - RX $\to$ ESP32 GPIO 27 (UART1 Tx)
7. **Step 7: Connect Buzzer & Push Button:**
   - Connect buzzer through 2N2222 transistor to GPIO 25.
   - Connect cancellation push button between GPIO 19 and GND.

---

## 5. Firmware Flashing Instructions

### Method A: Flashing via PlatformIO (Recommended)
1. Open the project root in VS Code with PlatformIO IDE installed.
2. Connect the ESP32 to your PC via a high-quality micro-USB data cable.
3. Inspect `firmware/platformio.ini` (configured for `esp32doit-devkit-v1`).
4. Click the PlatformIO **Build** button (check mark icon) or run:
   ```powershell
   pio run
   ```
5. Click the PlatformIO **Upload** button (right arrow icon) or run:
   ```powershell
   pio run --target upload
   ```
6. Open the serial monitor at 115200 baud:
   ```powershell
   pio device monitor -b 115200
   ```

### Method B: Flashing via Arduino IDE
1. Open Arduino IDE (v2.x or v1.8.x).
2. Go to `File -> Preferences` and ensure the ESP32 board manager URL is added:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Go to `Tools -> Board -> esp32 -> ESP32 Dev Module`.
4. Copy the files from `firmware/src/` and `firmware/include/` into an Arduino sketch folder (`CrashSense/CrashSense.ino` renaming `main.cpp` to `CrashSense.ino`).
5. Select the COM port under `Tools -> Port`.
6. Click **Upload**.
7. Open Serial Monitor at **115200 baud** and set line ending to **Newline** or **Both NL & CR**.

---

## 6. Hardware-in-the-Loop Bench Test Procedure

Once flashed and booted, verify each subsystem using the interactive Serial Monitor console:

1. **Verify Boot Diagnostics:**
   Ensure the serial console outputs:
   ```
   [INIT] Actuators and cancellation button initialized.
   [INIT] Initializing MPU-6050 on I2C... SUCCESS.
   [INIT] MPU-6050 calibration complete.
   [INIT] Initializing NEO-6M GNSS receiver on UART2... SUCCESS.
   [INIT] Initializing SIM7600 Modem on UART1... SUCCESS.
   [READY] CrashSense telematics engine active.
   ```
2. **Execute Diagnostic Check:**
   Type `STATUS` in the Serial Monitor. Observe sensor magnitude ($\approx 1.00g$), GPS fix status, and modem signal CSQ.
3. **Simulate Crash via Serial CLI:**
   Type `CRASH` in the Serial Monitor.
   - Observe immediate transition: `[STATE] IDLE -> CANDIDATE -> COUNTDOWN`.
   - The buzzer should emit audible periodic beeps on GPIO 25.
   - The status LED on GPIO 2 should flash rapidly.
4. **Test Cancellation Button:**
   Press the physical push button on GPIO 19 before 15 seconds elapse.
   - The buzzer must stop immediately.
   - The state transitions: `[STATE] COUNTDOWN -> CANCELLED -> IDLE`.
   - No SMS is dispatched.
5. **Test Automated Cellular Dispatch:**
   Type `CRASH` again. Allow the 15-second countdown to expire without pressing the button.
   - The console reports: `[STATE] COUNTDOWN -> ALERT_PENDING -> SENDING`.
   - The SIM7600 transmits the formatted SMS message with coordinates to the configured test number.
   - The state transitions: `[STATE] SENDING -> SENT`.

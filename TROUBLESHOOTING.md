# CrashSense: Field Engineering & Troubleshooting Guide

**System:** CrashSense Telematics Subsystem  
**Document Version:** 1.0.0  

---

## 1. MPU-6050 $I^2C$ Bus Lockup & Disconnection

### Symptoms:
- ESP32 Serial Monitor reports: `[INIT] Initializing MPU-6050 on I2C... FAILED!`
- Telemetry displays `NaN` for all acceleration and gyroscope axes.
- System transitions to `STATE_SENSOR_FAULT`.

### Root Causes & Solutions:
1. **$I^2C$ Bus Stuck Low (Slave Clock Stretching / Lockup):**
   - *Cause:* If the ESP32 resets while the MPU-6050 is driving the SDA line LOW, the bus locks up permanently.
   - *Fix:* Perform a 9-clock bus-clearing sequence in firmware or toggle SCL manually 9 times at startup to release SDA.
2. **Missing Pull-Up Resistors:**
   - *Cause:* Standard ESP32 internal pull-ups are weak ($\approx 45\text{k}\Omega$). Long jumper wires cause capacitive slew that violates $I^2C$ rise time.
   - *Fix:* Ensure the MPU-6050 breakout has $4.7\text{k}\Omega$ pull-up resistors on SDA (GPIO 21) and SCL (GPIO 22) to 3.3V. Keep jumper wires under $15\text{ cm}$.
3. **Incorrect $I^2C$ Address:**
   - *Cause:* If AD0 pin is floating or tied to 3.3V, address shifts from `0x68` to `0x69`.
   - *Fix:* Connect AD0 firmly to GND to lock address to `0x68`.

---

## 2. ESP32 Brownout Resets During Cellular Transmissions

### Symptoms:
- The ESP32 boots normally, but as soon as an SMS or call is initiated, the system immediately resets:
  `rst:0xc (SW_CPU_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)` or `Brownout detector was triggered`.

### Root Causes & Solutions:
1. **Powering SIM7600 from ESP32 USB / 3.3V Pin:**
   - *Cause:* The SIM7600 requires up to **$2.0\text{A}$ instantaneous burst current** when ramping RF power amplifier for LTE transmission. Standard PC USB ports only supply $500\text{mA}$, causing the voltage rail to collapse below the ESP32 $2.7\text{V}$ brownout threshold.
   - *Fix:* Power the SIM7600 from an external DC-DC step-down buck converter (e.g., LM2596S / MP1584EN) rated for at least $5\text{V} / 3\text{A}$.
2. **Missing Buffer Reservoir Capacitor:**
   - *Fix:* Solder a $1000\mu\text{F} / 16\text{V}$ low-ESR electrolytic capacitor directly across the SIM7600 `VCC` and `GND` header pins to supply peak current bursts.
3. **High-Resistance Jumper Wires:**
   - *Fix:* Thin 28-AWG breadboard jumper wires drop $0.5\text{V} - 1.0\text{V}$ during $2\text{A}$ pulses. Use thicker 20-AWG or 22-AWG stranded wire for power and ground leads.

---

## 3. SIM7600 Cellular Network Registration & AT Command Timeouts

### Symptoms:
- `AT+CREG?` returns `+CREG: 0,0` (Not registered) or `+CREG: 0,2` (Searching).
- SMS dispatch returns `+CMS ERROR: 331 (No Network Service)`.

### Root Causes & Solutions:
1. **SIM PIN Lock Active:**
   - *Cause:* The SIM card is locked with a 4-digit PIN.
   - *Fix:* Insert SIM into a phone and disable the PIN, or send `AT+CPIN="<pin>"` during startup.
2. **Missing or Incompatible Antenna:**
   - *Cause:* Operating without an LTE antenna prevents RF synchronization with local base stations.
   - *Fix:* Attach the provided multi-band LTE whip or adhesive patch antenna to the `MAIN` SMA connector.
3. **Regional LTE Band Incompatibility:**
   - *Cause:* A SIM7600A (North America) will not connect to European/Asian LTE bands (B1, B3, B7, B20), and vice versa.
   - *Fix:* Confirm module suffix matches local carrier bands (or use SIM7600G global version).
4. **UART Voltage Level Incompatibility:**
   - *Cause:* SIM7600 core operates at $1.8\text{V}$ logic levels. If the carrier board lacks level-shifting circuitry, connecting 3.3V ESP32 signals directly will cause corrupted serial framing or transceiver burnout.
   - *Fix:* Verify that the carrier board includes onboard level shifters or insert a bidirectional logic level shifter between ESP32 and SIM7600.

---

## 4. GPS Receiver Satellite Acquisition Delay & Persistent `NO_FIX`

### Symptoms:
- GPS fix status remains `NO_FIX`.
- Serial Monitor reports 0 satellites acquired.

### Root Causes & Solutions:
1. **Indoor Testing (RF Attenuation):**
   - *Cause:* Building concrete and metal-coated low-E window glass attenuate satellite signals by $20 - 30\text{ dB}$.
   - *Fix:* Place the ceramic patch antenna near an open window or outdoors with an unobstructed view of the sky.
2. **Cold Start Time-To-First-Fix (TTFF):**
   - *Cause:* A cold start requires downloading the complete satellite almanac and ephemeris data, which takes $35 - 90\text{ seconds}$.
   - *Fix:* Wait at least 2 minutes during initial power-on. The tiny red LED on the NEO-6M board will begin blinking once a valid 3D fix is established.
3. **RF Jamming from Cellular Antenna:**
   - *Cause:* Placing the 4G LTE antenna within $10\text{ cm}$ of the GPS patch antenna induces RF desensitization.
   - *Fix:* Separate the GPS antenna and LTE antenna by at least $15\text{ cm}$.

---

## 5. False Alarm Cancellation Button Bouncing

### Symptoms:
- Single button press does not cancel, or cancels intermittently.

### Root Causes & Solutions:
1. **Mechanical Contact Bounce:**
   - *Cause:* Mechanical switches generate electrical ringing for $5 - 20\text{ ms}$ upon contact closure.
   - *Fix:* Firmware implements a 50ms software debounce lock. Adding a $100\text{nF}$ ceramic capacitor in parallel with the push button provides hardware debouncing.
2. **Floating Pin:**
   - *Fix:* Ensure the GPIO is initialized with `INPUT_PULLUP` (`pinMode(PIN_BUTTON_CANCEL, INPUT_PULLUP)`).

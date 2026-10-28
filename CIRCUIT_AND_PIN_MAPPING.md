# CrashSense: Circuit Design & Pin Mapping Guide

**System:** CrashSense — Vehicular Accident Detection & Cellular Telematics  
**Target Board:** ESP32 DevKit V1 (30-Pin / 36-Pin ESP-WROOM-32)  
**Document Version:** 1.0.0  

---

## 1. Master GPIO Pin Assignment Table

| ESP32 GPIO | Subsystem / Component | Component Pin | Electrical Mode | Recommended Wire Color | Functional Description & Precautions |
|---|---|---|---|---|---|
| **GPIO 21** | MPU-6050 IMU | **SDA** | $I^2C$ Data (Open-Drain) | **Yellow** | Default ESP32 $I^2C$ Data. Requires $4.7\text{k}\Omega$ pull-up to 3.3V (pre-installed on GY-521 breakout). |
| **GPIO 22** | MPU-6050 IMU | **SCL** | $I^2C$ Clock (Open-Drain)| **Green** | Default ESP32 $I^2C$ Clock. Operates at $400\text{kHz}$ Fast Mode. |
| **GPIO 16** | NEO-6M GPS | **TXD** (GPS Tx $\to$ ESP32 Rx) | UART2 Rx (3.3V CMOS) | **White** | Hardware Serial2 Rx. Receives continuous NMEA sentences at 9600 baud. |
| **GPIO 17** | NEO-6M GPS | **RXD** (GPS Rx $\leftarrow$ ESP32 Tx)| UART2 Tx (3.3V CMOS) | **Orange** | Hardware Serial2 Tx. Transmits u-blox binary or NMEA configuration commands. |
| **GPIO 26** | SIM7600 4G LTE | **TXD** (Modem Tx $\to$ ESP32 Rx) | UART1 Rx (Level-Shifted)| **Blue** | Hardware Serial1 Rx. Receives AT command replies and unsolicited network codes. |
| **GPIO 27** | SIM7600 4G LTE | **RXD** (Modem Rx $\leftarrow$ ESP32 Tx)| UART1 Tx (Level-Shifted)| **Purple** | Hardware Serial1 Tx. Transmits AT commands at 115200 baud. |
| **GPIO 25** | Active Buzzer | **Transistor Base** | Digital Output (Push-Pull)| **Brown** | Drives NPN transistor (2N2222) switching 5V buzzer during cancellation countdown. |
| **GPIO 19** | Push Button | **Switch Terminal** | Digital Input (`INPUT_PULLUP`)| **Gray** | False-alarm cancellation button. Normally HIGH, grounds to GND when pressed. |
| **GPIO 2** | Status LED | **On-Board LED** | Digital Output | *Internal* | Visual heartbeat & state indicator. |
| **VIN** | Power Supply | **5V Input** | Power Rail ($\ge 2.5\text{A}$) | **Red** | Main regulated 5V power input. |
| **GND** | Ground Plane | **Common Ground** | Common Reference | **Black** | Star-ground topology uniting ESP32, SIM7600, GPS, IMU, and Power Supply. |

---

## 2. Power Architecture & Brownout Prevention

> [!CAUTION]
> **CRITICAL POWER REQUIREMENT:**  
> The SIM7600 4G LTE module draws instantaneous current bursts up to **$2.0\text{A}$** during RF uplink transmissions.  
> Attempting to power the SIM7600 directly from the ESP32 `3.3V` or `VIN` pin from a USB port ($500\text{mA}$) will cause severe voltage dips, triggering the ESP32 hardware brownout detector (`Brownout detector was triggered`) and putting the controller into continuous boot loops.

```
       +-------------------------------------------------------------+
       |           12V Vehicle Battery / DC Bench Supply             |
       +-------------------------------------------------------------+
                                      |
                                      v
       +-------------------------------------------------------------+
       |   High-Efficiency Step-Down DC-DC Buck Converter (5V / 3A)   |
       |             (e.g., LM2596S, MP1584EN, XL4015)               |
       +-------------------------------------------------------------+
                     |                               |
          +5V (Main) |                               | +5V (Cellular)
                     |                               v
                     |                  +----------------------------+
                     |                  | 1000uF Low-ESR Electrolytic|
                     |                  | Capacitor (Buffer Reservoir|
                     |                  +----------------------------+
                     |                               |
                     v                               v
        +-------------------------+    +-----------------------------+
        |   ESP32 DevKit V1       |    |   SIM7600 4G LTE Board      |
        |   - VIN Pin             |    |   - VCC / 5V DC In          |
        |   - On-board 3.3V LDO   |    |   - 2A Peak Burst Capability|
        +-------------------------+    +-----------------------------+
                     |                               |
          3.3V Rail  |                               |
                     v                               |
        +-------------------------+                  |
        |   MPU-6050 & NEO-6M     |                  |
        |   - VCC: 3.3V Rail      |                  |
        +-------------------------+                  |
                     |                               |
                     +---------------+---------------+
                                     |
                                     v
                        COMMON STAR GROUND PLANE (GND)
```

### Power Decoupling Guidelines:
1. **Electrolytic Buffer:** Solder a $1000\mu\text{F} / 16\text{V}$ low-ESR electrolytic capacitor directly across the SIM7600 power input pins (`VCC` and `GND`).
2. **Ceramic Decoupling:** Place a $100\text{nF}$ ceramic capacitor in parallel across the MPU-6050 `VCC` and `GND` to suppress high-frequency digital noise on the $I^2C$ bus.
3. **Common Star Ground:** All ground connections must meet at a single central point to prevent ground loops that induce sensor jitter.

---

## 3. Detailed Wiring Diagrams by Subsystem

### A. MPU-6050 6-DOF IMU Wiring
- **VCC:** Connect to ESP32 **3.3V** pin (or 5V if the breakout board has an on-board 662K 3.3V regulator).
- **GND:** Connect to ESP32 **GND**.
- **SCL:** Connect to ESP32 **GPIO 22**.
- **SDA:** Connect to ESP32 **GPIO 21**.
- **AD0:** Connect to **GND** (sets $I^2C$ slave address to `0x68`).
- **INT:** Not strictly required (polled at 50Hz); optionally connect to GPIO 23 for hardware interrupt wake-up.

### B. u-blox NEO-6M GPS Receiver Wiring
- **VCC:** Connect to ESP32 **3.3V** or **5V** (NEO-6M breakouts feature an on-board 3.3V LDO).
- **GND:** Connect to ESP32 **GND**.
- **TXD:** Connect to ESP32 **GPIO 16** (UART2 Rx).
- **RXD:** Connect to ESP32 **GPIO 17** (UART2 Tx).
- **Antenna:** Attach ceramic patch antenna; place horizontally facing an open window or outdoors for optimal satellite acquisition.

### C. SIM7600 4G LTE Development Board Wiring
- **VCC / 5V:** Connect directly to the **5V / 3A Buck Converter Output** (with $1000\mu\text{F}$ capacitor).
- **GND:** Connect to common star **GND**.
- **TXD:** Connect to ESP32 **GPIO 26** (UART1 Rx).
- **RXD:** Connect to ESP32 **GPIO 27** (UART1 Tx).
- **PWRKEY:** On modules without automatic boot, pull `PWRKEY` to GND for $1.5\text{ s}$ to boot modem.
- **Level Shifting:** Verify whether your SIM7600 carrier board includes on-board level shifters. If using a bare SIM7600 core ($1.8\text{V}$ logic), use a bidirectional logic level converter (TXS0108E) between ESP32 (3.3V) and SIM7600 (1.8V).

### D. Active Buzzer Circuit (Acoustic Cancellation Alert)
```
          +5V Power Rail
               |
               +---[+] Active Buzzer [-]---+
                                           |
                                       Collector
                                           |
      ESP32 GPIO 25 ---[ 1k Resistor ]--- Base (2N2222 / BC547 NPN)
                                           |
                                        Emitter
                                           |
                                          GND
```
*(A $1\text{N}4148$ flyback diode placed anti-parallel across the buzzer coils is recommended to protect the transistor from inductive kickback).*

### E. Driver False-Alarm Cancellation Push Button
- **Terminal 1:** Connect to ESP32 **GPIO 19**.
- **Terminal 2:** Connect to common **GND**.
- Firmware configures `pinMode(PIN_BUTTON_CANCEL, INPUT_PULLUP)` with 50ms software debounce. Optional $100\text{nF}$ ceramic capacitor across terminals provides hardware debouncing.

# UNO R4 hardware setup

## Hardware used by the current sketch

- Arduino UNO R4 WiFi
- MPU6500 motion sensor on I2C (configured address `0x68`)
- NEO-6M GPS on `Serial1` (D0/D1)
- Optional active buzzer on D8
- Cancel push button from D2 to GND (`INPUT_PULLUP`)
- Built-in LED matrix for status; no external status LED is required

## Wiring

| Module | UNO R4 connection | Notes |
|---|---|---|
| MPU6500 SDA/SCL | SDA/SCL | I2C bus |
| MPU6500 VCC/GND | Compatible supply / common GND | Check breakout voltage and logic levels |
| NEO-6M TX | D0 / Serial1 RX | GPS NMEA data |
| NEO-6M RX | D1 / Serial1 TX | Optional if not configuring GPS |
| Cancel switch | D2 to GND | Pressed state is LOW |
| Optional active buzzer | D8 and GND | Use a transistor if load exceeds GPIO rating |
| Status indicator | Built-in LED matrix | No external LED pin |

Confirm breakout pin labels, power, and logic requirements before connecting. Never exceed UNO R4 input ratings.

## Upload and connect

1. Install the UNO R4 board package and required libraries: `Arduino_LED_Matrix`, `WiFiS3`, `TinyGPS++`.
2. Open `firmware_r4/CrashSense_R4.ino`, configure Wi-Fi locally, select **Arduino UNO R4 WiFi** and its USB port, then upload.
3. Open Serial Monitor at the baud configured in `setup()` and use the printed network address.
4. If station Wi-Fi fails, follow the AP fallback details printed by the sketch.

The board-local web page and laptop dashboard are separate clients. The laptop's cross-network cloud path is incomplete until telemetry publishing and command handling are added to the firmware; see [CLOUD_SETUP.md](CLOUD_SETUP.md).

**Privacy:** the board's unauthenticated local HTTP API now omits latitude, longitude, and map links. Exact GPS can be shown only through the authenticated laptop dashboard once board-to-cloud publishing is implemented. Keep the board on a trusted Wi-Fi network.

Check sensor readings while stationary and GPS outdoors before relying on the readings for a demonstration. This is a prototype, not certified safety equipment.

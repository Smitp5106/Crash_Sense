# Circuit and pin mapping

This reflects `firmware_r4/CrashSense_R4/CrashSense_R4.ino`. Check the exact breakout labels before applying power.

| Part | UNO R4 connection | Notes |
|---|---|---|
| MPU6500 SDA | SDA | I2C data |
| MPU6500 SCL | SCL | I2C clock |
| MPU6500 VCC/GND | Compatible supply / GND | Verify breakout voltage and logic levels |
| NEO-6M TX | D0 / Serial1 RX | GPS data to board |
| NEO-6M RX | D1 / Serial1 TX | Optional if only receiving GPS |
| Cancel button | D2 to GND | `INPUT_PULLUP`; pressed reads LOW |
| Optional active buzzer | D8 and GND | Add a driver for loads above GPIO capability |
| Status indicator | Built-in LED matrix | No external LED required |

The sketch uses I2C address `0x68` and GPS serial at 9600 baud. UNO R4 pin and voltage details are documented by [Arduino](https://docs.arduino.cc/hardware/uno-r4-wifi).

The current design does not use a SIM7600 or cellular connection. Wi-Fi serves the board's local HTTP page and sends HTTPS telemetry to the deployed CrashSense service using a per-device token. The dashboard and board may be on different Wi-Fi networks.

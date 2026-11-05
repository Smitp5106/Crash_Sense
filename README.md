# CrashSense R4

CrashSense is an Arduino UNO R4 WiFi accident-monitoring prototype. The current sketch reads an MPU6500 over I2C and a NEO-6M GPS on Serial1, displays state on the built-in LED matrix, sounds an optional buzzer, and serves a small dashboard directly from the board over local Wi-Fi.

The `simulator/` folder name is retained, but its current `server.js` is only the website host and cloud proxy. Older simulation source files remain unused; the dashboard server no longer starts them or serves generated telemetry.

## Current status

- Board-local web page and JSON API (`/api/data`, `/api/cancel`, `/api/reset`): implemented in `firmware_r4/CrashSense_R4.ino`.
- Laptop dashboard: in `simulator/public/`; it requests data through the local Node server. Without cloud URL/token settings, it shows offline and does not substitute synthetic readings.
- 3D car showcase: playable visual only; WASD/arrow keys or on-screen controls move the car, and dragging rotates the view. It never produces project telemetry or crash events.
- Cloud relay template: in `cloud_server/`; laptop proxy settings are environment variables described in [CLOUD_SETUP.md](CLOUD_SETUP.md).
- Location privacy: general status omits precise coordinates; users listed in the server-side account allowlist must sign in before viewing coordinates or the map.
- **Cross-network telemetry is not complete:** current R4 firmware does not publish to the cloud relay or process its queued commands.
- `TEST_REPORT.md` is historical simulator evidence, not validation of physical hardware or cloud operation.

## Run the board dashboard

1. Open `firmware_r4/CrashSense_R4.ino` in Arduino IDE.
2. Install `WiFiS3`, `Arduino_LED_Matrix`, and `TinyGPS++` (Wire and math are part of the core).
3. Configure Wi-Fi credentials locally, select **Arduino UNO R4 WiFi**, and upload.
4. Open Serial Monitor at the baud rate set in the sketch and use the URL printed by the board. The client must be able to reach the board on the local network.

If station Wi-Fi fails, the sketch has an access-point fallback; use the network details printed/configured in the sketch.

## Run the laptop website

From `simulator/`, run `node server.js`, then open `http://localhost:3000`. Configure the cloud proxy as described in [CLOUD_SETUP.md](CLOUD_SETUP.md). Without those settings the device dashboard stays offline; cross-network display still requires the missing firmware cloud publisher.

## Documentation

- [Hardware setup](HARDWARE_SETUP.md) · [Pin mapping](CIRCUIT_AND_PIN_MAPPING.md) · [Architecture](ARCHITECTURE.md)
- [Cloud setup](CLOUD_SETUP.md) 

This educational prototype is not certified vehicle safety equipment or an emergency response service. Do not rely on it for real dispatch.

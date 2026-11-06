# CrashSense R4

CrashSense is an Arduino UNO R4 WiFi telemetry prototype using an MPU6500, a NEO-6M GPS receiver, and the board’s built-in LED matrix. Its public dashboard supports account registration and per-user device ownership.

## Current architecture

- `firmware_r4/`: UNO R4 firmware. Each registered device uses its own bearer token from a local, ignored `cloud_secrets.h` file and posts over HTTPS to the website host.
- `simulator/`: Node.js dashboard/API server. Despite the historical folder name, it serves the website and contains no active simulated telemetry path.
- PostgreSQL stores accounts, hashed sessions, registered devices, latest readings, and command queues. Each account can access only its own devices.
- `cloud_server/`: legacy single-device relay template; not required for the multi-user deployment.
- 3D car: visual-only interactive background. It never generates device data or crash events.

## Deploy

Follow [CLOUD_SETUP.md](CLOUD_SETUP.md) to create a Render Postgres database, deploy `simulator/` as a Node web service, configure `DATABASE_URL`, and register a device. Keep the database URL and firmware device tokens private.

## Hardware

See [HARDWARE_SETUP.md](HARDWARE_SETUP.md) and [CIRCUIT_AND_PIN_MAPPING.md](CIRCUIT_AND_PIN_MAPPING.md) for wiring and upload instructions. Select **Arduino UNO R4 WiFi** in Arduino IDE. Set the cloud hostname and the device-specific token in `cloud_secrets.h` beside the sketch before uploading.

## Security and safety limits

Account passwords are salted and hashed, and sessions are stored server-side. Telemetry, exact GPS, and commands are private to the device owner. Public sign-up currently has no email verification, account recovery, MFA, organization sharing, or abuse moderation; add those controls before commercial use. CrashSense is an educational prototype, not certified vehicle safety or emergency dispatch equipment. The firmware’s synchronous HTTPS sends can pause sensor sampling; do not rely on it for real-vehicle safety.

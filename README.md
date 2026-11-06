# CrashSense

CrashSense connects an Arduino UNO R4 WiFi crash-monitoring device to a web dashboard. The board reads an MPU6500 over I²C and a NEO-6M GPS receiver over `Serial1`, then sends telemetry to the Node.js service over HTTPS. The website stores account, device, and latest-reading data in PostgreSQL.

The interactive 3D car is a visual background playground only. It does not create telemetry or simulate crashes. Real readings and crash alerts come from the registered UNO R4.

## What it includes

- Public landing page with account registration and sign-in.
- Per-account device enrollment with a unique device token for each UNO R4.
- Live telemetry and exact location for the signed-in device owner.
- A lightweight on-device GPS + MPU stationary filter that suppresses low-speed GPS drift.
- A separate Control Room page, limited to administrator-approved accounts, showing active crash alerts and their reported locations across registered devices.
- Responsive 3D background car that can be driven with WASD or arrow keys and rotated by dragging.

## Repository layout

```text
firmware_r4/CrashSense_R4/       Arduino UNO R4 sketch and safe cloud config template
simulator/server.js              Node.js website and API server (folder name retained for Render)
simulator/src/database.js        PostgreSQL connection and schema initialization
simulator/public/                Dashboard, Control Room, styles, and 3D car assets
logs/                            Historical incident and local test log files
CLOUD_SETUP.md                   Render deployment and account/device setup
HARDWARE_SETUP.md                Board, sensor, and upload instructions
CIRCUIT_AND_PIN_MAPPING.md        Wiring reference
ARCHITECTURE.md                  Data flow and access-control notes
```

## Deploy on Render

Follow [CLOUD_SETUP.md](CLOUD_SETUP.md). In brief, create a Render Postgres database and a Node web service from this repository with:

| Setting | Value |
|---|---|
| Root Directory | `simulator` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

Set `DATABASE_URL` to the database's internal connection URL, `HOST=0.0.0.0`, `NODE_ENV=production`, and `CRASH_SENSE_TRUST_PROXY=1`. Leave `CRASH_SENSE_CONTROL_ROOM_USERS` blank until an administrator approves an existing account. The live website root is the public landing page; `/healthz` should return `{"ok":true}`.

## Register and connect a board

1. Create a CrashSense account and sign in at the deployed website.
2. Select **Register my first device**. Copy the generated token; it is displayed only once.
3. Copy `firmware_r4/CrashSense_R4/cloud_secrets.example.h` to `cloud_secrets.h` in that same sketch folder.
4. In `cloud_secrets.h`, set `CRASH_SENSE_CLOUD_HOST` to the website host without `https://`, and set `CRASH_SENSE_DEVICE_TOKEN` to the token from step 2. Do not commit this private file.
5. Open `firmware_r4/CrashSense_R4/CrashSense_R4.ino` in Arduino IDE. Set your Wi-Fi name and password locally, install `Arduino_LED_Matrix`, `WiFiS3`, and `TinyGPS++`, select **Arduino UNO R4 WiFi**, and upload. Keep Wi-Fi credentials out of commits and shared sketches.
6. Open the dashboard using the same account that registered the board. The board and laptop can use different Wi-Fi networks as long as both have internet access.

See [HARDWARE_SETUP.md](HARDWARE_SETUP.md) and [CIRCUIT_AND_PIN_MAPPING.md](CIRCUIT_AND_PIN_MAPPING.md) for sensor wiring and pin details.

### Low-speed GPS filtering

GPS speed may drift slightly when the vehicle is stopped. The firmware reports stationary speed as `0.0 km/h` after GPS stays at or below `1.8 km/h` and the MPU6500 confirms low motion for three seconds. It releases the stationary state when motion is detected or GPS speed reaches `2.8 km/h`, and smooths readings between those thresholds. This is a small sensor-fusion rule, not a trained AI model; very slow movement can be reported as stationary. Test and tune it for your installation.

## Approve a Control Room account

The Control Room page is `https://YOUR-SERVICE.onrender.com/control-room.html`. Have the operator create a normal account first. Then an administrator adds that exact username to Render's `CRASH_SENSE_CONTROL_ROOM_USERS` variable, separating multiple usernames with commas, and redeploys. The page exposes only current `EMERGENCY_ALERT` records and reported locations, but approval grants access across all registered devices. Approve trusted operators only. See [CLOUD_SETUP.md](CLOUD_SETUP.md) for details.

## Local development

You need Node.js 18 or newer and a PostgreSQL database. From PowerShell, run the server from `simulator/` and provide a local database URL:

```powershell
cd simulator
$env:DATABASE_URL = 'postgres://username:password@localhost:5432/crashsense'
$env:HOST = '127.0.0.1'
$env:NODE_ENV = 'development'
$env:CRASH_SENSE_TRUST_PROXY = '0'
npm ci
npm start
```

Then open [http://localhost:3000](http://localhost:3000). The server creates its tables at startup. Do not use the production database URL for local development or share it in source control. The firmware's Serial Monitor `CRASH` command is a manual alert-path check; it is not generated by the background car or by simulated device telemetry.

## Privacy and limitations

- Passwords are salted and hashed; session cookies are HTTP-only and sessions are stored by hash.
- Device tokens are stored as hashes. Each board has its own token; keep it private.
- Ordinary accounts can read and command only their own devices. Control Room users are explicitly allowlisted and can see only active crash-alert details and locations for all registered devices.
- Account email verification, password recovery, MFA, organization groups, and abuse moderation are not implemented.
- Render's free PostgreSQL databases expire after 30 days and are intended for trial use. Choose persistent storage for accounts, device registrations, and telemetry you need to retain.
- CrashSense is a prototype, not certified vehicle safety equipment or an emergency dispatch service. The UNO R4's synchronous HTTPS publishing can pause its sensor loop.

# Public CrashSense deployment

CrashSense now uses one HTTPS web service for the public dashboard and device API, backed by PostgreSQL. Anyone can create an account. Each account sees only devices it registers, and every device receives its own bearer token. The firmware sends readings directly to the website host; the former one-token `cloud_server/` relay is not used by this multi-user version.

## Deploy on Render

1. Push the project to a GitHub repository connected to Render.
2. Create a **Render Postgres** database in the same region as the web service. Free Postgres expires after 30 days and has no backups, so it is only suitable for a short trial; use persistent storage for real user accounts, GPS readings, and device registrations. Free web services also spin down after 15 minutes idle. [Render free instance limits](https://render.com/docs/free)
3. Create a **Web Service** from the repository with:

   | Setting | Value |
   |---|---|
   | Root Directory | `simulator` |
   | Runtime | Node |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Health Check Path | `/healthz` |

4. In the web service’s Environment settings, set:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | The database’s **internal connection URL** (web service and database must be in the same Render region) |
   | `HOST` | `0.0.0.0` |
   | `NODE_ENV` | `production` |
   | `CRASH_SENSE_TRUST_PROXY` | `1` (Render's trusted HTTPS proxy supplies the forwarded protocol and client IP) |
   | `CRASH_SENSE_CONTROL_ROOM_USERS` | Comma-separated usernames approved for global crash-alert and location access; leave blank if unused |

5. If reusing the existing relay service, change its **Root Directory** from `cloud_server` to `simulator`; otherwise create a new web service. Remove the old `DEVICE_TOKEN` and `DASHBOARD_TOKEN` relay variables. Deploy, then open `https://YOUR-SERVICE.onrender.com/healthz`; expect `{"ok":true}`. The home page is the account sign-in/registration flow. Render web services provide HTTPS and public `onrender.com` addresses; the app binds to the required `0.0.0.0` interface. [Render web services](https://render.com/docs/web-services), [Render Postgres connection details](https://render.com/docs/postgresql-creating-connecting)

Use Render’s internal database URL when the app and database share a region; keep the database URL private. [Render Postgres](https://render.com/docs/postgresql-creating-connecting)

## Create an account and register a board

1. Open the deployed site and select **Create a new account**. Choose a username (3–32 letters, numbers, dots, dashes, or underscores) and a unique password of at least 12 characters. The earlier server-side location allowlist is not migrated; create a fresh account in this system.
2. Sign in and choose **Register my first device**. Give it a name. CrashSense creates a unique device token and shows it once.
3. Copy the firmware template beside the sketch you will upload:

   ```text
   cloud_secrets.example.h  →  cloud_secrets.h
   ```

4. In `cloud_secrets.h`, set `CRASH_SENSE_CLOUD_HOST` to the hostname of this deployed website (without `https://`) and `CRASH_SENSE_DEVICE_TOKEN` to the one-time token shown for that device. Keep this file private and never commit it.
5. Upload that firmware to the matching UNO R4 WiFi. The Serial Monitor should report `[CLOUD] Telemetry is reaching the CrashSense server.` after the API accepts a reading.
6. Return to the site. The device appears in the selector and its data is scoped to the signed-in account that created it.

To add another board, sign into the same account, register another device, and flash that device’s unique token. Separate accounts cannot list, read, or command one another’s devices. The server stores only a hash of each device token and returns the token only during registration.

## Approve Control Room accounts

The `/control-room.html` page is restricted to accounts listed in the web service's `CRASH_SENSE_CONTROL_ROOM_USERS` environment variable. It returns only current emergency alerts and their reported locations, not normal telemetry or account details. Control Room approval grants visibility across **all registered devices**, so approve only trusted users.

To approve an account, have the person register a regular CrashSense account first. In Render, open the web service's **Environment** settings and set `CRASH_SENSE_CONTROL_ROOM_USERS` to the approved usernames separated by commas (for example, `operator1,operator2`). Save and redeploy. The approved account can then sign in at `/control-room.html`. Remove a username from the variable and redeploy to revoke access. The list is case-insensitive.

## Local development

The app requires PostgreSQL. For local use, set `DATABASE_URL` to a PostgreSQL connection string, then run from `simulator/`:

```powershell
$env:DATABASE_URL = 'your-local-or-development-postgres-url'
node server.js
```

Do not use a production database URL in shared or untrusted computers. Local development can use `HOST=127.0.0.1`; Render must use `HOST=0.0.0.0`.

## Security and operational limits

- Passwords are salted and hashed with Node.js `scrypt`; browser sessions use random HTTP-only, same-site cookies stored by hash in PostgreSQL and expire after 12 hours. Login and registration attempts are rate-limited per client IP.
- Exact GPS, telemetry, and commands require an authenticated session and a device owned by that account. The device API accepts per-device bearer tokens over HTTPS.
- Account recovery by email, email verification, MFA, organization/team sharing, billing, and abuse moderation are not implemented. Users who forget their password cannot self-reset it. Add verified email recovery and operational abuse controls before treating this as a commercial public service.
- This is an educational prototype and not certified vehicle safety equipment or an emergency response service. HTTPS telemetry in the UNO R4 sketch is synchronous and can pause the sensor loop during network requests; do not rely on it for real-vehicle safety or dispatch.
- `cloud_server/` is the previous single-device relay template. It remains for reference, but the public multi-user website uses its own database-backed device API.

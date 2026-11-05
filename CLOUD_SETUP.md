# CrashSense cloud relay setup

This template is intended to let the UNO R4 and laptop connect from separate Wi-Fi networks. Both make outbound requests to a user-hosted HTTPS service; router port forwarding is not needed. The relay and laptop proxy are implemented, but **the current R4 firmware does not yet upload telemetry or process cloud commands**, so follow the firmware work in the final section before expecting cross-network data.

## 1. Deploy the relay

1. Deploy the contents of `cloud_server/` to a Node.js 18+ host that provides HTTPS.
2. Use `npm start` or `node server.js` as the start command.
3. In the hosting provider's secret settings, set distinct `DEVICE_TOKEN` and `DASHBOARD_TOKEN` values (use long random values; never commit them). Set `PORT` only if the provider requires it.
4. Deploy and copy the HTTPS URL, for example `https://your-service.example`.
5. Open `https://your-service.example/healthz`; expect `{"ok":true}`.

The template keeps only the latest reading and command queue in memory. Restarting the service clears both.

## 2. Configure location access and start the dashboard

Configure the dashboard server with the relay URL/token and a JSON allowlist of named users. Each listed user can view exact coordinates and send dashboard commands; everyone else sees vehicle status without location. Store this configuration in your host's secret settings for company use.

```powershell
$env:CRASH_SENSE_CLOUD_URL = 'https://your-service.example'
$env:CRASH_SENSE_DASHBOARD_TOKEN = 'the-dashboard-token-from-the-host'
$env:CRASH_SENSE_LOCATION_USERS = '[{"username":"operator1","password":"use-a-unique-password-at-least-12-chars"},{"username":"operator2","password":"use-another-unique-password"}]'
node server.js
```

Run this from the `simulator/` directory, then open `http://localhost:3000`. Set one unique account per approved user; passwords must be at least 12 characters. Keep all values in the server's protected environment, never in browser code or committed files. The root `.env.example` is reference only and is not loaded automatically. Local variables must be set again in each new terminal unless you use a protected local secrets manager.

Location access uses an HTTP-only, same-site session cookie, expires after 30 minutes, and blocks login after five failed attempts for 15 minutes. Sign out to clear the session sooner. Public device status omits coordinates, speed, and map URL. Exact GPS is returned only by the authenticated location endpoint. Dashboard cancel/reset commands also require sign-in.

For a company-hosted site, set `HOST=0.0.0.0` and place the Node server behind a trusted HTTPS reverse proxy. Set `CRASH_SENSE_TRUST_PROXY=1` only when that proxy terminates TLS and overwrites the forwarded-protocol header. Do not expose Node over public plain HTTP. For local use, leave `HOST` unset and use `http://localhost:3000`.

## 3. Complete the R4 firmware connection

The board must use TLS to `your-service.example:443` and POST JSON to `/api/device/telemetry` with `Authorization: Bearer <DEVICE_TOKEN>`. JSON must include the `motion`, `gps`, and `system` objects. Build this payload directly from the firmware's current sensor/GPS state: the local unauthenticated `/api/data` response deliberately returns zero coordinates and an empty map URL. A successful cloud response can contain `command: null`, `command: "cancel"`, or `command: "reset"`; the firmware must apply any command using its existing state functions.

Use WiFiS3 `WiFiSSLClient` and keep certificate verification enabled. Add the cloud hostname and device token as local firmware secrets, not committed credentials. Schedule network work with timeouts so sensor sampling and the physical cancel button remain responsive.

**This firmware step has not been made.** The current sketch still exposes local `/api/data`, `/api/cancel`, and `/api/reset` routes only. The unauthenticated local data route no longer returns exact coordinates. Until firmware publishes securely to the relay and processes returned commands, the dashboard has no precise location to reveal even after login, and queued website commands will not reach the board. Upload the updated sketch to apply the local GPS redaction.

## Location privacy boundary

The relay's latest-data endpoint is accessible to the dashboard server using its dashboard token. The browser calls the dashboard server, which removes coordinates/map URL from general status responses. Precise GPS is sent to a browser only after authentication against `CRASH_SENSE_LOCATION_USERS`. Protect the dashboard host and its environment secrets; someone with direct access to the relay dashboard token could bypass the website's location screen.

**Device-side status:** the UNO R4 local HTTP API has been changed to omit latitude, longitude, and map links, because it has no authenticated TLS session. Its page can show GPS fix/satellite status but not exact position. Authorized exact-location viewing will work through the laptop dashboard after the separate R4 cloud telemetry publisher is implemented; that firmware publisher is still pending.

## Relay endpoints

- `GET /healthz` — public status check.
- `POST /api/device/telemetry` — device token; stores a reading and returns one pending command.
- `GET /api/device/latest` — dashboard token; returns latest reading.
- `POST /api/device/commands` — dashboard token; accepts `cancel` or `reset`.

For implementation order and completion criteria, see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

// CrashSense single-tenant-isolated application server.
// Every account, session, device, reading, and command is scoped in PostgreSQL.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pool, initializeDatabase } = require('./src/database');

const publicDir = path.resolve(__dirname, 'public');
const SESSION_MS = 12 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_ATTEMPTS = 8;
const authAttempts = new Map();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

function clientAddress(req) {
  if (process.env.CRASH_SENSE_TRUST_PROXY === '1' && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function sameOrigin(req) {
  try { return Boolean(req.headers.origin) && new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}

function secureRequest(req) {
  return Boolean(req.socket.encrypted) ||
    (process.env.CRASH_SENSE_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') ||
    (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') && ['localhost', '127.0.0.1'].includes((req.headers.host || '').split(':')[0]);
}

function setSessionCookie(req, res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `crashsense_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `crashsense_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function sessionFor(req) {
  const token = cookies(req).crashsense_session;
  if (!token) return null;
  const result = await pool.query(
    `SELECT s.token_hash, s.user_id, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()`,
    [hash(token)]
  );
  return result.rows[0] || null;
}

async function readJson(req, limit = 32768) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Request body too large');
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw new Error('Invalid JSON'); }
}

function recordAuthAttempt(req) {
  const ip = clientAddress(req);
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (entry && entry.blockedUntil > now) return false;
  const attempts = entry && entry.windowUntil > now ? entry.attempts + 1 : 1;
  authAttempts.set(ip, {
    attempts,
    windowUntil: entry && entry.windowUntil > now ? entry.windowUntil : now + RATE_WINDOW_MS,
    blockedUntil: attempts >= MAX_AUTH_ATTEMPTS ? now + RATE_WINDOW_MS : 0
  });
  return attempts < MAX_AUTH_ATTEMPTS;
}

function clearAuthAttempts(req) { authAttempts.delete(clientAddress(req)); }

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
}

function validUsername(username) {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(username);
}

async function createSession(user, req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,to_timestamp($3))', [hash(token), user.id, Date.now() / 1000 + SESSION_MS / 1000]);
  setSessionCookie(req, res, token);
  return sendJson(res, 200, { authenticated: true, username: user.username, expiresInSec: SESSION_MS / 1000 });
}

function publicStatusPayload(data) {
  const gps = data.gps || {};
  const incident = data.incident || {};
  return {
    motion: data.motion || {}, system: data.system || {}, detection: data.detection || {},
    gps: { hasFix: Boolean(gps.hasFix), satellites: gps.satellites ?? null, fixAgeSec: gps.fixAgeSec ?? null, locationLocked: true },
    incident: { id: incident.id || '', status: incident.status || '', reason: incident.reason || '', peakG: incident.peakG ?? null, peakGyro: incident.peakGyro ?? null }
  };
}

async function ownedDevice(req, userId) {
  const deviceId = new URL(req.url, 'http://localhost').searchParams.get('deviceId');
  if (!deviceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) return null;
  const result = await pool.query('SELECT id, owner_id, name, latest_data, last_seen_at FROM devices WHERE id=$1 AND owner_id=$2', [deviceId, userId]);
  return result.rows[0] || null;
}

async function enqueueCommand(device, command) {
  if (!['cancel', 'reset'].includes(command)) return false;
  await pool.query('INSERT INTO device_commands(device_id,command) VALUES($1,$2)', [device.id, command]);
  return true;
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/auth/status') {
    const user = await sessionFor(req);
    return sendJson(res, 200, { authenticated: Boolean(user), username: user?.username || null });
  }

  if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(pathname)) {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
    if (!secureRequest(req)) return sendJson(res, 400, { error: 'Use HTTPS to create an account or sign in.' });
    if (!recordAuthAttempt(req)) return sendJson(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    try {
      const body = await readJson(req, 4096);
      const username = String(body.username || '').trim();
      const normalized = username.toLowerCase();
      const password = String(body.password || '');
      if (pathname.endsWith('/register')) {
        if (!validUsername(username)) return sendJson(res, 400, { error: 'Username must be 3–32 letters, numbers, dots, dashes, or underscores.' });
        if (password.length < 12 || password.length > 128) return sendJson(res, 400, { error: 'Password must be 12–128 characters.' });
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = (await derivePassword(password, salt)).toString('hex');
        try {
          const inserted = await pool.query('INSERT INTO users(id,username,username_normalized,password_salt,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,username', [crypto.randomUUID(), username, normalized, salt, passwordHash]);
          clearAuthAttempts(req);
          return createSession(inserted.rows[0], req, res);
        } catch (error) {
          if (error.code === '23505') return sendJson(res, 409, { error: 'That username is already registered.' });
          throw error;
        }
      }
      const found = await pool.query('SELECT id,username,password_salt,password_hash FROM users WHERE username_normalized=$1', [normalized]);
      const user = found.rows[0];
      const salt = user?.password_salt || 'crashsense-login-dummy-salt';
      const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
      const actual = await derivePassword(password, salt);
      if (!user || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return sendJson(res, 401, { error: 'Username or password is incorrect.' });
      clearAuthAttempts(req);
      return createSession(user, req, res);
    } catch (error) {
      const invalidBody = error.message === 'Invalid JSON';
      return sendJson(res, invalidBody ? 400 : 503, { error: invalidBody ? 'Invalid request body.' : 'Could not complete authentication. Try again later.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
    const current = await sessionFor(req);
    if (current) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [current.token_hash]);
    clearSessionCookie(req, res);
    return sendJson(res, 200, { authenticated: false });
  }

  if (req.method === 'POST' && pathname === '/api/device/telemetry') {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!bearer) return sendJson(res, 401, { error: 'Device token required.' });
    const found = await pool.query('SELECT id FROM devices WHERE token_hash=$1', [hash(bearer[1])]);
    if (!found.rows.length) return sendJson(res, 401, { error: 'Device token is not registered.' });
    let data;
    try { data = await readJson(req); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
    if (!data.motion || !data.gps || !data.system) return sendJson(res, 400, { error: 'Expected motion, gps, and system objects.' });
    const deviceId = found.rows[0].id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE devices SET latest_data=$2::jsonb,last_seen_at=now() WHERE id=$1', [deviceId, JSON.stringify(data)]);
      const pending = await client.query(`DELETE FROM device_commands WHERE id=(SELECT id FROM device_commands WHERE device_id=$1 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING command`, [deviceId]);
      await client.query('COMMIT');
      return sendJson(res, 200, { ok: true, command: pending.rows[0]?.command || null });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  const user = await sessionFor(req);
  if (!user) return sendJson(res, 401, { error: 'Sign in to access your CrashSense account.' });

  if (req.method === 'GET' && pathname === '/api/devices') {
    const result = await pool.query('SELECT id,name,token_hint,last_seen_at,created_at FROM devices WHERE owner_id=$1 ORDER BY created_at', [user.user_id]);
    return sendJson(res, 200, { devices: result.rows });
  }

  if (req.method === 'POST' && pathname === '/api/devices') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
    const body = await readJson(req, 4096);
    const name = String(body.name || '').trim().slice(0, 50);
    if (!name) return sendJson(res, 400, { error: 'Give this device a name.' });
    const count = await pool.query('SELECT count(*)::int AS total FROM devices WHERE owner_id=$1', [user.user_id]);
    if (count.rows[0].total >= 25) return sendJson(res, 429, { error: 'An account can register up to 25 devices.' });
    const deviceId = crypto.randomUUID();
    const token = `cs_${crypto.randomBytes(32).toString('base64url')}`;
    const hint = token.slice(-6);
    const result = await pool.query('INSERT INTO devices(id,owner_id,name,token_hash,token_hint) VALUES($1,$2,$3,$4,$5) RETURNING id,name,token_hint,last_seen_at,created_at', [deviceId, user.user_id, name, hash(token), hint]);
    return sendJson(res, 201, { device: result.rows[0], deviceToken: token, tokenShownOnce: true });
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/devices/')) {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
    const id = pathname.split('/').pop();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return sendJson(res, 404, { error: 'Device not found.' });
    const deleted = await pool.query('DELETE FROM devices WHERE id=$1 AND owner_id=$2 RETURNING id', [id, user.user_id]);
    return sendJson(res, deleted.rowCount ? 200 : 404, { deleted: Boolean(deleted.rowCount) });
  }

  if (req.method === 'GET' && ['/api/device/data', '/api/device/location'].includes(pathname)) {
    const device = await ownedDevice(req, user.user_id);
    if (!device) return sendJson(res, 404, { error: 'Choose one of your registered devices.' });
    if (!device.latest_data) return sendJson(res, 404, { error: 'No telemetry has been received from this device yet.' });
    if (pathname.endsWith('/location')) return sendJson(res, 200, { gps: device.latest_data.gps || {} });
    return sendJson(res, 200, publicStatusPayload(device.latest_data));
  }

  if (req.method === 'POST' && ['/api/device/cancel', '/api/device/reset'].includes(pathname)) {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
    const device = await ownedDevice(req, user.user_id);
    if (!device) return sendJson(res, 404, { error: 'Choose one of your registered devices.' });
    const command = pathname.endsWith('/cancel') ? 'cancel' : 'reset';
    await enqueueCommand(device, command);
    return sendJson(res, 202, { queued: true });
  }

  return sendJson(res, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/healthz') {
    try { await pool.query('SELECT 1'); return sendJson(res, 200, { ok: true }); }
    catch { return sendJson(res, 503, { ok: false }); }
  }
  if (url.pathname.startsWith('/api/')) {
    try { return await handleApi(req, res, url); }
    catch (error) {
      console.error('[API] Request failed:', error.message);
      return sendJson(res, 503, { error: 'CrashSense could not complete the request. Try again shortly.' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('Bad Request'); }
  const filePath = path.resolve(publicDir, `.${decodedPath === '/' ? '/index.html' : decodedPath}`);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

async function start() {
  await initializeDatabase();
  await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  server.listen(port, host, () => console.log(`CrashSense multi-user app listening on ${host}:${port}`));
}

if (require.main === module) {
  start().catch(error => { console.error('CrashSense failed to start:', error.message); process.exit(1); });
}

module.exports = { server, start };

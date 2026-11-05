// CrashSense live dashboard server: static assets and cloud relay proxy only.
// No simulator engines or generated telemetry are loaded by this website server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG = require('./src/config');
const publicDir = path.resolve(__dirname, 'public');
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function configuredUsers() {
  try {
    const users = JSON.parse(process.env.CRASH_SENSE_LOCATION_USERS || '[]');
    if (!Array.isArray(users)) return [];
    return users.filter(user => user && typeof user.username === 'string' && user.username && typeof user.password === 'string' && user.password.length >= 12).slice(0, 100);
  } catch { return []; }
}

function configuredAuth() {
  return configuredUsers().length > 0;
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([key]) => key));
}

function activeSession(req) {
  const token = cookies(req).crashsense_session;
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
}

function clientAddress(req) {
  if (process.env.CRASH_SENSE_TRUST_PROXY === '1' && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function originIsSame(req) {
  try {
    return Boolean(req.headers.origin) && new URL(req.headers.origin).host === req.headers.host;
  } catch { return false; }
}

function isSecureRequest(req) {
  const localOnlyBinding = !process.env.HOST || ['localhost', '127.0.0.1', '::1'].includes(process.env.HOST);
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes((req.headers.host || '').split(':')[0]);
  return req.socket.encrypted === true ||
    (process.env.CRASH_SENSE_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') ||
    (localOnlyBinding && localHost);
}

async function readJson(req, limit = 4096) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Request body too large');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Invalid JSON'); }
}

function clearSessionCookie(req, res) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `crashsense_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function privateLocationPayload(data) {
  const gps = data && data.gps || {};
  return {
    hasFix: Boolean(gps.hasFix),
    latitude: gps.latitude ?? null,
    longitude: gps.longitude ?? null,
    speedKmh: gps.speedKmh ?? null,
    satellites: gps.satellites ?? null,
    fixAgeSec: gps.fixAgeSec ?? null,
    mapUrl: typeof gps.mapUrl === 'string' && gps.mapUrl.startsWith('https://') ? gps.mapUrl : null
  };
}

function publicStatusPayload(data) {
  const gps = data && data.gps || {};
  const incident = data && data.incident || {};
  return {
    motion: data.motion || {},
    system: data.system || {},
    detection: data.detection || {},
    gps: {
      hasFix: Boolean(gps.hasFix),
      // Deliberately omit coordinates, speed, and map URL from public status.
      satellites: gps.satellites ?? null,
      fixAgeSec: gps.fixAgeSec ?? null,
      locationLocked: true
    },
    incident: {
      id: incident.id || '',
      status: incident.status || '',
      reason: incident.reason || '',
      peakG: incident.peakG ?? null,
      peakGyro: incident.peakGyro ?? null
    }
  };
}

async function proxyCloud(pathname, method, res, command, transform = value => value) {
  try {
    if (!CONFIG.CLOUD_SERVER_URL || !CONFIG.CLOUD_DASHBOARD_TOKEN) {
      return sendJson(res, 503, { error: 'Cloud relay URL and dashboard token are not configured' });
    }
    const base = new URL(CONFIG.CLOUD_SERVER_URL);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
      return sendJson(res, 503, { error: 'Cloud relay must use HTTPS' });
    }
    const upstream = await fetch(new URL(pathname, base), {
      method,
      signal: AbortSignal.timeout(6000),
      headers: {
        Authorization: `Bearer ${CONFIG.CLOUD_DASHBOARD_TOKEN}`,
        ...(command ? { 'Content-Type': 'application/json' } : {})
      },
      ...(command ? { body: JSON.stringify({ command }) } : {})
    });
    const payloadText = await upstream.text();
    let payload;
    try { payload = transform(JSON.parse(payloadText)); }
    catch {
      return sendJson(res, upstream.ok ? 502 : upstream.status, { error: 'Cloud relay returned an invalid response' });
    }
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
  } catch {
    sendJson(res, 503, { error: 'Cloud relay unavailable. Check the URL and service status.' });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  const requestUrl = new URL(req.url, 'http://localhost');
  const pathname = requestUrl.pathname;

  if (pathname.startsWith('/api/')) {
    if (req.method === 'GET' && pathname === '/api/auth/status') {
      return sendJson(res, 200, { configured: configuredAuth(), authenticated: Boolean(activeSession(req)) });
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      if (!originIsSame(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
      if (!isSecureRequest(req)) return sendJson(res, 400, { error: 'HTTPS is required for location login' });
      if (!configuredAuth()) return sendJson(res, 503, { error: 'Location authentication is not configured on the server' });
      const address = clientAddress(req);
      const record = loginAttempts.get(address);
      if (record && record.blockedUntil > Date.now()) return sendJson(res, 429, { error: 'Too many login attempts. Try again later.' });
      try {
        const body = await readJson(req);
        const submittedUser = String(body.username || '');
        const submittedPassword = String(body.password || '');
        const submitted = crypto.createHash('sha256').update(`${submittedUser}\0${submittedPassword}`).digest();
        let matchedUser = null;
        for (const user of configuredUsers()) {
          const expected = crypto.createHash('sha256').update(`${user.username}\0${user.password}`).digest();
          if (crypto.timingSafeEqual(submitted, expected)) matchedUser = user.username;
        }
        const valid = Boolean(matchedUser);
        if (!valid) {
          const attempts = (record && record.windowUntil > Date.now() ? record.attempts : 0) + 1;
          loginAttempts.set(address, { attempts, windowUntil: Date.now() + LOGIN_WINDOW_MS, blockedUntil: attempts >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOGIN_WINDOW_MS : 0 });
          return sendJson(res, 401, { error: 'Username or password is incorrect' });
        }
        loginAttempts.delete(address);
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, { username: matchedUser, expiresAt: Date.now() + SESSION_MS });
        const secure = req.socket.encrypted || (process.env.CRASH_SENSE_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
        res.setHeader('Set-Cookie', `crashsense_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`);
        return sendJson(res, 200, { authenticated: true, expiresInSec: SESSION_MS / 1000 });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      if (!originIsSame(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
      const current = activeSession(req);
      if (current) sessions.delete(current.token);
      clearSessionCookie(req, res);
      return sendJson(res, 200, { authenticated: false });
    }
    if (req.method === 'GET' && pathname === '/api/device/data') {
      return proxyCloud('/api/device/latest', 'GET', res, undefined, publicStatusPayload);
    }
    if (req.method === 'GET' && pathname === '/api/device/location') {
      if (!activeSession(req)) return sendJson(res, 401, { error: 'Authenticate to view vehicle location' });
      return proxyCloud('/api/device/latest', 'GET', res, undefined, data => ({ gps: privateLocationPayload(data) }));
    }
    if (req.method === 'POST' && ['/api/device/cancel', '/api/cancel'].includes(pathname)) {
      if (!activeSession(req)) return sendJson(res, 401, { error: 'Authenticate before sending a vehicle command' });
      if (!originIsSame(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
      return proxyCloud('/api/device/commands', 'POST', res, 'cancel');
    }
    if (req.method === 'POST' && pathname === '/api/reset') {
      if (!activeSession(req)) return sendJson(res, 401, { error: 'Authenticate before sending a vehicle command' });
      if (!originIsSame(req)) return sendJson(res, 403, { error: 'Request origin rejected' });
      return proxyCloud('/api/device/commands', 'POST', res, 'reset');
    }
    return sendJson(res, 404, { error: 'API route not found' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); } catch {
    res.writeHead(400); return res.end('Bad Request');
  }
  const filePath = path.resolve(publicDir, `.${decodedPath === '/' ? '/index.html' : decodedPath}`);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': stat.size
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(CONFIG.PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`CrashSense dashboard: http://localhost:${CONFIG.PORT}`);
    console.log(`Cloud relay: ${CONFIG.CLOUD_SERVER_URL || '(not configured; live dashboard will remain offline)'}`);
    if (process.env.HOST === '0.0.0.0') console.log('Dashboard is bound to all interfaces; use HTTPS through a trusted reverse proxy.');
  });
}

module.exports = { server };

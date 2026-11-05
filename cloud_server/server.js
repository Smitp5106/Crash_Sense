const http = require('node:http');

const port = Number(process.env.PORT || 8080);
const deviceToken = process.env.DEVICE_TOKEN || '';
const dashboardToken = process.env.DASHBOARD_TOKEN || '';
let latest = null;
const commands = [];

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function authorized(req, token) {
  return token && req.headers.authorization === `Bearer ${token}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 32768) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
  try {
    if (req.method === 'POST' && path === '/api/device/telemetry') {
      if (!authorized(req, deviceToken)) return send(res, 401, { error: 'Unauthorized' });
      const data = await readBody(req);
      if (!data.motion || !data.gps || !data.system) return send(res, 400, { error: 'Expected motion, gps, and system fields' });
      latest = { ...data, receivedAt: new Date().toISOString() };
      return send(res, 200, { ok: true, command: commands.shift() || null });
    }
    if (!authorized(req, dashboardToken)) return send(res, 401, { error: 'Unauthorized' });
    if (req.method === 'GET' && path === '/api/device/latest') {
      return latest ? send(res, 200, latest) : send(res, 404, { error: 'No board telemetry received yet' });
    }
    if (req.method === 'POST' && path === '/api/device/commands') {
      const data = await readBody(req);
      if (!['cancel', 'reset'].includes(data.command)) return send(res, 400, { error: 'Command must be cancel or reset' });
      if (commands.length >= 8) return send(res, 429, { error: 'Command queue full' });
      commands.push(data.command);
      return send(res, 202, { ok: true, queued: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, error.message === 'Invalid JSON' ? 400 : 413, { error: error.message });
  }
}).listen(port, '0.0.0.0', () => console.log(`CrashSense cloud relay listening on ${port}`));

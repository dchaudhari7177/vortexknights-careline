// CareLine_VortexKnights mock clinic API. Zero dependencies: `node server.js`.
// Talkdesk Connections only speaks REST + JSON (or form-encoded), passes inputs as strings/numbers,
// and can't map arrays at the root, so every endpoint takes a flat body and returns a flat object.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as clinic from './src/clinic.js';
import { triage } from './src/triage.js';
import { handleMcp } from './src/mcp.js';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.API_KEY || ''; // when set, every /api call needs header x-api-key (or ?key=)
const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Exposed on /api/health so we can tell from outside whether Talkdesk is actually reaching us.
const mcpStats = { requests: 0, last_method: '', last_at: '', last_user_agent: '' };

const routes = {
  'POST /api/patients/lookup': clinic.lookupPatient,
  'POST /api/patients/verify': clinic.verifyPatient,
  'POST /api/patients/register': clinic.registerPatient,
  'POST /api/triage': triage,
  'POST /api/slots/search': clinic.findSlots,
  'POST /api/appointments/book': clinic.bookAppointment,
  'POST /api/appointments/next': clinic.nextAppointment,
  'POST /api/appointments/cancel': clinic.cancelAppointment,
  'POST /api/appointments/reschedule': clinic.rescheduleAppointment,
  'POST /api/labs/status': clinic.labReportStatus,
  'POST /api/handoff': clinic.createHandoff,
  'POST /api/cases/update': clinic.updateCase,
  'GET /api/state': () => clinic.snapshot(),
  'POST /api/admin/reset': () => (clinic.reset(), { reset: true, message: 'Demo data reset.' }),
  'GET /api/health': () => ({ ok: true, clinic: clinic.CLINIC_NAME, today: clinic.todayIST(), mcp: mcpStats }),
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const type = req.headers['content-type'] || '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
    return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8'), 'text/html; charset=utf-8');
  }

  const authorized = !API_KEY || req.headers['x-api-key'] === API_KEY || req.headers.authorization === `Bearer ${API_KEY}` || url.searchParams.get('key') === API_KEY;

  if (url.pathname.replace(/\/+$/, '') === '/mcp') {
    Object.assign(mcpStats, { requests: mcpStats.requests + 1, last_method: req.method, last_at: new Date().toISOString(), last_user_agent: req.headers['user-agent'] || '' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'Stateless MCP server: POST JSON-RPC messages, no SSE stream.' });
    if (!authorized) return send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
    const payload = await readBody(req);
    console.log(new Date().toISOString(), 'MCP <-', [].concat(payload).map((m) => m && m.method).join(','), req.headers['user-agent'] || '');
    const { status, body } = handleMcp(payload);
    if (!body) {
      res.writeHead(202, { 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }
    return send(res, status, body);
  }

  const handler = routes[`${req.method} ${url.pathname.replace(/\/+$/, '')}`];
  if (!handler) return send(res, 404, { error: 'not_found', message: `No route ${req.method} ${url.pathname}` });

  const isPublic = url.pathname === '/api/health' || url.pathname === '/api/state';
  if (!authorized && !isPublic) {
    return send(res, 401, { error: 'unauthorized', message: 'Missing or wrong x-api-key header.' });
  }

  try {
    const input = { ...Object.fromEntries(url.searchParams), ...(req.method === 'POST' ? await readBody(req) : {}) };
    delete input.key;
    const result = handler(input);
    if (url.pathname !== '/api/state') console.log(new Date().toISOString(), req.method, url.pathname, JSON.stringify(input), '->', result.message ? result.message.slice(0, 90) : 'ok');
    send(res, 200, result);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'server_error', message: 'Something went wrong on our side. Apologise and transfer to the front desk.' });
  }
});

server.listen(PORT, () => {
  console.log(`CareLine mock clinic API on http://localhost:${PORT}  (dashboard at /, API under /api)`);
  if (API_KEY) console.log('API key protection is ON');
});

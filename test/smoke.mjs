// End-to-end walk through every demo call path against a fresh server on a temp state file.
// Run: node test/smoke.mjs

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 18787;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), STATE_FILE: path.join(os.tmpdir(), `careline-smoke-${Date.now()}.json`) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.once('data', resolve));

const post = async (p, body, form = false) => {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  assert.equal(res.status, 200, p);
  const json = await res.json();
  assert.ok(!Array.isArray(json), `${p} must not return a root array`);
  for (const [k, v] of Object.entries(json)) assert.ok(v === null || typeof v !== 'object', `${p}.${k} must be scalar for Talkdesk mapping`);
  return json;
};

// Next non-Sunday at least two days out in IST, so the clinic is open whenever the suite runs.
const WORKDAY = (() => {
  let d = new Date(Date.now() + 330 * 60 * 1000 + 2 * 86400000);
  if (d.getUTCDay() === 0) d = new Date(d.getTime() + 86400000);
  return d.toISOString().slice(0, 10);
})();

let ok = 0;
const step = async (name, fn) => {
  try { await fn(); ok++; console.log('  ok  ', name); }
  catch (e) { console.log('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};

try {
  let patient;
  await step('lookup by Talkdesk-style caller ID', async () => {
    patient = await post('/api/patients/lookup', { phone: '+91 98765 43210' });
    assert.equal(patient.found, true);
    assert.equal(patient.patient_id, 'P1001');
    assert.equal(patient.has_upcoming_appointment, true);
  });
  await step('unknown caller', async () => assert.equal((await post('/api/patients/lookup', { phone: '+911111111111' })).found, false));
  await step('verify DOB in spoken format', async () => assert.equal((await post('/api/patients/verify', { patient_id: 'P1001', dob: '14 March 1968' })).verified, true));
  await step('reject wrong DOB', async () => assert.equal((await post('/api/patients/verify', { patient_id: 'p1001', dob: '1970-01-01' })).verified, false));

  await step('triage: chest pain -> emergency', async () => assert.equal((await post('/api/triage', { symptoms: 'my father has chest pain and is sweating' })).urgency, 'emergency'));
  await step('triage: Hindi breathing -> emergency', async () => assert.equal((await post('/api/triage', { symptoms: 'saans lene mein takleef' })).urgency, 'emergency'));
  await step('triage: high fever child -> urgent pediatrics', async () => {
    const t = await post('/api/triage', { symptoms: 'my daughter has high fever since last night', age: '5' });
    assert.equal(t.urgency, 'urgent');
    assert.equal(t.recommended_specialty, 'Pediatrics');
  });
  await step('triage: skin rash -> routine dermatology', async () => {
    const t = await post('/api/triage', { symptoms: 'itchy rash on my arm' });
    assert.equal(t.urgency, 'routine');
    assert.equal(t.recommended_specialty, 'Dermatology');
  });

  let slots;
  await step('slot search by plain words (form-encoded, like Talkdesk)', async () => {
    slots = await post('/api/slots/search', { specialty: 'heart doctor', date: WORKDAY, time_of_day: 'morning' }, true);
    assert.ok(slots.slots_count > 0, slots.message);
    assert.match(slots.slot_1_id, /^D0[12]-\d{8}-\d{4}$/);
  });
  await step('slot search by doctor name', async () => assert.ok((await post('/api/slots/search', { doctor: 'Kavya' })).slots_count > 0));

  let booking;
  await step('book slot', async () => {
    booking = await post('/api/appointments/book', { patient_id: 'P1001', slot_id: slots.slot_1_id, reason: 'palpitations' });
    assert.equal(booking.booked, true, booking.message);
    assert.match(booking.sms_text, /confirmed/);
  });
  await step('double-booking the same slot is refused', async () => assert.equal((await post('/api/appointments/book', { patient_id: 'P1002', slot_id: slots.slot_1_id })).booked, false));
  await step('booked slot disappears from search', async () => {
    const again = await post('/api/slots/search', { specialty: 'cardiology', date: WORKDAY, time_of_day: 'morning' });
    assert.notEqual(again.slot_1_id, slots.slot_1_id);
  });
  await step('reschedule to option 2', async () => {
    const r = await post('/api/appointments/reschedule', { appointment_id: booking.appointment_id, patient_id: 'P1001', new_slot_id: slots.slot_2_id });
    assert.equal(r.rescheduled, true, r.message);
  });
  await step('next appointment', async () => assert.equal((await post('/api/appointments/next', { patient_id: 'P1001' })).found, true));
  await step('cancel by spoken id "apt 1001"', async () => assert.equal((await post('/api/appointments/cancel', { appointment_id: 'apt 1001'.replace(' ', ''), patient_id: 'P1001' })).cancelled, true));
  await step('cannot cancel another patient\'s appointment', async () => assert.equal((await post('/api/appointments/cancel', { appointment_id: 'APT-1002', patient_id: 'P1001' })).cancelled, false));
  await step('lab report status', async () => assert.equal((await post('/api/labs/status', { patient_id: 'P1002' })).status, 'ready'));
  await step('register new caller', async () => assert.equal((await post('/api/patients/register', { name: 'Test Caller', phone: '+91 90000 00001', dob: '01/02/2000' })).registered, true));
  await step('emergency handoff shows on dashboard state', async () => {
    const h = await post('/api/handoff', { phone: '+919876543210', urgency: 'Emergency', reason: 'Chest pain', summary: 'Father, 58, chest pain 20 min, sweating. Told to call 108.' });
    assert.match(h.case_id, /^CASE-\d+$/);
    const state = await (await fetch(BASE + '/api/state')).json();
    assert.equal(state.cases[0].urgency, 'emergency');
    assert.equal(state.cases[0].patient, 'Ramesh Kumar');
  });
  const rpc = async (body) => {
    const res = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    return { status: res.status, json: res.status === 202 ? null : await res.json() };
  };
  await step('MCP initialize negotiates protocol', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
    assert.equal(json.result.protocolVersion, '2025-03-26');
    assert.ok(json.result.capabilities.tools);
  });
  await step('MCP initialized notification -> 202', async () => assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202));
  await step('MCP tools/list fits Talkdesk 5-skill cap', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(json.result.tools.map((t) => t.name), ['patient', 'triage_symptoms', 'appointments', 'lab_report_status', 'create_handoff']);
    for (const t of json.result.tools) assert.equal(t.inputSchema.type, 'object', t.name);
  });
  const call = async (name, args) => (await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).json.result.structuredContent;
  await step('MCP patient action=lookup', async () => assert.equal((await call('patient', { action: 'lookup', phone: '98450 12345' })).patient_id, 'P1002'));
  await step('MCP appointments search then book', async () => {
    const s = await call('appointments', { action: 'search', specialty: 'skin doctor' });
    assert.ok(s.slots_count > 0, s.message);
    assert.equal((await call('appointments', { action: 'book', patient_id: 'P1002', slot_id: s.slot_1_id })).booked, true);
  });
  await step('MCP unknown action is a speakable error', async () => assert.match((await call('appointments', { action: 'delete' })).message, /Use one of/));
  await step('MCP tools/call triage returns structured result', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'triage_symptoms', arguments: { symptoms: 'chest pain' } } });
    assert.equal(json.result.structuredContent.urgency, 'emergency');
    assert.match(json.result.content[0].text, /emergency/);
  });
  await step('MCP unknown tool -> JSON-RPC error', async () => assert.equal((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).json.error.code, -32602));
  await step('MCP GET -> 405', async () => assert.equal((await fetch(BASE + '/mcp')).status, 405));

  await step('dashboard page serves',async () => assert.match(await (await fetch(BASE + '/')).text(), /CareLine/));
  await step('unknown route 404s', async () => assert.equal((await fetch(BASE + '/api/nope', { method: 'POST' })).status, 404));
} finally {
  server.kill();
}
console.log(`\n${ok} checks passed${process.exitCode ? ', some FAILED' : ''}`);

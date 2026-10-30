// Minimal MCP server over Streamable HTTP (stateless, JSON responses, no SSE).
// Talkdesk binds one MCP tool per skill and caps an agent at 5 skills, so the 11 clinic
// operations are grouped into exactly 5 tools, each picking its operation with an `action` enum.

import * as clinic from './clinic.js';
import { triage } from './triage.js';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const str = (description) => ({ type: 'string', description });

// Picks the operation named by args.action; unknown actions come back as a speakable error.
function dispatch(actions) {
  return (args) => {
    const fn = actions[String(args.action || '').trim().toLowerCase()];
    if (!fn) return { error: true, message: `Unknown action "${args.action}". Use one of: ${Object.keys(actions).join(', ')}.` };
    return fn(args);
  };
}

const TOOLS = [
  {
    name: 'patient',
    description:
      'Identify the caller. action=lookup with phone at the start of every call. action=verify with patient_id and dob before sharing appointments or lab reports. action=register with name, phone, dob when lookup finds nobody.',
    props: {
      action: { type: 'string', enum: ['lookup', 'verify', 'register'], description: 'lookup, verify or register' },
      phone: str('Caller phone number, any format, e.g. +91 98765 43210 (lookup, register)'),
      patient_id: str('Patient ID from lookup, e.g. P1001 (verify)'),
      dob: str('Date of birth as the caller said it, e.g. 14 March 1968 (verify, register)'),
      name: str('Full name (register)'),
      language: str('Preferred language: English, Hindi or Kannada (register)'),
    },
    required: ['action'],
    run: dispatch({ lookup: clinic.lookupPatient, verify: clinic.verifyPatient, register: clinic.registerPatient }),
  },
  {
    name: 'triage_symptoms',
    description: 'Call whenever the caller describes ANY symptom, before offering appointments. Returns urgency (emergency, urgent or routine), the recommended specialty and what to do next.',
    props: { symptoms: str("The caller's symptoms translated to English, in their own words"), age: str('Patient age in years, if known') },
    required: ['symptoms'],
    run: triage,
  },
  {
    name: 'appointments',
    description:
      'Appointments. action=search finds 3 free slots (specialty or doctor, date, time_of_day). action=book with patient_id and exact slot_id. action=next, reschedule (appointment_id, new_slot_id) or cancel (appointment_id) with patient_id. Confirm before changes.',
    props: {
      action: { type: 'string', enum: ['search', 'book', 'next', 'reschedule', 'cancel'], description: 'search, book, next, reschedule or cancel' },
      specialty: str('Specialty or plain words, e.g. Cardiology, skin doctor, child specialist (search)'),
      doctor: str('Doctor name, if the caller asked for one (search)'),
      date: str('Day wanted: today, tomorrow, Monday, 5 November or YYYY-MM-DD; empty = earliest (search)'),
      time_of_day: str('morning or evening (search)'),
      patient_id: str('Patient ID (book, next, reschedule, cancel)'),
      slot_id: str('Exact slot id from search, e.g. D01-20261105-1030 (book)'),
      reason: str('Short reason for the visit (book)'),
      appointment_id: str('Appointment ID, e.g. APT-1001 (reschedule, cancel)'),
      new_slot_id: str('Exact slot id from search (reschedule)'),
    },
    required: ['action'],
    run: dispatch({ search: clinic.findSlots, book: clinic.bookAppointment, next: clinic.nextAppointment, reschedule: clinic.rescheduleAppointment, cancel: clinic.cancelAppointment }),
  },
  {
    name: 'lab_report_status',
    description: 'Tell a verified patient whether their lab reports are ready. Never interpret results.',
    props: { patient_id: str('Patient ID') },
    required: ['patient_id'],
    run: clinic.labReportStatus,
  },
  {
    name: 'create_handoff',
    description: "Before transferring to a human, save a 2-3 sentence summary so the human agent doesn't have to re-ask. Use urgency emergency for red-flag symptoms.",
    props: {
      patient_id: str('Patient ID, if known'),
      phone: str('Caller phone number, if known'),
      urgency: { type: 'string', enum: ['emergency', 'urgent', 'routine'], description: 'How urgent the handoff is' },
      reason: str('Why the caller needs a human, in a few words'),
      summary: str('2-3 sentences: who is calling, what they need, what the AI already did'),
    },
    required: ['reason', 'summary'],
    run: clinic.createHandoff,
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

// Talkdesk forces every *required* input to be wired to a fixed value or orchestration variable,
// while optional ones are left for the LLM to fill. So nothing is advertised as required; the
// `required` lists are documentation only, and the handlers answer missing fields with a message.
// Descriptions stay under 300 chars because Talkdesk copies them into a 300-char skill field.
const listing = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: { type: 'object', properties: t.props, required: [] },
}));

function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const isNotification = id === undefined || id === null;
  const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const fail = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'careline-vortexknights', title: 'CareLine clinic tools (VortexKnights)', version: '1.0.0' },
        instructions: 'Tools for the Vortex Multispeciality Clinic front desk. Every tool result has a "message" field telling you what to say or do next.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: listing });
    case 'tools/call': {
      const tool = byName.get(params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
      try {
        const result = tool.run(params.arguments || {});
        console.log(new Date().toISOString(), 'MCP', tool.name, JSON.stringify(params.arguments || {}), '->', (result.message || '').slice(0, 90));
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (err) {
        console.error(err);
        return ok({ content: [{ type: 'text', text: 'The clinic system had an error. Apologise and transfer to the front desk.' }], isError: true });
      }
    }
    default:
      if (method && method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

// Returns { status, body } where body is a JSON-RPC response (or batch), or null for 202 Accepted.
export function handleMcp(payload) {
  if (Array.isArray(payload)) {
    const out = payload.map(handle).filter(Boolean);
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  if (!payload || payload.jsonrpc !== '2.0') {
    return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } } };
  }
  const res = handle(payload);
  return res ? { status: 200, body: res } : { status: 202, body: null };
}

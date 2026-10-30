// Clinic domain: doctors, patients, slots, appointments, lab reports, handoff cases.
// Everything is computed relative to "now" in IST so the demo data never goes stale.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLINIC_NAME = 'Vortex Multispeciality Clinic';
export const CLINIC_CITY = 'Bengaluru';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- time helpers (all dates are IST "YYYY-MM-DD", times "HHMM") ----------

function istDate(ms = Date.now()) {
  return new Date(ms + IST_OFFSET_MS); // read with getUTC* getters
}

export function todayIST() {
  return istDate().toISOString().slice(0, 10);
}

function nowHHMM() {
  const d = istDate();
  return d.getUTCHours() * 100 + d.getUTCMinutes();
}

function addDays(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(ymd) {
  return new Date(ymd + 'T00:00:00Z').getUTCDay();
}

export function speakDate(ymd) {
  const today = todayIST();
  if (ymd === today) return 'today';
  if (ymd === addDays(today, 1)) return 'tomorrow';
  const d = new Date(ymd + 'T00:00:00Z');
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function speakTime(hhmm) {
  const h = Math.floor(hhmm / 100);
  const m = hhmm % 100;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Accepts: today, tomorrow, day after tomorrow, weekday names, YYYY-MM-DD, DD-MM-YYYY, DD/MM, "5 November", "Nov 5".
export function parseDate(input) {
  const today = todayIST();
  if (input === undefined || input === null || String(input).trim() === '') return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'today' || s === 'now' || s === 'aaj' || s === 'ivattu') return today;
  if (s.includes('day after')) return addDays(today, 2);
  if (s === 'tomorrow' || s === 'tmrw' || s === 'naale') return addDays(today, 1);

  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w.slice(0, 3).toLowerCase()}(${w.slice(3).toLowerCase()})?\\b`).test(s));
  if (wd >= 0) {
    let delta = (wd - weekdayOf(today) + 7) % 7;
    if (delta === 0 && s.includes('next')) delta = 7;
    return addDays(today, delta);
  }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today.slice(0, 4);
    return rollForward(`${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, !m[3]);
  }

  const monthIdx = MONTHS.findIndex((mo) => s.includes(mo.slice(0, 3).toLowerCase()));
  const day = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (monthIdx >= 0 && day) {
    const ymd = `${today.slice(0, 4)}-${String(monthIdx + 1).padStart(2, '0')}-${day[1].padStart(2, '0')}`;
    return rollForward(ymd, true);
  }
  return null;
}

function rollForward(ymd, yearWasGuessed) {
  if (Number.isNaN(Date.parse(ymd + 'T00:00:00Z'))) return null;
  if (yearWasGuessed && ymd < todayIST()) return `${Number(ymd.slice(0, 4)) + 1}${ymd.slice(4)}`;
  return ymd;
}

// ---------- reference data ----------

export const DOCTORS = [
  { id: 'D01', name: 'Dr. Ananya Rao', specialty: 'Cardiology', off: 4 },
  { id: 'D02', name: 'Dr. Vikram Shetty', specialty: 'Cardiology', off: 2 },
  { id: 'D03', name: 'Dr. Meera Iyer', specialty: 'General Medicine', off: -1 },
  { id: 'D04', name: 'Dr. Arjun Gowda', specialty: 'General Medicine', off: 3 },
  { id: 'D05', name: 'Dr. Kavya Nair', specialty: 'Pediatrics', off: 1 },
  { id: 'D06', name: 'Dr. Rahul Deshpande', specialty: 'Orthopedics', off: 5 },
  { id: 'D07', name: 'Dr. Sneha Kulkarni', specialty: 'Dermatology', off: 2 },
  { id: 'D08', name: 'Dr. Imran Khan', specialty: 'ENT', off: 4 },
  { id: 'D09', name: 'Dr. Lakshmi Prasad', specialty: 'Obstetrics and Gynecology', off: 1 },
];

const SPECIALTY_WORDS = [
  ['Cardiology', ['cardio', 'heart', 'palpitation', 'bp', 'blood pressure', 'hypertension', 'chest']],
  ['Pediatrics', ['pediatric', 'paediatric', 'child', 'kid', 'baby', 'infant', 'son', 'daughter', 'vaccin']],
  ['Orthopedics', ['ortho', 'bone', 'joint', 'knee', 'back pain', 'spine', 'fracture', 'shoulder', 'sprain']],
  ['Dermatology', ['derma', 'skin', 'rash', 'acne', 'itch', 'hair fall', 'pimple', 'allergy']],
  ['ENT', ['ent', 'ear', 'nose', 'throat', 'sinus', 'tonsil', 'hearing']],
  ['Obstetrics and Gynecology', ['gyn', 'obstet', 'pregnan', 'period', 'menstrua', 'women']],
  ['General Medicine', ['general', 'physician', 'fever', 'cold', 'cough', 'diabet', 'sugar', 'checkup', 'check-up', 'body pain', 'gp']],
];

export function matchSpecialty(text) {
  if (!text) return null;
  const s = ' ' + String(text).toLowerCase() + ' ';
  for (const [name] of SPECIALTY_WORDS) {
    if (s.includes(name.toLowerCase())) return name;
  }
  for (const [name, words] of SPECIALTY_WORDS) {
    if (words.some((w) => (w.length <= 3 ? new RegExp(`\\b${w}\\b`).test(s) : s.includes(w)))) return name;
  }
  return null;
}

const SESSION_TIMES = [930, 1000, 1030, 1100, 1130, 1200, 1600, 1630, 1700, 1730, 1800];

// Deterministic "already booked by someone else" so availability looks realistic.
function takenByOthers(slotId) {
  let h = 0;
  for (const c of slotId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 10 < 4;
}

function seedState() {
  const today = todayIST();
  return {
    seq: { patient: 1004, appointment: 1003, case: 500 },
    patients: [
      { id: 'P1001', name: 'Ramesh Kumar', phone: '9876543210', dob: '1968-03-14', language: 'Kannada', notes: 'Hypertension, on amlodipine' },
      { id: 'P1002', name: 'Priya Sharma', phone: '9845012345', dob: '1995-07-22', language: 'Hindi', notes: '' },
      { id: 'P1003', name: 'Aarav Menon', phone: '9900112233', dob: '2020-01-09', language: 'English', notes: 'Child; guardian Deepa Menon' },
      { id: 'P1004', name: 'Fatima Begum', phone: '9880011223', dob: '1952-11-30', language: 'Hindi', notes: 'Type 2 diabetes' },
    ],
    appointments: [
      apptSeed('APT-1001', 'P1001', 'D01', nextWorkingDay(today, 'D01', 2), 1030, 'BP follow-up'),
      apptSeed('APT-1002', 'P1004', 'D03', nextWorkingDay(today, 'D03', 3), 1100, 'Diabetes review'),
      apptSeed('APT-1003', 'P1003', 'D05', nextWorkingDay(today, 'D05', 1), 1630, 'Vaccination'),
    ],
    labReports: [
      { patient_id: 'P1002', test: 'Complete Blood Count', status: 'ready', note: 'All values within normal range' },
      { patient_id: 'P1004', test: 'HbA1c', status: 'pending', note: 'Expected by tomorrow evening' },
      { patient_id: 'P1001', test: 'Lipid Profile', status: 'ready', note: 'LDL slightly high; doctor will discuss at follow-up' },
    ],
    cases: [],
    events: [{ at: new Date().toISOString(), type: 'system', text: 'Demo data loaded' }],
  };
}

function apptSeed(id, patientId, doctorId, date, time, reason) {
  return { id, patient_id: patientId, doctor_id: doctorId, slot_id: slotIdOf(doctorId, date, time), date, time, reason, status: 'booked', source: 'seed', created_at: new Date().toISOString() };
}

function nextWorkingDay(from, doctorId, minDays) {
  let d = addDays(from, minDays);
  while (!worksOn(DOCTORS.find((x) => x.id === doctorId), d)) d = addDays(d, 1);
  return d;
}

function worksOn(doctor, ymd) {
  const wd = weekdayOf(ymd);
  return wd !== 0 && wd !== doctor.off;
}

function slotIdOf(doctorId, ymd, hhmm) {
  return `${doctorId}-${ymd.replaceAll('-', '')}-${String(hhmm).padStart(4, '0')}`;
}

function parseSlotId(slotId) {
  const m = String(slotId || '').trim().toUpperCase().match(/^(D\d{2})-(\d{4})(\d{2})(\d{2})-(\d{4})$/);
  if (!m) return null;
  const doctor = DOCTORS.find((d) => d.id === m[1]);
  if (!doctor) return null;
  return { doctor, date: `${m[2]}-${m[3]}-${m[4]}`, time: Number(m[5]), slotId: m[0] };
}

// ---------- state store ----------

const STATE_FILE = process.env.STATE_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'state.json');
let state = load();

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved && saved.patients) return saved;
  } catch {}
  return seedState();
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {} // read-only hosts just keep state in memory
}

function log(type, text) {
  state.events.unshift({ at: new Date().toISOString(), type, text });
  state.events = state.events.slice(0, 100);
}

export function reset() {
  state = seedState();
  save();
}

export function snapshot() {
  const describe = (a) => ({ ...a, doctor: doctorById(a.doctor_id)?.name, patient: patientById(a.patient_id)?.name, when: `${speakDate(a.date)} at ${speakTime(a.time)}` });
  return {
    clinic: CLINIC_NAME,
    today: todayIST(),
    patients: state.patients,
    appointments: state.appointments.map(describe).reverse(),
    cases: [...state.cases].reverse(),
    labReports: state.labReports.map((r) => ({ ...r, patient: patientById(r.patient_id)?.name })),
    events: state.events,
  };
}

const doctorById = (id) => DOCTORS.find((d) => d.id === id);
const patientById = (id) => state.patients.find((p) => p.id === String(id || '').trim().toUpperCase());

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function firstName(p) {
  return p.name.split(' ')[0];
}

// ---------- operations (each returns a flat object with a speakable `message`) ----------

export function lookupPatient({ phone }) {
  if (normalizePhone(phone).length < 10) return { found: false, message: "No phone number yet. Ask the caller for their 10-digit phone number, then look them up again." };
  const p = state.patients.find((x) => x.phone === normalizePhone(phone));
  if (!p) return { found: false, message: 'No patient record is linked to this phone number. If the caller mentioned ANY symptom, call triage_symptoms right now before anything else. Otherwise ask for their name and date of birth and register them.' };
  const next = nextAppointmentOf(p.id);
  log('lookup', `Caller identified as ${p.name}`);
  return {
    found: true,
    patient_id: p.id,
    name: p.name,
    first_name: firstName(p),
    preferred_language: p.language,
    has_upcoming_appointment: Boolean(next),
    upcoming_appointment_id: next?.id || '',
    upcoming_appointment_text: next ? describeAppt(next) : '',
    message: `Caller is ${p.name}, prefers ${p.language}.` + (next ? ` Upcoming: ${describeAppt(next)}.` : ' No upcoming appointments.') + ' Verify date of birth before sharing any medical details.',
  };
}

export function verifyPatient({ patient_id, dob }) {
  const p = patientById(patient_id);
  if (!p) return { verified: false, message: 'Unknown patient ID.' };
  if (!String(dob || '').trim()) return { verified: false, patient_id: p.id, message: `Ask ${firstName(p)} for their date of birth first, then verify again.` };
  const given = parseDob(dob);
  const ok = given === p.dob;
  log('verify', `${p.name}: identity ${ok ? 'verified' : 'NOT verified'}`);
  return ok
    ? { verified: true, patient_id: p.id, message: `Identity verified for ${p.name}.` }
    : { verified: false, patient_id: p.id, message: 'Date of birth does not match our records. Do not share medical details. Offer one retry, then transfer to the front desk.' };
}

function parseDob(raw) {
  const s = String(raw || '').trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const monthIdx = MONTHS.findIndex((mo) => s.includes(mo.slice(0, 3).toLowerCase()));
  const nums = s.match(/\d+/g) || [];
  const year = nums.find((n) => n.length === 4);
  const day = nums.find((n) => n.length <= 2);
  if (monthIdx >= 0 && year && day) return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  return s;
}

export function registerPatient({ name, phone, dob, language }) {
  if (!name || !phone) return { registered: false, message: 'Name and phone number are required to register.' };
  const existing = state.patients.find((x) => x.phone === normalizePhone(phone));
  if (existing) return { registered: false, patient_id: existing.id, message: `This number is already registered to ${existing.name}.` };
  const p = { id: `P${++state.seq.patient}`, name: String(name).trim(), phone: normalizePhone(phone), dob: parseDob(dob), language: language || 'English', notes: '' };
  state.patients.push(p);
  log('register', `New patient registered: ${p.name}`);
  save();
  return { registered: true, patient_id: p.id, name: p.name, message: `Registered ${p.name} with patient ID ${p.id}.` };
}

export function findSlots({ specialty, date, time_of_day, doctor }) {
  const spec = matchSpecialty(specialty) || (doctor ? null : 'General Medicine');
  const doctorQuery = String(doctor || '').toLowerCase().replace('dr.', '').replace('dr ', '').trim();
  const doctors = DOCTORS.filter((d) => (doctorQuery ? d.name.toLowerCase().includes(doctorQuery) : d.specialty === spec));
  if (!doctors.length) return { slots_count: 0, message: `We do not have a doctor matching "${doctor || specialty}".` };

  const wanted = parseDate(date);
  const tod = String(time_of_day || '').toLowerCase();
  const timeOk = (t) => (tod.startsWith('morn') ? t < 1300 : tod.startsWith('even') || tod.startsWith('after') ? t >= 1300 : true);
  const today = todayIST();
  const cutoff = nowHHMM() + 30;
  const booked = new Set(state.appointments.filter((a) => a.status === 'booked').map((a) => a.slot_id));

  const slots = [];
  const days = wanted ? [wanted] : Array.from({ length: 7 }, (_, i) => addDays(today, i));
  for (const day of days) {
    if (day < today) continue;
    for (const t of SESSION_TIMES) {
      for (const d of doctors) {
        if (!worksOn(d, day) || !timeOk(t) || (day === today && t < cutoff)) continue;
        const id = slotIdOf(d.id, day, t);
        if (booked.has(id) || takenByOthers(id)) continue;
        slots.push({ id, text: `${speakDate(day)} at ${speakTime(t)} with ${d.name}` });
      }
    }
    if (slots.length >= 3) break;
  }

  const top = slots.slice(0, 3);
  const label = doctorQuery ? doctors[0].name : spec;
  if (!top.length) {
    return { slots_count: 0, specialty: spec || doctors[0].specialty, message: `No free ${label} slots ${wanted ? 'on ' + speakDate(wanted) : 'this week'}${tod ? ' in the ' + tod : ''}. Offer another day or a callback.` };
  }
  const out = { slots_count: top.length, specialty: spec || doctors[0].specialty };
  top.forEach((s, i) => {
    out[`slot_${i + 1}_id`] = s.id;
    out[`slot_${i + 1}_text`] = s.text;
  });
  out.message = `Available ${label} slots: ` + top.map((s, i) => `option ${i + 1}, ${s.text} (slot_id ${s.id})`).join('; ') + '. Read the options without the slot ids; book with the slot_id of the option chosen.';
  return out;
}

export function bookAppointment({ patient_id, slot_id, reason }) {
  const p = patientById(patient_id);
  if (!p) return { booked: false, message: 'Unknown patient ID. Look up or register the patient first.' };
  const slot = parseSlotId(slot_id);
  if (!slot) return { booked: false, message: 'That slot ID is not valid. Search for available slots again.' };
  const taken = takenByOthers(slot.slotId) || state.appointments.some((a) => a.slot_id === slot.slotId && a.status === 'booked');
  if (taken || !worksOn(slot.doctor, slot.date)) return { booked: false, message: 'Sorry, that slot was just taken. Search again and offer the next option.' };

  const a = { id: `APT-${++state.seq.appointment}`, patient_id: p.id, doctor_id: slot.doctor.id, slot_id: slot.slotId, date: slot.date, time: slot.time, reason: reason || '', status: 'booked', source: 'ai-agent', created_at: new Date().toISOString() };
  state.appointments.push(a);
  log('booked', `${p.name} booked ${a.id}: ${describeAppt(a)}`);
  save();
  return {
    booked: true,
    appointment_id: a.id,
    appointment_text: describeAppt(a),
    sms_text: `${CLINIC_NAME}: Hi ${firstName(p)}, your appointment ${a.id} is confirmed for ${describeAppt(a)}. Please arrive 15 minutes early. Reply C to cancel.`,
    message: `Booked. Appointment ${a.id} for ${p.name}, ${describeAppt(a)}. Ask them to arrive 15 minutes early.`,
  };
}

export function nextAppointment({ patient_id }) {
  const p = patientById(patient_id);
  if (!p) return { found: false, message: 'Unknown patient ID.' };
  const a = nextAppointmentOf(p.id);
  if (!a) return { found: false, message: `${p.name} has no upcoming appointments.` };
  return { found: true, appointment_id: a.id, appointment_text: describeAppt(a), doctor: doctorById(a.doctor_id).name, specialty: doctorById(a.doctor_id).specialty, message: `${p.name}'s next appointment is ${a.id}, ${describeAppt(a)}.` };
}

export function cancelAppointment({ appointment_id, patient_id }) {
  const a = findAppt(appointment_id, patient_id);
  if (!a) return { cancelled: false, message: 'No active appointment found with that ID for this patient.' };
  a.status = 'cancelled';
  log('cancelled', `${patientById(a.patient_id).name} cancelled ${a.id} (${describeAppt(a)})`);
  save();
  return { cancelled: true, appointment_id: a.id, message: `Appointment ${a.id} on ${speakDate(a.date)} at ${speakTime(a.time)} has been cancelled.` };
}

// slot_id is accepted as the new slot too: Talkdesk wires inputs to shared orchestration variables,
// so reusing the search/book slot variable saves the agent capturing a separate one.
export function rescheduleAppointment({ appointment_id, patient_id, new_slot_id, slot_id }) {
  const a = findAppt(appointment_id, patient_id);
  if (!a) return { rescheduled: false, message: 'No active appointment found with that ID for this patient.' };
  const booking = bookAppointment({ patient_id: a.patient_id, slot_id: new_slot_id || slot_id, reason: a.reason });
  if (!booking.booked) return { rescheduled: false, message: booking.message };
  a.status = 'rescheduled';
  log('rescheduled', `${a.id} moved to ${booking.appointment_id}`);
  save();
  return { rescheduled: true, old_appointment_id: a.id, appointment_id: booking.appointment_id, appointment_text: booking.appointment_text, sms_text: booking.sms_text, message: `Done. The appointment is now ${booking.appointment_text}. New reference ${booking.appointment_id}.` };
}

export function labReportStatus({ patient_id }) {
  const p = patientById(patient_id);
  if (!p) return { found: false, message: 'Unknown patient ID.' };
  const reports = state.labReports.filter((r) => r.patient_id === p.id);
  if (!reports.length) return { found: false, message: `No lab reports on file for ${p.name}.` };
  const r = reports[0];
  log('lab', `${p.name} checked ${r.test} report (${r.status})`);
  return {
    found: true,
    test: r.test,
    status: r.status,
    reports_count: reports.length,
    message:
      reports.map((x) => `${x.test}: ${x.status === 'ready' ? 'ready for collection; it has also been sent to the registered WhatsApp number' : 'still being processed'}`).join('. ') +
      '. Do not interpret results; the doctor will explain them.',
  };
}

export function createHandoff({ patient_id, phone, reason, urgency, summary }) {
  const p = patientById(patient_id) || state.patients.find((x) => x.phone === normalizePhone(phone));
  const c = {
    id: `CASE-${++state.seq.case}`,
    patient_id: p?.id || '',
    patient: p?.name || 'Unknown caller',
    phone: normalizePhone(phone) || p?.phone || '',
    reason: reason || 'Needs human assistance',
    urgency: (urgency || 'routine').toLowerCase(),
    summary: summary || '',
    status: 'waiting',
    created_at: new Date().toISOString(),
  };
  state.cases.push(c);
  log(c.urgency === 'emergency' ? 'emergency' : 'handoff', `${c.id} ${c.urgency.toUpperCase()}: ${c.patient} - ${c.reason}`);
  save();
  return { case_id: c.id, urgency: c.urgency, message: `Case ${c.id} created with the call summary. Tell the caller you are connecting them to ${c.urgency === 'emergency' ? 'the duty nurse right now' : 'a front desk executive'} and they will not need to repeat themselves.` };
}

export function updateCase({ case_id, status }) {
  const c = state.cases.find((x) => x.id === String(case_id || '').toUpperCase());
  if (!c) return { updated: false, message: 'Unknown case ID.' };
  c.status = status || 'resolved';
  log('case', `${c.id} marked ${c.status}`);
  save();
  return { updated: true, case_id: c.id, status: c.status, message: `${c.id} is now ${c.status}.` };
}

function nextAppointmentOf(patientId) {
  const today = todayIST();
  return state.appointments
    .filter((a) => a.patient_id === patientId && a.status === 'booked' && a.date >= today)
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))[0];
}

function findAppt(appointmentId, patientId) {
  const id = String(appointmentId || '').trim().toUpperCase().replace(/^APT(\d)/, 'APT-$1');
  let a = state.appointments.find((x) => x.id === id && x.status === 'booked');
  if (!a && !appointmentId && patientId) a = nextAppointmentOf(String(patientId).toUpperCase());
  if (a && patientId && a.patient_id !== String(patientId).trim().toUpperCase()) return null;
  return a;
}

function describeAppt(a) {
  const d = doctorById(a.doctor_id);
  return `${speakDate(a.date)} at ${speakTime(a.time)} with ${d.name} (${d.specialty})`;
}

# CareLine_VortexKnights

Team **VortexKnights** · Talkdesk AI Hackday, PES University RR Campus · **Wed 4 Nov 2026, 9:00–16:00, PESU-52**

**The pitch in one line:** an AI front-desk voice agent for a multispeciality clinic. It answers every call in English, Hindi or Kannada, books, moves and cancels appointments, reads out lab report status, and catches medical emergencies. Emergencies go straight to a human nurse along with an AI summary of the call.

Why this idea:
- **Talkdesk sells to healthcare** (its Healthcare Experience Cloud). PM judges will recognise the problem straight away.
- **Bengaluru clinics really are swamped with calls.** Callers wait on hold, and the front desk spends its day on bookings that could be automated.
- **It shows everything the platform is good at:** a voice AI agent, integrations calling real APIs, handoff to a human agent with context, and analytics.
- **The emergency moment makes a memorable demo.** "Chest pain" never gets an appointment slot. It gets 108 and a nurse within seconds, and the nurse already knows the story.

## What's in this folder

| Path | What it is |
|---|---|
| `server.js` | The mock clinic API, with zero dependencies: `node server.js` (port 8787) |
| `src/clinic.js` | Patients, doctors, slots, appointments, lab reports, handoff cases. Dates are always relative to today in IST, so the data never goes stale. |
| `src/triage.js` | Rule-based red-flag triage (English plus romanized Hindi/Kannada). It's deliberately not an LLM, so escalation is the same every time. |
| `public/dashboard.html` | **CareLine Live**: the screen we project during the demo. It refreshes every 2 seconds and shows bookings, the handoff queue, emergencies and minutes saved. |
| `test/smoke.mjs` | 22 end-to-end checks. Run `node test/smoke.mjs`. |

## Architecture

```
Caller ──phone──► Talkdesk number ──► Studio flow (Inbound_CareLine_VortexKnights)
                                         │
                                         ▼
                           AI Agent (AI Agent_CareLine_VortexKnights)
                           ├─ Integration skills ──HTTPS JSON──► this API  ──► CareLine Live dashboard
                           └─ Escalation ──► Human agent in Workspace (sees AI summary + CASE id)
```

## Talkdesk limits we designed around

These come from the Talkdesk docs on Connections and Execute Action:
- **REST with JSON or form-encoded bodies only.** Inputs are strings or numbers, so every endpoint accepts flat string fields.
- **Arrays can't sit at the root of a response, and parsed outputs work best as scalars.** Every response is a flat object: `slot_1_id`, `slot_1_text`, `slot_2_id`… rather than a list.
- **Execute Action timeouts max out at 30 s.** Every call here returns in milliseconds, but a sleeping free host can take longer than 30 s to wake. Wake it before the demo.
- **Every response has a `message` field**: one plain-English sentence telling the agent what to say or do next. This makes the LLM much more reliable than handing it raw data.

## What's live in Talkdesk now (built and tested 31 Oct)

| Talkdesk piece | Name | Where |
|---|---|---|
| MCP server | `CareLine MCP_VortexKnights` → `https://<tunnel>/mcp`, auth None | AI Agent Platform → MCP Servers |
| Orchestration | `CareLine_VortexKnights` (V1 Draft, **not published**) | AI Agent Platform → AI Agent Orchestration |
| Agent | `Asha Front Desk_VortexKnights` with 5 MCP skills | inside the orchestration |

**Three things Talkdesk forces on us** (all handled in `src/mcp.js`):
1. **One MCP tool per skill, and at most 5 skills per agent.** So the MCP server exposes exactly 5 tools: `patient` (action = lookup/verify/register), `triage_symptoms`, `appointments` (action = search/book/next/reschedule/cancel), `lab_report_status` and `create_handoff`.
2. **Unlinked tool inputs reach the server empty.** Each input has to be linked to an *orchestration variable*, and the agent fills those from the conversation. The variables are: `caller_phone, dob, patient_id, patient_name, patient_action, symptoms, appointment_action, specialty, preferred_date, time_of_day, slot_id, appointment_id, urgency, handoff_reason, handoff_summary`.
3. **Inputs marked required can't be left for the agent to fill**, and descriptions are capped at 300 characters. So nothing is advertised as required, and every tool description stays short.

After changing tool names or schemas, refresh Talkdesk's cached tool list: open the MCP server, click **Test connection**, then **Save**. After editing an agent or skill panel, also click the orchestration's top **Save**. The panel Save alone does not persist anything.

**Tested in Talkdesk's chat simulator:**
- Lookup by phone: "Hello Ramesh".
- Monday-morning cardiology search, then booking APT-1004. It appeared on the dashboard.
- "My father has chest pain": 108 advice, then **Escalated**, then a red EMERGENCY card with the AI summary.

**Hosting:** Render free tier at **https://vortexknights-careline.onrender.com**. The dashboard is at `/` and MCP at `/mcp`. It auto-deploys on every push to `main` in the private repo `dchaudhari7177/vortexknights-careline`. Free instances sleep after 15 idle minutes and take about 50 s to wake, longer than Talkdesk waits for a tool call. **Open the dashboard a minute before any demo**: it polls every 2 s, which keeps the server awake. A restart or redeploy resets the demo data.

When the MCP server URL changes in Talkdesk, its chat runtime can keep using the old address for a while ("Failed to initialize MCP client"). Test connection passes but tool calls never arrive. Re-saving the skills and the orchestration doesn't fix it right away.

## Endpoints (all `POST`, JSON or form body)

Set these up in **Admin → Integrations → Custom Integration**. Name the integration `CareLine API_VortexKnights` and the base URL is the public URL of this server. Add one action per row, then add each action to the AI agent as an Integration skill. Use the "Tool description" column word for word, because the agent picks tools based on it.

| Action / tool name | Path | Inputs | Key outputs | Tool description for the agent |
|---|---|---|---|---|
| `lookup_patient` | `/api/patients/lookup` | `phone` | `found`, `patient_id`, `first_name`, `preferred_language`, `upcoming_appointment_text` | Call at the very start of every call with the caller's phone number to identify the patient. |
| `verify_patient` | `/api/patients/verify` | `patient_id`, `dob` | `verified` | Verify identity with date of birth before sharing appointments or lab reports. |
| `register_patient` | `/api/patients/register` | `name`, `phone`, `dob`, `language` | `registered`, `patient_id` | Register a new caller who is not found by lookup. |
| `triage_symptoms` | `/api/triage` | `symptoms` (English), `age` | `urgency` (emergency/urgent/routine), `recommended_specialty`, `action` | Call whenever the caller describes ANY symptom, before offering appointments. |
| `search_slots` | `/api/slots/search` | `specialty` or `doctor`, `date`, `time_of_day` | `slots_count`, `slot_1_id`..`slot_3_id`, `slot_1_text`..`slot_3_text` | Find free appointment slots. Dates can be words like "tomorrow" or "Monday". |
| `book_appointment` | `/api/appointments/book` | `patient_id`, `slot_id`, `reason` | `booked`, `appointment_id`, `appointment_text`, `sms_text` | Book the slot the caller chose. Use the exact slot_id from search_slots. |
| `next_appointment` | `/api/appointments/next` | `patient_id` | `found`, `appointment_id`, `appointment_text` | Get the patient's next upcoming appointment. |
| `reschedule_appointment` | `/api/appointments/reschedule` | `appointment_id`, `patient_id`, `new_slot_id` | `rescheduled`, `appointment_text` | Move an existing appointment to a new slot from search_slots. |
| `cancel_appointment` | `/api/appointments/cancel` | `appointment_id`, `patient_id` | `cancelled` | Cancel an appointment after the caller confirms. |
| `lab_report_status` | `/api/labs/status` | `patient_id` | `status`, `test` | Tell a verified patient whether their lab reports are ready. Never interpret results. |
| `create_handoff` | `/api/handoff` | `patient_id`, `phone`, `urgency`, `reason`, `summary` | `case_id` | Before transferring to a human, save a 2–3 sentence summary so the human doesn't re-ask. |

Admin endpoints: `GET /api/state` (dashboard data), `POST /api/admin/reset` (fresh demo data), `GET /api/health`.
If the env var `API_KEY` is set, every `/api` call needs the header `x-api-key: <key>`. Add it as a header in the Talkdesk connection.

## AI agent instructions (paste into the agent's prompt/persona)

```
You are Asha, the virtual front-desk assistant for Vortex Multispeciality Clinic, Bengaluru.
You speak English, Hindi and Kannada. Reply in the language the caller uses, and switch if they switch.
Keep every reply short (1-2 sentences) because this is a phone call. Sound warm and calm.

At the start of every call, call lookup_patient with the caller's phone number.
- If found, greet them by first name and ask how you can help.
- If not found, ask for their name and date of birth, then call register_patient.

SAFETY FIRST. Whenever the caller mentions any symptom, call triage_symptoms with the symptoms translated to English.
- urgency = emergency: tell them calmly to call 108 or come to our emergency department now. Call create_handoff
  with urgency "emergency" and a short summary, then transfer to a human immediately. Never book an appointment
  for an emergency.
- urgency = urgent: offer the earliest slot today in the recommended specialty. If none is free, create_handoff.
- urgency = routine: offer slots in the recommended specialty.
Never diagnose, never suggest medicines, and never interpret lab results.

Before sharing appointment details or lab reports, verify identity with verify_patient (date of birth).
If verification fails twice, transfer to the front desk.

Booking: call search_slots and read out at most 3 options. Book only with the exact slot_id the caller chose.
After booking, repeat the appointment ID, day, time and doctor, and remind them to arrive 15 minutes early.
Always confirm before cancelling or rescheduling.

If the caller asks for a human, is upset, or you cannot help, call create_handoff with a 2-3 sentence summary
of who they are, what they need and what you already did. Then transfer.
Every tool returns a "message" field. Follow it.
```

## Demo script (3 minutes, rehearse it 3 times)

Before going on stage: run `POST /api/admin/reset`, open the dashboard on the projector, and hit `/api/health` once to wake the host. Save one team member's real phone number as a patient using `register_patient`, so the agent greets the judge by name when they call from that phone.

1. **Problem (20 s):** "A typical Bengaluru clinic misses about 1 in 4 calls at peak hours. The front desk spends most of its day on bookings, and a caller with chest pain waits on hold behind someone rescheduling." (Present these as estimates, not sourced facts.)
2. **Routine call, live (60 s):** a judge calls. "I need a heart doctor tomorrow morning." The agent offers 3 slots and books one. **The booking appears on the dashboard.**
3. **Language switch (20 s):** the caller switches to Hindi or Kannada and the agent follows.
4. **Emergency (40 s):** a second call: "My father has chest pain and is sweating." The agent says 108 and transfers. **A red EMERGENCY card with the AI summary appears in the handoff queue.** The human agent picks up already knowing the story.
5. **Behind the scenes (20 s):** show the Studio flow and the AI agent's skills in Talkdesk.
6. **Impact and next steps (20 s):** minutes saved (dashboard tile), zero emergencies stuck in a queue, and what comes next: WhatsApp follow-ups, EMR/HIS integration, outbound reminder calls to cut no-shows.

**Backup:** record a full screen-and-audio run on Tuesday night. If campus Wi-Fi or telephony fails, play the recording without apologising.

## Prep timeline

| When | Who / what |
|---|---|
| **Fri 30 Oct (tonight)** | Dipak accepts the Talkdesk invite (it went to dipakchaudhari171@gmail.com) and sets the password. All 3 log in and click around Workspace, Studio, AI Agent platform and Integrations. |
| **Sat 31 Oct** | Get the API onto a public URL (see below). Create `CareLine API_VortexKnights` with 2 actions (`lookup_patient`, `search_slots`) and test them from Talkdesk. |
| **Sun 1 Nov** | Build `AI Agent_CareLine_VortexKnights` with all the skills and the prompt above. Wire the inbound flow `Inbound_CareLine_VortexKnights` to it, with escalation to a human queue. Make real test calls. |
| **Mon 2 / Tue 3 Nov** | Briefings: write down the judging criteria and adapt the pitch to them. If they set a theme, keep the API and handoff pieces and change the domain. Tuesday night: rehearse 3 times and record the backup. |
| **Wed 4 Nov** | Polish only (the multilingual greeting, edge cases). Freeze features at 14:30. Rehearse. Win. |

**Workspace rules:** every resource name ends in `_VortexKnights`. Never edit another team's resources, because audit logs are on.

## Running it

```bash
node server.js                 # http://localhost:8787  (dashboard) and /api/*
node test/smoke.mjs            # 22 end-to-end checks
API_KEY=some-secret node server.js   # require x-api-key on API calls
```

Talkdesk runs in the cloud, so it needs a **public HTTPS URL** to reach this server. Two options:
- **For prep, quick and free:** run locally and expose it with `cloudflared tunnel --url http://localhost:8787`. That gives a `https://*.trycloudflare.com` URL, but the URL changes on every restart.
- **For event day, stable:** deploy to a single-instance Node host (Render or Railway: build command none, start command `node server.js`). State is kept in memory or in a file, so **use one instance**. On free tiers, wake the service a minute before the demo.

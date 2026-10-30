// Rule-based symptom triage. Deliberately not an LLM: red flags must escalate the same way every time,
// and the agent never diagnoses. Covers English plus a few common romanized Hindi/Kannada phrases.

import { matchSpecialty } from './clinic.js';

const EMERGENCY = [
  ['chest pain', ['chest pain', 'chest tightness', 'pressure in chest', 'pain in chest', 'heart attack', 'seene mein dard', 'chhati mein dard', 'ede novu']],
  ['breathing difficulty', ['cant breathe', "can't breathe", 'cannot breathe', 'difficulty breathing', 'trouble breathing', 'shortness of breath', 'breathless', 'gasping', 'saans nahi', 'saans lene mein', 'usiru kattide']],
  ['stroke signs', ['face drooping', 'slurred speech', 'one side weak', 'one side numb', 'cannot move arm', 'paralysis', 'stroke']],
  ['unconscious', ['unconscious', 'fainted', 'passed out', 'not responding', 'unresponsive', 'behosh']],
  ['severe bleeding', ['heavy bleeding', 'bleeding a lot', 'wont stop bleeding', "won't stop bleeding", 'vomiting blood', 'blood in vomit', 'bahut khoon']],
  ['seizure', ['seizure', 'fits', 'convulsion']],
  ['self-harm risk', ['suicide', 'suicidal', 'kill myself', 'end my life', 'want to die']],
  ['poisoning', ['poison', 'overdose', 'swallowed pills', 'swallowed something','snake bite', 'snakebite']],
  ['severe injury', ['accident', 'severe burn', 'head injury and vomiting']],
  ['pregnancy emergency', ['pregnant and bleeding', 'bleeding during pregnancy', 'water broke', 'labour pain', 'labor pain']],
];

const URGENT = [
  ['high fever', ['high fever', '103', '104', 'fever for 3 days', 'fever for three days', 'fever since 3 days', 'tez bukhar']],
  ['infant fever', ['baby has fever', 'infant fever', 'newborn fever']],
  ['severe pain', ['severe pain', 'unbearable pain', 'severe stomach pain', 'severe abdominal pain', 'severe headache']],
  ['possible fracture', ['fracture', 'broken bone', 'cannot walk', "can't walk", 'swollen ankle']],
  ['dehydration', ['vomiting since', 'keeps vomiting', 'loose motions', 'diarrhea', 'diarrhoea', 'dehydrated']],
  ['wound', ['deep cut', 'stitches', 'dog bite', 'animal bite']],
  ['head injury', ['head injury', 'hit my head', 'fell on head']],
];

function find(list, s) {
  for (const [flag, phrases] of list) {
    if (phrases.some((p) => s.includes(p))) return flag;
  }
  return null;
}

export function triage({ symptoms, age }) {
  const s = ' ' + String(symptoms || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  if (!s.trim()) return { urgency: 'unknown', action: 'ask_symptoms', message: 'Ask the caller to describe the symptoms in their own words.' };

  const emergency = find(EMERGENCY, s);
  if (emergency) {
    return {
      urgency: 'emergency',
      red_flag: emergency,
      action: 'escalate_now',
      recommended_specialty: 'Emergency',
      message: `Red flag detected: ${emergency}. Tell the caller calmly: this could be an emergency, please call 108 for an ambulance or come straight to our emergency department. Then create an emergency handoff and transfer to the duty nurse immediately. Do not book an appointment and do not give medical advice.`,
    };
  }

  const ageNum = Number(age);
  const specialty = matchSpecialty(s) || (ageNum && ageNum < 14 ? 'Pediatrics' : 'General Medicine');
  const urgent = find(URGENT, s);
  if (urgent) {
    return {
      urgency: 'urgent',
      red_flag: urgent,
      action: 'book_same_day',
      recommended_specialty: specialty,
      message: `Urgent but not an emergency (${urgent}). Offer the earliest ${specialty} slot today. If none is free today, create a handoff so a nurse calls back within 30 minutes. If symptoms get worse, they should go to emergency.`,
    };
  }

  return {
    urgency: 'routine',
    red_flag: '',
    action: 'book_routine',
    recommended_specialty: specialty,
    message: `Routine concern. Offer ${specialty} appointment slots at a time that suits the caller.`,
  };
}

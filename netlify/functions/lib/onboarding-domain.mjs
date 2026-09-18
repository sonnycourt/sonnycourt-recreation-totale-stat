// Domaine pur : utilisé côté serveur et testé sans réseau ni base de production.
export const FILTERS = ['all', 'new', 'due', 'booked', 'done', 'paused'];
export const CONTACT_LABELS = { whatsapp_received:'Message WhatsApp reçu', call_no_answer:'Appel sans réponse', call_answered:'Appel avec réponse', sms_sent:'SMS envoyé', whatsapp_sent:'Note vocale WhatsApp envoyée', contacted:'Autre réponse reçue par message', unreachable:'Numéro injoignable', completed:'Onboarding réalisé', note:'Note de suivi' };
export const KINDS = ['updated', ...Object.keys(CONTACT_LABELS)];
export const STATUSES = ['new', 'contacting', 'awaiting', 'contacted', 'booked', 'done', 'paused'];
export const ACTIONS = ['call', 'sms', 'whatsapp', 'followup', 'onboarding', 'none'];
export const SUCCESSFUL_CONTACT_KINDS = ['call_answered', 'contacted', 'completed', 'whatsapp_received'];
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

export function validateCommand(body) {
  if (!body || !isUuid(body.case_id) || !isUuid(body.command_id) || !Number.isSafeInteger(body.version) || body.version < 1
    || !KINDS.includes(body.kind) || typeof body.note !== 'string' || body.note.length > 4000
    || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) return false;
  if (body.occurred_at !== undefined && !validContactTime(body.occurred_at)) return false;
  for (const [key, value] of Object.entries(body.patch)) {
    if (['goal', 'motivations', 'obstacles', 'routine', 'notes'].includes(key)) {
      if (typeof value !== 'string' || value.length > (key === 'notes' ? 12000 : 4000)) return false;
    } else if (['training_access', 'community_access', 'feedback_explained', 'coaching_booked'].includes(key)) {
      if (typeof value !== 'boolean') return false;
    } else if (['followup_at', 'onboarding_at', 'coaching_at'].includes(key)) {
      if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value)))) return false;
    } else if (key === 'status') {
      if (!STATUSES.includes(value)) return false;
    } else if (key === 'next_action') {
      if (!ACTIONS.includes(value)) return false;
    } else return false;
  }
  return true;
}

export function validContactTime(value, now = Date.now()) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.parse('2000-01-01T00:00:00Z')
    && Date.parse(value) <= now + 300000;
}
export function validateDeletion(body) {
  return body?.action === 'delete_event' && isUuid(body.case_id) && isUuid(body.event_id)
    && Number.isSafeInteger(body.version) && body.version > 0;
}

// Même progression dans la démo et les commandes réelles. Aucune communication.
export function contactStep(kind, at, status) {
  if(kind==='whatsapp_received')return ['booked','done','paused'].includes(status)?{}:{status:'contacted',next_action:'onboarding',followup_at:null};
  const steps = {
    call_no_answer: ['contacting', 'sms', at],
    sms_sent: ['awaiting', 'whatsapp', new Date(Date.parse(at) + 86400000).toISOString()],
    whatsapp_sent: ['awaiting', 'followup', null],
    contacted: ['contacted', 'onboarding', null],
    call_answered: ['contacted', 'onboarding', null],
    unreachable: ['contacting', 'followup', null],
    completed: ['done', 'none', null],
  };
  const step = steps[kind];
  return step ? {status:step[0], next_action:step[1], followup_at:step[2]} : {};
}

export function firstSuccessfulContact(events) {
  return events.filter(e=>!e.deleted_at && SUCCESSFUL_CONTACT_KINDS.includes(e.kind) && Number.isFinite(Date.parse(e.occurred_at)))
    .reduce((first,e)=>!first||Date.parse(e.occurred_at)<Date.parse(first)?e.occurred_at:first,null);
}

// Repère neutre : le temps écoulé continue après les contacts et l'onboarding.
export function registrationAge(row, now=Date.now()) {
  const started=Date.parse(row?.purchased_at);
  if(!Number.isFinite(started) || !Number.isFinite(now) || started>now)
    return {state:'unknown',title:'Inscrit depuis',value:'—',compact:'Date d’inscription à renseigner',detail:'Date d’inscription indisponible.'};
  const totalMinutes=Math.floor((now-started)/60000);
  const days=Math.floor(totalMinutes/1440),hours=Math.floor(totalMinutes%1440/60),minutes=totalMinutes%60;
  const value=totalMinutes<1?'moins d’une minute':`${days?`${days} j `:''}${days||hours?`${hours} h `:''}${minutes} min`;
  return {state:'active',title:'Inscrit depuis',value,compact:`Inscrit depuis ${value}`,
    detail:`Le ${formatRegistrationTime(row.purchased_at)} · Paris.`};
}

// Jour civil Paris, pas +N×24h en UTC : reste juste lors du changement d'heure.
export function formatRegistrationTime(iso) {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return 'À renseigner';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone:'Europe/Paris', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit',
  }).format(new Date(iso));
}
export function parisDay(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type).value).join('-');
}
export function plusDays(iso, count) {
  const date = new Date(`${parisDay(iso)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function presentCase(row) {
  return {
    ...row,
    name: row.preferred_name || row.display_name,
    country: row.country_override || row.country,
    first_payment_date: row.payment_date_override || (row.source === 'mc2' ? plusDays(row.purchased_at, 7) : null),
    payment_date_source: row.payment_date_source || 'Échéance théorique J+7 — ne confirme pas un encaissement',
    coaching_from: plusDays(row.purchased_at, 33),
    feedback_date: plusDays(row.purchased_at, 14),
    plan_label: row.plan === 'six' ? '6 mensualités de 347 € · démarrage à 0 €' : row.plan === 'legacy_three'
      ? 'Ancien modèle · 3 versements de 767 €' : '12 mensualités de 197 € · démarrage à 0 €',
  };
}

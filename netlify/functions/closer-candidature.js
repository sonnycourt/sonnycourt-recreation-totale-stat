import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';
import {
  verifyCloserToken,
  getCloserCookieSecret,
  getCloserCookieValue,
} from './lib/closer-access-crypto.mjs';

const ENUMS = {
  closed_highticket: ['Oui', 'Non'],
  ok_commission: ['Oui', 'Non', "J'ai des questions"],
  ok_recording: ['Oui', 'Non'],
  available_jul3: ['Oui', 'Non', 'Après le 3'],
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function str(v, max) {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = getCloserCookieSecret();
  if (!secret) return json(500, { error: 'Service non configuré' });

  // Accès réservé aux closers ayant entré un code valide (cookie de session /closer)
  const token = verifyCloserToken(getCloserCookieValue(req.headers.get('cookie') || ''), secret);
  if (!token || !Number.isInteger(token.cid)) {
    return json(401, { error: 'Accès requis. Entrez votre code sur la page.' });
  }

  const codeRes = await supabaseGet(
    `closer_access_codes?id=eq.${Number(token.cid)}&active=eq.true&select=id,label,code`
  );
  const codeRows = Array.isArray(codeRes.data) ? codeRes.data : [];
  if (!codeRes.ok || codeRows.length === 0) {
    return json(401, { error: 'Accès expiré. Réentrez votre code.' });
  }
  const codeRow = codeRows[0];

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Requête invalide' });
  }

  const data = {
    full_name: str(body.full_name, 160),
    email: str(body.email, 200),
    phone: str(body.phone, 60),
    closed_highticket: str(body.closed_highticket, 40),
    ok_commission: str(body.ok_commission, 40),
    ok_recording: str(body.ok_recording, 40),
    available_jul3: str(body.available_jul3, 40),
    results: str(body.results, 4000),
    audio_url: str(body.audio_url, 1000),
    motivation: str(body.motivation, 4000),
  };

  // Validation serveur
  const errors = [];
  if (!data.full_name) errors.push('full_name');
  if (!isEmail(data.email)) errors.push('email');
  if (!data.phone) errors.push('phone');
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(data[field])) errors.push(field);
  }
  if (!data.results) errors.push('results');
  if (!isUrl(data.audio_url)) errors.push('audio_url');
  if (!data.motivation) errors.push('motivation');

  if (errors.length) {
    return json(400, { error: 'Champs invalides ou manquants.', fields: errors });
  }

  const insert = await supabasePost('closer_candidatures', {
    ...data,
    code_id: codeRow.id,
    code_label: codeRow.label,
    code: codeRow.code,
  });

  if (!insert.ok) {
    return json(500, { error: 'Enregistrement impossible. La table closer_candidatures existe-t-elle ?', detail: insert.error });
  }

  return json(200, { ok: true });
};

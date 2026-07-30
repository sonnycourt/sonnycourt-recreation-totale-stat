import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

// Reçoit les battements de temps actif passé sur la PDV (sendBeacon).
// Body: { t: token d'inscription, s: secondes actives depuis le dernier envoi }
export default async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }
  if (req.method === 'GET') {
    const token = String(new URL(req.url).searchParams.get('t') || '').trim();
    if (!token || token.length > 100) {
      return jsonResponse(400, { error: 'Paramètres invalides' });
    }
    const current = await supabaseGet(
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=pdv_seconds`,
    );
    if (!current.ok || !Array.isArray(current.data) || current.data.length === 0) {
      return jsonResponse(404, { error: 'Token inconnu' });
    }
    return jsonResponse(200, {
      ok: true,
      pdv_seconds: Number(current.data[0]?.pdv_seconds) || 0,
    });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let body = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'JSON invalide' });
  }

  const token = String(body?.t || '').trim();
  // Chaque battement est plafonné à 120 s : un client bidouillé ne peut pas
  // gonfler le compteur plus vite que le temps réel.
  const seconds = Math.min(Math.max(Math.round(Number(body?.s) || 0), 0), 120);

  if (!token || token.length > 100 || seconds < 1) {
    return jsonResponse(400, { error: 'Paramètres invalides' });
  }

  const query = `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=pdv_seconds`;
  const current = await supabaseGet(query);
  if (!current.ok || !Array.isArray(current.data) || current.data.length === 0) {
    return jsonResponse(404, { error: 'Token inconnu' });
  }

  const total = (Number(current.data[0]?.pdv_seconds) || 0) + seconds;
  const patch = await supabasePatch(
    'webinaire_registrations',
    `token=eq.${encodeURIComponent(token)}`,
    { pdv_seconds: total },
  );

  if (!patch.ok) {
    return jsonResponse(500, { error: 'Écriture impossible' });
  }
  return jsonResponse(200, { ok: true, pdv_seconds: total });
};

import { supabaseGet } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(400, { error: 'Entre une adresse email valide.' });
    }
    // Récupération immédiate par email, comme le parcours historique.
    // Lecture seule : ni nouvel accès, ni prolongation, ni email envoyé.
    const result = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}&select=token&order=registered_at.desc&limit=1`,
    );
    if (!result.ok || !Array.isArray(result.data)) {
      return jsonResponse(503, { error: 'Vérification momentanément indisponible. Réessaie dans un instant.' });
    }
    const token = String(result.data[0]?.token || '').trim();
    if (!token) return jsonResponse(404, { error: 'Aucune inscription trouvée avec cet email.' });

    return jsonResponse(200, {
      ok: true,
      token,
      // Une page ouverte avant la mise à jour attendait un message d'envoi.
      message: 'Inscription retrouvée. Si cette fenêtre reste affichée, recharge la page puis saisis à nouveau ton email pour ouvrir ton accès.',
    });
  } catch {
    return jsonResponse(503, { error: 'Vérification momentanément indisponible. Réessaie dans un instant.' });
  }
};

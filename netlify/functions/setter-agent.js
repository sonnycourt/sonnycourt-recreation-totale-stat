import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';
import { authSetterUserId } from './lib/setter-auth.mjs';
import { generateReply, applyAction } from './lib/setter-brain.mjs';

/**
 * Pilotage de l'agent IA depuis la console /setter.
 *
 * POST { action:'simulate_start', prenom? }        -> nouvelle conversation de TEST (phone sim-*)
 * POST { action:'inbound', conversation_id, body } -> message du prospect + réponse IA
 *      (simulateur : envoyée direct ; réel supervisé : brouillon à valider)
 * POST { action:'approve', message_id }            -> valide un brouillon (phase 2 : l'envoie en SMS)
 * POST { action:'regenerate', conversation_id }    -> régénère le dernier brouillon
 */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const isSim = (phone) => typeof phone === 'string' && phone.startsWith('sim-');

async function getConv(id) {
  const r = await supabaseGet(`setter_conversations?id=eq.${id}&select=*`);
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

async function listMessages(conversationId) {
  const r = await supabaseGet(
    `setter_messages?conversation_id=eq.${conversationId}&select=id,direction,body,ai_generated,status,created_at&order=created_at.asc&limit=100`,
  );
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

/** Génère la réponse IA et la stocke (envoyée en simulateur, brouillon sinon). */
async function replyInto(conv) {
  const gen = await generateReply(conv.id);
  if (!gen.ok) return gen;
  const sim = isSim(conv.phone);
  const status = sim || !conv.supervised ? 'envoye' : 'a_valider';
  const ins = await supabasePost('setter_messages', {
    conversation_id: conv.id,
    direction: 'out',
    body: gen.reply,
    ai_generated: true,
    status,
  });
  if (!ins.ok) return { ok: false, error: 'Erreur écriture message' };
  await supabasePatch('setter_conversations', `id=eq.${conv.id}`, {
    last_outbound_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(conv.status === 'nouveau' ? { status: 'ouvert', opener_sent_at: new Date().toISOString() } : {}),
  });
  if (gen.action !== 'none') await applyAction(conv.id, conv.phone, gen.action);
  return { ok: true, action: gen.action };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  const uid = await authSetterUserId(req);
  if (uid === null) return json(401, { error: 'Non authentifié' });

  const body = await req.json().catch(() => ({}));

  // --- Simulateur : nouvelle conversation de test + opener IA ---
  if (body.action === 'simulate_start') {
    const prenom = typeof body.prenom === 'string' && body.prenom.trim() ? body.prenom.trim().slice(0, 40) : 'Julie';
    const ins = await supabasePost('setter_conversations', {
      phone: `sim-${Date.now()}`,
      prenom,
      pays: 'France',
      status: 'nouveau',
      supervised: false,
    });
    if (!ins.ok || !ins.data || !ins.data[0]) return json(500, { error: 'Erreur création conversation' });
    const conv = ins.data[0];
    const rep = await replyInto(conv);
    if (!rep.ok) return json(500, rep);
    return json(200, { ok: true, conversation_id: conv.id, messages: await listMessages(conv.id) });
  }

  // --- Message entrant (prospect) -> réponse IA ---
  if (body.action === 'inbound') {
    const id = Number(body.conversation_id);
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 1000) : '';
    if (!Number.isInteger(id) || !text) return json(400, { error: 'Requête invalide' });
    const conv = await getConv(id);
    if (!conv) return json(404, { error: 'Conversation introuvable' });
    await supabasePost('setter_messages', { conversation_id: id, direction: 'in', body: text, status: 'recu' });
    await supabasePatch('setter_conversations', `id=eq.${id}`, {
      last_inbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const rep = await replyInto(conv);
    if (!rep.ok) return json(500, rep);
    return json(200, { ok: true, action: rep.action, messages: await listMessages(id) });
  }

  // --- Validation d'un brouillon (mode supervisé) ---
  if (body.action === 'approve') {
    const mid = Number(body.message_id);
    if (!Number.isInteger(mid)) return json(400, { error: 'Requête invalide' });
    // Phase 2 : c'est ici que le SMS partira réellement via la passerelle.
    const upd = await supabasePatch('setter_messages', `id=eq.${mid}&status=eq.a_valider`, { status: 'envoye' });
    if (!upd.ok || !Array.isArray(upd.data) || !upd.data.length) return json(404, { error: 'Brouillon introuvable' });
    return json(200, { ok: true });
  }

  // --- Régénérer le dernier brouillon ---
  if (body.action === 'regenerate') {
    const id = Number(body.conversation_id);
    if (!Number.isInteger(id)) return json(400, { error: 'Requête invalide' });
    const conv = await getConv(id);
    if (!conv) return json(404, { error: 'Conversation introuvable' });
    const dr = await supabaseGet(
      `setter_messages?conversation_id=eq.${id}&status=eq.a_valider&select=id&order=created_at.desc&limit=1`,
    );
    if (dr.ok && Array.isArray(dr.data) && dr.data[0]) {
      await supabasePatch('setter_messages', `id=eq.${dr.data[0].id}`, { status: 'brouillon' });
    }
    const rep = await replyInto(conv);
    if (!rep.ok) return json(500, rep);
    return json(200, { ok: true, messages: await listMessages(id) });
  }

  return json(400, { error: 'Action inconnue' });
};

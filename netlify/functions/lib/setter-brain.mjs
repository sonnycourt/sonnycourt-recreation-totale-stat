import Anthropic from '@anthropic-ai/sdk';
import { supabaseGet, supabasePost, supabasePatch } from './supabase-rest.mjs';

/**
 * Cerveau du setter IA : génère la prochaine réponse SMS d'une conversation.
 * Utilisé par la console (/setter, simulateur + mode supervisé) et, en phase 2,
 * par le webhook SMS entrant de la passerelle.
 *
 * Identité : « l'assistant de l'équipe Sonny Court » (transparent, jamais
 * d'imposture). Mission unique : proposer la séance découverte offerte avec
 * Romain et amener à la réservation. Tout le reste = recentrage ou handoff.
 */

const MODEL = 'claude-opus-4-8';
const MAX_HISTORY = 30;

export function getSetterApiKey() {
  return (
    process.env.ANTHROPIC_API_KEY_SETTER ||
    process.env.ANTHROPIC_API_KEY_CLOSER_CONSOLE ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  );
}

async function getSetting(key, fallback) {
  const r = await supabaseGet(`setter_settings?key=eq.${encodeURIComponent(key)}&select=value`);
  if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0].value;
  return fallback;
}

function baseSystemPrompt(bookingUrl) {
  return [
    "Tu es l'assistant de l'équipe Sonny Court (sonnycourt.com, développement personnel). Tu échanges par SMS avec des personnes qui se sont inscrites à la masterclass gratuite de Sonny mais n'ont pas pu y assister.",
    '',
    'TA MISSION (la seule) : leur proposer la séance découverte OFFERTE de 20 minutes par téléphone avec Romain, hypnothérapeute avec plus de 20 ans d\'expérience, membre de l\'équipe de Sonny. Cette séance est un cadeau : elle est prévue pour chaque inscrit, ils n\'ont qu\'à la récupérer. Elle sert à faire le point sur leurs blocages et leurs objectifs, sans engagement.',
    `Quand la personne montre de l'intérêt, envoie le lien de réservation : ${bookingUrl}`,
    '',
    'TON STYLE SMS :',
    '- Français, tutoiement, chaleureux et naturel, comme un humain qui écrit vite mais bien.',
    '- COURT : 1 à 3 phrases max par message. Jamais de pavé. Une seule question à la fois.',
    '- Zéro jargon marketing, zéro pression, zéro emoji en rafale (1 max, pas systématique).',
    '- Varie tes formulations, ne répète jamais deux fois la même tournure.',
    '',
    'RÈGLES ABSOLUES :',
    "- Tu es un assistant : si on te demande si tu es un robot/une IA, tu le confirmes simplement et tu recentres sur la séance (« Oui, je suis l'assistant de l'équipe 🙂 C'est Romain, un humain avec 20 ans d'expérience, qui fera la séance avec toi »).",
    '- JAMAIS de conseil médical, thérapeutique ou psychologique par SMS. Ces sujets = la séance avec Romain.',
    '- JAMAIS de vente, de prix, de mention des formations payantes. Ce n\'est pas ton rôle.',
    '- JAMAIS de promesse de résultat.',
    '- Si la personne écrit STOP ou demande de ne plus être contactée : excuse-toi brièvement, confirme, action "optout".',
    '- Si détresse, sujet de santé grave, colère forte ou question à laquelle tu ne peux pas répondre : action "handoff" avec un message doux qui annonce que Romain reprendra personnellement.',
    '- Si la personne dit avoir réservé ou vouloir réserver : action "booked".',
    '- Hors sujet : réponds en une phrase gentille et recentre sur la séance offerte.',
    '',
    'FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, rien d\'autre :',
    '{"reply": "ton SMS", "action": "none"}',
    'action ∈ "none" | "optout" | "handoff" | "booked"',
  ].join('\n');
}

async function playbookBlock() {
  const r = await supabaseGet('setter_playbook?active=eq.true&select=kind,content&order=created_at.asc&limit=40');
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  if (!rows.length) return '';
  return (
    '\n\nLEÇONS DU PLAYBOOK (tirées des conversations passées, applique-les) :\n' +
    rows.map((p) => `- [${p.kind}] ${p.content}`).join('\n')
  );
}

/**
 * Génère la réponse IA pour une conversation.
 * @param {number} conversationId
 * @returns {{ok:boolean, reply?:string, action?:string, error?:string}}
 */
export async function generateReply(conversationId) {
  const apiKey = getSetterApiKey();
  if (!apiKey) return { ok: false, error: 'Clé API manquante' };

  const cr = await supabaseGet(
    `setter_conversations?id=eq.${conversationId}&select=id,prenom,pays,status,opener_variant`,
  );
  const conv = cr.ok && Array.isArray(cr.data) && cr.data[0] ? cr.data[0] : null;
  if (!conv) return { ok: false, error: 'Conversation introuvable' };

  const mr = await supabaseGet(
    `setter_messages?conversation_id=eq.${conversationId}&status=neq.brouillon&select=direction,body&order=created_at.asc&limit=${MAX_HISTORY}`,
  );
  const history = mr.ok && Array.isArray(mr.data) ? mr.data : [];

  const bookingUrl = await getSetting('booking_url', 'https://sonnycourt.com/seance');
  const system = [
    { type: 'text', text: baseSystemPrompt(bookingUrl) + (await playbookBlock()), cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: `CONTEXTE DU CONTACT : prénom ${conv.prenom || 'inconnu'}, pays ${conv.pays || 'inconnu'}. Inscrit(e) à la masterclass mais ne l'a pas suivie (ni direct ni replay).`,
    },
  ];

  const messages = history.map((m) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body,
  }));
  // Le premier message doit être user : si la conv démarre (opener), on simule la consigne.
  if (!messages.length || messages[0].role !== 'user') {
    messages.unshift({
      role: 'user',
      content:
        "[Consigne interne : rédige le premier SMS d'ouverture. Présente-toi comme l'assistant de l'équipe Sonny Court, rappelle son inscription à la masterclass, propose la séance offerte avec Romain. Termine par STOP pour se désinscrire.]",
    });
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages,
    });
    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    let parsed = null;
    try {
      parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
      return { ok: false, error: 'Réponse IA invalide' };
    }
    const action = ['none', 'optout', 'handoff', 'booked'].includes(parsed.action) ? parsed.action : 'none';
    return { ok: true, reply: parsed.reply.trim().slice(0, 640), action };
  } catch (err) {
    console.error('setter-brain:', err && err.message);
    return { ok: false, error: "Erreur IA, réessaie." };
  }
}

/** Applique l'action IA sur la conversation (statuts + opt-out). */
export async function applyAction(conversationId, phone, action) {
  const patch = { updated_at: new Date().toISOString() };
  if (action === 'optout') {
    patch.status = 'opt_out';
    await supabasePost('setter_suppression', { phone, reason: 'STOP conversation' }).catch(() => {});
  } else if (action === 'handoff') {
    patch.status = 'handoff';
    patch.handoff_reason = 'Détecté par IA';
  } else if (action === 'booked') {
    patch.status = 'booke';
    patch.booked_rdv_at = new Date().toISOString();
  }
  await supabasePatch('setter_conversations', `id=eq.${conversationId}`, patch);
}

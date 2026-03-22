import {
  getMailerLiteSubscriberId,
  addSubscriberToGroup,
  getWebinaireGroupEnv,
} from './lib/mailerlite-webinaire.mjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

const ALLOWED = new Set(['present', 'acheteur', 'non-acheteur', 'no-show', 'inscrit']);

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = await req.json();
    const token = String(body?.token || '').trim();
    const statut = String(body?.statut || '').trim();

    if (!token) {
      return jsonResponse(400, { error: 'Token manquant' });
    }
    if (!ALLOWED.has(statut)) {
      return jsonResponse(400, { error: 'Statut invalide' });
    }

    const existing = await supabaseGet(
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=email,statut`,
    );
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return jsonResponse(404, { error: 'Token inconnu' });
    }

    const email = existing.data[0].email;

    const patch = await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(token)}`,
      { statut },
    );

    if (!patch.ok) {
      console.error('update-webinaire-status patch:', patch.error);
      return jsonResponse(500, { error: 'Mise à jour impossible' });
    }

    const apiKey = process.env.MAILERLITE_API_KEY;
    const groups = getWebinaireGroupEnv();

    if (apiKey && email) {
      const subscriberId = await getMailerLiteSubscriberId(email, apiKey);
      if (subscriberId) {
        if (statut === 'present' && groups.presents) {
          await addSubscriberToGroup(subscriberId, groups.presents, apiKey);
        }
        if (statut === 'acheteur' && groups.acheteurs) {
          await addSubscriberToGroup(subscriberId, groups.acheteurs, apiKey);
        }
        if (statut === 'non-acheteur' && groups.nonAcheteurs) {
          await addSubscriberToGroup(subscriberId, groups.nonAcheteurs, apiKey);
        }
      }
    }

    return jsonResponse(200, { success: true, statut, email });
  } catch (error) {
    console.error('update-webinaire-status error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};

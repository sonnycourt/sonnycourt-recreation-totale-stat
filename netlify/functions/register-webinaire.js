import crypto from 'crypto';
import {
  getRegistrationSessionInstantUtc,
  getSessionEndsAtUtc,
  getOffreExpiresAtUtc,
  formatParisOptinTimestamp,
} from './lib/webinaire-session-paris.mjs';
import { upsertWebinaireSubscriber, getWebinaireGroupEnv } from './lib/mailerlite-webinaire.mjs';
import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';

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

function generateToken() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = await req.json();
    const email = String(body?.email || '')
      .trim()
      .toLowerCase();
    const prenom = String(body?.prenom || '').trim();
    const telephone = String(body?.telephone || '').trim();
    const pays = String(body?.pays || '').trim();
    const hasPhonePayload = Boolean(telephone && pays);

    if (!email || !email.includes('@') || !prenom) {
      return jsonResponse(400, { error: 'Paramètres manquants' });
    }

    const slotParis = '20h';

    const ex = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=email,raison`,
    );
    if (ex.ok && Array.isArray(ex.data) && ex.data.length > 0) {
      return jsonResponse(403, { error: 'excluded', reason: 'excluded', raison: ex.data[0].raison });
    }

    const existing = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,prenom,telephone,pays,statut,session_date,session_ends_at,offre_expires_at`,
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      const e = existing.data[0];
      const patchBody = {};
      if (prenom && prenom !== (e.prenom || '')) patchBody.prenom = prenom;
      if (hasPhonePayload) {
        patchBody.telephone = telephone;
        patchBody.pays = pays;
      }
      if (Object.keys(patchBody).length > 0) {
        const upd = await supabasePatch(
          'webinaire_registrations',
          `email=eq.${encodeURIComponent(email)}`,
          patchBody,
        );
        if (!upd.ok) {
          console.error('Supabase update webinaire_registrations:', upd.status, upd.error);
        }
      }

      const apiKey = process.env.MAILERLITE_API_KEY;
      const groups = getWebinaireGroupEnv();
      const groupInscrits =
        groups.inscrits ||
        process.env.MAILERLITE_GROUP_WEBINAIRE_INSCRITS ||
        process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS ||
        process.env.MAILERLITE_GROUP_WEBINAIRE_ES2 ||
        process.env.MAILERLITE_GROUP_WEBINAR_ES2;

      if (apiKey && groupInscrits) {
        try {
          await upsertWebinaireSubscriber({
            email,
            prenom: prenom || e.prenom || '',
            telephone: hasPhonePayload ? telephone : e.telephone || '',
            pays: hasPhonePayload ? pays : e.pays || '',
            token: e.token,
            dateOptinMasterclass: formatParisOptinTimestamp(new Date()),
            groupId: groupInscrits,
            apiKey,
          });
        } catch (mlErr) {
          console.error('MailerLite register-webinaire existing:', mlErr);
        }
      }

      return jsonResponse(200, {
        success: true,
        alreadyRegistered: true,
        token: e.token,
        statut: e.statut,
        sessionStartsAt: e.session_date,
        sessionEndsAt: e.session_ends_at,
        offreExpiresAt: e.offre_expires_at,
        redirectTo: `/masterclass/confirmation?t=${e.token}`,
      });
    }

    const token = generateToken();
    const now = new Date();
    const sessionStart = getRegistrationSessionInstantUtc(now, slotParis);
    if (!sessionStart) {
      return jsonResponse(500, { error: 'Impossible de calculer la session' });
    }

    const sessionEndsAt = getSessionEndsAtUtc(sessionStart.toISOString());
    const offreExpiresAt = getOffreExpiresAtUtc(sessionStart.toISOString());
    if (!sessionEndsAt || !offreExpiresAt) {
      return jsonResponse(500, { error: 'Impossible de calculer les dates' });
    }

    const row = {
      token,
      email,
      prenom,
      telephone: telephone || null,
      pays: pays || null,
      creneau: slotParis,
      session_date: sessionStart.toISOString(),
      session_ends_at: sessionEndsAt.toISOString(),
      offre_expires_at: offreExpiresAt.toISOString(),
      statut: 'inscrit',
    };

    const ins = await supabasePost('webinaire_registrations', row, { prefer: 'return=minimal' });
    if (!ins.ok) {
      console.error('Supabase insert webinaire_registrations:', ins.status, ins.error);
      return jsonResponse(500, {
        error: 'Erreur enregistrement',
        details: process.env.NETLIFY_DEV ? ins.error : undefined,
      });
    }

    const apiKey = process.env.MAILERLITE_API_KEY;
    const groups = getWebinaireGroupEnv();
    const groupInscrits =
      groups.inscrits ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_INSCRITS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2 ||
      process.env.MAILERLITE_GROUP_WEBINAR_ES2;

    if (apiKey && groupInscrits) {
      try {
        await upsertWebinaireSubscriber({
          email,
          prenom,
          telephone,
          pays,
          token,
          dateOptinMasterclass: formatParisOptinTimestamp(new Date()),
          groupId: groupInscrits,
          apiKey,
        });
      } catch (mlErr) {
        console.error('MailerLite register-webinaire:', mlErr);
      }
    }

    return jsonResponse(200, {
      success: true,
      token,
      redirectTo: `/masterclass/confirmation?t=${token}`,
    });
  } catch (error) {
    console.error('register-webinaire error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};

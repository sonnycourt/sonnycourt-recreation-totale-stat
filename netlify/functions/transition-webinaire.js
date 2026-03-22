import {
  getMailerLiteSubscriberId,
  addSubscriberToGroup,
  getWebinaireGroupEnv,
} from './lib/mailerlite-webinaire.mjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

/**
 * Cron hebdomadaire (dimanche, voir netlify.toml) :
 * - inscrit + offre_expires_at passée → no-show
 * - present + offre_expires_at passée → non-acheteur + groupe MailerLite
 */
export default async () => {
  try {
    const nowIso = new Date().toISOString();
    const q = encodeURIComponent(nowIso);

    const presentsRes = await supabaseGet(
      `webinaire_registrations?statut=eq.present&offre_expires_at=lte.${q}&select=email`,
    );

    const patchInscrit = await supabasePatch(
      'webinaire_registrations',
      `statut=eq.inscrit&offre_expires_at=lte.${q}`,
      { statut: 'no-show' },
    );

    const patchPresent = await supabasePatch(
      'webinaire_registrations',
      `statut=eq.present&offre_expires_at=lte.${q}`,
      { statut: 'non-acheteur' },
    );

    let mailerLiteCount = 0;
    const apiKey = process.env.MAILERLITE_API_KEY;
    const groups = getWebinaireGroupEnv();

    if (
      apiKey &&
      groups.nonAcheteurs &&
      presentsRes.ok &&
      Array.isArray(presentsRes.data)
    ) {
      for (const row of presentsRes.data) {
        if (!row.email) continue;
        const sid = await getMailerLiteSubscriberId(row.email, apiKey);
        if (sid) {
          await addSubscriberToGroup(sid, groups.nonAcheteurs, apiKey);
          mailerLiteCount += 1;
        }
      }
    }

    const body = {
      ok: true,
      at: nowIso,
      noShowPatchOk: patchInscrit.ok,
      nonAcheteurPatchOk: patchPresent.ok,
      presentsProcessed: Array.isArray(presentsRes.data) ? presentsRes.data.length : 0,
      mailerLiteNonAcheteurs: mailerLiteCount,
    };

    console.log('transition-webinaire', JSON.stringify(body));

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('transition-webinaire error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

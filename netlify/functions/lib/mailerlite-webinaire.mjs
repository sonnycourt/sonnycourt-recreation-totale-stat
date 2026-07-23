const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';

/** session_date ISO → jour de session en Europe/Paris (YYYY-MM-DD) pour champ MailerLite es_session_date */
export function formatParisSessionDateYyyyMmDd(isoString) {
  if (!isoString) return undefined;
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return undefined;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export async function getMailerLiteSubscriberId(email, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  try {
    const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.id || null;
  } catch {
    return null;
  }
}

async function getMailerLiteSubscriberSnapshot(email, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  try {
    const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data || null;
    if (!data?.id) return null;
    return { id: data.id, status: data.status || null };
  } catch {
    return null;
  }
}

export async function addSubscriberToGroup(subscriberId, groupId, apiKey) {
  if (!subscriberId || !groupId) {
    return { assigned: false, alreadyInGroup: false };
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}/groups/${groupId}`, {
    method: 'POST',
    headers,
  });
  if (!res.ok && res.status !== 422) {
    const err = await res.json().catch(() => ({}));
    console.error('MailerLite add group error:', err);
    return { assigned: false, alreadyInGroup: false };
  }
  if (res.status === 422) {
    return { assigned: false, alreadyInGroup: true };
  }
  return { assigned: true, alreadyInGroup: false };
}

/**
 * Crée ou met à jour le contact + champs unique_token_webinaire, date_optin_masterclass + groupe optionnel.
 */
export async function upsertWebinaireSubscriber({
  email,
  prenom,
  telephone,
  pays,
  token,
  dateOptinMasterclass,
  dateWebinaire,
  groupId,
  apiKey,
}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const esSessionDate = formatParisSessionDateYyyyMmDd(dateWebinaire);

  const fields = {
    first_name: prenom,
    name: prenom,
    phone: telephone,
    location: pays,
    es_country: pays || '',
    ...(esSessionDate ? { es_session_date: esSessionDate } : {}),
    unique_token_webinaire: token,
    ...(dateOptinMasterclass
      ? { date_optin_masterclass: dateOptinMasterclass }
      : {}),
    ...(dateWebinaire
      ? {
          es_2_0_date_webinaire: dateWebinaire,
          date_webinaire: dateWebinaire,
          es2_date_webinaire: dateWebinaire,
        }
      : {}),
  };

  const existingSubscriber = await getMailerLiteSubscriberSnapshot(email, apiKey);
  let subscriberId = existingSubscriber?.id || null;

  if (subscriberId) {
    if (existingSubscriber?.status === 'unsubscribed') {
      const upsertResponse = await fetch(`${MAILERLITE_API_BASE}/subscribers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, status: 'active', resubscribe: true, fields }),
      });
      const upsertJson = await upsertResponse.json().catch(() => ({}));
      if (!upsertResponse.ok) {
        throw new Error(upsertJson?.message || 'MailerLite resubscribe upsert error');
      }
      subscriberId = upsertJson?.data?.id || subscriberId;
    } else {
      await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: 'active', resubscribe: true, fields }),
      });
    }
  } else {
    const createResponse = await fetch(`${MAILERLITE_API_BASE}/subscribers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, status: 'active', resubscribe: true, fields }),
    });
    const createJson = await createResponse.json();
    if (!createResponse.ok) {
      throw new Error(createJson?.message || 'MailerLite create error');
    }
    subscriberId = createJson?.data?.id || null;
  }

  let groupAssignedAt = null;
  if (subscriberId && groupId) {
    const groupResult = await addSubscriberToGroup(subscriberId, groupId, apiKey);
    if (groupResult.assigned || groupResult.alreadyInGroup) {
      groupAssignedAt = new Date().toISOString();
      const groupDateFields = {
        sajoute_dans_le_groupe_le: groupAssignedAt,
        es2_ajoute_dans_le_groupe_le: groupAssignedAt,
        date_ajout_groupe_webinaire: groupAssignedAt,
      };
      // Ré-envoyer les champs métier + dates groupe pour éviter d’écraser
      // unique_token_webinaire / es_session_date / es_country si l’API fusionne mal.
      await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          status: 'active',
          resubscribe: true,
          fields: { ...fields, ...groupDateFields },
        }),
      }).catch(() => {});
    }
  }

  return { subscriberId, groupAssignedAt };
}

/**
 * Met à jour uniquement les champs ES2 utiles au dashboard / segments (backfill one-shot).
 * Ne modifie pas les groupes.
 */
export async function patchMailerLiteWebinaireCoreFields({ email, token, pays, sessionDateIso, apiKey }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const subscriberId = await getMailerLiteSubscriberId(email, apiKey);
  if (!subscriberId) {
    return { ok: false, reason: 'subscriber_not_found' };
  }
  const esSessionDate = formatParisSessionDateYyyyMmDd(sessionDateIso);
  const fields = {
    unique_token_webinaire: token,
    es_country: pays || '',
    ...(esSessionDate ? { es_session_date: esSessionDate } : {}),
  };
  const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status: 'active', fields }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, reason: json?.message || `http_${res.status}`, status: res.status };
  }
  return { ok: true, subscriberId };
}

export function getWebinaireGroupEnv() {
  return {
    inscrits:
      process.env.MAILERLITE_GROUP_WEBINAIRE_INSCRITS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2 ||
      process.env.MAILERLITE_GROUP_WEBINAR_ES2,
    presents:
      process.env.MAILERLITE_GROUP_WEBINAIRE_PRESENTS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_PRESENTS,
    acheteurs:
      process.env.MAILERLITE_GROUP_WEBINAIRE_ACHETEURS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_ACHETEURS,
    nonAcheteurs:
      process.env.MAILERLITE_GROUP_WEBINAIRE_NON_ACHETEURS ||
      process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_NON_ACHETEURS,
  };
}


/* ====== Segmentation ES2 W9+ (groupes MailerLite de Ludovic, 23/7/2026) ====== */

export const ES2_SEGMENT_GROUPS = {
  rituel: '193700166599968678',
  marathon: '193700167866647896',
  srcMeta: '193700169050490378',
  srcTiktok: '193700170407347470',
  srcOrga: '193700172043126599',
  checkoutAbandon: '193700174840727293',
};

export async function removeSubscriberFromGroup(subscriberId, groupId, apiKey) {
  const res = await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}/groups/${groupId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  return res.ok || res.status === 404;
}

/**
 * Rituel (session à 4 jours ou plus) vs Marathon (3 jours ou moins) + groupe
 * source. Même règle de seuil que la page confirmation (3 × 24h pleines).
 * Idempotent, ne lève jamais : un échec ne doit pas bloquer une inscription.
 */
export async function assignEs2SegmentGroups({ email, sessionDateIso, trafficSource, apiKey }) {
  try {
    if (!apiKey || !email) return;
    const sub = await getMailerLiteSubscriberId(email, apiKey);
    if (!sub?.id) return;

    const DAY = 86400000;
    const startMs = new Date(sessionDateIso || '').getTime();
    const isMarathon = Number.isFinite(startMs) && startMs - Date.now() <= 3 * DAY;
    const cadenceGroup = isMarathon ? ES2_SEGMENT_GROUPS.marathon : ES2_SEGMENT_GROUPS.rituel;
    const srcGroup =
      trafficSource === 'meta_ad' ? ES2_SEGMENT_GROUPS.srcMeta
      : trafficSource === 'tiktok_ad' ? ES2_SEGMENT_GROUPS.srcTiktok
      : ES2_SEGMENT_GROUPS.srcOrga;

    await addSubscriberToGroup(sub.id, cadenceGroup, apiKey);
    await addSubscriberToGroup(sub.id, srcGroup, apiKey);
  } catch (err) {
    console.error('assignEs2SegmentGroups:', err);
  }
}

export async function addToCheckoutAbandonGroup(email, apiKey) {
  try {
    if (!apiKey || !email) return;
    const sub = await getMailerLiteSubscriberId(email, apiKey);
    if (sub?.id) await addSubscriberToGroup(sub.id, ES2_SEGMENT_GROUPS.checkoutAbandon, apiKey);
  } catch (err) {
    console.error('addToCheckoutAbandonGroup:', err);
  }
}

export async function removeFromCheckoutAbandonGroup(email, apiKey) {
  try {
    if (!apiKey || !email) return;
    const sub = await getMailerLiteSubscriberId(email, apiKey);
    if (sub?.id) await removeSubscriberFromGroup(sub.id, ES2_SEGMENT_GROUPS.checkoutAbandon, apiKey);
  } catch (err) {
    console.error('removeFromCheckoutAbandonGroup:', err);
  }
}

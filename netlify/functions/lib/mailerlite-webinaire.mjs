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

  let subscriberId = await getMailerLiteSubscriberId(email, apiKey);

  if (subscriberId) {
    await fetch(`${MAILERLITE_API_BASE}/subscribers/${subscriberId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'active', resubscribe: true, fields }),
    });
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

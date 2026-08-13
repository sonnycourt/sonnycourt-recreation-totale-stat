import { addSubscriberToGroup, getMailerLiteSubscriberId, removeSubscriberFromGroup } from './mailerlite-webinaire.mjs';
import { supabaseGet, supabasePatch } from './supabase-rest.mjs';

const MAX_ATTEMPTS = 5;
const clean = (value, max = 1_000) => String(value == null ? '' : value).trim().slice(0, max);
const encode = (value) => encodeURIComponent(clean(value));

export function mc2ContractDocumentEmailsEnabled(env = process.env) {
  return clean(env.MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2ContractDocumentEmailConfig(env = process.env) {
  return {
    apiKey: clean(env.MAILERLITE_API_KEY, 2_000),
    groupId: clean(env.MAILERLITE_GROUP_MC2_CONTRACT_DOCUMENTS, 160),
    publicBaseUrl: clean(env.MC2_PUBLIC_BASE_URL || 'https://sonnycourt.com', 500).replace(/\/$/, ''),
  };
}

function purchaseDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
}

function nextAttempt(attempts, now) {
  const minutes = [5, 15, 60, 180][Math.min(Math.max(attempts - 1, 0), 3)];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

async function loadRegistration(token) {
  const result = await supabaseGet(
    `mc2_registrations?token=eq.${encode(token)}`
      + '&payment_status=eq.paid&select=token,email,prenom,payment_status&limit=1',
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function ensureSubscriber(registration, config) {
  let subscriberId = await getMailerLiteSubscriberId(registration.email, config.apiKey);
  if (subscriberId) return subscriberId;
  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: registration.email,
      fields: { first_name: registration.prenom || '', name: registration.prenom || '' },
    }),
  });
  const json = await response.json().catch(() => ({}));
  subscriberId = json?.data?.id || null;
  if (!response.ok || !subscriberId) throw new Error(`mailerlite_subscriber_${response.status}`);
  return subscriberId;
}

async function updateSubscriber(subscriberId, registration, document, config) {
  const response = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: {
      first_name: registration.prenom || '',
      name: registration.prenom || '',
      mc2_contract_documents_url: `${config.publicBaseUrl}/documents-contractuels/${document.access_token}`,
      mc2_contract_purchase_date: purchaseDate(document.purchased_at),
    } }),
  });
  if (!response.ok) throw new Error(`mailerlite_contract_fields_${response.status}`);
}

export async function processMc2ContractDocumentEmail(document, now = new Date(), env = process.env) {
  const attempts = Math.max(0, Number(document?.notification_attempts) || 0) + 1;
  const claimed = await supabasePatch(
    'mc2_contract_documents',
    `id=eq.${encode(document?.id)}&notification_status=in.(pending,retry)`,
    {
      notification_status: 'processing',
      notification_attempts: attempts,
      notification_last_attempt_at: now.toISOString(),
      notification_last_error: null,
    },
  );
  if (!claimed.ok || !Array.isArray(claimed.data) || claimed.data.length !== 1) {
    return { status: 'skipped', reason: 'already_claimed' };
  }

  try {
    const config = mc2ContractDocumentEmailConfig(env);
    if (!config.apiKey) throw new Error('mailerlite_api_key_missing');
    if (!config.groupId) throw new Error('mailerlite_contract_group_missing');
    if (!document?.access_token) throw new Error('contract_access_token_missing');
    const registration = await loadRegistration(document.registration_token);
    if (!registration?.email) throw new Error('paid_registration_missing');
    const subscriberId = await ensureSubscriber(registration, config);
    await updateSubscriber(subscriberId, registration, document, config);
    // Le groupe représente un événement ponctuel. On le réarme uniquement au
    // premier essai ; les retries ne peuvent donc jamais envoyer deux emails.
    if (attempts === 1 && !(await removeSubscriberFromGroup(subscriberId, config.groupId, config.apiKey))) {
      throw new Error('mailerlite_contract_group_reset_failed');
    }
    const assigned = await addSubscriberToGroup(subscriberId, config.groupId, config.apiKey);
    if (!assigned.assigned && !assigned.alreadyInGroup) {
      throw new Error('mailerlite_contract_group_assignment_failed');
    }
    const saved = await supabasePatch('mc2_contract_documents', `id=eq.${encode(document.id)}`, {
      notification_status: 'delivered',
      notification_delivered_at: now.toISOString(),
      notification_last_error: null,
      mailerlite_group_id: config.groupId,
      mailerlite_subscriber_id: subscriberId,
    });
    if (!saved.ok) throw new Error(`contract_notification_save_${saved.status}`);
    return { status: 'delivered' };
  } catch (error) {
    const exhausted = attempts >= MAX_ATTEMPTS;
    await supabasePatch('mc2_contract_documents', `id=eq.${encode(document.id)}`, {
      notification_status: exhausted ? 'skipped' : 'retry',
      notification_due_at: exhausted ? document.notification_due_at : nextAttempt(attempts, now),
      notification_last_error: clean(error?.message || 'delivery_failed', 300),
    });
    return { status: exhausted ? 'skipped' : 'retry', error: clean(error?.message, 300) };
  }
}


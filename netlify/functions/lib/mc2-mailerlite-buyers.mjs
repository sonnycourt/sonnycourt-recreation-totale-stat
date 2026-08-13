import {
  addSubscriberToGroup,
  getMailerLiteSubscriberId,
} from './mailerlite-webinaire.mjs';

function clean(value, max = 1_000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function mc2BuyerMailerLiteConfig(env = process.env) {
  return {
    apiKey: clean(env.MAILERLITE_API_KEY),
    groupId: clean(env.MAILERLITE_GROUP_MC2_BUYERS || env.ML_MC2_BUYERS, 120),
  };
}

export async function addMc2BuyerToMailerLite({ email, env = process.env } = {}) {
  const safeEmail = clean(email, 320).toLowerCase();
  const { apiKey, groupId } = mc2BuyerMailerLiteConfig(env);
  if (!safeEmail) return { ok: false, skipped: 'email_missing' };
  if (!apiKey) return { ok: false, skipped: 'api_key_missing' };
  if (!groupId) return { ok: false, skipped: 'group_missing' };

  const subscriberId = await getMailerLiteSubscriberId(safeEmail, apiKey);
  if (!subscriberId) return { ok: false, skipped: 'subscriber_missing' };
  const result = await addSubscriberToGroup(subscriberId, groupId, apiKey);
  if (!result.assigned && !result.alreadyInGroup) {
    return { ok: false, error: 'group_assignment_failed', subscriberId, groupId };
  }
  return {
    ok: true,
    subscriberId,
    groupId,
    alreadyInGroup: result.alreadyInGroup,
  };
}

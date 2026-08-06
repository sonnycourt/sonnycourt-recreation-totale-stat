import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import { googleAccessTokenForCoach } from './coaching-google.mjs';
import { coachingAppUrl } from './coaching-origin.mjs';
import { loadCoachingCoachContact } from './coaching-contacts.mjs';

async function googleAccessToken() {
  const refreshToken = process.env.GOOGLE_ROMAIN_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_COACHING_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_COACHING_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  if (!response.ok) throw new Error(`google_token_${response.status}`);
  return (await response.json()).access_token;
}

async function createGoogleMeeting(context) {
  if (context.session.google_event_id && context.session.meet_url) {
    return { status: 'already_created', meet_url: context.session.meet_url };
  }
  const token = await googleAccessTokenForCoach(context.coach.id) || (context.coach.slug === 'romain' ? await googleAccessToken() : null);
  if (!token) return context.session.google_event_id ? { status: 'already_created', meet_url: null } : { status: 'not_configured' };
  const calendarId = context.coach.google_calendar_id || process.env.GOOGLE_ROMAIN_CALENDAR_ID || 'primary';
  const eventId = `c${String(context.session.id).replace(/-/g, '').toLowerCase()}`;
  if (context.session.google_event_id) {
    const existing = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(context.session.google_event_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (existing.ok) {
      const data = await existing.json().catch(() => ({}));
      const meetUrl = data.hangoutLink || data.conferenceData?.entryPoints?.find((item) => item.entryPointType === 'video')?.uri || null;
      if (meetUrl) {
        const stored = await supabasePatch('coaching_sessions', `id=eq.${encodeURIComponent(context.session.id)}`, { meet_url: meetUrl });
        if (!stored.ok || !Array.isArray(stored.data) || !stored.data[0]) throw new Error(`google_calendar_persist_${stored.status}`);
      }
      return { status: meetUrl ? 'refreshed' : 'already_created', meet_url: meetUrl };
    }
    if (existing.status !== 404 && existing.status !== 410) throw new Error(`google_calendar_lookup_${existing.status}`);
  }
  let response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: eventId,
      summary: `Coaching individuel — ${context.client.first_name}`,
      description: 'Séance de coaching Sonny Court. La préparation est disponible dans le Coaching OS.',
      start: { dateTime: context.session.starts_at, timeZone: context.session.timezone || 'Europe/Zurich' },
      end: { dateTime: context.session.ends_at, timeZone: context.session.timezone || 'Europe/Zurich' },
      attendees: [context.client.email, context.coach.email].filter(Boolean).map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: `coaching-${context.session.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  });
  let data = await response.json().catch(() => ({}));
  if (response.status === 409) {
    response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new Error(`google_calendar_${response.status}`);
  const meetUrl = data.hangoutLink || data.conferenceData?.entryPoints?.find((item) => item.entryPointType === 'video')?.uri || null;
  const stored = await supabasePatch('coaching_sessions', `id=eq.${encodeURIComponent(context.session.id)}`, { google_event_id: data.id || eventId, meet_url: meetUrl });
  if (!stored.ok || !Array.isArray(stored.data) || !stored.data[0]) throw new Error(`google_calendar_persist_${stored.status}`);
  return { status: 'created', meet_url: meetUrl };
}

export async function deleteCoachingGoogleMeeting({ coachId, coachSlug, calendarId, eventId }) {
  if (!eventId || !coachId) return { status: 'skipped' };
  const token = await googleAccessTokenForCoach(coachId) || (coachSlug === 'romain' ? await googleAccessToken() : null);
  if (!token) return { status: 'not_configured' };
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404 || response.status === 410) return { status: 'already_deleted' };
  if (!response.ok) throw new Error(`google_calendar_delete_${response.status}`);
  return { status: 'deleted' };
}

function frenchDate(value, timeZone = 'Europe/Zurich') {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export async function sendCoachingTransactionalEmail({ to, name, subject, html, text }) {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const from = process.env.COACHING_EMAIL_FROM;
  if (!apiKey || !from || !to) return { status: 'not_configured' };
  const response = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: from, name: process.env.COACHING_EMAIL_FROM_NAME || 'Sonny Court Coaching' },
      to: [{ email: to, name: name || undefined }],
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) throw new Error(`mailersend_${response.status}`);
  return { status: 'sent' };
}

async function loadContext(sessionId) {
  const result = await supabaseGet(
    `coaching_sessions?id=eq.${encodeURIComponent(sessionId)}&select=id,starts_at,ends_at,timezone,google_event_id,meet_url,coaching_clients(id,first_name,last_name,email),coaching_coaches(id,slug,first_name,last_name,email,phone,country,google_calendar_id)&limit=1`,
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!row) throw new Error('session_context_missing');
  return { session: row, client: row.coaching_clients, coach: row.coaching_coaches };
}

async function sendSessionEmailOnce({ context, kind, recipient, send }) {
  if (!recipient) return { status: 'skipped' };
  const delivered = await supabaseGet(
    `coaching_email_deliveries?session_id=eq.${encodeURIComponent(context.session.id)}&kind=eq.${encodeURIComponent(kind)}&recipient_email=eq.${encodeURIComponent(recipient)}&status=eq.sent&select=id&limit=1`,
  );
  if (!delivered.ok) throw new Error(`coaching_delivery_check_${delivered.status}`);
  if (Array.isArray(delivered.data) && delivered.data[0]) return { status: 'already_sent' };
  const result = await send();
  if (result.status !== 'sent') return result;
  const logged = await supabasePost('coaching_email_deliveries', {
    session_id: context.session.id,
    client_id: context.client.id,
    kind,
    recipient_email: recipient,
    provider: 'mailersend',
    status: 'sent',
  });
  if (!logged.ok && logged.status !== 409) throw new Error(`coaching_delivery_log_${logged.status}`);
  return result;
}

export async function finalizeCoachingBooking(sessionId) {
  const context = await loadContext(sessionId);
  const results = { calendar: { status: 'skipped' }, client_email: { status: 'skipped' }, coach_email: { status: 'skipped' } };
  try {
    results.calendar = await createGoogleMeeting(context);
    if (results.calendar.meet_url) context.session.meet_url = results.calendar.meet_url;
  } catch (error) {
    console.error('coaching Google Calendar:', error);
    results.calendar = { status: 'error' };
  }
  const when = frenchDate(context.session.starts_at, context.session.timezone || 'Europe/Zurich');
  const safeFirstName = escapeHtml(context.client.first_name);
  const coachName = [context.coach.first_name, context.coach.last_name].filter(Boolean).join(' ') || 'ton coach';
  const safeCoachName = escapeHtml(coachName);
  const safeMeetUrl = escapeHtml(context.session.meet_url);
  const coachContact = await loadCoachingCoachContact(context.coach.slug, context.coach).catch(() => null);
  const safeCoachPhone = escapeHtml(coachContact?.phone);
  const safeWhatsappUrl = escapeHtml(coachContact?.whatsapp_url);
  const studentSpaceUrl = coachingAppUrl('/eleve');
  const coachSpaceUrl = coachingAppUrl('/coach');
  const meetLine = context.session.meet_url ? `<p><a href="${safeMeetUrl}">Rejoindre Google Meet</a></p>` : '<p>Le lien Google Meet apparaîtra dans ton espace.</p>';
  const whatsappLine = coachContact
    ? `<p>Une question ou un empêchement avant la séance ? <a href="${safeWhatsappUrl}">Écris directement à ${safeCoachName} sur WhatsApp</a> au ${safeCoachPhone}.</p>`
    : '';
  const whatsappText = coachContact
    ? ` Question ou empêchement : WhatsApp ${coachContact.phone} (${coachContact.whatsapp_url}).`
    : '';
  try {
    results.client_email = await sendSessionEmailOnce({
      context,
      kind: 'booking_confirmation_client',
      recipient: context.client.email,
      send: () => sendCoachingTransactionalEmail({
        to: context.client.email,
        name: context.client.first_name,
        subject: `Ta séance avec ${coachName} est confirmée`,
        html: `<p>Bonjour ${safeFirstName},</p><p>Ta séance avec ${safeCoachName} est confirmée pour le <strong>${when}</strong>.</p>${meetLine}${whatsappLine}<p><a href="${studentSpaceUrl}">Ouvrir mon espace coaching</a></p>`,
        text: `Bonjour ${context.client.first_name}, ta séance est confirmée pour le ${when}. ${context.session.meet_url || 'Le lien Google Meet apparaîtra dans ton espace.'}${whatsappText} Espace coaching : ${studentSpaceUrl}`,
      }),
    });
  } catch (error) {
    console.error('coaching client email:', error);
    results.client_email = { status: 'error' };
  }
  try {
    results.coach_email = await sendSessionEmailOnce({
      context,
      kind: 'booking_notification_coach',
      recipient: context.coach.email,
      send: () => sendCoachingTransactionalEmail({
        to: context.coach.email,
        name: context.coach.first_name,
        subject: `Nouvelle séance — ${context.client.first_name}`,
        html: `<p>Une séance avec ${context.client.first_name} est confirmée pour le <strong>${when}</strong>.</p><p>La préparation est disponible dans le Coaching OS.</p>${meetLine}<p><a href="${coachSpaceUrl}">Ouvrir mon espace coach</a></p>`,
        text: `Séance avec ${context.client.first_name} confirmée pour le ${when}. Espace coach : ${coachSpaceUrl}`,
      }),
    });
  } catch (error) {
    console.error('coaching coach email:', error);
    results.coach_email = { status: 'error' };
  }
  return results;
}

export async function sendCoachingActivationEmail({ email, firstName, activationUrl, credits, firstConsultation = false }) {
  const safeName = escapeHtml(firstName);
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(activationUrl);
  const purchaseCopy = firstConsultation
    ? '<p>Ta première consultation avec Romain est confirmée. Ton espace coaching est déjà préparé.</p>'
    : `<p>Ton achat est confirmé et <strong>${Number(credits) || 0} crédit(s)</strong> sont disponibles.</p>`;
  const textCopy = firstConsultation
    ? 'Ta première consultation avec Romain est confirmée. Ton espace coaching est déjà préparé.'
    : `Ton achat est confirmé et ${Number(credits) || 0} crédit(s) sont disponibles.`;
  return sendCoachingTransactionalEmail({
    to: email,
    name: firstName,
    subject: 'Crée ton mot de passe pour accéder à ton espace coaching',
    html: `<p>Bonjour ${safeName},</p>${purchaseCopy}<p>Ton accès est lié à l’adresse <strong>${safeEmail}</strong>. Il ne te reste qu’à choisir ton mot de passe.</p><p><a href="${safeUrl}">Créer mon mot de passe et ouvrir mon espace</a></p><p>Ce lien personnel expire dans 48 heures. Tu pourras en demander un nouveau depuis la page de connexion.</p>`,
    text: `Bonjour ${firstName}, ${textCopy} Ton accès est lié à ${email}. Crée ton mot de passe dans les 48 heures : ${activationUrl}`,
  });
}

export async function sendCoachingReviewRequestOnce(sessionId) {
  const context = await loadContext(sessionId);
  const reviewUrl = coachingAppUrl('/eleve?avis=1');
  const coachName = [context.coach.first_name, context.coach.last_name].filter(Boolean).join(' ') || 'ton coach';
  const safeFirstName = escapeHtml(context.client.first_name);
  const safeCoachName = escapeHtml(coachName);
  const safeReviewUrl = escapeHtml(reviewUrl);

  return sendSessionEmailOnce({
    context,
    kind: 'session_review_request_client',
    recipient: context.client.email,
    send: () => sendCoachingTransactionalEmail({
      to: context.client.email,
      name: context.client.first_name,
      subject: `Comment s’est passée ta séance avec ${coachName} ?`,
      html: `<p>Bonjour ${safeFirstName},</p><p>Ta séance avec ${safeCoachName} vient de se terminer.</p><p>Une note et quelques mots suffisent pour nous aider à préserver la qualité de chaque accompagnement.</p><p><a href="${safeReviewUrl}">Donner mon avis en 10 secondes</a></p>`,
      text: `Bonjour ${context.client.first_name}, comment s’est passée ta séance avec ${coachName} ? Donne ton avis en 10 secondes : ${reviewUrl}`,
    }),
  });
}

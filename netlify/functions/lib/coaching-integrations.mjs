import crypto from 'crypto';
import { supabaseGet, supabasePatch } from './supabase-rest.mjs';
import { googleAccessTokenForCoach } from './coaching-google.mjs';

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
  const token = await googleAccessTokenForCoach(context.coach.id) || (context.coach.slug === 'romain' ? await googleAccessToken() : null);
  if (!token) return { status: 'not_configured' };
  const calendarId = context.coach.google_calendar_id || process.env.GOOGLE_ROMAIN_CALENDAR_ID || 'primary';
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: `Coaching individuel — ${context.client.first_name}`,
      description: 'Séance de coaching Sonny Court. La préparation est disponible dans le Coaching OS.',
      start: { dateTime: context.session.starts_at, timeZone: context.session.timezone || 'Europe/Zurich' },
      end: { dateTime: context.session.ends_at, timeZone: context.session.timezone || 'Europe/Zurich' },
      attendees: [context.client.email, context.coach.email].filter(Boolean).map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: `coaching-${context.session.id}-${crypto.randomUUID()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`google_calendar_${response.status}`);
  const meetUrl = data.hangoutLink || data.conferenceData?.entryPoints?.find((item) => item.entryPointType === 'video')?.uri || null;
  await supabasePatch('coaching_sessions', `id=eq.${encodeURIComponent(context.session.id)}`, { google_event_id: data.id, meet_url: meetUrl });
  return { status: 'created', meet_url: meetUrl };
}

function frenchDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(new Date(value));
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
    `coaching_sessions?id=eq.${encodeURIComponent(sessionId)}&select=id,starts_at,ends_at,timezone,meet_url,coaching_clients(id,first_name,last_name,email),coaching_coaches(id,slug,first_name,last_name,email,google_calendar_id)&limit=1`,
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!row) throw new Error('session_context_missing');
  return { session: row, client: row.coaching_clients, coach: row.coaching_coaches };
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
  const when = frenchDate(context.session.starts_at);
  const safeFirstName = escapeHtml(context.client.first_name);
  const safeMeetUrl = escapeHtml(context.session.meet_url);
  const meetLine = context.session.meet_url ? `<p><a href="${safeMeetUrl}">Rejoindre Google Meet</a></p>` : '<p>Le lien Google Meet apparaîtra dans ton espace.</p>';
  try {
    results.client_email = await sendCoachingTransactionalEmail({
      to: context.client.email,
      name: context.client.first_name,
      subject: 'Ta séance avec Romain est confirmée',
      html: `<p>Bonjour ${safeFirstName},</p><p>Ta séance est confirmée pour le <strong>${when}</strong>.</p>${meetLine}<p>Tu retrouveras tous les détails dans ton espace coaching.</p>`,
      text: `Bonjour ${context.client.first_name}, ta séance est confirmée pour le ${when}. ${context.session.meet_url || 'Le lien Google Meet apparaîtra dans ton espace.'}`,
    });
  } catch (error) {
    console.error('coaching client email:', error);
    results.client_email = { status: 'error' };
  }
  try {
    results.coach_email = await sendCoachingTransactionalEmail({
      to: context.coach.email,
      name: context.coach.first_name,
      subject: `Nouvelle séance — ${context.client.first_name}`,
      html: `<p>Une séance avec ${context.client.first_name} est confirmée pour le <strong>${when}</strong>.</p><p>La préparation est disponible dans le Coaching OS.</p>${meetLine}`,
      text: `Séance avec ${context.client.first_name} confirmée pour le ${when}.`,
    });
  } catch (error) {
    console.error('coaching coach email:', error);
    results.coach_email = { status: 'error' };
  }
  return results;
}

export async function sendCoachingActivationEmail({ email, firstName, activationUrl, credits }) {
  const safeName = escapeHtml(firstName);
  const safeUrl = escapeHtml(activationUrl);
  return sendCoachingTransactionalEmail({
    to: email,
    name: firstName,
    subject: 'Active ton espace coaching',
    html: `<p>Bonjour ${safeName},</p><p>Ton achat est confirmé et <strong>${Number(credits) || 0} crédit(s)</strong> sont disponibles.</p><p><a href="${safeUrl}">Choisir mon mot de passe et ouvrir mon espace</a></p><p>Ce lien personnel expire dans 48 heures.</p>`,
    text: `Bonjour ${firstName}, ton achat est confirmé. Active ton espace dans les 48 heures : ${activationUrl}`,
  });
}

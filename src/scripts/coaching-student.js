import { clearDemoSession, formatDateTime, getDemoState, setDemoSession } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

function creditTimeLabel(credits) {
  const minutes = Math.max(Number(credits || 0), 0) * 15;
  if (minutes < 60) return `${minutes} min disponibles`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ''} disponibles`;
}

function safeAvatar(value) {
  const avatar = String(value || '');
  return avatar.startsWith('/') || /^https:\/\//i.test(avatar) ? avatar : '';
}

function renderStudentAvatar(avatarUrl, initials) {
  const avatar = safeAvatar(avatarUrl);
  document.querySelectorAll('[data-student-avatar]').forEach((node) => {
    node.innerHTML = avatar ? `<img src="${avatar}" alt="" />` : `<span>${initials}</span>`;
  });
}

function openContinuationPrompt(student) {
  const prompt = document.querySelector('[data-continuation-prompt]');
  if (!prompt || !student.showContinuationPrompt) return;
  const key = `coaching-continuation-${student.lastCompletedSessionId || 'demo'}`;
  const forced = new URLSearchParams(window.location.search).has('postSession');
  if (!forced && localStorage.getItem(key)) return;
  document.querySelector('[data-prompt-balance]').textContent = String(Math.max(student.creditsTotal - student.creditsUsed, 0));
  document.querySelector('[data-prompt-time]').textContent = creditTimeLabel(Math.max(student.creditsTotal - student.creditsUsed, 0));
  prompt.dataset.dismissKey = key;
  window.setTimeout(() => {
    prompt.classList.add('is-open');
    prompt.setAttribute('aria-hidden', 'false');
  }, 700);
}

function renderStudent(student) {
  const remaining = Math.max(Number(student.creditsTotal) - Number(student.creditsUsed), 0);
  const ratio = student.creditsTotal ? (remaining / student.creditsTotal) * 100 : 0;
  const fullName = [student.firstName, student.lastName].filter(Boolean).join(' ');
  const initials = fullName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const coachName = student.coachName || 'Romain';
  const coachAvatar = String(student.coachAvatar || '/media/coachs/romain.webp?v=ai-hd');

  document.querySelectorAll('[data-student-first-name]').forEach((node) => { node.textContent = student.firstName; });
  document.querySelectorAll('[data-student-full-name]').forEach((node) => { node.textContent = fullName; });
  document.querySelectorAll('[data-student-initials]').forEach((node) => { node.textContent = initials; });
  renderStudentAvatar(student.avatarUrl, initials);
  document.querySelectorAll('[data-student-remaining]').forEach((node) => { node.textContent = String(remaining); });
  document.querySelectorAll('[data-student-time]').forEach((node) => { node.textContent = creditTimeLabel(remaining); });
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  document.querySelectorAll('[data-coach-avatar]').forEach((image) => {
    image.src = coachAvatar.startsWith('/') || /^https:\/\//i.test(coachAvatar) ? coachAvatar : '/favicon.svg';
    image.alt = coachName;
  });
  const continuationUrl = coachingUrl('/coaching/credits');
  document.querySelectorAll('[data-continuation-link]').forEach((link) => {
    link.hidden = !continuationUrl;
    if (continuationUrl) link.href = continuationUrl;
  });
  document.querySelector('[data-student-total]').textContent = String(student.creditsTotal);
  document.querySelector('[data-student-plan]').textContent = student.plan || 'Accompagnement individuel';
  document.querySelector('[data-credit-visual]').style.background = `conic-gradient(var(--cp-green) 0 ${ratio}%, rgba(136,190,246,.09) ${ratio}% 100%)`;

  const nextTitle = document.querySelector('[data-next-title]');
  const nextCopy = document.querySelector('[data-next-copy]');
  const nextActions = document.querySelectorAll('[data-next-action]');
  const prepBadge = document.querySelector('[data-preparation-badge]');
  const setNextActions = (href, label) => nextActions.forEach((action) => { action.href = href; action.textContent = label; });

  if (student.nextSession) {
    nextTitle.textContent = 'Ta prochaine séance est réservée.';
    nextCopy.textContent = `${formatDateTime(student.nextSession)} avec ${coachName}. Ton lien Google Meet apparaîtra ici dès sa création.`;
    setNextActions(coachingUrl('/coaching/confirmation'), 'Voir ma réservation');
  } else if (remaining <= 0) {
    nextTitle.textContent = 'Choisis comment tu veux continuer.';
    nextCopy.textContent = 'Ton cycle actuel est terminé. Tu peux choisir une séance ponctuelle ou un nouveau parcours.';
    setNextActions(continuationUrl, 'Ajouter des crédits');
  } else if (student.preparation.completed) {
    nextTitle.textContent = 'Ta préparation est prête.';
    nextCopy.textContent = `${coachName} retrouvera tes réponses dans ton dossier. Il reste seulement à choisir un créneau.`;
    setNextActions(coachingUrl('/coaching/reserver'), 'Choisir mon créneau');
  } else {
    nextTitle.textContent = 'Prépare ta prochaine séance.';
    nextCopy.textContent = `Quelques réponses courtes permettront à ${coachName} de reprendre le fil sans perdre les premières minutes.`;
    setNextActions(coachingUrl('/coaching/preparation'), 'Commencer ma préparation');
  }

  prepBadge.textContent = student.preparation.completed ? 'Préparation complétée' : 'Environ 3 minutes';
  prepBadge.classList.toggle('amber', !student.preparation.completed);

  const rows = student.history.slice();
  if (student.nextSession) rows.unshift({ date: formatDateTime(student.nextSession), label: 'Prochaine séance', duration: `${student.durationMinutes || 60} min`, status: 'Confirmée' });
  document.querySelector('[data-student-history]').innerHTML = rows.map((item) => `
    <div class="timeline-row"><i></i><span><strong>${item.label}</strong><small>${item.duration} · ${item.status}</small></span><time>${item.date}</time></div>
  `).join('');
  openContinuationPrompt(student);
}

async function getLiveStudent(session) {
  const { data: client, error: clientError } = await coachingSupabase
    .from('coaching_clients')
    .select('id,first_name,last_name,email,objective,avatar_url,coach_id,coaching_coaches(slug,first_name,last_name,avatar_url)')
    .eq('auth_user_id', session.user.id)
    .single();
  if (clientError) throw clientError;

  const nowIso = new Date().toISOString();
  const [engagementResult, balanceResult, sessionsResult, responsesResult, membershipResult] = await Promise.all([
    coachingSupabase.from('coaching_engagements').select('id,offer_id,started_at,expires_at,coaching_offers(slug,name,sessions_count,duration_minutes,metadata)').eq('client_id', client.id).eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${nowIso}`).order('started_at', { ascending: false }),
    coachingSupabase.rpc('coaching_credit_balance', { p_client_id: client.id }),
    coachingSupabase.from('coaching_sessions').select('id,starts_at,ends_at,status,meet_url,completed_at,credits_cost').eq('client_id', client.id).order('starts_at', { ascending: false }),
    coachingSupabase.from('coaching_form_responses').select('id,status,submitted_at,session_id').eq('client_id', client.id).is('session_id', null).order('created_at', { ascending: false }).limit(1),
    coachingSupabase.from('coaching_subscriptions').select('id,status,current_period_end,coaching_offers(name,sessions_count)').eq('client_id', client.id).in('status', ['trialing', 'active', 'past_due']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = [engagementResult, balanceResult, sessionsResult, responsesResult].find((result) => result.error)?.error;
  if (error) throw error;

  const engagements = engagementResult.data || [];
  const engagement = engagements[0];
  const offer = engagement?.coaching_offers;
  const balance = Number(balanceResult.data || 0);
  const walletEngagements = engagements.filter((item) => {
    const kind = item.coaching_offers?.metadata?.kind;
    return kind ? ['credit_pack', 'membership'].includes(kind) : item.coaching_offers?.slug !== 'first-consultation';
  });
  const purchasedCredits = walletEngagements.reduce((sum, item) => sum + Number(item.coaching_offers?.sessions_count || 0), 0);
  const now = Date.now();
  const sessions = sessionsResult.data || [];
  const next = sessions.filter((item) => item.status === 'confirmed' && new Date(item.starts_at).getTime() >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
  const lastCompleted = sessions.filter((item) => item.status === 'completed').sort((a, b) => new Date(b.completed_at || b.ends_at) - new Date(a.completed_at || a.ends_at))[0];
  const history = sessions.filter((item) => item.status === 'completed' || new Date(item.starts_at).getTime() < now).map((item, index) => ({
    date: formatDateTime(item.starts_at),
    label: index === sessions.length - 1 ? 'Première consultation' : 'Séance de suivi',
    duration: `${Math.round((new Date(item.ends_at) - new Date(item.starts_at)) / 60000)} min`,
    status: item.status === 'completed' ? 'Terminée' : 'Passée',
  }));
  const coach = client.coaching_coaches;
  return {
    id: client.id,
    firstName: client.first_name,
    lastName: client.last_name,
    email: client.email,
    avatarUrl: client.avatar_url,
    objective: client.objective,
    coachName: coach ? [coach.first_name, coach.last_name].filter(Boolean).join(' ') : 'Romain',
    coachSlug: coach?.slug || 'romain',
    coachAvatar: coach?.avatar_url || '/media/coachs/romain.webp?v=ai-hd',
    plan: membershipResult.error ? (walletEngagements.length > 1 ? `${walletEngagements.length} recharges actives` : offer?.name || 'Accompagnement individuel') : membershipResult.data?.coaching_offers?.name || offer?.name || 'Accompagnement individuel',
    creditsTotal: Math.max(purchasedCredits, balance),
    creditsUsed: Math.max(purchasedCredits - balance, 0),
    durationMinutes: Number(offer?.duration_minutes || 45),
    nextSession: next?.starts_at || null,
    preparation: { completed: (responsesResult.data || []).some((item) => item.status === 'submitted') },
    history,
    membership: membershipResult.error ? null : membershipResult.data,
    lastCompletedSessionId: lastCompleted?.id || null,
    showContinuationPrompt: Boolean(lastCompleted && !next && (now - new Date(lastCompleted.completed_at || lastCompleted.ends_at).getTime()) <= 72 * 60 * 60 * 1000),
  };
}

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  if (access.mode === 'demo') {
    setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
    const demoStudent = { ...getDemoState().student, showContinuationPrompt: true, lastCompletedSessionId: 'demo-last-session' };
    renderStudent(demoStudent);
    window.addEventListener('coaching-demo-updated', () => renderStudent(getDemoState().student));
  } else {
    try { renderStudent(await getLiveStudent(access.session)); }
    catch (error) { console.error('coaching student load', error); }
  }
}

document.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
  event.preventDefault();
  if ((await requireCoachingRole('client'))?.mode === 'demo') {
    clearDemoSession();
    window.location.href = coachingUrl('/coaching');
  } else await signOutCoaching();
});

document.querySelectorAll('[data-prompt-close]').forEach((button) => button.addEventListener('click', () => {
  const prompt = document.querySelector('[data-continuation-prompt]');
  if (prompt?.dataset.dismissKey) localStorage.setItem(prompt.dataset.dismissKey, new Date().toISOString());
  prompt?.classList.remove('is-open');
  prompt?.setAttribute('aria-hidden', 'true');
}));

boot();

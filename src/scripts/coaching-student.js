import { clearDemoSession, formatDateTime, getDemoState, setDemoSession } from './coaching-demo-store.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

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
  document.querySelectorAll('[data-student-remaining]').forEach((node) => { node.textContent = String(remaining); });
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  document.querySelectorAll('[data-coach-avatar]').forEach((image) => {
    image.src = coachAvatar.startsWith('/') || /^https:\/\//i.test(coachAvatar) ? coachAvatar : '/favicon.svg';
    image.alt = coachName;
  });
  const continuationUrl = student.coachSlug === 'romain' || !student.coachSlug
    ? `/coach-romain/continuer?prenom=${encodeURIComponent(student.firstName)}&email=${encodeURIComponent(student.email || '')}`
    : '';
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
    setNextActions('/coaching/confirmation', 'Voir ma réservation');
  } else if (remaining <= 0) {
    nextTitle.textContent = 'Choisis comment tu veux continuer.';
    nextCopy.textContent = 'Ton cycle actuel est terminé. Tu peux choisir une séance ponctuelle ou un nouveau parcours.';
    if (continuationUrl) setNextActions(continuationUrl, 'Voir les options');
    else setNextActions('/coaching', 'Contacter l’équipe coaching');
  } else if (student.preparation.completed) {
    nextTitle.textContent = 'Ta préparation est prête.';
    nextCopy.textContent = `${coachName} retrouvera tes réponses dans ton dossier. Il reste seulement à choisir un créneau.`;
    setNextActions('/coaching/reserver', 'Choisir mon créneau');
  } else {
    nextTitle.textContent = 'Prépare ta prochaine séance.';
    nextCopy.textContent = `Quelques réponses courtes permettront à ${coachName} de reprendre le fil sans perdre les premières minutes.`;
    setNextActions('/coaching/preparation', 'Commencer ma préparation');
  }

  prepBadge.textContent = student.preparation.completed ? 'Préparation complétée' : 'Environ 3 minutes';
  prepBadge.classList.toggle('amber', !student.preparation.completed);

  const rows = student.history.slice();
  if (student.nextSession) rows.unshift({ date: formatDateTime(student.nextSession), label: 'Prochaine séance', duration: `${student.durationMinutes || 60} min`, status: 'Confirmée' });
  document.querySelector('[data-student-history]').innerHTML = rows.map((item) => `
    <div class="timeline-row"><i></i><span><strong>${item.label}</strong><small>${item.duration} · ${item.status}</small></span><time>${item.date}</time></div>
  `).join('');
}

async function getLiveStudent(session) {
  const { data: client, error: clientError } = await coachingSupabase
    .from('coaching_clients')
    .select('id,first_name,last_name,email,objective,coach_id,coaching_coaches(slug,first_name,last_name,avatar_url)')
    .eq('auth_user_id', session.user.id)
    .single();
  if (clientError) throw clientError;

  const [engagementResult, balanceResult, sessionsResult, responsesResult] = await Promise.all([
    coachingSupabase.from('coaching_engagements').select('id,offer_id,started_at,coaching_offers(name,sessions_count,duration_minutes)').eq('client_id', client.id).eq('status', 'active').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    coachingSupabase.rpc('coaching_credit_balance', { p_client_id: client.id }),
    coachingSupabase.from('coaching_sessions').select('id,starts_at,ends_at,status,meet_url').eq('client_id', client.id).order('starts_at', { ascending: false }),
    coachingSupabase.from('coaching_form_responses').select('id,status,submitted_at,session_id').eq('client_id', client.id).is('session_id', null).order('created_at', { ascending: false }).limit(1),
  ]);
  const error = [engagementResult, balanceResult, sessionsResult, responsesResult].find((result) => result.error)?.error;
  if (error) throw error;

  const engagement = engagementResult.data;
  const offer = engagement?.coaching_offers;
  const balance = Number(balanceResult.data || 0);
  const now = Date.now();
  const sessions = sessionsResult.data || [];
  const next = sessions.filter((item) => item.status === 'confirmed' && new Date(item.starts_at).getTime() >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
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
    objective: client.objective,
    coachName: coach ? [coach.first_name, coach.last_name].filter(Boolean).join(' ') : 'Romain',
    coachSlug: coach?.slug || 'romain',
    coachAvatar: coach?.avatar_url || '/media/coachs/romain.webp?v=ai-hd',
    plan: offer?.name || 'Accompagnement individuel',
    creditsTotal: Math.max(Number(offer?.sessions_count || 0), balance),
    creditsUsed: Math.max(Number(offer?.sessions_count || 0) - balance, 0),
    durationMinutes: Number(offer?.duration_minutes || 60),
    nextSession: next?.starts_at || null,
    preparation: { completed: (responsesResult.data || []).some((item) => item.status === 'submitted') },
    history,
  };
}

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  if (access.mode === 'demo') {
    setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
    renderStudent(getDemoState().student);
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
    window.location.href = '/coaching';
  } else await signOutCoaching();
});

boot();

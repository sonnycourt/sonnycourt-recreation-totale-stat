const STATUS_RANK = Object.freeze({ green: 0, unknown: 1, orange: 2, red: 3 });

export const MC2_HEALTH_THRESHOLDS = Object.freeze({
  refreshSeconds: 60,
  pageTimeoutMs: 4500,
  queueGraceMinutes: 5,
  queueRedCount: 3,
  queueRedAgeMinutes: 30,
  activePresenceMinutes: 10,
  flowWindowHours: 24,
  flowShortWindowHours: 2,
  optinsMinimum: 5,
  maturedRegistrationsMinimum: 3,
  attendanceOrangePercent: 20,
});

export const MC2_PAGE_PROBES = Object.freeze([
  { path: '/mc2/', label: 'Inscription', marker: 'JE M\'INSCRIS MAINTENANT' },
  { path: '/mc2/confirmation/', label: 'Confirmation', marker: 'Rejoins ta session' },
  { path: '/mc2/session/', label: 'Session', marker: 'Chargement de la session' },
  { path: '/mc2/replay/', label: 'Replay', marker: 'Retrouve ton accès au replay' },
  { path: '/commencer/', label: 'Checkout', marker: 'Commencer Esprit Subconscient 2.0' },
  { path: '/commencer/succes/', label: 'Après-paiement', marker: 'FINALISER MON INSCRIPTION' },
]);

export function worstStatus(statuses, { unknownBlocks = true } = {}) {
  const filtered = (Array.isArray(statuses) ? statuses : [])
    .filter((status) => Object.hasOwn(STATUS_RANK, status));
  if (!filtered.length) return 'unknown';
  if (!unknownBlocks) {
    const known = filtered.filter((status) => status !== 'unknown');
    if (known.length) return known.reduce((worst, status) => (
      STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst
    ), 'green');
  }
  return filtered.reduce((worst, status) => (
    STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst
  ), 'green');
}

export function iso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function ms(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function count(rows, predicate) {
  return (Array.isArray(rows) ? rows : []).filter(predicate).length;
}

function latestIso(rows, fields) {
  let latest = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const field of fields) {
      const stamp = ms(row?.[field]);
      if (stamp != null && (latest == null || stamp > latest)) latest = stamp;
    }
  }
  return latest == null ? null : new Date(latest).toISOString();
}

export function safeErrorCategory(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (text.includes('timeout')) return 'Délai d’exécution dépassé';
  if (text.includes('rate') || text.includes('429')) return 'Limite fournisseur atteinte';
  if (text.includes('401') || text.includes('403') || text.includes('unauthor')) return 'Authentification fournisseur refusée';
  if (text.includes('config') || text.includes('missing') || text.includes('not_ready')) return 'Configuration incomplète';
  if (/\b5\d\d\b/.test(text)) return 'Fournisseur temporairement indisponible';
  if (/\b4\d\d\b/.test(text)) return 'Requête fournisseur refusée';
  return 'Erreur d’exécution — voir les journaux';
}

export function summarizeQueue({
  id,
  name,
  description,
  enabled,
  configured = true,
  result,
  now = new Date(),
  dueField = 'due_at',
  pendingStatuses = ['pending', 'retry', 'processing'],
  successStatuses = ['sent', 'delivered', 'succeeded'],
  hardFailureStatuses = ['failed'],
  affectsOverall = true,
  diagnosticUrl,
}) {
  const base = {
    id,
    name,
    description,
    affectsOverall,
    checkedAt: now.toISOString(),
    diagnosticUrl,
    metrics: [],
    items: [],
  };

  if (!enabled) {
    return {
      ...base,
      status: 'unknown',
      affectsOverall: false,
      summary: 'Automatisation désactivée',
      note: 'Aucun état sain n’est déduit tant que cette automatisation est désactivée.',
      metrics: [{ label: 'État', value: 'Désactivé' }],
    };
  }

  if (!configured) {
    return {
      ...base,
      status: 'red',
      summary: 'Configuration incomplète',
      note: 'L’automatisation est activée mais une configuration obligatoire manque.',
      metrics: [{ label: 'Action', value: 'Configurer' }],
    };
  }

  if (!result?.ok || !Array.isArray(result.data)) {
    return {
      ...base,
      status: 'unknown',
      summary: 'État indisponible',
      note: 'La table ou sa lecture n’est pas disponible. Cet état n’est pas considéré comme sain.',
      metrics: [{ label: 'Lecture', value: 'Indisponible' }],
    };
  }

  const rows = result.data;
  if (rows.length === 0) {
    return {
      ...base,
      status: 'unknown',
      summary: 'Aucune exécution observée',
      note: 'La configuration et la table sont présentes, mais aucun job ne permet encore de confirmer une exécution saine.',
      metrics: [
        { label: 'En retard', value: 0 },
        { label: 'Exécutions', value: 0 },
      ],
    };
  }
  const nowMs = now.getTime();
  const graceMs = MC2_HEALTH_THRESHOLDS.queueGraceMinutes * 60_000;
  const overdue = rows.filter((row) => {
    const due = ms(row?.[dueField]);
    return pendingStatuses.includes(String(row?.status || ''))
      && due != null
      && due < nowMs - graceMs;
  });
  const hardFailures = rows.filter((row) => hardFailureStatuses.includes(String(row?.status || '')));
  const retries = count(rows, (row) => String(row?.status || '') === 'retry');
  const successes = count(rows, (row) => successStatuses.includes(String(row?.status || '')));
  const oldestOverdueMs = overdue.reduce((oldest, row) => {
    const due = ms(row?.[dueField]);
    return due != null && (oldest == null || due < oldest) ? due : oldest;
  }, null);
  const oldestOverdueMinutes = oldestOverdueMs == null
    ? 0
    : Math.max(0, Math.floor((nowMs - oldestOverdueMs) / 60_000));
  const lastErrorRow = [...rows]
    .filter((row) => row?.last_error)
    .sort((a, b) => (ms(b?.last_attempt_at || b?.updated_at) || 0) - (ms(a?.last_attempt_at || a?.updated_at) || 0))[0];

  let status = 'green';
  let summary = 'File à jour';
  if (hardFailures.length > 0
    || overdue.length >= MC2_HEALTH_THRESHOLDS.queueRedCount
    || oldestOverdueMinutes >= MC2_HEALTH_THRESHOLDS.queueRedAgeMinutes) {
    status = 'red';
    summary = 'Intervention requise';
  } else if (overdue.length > 0 || retries > 0) {
    status = 'orange';
    summary = 'Retard ou nouvelle tentative';
  }

  return {
    ...base,
    status,
    summary,
    note: `Seuils : orange dès 1 job en retard de plus de ${MC2_HEALTH_THRESHOLDS.queueGraceMinutes} min ; rouge dès ${MC2_HEALTH_THRESHOLDS.queueRedCount} jobs, un échec définitif ou ${MC2_HEALTH_THRESHOLDS.queueRedAgeMinutes} min de retard.`,
    lastRunAt: latestIso(rows, ['sent_at', 'delivered_at', 'succeeded_at', 'last_attempt_at', 'updated_at']),
    lastErrorAt: lastErrorRow ? iso(lastErrorRow.last_attempt_at || lastErrorRow.updated_at) : null,
    lastError: lastErrorRow ? safeErrorCategory(lastErrorRow.last_error) : null,
    metrics: [
      { label: 'En retard', value: overdue.length },
      { label: 'En reprise', value: retries },
      { label: 'Échecs', value: hardFailures.length },
      { label: 'Réussis', value: successes },
    ],
  };
}

export function summarizeFunnel({ registrationsResult, optinsResult, presenceResult, now = new Date() }) {
  const base = {
    id: 'funnel',
    name: 'Flux MC2',
    description: 'Inscription → présence → CTA → checkout → achat',
    affectsOverall: true,
    checkedAt: now.toISOString(),
    diagnosticUrl: '/mc2-sante/#flux-mc2',
  };
  if (!registrationsResult?.ok || !Array.isArray(registrationsResult.data)) {
    return {
      ...base,
      status: 'red',
      summary: 'Le flux ne peut pas être lu',
      note: 'La source principale des inscriptions MC2 est indisponible.',
      metrics: [],
      items: [],
    };
  }

  const nowMs = now.getTime();
  const shortCutoff = nowMs - MC2_HEALTH_THRESHOLDS.flowShortWindowHours * 3_600_000;
  const rows = registrationsResult.data;
  const recent = rows.filter((row) => (ms(row?.registered_at || row?.created_at) || 0) >= shortCutoff);
  const completed = recent.filter((row) => row?.registration_completed_at || !['partial', ''].includes(String(row?.statut || '')));
  const matured = recent.filter((row) => {
    const starts = ms(row?.session_starts_at);
    return starts != null && starts <= nowMs - 15 * 60_000;
  });
  const present = recent.filter((row) => row?.attended_live === true || Number(row?.watch_max_seconds_live || 0) > 0);
  const cta = recent.filter((row) => row?.clicked_cta === true || row?.saw_offer === true);
  const checkout = recent.filter((row) => row?.checkout_clicked === true
    || row?.checkout_engaged === true
    || Number(row?.checkout_view_count || 0) > 0);
  const purchased = recent.filter((row) => row?.purchased_at
    || row?.statut === 'purchased'
    || ['paid', 'succeeded', 'active', 'complete', 'completed'].includes(String(row?.payment_status || '').toLowerCase()));
  const activePresence = presenceResult?.ok && Array.isArray(presenceResult.data)
    ? presenceResult.data.filter((row) => {
      const updated = ms(row?.updated_at);
      return updated != null
        && updated >= nowMs - MC2_HEALTH_THRESHOLDS.activePresenceMinutes * 60_000
        && row?.is_playing === true;
    }).length
    : null;
  const optins = optinsResult?.ok && Array.isArray(optinsResult.data)
    ? new Set(optinsResult.data
      .filter((row) => (ms(row?.occurred_at || row?.created_at) || 0) >= shortCutoff)
      .map((row) => row?.funnel_id)
      .filter(Boolean)).size
    : null;

  let status = recent.length > 0 ? 'green' : 'unknown';
  let summary = recent.length > 0 ? 'Le flux reçoit des données' : 'Pas assez de trafic pour conclure';
  let note = `Mesure sur les ${MC2_HEALTH_THRESHOLDS.flowShortWindowHours} dernières heures. Sans trafic, l’état reste inconnu et n’est jamais affiché comme sain.`;

  if (optins != null && optins >= MC2_HEALTH_THRESHOLDS.optinsMinimum && completed.length === 0) {
    status = 'red';
    summary = 'Les opt-ins n’aboutissent plus';
    note = `${optins} parcours ont commencé, mais aucune inscription complète n’est arrivée.`;
  } else if (matured.length >= MC2_HEALTH_THRESHOLDS.maturedRegistrationsMinimum && present.length === 0) {
    status = 'red';
    summary = 'Aucune présence après les inscriptions';
    note = `${matured.length} inscriptions ont dépassé leur horaire de session sans présence détectée.`;
  } else if (matured.length >= MC2_HEALTH_THRESHOLDS.maturedRegistrationsMinimum
    && (present.length / matured.length) * 100 < MC2_HEALTH_THRESHOLDS.attendanceOrangePercent) {
    status = 'orange';
    summary = 'Présence anormalement basse';
    note = `Sous ${MC2_HEALTH_THRESHOLDS.attendanceOrangePercent}% de présence avec au moins ${MC2_HEALTH_THRESHOLDS.maturedRegistrationsMinimum} sessions arrivées à échéance.`;
  }

  return {
    ...base,
    status,
    summary,
    note,
    lastRunAt: latestIso(rows, ['last_event_at', 'updated_at', 'registered_at']),
    metrics: [
      { label: 'Opt-ins 2 h', value: optins == null ? 'Inconnu' : optins },
      { label: 'Inscrits 2 h', value: completed.length },
      { label: 'En lecture', value: activePresence == null ? 'Inconnu' : activePresence },
      { label: 'CTA / offre', value: cta.length },
      { label: 'Checkout', value: checkout.length },
      { label: 'Achats', value: purchased.length },
    ],
    items: [
      { label: 'Inscriptions arrivées à leur session', value: matured.length },
      { label: 'Présences détectées', value: present.length },
      { label: 'Inscriptions brutes', value: recent.length },
    ],
  };
}

export function summarizePages(results, now = new Date()) {
  const rows = Array.isArray(results) ? results : [];
  const failures = rows.filter((item) => item.status === 'red');
  const warnings = rows.filter((item) => item.status === 'orange');
  const status = failures.length ? 'red' : warnings.length ? 'orange' : rows.length ? 'green' : 'unknown';
  return {
    id: 'pages',
    name: 'Pages critiques',
    description: 'Disponibilité réelle des six étapes publiques MC2',
    status,
    affectsOverall: true,
    checkedAt: now.toISOString(),
    lastRunAt: now.toISOString(),
    summary: failures.length
      ? `${failures.length} page${failures.length > 1 ? 's' : ''} en erreur`
      : warnings.length
        ? `${warnings.length} page${warnings.length > 1 ? 's' : ''} ralentie${warnings.length > 1 ? 's' : ''}`
        : 'Toutes les pages répondent',
    note: `Rouge si le code HTTP ou le marqueur attendu échoue. Orange au-delà de ${MC2_HEALTH_THRESHOLDS.pageTimeoutMs - 1500} ms.`,
    metrics: [
      { label: 'OK', value: rows.filter((item) => item.status === 'green').length },
      { label: 'Lentes', value: warnings.length },
      { label: 'En erreur', value: failures.length },
    ],
    items: rows,
    diagnosticUrl: 'https://app.netlify.com',
  };
}

export function overallHealth(components, now = new Date()) {
  const relevant = (Array.isArray(components) ? components : []).filter((component) => component.affectsOverall !== false);
  const status = worstStatus(relevant.map((component) => component.status));
  const counts = { green: 0, orange: 0, red: 0, unknown: 0 };
  for (const component of Array.isArray(components) ? components : []) {
    if (Object.hasOwn(counts, component.status)) counts[component.status] += 1;
  }
  const label = {
    green: 'Tout fonctionne',
    orange: 'À surveiller',
    red: 'Action requise',
    unknown: 'État incomplet',
  }[status];
  return {
    status,
    label,
    checkedAt: now.toISOString(),
    counts,
    summary: status === 'green'
      ? 'Les contrôles essentiels MC2 sont au vert.'
      : status === 'orange'
        ? 'Le funnel fonctionne, mais un signal demande une vérification.'
        : status === 'red'
          ? 'Au moins un contrôle essentiel indique un blocage probable.'
          : 'Les données disponibles ne permettent pas de confirmer la santé complète.',
  };
}

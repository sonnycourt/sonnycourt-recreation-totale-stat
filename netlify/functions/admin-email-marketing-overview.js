import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';
const CACHE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const EDITORIAL_BROADCAST_MIN_RECIPIENTS = 10_000;

// This function is intentionally read-only. Keep the allowlist limited to
// collection endpoints and never accept an upstream path from the browser.
const READ_ONLY_RESOURCES = Object.freeze({
  sentCampaigns: '/campaigns?filter%5Bstatus%5D=sent&limit=100&page=1',
  draftCampaigns: '/campaigns?filter%5Bstatus%5D=draft&limit=25&page=1',
  readyCampaigns: '/campaigns?filter%5Bstatus%5D=ready&limit=25&page=1',
  automations: '/automations?limit=100&page=1',
  segments: '/segments?limit=250&page=1',
  groups: '/groups?limit=1000&page=1',
  fields: '/fields?limit=100&page=1',
  webhooks: '/webhooks?limit=50&page=1',
});

let memoryCache = null;

function isTrustedLocalDevelopment(req) {
  if (!process.env.NETLIFY_DEV) return false;
  try {
    const hostname = new URL(req.url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function safeText(value, maxLength = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value) {
  return Math.max(0, Math.round(number(value)));
}

function metaTotal(response) {
  return integer(response?.meta?.total ?? response?.data?.length ?? 0);
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(String(value).replace(' ', 'T') + (String(value).includes('T') ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function campaignSentAt(campaign) {
  return campaign?.finished_at
    || campaign?.started_at
    || campaign?.finished_sending_at
    || campaign?.started_sending_at
    || campaign?.sent_at
    || null;
}

function campaignIntent(campaign, email) {
  const audienceFilter = Array.isArray(campaign?.filter_for_humans)
    ? campaign.filter_for_humans.flat(4).map((item) => safeText(item, 300)).join(' ')
    : '';
  const label = `${campaign?.name || ''} ${email?.subject || ''} ${audienceFilter}`.toLocaleLowerCase('fr-FR');
  if (/^\[email division test\]/i.test(String(campaign?.name || ''))) return 'test';
  if (campaign?.used_in_automations) return 'automation';
  if (/(on est (en )?live|ça commence dans|commence maintenant|rattrapage manuel|bilan 30 jours|décalée.+nouvelle date|lien de connexion|rappel de session)/i.test(label)) {
    return 'operational';
  }
  return 'editorial';
}

function campaignStats(campaign) {
  const email = Array.isArray(campaign?.emails) ? campaign.emails[0] : null;
  return email?.stats || campaign?.stats || {};
}

function rateFrom(stats, countKeys, rateKey, sent) {
  for (const key of countKeys) {
    const count = number(stats?.[key], NaN);
    if (Number.isFinite(count) && sent > 0) return (count / sent) * 100;
  }
  const rate = stats?.[rateKey];
  if (rate && typeof rate === 'object') {
    const label = safeText(rate.string, 20).replace(',', '.');
    if (label.includes('%')) return number(label.replace('%', ''), 0);
    const raw = number(rate.float, 0);
    return raw > 0 && raw <= 1 ? raw * 100 : raw;
  }
  const raw = number(rate, 0);
  return raw > 0 && raw <= 1 ? raw * 100 : raw;
}

function normalizeCampaign(campaign) {
  const stats = campaignStats(campaign);
  const sent = integer(
    stats?.sent
    ?? stats?.sent_count
    ?? campaign?.recipients_count
    ?? campaign?.total_recipients,
  );
  const email = Array.isArray(campaign?.emails) ? campaign.emails[0] : null;
  const settings = campaign?.settings || {};
  return {
    id: safeText(campaign?.id, 40),
    name: safeText(campaign?.name || email?.subject || 'Campagne sans nom', 120),
    subject: safeText(email?.subject || campaign?.subject || '', 140),
    intent: campaignIntent(campaign, email),
    fromName: safeText(email?.from_name || campaign?.from_name || '', 140),
    fromAddress: safeText(email?.from || campaign?.from || '', 180).toLowerCase(),
    sent,
    sentAt: campaignSentAt(campaign),
    openRate: rateFrom(stats, ['unique_opens_count', 'opens_count'], 'open_rate', sent),
    clickRate: rateFrom(stats, ['unique_clicks_count', 'clicks_count'], 'click_rate', sent),
    unsubscribeRate: rateFrom(stats, ['unsubscribes_count', 'unsubscribed_count'], 'unsubscribe_rate', sent),
    hardBounceRate: rateFrom(stats, ['hard_bounces_count'], 'hard_bounce_rate', sent),
    usesGoogleAnalytics: Boolean(settings.use_google_analytics ?? campaign?.use_google_analytics),
    usesEcommerceTracking: Boolean(settings.ecommerce_tracking ?? campaign?.uses_ecommerce),
  };
}

function weightedRate(campaigns, key) {
  const eligible = campaigns.filter((item) => item.sent > 0);
  const totalSent = eligible.reduce((sum, item) => sum + item.sent, 0);
  if (!totalSent) return 0;
  return eligible.reduce((sum, item) => sum + item[key] * item.sent, 0) / totalSent;
}

function daysAgo(date, now) {
  if (!date) return null;
  const parsed = dateValue(date);
  if (!parsed) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}

function normalizeAutomation(automation) {
  const steps = Array.isArray(automation?.steps) ? automation.steps : [];
  const stats = automation?.stats || {};
  const sent = integer(stats?.sent ?? stats?.sent_count);
  return {
    id: safeText(automation?.id, 40),
    name: safeText(automation?.name || 'Automation sans nom', 120),
    enabled: Boolean(automation?.enabled),
    steps: steps.length,
    emailSteps: steps.filter((step) => step?.type === 'email').length,
    warnings: Array.isArray(automation?.warnings) ? automation.warnings.length : 0,
    sent,
    openRate: rateFrom(stats, ['unique_opens_count', 'opens_count'], 'open_rate', sent),
    clickRate: rateFrom(stats, ['unique_clicks_count', 'clicks_count'], 'click_rate', sent),
  };
}

function findSegment(segments, matchers) {
  return segments.find((segment) => {
    const name = segment.name.toLocaleLowerCase('fr-FR');
    return matchers.every((matcher) => name.includes(matcher));
  }) || null;
}

function priorityItem(id, owner, tone, title, detail, evidence, actionLabel) {
  return { id, owner, tone, title, detail, evidence, actionLabel, mode: 'recommendation_only' };
}

function buildOverview(raw, now = new Date()) {
  const sentCampaigns = (raw.sentCampaigns?.data || [])
    .map(normalizeCampaign)
    .sort((a, b) => (dateValue(b.sentAt)?.getTime() || 0) - (dateValue(a.sentAt)?.getTime() || 0));
  const largeCampaigns = sentCampaigns.filter((campaign) => (
    campaign.intent === 'editorial' && campaign.sent >= EDITORIAL_BROADCAST_MIN_RECIPIENTS
  ));
  const datedLargeCampaigns = largeCampaigns.filter((campaign) => dateValue(campaign.sentAt));
  const last90Days = datedLargeCampaigns.filter((campaign) => (daysAgo(campaign.sentAt, now) ?? 9999) <= 90);
  const last30Days = datedLargeCampaigns.filter((campaign) => (daysAgo(campaign.sentAt, now) ?? 9999) <= 30);
  const previous30Days = datedLargeCampaigns.filter((campaign) => {
    const age = daysAgo(campaign.sentAt, now) ?? 9999;
    return age > 30 && age <= 60;
  });
  const lastLarge = datedLargeCampaigns[0] || null;

  const automations = (raw.automations?.data || []).map(normalizeAutomation);
  const activeAutomations = automations.filter((item) => item.enabled);
  const inactiveAutomations = automations.filter((item) => !item.enabled);
  const activeWithVolume = activeAutomations.filter((item) => item.sent >= 100);
  const strongestAutomation = [...activeWithVolume].sort((a, b) => b.clickRate - a.clickRate)[0] || null;
  const weakestAutomation = [...activeWithVolume].sort((a, b) => a.clickRate - b.clickRate)[0] || null;

  const segments = (raw.segments?.data || []).map((segment) => ({
    id: safeText(segment?.id, 40),
    name: safeText(segment?.name || 'Segment sans nom', 120),
    total: integer(segment?.total),
    openRate: rateFrom(segment, [], 'open_rate', 0),
    clickRate: rateFrom(segment, [], 'click_rate', 0),
  }));
  const activeSixMonths = findSegment(segments, ['actif', '6']) || findSegment(segments, ['active', '6']);
  const inactiveSegment = findSegment(segments, ['inactif']) || findSegment(segments, ['inactive']);

  const groups = (raw.groups?.data || []).map((group) => ({
    id: safeText(group?.id, 40),
    name: safeText(group?.name || 'Groupe sans nom', 120),
    activeCount: integer(group?.active_count),
    openRate: rateFrom(group, [], 'open_rate', 0),
    clickRate: rateFrom(group, [], 'click_rate', 0),
  }));
  const topGroups = [...groups].sort((a, b) => b.activeCount - a.activeCount).slice(0, 5);
  const newsletterGroup = groups.find((group) => /court-circuit\s*-\s*newsletter/i.test(group.name))
    || groups.find((group) => /newsletter/i.test(group.name));
  const recommendedValueAudience = activeSixMonths?.id
    ? {
        type: 'segment', id: activeSixMonths.id, name: activeSixMonths.name, count: activeSixMonths.total,
        reason: 'Segment dynamique des abonnés actifs sur les six derniers mois, recommandé pour un premier email de valeur.',
      }
    : newsletterGroup?.id
      ? {
          type: 'group', id: newsletterGroup.id, name: newsletterGroup.name, count: newsletterGroup.activeCount,
          reason: 'Groupe newsletter existant retenu faute de segment actif six mois détecté.',
        }
      : topGroups[0]?.id
        ? {
            type: 'group', id: topGroups[0].id, name: topGroups[0].name, count: topGroups[0].activeCount,
            reason: 'Plus grand groupe actif disponible ; recommandation à confirmer avant tout broadcast.',
          }
        : null;
  // Kept inside the authenticated cockpit. This value is never included in the AI context.
  const latestSenderCampaign = sentCampaigns.find((campaign) => campaign.fromName && /@/.test(campaign.fromAddress));
  const senderRecommendation = latestSenderCampaign
    ? {
        fromName: latestSenderCampaign.fromName,
        fromAddress: latestSenderCampaign.fromAddress,
        sourceCampaign: latestSenderCampaign.name,
      }
    : null;

  const fieldsCount = metaTotal(raw.fields);
  const webhooks = raw.webhooks?.data || [];
  const activeWebhooks = webhooks.filter((hook) => hook?.enabled !== false && hook?.status !== 'disabled').length;
  const totalCampaigns = metaTotal(raw.sentCampaigns);
  const draftCount = metaTotal(raw.draftCampaigns);
  const readyCount = metaTotal(raw.readyCampaigns);
  const lastBroadcastDays = lastLarge ? daysAgo(lastLarge.sentAt, now) : null;
  const cadenceNeedsAttention = lastBroadcastDays === null || lastBroadcastDays > 5 || last30Days.length < 4;
  const trackedCampaigns = sentCampaigns.filter((campaign) => campaign.usesGoogleAnalytics || campaign.usesEcommerceTracking).length;

  const priorities = [];
  if (cadenceNeedsAttention) {
    priorities.push(priorityItem(
      'cadence', 'Alma', 'amber', 'Reprendre un rythme éditorial stable',
      'Préparer le prochain broadcast de valeur, sans l’envoyer. Tu gardes la validation finale.',
      lastBroadcastDays === null ? 'Aucun grand broadcast récent détecté' : `Dernier grand broadcast il y a ${lastBroadcastDays} j`,
      'Ouvrir le brief',
    ));
  }
  if (inactiveSegment?.total) {
    priorities.push(priorityItem(
      'reactivation', 'Sol', 'violet', 'Concevoir un pilote de réactivation',
      'Isoler un petit échantillon, proposer deux angles et définir les critères de sortie. Aucun contact ne sera déplacé.',
      `${inactiveSegment.total.toLocaleString('fr-FR')} contacts dans le segment inactif`,
      'Voir la recommandation',
    ));
  }
  if (sentCampaigns.length && trackedCampaigns === 0) {
    priorities.push(priorityItem(
      'tracking', 'Enzo', 'cyan', 'Normaliser le tracking de rentabilité',
      'Créer une convention UTM et un plan de rapprochement avec les ventes avant toute instrumentation.',
      `0 campagne trackée sur les ${sentCampaigns.length} plus récentes`,
      'Voir le plan',
    ));
  }
  if (weakestAutomation && weakestAutomation.clickRate < 1.5) {
    priorities.push(priorityItem(
      'automation-audit', 'Tao', 'rose', 'Auditer une automation sous-performante',
      'Diagnostiquer le message, le délai et la promesse. Le workspace ne modifiera jamais l’automation.',
      `${weakestAutomation.name} · ${weakestAutomation.clickRate.toFixed(2)} % de clics`,
      'Lire le diagnostic',
    ));
  }

  const warningCount = automations.reduce((sum, item) => sum + item.warnings, 0);
  const unsubscribeRate = weightedRate(last90Days, 'unsubscribeRate');
  const agents = [
    {
      id: 'nova', initials: 'NO', name: 'Nova', role: 'Directrice de division', division: 'Direction',
      color: 'emerald', spriteGroup: 'direction', spriteIndex: 0,
      state: priorities.length ? 'review' : 'clear',
      stateLabel: priorities.length ? `${priorities.length} arbitrage${priorities.length > 1 ? 's' : ''} à préparer` : 'Briefing à jour',
      task: priorities.length ? 'Ordonne les recommandations et prépare tes décisions' : 'Surveille les signaux prioritaires',
      progress: priorities.length ? 82 : 100,
    },
    {
      id: 'eli', initials: 'EL', name: 'Eli', role: 'Chef de produit & parcours', division: 'Direction',
      color: 'gold', spriteGroup: 'product', spriteIndex: 0,
      state: 'working', stateLabel: 'Routage produit à cadrer',
      task: 'Priorise coaching, ES2.0 ou aucun CTA avant le brief créatif', progress: 54,
    },
    {
      id: 'milo', initials: 'MI', name: 'Milo', role: 'Archiviste & Knowledge Manager', division: 'Direction',
      color: 'lime', spriteGroup: 'direction', spriteIndex: 1,
      state: 'working', stateLabel: 'Mémoire en consolidation',
      task: `Archive le scan interne et les futurs benchmarks externes validés`, progress: 76,
    },
    {
      id: 'alma', initials: 'AL', name: 'Alma', role: 'Stratège éditoriale', division: 'Éditorial',
      color: 'violet', spriteGroup: 'editorial', spriteIndex: 0,
      state: cadenceNeedsAttention ? 'working' : 'clear',
      stateLabel: cadenceNeedsAttention ? 'Angle à cadrer' : 'Cadence sous contrôle',
      task: cadenceNeedsAttention ? 'Structure le prochain broadcast de valeur' : 'Prépare le calendrier éditorial',
      progress: cadenceNeedsAttention ? 58 : 100,
    },
    {
      id: 'leo', initials: 'LÉ', name: 'Léo', role: 'Copywriter email', division: 'Éditorial',
      color: 'amber', spriteGroup: 'editorial', spriteIndex: 1,
      state: cadenceNeedsAttention ? 'working' : 'clear',
      stateLabel: cadenceNeedsAttention ? 'Première trame en cours' : 'Prêt à rédiger',
      task: cadenceNeedsAttention ? 'Transforme le prochain angle en message' : 'Observe les prochains sujets',
      progress: cadenceNeedsAttention ? 46 : 100,
    },
    {
      id: 'iris', initials: 'IR', name: 'Iris', role: 'Recherche client & veille internationale', division: 'Éditorial',
      color: 'cyan', spriteGroup: 'editorial', spriteIndex: 2,
      state: 'working', stateLabel: 'Signaux clients en lecture',
      task: `Cartographie les thèmes internes et prépare le radar newsletters US`, progress: 67,
    },
    {
      id: 'nino', initials: 'NI', name: 'Nino', role: 'Opérations broadcast', division: 'Éditorial',
      color: 'amber', spriteGroup: 'editorial', spriteIndex: 3,
      state: readyCount + draftCount ? 'review' : 'clear',
      stateLabel: readyCount + draftCount ? `${readyCount + draftCount} élément${readyCount + draftCount > 1 ? 's' : ''} en file` : 'File nette',
      task: 'Contrôle la checklist de production sans déclencher d’envoi', progress: readyCount + draftCount ? 72 : 100,
    },
    {
      id: 'sacha', initials: 'SA', name: 'Sacha', role: 'Analyste performance', division: 'Intelligence & revenus',
      color: 'cyan', spriteGroup: 'intelligence', spriteIndex: 0,
      state: 'clear', stateLabel: 'Scan terminé',
      task: `${sentCampaigns.length} campagnes et ${automations.length} automations inspectées`, progress: 100,
    },
    {
      id: 'ada', initials: 'AD', name: 'Ada', role: 'Responsable expérimentation', division: 'Intelligence & revenus',
      color: 'violet', spriteGroup: 'intelligence', spriteIndex: 1,
      state: cadenceNeedsAttention ? 'working' : 'clear',
      stateLabel: cadenceNeedsAttention ? 'Hypothèses en préparation' : 'Cadre de test prêt',
      task: 'Transforme les apprentissages en tests mesurables', progress: cadenceNeedsAttention ? 51 : 100,
    },
    {
      id: 'enzo', initials: 'EN', name: 'Enzo', role: 'Rentabilité & attribution', division: 'Intelligence & revenus',
      color: 'gold', spriteGroup: 'intelligence', spriteIndex: 2,
      state: trackedCampaigns ? 'working' : 'review',
      stateLabel: trackedCampaigns ? 'Attribution en lecture' : 'Tracking à normaliser',
      task: trackedCampaigns ? `${trackedCampaigns} campagne${trackedCampaigns > 1 ? 's' : ''} instrumentée${trackedCampaigns > 1 ? 's' : ''}` : 'Prépare une convention UTM et revenus',
      progress: trackedCampaigns ? 69 : 34,
    },
    {
      id: 'tao', initials: 'TA', name: 'Tao', role: 'Auditeur automations', division: 'Intelligence & revenus',
      color: 'cyan', spriteGroup: 'intelligence', spriteIndex: 3,
      state: weakestAutomation?.clickRate < 1.5 ? 'review' : 'clear',
      stateLabel: weakestAutomation?.clickRate < 1.5 ? 'Diagnostic requis' : 'Radar stable',
      task: weakestAutomation ? `Audite « ${weakestAutomation.name} » sans la modifier` : 'Observe la structure des workflows',
      progress: weakestAutomation?.clickRate < 1.5 ? 61 : 100,
    },
    {
      id: 'maya', initials: 'MA', name: 'Maya', role: 'Délivrabilité & santé', division: 'Cycle de vie',
      color: 'emerald', spriteGroup: 'lifecycle', spriteIndex: 0,
      state: unsubscribeRate > .3 ? 'review' : 'clear',
      stateLabel: unsubscribeRate > .3 ? 'Vigilance nécessaire' : 'Signaux stables',
      task: `Surveille désinscriptions et pression d’envoi · ${unsubscribeRate.toFixed(2)} %`,
      progress: unsubscribeRate > .3 ? 63 : 100,
    },
    {
      id: 'ines', initials: 'IN', name: 'Inès', role: 'Segmentation & hygiène', division: 'Cycle de vie',
      color: 'violet', spriteGroup: 'lifecycle', spriteIndex: 1,
      state: inactiveSegment?.total ? 'working' : 'clear',
      stateLabel: inactiveSegment?.total ? 'Cohorte à qualifier' : 'Base cartographiée',
      task: inactiveSegment?.total ? `${inactiveSegment.total.toLocaleString('fr-FR')} inactifs à segmenter avec validation` : 'Cartographie les règles d’audience',
      progress: inactiveSegment?.total ? 44 : 100,
    },
    {
      id: 'sol', initials: 'SO', name: 'Sol', role: 'Spécialiste réactivation', division: 'Cycle de vie',
      color: 'amber', spriteGroup: 'lifecycle', spriteIndex: 2,
      state: inactiveSegment?.total ? 'working' : 'clear',
      stateLabel: inactiveSegment?.total ? 'Pilote à concevoir' : 'Aucune cohorte urgente',
      task: inactiveSegment?.total ? 'Prépare un test de reconquête réversible' : 'Surveille les signaux de décrochage',
      progress: inactiveSegment?.total ? 38 : 100,
    },
    {
      id: 'june', initials: 'JU', name: 'June', role: 'Qualité & conformité', division: 'Gouvernance',
      color: 'lime', spriteGroup: 'lifecycle', spriteIndex: 3,
      state: warningCount ? 'review' : 'clear',
      stateLabel: warningCount ? `${warningCount} alerte${warningCount > 1 ? 's' : ''} à vérifier` : 'Contrôles au vert',
      task: 'Vérifie lisibilité, consentement et garde-fous avant validation', progress: warningCount ? 74 : 100,
    },
  ];

  const bestOpenCampaign = [...last90Days].sort((a, b) => b.openRate - a.openRate)[0] || null;
  const bestClickCampaign = [...last90Days].sort((a, b) => b.clickRate - a.clickRate)[0] || null;
  const formatMissionRate = (value) => `${number(value).toFixed(2)} %`;
  const missionStep = (agentId, agent, initials, label, status, detail) => ({
    agentId, agent, initials, label, status, detail,
  });

  const missions = [
    {
      id: 'broadcast-value',
      type: 'broadcast',
      title: 'Préparer le prochain broadcast de valeur',
      summary: `Transformer les signaux récents en un email utile, lisible et orienté vers un seul clic. Aucun envoi ne sera déclenché.`,
      owner: 'Alma', ownerId: 'alma', tone: 'amber', priority: 'P1',
      status: 'working', statusLabel: 'En production', progress: 31,
      dueLabel: 'Prochain dossier à soumettre',
      deliverable: 'Email complet + 2 objets + 1 CTA + hypothèse de test',
      decisionPrompt: 'Valider l’angle et autoriser la préparation de la version finale — pas l’envoi.',
      evidence: [
        `${last30Days.length} grand${last30Days.length > 1 ? 's' : ''} broadcast${last30Days.length > 1 ? 's' : ''} sur les 30 derniers jours`,
        `Ouvertures pondérées : ${formatMissionRate(weightedRate(last90Days, 'openRate'))}`,
        `Clics pondérés : ${formatMissionRate(weightedRate(last90Days, 'clickRate'))}`,
        bestClickCampaign ? `Meilleur signal de clic récent : « ${bestClickCampaign.subject || bestClickCampaign.name} » · ${formatMissionRate(bestClickCampaign.clickRate)}` : 'Pas encore assez de volume comparable',
      ],
      deliverables: ['Angle éditorial', 'Deux objets', 'Corps de l’email', 'CTA unique', 'Hypothèse A/B'],
      emailDraft: {
        campaignName: `Broadcast valeur · ${now.toISOString().slice(0, 10)}`,
        subject: bestClickCampaign
          ? `Ce que « ${bestClickCampaign.subject || bestClickCampaign.name} » nous apprend`
          : 'La question simple que tu peux te poser cette semaine',
        subjectVariant: 'Tu n’as probablement pas besoin d’en faire plus',
        preheader: 'Une idée concrète à tester avant de remplir davantage ton agenda.',
        fromName: senderRecommendation?.fromName || 'Sonny Court',
        fromAddress: senderRecommendation?.fromAddress || '',
        audienceType: recommendedValueAudience?.type || '',
        audienceId: recommendedValueAudience?.id || '',
        audienceName: recommendedValueAudience?.name || 'Audience à recommander',
        audienceCount: recommendedValueAudience?.count || 0,
        body: `Salut {$name},\n\nOn cherche souvent la prochaine grande stratégie, alors que le vrai levier se trouve parfois dans une décision beaucoup plus simple.\n\nCette semaine, pose-toi cette question : qu’est-ce que je continue à faire par habitude, sans vérifier si cela m’aide encore vraiment ?\n\nChoisis une seule réponse. Puis teste l’inverse pendant quelques jours. Pas pour tout révolutionner — simplement pour récupérer un peu de clarté et observer ce qui change.\n\nJe te partagerai bientôt la suite de cette réflexion.\n\nSonny`,
        ctaLabel: '',
        ctaUrl: '',
        hypothesis: 'Un objet qui réduit la pression devrait générer davantage d’ouvertures qu’un objet centré sur l’effort.',
      },
      steps: [
        missionStep('iris', 'Iris', 'IR', 'Voix du client', 'done', 'Les thèmes et signaux récents sont cartographiés.'),
        missionStep('eli', 'Eli', 'EL', 'Routage produit', 'working', 'Propose une destination ou aucun CTA, sans choisir lui-même les destinataires.'),
        missionStep('alma', 'Alma', 'AL', 'Angle éditorial', 'working', 'Choisit la promesse et la valeur à délivrer.'),
        missionStep('leo', 'Léo', 'LÉ', 'Rédaction', 'queued', 'Attend le brief éditorial validé par Alma.'),
        missionStep('ada', 'Ada', 'AD', 'Hypothèse de test', 'queued', 'Préparera deux variantes mesurables.'),
        missionStep('nino', 'Nino', 'NI', 'Préflight', 'queued', 'Vérifiera liens, tracking et paramètres sans envoyer.'),
        missionStep('june', 'June', 'JU', 'Contrôle qualité', 'queued', 'Vérifiera clarté, consentement et pression.'),
        missionStep('nova', 'Nova', 'NO', 'Validation Sonny', 'queued', 'Soumettra le dossier final à ta décision.'),
      ],
    },
    {
      id: 'reactivation-pilot',
      type: 'lifecycle',
      title: 'Concevoir un pilote de réactivation',
      summary: 'Préparer une expérience limitée et réversible pour comprendre qui peut encore être reconquis.',
      owner: 'Sol', ownerId: 'sol', tone: 'violet', priority: 'P1',
      status: inactiveSegment?.total ? 'working' : 'queued',
      statusLabel: inactiveSegment?.total ? 'En cadrage' : 'En attente de cohorte',
      progress: inactiveSegment?.total ? 44 : 8,
      dueLabel: 'Après validation du périmètre',
      deliverable: 'Cohorte test + 2 angles + critères de sortie',
      decisionPrompt: 'Valider uniquement le périmètre du pilote. Aucun contact ne sera déplacé.',
      evidence: [
        inactiveSegment?.total ? `${inactiveSegment.total.toLocaleString('fr-FR')} contacts repérés dans le segment inactif` : 'Segment inactif non détecté',
        `${segments.length} segments dynamiques observés`,
        'Aucune fiche contact consultée par le workspace',
      ],
      deliverables: ['Définition de cohorte', 'Deux angles', 'Critères d’arrêt', 'Plan de mesure'],
      steps: [
        missionStep('ines', 'Inès', 'IN', 'Qualification', 'done', 'La cohorte inactive est identifiée au niveau agrégé.'),
        missionStep('sol', 'Sol', 'SO', 'Scénario de reconquête', 'working', 'Cadre les messages et la séquence du pilote.'),
        missionStep('ada', 'Ada', 'AD', 'Plan de test', 'queued', 'Définira échantillon, contrôle et seuils.'),
        missionStep('june', 'June', 'JU', 'Conformité', 'queued', 'Vérifiera pression, consentement et sortie.'),
        missionStep('nova', 'Nova', 'NO', 'Validation Sonny', 'queued', 'Présentera le périmètre avant toute action.'),
      ],
    },
    {
      id: 'tracking-standard',
      type: 'revenue',
      title: 'Normaliser le tracking de rentabilité',
      summary: 'Rendre chaque futur clic attribuable avec une convention simple, stable et compréhensible.',
      owner: 'Enzo', ownerId: 'enzo', tone: 'cyan', priority: 'P1',
      status: trackedCampaigns ? 'working' : 'review',
      statusLabel: trackedCampaigns ? 'Mesure en cours' : 'À valider',
      progress: trackedCampaigns ? 64 : 86,
      dueLabel: 'Décision disponible maintenant',
      deliverable: 'Convention UTM commune à tous les broadcasts',
      decisionPrompt: 'Valider la convention de nommage pour les futurs emails uniquement.',
      evidence: [
        `${trackedCampaigns} campagne${trackedCampaigns > 1 ? 's' : ''} trackée${trackedCampaigns > 1 ? 's' : ''} sur les ${sentCampaigns.length} inspectées`,
        'Proposition : utm_source=mailerlite · utm_medium=email',
        'utm_campaign=<date>-<theme> · utm_content=<variante>-<cta>',
      ],
      deliverables: ['Convention UTM', 'Règle de nommage', 'Checklist Nino', 'Champ de rapprochement revenu'],
      steps: [
        missionStep('enzo', 'Enzo', 'EN', 'Convention', 'done', 'La convention minimale est proposée.'),
        missionStep('nino', 'Nino', 'NI', 'Checklist', 'done', 'Le contrôle de tracking est intégré au préflight.'),
        missionStep('june', 'June', 'JU', 'Contrôle', 'done', 'Aucune donnée personnelle n’est ajoutée aux URLs.'),
        missionStep('nova', 'Nova', 'NO', 'Validation Sonny', 'review', 'Le dossier attend ta décision locale.'),
      ],
    },
    {
      id: 'automation-audit',
      type: 'automation',
      title: 'Auditer une automation sous-performante',
      summary: 'Produire un diagnostic sur le message, le délai et la promesse sans modifier le workflow.',
      owner: 'Tao', ownerId: 'tao', tone: 'rose', priority: 'P2',
      status: weakestAutomation ? 'working' : 'queued',
      statusLabel: weakestAutomation ? 'Diagnostic en cours' : 'Volume insuffisant',
      progress: weakestAutomation ? 62 : 10,
      dueLabel: 'Après lecture du parcours',
      deliverable: 'Diagnostic argumenté + recommandations non exécutées',
      decisionPrompt: 'Choisir si tu veux reprendre toi-même cette automation après le diagnostic.',
      evidence: [
        weakestAutomation ? `Signal observé : « ${weakestAutomation.name} »` : 'Aucune automation comparable détectée',
        weakestAutomation ? `Taux de clic observé : ${formatMissionRate(weakestAutomation.clickRate)}` : 'Pas de volume exploitable',
        `${warningCount} alerte${warningCount > 1 ? 's' : ''} technique${warningCount > 1 ? 's' : ''} remontée${warningCount > 1 ? 's' : ''}`,
      ],
      deliverables: ['Diagnostic', 'Hypothèses', 'Priorité des corrections'],
      steps: [
        missionStep('sacha', 'Sacha', 'SA', 'Détection', 'done', 'Le signal faible est isolé.'),
        missionStep('tao', 'Tao', 'TA', 'Audit', weakestAutomation ? 'working' : 'queued', 'Analyse la structure sans la modifier.'),
        missionStep('june', 'June', 'JU', 'Risques', 'queued', 'Qualifiera les risques avant recommandation.'),
        missionStep('nova', 'Nova', 'NO', 'Arbitrage', 'queued', 'Te soumettra les options.'),
      ],
    },
    {
      id: 'account-health',
      type: 'health',
      title: 'Contrôler la santé du compte',
      summary: 'Surveiller pression, désinscriptions et alertes techniques avant toute nouvelle campagne.',
      owner: 'Maya', ownerId: 'maya', tone: 'emerald', priority: 'P2',
      status: unsubscribeRate > .3 || warningCount ? 'review' : 'done',
      statusLabel: unsubscribeRate > .3 || warningCount ? 'Vigilance à valider' : 'Contrôle terminé',
      progress: unsubscribeRate > .3 || warningCount ? 88 : 100,
      dueLabel: 'Contrôle quotidien',
      deliverable: 'Feu vert ou alerte documentée',
      decisionPrompt: 'Prendre connaissance des alertes avant la prochaine validation éditoriale.',
      evidence: [
        `Désinscriptions pondérées : ${formatMissionRate(unsubscribeRate)}`,
        `${warningCount} alerte${warningCount > 1 ? 's' : ''} technique${warningCount > 1 ? 's' : ''}`,
        `${activeWebhooks} webhook${activeWebhooks > 1 ? 's' : ''} actif${activeWebhooks > 1 ? 's' : ''}`,
      ],
      deliverables: ['État du compte', 'Alertes', 'Seuils de vigilance'],
      steps: [
        missionStep('maya', 'Maya', 'MA', 'Santé', 'done', 'Les signaux agrégés sont contrôlés.'),
        missionStep('june', 'June', 'JU', 'Garde-fous', warningCount ? 'review' : 'done', 'Les alertes techniques sont qualifiées.'),
      ],
    },
    {
      id: 'international-benchmark',
      type: 'intelligence',
      title: 'Installer le radar newsletters US',
      summary: 'Construire une veille volontairement limitée sur les meilleurs opérateurs américains afin d’alimenter nos hypothèses éditoriales sans copier leurs textes ni remplacer nos propres données.',
      owner: 'Iris', ownerId: 'iris', tone: 'cyan', priority: 'P3',
      status: 'review', statusLabel: 'Cadre à valider', progress: 20,
      dueLabel: 'Avant toute inscription',
      deliverable: 'Shortlist approuvée + boîte dédiée + synthèse hebdomadaire',
      decisionPrompt: 'Valider le principe, le périmètre et la future boîte dédiée. Cette validation ne déclenche aucune inscription.',
      evidence: [
        'Aucune newsletter externe n’est actuellement connectée au workspace.',
        'Les performances MailerLite internes restent la source principale de vérité.',
        'Les exemples externes seront traités comme inspiration et hypothèses, jamais comme preuves.',
      ],
      deliverables: [
        'Shortlist de 10 à 20 newsletters maximum',
        'Adresse de veille dédiée',
        'Grille d’analyse : objet, angle, cadence, storytelling, CTA et promotion',
        'Synthèse hebdomadaire limitée à cinq enseignements',
        'Journal des hypothèses testables et de leur origine',
      ],
      steps: [
        missionStep('iris', 'Iris', 'IR', 'Sourcing', 'working', 'Prépare une shortlist équilibrée : développement personnel, subconscient et opérateurs marketing de référence.'),
        missionStep('june', 'June', 'JU', 'Garde-fous', 'review', 'Vérifie consentement, désabonnement, droits d’auteur et séparation avec les preuves internes.'),
        missionStep('nova', 'Nova', 'NO', 'Validation Sonny', 'review', 'Soumet la shortlist et le protocole avant toute inscription externe.'),
        missionStep('milo', 'Milo', 'MI', 'Mémoire', 'queued', 'Archivera les patterns observés, leur source et leur date sans recopier les emails.'),
        missionStep('ada', 'Ada', 'AD', 'Expérimentation', 'queued', 'Transformera au maximum trois apprentissages en hypothèses mesurables.'),
      ],
    },
    {
      id: 'knowledge-log',
      type: 'knowledge',
      title: 'Consolider la mémoire opérationnelle',
      summary: 'Transformer le briefing du jour en historique exploitable pour les prochaines décisions.',
      owner: 'Milo', ownerId: 'milo', tone: 'lime', priority: 'P3',
      status: 'done', statusLabel: 'Archivé', progress: 100,
      dueLabel: 'À chaque synchronisation',
      deliverable: 'Journal des signaux, décisions et résultats',
      decisionPrompt: 'Aucune décision requise pour ce cycle.',
      evidence: [
        `${sentCampaigns.length} campagnes inspectées`,
        `${automations.length} automations inspectées`,
        `${segments.length} segments cartographiés`,
      ],
      deliverables: ['Snapshot quotidien', 'Décisions', 'Hypothèses à vérifier'],
      steps: [
        missionStep('milo', 'Milo', 'MI', 'Archivage', 'done', 'Le briefing est prêt à être conservé.'),
      ],
    },
  ];

  return {
    generatedAt: now.toISOString(),
    mode: 'read_only',
    guardrails: {
      upstreamMethods: ['GET'],
      piiExposed: false,
      automationsMutable: false,
      approvalRequired: true,
      localApprovalsOnly: true,
    },
    metrics: {
      totalCampaigns,
      draftCount,
      readyCount,
      campaignsLast30Days: last30Days.length,
      campaignsPrevious30Days: previous30Days.length,
      lastBroadcastDays,
      openRate90Days: weightedRate(last90Days, 'openRate'),
      clickRate90Days: weightedRate(last90Days, 'clickRate'),
      unsubscribeRate90Days: weightedRate(last90Days, 'unsubscribeRate'),
      activeAutomations: activeAutomations.length,
      inactiveAutomations: inactiveAutomations.length,
      automationSteps: automations.reduce((sum, item) => sum + item.steps, 0),
      automationEmailSteps: automations.reduce((sum, item) => sum + item.emailSteps, 0),
      segmentCount: segments.length,
      groupCount: groups.length,
      fieldsCount,
      activeWebhooks,
      activeSixMonths: activeSixMonths?.total ?? null,
      inactiveContacts: inactiveSegment?.total ?? null,
      trackedRecentCampaigns: trackedCampaigns,
      inspectedRecentCampaigns: sentCampaigns.length,
      campaignsWithoutVerifiedSendDate: sentCampaigns.filter((campaign) => !dateValue(campaign.sentAt)).length,
      editorialBroadcastMinRecipients: EDITORIAL_BROADCAST_MIN_RECIPIENTS,
      operationalCampaignsExcluded: sentCampaigns.filter((campaign) => campaign.intent !== 'editorial').length,
    },
    agents,
    missions,
    benchmarkScout: {
      name: 'Radar newsletters US',
      owner: 'Iris',
      archivist: 'Milo',
      status: 'setup_required',
      automatedSubscriptions: false,
      approvedSourceCount: 0,
      maximumSourceCount: 20,
      internalPerformanceRemainsPrimary: true,
    },
    priorities: priorities.slice(0, 5),
    recommendedValueAudience,
    senderRecommendation,
    recentCampaigns: sentCampaigns.filter((campaign) => campaign.intent === 'editorial' && dateValue(campaign.sentAt)).slice(0, 6),
    automationSignals: {
      strongest: strongestAutomation,
      weakest: weakestAutomation,
      warningCount,
    },
    audiences: {
      groups: [...groups].sort((a, b) => b.activeCount - a.activeCount).slice(0, 100),
      segments: [...segments].sort((a, b) => b.total - a.total).slice(0, 100),
    },
    topGroups,
    sources: Object.keys(READ_ONLY_RESOURCES),
  };
}

async function fetchReadOnlyResource(apiKey, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${MAILERLITE_API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'SonnyCourt-Email-Intelligence/1.0',
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`mailerlite_${response.status}_${safeText(payload?.message || 'upstream_error', 80)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadOverview(apiKey) {
  const entries = Object.entries(READ_ONLY_RESOURCES);
  const settled = await Promise.allSettled(
    entries.map(([, path]) => fetchReadOnlyResource(apiKey, path)),
  );
  const raw = {};
  const unavailable = [];
  settled.forEach((result, index) => {
    const [key] = entries[index];
    if (result.status === 'fulfilled') raw[key] = result.value;
    else {
      raw[key] = { data: [], meta: { total: 0 } };
      unavailable.push(key);
    }
  });

  if (unavailable.length === entries.length) {
    throw new Error('mailerlite_unavailable');
  }

  return { ...buildOverview(raw), unavailable };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return json(405, { error: 'read_only_endpoint', allowed: ['GET'] });
  if (!getSessionFromRequest(req) && !isTrustedLocalDevelopment(req)) {
    return json(401, { error: 'authentication_required' });
  }

  const apiKey = String(process.env.MAILERLITE_API_KEY || '').trim();
  if (!apiKey) return json(503, { error: 'mailerlite_not_configured' });

  const now = Date.now();
  if (memoryCache && now - memoryCache.createdAt < CACHE_TTL_MS) {
    return json(200, { ...memoryCache.payload, cache: 'memory' });
  }

  try {
    const payload = await loadOverview(apiKey);
    memoryCache = { createdAt: now, payload };
    return json(200, { ...payload, cache: 'fresh' });
  } catch (error) {
    console.error('[admin-email-marketing-overview] read failed', safeText(error?.message, 120));
    return json(502, { error: 'mailerlite_read_failed' });
  }
};

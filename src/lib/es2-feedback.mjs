// Shared contract for the approved personal check-in. No network or identity logic.
export const FEEDBACK_VERSION = 2;
export const FEEDBACK_GROUPS = {
  feelings: { multi: true, max: 3, values: ['Plutôt calme', 'Confiant·e', 'Motivé·e', 'Sous tension', 'Débordé·e', 'Triste / découragé·e', 'Bloqué·e', 'Difficile à définir'] },
  priority: { values: ['Concrétiser un souhait ou un projet (travail, logement…)', 'Améliorer ma situation financière', 'Vivre une vie amoureuse épanouissante', 'Améliorer mes relations avec mes proches', 'Avoir davantage confiance en moi', 'Me sentir plus calme au quotidien', 'Trouver ce que je veux vraiment pour ma vie', 'Autre souhait ou changement'] },
  evolution: { values: ['Je remarque des changements positifs', 'Il y a du mieux et des difficultés', 'Je ne remarque pas encore de changement', 'C’est plus difficile en ce moment', 'Je n’arrive pas encore à me situer'] },
  gains: { multi: true, max: 6, optional: true, values: ['Je repère mieux ce qui se passe en moi', 'Je retrouve mon calme plus facilement', 'Je me parle avec moins de dureté', 'Je pose davantage mes limites', 'Je passe plus facilement à l’action', 'Autre chose / difficile à nommer'] },
  practice: { values: ['Pas encore', 'Occasionnellement', 'Plusieurs fois par semaine', 'Tous les jours ou presque'] },
  barrier: { multi: true, max: 2, values: ['Je ne sais pas quoi pratiquer pour ma situation', 'Je comprends, mais j’ai du mal à appliquer', 'J’ai du mal à trouver une place dans mon quotidien', 'Certaines émotions rendent la pratique difficile', 'Je doute de bien faire', 'Je ne vois pas encore les effets que j’attendais', 'Autre frein', 'Pas de frein particulier'] },
  help: { values: ['Choisir une pratique adaptée à ma situation', 'Comprendre ce que je vis', 'Débloquer une difficulté dans un exercice', 'Trouver une façon de pratiquer plus régulièrement', 'Clarifier ma prochaine étape', 'Autre besoin'] },
};
export const FEEDBACK_TEXT_FIELDS = ['priorityDetail', 'scene', 'reaction', 'wish', 'progressExample', 'desiredChange', 'harder', 'tried', 'question', 'extra'];
export const STEP_REQUIRED_FIELDS = [['feelings', 'priority'], ['scene', 'reaction', 'wish'], ['evolution'], ['practice', 'barrier'], ['help', 'question']];

export function evolutionBranch(value) {
  const index = FEEDBACK_GROUPS.evolution.values.indexOf(value);
  return index === 0 || index === 1 ? 'progress' : index === 3 ? 'harder' : 'stable';
}

export function normalizeFeedbackAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Réponses manquantes.');
  const answers = {};
  for (const [key, group] of Object.entries(FEEDBACK_GROUPS)) {
    if (group.multi) {
      const selected = raw[key] ?? [];
      if (!Array.isArray(selected) || selected.some(value => !group.values.includes(value))) throw new Error('Choix invalide : ' + key);
      answers[key] = [...new Set(selected)];
      if (answers[key].length > group.max || (!group.optional && !answers[key].length)) throw new Error('Merci de vérifier tes choix : ' + key);
    } else {
      if (!group.values.includes(raw[key])) throw new Error('Merci de compléter ton choix : ' + key);
      answers[key] = raw[key];
    }
  }
  if (answers.barrier.includes('Pas de frein particulier') && answers.barrier.length > 1) throw new Error('Vérifie tes choix concernant les freins.');
  for (const key of FEEDBACK_TEXT_FIELDS) {
    if (raw[key] != null && typeof raw[key] !== 'string') throw new Error('Texte invalide : ' + key);
    answers[key] = (raw[key] || '').trim();
  }
  for (const key of ['scene', 'reaction', 'wish', 'question']) {
    if (!answers[key]) throw new Error('Merci de compléter les questions de ton point personnel.');
  }
  // Ignore hidden answers from a previous choice, without interpreting the student's evolution.
  const branch = evolutionBranch(answers.evolution);
  if (branch !== 'progress') { answers.gains = []; answers.progressExample = ''; }
  if (branch !== 'stable') answers.desiredChange = '';
  if (branch !== 'harder') answers.harder = '';
  return answers;
}

export function feedbackSections(a) {
  const sections = [
    ['Ressenti actuel', a.feelings.join(' · ')],
    ['Priorité', a.priority],
    ['Souhait concret', a.priorityDetail],
    ['Situation actuelle', a.scene],
    ['Vécu intérieur', a.reaction],
    ['Ce que ce changement représenterait pour moi', a.wish],
    ['Évolution perçue', a.evolution],
  ];
  const branch = evolutionBranch(a.evolution);
  if (branch === 'progress') sections.push(['Changements observés', a.gains.join(' · ')], ['Exemple concret', a.progressExample]);
  if (branch === 'stable') sections.push(['Premier changement souhaité', a.desiredChange]);
  if (branch === 'harder') sections.push(['Difficulté actuelle', a.harder]);
  sections.push(['Pratique ces derniers jours/semaines', a.practice], ['Ce que j’ai déjà essayé', a.tried], ['Freins', a.barrier.join(' · ')], ['Aide attendue', a.help], ['Question prioritaire', a.question], ['Contexte complémentaire', a.extra]);
  return sections;
}

const format = rows => rows.map(([label, value]) => label + ' :\n' + (value || 'Non renseigné')).join('\n\n');

export function feedbackV2Record(a) {
  // Existing production columns are nullable (verified 2026-10-10). No migration,
  // invented score, invented module, or change to legacy records is required.
  return {
    module_reached: null,
    score: null,
    daily_practice: a.practice,
    what_changed: '[Point personnel v2]\n' + format([
      ['Évolution perçue', a.evolution], ['Changements observés', a.gains.join(' · ')],
      ['Premier changement souhaité', a.desiredChange], ['Difficulté actuelle', a.harder],
    ]),
    biggest_win: a.progressExample || null,
    what_blocks: format([
      ['Ressenti actuel', a.feelings.join(' · ')], ['Priorité', a.priority], ['Souhait concret', a.priorityDetail],
      ['Situation actuelle', a.scene], ['Vécu intérieur', a.reaction], ['Ce que ce changement représenterait pour moi', a.wish],
      ['Ce que j’ai déjà essayé', a.tried], ['Freins', a.barrier.join(' · ')],
    ]),
    help_needed: format([['Aide attendue', a.help], ['Question prioritaire', a.question], ['Contexte complémentaire', a.extra]]),
  };
}

export function feedbackV2Notification(a, identity) {
  return {
    subject: 'Point personnel ES 2.0 — ' + (identity.prenom || 'Sans prénom'),
    body: format([['Prénom', identity.prenom], ['Email', identity.email], ...feedbackSections(a)]),
  };
}

export function telegramFeedbackParts(payload) {
  // Plain text avoids breaking HTML entities/tags or emoji when splitting long answers.
  const points = Array.from('📩 ' + payload.subject + '\n\n' + payload.body);
  const parts = [];
  for (let offset = 0; offset < points.length; offset += 3500) parts.push(points.slice(offset, offset + 3500).join(''));
  return parts;
}

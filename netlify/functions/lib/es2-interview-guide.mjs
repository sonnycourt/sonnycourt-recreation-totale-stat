// Small, persisted collection contract. The student sees a conversation, never this checklist.
export const MAX_INTERVIEW_TURNS = 16;
export const AREAS = ['context', 'desired_change', 'pattern', 'practice', 'resources', 'capacity', 'priority'];
export const COVERAGE_STATUSES = ['missing', 'covered', 'declined', 'unclear'];
export const DECISIONS = ['continue', 'complete', 'stop_requested', 'safety_stop'];
export const blankCoverage = () => Object.fromEntries(AREAS.map(area => [area, { status: 'missing', source_ids: [] }]));
export const answerCount = row => row.messages.filter(message => message.role === 'user').length;
export const allAddressed = coverage => AREAS.every(area => coverage[area]?.status !== 'missing' && COVERAGE_STATUSES.includes(coverage[area]?.status));
export function lastGuide(row) {
 return row.messages.findLast(message => message.role === 'assistant' && message.interview)?.interview || { coverage: blankCoverage(), next_area: 'context' };
}
export function guideControl(row) {
 const previous = lastGuide(row);
 return {
  answers_received: answerCount(row), maximum_answers: MAX_INTERVIEW_TURNS,
  previous_coverage: previous.coverage, last_question_area: previous.next_area,
  questions_already_asked: row.messages.filter(message => message.interview).map(message => message.interview.next_area),
  closing_required: answerCount(row) >= MAX_INTERVIEW_TURNS,
  final_priority_now: answerCount(row) >= MAX_INTERVIEW_TURNS - 2,
 };
}
export function validReply(value, row) {
 if (!value || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 6000 || !DECISIONS.includes(value.decision)) return false;
 if (![...AREAS, 'history', 'closing'].includes(value.next_area) || !value.coverage) return false;
 const sources = new Set(row.messages.filter(message => message.role === 'user').map((_, index) => `u${index + 1}`));
 return AREAS.every(area => {
  const entry = value.coverage[area];
  return entry && COVERAGE_STATUSES.includes(entry.status) && Array.isArray(entry.source_ids) && entry.source_ids.every(id => sources.has(id)) && (entry.status === 'missing' || entry.source_ids.length > 0);
 });
}
export function closingReason(row, reply) {
 if (reply.decision === 'safety_stop') return 'safety';
 if (reply.decision === 'stop_requested') return 'student';
 if (answerCount(row) >= MAX_INTERVIEW_TURNS) return 'limit';
 if (allAddressed(reply.coverage)) return 'sufficient';
 return null;
}
// A malformed premature model conclusion must never close a sparse interview or invite an endless chat.
export function normalizeReply(value, row) {
 if (closingReason(row, value)) return value;
 if (value.decision !== 'complete' && value.next_area !== 'closing') return value;
 const area = AREAS.find(area => value.coverage[area].status === 'missing');
 const questions = {
  context: 'Pour aider Sonny à comprendre ta situation, quelle difficulté pèse le plus sur ton quotidien en ce moment ?',
  desired_change: 'Dans les prochaines semaines, quel petit changement aimerais-tu surtout ressentir dans ton quotidien ?',
  pattern: 'Peux-tu me décrire un moment récent où cette difficulté s’est manifestée, avec ce que tu as fait à ce moment-là ?',
  practice: 'Qu’as-tu pu essayer dans ES2 jusqu’ici, même très brièvement ? Si tu n’as encore rien pu faire, tu peux simplement me le dire.',
  resources: 'Qu’est-ce qui t’apporte aujourd’hui un peu de répit ou de soutien, même modestement ?',
  capacity: 'Pour que Sonny adapte ses propositions, quelle place te semblerait réaliste pour toi en ce moment : quelques minutes, un peu plus, ou aucune pour l’instant ?',
  priority: 'Pour finir, sur quel point souhaites-tu surtout que Sonny t’aide dans sa réponse ?',
 };
 return { ...value, decision: 'continue', next_area: area, reply: questions[area] };
}

// Stable stored values, independent of wording and option order.
export const MC2_SURVEY_VERSION = 1;
export const MC2_SURVEY_OPTIONS = Object.freeze({
  priority: ['finances_work', 'relationships', 'confidence_action', 'stress_balance'],
  familiarity: ['new', 'some_videos', 'follower'],
  profession: ['employee', 'self_employed', 'transition', 'student'],
  urgency: ['exploring', 'urgent'],
});
export const MC2_SURVEY_FIELDS = Object.keys(MC2_SURVEY_OPTIONS);
export const mc2SurveyOpen = (startsAt, now = Date.now()) =>
  Number.isFinite(Date.parse(startsAt)) && now < Date.parse(startsAt) + 5 * 60 * 1000;

export function validSurveyPatch(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.entries(value).every(([key, answer]) =>
      Object.hasOwn(MC2_SURVEY_OPTIONS, key) && MC2_SURVEY_OPTIONS[key].includes(answer));
}

export function surveyAnswers(row) {
  return Object.fromEntries(MC2_SURVEY_FIELDS
    .filter(key => MC2_SURVEY_OPTIONS[key].includes(row?.[key]))
    .map(key => [key, row[key]]));
}

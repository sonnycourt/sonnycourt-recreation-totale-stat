import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Exact commercial allowlist. Never use the browser's selected flag or IP as
// authority. This gate applies to new registrations, not existing access.
export const MC2_REGISTRATION_COUNTRIES = Object.freeze([
  'FR', 'CH', 'BE', 'CA', 'LU', 'RE', 'GP', 'MQ', 'GF', 'PF', 'NC',
]);
export const MC2_COUNTRY_UNAVAILABLE = 'Malheureusement, la masterclass n’est plus disponible.';

export function checkMc2RegistrationPhone(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 40 || !/^\+[\d\s().-]+$/.test(raw)) {
    return { eligible: false, reason: 'invalid_phone', message: 'Vérifie ton numéro de téléphone avec son indicatif international.' };
  }
  const phone = parsePhoneNumberFromString(raw, { extract: false });
  if (!phone?.isValid() || !phone.country || phone.ext) {
    return { eligible: false, reason: 'invalid_phone', message: 'Ce numéro ne permet pas de confirmer son pays. Vérifie le numéro et son indicatif.' };
  }
  const eligible = MC2_REGISTRATION_COUNTRIES.includes(phone.country);
  return {
    eligible,
    country: phone.country,
    telephone: phone.number,
    reason: eligible ? 'allowed' : 'country_not_available',
    message: eligible ? '' : MC2_COUNTRY_UNAVAILABLE,
  };
}

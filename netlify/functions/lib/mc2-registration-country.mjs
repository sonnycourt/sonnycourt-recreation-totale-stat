import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Free masterclass: all supported countries can register. Phone validation
// remains independent from the separate, unchanged SMS country allowlist.
export const MC2_REGISTRATION_COUNTRIES = Object.freeze(getCountries());

export function checkMc2RegistrationPhone(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 40 || !/^\+[\d\s().-]+$/.test(raw)) {
    return { eligible: false, reason: 'invalid_phone', message: 'Vérifie ton numéro de téléphone avec son indicatif international.' };
  }
  const phone = parsePhoneNumberFromString(raw, { extract: false });
  if (!phone?.isValid() || !phone.country || phone.ext) {
    return { eligible: false, reason: 'invalid_phone', message: 'Ce numéro ne permet pas de confirmer son pays. Vérifie le numéro et son indicatif.' };
  }
  return {
    eligible: true,
    country: phone.country,
    telephone: phone.number,
    reason: 'allowed',
    message: '',
  };
}

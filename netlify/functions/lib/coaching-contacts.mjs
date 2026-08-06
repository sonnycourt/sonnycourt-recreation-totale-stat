import { supabaseGet } from './supabase-rest.mjs';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function whatsappDigits(phone, country) {
  let digits = clean(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('0')) return digits;

  const callingCodes = {
    CH: '41',
    FR: '33',
  };
  const callingCode = callingCodes[clean(country).toUpperCase()];
  return callingCode ? callingCode + digits.slice(1) : digits;
}

async function loadCloserPhoneByEmail(email) {
  if (!email) return null;
  const result = await supabaseGet(
    `closer_access_codes?email=eq.${encodeURIComponent(email.toLowerCase())}` +
      '&active=eq.true&select=phone_1&limit=1',
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  return clean(row?.phone_1) || null;
}

async function loadCloserPhoneByName(firstName) {
  if (!firstName) return null;
  const result = await supabaseGet(
    `closer_access_codes?label=ilike.${encodeURIComponent(`*${firstName}*`)}` +
      '&active=eq.true&select=phone_1&limit=2',
  );
  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  if (rows.length !== 1) return null;
  return clean(rows[0]?.phone_1) || null;
}

export async function loadCoachingCoachContact(slug = 'romain', knownCoach = null) {
  let coach = knownCoach;
  if (!coach) {
    const result = await supabaseGet(
      `coaching_coaches?slug=eq.${encodeURIComponent(slug)}` +
        '&status=eq.active&select=first_name,last_name,email,phone,country&limit=1',
    );
    coach = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  }
  if (!coach) return null;

  const firstName = clean(coach.first_name) || 'Romain';
  const country = clean(coach.country) || (slug === 'romain' ? 'FR' : '');
  let phone = clean(coach.phone);
  if (!phone) phone = await loadCloserPhoneByEmail(clean(coach.email));
  if (!phone) phone = await loadCloserPhoneByName(firstName);
  if (!phone) return null;

  const digits = whatsappDigits(phone, country);
  if (digits.length < 8) return null;
  return {
    first_name: firstName,
    phone,
    whatsapp_url: `https://wa.me/${digits}`,
  };
}

function clean(value) {
  return String(value ?? '').trim();
}

export function payOrderPlainValues({ description, customer, email, created, provider, status, total } = {}) {
  const client = [clean(customer), clean(email)].filter(Boolean).join(' · ');
  return [clean(description), client, clean(created), clean(provider), clean(status), clean(total)];
}


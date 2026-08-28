#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const PRODUCTION_ENDPOINT = 'https://sonnycourt.com/.netlify/functions/mc2-support-diagnostic';

export function parseEmail(args = process.argv.slice(2)) {
  const index = args.indexOf('--email');
  const email = index >= 0 ? String(args[index + 1] || '').trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : '';
}

export async function requestMc2Diagnostic({
  email,
  apiToken,
  endpoint = PRODUCTION_ENDPOINT,
  fetchImpl = fetch,
} = {}) {
  if (!email) throw new Error('Adresse email invalide.');
  if (!apiToken || String(apiToken).trim().length < 32) {
    throw new Error('Accès Support MC2 non configuré. La variable MC2_SUPPORT_API_TOKEN est absente.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(apiToken).trim()}`,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.error || `Diagnostic indisponible (HTTP ${response.status}).`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const email = parseEmail();
    if (!email) throw new Error('Utilise : node diagnose.mjs --email personne@exemple.com');
    const payload = await requestMc2Diagnostic({
      email,
      apiToken: process.env.MC2_SUPPORT_API_TOKEN,
    });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message || 'Diagnostic impossible.'}\n`);
    process.exitCode = 1;
  }
}

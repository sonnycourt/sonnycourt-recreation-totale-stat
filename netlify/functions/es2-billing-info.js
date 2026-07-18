import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

/**
 * /es2-derniere-etape : enregistre les infos de facturation post-achat ES2
 * (nom complet, téléphone, adresse) sur l'inscription webinaire du lead.
 * Identification par token (prioritaire) ou email d'inscription.
 */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = clean(body.t, 80);
    const email = clean(body.email, 200).toLowerCase();

    let where = '';
    if (token) where = `token=eq.${encodeURIComponent(token)}`;
    else if (email && email.includes('@')) where = `email=eq.${encodeURIComponent(email)}`;
    else return json(400, { error: 'Identification manquante' });

    const reg = await supabaseGet(`webinaire_registrations?${where}&select=token`);
    if (!reg.ok || !Array.isArray(reg.data) || !reg.data.length) {
      return json(404, { error: 'Inscription introuvable' });
    }

    const patch = {
      billing_full_name: clean(body.full_name, 160),
      billing_phone: clean(body.phone, 40),
      billing_street: clean(body.street, 220),
      billing_street2: clean(body.street2, 220) || null,
      billing_zip: clean(body.zip, 20),
      billing_city: clean(body.city, 120),
      billing_country: clean(body.country, 60),
      billing_completed_at: new Date().toISOString(),
    };
    const missing = ['billing_full_name', 'billing_phone', 'billing_street', 'billing_zip', 'billing_city', 'billing_country']
      .filter((k) => !patch[k]);
    if (missing.length) return json(400, { error: 'Champs obligatoires manquants' });

    const upd = await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(reg.data[0].token)}`,
      patch,
    );
    if (!upd.ok) return json(500, { error: 'Enregistrement impossible', detail: upd.error });
    return json(200, { ok: true });
  } catch (error) {
    console.error('es2-billing-info error:', error);
    return json(500, { error: 'Erreur serveur' });
  }
};

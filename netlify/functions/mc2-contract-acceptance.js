import {
  buildMc2ContractAcceptance,
  mc2CollectionEnabled,
  persistMc2ContractAcceptance,
  validateMc2ContractReadiness,
  validateMc2ContractOffer,
} from './lib/mc2-collection-case.mjs';
import { cleanMc2Token, loadMc2Registration, mc2Stripe } from './lib/mc2-stripe.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  // Tant que le système complet n'est pas activé, ce point d'entrée ne crée
  // aucune preuve et ne bloque jamais le checkout existant.
  if (!mc2CollectionEnabled()) return json(200, { ok: true, enabled: false });

  try {
    const body = await req.json().catch(() => ({}));
    const token = cleanMc2Token(body.token);
    const checkoutSessionId = clean(body.checkout_session_id);
    if (!token || !checkoutSessionId || body.accepted !== true) {
      return json(400, { error: 'Acceptation contractuelle incomplète.' });
    }
    const registration = await loadMc2Registration(token);
    if (!registration || registration.stripe_checkout_session_id !== checkoutSessionId) {
      return json(404, { error: 'Checkout MC2 introuvable.' });
    }
    const session = await mc2Stripe().checkout.sessions.retrieve(checkoutSessionId);
    if (session.metadata?.system !== 'es2_mc2' || session.client_reference_id !== token) {
      return json(403, { error: 'Checkout MC2 invalide.' });
    }
    const payload = buildMc2ContractAcceptance({
      registration,
      session,
      req,
      acceptedAt: new Date(),
    });
    const readiness = validateMc2ContractReadiness();
    if (!readiness.valid) {
      console.error('mc2-contract-readiness:', readiness.errors);
      return json(503, { error: 'La version contractuelle doit être finalisée avant le paiement.' });
    }
    const offerCheck = validateMc2ContractOffer(payload);
    if (!offerCheck.valid) {
      console.error('mc2-contract-offer-mismatch:', offerCheck.errors);
      return json(409, { error: 'L’échéancier affiché et le contrat Stripe ne correspondent pas.' });
    }
    await persistMc2ContractAcceptance(payload);
    return json(200, {
      ok: true,
      enabled: true,
      contract_version: payload.contract_version,
      evidence_sha256: payload.evidence_sha256,
    });
  } catch (error) {
    console.error('mc2-contract-acceptance:', error);
    return json(500, { error: 'La preuve contractuelle ne peut pas être enregistrée.' });
  }
};

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MC2_SESSION_MONTHLY_PAYMENT_CENTS,
  MC2_SESSION_MONTHLY_PAYMENT_COUNT,
  MC2_SESSION_MONTHLY_PLAN,
  MC2_SESSION_MONTHLY_TOTAL_CENTS,
  MC2_SESSION_ONE_TIME_CENTS,
  MC2_SESSION_ONE_TIME_PLAN,
  mc2SessionPaymentSchedule,
} from '../netlify/functions/lib/mc2-stripe.mjs';
import {
  buildMc2ContractDocumentSnapshot,
  mc2PaidSessionIsEligible,
  renderMc2ContractDocument,
} from '../netlify/functions/lib/mc2-contract-documents.mjs';

// Le moteur Stripe historique reste cohérent pour les contrats déjà conclus.
assert.equal(MC2_SESSION_MONTHLY_PAYMENT_CENTS * MC2_SESSION_MONTHLY_PAYMENT_COUNT, MC2_SESSION_MONTHLY_TOTAL_CENTS);
assert.equal(MC2_SESSION_MONTHLY_TOTAL_CENTS - MC2_SESSION_ONE_TIME_CENTS, 36700);
assert.equal(mc2SessionPaymentSchedule('monthly')[1].installments, 11);
assert.equal(mc2SessionPaymentSchedule('once').length, 1);

const env = {
  MC2_CONTRACT_VERSION: 'mc2-cgv-test-v1',
  MC2_TERMS_URL: 'https://sonnycourt.com/cgv/',
  MC2_TERMS_SNAPSHOT_URL: 'https://sonnycourt.com/cgv/test.pdf',
  MC2_TERMS_SNAPSHOT_SHA256: 'a'.repeat(64),
};
const session = (paymentPlan, amount, total) => ({
  mode: 'payment', payment_status: 'paid', currency: 'eur', amount_total: amount, created: 1_786_290_000,
  metadata: { system: 'es2_mc2', payment_plan: paymentPlan, contractual_total_cents: String(total) },
});
const legacyMonthlySession = session(MC2_SESSION_MONTHLY_PLAN, 19700, 236400);
const onceSession = session(MC2_SESSION_ONE_TIME_PLAN, 199700, 199700);
assert.equal(mc2PaidSessionIsEligible(legacyMonthlySession), true);
assert.equal(mc2PaidSessionIsEligible(onceSession), true);
const legacyMonthlyDocument = buildMc2ContractDocumentSnapshot({ session: legacyMonthlySession, event: { created: 1_786_290_000 }, env });
const onceDocument = buildMc2ContractDocumentSnapshot({ session: onceSession, event: { created: 1_786_290_000 }, env });
assert.equal(legacyMonthlyDocument.schedule.length, 12);
assert.equal(legacyMonthlyDocument.schedule.reduce((sum, row) => sum + row.amount_cents, 0), 236400);
assert.equal(onceDocument.schedule.length, 1);
assert.match(renderMc2ContractDocument(legacyMonthlyDocument), /première mensualité de 197\s*€/i);
assert.match(renderMc2ContractDocument(onceDocument), /prix total de 1[\s ]997\s*€ est réglé en une fois/i);

// L'offre publique actuelle fait foi : comptant 1 997 € ou trois fois 767 €.
const cgvPage = fs.readFileSync(new URL('../src/pages/cgv.astro', import.meta.url), 'utf8');
const es2Section = cgvPage.match(/<div class="section" id="es2">([\s\S]*?)<div class="section" id="formations-uniques">/)?.[1] || '';
assert.match(es2Section, /paiement unique de 1 997 € TTC/);
assert.match(es2Section, /trois mensualités de 767 € TTC/);
assert.match(es2Section, /2 301 € TTC/);
assert.match(es2Section, /économie de <strong>304 € TTC<\/strong>/);
assert.match(es2Section, /Garantie commerciale « Garantie Manifestation » pendant un an/);
assert.match(es2Section, /Une seule condition, simple et vérifiable/);
assert.match(es2Section, /Aucune justification du résultat obtenu ou non obtenu/);

// La session utilise exactement le composant d'offre approuvé et son checkout Spiffy.
const page = fs.readFileSync(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const offer = fs.readFileSync(new URL('../src/components/mc2/DealOffer.astro', import.meta.url), 'utf8');
assert.match(page, /import DealOffer from ['"]\.\.\/\.\.\/components\/mc2\/DealOffer\.astro['"]/);
assert.match(page, /<DealOffer\s*\/>/);
assert.doesNotMatch(page, /await mountLiveInlineCheckout\(/);
assert.match(offer, /https:\/\/js\.static\.spiffy\.co\/spiffy\.js/);
assert.match(offer, /spiffy\.load\(["']sonnycourt["']\)/);
assert.match(offer, /esprit-subconscient-2-0-2-2-1-1/);
assert.match(offer, /esprit-subconscient-2-0-34-1/);
assert.match(offer, /document\.createElement\(['"]spiffy-checkout['"]\)/);
assert.match(offer, /document\.createElement\(['"]iframe['"]\)/);
assert.match(offer, /setAttribute\(['"]allow['"],\s*['"]payment['"]\)/);
assert.match(offer, /data-payment-plan="once" aria-pressed="true"/);
assert.match(offer, /Versement unique/);
assert.match(offer, /Versement en 3 fois/);
assert.match(offer, /3 × 767 €/);
assert.doesNotMatch(offer, /url\.searchParams\.set\(['"]name_first['"]/);
assert.doesNotMatch(offer, /url\.searchParams\.set\(['"]email['"]/);
assert.doesNotMatch(offer, /spiffy\.on\(['"]order:success['"]\)/);
assert.doesNotMatch(offer, /window\.location\.assign\(/);
assert.match(offer, /import reviewsData from ['"]\.\.\/\.\.\/data\/reviews\.json['"]/);
assert.match(offer, /Voir les \{previewCheckoutReviews\.length\} témoignages authentiques/);

const tokenEndpoint = fs.readFileSync(new URL('../netlify/functions/mc2-create-test-token.js', import.meta.url), 'utf8');
assert.match(tokenEndpoint, /timingSafeEqual/);
assert.match(tokenEndpoint, /MC2_TEST_TOKEN_ADMIN_SECRET/);
assert.match(tokenEndpoint, /randomBytes\(24\)/);
assert.doesNotMatch(tokenEndpoint, /queueMc2Sms|MailerLite|sendMc2MetaEvents/);

console.log(JSON.stringify({
  installment: '3x767_spiffy',
  one_time: '1997_once',
  legacy_stripe_contract_documents: 'still_valid',
  payment_provider: 'spiffy_embedded',
  payment_fields: 'provider_hosted_pci_scope',
}, null, 2));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MC2_SESSION_MONTHLY_PAYMENT_CENTS,
  MC2_SESSION_MONTHLY_PAYMENT_COUNT,
  MC2_SESSION_MONTHLY_PLAN,
  MC2_SESSION_MONTHLY_TOTAL_CENTS,
  MC2_SESSION_ONE_TIME_CENTS,
  MC2_SESSION_ONE_TIME_PLAN,
  ensureMc2SessionPrices,
  isValidMc2SessionPrice,
  mc2SessionPlanConfig,
  mc2SessionPaymentSchedule,
} from '../netlify/functions/lib/mc2-stripe.mjs';
import { mc2SessionMonthlySchedulePhases } from '../netlify/functions/lib/mc2-pay-router.mjs';
import {
  buildMc2ContractDocumentSnapshot,
  mc2PaidSessionIsEligible,
  renderMc2ContractDocument,
} from '../netlify/functions/lib/mc2-contract-documents.mjs';

assert.equal(MC2_SESSION_MONTHLY_PAYMENT_CENTS * MC2_SESSION_MONTHLY_PAYMENT_COUNT, MC2_SESSION_MONTHLY_TOTAL_CENTS);
assert.equal(MC2_SESSION_MONTHLY_TOTAL_CENTS - MC2_SESSION_ONE_TIME_CENTS, 36700);
assert.equal(mc2SessionPlanConfig('monthly').paymentPlan, MC2_SESSION_MONTHLY_PLAN);
assert.equal(mc2SessionPlanConfig('once').paymentPlan, MC2_SESSION_ONE_TIME_PLAN);
assert.equal(mc2SessionPaymentSchedule('monthly')[1].installments, 11);
assert.equal(mc2SessionPaymentSchedule('once').length, 1);

const product = 'prod_V2GyqoqalbZxqn';
assert.equal(isValidMc2SessionPrice({
  product, active: true, type: 'one_time', currency: 'eur', unit_amount: 19700, tax_behavior: 'inclusive',
}, 'monthly_entry'), true);
assert.equal(isValidMc2SessionPrice({
  product, active: true, type: 'recurring', currency: 'eur', unit_amount: 19700,
  tax_behavior: 'inclusive', recurring: { interval: 'month', interval_count: 1 },
}, 'monthly_recurring'), true);
assert.equal(isValidMc2SessionPrice({
  product, active: true, type: 'one_time', currency: 'eur', unit_amount: 199700, tax_behavior: 'inclusive',
}, 'one_time'), true);

const createdPrices = [];
const catalog = await ensureMc2SessionPrices({
  prices: {
    list: async () => ({ data: [] }),
    create: async (params, options) => {
      createdPrices.push({ params, options });
      return {
        id: `price_${params.metadata.price_role}`,
        product,
        active: true,
        type: params.recurring ? 'recurring' : 'one_time',
        currency: params.currency,
        unit_amount: params.unit_amount,
        tax_behavior: params.tax_behavior,
        lookup_key: params.lookup_key,
        recurring: params.recurring || null,
      };
    },
  },
});
assert.equal(createdPrices.length, 3);
assert.ok(catalog.monthlyEntry.id && catalog.monthlyRecurring.id && catalog.oneTime.id);
assert.ok(createdPrices.every((row) => row.options.idempotencyKey.startsWith('mc2-session-price:')));

const phases = mc2SessionMonthlySchedulePhases('price_monthly_197');
assert.equal(phases.length, 1);
assert.deepEqual(phases[0].duration, { interval: 'month', interval_count: 11 });
assert.equal(phases[0].items[0].price, 'price_monthly_197');

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
const monthlySession = session(MC2_SESSION_MONTHLY_PLAN, 19700, 236400);
const onceSession = session(MC2_SESSION_ONE_TIME_PLAN, 199700, 199700);
assert.equal(mc2PaidSessionIsEligible(monthlySession), true);
assert.equal(mc2PaidSessionIsEligible(onceSession), true);
const monthlyDocument = buildMc2ContractDocumentSnapshot({ session: monthlySession, event: { created: 1_786_290_000 }, env });
const onceDocument = buildMc2ContractDocumentSnapshot({ session: onceSession, event: { created: 1_786_290_000 }, env });
assert.equal(monthlyDocument.schedule.length, 12);
assert.equal(monthlyDocument.schedule.reduce((sum, row) => sum + row.amount_cents, 0), 236400);
assert.equal(onceDocument.schedule.length, 1);
assert.equal(onceDocument.pricing.remaining_scheduled_cents, 0);
const monthlyDocumentHtml = renderMc2ContractDocument(monthlyDocument);
const onceDocumentHtml = renderMc2ContractDocument(onceDocument);
assert.match(monthlyDocumentHtml, /première mensualité de 197\s*€/i);
assert.match(monthlyDocumentHtml, /onze mensualités suivantes/i);
assert.doesNotMatch(monthlyDocumentHtml, /quatre échéances de 297\s*€/i);
assert.match(onceDocumentHtml, /prix total de 1[\s ]997\s*€ est réglé en une fois/i);
assert.match(onceDocumentHtml, /achat unique réglé en une fois/i);
assert.doesNotMatch(onceDocumentHtml, /paiement fractionné/i);

const cgvPage = fs.readFileSync(new URL('../src/pages/cgv.astro', import.meta.url), 'utf8');
const es2Section = cgvPage.match(/<div class="section" id="es2">([\s\S]*?)<div class="section" id="formations-uniques">/)?.[1] || '';
assert.match(es2Section, /paiement unique de 1 997 € TTC/);
assert.match(es2Section, /douze mensualités de 197 € TTC/);
assert.match(es2Section, /2 364 € TTC/);
assert.match(es2Section, /économie de <strong>367 € TTC<\/strong>/);
assert.match(es2Section, /Garantie commerciale « satisfait ou remboursé » pendant 14 jours/);
assert.doesNotMatch(es2Section, /1 235 €|47 €|297 €/);

const page = fs.readFileSync(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
assert.match(page, /https:\/\/js\.static\.spiffy\.co\/spiffy\.js/);
assert.match(page, /spiffy\.load\(["']sonnycourt["']\)/);
assert.match(page, /esprit-subconscient-2-0-2-2-1/);
assert.match(page, /esprit-subconscient-2-0-34/);
assert.match(page, /esprit-subconscient-2-0-2-2-1-1/);
assert.match(page, /esprit-subconscient-2-0-34-1/);
assert.match(page, /isLocalPreview \? SPIFFY_PREVIEW_CHECKOUT_URLS : SPIFFY_CHECKOUT_URLS/);
assert.match(page, /document\.createElement\(['"]spiffy-checkout['"]\)/);
assert.match(page, /document\.createElement\(['"]iframe['"]\)/);
assert.match(page, /setAttribute\(['"]allow['"],\s*['"]payment['"]\)/);
assert.match(page, /url\.searchParams\.set\(['"]name_first['"],\s*firstName\)/);
assert.match(page, /url\.searchParams\.set\(['"]email['"],\s*email\)/);
assert.match(page, /url\.searchParams\.set\(['"]country['"],\s*country\)/);
assert.doesNotMatch(page, /id="preview-spiffy-first-name"/);
assert.doesNotMatch(page, /id="preview-spiffy-email"/);
assert.doesNotMatch(page, /id="preview-spiffy-country"/);
assert.match(page, /const firstName = String\(reg\.prenom \|\| ''\)\.trim\(\)/);
assert.match(page, /const email = String\(reg\.email \|\| ''\)\.trim\(\)/);
assert.match(page, /const country = String\(reg\.pays \|\| ''\)\.trim\(\)/);
assert.match(page, /mountLiveInlineCheckout\(reg\)/);
assert.doesNotMatch(page, /spiffy\.on\(['"]order:success['"]/);
assert.doesNotMatch(page, /preview-payment\.is-confirmed/);
assert.doesNotMatch(page, /id="preview-payment-success"/);
assert.doesNotMatch(page, /id="dev-payment-success"/);
assert.match(page, /panels:\s*new Map\(\)/);
assert.match(page, /activatePlan\(nextPlan, 'checkout_engaged'\)/);
assert.match(page, /mountPlan\(initialPlan === 'once' \? 'monthly' : 'once'\)/);
assert.match(page, /panel\.style\.visibility = isActiveOnMount \? 'visible' : 'hidden'/);
assert.match(page, /candidate\.style\.display = isActive \? 'block' : 'none'/);
assert.doesNotMatch(page, /window\.location\.assign\(nextUrl\.toString\(\)\)/);
assert.doesNotMatch(page, /nextUrl\.searchParams\.set\('plan', 'once'\)/);
assert.match(page, /12 mensualités de 197 €/);
assert.doesNotMatch(page, />Ton plan de paiement</);
assert.match(page, /src="\/media\/reviews\/es2-morgane-levavi\.webp" alt="Morgane" width="256" height="256"/);
assert.match(page, /ça marche vraiment et c’est ça qui est exceptionnel/);
assert.doesNotMatch(page, /Première mensualité prélevée aujourd’hui/);
assert.doesNotMatch(page, /id="preview-schedule-next"/);
assert.doesNotMatch(page, /window\.location\.href\s*=\s*'\/commencer\?t='/);
assert.match(page, /const hasInlineCheckout = inlineCheckoutController\?\.provider === 'spiffy'/);
assert.match(page, /offerCtaNode\.classList\.toggle\('hidden', isOfferExpired \|\| hasInlineCheckout\)/);

const tokenEndpoint = fs.readFileSync(new URL('../netlify/functions/mc2-create-test-token.js', import.meta.url), 'utf8');
assert.match(tokenEndpoint, /timingSafeEqual/);
assert.match(tokenEndpoint, /MC2_TEST_TOKEN_ADMIN_SECRET/);
assert.match(tokenEndpoint, /randomBytes\(24\)/);
assert.doesNotMatch(tokenEndpoint, /queueMc2Sms|MailerLite|sendMc2MetaEvents/);

console.log(JSON.stringify({
  monthly: '12x197_monthly_clear_summary',
  one_time: '1997_once',
  contract_documents: 'both_plans',
  payment_provider: 'spiffy_embedded',
  payment_fields: 'provider_hosted_pci_scope',
  redirect_to_checkout: 'removed',
}, null, 2));

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MC2_BONUS_TAG_WITH_CONSULTATION,
  MC2_BONUS_TAG_WITHOUT_CONSULTATION,
  MC2_CONSULTATION_BONUS_DURATION_MS,
  mc2ConsultationBonusCutoffAt,
  mc2ConsultationBonusTag,
} from '../netlify/functions/lib/mc2-consultation-bonus.mjs';
import { mc2ReplayOfferExpiresAt, MC2_LIVE_CTA_SECONDS, MC2_LIVE_VIDEO_LEAD_MS } from '../src/lib/mc2-timing.mjs';

const hour = 60 * 60 * 1000;
const liveRegistration = {
  session_starts_at: '2026-09-03T09:00:00.000Z',
  offer_expires_at: '2026-09-06T09:00:00.000Z',
};
const liveCutoff = mc2ConsultationBonusCutoffAt({
  registration: liveRegistration,
  purchasedAt: '2026-09-04T10:00:00.000Z',
});

assert.equal(MC2_CONSULTATION_BONUS_DURATION_MS, 24 * hour);
assert.equal(liveCutoff.getTime(), Date.parse(liveRegistration.session_starts_at)
  - MC2_LIVE_VIDEO_LEAD_MS + MC2_LIVE_CTA_SECONDS * 1000 + 24 * hour);
assert.equal(mc2ConsultationBonusTag({
  registration: { ...liveRegistration, purchased_at: new Date(liveCutoff.getTime() - 1).toISOString() },
  purchasedAt: new Date(liveCutoff.getTime() - 1),
}), MC2_BONUS_TAG_WITH_CONSULTATION);
assert.equal(mc2ConsultationBonusTag({
  registration: { ...liveRegistration, purchased_at: liveCutoff.toISOString() },
  purchasedAt: liveCutoff,
}), MC2_BONUS_TAG_WITHOUT_CONSULTATION);

const replayCtaAt = new Date('2026-09-05T12:00:00.000Z');
const replayRegistration = {
  session_starts_at: liveRegistration.session_starts_at,
  offer_expires_at: mc2ReplayOfferExpiresAt(replayCtaAt).toISOString(),
};
assert.equal(mc2ConsultationBonusCutoffAt({
  registration: replayRegistration,
  purchasedAt: replayCtaAt,
}).toISOString(), '2026-09-06T12:00:00.000Z');
assert.equal(mc2ConsultationBonusTag({
  registration: { ...replayRegistration, purchased_at: '2026-09-06T11:59:59.999Z' },
  purchasedAt: '2026-09-06T11:59:59.999Z',
}), MC2_BONUS_TAG_WITH_CONSULTATION);
assert.equal(mc2ConsultationBonusTag({
  registration: { ...replayRegistration, purchased_at: '2026-09-06T12:00:00.000Z' },
  purchasedAt: '2026-09-06T12:00:00.000Z',
}), MC2_BONUS_TAG_WITHOUT_CONSULTATION);

// Nouvel achat : aucun bonus consultation, même pendant l'ancienne fenêtre.
for (const registration of [liveRegistration, replayRegistration, {}]) {
  for (const purchasedAt of ['2026-09-03T11:00:00Z', '2026-09-05T12:00:00Z', new Date()]) {
    assert.equal(mc2ConsultationBonusTag({ registration, purchasedAt }), MC2_BONUS_TAG_WITHOUT_CONSULTATION);
  }
}
// Les deux décisions déjà enregistrées sont immuables, même sans ancre temporelle.
for (const tag of [MC2_BONUS_TAG_WITH_CONSULTATION, MC2_BONUS_TAG_WITHOUT_CONSULTATION]) {
  assert.equal(mc2ConsultationBonusTag({ registration: { purchase_bonus_tag: tag } }), tag);
  assert.equal(mc2ConsultationBonusTag({
    registration: { ...liveRegistration, purchase_bonus_tag: tag, purchased_at: '2026-09-03T11:00:00Z' },
    purchasedAt: '2030-01-01T00:00:00Z',
  }), tag);
}
assert.equal(mc2ConsultationBonusTag({ registration: { ...liveRegistration, purchased_at: 'invalid' } }), MC2_BONUS_TAG_WITHOUT_CONSULTATION);
assert.equal(mc2ConsultationBonusTag({
  registration: { ...liveRegistration, purchased_at: '2026-09-03T11:00:00Z' },
  purchasedAt: '2030-01-01T00:00:00Z',
}), MC2_BONUS_TAG_WITH_CONSULTATION, 'Un ancien achat sans tag garde sa date originale');

// Les deux chemins de paiement emploient la même règle de préservation.
for (const file of ['spiffy-purchase-webhook.js', 'lib/mc2-pay-router.mjs']) {
  const source = await readFile(new URL(`../netlify/functions/${file}`, import.meta.url), 'utf8');
  assert.match(source, /const purchaseBonusTag = mc2ConsultationBonusTag\(/);
  assert.match(source, /purchase_bonus_tag: purchaseBonusTag/);
}
assert.equal(mc2ConsultationBonusTag({
  registration: {},
  purchasedAt: '2026-09-03T12:00:00.000Z',
}), MC2_BONUS_TAG_WITHOUT_CONSULTATION);

const migration = await readFile(new URL('../sql/mc2_purchase_bonus_tag.sql', import.meta.url), 'utf8');
assert.match(migration, /add column if not exists purchase_bonus_tag text/i);
assert.match(migration, /avec_consultation_sonny/);
assert.match(migration, /sans_consultation_sonny/);
assert.match(migration, /where purchased_at is not null/i);

console.log(JSON.stringify({
  new_purchases_without_consultation: 'ok',
  historical_untagged_purchases_preserved: 'ok',
  live_bonus_cutoff_cta_plus_24h: 'ok',
  replay_bonus_cutoff_cta_plus_24h: 'ok',
  purchase_tag_is_immutable_on_retry: 'ok',
  supabase_migration_is_idempotent: 'ok',
}, null, 2));

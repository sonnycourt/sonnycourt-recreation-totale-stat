const CONFIG = Object.freeze({
  products: { kind: 'product', confirmation: 'PUBLIER PRODUIT' },
  checkouts: { kind: 'checkout', confirmation: 'PUBLIER CHECKOUT' },
  discounts: { kind: 'discount', confirmation: 'PUBLIER REDUCTION' },
});

function config(draftKind) {
  const value = CONFIG[String(draftKind || '')];
  if (!value) throw new Error('pay_catalog_draft_kind_invalid');
  return value;
}

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function payCatalogDraftKind(draftKind) {
  return config(draftKind).kind;
}

export function payCatalogDraftConfirmation(draftKind) {
  return config(draftKind).confirmation;
}

export function payCatalogDraftInput(draftKind, draft = {}) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('pay_catalog_draft_invalid');
  if (draftKind === 'products') return {
    name: clean(draft.name, 120),
    description: clean(draft.description, 600),
    billing_type: draft.billingType === 'recurring' ? 'recurring' : 'one_time',
    amount: Number(draft.amount),
    currency: clean(draft.currency, 8).toLowerCase(),
    interval_unit: clean(draft.intervalUnit, 20).toLowerCase() || 'month',
    interval_count: Number(draft.intervalCount || 1),
    metadata: { offer_slug: clean(draft.offerSlug, 180) },
  };
  if (draftKind === 'checkouts') {
    const billing = draft.billing === 'subscription' ? 'recurring' : draft.billing === 'payment-plan' ? 'payment_plan' : 'one_time';
    return {
      name: clean(draft.name, 120),
      description: clean(draft.description, 600),
      slug: clean(draft.slug, 180).toLowerCase(),
      billing,
      amount: Number(draft.amount),
      currency: clean(draft.currency, 8).toLowerCase(),
      interval_unit: 'month',
      interval_count: 1,
      plan: draft.plan ? {
        deposit: Number(draft.plan.deposit || 0),
        bridge_amount: Number(draft.plan.bridgeAmount || 0),
        bridge_delay_days: Number(draft.plan.bridgeDelayDays || 0),
        installments: Number(draft.plan.installments || 0),
      } : null,
      allow_promotion_codes: Boolean(draft.allowPromotionCodes),
      confirmation_message: clean(draft.priceNote, 500) || 'Paiement confirmé.',
      metadata: { checkout_id: clean(draft.slug, 180), offer_slug: clean(draft.slug, 180) },
    };
  }
  if (draftKind === 'discounts') return {
    code: clean(draft.code, 80).toUpperCase(),
    type: draft.type === 'fixed' ? 'fixed' : 'percentage',
    value: Number(draft.value),
    currency: clean(draft.currency, 8).toLowerCase() || 'eur',
    applies_one_time: draft.appliesOneTime !== false,
    applies_recurring: Boolean(draft.appliesRecurring),
    once_per_customer: Boolean(draft.oncePerCustomer),
    expires_at: clean(draft.expiresAt, 80) || null,
    max_redemptions: draft.maxRedemptions == null ? null : Number(draft.maxRedemptions),
  };
  throw new Error('pay_catalog_draft_kind_invalid');
}

export function payCatalogDraftIdempotencyKey(draftKind, draft = {}) {
  const kind = payCatalogDraftKind(draftKind);
  const id = clean(String(draft.id ?? ''), 120);
  if (!id) throw new Error('pay_catalog_draft_id_invalid');
  const version = clean(draft.updatedAt || draft.createdAt, 80) || 'initial';
  return `pay-catalog:${kind}:${id}:${version}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 100);
}

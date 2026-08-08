const TABLES = new Set([
  'pay_checkouts',
  'pay_customers',
  'pay_discounts',
  'pay_orders',
  'pay_payment_plans',
  'pay_payments',
  'pay_prices',
  'pay_products',
  'pay_refunds',
  'pay_subscriptions',
]);

const SAFE_METADATA_KEYS = Object.freeze([
  'checkout_id',
  'pay_checkout_id',
  'offer_slug',
  'offer_name',
  'funnel',
  'pay_route',
  'payment_plan_id',
  'installment_count',
  'installments_paid',
  'remaining_minor',
  'customer_email',
  'customer_name',
  'customer_first_name',
  'customer_last_name',
  'product_name',
]);

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function id(value) {
  return clean(typeof value === 'string' ? value : value?.id, 255);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, integer(value, fallback));
}

function currency(value) {
  const code = clean(value, 8).toLowerCase();
  return /^[a-z]{3}$/.test(code) ? code : 'eur';
}

function iso(value) {
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function boolean(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function names(value) {
  const display = clean(value, 200);
  const parts = display.split(/\s+/).filter(Boolean);
  return { display, first: parts.shift() || '', last: parts.join(' ') };
}

function safeMetadata(source, extra = {}) {
  const metadata = {};
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const key of SAFE_METADATA_KEYS) {
      const value = clean(String(source[key] ?? ''), 500);
      if (value) metadata[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    const normalized = clean(String(value ?? ''), 500);
    if (normalized) metadata[key] = normalized;
  }
  return metadata;
}

function operation(table, row) {
  if (!TABLES.has(table)) throw new Error('pay_projection_table_invalid');
  if (!row?.provider || !row?.external_id) throw new Error('pay_projection_identity_missing');
  return { table, conflict: 'provider,external_id', row };
}

function stripeCustomer(object) {
  const details = object?.customer_details || object?.latest_charge?.billing_details || object?.billing_details || {};
  const metadata = object?.metadata || {};
  const email = clean(details.email || object?.receipt_email || metadata.customer_email, 200).toLowerCase();
  const name = clean(details.name || metadata.customer_name || metadata.customer_first_name, 200);
  return { email, name, country: clean(details.address?.country, 2).toUpperCase() };
}

function stripePaymentMethod(object) {
  const charge = object?.latest_charge && typeof object.latest_charge === 'object' ? object.latest_charge : null;
  const details = charge?.payment_method_details || object?.payment_method_details || {};
  const type = clean(details.type || object?.payment_method_types?.[0], 80);
  const method = details[type] || details.card || {};
  return { type, brand: clean(method.brand, 60), last4: clean(method.last4, 4) };
}

function stripePrice(subscription) {
  return subscription?.items?.data?.[0]?.price || subscription?.plan || {};
}

function stripeCoupon(object) {
  return object?.promotion?.coupon || object?.coupon || object;
}

function projectStripeCustomer(object) {
  const identity = id(object);
  const email = clean(object.email, 200).toLowerCase();
  const parsed = names(object.name || email);
  return operation('pay_customers', {
    provider: 'stripe', external_id: identity, email: email || null, email_normalized: email || null,
    first_name: parsed.first || null, last_name: parsed.last || null, display_name: parsed.display || email || 'Client Stripe',
    phone: clean(object.phone, 40) || null, country: clean(object.address?.country, 2).toUpperCase() || null,
    currency: clean(object.currency, 8).toLowerCase() || null,
    source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata),
  });
}

function projectStripeProduct(object) {
  return operation('pay_products', {
    provider: 'stripe', external_id: id(object), name: clean(object.name, 240) || 'Produit Stripe',
    description: clean(object.description, 1_000) || null, active: boolean(object.active),
    source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata),
  });
}

function projectStripePrice(object) {
  const productId = id(object.product);
  const installments = nonNegative(object.metadata?.installment_count);
  const recurring = object.type === 'recurring' || Boolean(object.recurring);
  return operation('pay_prices', {
    provider: 'stripe', external_id: id(object), label: clean(object.nickname, 200) || null,
    currency: currency(object.currency), unit_amount_minor: nonNegative(object.unit_amount),
    billing_type: installments ? 'installment' : recurring ? 'recurring' : 'one_time',
    interval_unit: recurring ? clean(object.recurring?.interval, 20) || null : null,
    interval_count: recurring ? Math.max(1, integer(object.recurring?.interval_count, 1)) : null,
    installment_count: installments || null, active: boolean(object.active),
    source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata, { product_external_id: productId }),
  });
}

function projectStripeCheckout(object) {
  const line = object.line_items?.data?.[0] || {};
  const price = line.price || {};
  const product = typeof price.product === 'object' ? price.product : {};
  const productId = id(price.product);
  const priceId = id(price);
  const name = clean(object.metadata?.checkout_name || product.name, 240) || `Checkout ${id(object).slice(-8)}`;
  return operation('pay_checkouts', {
    provider: 'stripe', external_id: id(object), name, slug: clean(object.metadata?.checkout_slug, 180) || null,
    public_url: clean(object.url, 1_000) || null, status: object.active === false ? 'archived' : 'active',
    source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata, { product_external_id: productId, price_external_id: priceId }),
  });
}

function projectStripeOrder(object) {
  const customer = object.customer_details || {};
  const customerName = clean(customer.name, 200);
  const customerEmail = clean(customer.email || object.customer_email, 200).toLowerCase();
  const subtotal = nonNegative(object.amount_subtotal);
  const total = nonNegative(object.amount_total);
  const tax = nonNegative(object.total_details?.amount_tax);
  const discount = nonNegative(object.total_details?.amount_discount);
  return operation('pay_orders', {
    provider: 'stripe', external_id: id(object), status: clean(object.payment_status || object.status, 60) || 'unknown',
    currency: currency(object.currency), subtotal_minor: subtotal, discount_minor: discount, finance_fee_minor: 0,
    tax_minor: tax, total_minor: total, refunded_minor: 0, promo_code: null,
    source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata, {
      customer_external_id: id(object.customer), customer_email: customerEmail,
      customer_name: customerName, payment_intent_external_id: id(object.payment_intent),
      subscription_external_id: id(object.subscription),
    }),
  });
}

function projectStripePayment(object) {
  const customer = stripeCustomer(object);
  const method = stripePaymentMethod(object);
  const charge = object.latest_charge && typeof object.latest_charge === 'object' ? object.latest_charge : {};
  const amount = nonNegative(object.amount_received || object.amount);
  const refunded = nonNegative(charge.amount_refunded);
  const fee = integer(charge.balance_transaction?.fee, null);
  const net = integer(charge.balance_transaction?.net, null);
  return operation('pay_payments', {
    provider: 'stripe', external_id: id(object), status: clean(object.status, 60) || 'unknown',
    currency: currency(object.currency), amount_minor: amount, refunded_minor: refunded,
    fee_minor: fee, net_minor: net, payment_method_type: method.type || null,
    payment_method_brand: method.brand || null, payment_method_last4: method.last4 || null,
    description: clean(object.description || object.metadata?.offer_name || object.metadata?.offer_slug, 500) || null,
    paid_at: object.status === 'succeeded' ? iso(object.created) : null, source_created_at: iso(object.created),
    source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata, {
      customer_external_id: id(object.customer), customer_email: customer.email, customer_name: customer.name,
      charge_external_id: id(charge),
    }),
  });
}

function projectStripeRefund(object) {
  return operation('pay_refunds', {
    provider: 'stripe', external_id: id(object), status: clean(object.status, 60) || 'unknown',
    currency: currency(object.currency), amount_minor: nonNegative(object.amount), reason: clean(object.reason, 100) || null,
    refunded_at: iso(object.created), source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(object.metadata, { payment_external_id: id(object.payment_intent), charge_external_id: id(object.charge) }),
  });
}

function projectStripeSubscription(object) {
  const price = stripePrice(object);
  const metadata = object.metadata || {};
  const installmentCount = nonNegative(metadata.installment_count);
  const installmentsPaid = Math.min(installmentCount || Number.MAX_SAFE_INTEGER, nonNegative(metadata.installments_paid));
  const installmentAmount = nonNegative(price.unit_amount);
  if (installmentCount) {
    const calculatedRemaining = Math.max(0, installmentCount - installmentsPaid) * installmentAmount;
    return operation('pay_payment_plans', {
      provider: 'stripe', external_id: id(object), status: clean(object.status, 60) || 'unknown',
      currency: currency(price.currency || object.currency), installment_amount_minor: installmentAmount,
      installment_count: installmentCount, installments_paid: installmentsPaid,
      remaining_minor: nonNegative(metadata.remaining_minor, calculatedRemaining),
      interval_unit: clean(price.recurring?.interval, 20) || 'month',
      interval_count: Math.max(1, integer(price.recurring?.interval_count, 1)),
      started_at: iso(object.start_date || object.created), next_payment_at: iso(object.current_period_end),
      source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
      metadata: safeMetadata(metadata, {
        customer_external_id: id(object.customer), product_external_id: id(price.product), price_external_id: id(price),
      }),
    });
  }
  return operation('pay_subscriptions', {
    provider: 'stripe', external_id: id(object), status: clean(object.status, 60) || 'unknown',
    currency: currency(price.currency || object.currency), amount_minor: installmentAmount,
    interval_unit: clean(price.recurring?.interval, 20) || null,
    interval_count: Math.max(1, integer(price.recurring?.interval_count, 1)),
    quantity: Math.max(1, integer(object.items?.data?.[0]?.quantity, 1)),
    started_at: iso(object.start_date || object.created), current_period_start: iso(object.current_period_start),
    current_period_end: iso(object.current_period_end), cancel_at: iso(object.cancel_at), cancelled_at: iso(object.canceled_at),
    source_created_at: iso(object.created), source_updated_at: iso(object.updated || object.created),
    metadata: safeMetadata(metadata, {
      customer_external_id: id(object.customer), product_external_id: id(price.product), price_external_id: id(price),
    }),
  });
}

function projectStripeDiscount(object) {
  const coupon = stripeCoupon(object);
  const expiresAt = object.expires_at || coupon.redeem_by;
  const active = object.active !== false && coupon.valid !== false && (!expiresAt || Number(expiresAt) * 1_000 > Date.now());
  const percent = Number(coupon.percent_off);
  const fixed = nonNegative(coupon.amount_off);
  return operation('pay_discounts', {
    provider: 'stripe', external_id: id(object), code: clean(object.code || coupon.name || object.name || id(object), 180),
    status: active ? 'active' : 'expired', discount_type: Number.isFinite(percent) ? 'percentage' : 'fixed',
    amount_minor: Number.isFinite(percent) ? null : fixed, percent_off: Number.isFinite(percent) ? percent : null,
    currency: coupon.currency ? currency(coupon.currency) : null,
    applies_to_one_time: true, applies_to_recurring: coupon.duration !== 'once',
    once_per_customer: Boolean(object.restrictions?.first_time_transaction),
    max_redemptions: integer(object.max_redemptions || coupon.max_redemptions, null),
    redeemed_count: nonNegative(object.times_redeemed || coupon.times_redeemed), expires_at: iso(expiresAt),
    source_created_at: iso(object.created || coupon.created), source_updated_at: iso(object.updated || object.created || coupon.created),
    metadata: safeMetadata(object.metadata || coupon.metadata, { coupon_external_id: id(coupon) }),
  });
}

export function projectStripeResource(resource, object) {
  const name = clean(resource, 80);
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('pay_projection_object_invalid');
  const projectors = {
    customers: projectStripeCustomer,
    products: projectStripeProduct,
    prices: projectStripePrice,
    payment_links: projectStripeCheckout,
    checkout_sessions: projectStripeOrder,
    payment_intents: projectStripePayment,
    refunds: projectStripeRefund,
    subscriptions: projectStripeSubscription,
    coupons: projectStripeDiscount,
    promotion_codes: projectStripeDiscount,
  };
  const projector = projectors[name];
  if (!projector) throw new Error('pay_projection_resource_invalid');
  return [projector(object)];
}

export function projectPayPalTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) throw new Error('pay_projection_object_invalid');
  const externalId = id(transaction.id);
  if (!externalId) throw new Error('pay_projection_identity_missing');
  const providerName = 'paypal';
  const sourceCreatedAt = iso(Number(transaction.created || 0));
  const sourceUpdatedAt = iso(transaction.updated) || sourceCreatedAt;
  const transactionCurrency = currency(transaction.currency);
  const customerId = clean(transaction.email, 200).toLowerCase();
  const operations = [];
  if (customerId) {
    const parsed = names(transaction.customer || customerId);
    operations.push(operation('pay_customers', {
      provider: providerName, external_id: customerId, email: customerId, email_normalized: customerId,
      first_name: parsed.first || null, last_name: parsed.last || null, display_name: parsed.display || customerId,
      country: clean(transaction.country, 2).toUpperCase() || null, currency: transactionCurrency,
      source_created_at: sourceCreatedAt, source_updated_at: sourceUpdatedAt,
      metadata: safeMetadata({}, { paypal_reference_id: transaction.reference_id }),
    }));
  }
  if (transaction.kind === 'refund') {
    operations.push(operation('pay_refunds', {
      provider: providerName, external_id: externalId, status: clean(transaction.status, 60) || 'unknown',
      currency: transactionCurrency, amount_minor: nonNegative(transaction.refunded || transaction.amount), reason: null,
      refunded_at: sourceCreatedAt, source_created_at: sourceCreatedAt, source_updated_at: sourceUpdatedAt,
      metadata: safeMetadata({}, { payment_external_id: transaction.reference_id, event_code: transaction.event_code }),
    }));
    return operations;
  }
  if (['sale', 'payment_plan'].includes(transaction.kind)) {
    operations.push(operation('pay_payments', {
      provider: providerName, external_id: externalId, status: clean(transaction.status, 60) || 'unknown',
      currency: transactionCurrency, amount_minor: nonNegative(transaction.amount), refunded_minor: nonNegative(transaction.refunded),
      fee_minor: nonNegative(transaction.fee), net_minor: integer(transaction.signed_amount, null),
      payment_method_type: 'paypal', payment_method_brand: null, payment_method_last4: null,
      description: clean(transaction.description, 500) || 'Paiement PayPal',
      paid_at: transaction.status === 'Réussi' ? sourceCreatedAt : null,
      source_created_at: sourceCreatedAt, source_updated_at: sourceUpdatedAt,
      metadata: safeMetadata({}, {
        customer_external_id: customerId, customer_email: customerId,
        paypal_reference_id: transaction.reference_id, paypal_reference_type: transaction.reference_type,
        invoice_id: transaction.invoice_id, event_code: transaction.event_code,
      }),
    }));
  }
  return operations;
}

export function validatePayProjection(operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('pay_projection_empty');
  for (const item of operations) {
    if (!TABLES.has(item?.table) || item?.conflict !== 'provider,external_id') throw new Error('pay_projection_operation_invalid');
    if (!['stripe', 'paypal'].includes(item?.row?.provider) || !clean(item?.row?.external_id, 255)) throw new Error('pay_projection_identity_missing');
  }
  return operations;
}

import crypto from 'node:crypto';

const FIELD_ALIASES = Object.freeze({
  external_id: ['id', 'spiffy id'],
  order_id: ['order id', 'order number', 'order', 'order #'],
  customer_id: ['customer id', 'customer'],
  payment_id: ['payment id'],
  stripe_charge_id: ['stripe charge id'],
  stripe_payment_intent_id: ['stripe paymentintent id', 'stripe payment intent id'],
  paypal_order_id: ['paypal order id'],
  paypal_capture_id: ['paypal capture id'],
  plan_id: ['payment plan id', 'paymentplan id', 'plan id', 'payment plan', 'paymentplan'],
  checkout_id: ['checkout id', 'checkout'],
  email: ['email', 'email address', 'customer email'],
  first_name: ['first name', 'firstname', 'name first', 'customer first name'],
  last_name: ['last name', 'lastname', 'name last', 'customer last name'],
  name: ['name', 'customer name', 'full name', 'display name'],
  phone: ['phone', 'phone number', 'mobile'],
  country: ['country', 'pays', 'billing country', 'shipping country'],
  currency: ['currency', 'currency code'],
  status: ['status', 'payment status', 'order status', 'plan status'],
  total: ['total', 'display total', 'order total', 'amount', 'gross', 'total amount'],
  subtotal: ['subtotal', 'sub total'],
  discount: ['discount', 'discount amount', 'promo discount'],
  finance_fee: ['finance fee', 'financing fee'],
  tax: ['tax', 'tax amount', 'sales tax'],
  refunded: ['refunded', 'refund amount', 'amount refunded', 'total amount refunded'],
  fee: ['fee', 'fees', 'processing fee'],
  net: ['net', 'net amount'],
  lifetime_value: ['lifetime value', 'ltv', 'total spend'],
  order_count: ['order count', 'orders', 'number of orders', 'num orders'],
  promo_code: ['promo code', 'coupon', 'discount code'],
  product: ['product', 'product name', 'offer', 'internal name', 'offer name'],
  description: ['description', 'item', 'item name', 'offer name'],
  checkout_name: ['checkout name', 'name'],
  checkout_url: ['checkout url', 'url', 'link'],
  created_at: ['date created', 'created at', 'created', 'order date', 'date'],
  updated_at: ['date updated', 'updated at', 'updated'],
  paid_at: ['paid at', 'payment date', 'date paid', 'date'],
  started_at: ['started at', 'start date', 'date created'],
  next_payment_at: ['next payment at', 'next payment', 'next payment date', 'next billing date'],
  frequency: ['frequency', 'interval', 'billing interval'],
  frequency_count: ['frequency count', 'interval count', 'billing interval count'],
  installment_amount: ['installment amount', 'payment amount', 'payment total amount', 'amount'],
  installment_count: ['installments', 'number of payments', 'payment count'],
  installments_paid: ['payments made', 'installments paid', 'paid payments'],
  remaining: ['remaining', 'remaining balance', 'balance'],
  total_due: ['total due amount'],
  total_paid: ['total paid amount'],
  payment_method: ['payment method', 'method', 'gateway', 'card brand', 'card type'],
  gateway: ['gateway'],
  card_type: ['card type', 'card brand'],
  last_four: ['last four', 'last4'],
});

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function normalizeHeader(value) {
  return cleanText(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function delimiterScore(line, delimiter) {
  let quoted = false;
  let score = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === delimiter) score += 1;
  }
  return score;
}

export function detectDelimiter(csv) {
  const firstLine = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  return [',', ';', '\t'].sort((first, second) => delimiterScore(firstLine, second) - delimiterScore(firstLine, first))[0];
}

export function parseCsv(csv, delimiter = detectDelimiter(csv)) {
  const text = String(csv || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => cleanText(value))) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => cleanText(value))) rows.push(row);
  }
  if (quoted) throw new Error('csv_unclosed_quote');
  if (rows.length < 2) throw new Error('csv_empty');

  const headers = rows.shift().map(normalizeHeader);
  const seen = new Map();
  const uniqueHeaders = headers.map((header, index) => {
    const base = header || `column_${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
  return rows.map((values, rowIndex) => Object.fromEntries(uniqueHeaders.map((header, columnIndex) => [header, cleanText(values[columnIndex], 5_000)]).concat([['_row', rowIndex + 2]])));
}

function aliases(name) {
  return (FIELD_ALIASES[name] || [name]).map(normalizeHeader);
}

function valueOf(row, name) {
  for (const key of aliases(name)) if (cleanText(row[key])) return cleanText(row[key]);
  return '';
}

function idValue(row, names) {
  for (const name of names) {
    const value = valueOf(row, name);
    if (value) return value.replace(/^#/, '').slice(0, 255);
  }
  return '';
}

function currencyFrom(value, explicit) {
  const code = cleanText(explicit, 8).toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) return code;
  if (String(value).includes('£')) return 'GBP';
  if (String(value).includes('$')) return 'USD';
  return 'EUR';
}

export function moneyToMinor(value, currency = 'EUR') {
  let input = cleanText(value, 80).replace(/[\s\u00A0'’]/g, '').replace(/[^0-9,.-]/g, '');
  if (!input) return 0;
  const negative = input.startsWith('-');
  input = input.replace(/-/g, '');
  const comma = input.lastIndexOf(',');
  const dot = input.lastIndexOf('.');
  let decimal = '';
  if (comma >= 0 && dot >= 0) decimal = comma > dot ? ',' : '.';
  else if (comma >= 0) decimal = input.length - comma - 1 === 2 ? ',' : '';
  else if (dot >= 0) decimal = input.length - dot - 1 === 2 ? '.' : '';
  if (decimal) {
    const parts = input.split(decimal);
    input = `${parts.slice(0, -1).join('').replace(/[.,]/g, '')}.${parts.at(-1)}`;
  } else input = input.replace(/[.,]/g, '');
  const amount = Number(input);
  if (!Number.isFinite(amount)) return 0;
  const zeroDecimal = new Set(['JPY', 'KRW', 'VND', 'CLP']);
  const multiplier = zeroDecimal.has(String(currency).toUpperCase()) ? 1 : 100;
  return Math.round((negative ? -amount : amount) * multiplier);
}

// Les exports bruts Spiffy stockent les montants en unités mineures. Les
// valeurs formatées restent acceptées pour les anciens exports et fixtures.
export function spiffyMinor(value, currency = 'EUR') {
  const input = cleanText(value, 80);
  if (/^-?\d+(?:\.0+)?$/.test(input)) return Math.round(Number(input));
  return moneyToMinor(input, currency);
}

export function dateToIso(value) {
  const input = cleanText(value, 100);
  if (!input) return null;
  const direct = new Date(input);
  if (Number.isFinite(direct.getTime())) return direct.toISOString();
  const match = input.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function statusValue(value, fallback = 'unknown') {
  const status = normalizeHeader(value);
  if (/refund|rembours/.test(status)) return 'refunded';
  if (/succeed|paid|complete|reussi|active/.test(status)) return 'succeeded';
  if (/fail|declin|refus|past due|retard|impaye/.test(status)) return 'failed';
  if (/cancel|annul/.test(status)) return 'cancelled';
  if (/pend|attente|process/.test(status)) return 'pending';
  return status.replace(/\s+/g, '_') || fallback;
}

function planStatusValue(value) {
  const status = normalizeHeader(value);
  if (/^active$|actif/.test(status)) return 'active';
  if (/finish|complete|succeed|termine/.test(status)) return 'completed';
  if (/^past due$|retard/.test(status)) return 'past_due';
  if (/default|^unpaid$|impaye|fail/.test(status)) return 'unpaid';
  if (/cancel|annul/.test(status)) return 'cancelled';
  if (/pend|attente|scheduled/.test(status)) return 'pending';
  return status.replace(/\s+/g, '_') || 'unknown';
}

function rawMetadata(row) {
  const metadata = { spiffy_import_row: row._row };
  for (const [key, value] of Object.entries(row)) if (key !== '_row' && value) metadata[key] = value;
  return metadata;
}

function customerName(row) {
  const display = valueOf(row, 'name');
  const first = valueOf(row, 'first_name');
  const last = valueOf(row, 'last_name');
  return { display: display || [first, last].filter(Boolean).join(' '), first, last };
}

export function detectSpiffyExportType(rows) {
  const headers = new Set(Object.keys(rows[0] || {}));
  const has = (name) => aliases(name).some((alias) => headers.has(alias));
  if (has('plan_id') || has('next_payment_at') || has('remaining')) return 'payment_plans';
  if (has('checkout_id') || has('checkout_url')) return 'checkouts';
  if (has('payment_method') && (has('paid_at') || has('total'))) return 'payments';
  if (has('order_id') && (has('product') || has('total'))) return 'orders';
  if (has('customer_id') || (has('email') && (has('lifetime_value') || has('order_count')))) return 'customers';
  throw new Error('spiffy_export_type_unknown');
}

function normalizeCustomer(row) {
  const email = valueOf(row, 'email').toLowerCase();
  const names = customerName(row);
  const externalId = idValue(row, ['customer_id', 'external_id']) || email;
  return {
    table: 'pay_customers',
    row: {
      provider: 'spiffy', external_id: externalId, email: email || null, email_normalized: email || null,
      first_name: names.first || null, last_name: names.last || null, display_name: names.display || email || 'Client Spiffy',
      phone: valueOf(row, 'phone') || null, country: valueOf(row, 'country') || null,
      currency: currencyFrom(valueOf(row, 'lifetime_value'), valueOf(row, 'currency')),
      lifetime_value_minor: Math.max(0, spiffyMinor(valueOf(row, 'lifetime_value'), valueOf(row, 'currency'))),
      order_count: Math.max(0, Number.parseInt(valueOf(row, 'order_count') || '0', 10) || 0),
      source_created_at: dateToIso(valueOf(row, 'created_at')), source_updated_at: dateToIso(valueOf(row, 'updated_at')),
      metadata: rawMetadata(row),
    },
  };
}

function normalizeOrder(row) {
  const externalId = idValue(row, ['order_id', 'external_id']);
  const currency = currencyFrom(valueOf(row, 'total'), valueOf(row, 'currency'));
  const total = spiffyMinor(valueOf(row, 'total'), currency);
  return {
    table: 'pay_orders',
    row: {
      provider: 'spiffy', external_id: externalId, status: statusValue(valueOf(row, 'status')),
      currency, subtotal_minor: spiffyMinor(valueOf(row, 'subtotal') || valueOf(row, 'total'), currency),
      discount_minor: Math.abs(spiffyMinor(valueOf(row, 'discount'), currency)),
      finance_fee_minor: Math.abs(spiffyMinor(valueOf(row, 'finance_fee'), currency)), tax_minor: Math.abs(spiffyMinor(valueOf(row, 'tax'), currency)),
      total_minor: Math.max(0, total), refunded_minor: Math.abs(spiffyMinor(valueOf(row, 'refunded'), currency)), promo_code: valueOf(row, 'promo_code') || null,
      source_created_at: dateToIso(valueOf(row, 'created_at')), source_updated_at: dateToIso(valueOf(row, 'updated_at')),
      metadata: { ...rawMetadata(row), customer_external_id: idValue(row, ['customer_id']), customer_email: valueOf(row, 'email').toLowerCase() || null, product_name: valueOf(row, 'product') || null },
    },
  };
}

function normalizePayment(row) {
  const gateway = normalizeHeader(valueOf(row, 'gateway'));
  const provider = gateway === 'stripe' ? 'stripe' : gateway === 'paypal' ? 'paypal' : 'spiffy';
  const externalId = provider === 'stripe'
    ? idValue(row, ['stripe_payment_intent_id', 'stripe_charge_id', 'payment_id'])
    : provider === 'paypal'
      ? idValue(row, ['paypal_capture_id', 'paypal_order_id', 'payment_id'])
      : idValue(row, ['payment_id', 'external_id']);
  const currency = currencyFrom(valueOf(row, 'total'), valueOf(row, 'currency'));
  const method = valueOf(row, 'payment_method');
  return {
    table: 'pay_payments',
    row: {
      provider, external_id: externalId, status: statusValue(valueOf(row, 'status')),
      currency, amount_minor: Math.abs(spiffyMinor(valueOf(row, 'total'), currency)), refunded_minor: Math.abs(spiffyMinor(valueOf(row, 'refunded'), currency)),
      fee_minor: valueOf(row, 'fee') ? Math.abs(spiffyMinor(valueOf(row, 'fee'), currency)) : null,
      net_minor: valueOf(row, 'net') ? spiffyMinor(valueOf(row, 'net'), currency) : null,
      payment_method_type: gateway || method || null, payment_method_brand: valueOf(row, 'card_type') || null,
      payment_method_last4: valueOf(row, 'last_four') || null, description: valueOf(row, 'description') || valueOf(row, 'product') || null,
      paid_at: dateToIso(valueOf(row, 'paid_at') || valueOf(row, 'created_at')), source_created_at: dateToIso(valueOf(row, 'created_at')),
      source_updated_at: dateToIso(valueOf(row, 'updated_at')),
      metadata: { ...rawMetadata(row), spiffy_payment_id: idValue(row, ['payment_id']), order_external_id: idValue(row, ['order_id']), customer_external_id: idValue(row, ['customer_id']), customer_email: valueOf(row, 'email').toLowerCase() || null },
    },
  };
}

function normalizePlan(row) {
  const externalId = idValue(row, ['plan_id', 'external_id']);
  const currency = currencyFrom(valueOf(row, 'installment_amount'), valueOf(row, 'currency'));
  const installmentAmount = Math.abs(spiffyMinor(valueOf(row, 'installment_amount'), currency));
  const totalDue = Math.abs(spiffyMinor(valueOf(row, 'total_due'), currency));
  const totalPaid = Math.abs(spiffyMinor(valueOf(row, 'total_paid'), currency));
  const explicitCount = Number.parseInt(valueOf(row, 'installment_count'), 10) || null;
  const installmentCount = explicitCount || (installmentAmount > 0 && totalDue > 0 ? Math.ceil(totalDue / installmentAmount) : null);
  const explicitPaid = Number.parseInt(valueOf(row, 'installments_paid'), 10);
  const installmentsPaid = Number.isFinite(explicitPaid) ? explicitPaid : (installmentAmount > 0 ? Math.floor(totalPaid / installmentAmount) : 0);
  const remaining = valueOf(row, 'remaining')
    ? Math.abs(spiffyMinor(valueOf(row, 'remaining'), currency))
    : Math.max(0, totalDue - totalPaid);
  const frequency = normalizeHeader(valueOf(row, 'frequency')) || 'month';
  const intervalUnit = /day|jour/.test(frequency) ? 'day' : /week|semaine/.test(frequency) ? 'week' : /year|an/.test(frequency) ? 'year' : 'month';
  const intervalCount = Math.max(1, Number.parseInt(valueOf(row, 'frequency_count') || '1', 10) || 1);
  return {
    table: 'pay_payment_plans',
    row: {
      provider: 'spiffy', external_id: externalId, status: planStatusValue(valueOf(row, 'status')), currency,
      installment_amount_minor: installmentAmount, installment_count: installmentCount,
      installments_paid: Math.max(0, installmentsPaid), remaining_minor: remaining, started_at: dateToIso(valueOf(row, 'started_at')),
      interval_unit: intervalUnit, interval_count: intervalCount,
      next_payment_at: dateToIso(valueOf(row, 'next_payment_at')), source_created_at: dateToIso(valueOf(row, 'created_at')),
      source_updated_at: dateToIso(valueOf(row, 'updated_at')),
      metadata: { ...rawMetadata(row), order_external_id: idValue(row, ['order_id']), customer_external_id: idValue(row, ['customer_id']), customer_email: valueOf(row, 'email').toLowerCase() || null, product_name: valueOf(row, 'product') || null },
    },
  };
}

function normalizeCheckout(row) {
  const name = valueOf(row, 'checkout_name') || valueOf(row, 'product') || 'Checkout Spiffy';
  return {
    table: 'pay_checkouts',
    row: {
      provider: 'spiffy', external_id: idValue(row, ['checkout_id', 'external_id']) || normalizeHeader(name).replace(/\s+/g, '-'),
      name, public_url: valueOf(row, 'checkout_url') || null, status: statusValue(valueOf(row, 'status'), 'active') === 'cancelled' ? 'archived' : 'active',
      source_created_at: dateToIso(valueOf(row, 'created_at')), source_updated_at: dateToIso(valueOf(row, 'updated_at')), metadata: rawMetadata(row),
    },
  };
}

const NORMALIZERS = { customers: normalizeCustomer, orders: normalizeOrder, payments: normalizePayment, payment_plans: normalizePlan, checkouts: normalizeCheckout };

export function normalizeSpiffyExport(csv, options = {}) {
  const rows = parseCsv(csv);
  const type = options.type || detectSpiffyExportType(rows);
  const normalizer = NORMALIZERS[type];
  if (!normalizer) throw new Error('spiffy_export_type_invalid');
  const normalized = [];
  const anomalies = [];
  const seen = new Set();
  for (const source of rows) {
    const item = normalizer(source);
    const id = cleanText(item?.row?.external_id, 255);
    if (!id) {
      anomalies.push({ row: source._row, code: 'missing_external_id' });
      continue;
    }
    const key = `${item.table}:${id}`;
    if (seen.has(key)) {
      anomalies.push({ row: source._row, code: 'duplicate_external_id', external_id: id });
      continue;
    }
    seen.add(key);
    normalized.push(item);
    if (!item.row.source_created_at && type !== 'checkouts') anomalies.push({ row: source._row, code: 'missing_or_invalid_date', external_id: id });
  }
  const canonical = JSON.stringify(normalized.map(({ table, row }) => ({ table, row })));
  return {
    mode: 'dry_run', type, rows_seen: rows.length, rows_valid: normalized.length, rows_skipped: rows.length - normalized.length,
    anomalies, checksum: crypto.createHash('sha256').update(canonical).digest('hex'), normalized,
  };
}

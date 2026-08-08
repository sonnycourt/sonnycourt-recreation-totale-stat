import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getPayPalResourcePage,
  getPayPalResources,
  normalizePayPalInvoice,
  normalizePayPalPlan,
  normalizePayPalSubscription,
} from '../netlify/functions/lib/pay-paypal-resources.mjs';

const calls = [];
const getImpl = async (path, parameters) => {
  calls.push({ path, parameters: Object.fromEntries(parameters) });
  if (path === '/v1/catalogs/products') return {
    products: [{ id: 'PROD-1', name: 'Programme PayPal', type: 'SERVICE', create_time: '2026-01-01T00:00:00Z' }],
    total_items: '1', total_pages: '1',
  };
  if (path === '/v1/billing/plans') return {
    plans: [{ id: 'PLAN-1', product_id: 'PROD-1', name: 'Plan 12 mois', status: 'ACTIVE' }],
    total_items: 1, total_pages: 1,
  };
  if (path === '/v1/billing/plans/PLAN-1') return {
    id: 'PLAN-1', product_id: 'PROD-1', name: 'Plan 12 mois', status: 'ACTIVE',
    billing_cycles: [{
      tenure_type: 'REGULAR', sequence: 1, total_cycles: 12,
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      pricing_scheme: { fixed_price: { value: '197.00', currency_code: 'EUR' } },
    }],
    payment_preferences: { setup_fee: { value: '47.00', currency_code: 'EUR' }, payment_failure_threshold: 3 },
    create_time: '2026-01-01T00:00:00Z', update_time: '2026-01-02T00:00:00Z',
  };
  if (path === '/v1/billing/subscriptions') return {
    subscriptions: [{
      id: 'SUB-1', plan_id: 'PLAN-1', status: 'ACTIVE', quantity: '1',
      subscriber: { email_address: 'CLIENT@EXAMPLE.TEST', name: { given_name: 'Test', surname: 'Client' } },
      shipping_address: { address: { country_code: 'CH' } },
      billing_info: {
        next_billing_time: '2026-09-01T00:00:00Z', failed_payments_count: 1,
        last_payment: { amount: { value: '197.00', currency_code: 'EUR' }, time: '2026-08-01T00:00:00Z' },
        cycle_executions: [{ tenure_type: 'REGULAR', sequence: 1, cycles_completed: 3, cycles_remaining: 9 }],
      },
      create_time: '2026-06-01T00:00:00Z', update_time: '2026-08-01T00:00:00Z',
    }],
    total_items: 1, total_pages: 1,
  };
  if (path === '/v2/invoicing/invoices') return {
    items: [{
      id: 'INV-1', status: 'SENT', amount: { value: '97.00', currency_code: 'EUR' },
      due_amount: { value: '97.00', currency_code: 'EUR' },
      detail: { invoice_number: '2026-001', invoice_date: '2026-08-01', due_date: '2026-08-15', currency_code: 'EUR' },
      primary_recipients: [{ billing_info: { email_address: 'invoice@example.test', name: { given_name: 'Invoice', surname: 'Test' } } }],
    }],
    total_items: 1, total_pages: 1,
  };
  throw new Error(`unexpected_path:${path}`);
};

const products = await getPayPalResourcePage('products', { getImpl });
assert.equal(products.data[0].name, 'Programme PayPal');
assert.equal(products.has_more, false);

const plans = await getPayPalResourcePage('plans', { getImpl });
assert.equal(plans.data[0].billing_type, 'installment');
assert.equal(plans.data[0].installment_count, 12);
assert.equal(plans.data[0].unit_amount_minor, 19_700);
assert.equal(plans.data[0].setup_fee_minor, 4_700);
assert.equal(plans.data[0].interval_unit, 'month');
assert.ok(calls.some((call) => call.path === '/v1/billing/plans/PLAN-1'));

const subscriptions = await getPayPalResourcePage('subscriptions', { getImpl });
assert.equal(subscriptions.data[0].subscriber.email_address, 'client@example.test');
assert.equal(subscriptions.data[0].next_billing_time, '2026-09-01T00:00:00Z');
assert.equal(subscriptions.data[0].cycle_executions[0].cycles_completed, 3);
assert.equal(subscriptions.data[0].shipping_address.country_code, 'CH');

const invoices = await getPayPalResourcePage('invoices', { getImpl });
assert.equal(invoices.data[0].invoice_number, '2026-001');
assert.equal(invoices.data[0].due_amount.minor, 9_700);

let pageCalls = 0;
const all = await getPayPalResources('products', {
  maxPages: 3,
  fetchPage: async (resource, options) => {
    pageCalls += 1;
    return { resource, data: [{ id: `PROD-${options.page}`, name: `Produit ${options.page}` }], has_more: options.page < 2, total_items: 2 };
  },
});
assert.equal(pageCalls, 2);
assert.equal(all.data.length, 2);
assert.equal(all.truncated, false);

const normalizedPlan = normalizePayPalPlan({
  id: 'PLAN-REC', status: 'ACTIVE',
  billing_cycles: [{ tenure_type: 'REGULAR', total_cycles: 0, frequency: { interval_unit: 'YEAR', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '1000', currency_code: 'JPY' } } }],
});
assert.equal(normalizedPlan.billing_type, 'recurring');
assert.equal(normalizedPlan.unit_amount_minor, 1000);

assert.equal(normalizePayPalSubscription({ id: 'SUB-X' }).id, 'SUB-X');
assert.equal(normalizePayPalInvoice({ id: 'INV-X' }).id, 'INV-X');
await assert.rejects(() => getPayPalResourcePage('refunds', { getImpl }), /paypal_resource_invalid/);

const source = await readFile(new URL('../netlify/functions/lib/pay-paypal-resources.mjs', import.meta.url), 'utf8');
assert.equal(source.includes('paypalRequest'), false);
assert.equal(/method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/.test(source), false);

console.log(JSON.stringify({
  products_read: 'ok',
  plans_read_and_expanded: 'ok',
  subscriptions_read: 'ok',
  invoices_read: 'ok',
  pagination_guard: 'ok',
  read_only_contract: 'ok',
}, null, 2));

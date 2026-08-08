import assert from 'node:assert/strict';
import { detectDelimiter, moneyToMinor, normalizeSpiffyExport, parseCsv, spiffyMinor } from './lib/pay-spiffy-import.mjs';

assert.equal(detectDelimiter('Order ID;Total;Date Created\n1;47,00 €;08/08/2026'), ';');
assert.equal(moneyToMinor('1 164,00 €', 'EUR'), 116400);
assert.equal(moneyToMinor('€1,164.00', 'EUR'), 116400);
assert.equal(moneyToMinor('€394', 'EUR'), 39400);
assert.equal(spiffyMinor('9700', 'EUR'), 9700);
assert.equal(spiffyMinor('9700.00000000', 'EUR'), 9700);
assert.equal(parseCsv('id,name\n1,"Court, Sonny"')[0].name, 'Court, Sonny');

const orders = normalizeSpiffyExport(`Order ID;Customer Email;Product;Date Created;Status;Total;Promo Code
2475427;cedric@example.com;ES2.0 - STANDARD (12 mensualités);08/08/2026 09:26;Succeeded;1 164,00 €;
2456699;nadia@example.com;FORMATION - Manifest;19/07/2026 21:51;Refunded;394,00 €;OFFRE50POURCENT`);

assert.equal(orders.type, 'orders');
assert.equal(orders.rows_seen, 2);
assert.equal(orders.rows_valid, 2);
assert.equal(orders.normalized[0].table, 'pay_orders');
assert.equal(orders.normalized[0].row.external_id, '2475427');
assert.equal(orders.normalized[0].row.total_minor, 116400);
assert.equal(orders.normalized[1].row.status, 'refunded');
assert.equal(orders.normalized[1].row.promo_code, 'OFFRE50POURCENT');
assert.match(orders.checksum, /^[a-f0-9]{64}$/);

const plans = normalizeSpiffyExport(`Payment Plan ID,Customer Email,Product,Start Date,Next Payment Date,Status,Payment Amount,Number of Payments,Payments Made,Remaining Balance
plan_1,julie@example.com,ES2.0,2026-01-01,2026-09-01,Active,€197.00,12,8,€788.00
plan_2,marie@example.com,ES2.0,2026-01-01,2026-08-01,past_due,€197.00,12,4,157600
plan_3,lea@example.com,ES2.0,2026-01-01,2026-08-01,unpaid,€197.00,12,2,197000`);
assert.equal(plans.type, 'payment_plans');
assert.equal(plans.normalized[0].row.installment_count, 12);
assert.equal(plans.normalized[0].row.remaining_minor, 78800);
assert.equal(plans.normalized[0].row.interval_unit, 'month');
assert.equal(plans.normalized[0].row.interval_count, 1);
assert.equal(plans.normalized[1].row.status, 'past_due');
assert.equal(plans.normalized[2].row.status, 'unpaid');

const rawPayments = normalizeSpiffyExport(`Payment Id,Order Id,Email,Status,Amount,Amount Refunded,Currency,Gateway,Paid At,Created At
4706806,2475427,cedric@example.com,succeeded,9700,0,eur,stripe,2026-08-07 09:26:24,2026-08-07 09:26:24`, { type: 'payments' });
assert.equal(rawPayments.normalized[0].row.external_id, '4706806');
assert.equal(rawPayments.normalized[0].row.provider, 'stripe');
assert.equal(rawPayments.normalized[0].row.amount_minor, 9700);

const providerPayments = normalizeSpiffyExport(`Payment Id,Order Id,Stripe Paymentintent Id,Paypal Capture Id,Status,Amount,Currency,Gateway,Created At
1,10,pi_live_1,,succeeded,4700,eur,stripe,2026-08-07 09:26:24
2,11,,CAPTURE123,succeeded,5300,eur,paypal,2026-08-07 09:27:24`, { type: 'payments' });
assert.equal(providerPayments.normalized[0].row.external_id, 'pi_live_1');
assert.equal(providerPayments.normalized[1].row.provider, 'paypal');
assert.equal(providerPayments.normalized[1].row.external_id, 'CAPTURE123');

const duplicate = normalizeSpiffyExport('Order ID,Product,Date Created,Total\n1,A,2026-01-01,10\n1,A,2026-01-01,10');
assert.equal(duplicate.rows_valid, 1);
assert.equal(duplicate.rows_skipped, 1);
assert.equal(duplicate.anomalies[0].code, 'duplicate_external_id');

console.log(JSON.stringify({ csv_parser: 'ok', money: 'ok', normalization: 'ok', duplicate_guard: 'ok' }, null, 2));

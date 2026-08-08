import assert from 'node:assert/strict';
import { collectPaySources, requirePaySource } from '../src/scripts/pay-source-results.js';

let result = await collectPaySources({
  stripe: Promise.resolve(['pi_1']),
  paypal: Promise.resolve(['capture_1']),
});
assert.deepEqual(result.available, ['stripe', 'paypal']);
assert.deepEqual(result.unavailable, []);
assert.deepEqual(result.values, { stripe: ['pi_1'], paypal: ['capture_1'] });

result = await collectPaySources({
  stripe: Promise.reject(new Error('stripe_down')),
  paypal: Promise.resolve(['capture_2']),
});
assert.deepEqual(result.available, ['paypal']);
assert.deepEqual(result.unavailable, ['stripe']);
assert.equal(result.values.stripe, null);
assert.deepEqual(requirePaySource(result).values.paypal, ['capture_2']);

result = await collectPaySources({
  stripe: Promise.reject(new Error('stripe_down')),
  paypal: Promise.reject(new Error('paypal_down')),
});
assert.deepEqual(result.available, []);
assert.throws(() => requirePaySource(result, 'pay_resource_sources_unavailable'), /pay_resource_sources_unavailable/);

console.log(JSON.stringify({ independent_sources: 'ok', partial_outage: 'ok', total_outage: 'ok' }, null, 2));

import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpiffyExport } from './lib/pay-spiffy-import.mjs';
import { buildSpiffyParity, compareSpiffyParity } from './lib/pay-spiffy-parity.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

function load(name, type) {
  const file = option(`--${name}`);
  if (!file) throw new Error(`missing_${name}_export`);
  return normalizeSpiffyExport(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'), { type });
}

const snapshotFile = option('--snapshot');
if (!snapshotFile) throw new Error('missing_snapshot');
const snapshot = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), snapshotFile), 'utf8'));
const inputs = {
  orders: load('orders', 'orders'),
  customers: load('customers', 'customers'),
  plans: load('plans', 'payment_plans'),
  payments: load('payments', 'payments'),
};
const actual = buildSpiffyParity(inputs, snapshot);
const comparison = compareSpiffyParity(actual, snapshot.expected);
const report = {
  mode: 'read_only_parity',
  snapshot: snapshot.name,
  generated_at: new Date().toISOString(),
  passed: comparison.passed,
  checks: comparison.checks.length,
  mismatches: comparison.mismatches,
  actual,
};

console.log(JSON.stringify(report, null, 2));
if (!comparison.passed) process.exitCode = 1;

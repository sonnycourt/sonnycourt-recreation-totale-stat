import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpiffyExport } from './lib/pay-spiffy-import.mjs';

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

if (!input) {
  console.error('Usage: npm run pay:spiffy:dry-run -- export.csv [--type orders|customers|payments|payment_plans|checkouts] [--out normalized.json]');
  process.exit(1);
}

if (args.includes('--apply') || args.includes('--write')) {
  console.error('Import refusé : cet outil est volontairement limité au dry-run et ne possède aucun chemin d’écriture Supabase.');
  process.exit(2);
}

const sourcePath = path.resolve(process.cwd(), input);
const source = fs.readFileSync(sourcePath, 'utf8');
const report = normalizeSpiffyExport(source, { type: option('--type') || undefined });
const outputPath = option('--out');
if (outputPath) fs.writeFileSync(path.resolve(process.cwd(), outputPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });

console.log(JSON.stringify({
  mode: report.mode,
  type: report.type,
  rows_seen: report.rows_seen,
  rows_valid: report.rows_valid,
  rows_skipped: report.rows_skipped,
  anomaly_count: report.anomalies.length,
  checksum: report.checksum,
  output: outputPath || null,
}, null, 2));

if (report.anomalies.length) console.log(JSON.stringify({ anomalies: report.anomalies.slice(0, 50) }, null, 2));

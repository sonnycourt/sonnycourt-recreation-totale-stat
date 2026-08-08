import {
  runPayPalBackfillDryRun,
  runStripeBackfillDryRun,
} from '../netlify/functions/lib/pay-backfill-dry-run.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

if (args.includes('--apply') || args.includes('--write')) {
  console.error('Backfill refusé : cet outil est strictement limité au dry-run et ne possède aucun chemin d’écriture Supabase.');
  process.exit(2);
}

const provider = option('--provider') || 'both';
if (!['stripe', 'paypal', 'both'].includes(provider)) {
  console.error('Usage: npm run pay:backfill:dry-run -- --provider stripe|paypal|both [--from ISO] [--to ISO] [--max-pages 1000]');
  process.exit(1);
}

const start = option('--from');
const end = option('--to') || new Date().toISOString();
if (!start) {
  console.error('La date --from est obligatoire afin de borner explicitement la lecture historique.');
  process.exit(1);
}

const reports = {};
if (provider === 'stripe' || provider === 'both') {
  reports.stripe = await runStripeBackfillDryRun({ start, end, maxPages: Number(option('--max-pages') || 1_000) });
}
if (provider === 'paypal' || provider === 'both') {
  reports.paypal = await runPayPalBackfillDryRun({ start, end });
}

console.log(JSON.stringify({ mode: 'dry_run', provider, range: { start, end }, reports }, null, 2));
if (Object.values(reports).some((report) => !report.ready)) process.exitCode = 3;

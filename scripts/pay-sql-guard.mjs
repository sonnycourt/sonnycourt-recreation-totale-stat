import fs from 'node:fs';
import path from 'node:path';

const sqlPath = path.resolve(process.cwd(), process.argv[2] || 'sql/pay_core.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const normalized = sql
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .toLowerCase();

const forbidden = [
  /\bdrop\s+(table|schema|column|constraint|function|view|index)\b/,
  /\btruncate\b/,
  /\bdelete\s+from\b/,
  /\balter\s+table\s+(?!public\.pay_)/,
  /(?:^|;)\s*update\s+(?!public\.pay_)/,
  /(?:^|;)\s*insert\s+into\s+(?!public\.pay_)/,
  /\bon\s+delete\s+(cascade|set\s+null|set\s+default)\b/,
  /\bgrant\s+delete\b/,
  /\bgrant\s+truncate\b/,
];

for (const rule of forbidden) {
  if (rule.test(normalized)) {
    console.error(`Migration Pay refusée par le garde-fou: ${rule}`);
    process.exit(1);
  }
}

const tables = [...normalized.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/g)]
  .map((match) => match[1]);
if (!tables.length || tables.some((table) => !table.startsWith('pay_'))) {
  console.error('Migration Pay refusée: toutes les nouvelles tables doivent être préfixées pay_.');
  process.exit(1);
}

console.log(`Migration Pay additive validée: ${tables.length} tables pay_ et aucune opération destructive.`);

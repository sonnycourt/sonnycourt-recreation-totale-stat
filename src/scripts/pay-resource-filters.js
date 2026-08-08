const OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with', 'not_contains']);

function text(value) {
  return String(value ?? '').trim().toLocaleLowerCase('fr');
}

export function normalizeResourceFilter(value, columnCount = 0) {
  const column = Number.parseInt(value?.column, 10);
  return {
    column: Number.isInteger(column) && column >= 0 && column < columnCount ? column : 0,
    operator: OPERATORS.has(value?.operator) ? value.operator : 'contains',
    value: String(value?.value ?? '').trim(),
  };
}

export function matchesResourceFilter(row, rawFilter, columnCount = row?.plain?.length || 0) {
  const filter = normalizeResourceFilter(rawFilter, columnCount);
  if (!filter.value) return true;
  const haystack = text(row?.plain?.[filter.column]);
  const needle = text(filter.value);
  if (filter.operator === 'equals') return haystack === needle;
  if (filter.operator === 'starts_with') return haystack.startsWith(needle);
  if (filter.operator === 'ends_with') return haystack.endsWith(needle);
  if (filter.operator === 'not_contains') return !haystack.includes(needle);
  return haystack.includes(needle);
}

export function normalizeResourceView(value, columnCount = 0) {
  const provider = ['all', 'stripe', 'paypal', 'spiffy', 'internal'].includes(value?.provider) ? value.provider : 'all';
  return {
    id: String(value?.id || ''),
    name: String(value?.name || '').trim().slice(0, 60),
    query: String(value?.query || '').trim().slice(0, 160),
    provider,
    status: String(value?.status || 'all').trim().toLowerCase() || 'all',
    advanced: normalizeResourceFilter(value?.advanced, columnCount),
  };
}

export function normalizeSavedResourceViews(value, columnCount = 0) {
  if (!Array.isArray(value)) return [];
  return value.map((view) => normalizeResourceView(view, columnCount)).filter((view) => view.id && view.name).slice(0, 30);
}

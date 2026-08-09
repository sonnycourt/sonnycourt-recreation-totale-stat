const PAGE_SIZES = Object.freeze([25, 50, 100]);

function integer(value, fallback = 1) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function normalizePayPageSize(value, fallback = PAGE_SIZES[0]) {
  const parsed = integer(value, fallback);
  return PAGE_SIZES.includes(parsed) ? parsed : fallback;
}

export function payPageCount(total, pageSize) {
  const normalizedTotal = Math.max(0, integer(total, 0));
  const normalizedSize = normalizePayPageSize(pageSize);
  return Math.max(1, Math.ceil(normalizedTotal / normalizedSize));
}

export function clampPayPage(page, total, pageSize) {
  return Math.min(Math.max(1, integer(page, 1)), payPageCount(total, pageSize));
}

export function payPageItems(items, page, pageSize) {
  const rows = Array.isArray(items) ? items : [];
  const normalizedSize = normalizePayPageSize(pageSize);
  const normalizedPage = clampPayPage(page, rows.length, normalizedSize);
  const start = (normalizedPage - 1) * normalizedSize;
  const end = Math.min(rows.length, start + normalizedSize);
  return {
    items: rows.slice(start, end),
    page: normalizedPage,
    pageSize: normalizedSize,
    pageCount: payPageCount(rows.length, normalizedSize),
    total: rows.length,
    start: rows.length ? start + 1 : 0,
    end,
  };
}

export function payPageButtons(page, pageCount) {
  const last = Math.max(1, integer(pageCount, 1));
  const current = Math.min(Math.max(1, integer(page, 1)), last);
  const candidates = new Set([1, last, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((value) => candidates.add(value));
  if (current >= last - 2) [last - 3, last - 2, last - 1].forEach((value) => candidates.add(value));
  const pages = [...candidates].filter((value) => value >= 1 && value <= last).sort((a, b) => a - b);
  const result = [];
  pages.forEach((value, index) => {
    if (index && value - pages[index - 1] > 1) result.push('ellipsis');
    result.push(value);
  });
  return result;
}

export { PAGE_SIZES as PAY_RESOURCE_PAGE_SIZES };

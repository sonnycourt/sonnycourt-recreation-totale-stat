const CONFIG = Object.freeze({
  checkouts: { storageKey: 'pay_checkout_drafts', path: '/pay/checkouts/new', limit: 20 },
  products: { storageKey: 'pay_product_drafts', path: '/pay/products/new', limit: 50 },
  discounts: { storageKey: 'pay_discount_drafts', path: '/pay/discounts/new', limit: 50 },
});

function config(kind) {
  const value = CONFIG[String(kind || '')];
  if (!value) throw new Error('pay_draft_kind_invalid');
  return value;
}

function cleanId(value) {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) throw new Error('pay_draft_id_invalid');
  return id;
}

export function readPayDrafts(storage, kind) {
  const { storageKey, limit } = config(kind);
  if (!storage?.getItem) return [];
  try {
    const rows = JSON.parse(storage.getItem(storageKey) || '[]');
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    return rows.filter((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const id = String(row.id ?? '').trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, limit);
  } catch {
    return [];
  }
}

export function findPayDraft(storage, kind, idValue) {
  const id = cleanId(idValue);
  return readPayDrafts(storage, kind).find((row) => String(row.id) === id) || null;
}

export function upsertPayDraft(storage, kind, draft) {
  const { storageKey, limit } = config(kind);
  if (!storage?.setItem || !draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('pay_draft_invalid');
  const id = cleanId(draft.id);
  const rows = [{ ...draft, id: draft.id }, ...readPayDrafts(storage, kind).filter((row) => String(row.id) !== id)].slice(0, limit);
  storage.setItem(storageKey, JSON.stringify(rows));
  return rows;
}

export function removePayDraft(storage, kind, idValue) {
  const { storageKey } = config(kind);
  if (!storage?.setItem) throw new Error('pay_draft_storage_invalid');
  const id = cleanId(idValue);
  const before = readPayDrafts(storage, kind);
  const rows = before.filter((row) => String(row.id) !== id);
  if (rows.length === before.length) return { removed: false, rows };
  storage.setItem(storageKey, JSON.stringify(rows));
  return { removed: true, rows };
}

export function payDraftEditUrl(kind, idValue, { preview = false } = {}) {
  const { path } = config(kind);
  const query = new URLSearchParams({ draft: cleanId(idValue) });
  if (preview) query.set('preview', '1');
  return `${path}?${query}`;
}

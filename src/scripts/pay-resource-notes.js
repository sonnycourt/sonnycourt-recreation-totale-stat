const MAX_NOTES_PER_ENTITY = 50;
const MAX_NOTE_LENGTH = 600;

function clean(value, max = MAX_NOTE_LENGTH) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeCreatedAt(value) {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function normalizeNote(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = clean(String(value.id || ''), 80);
  const body = clean(value.body);
  if (!id || !body) return null;
  return { id, body, createdAt: safeCreatedAt(value.createdAt) };
}

export function normalizePayNotesStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, notes]) => {
    if (!/^[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]{8}$/.test(key) || !Array.isArray(notes)) return [];
    const normalized = notes.map(normalizeNote).filter(Boolean).slice(0, MAX_NOTES_PER_ENTITY);
    return normalized.length ? [[key, normalized]] : [];
  }));
}

export function payNotesEntityKey(screen, provider, values = []) {
  const prefix = `${clean(screen, 40).toLowerCase()}:${clean(provider, 30).toLowerCase()}`;
  const identity = `${prefix}:${(Array.isArray(values) ? values : []).slice(0, 3).map((value) => clean(String(value ?? ''), 250).toLowerCase()).join('|')}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function addPayNote(store, entityKey, body, options = {}) {
  const normalized = normalizePayNotesStore(store);
  const text = clean(body);
  if (!text || !entityKey) return normalized;
  const note = {
    id: clean(String(options.id || Date.now()), 80),
    body: text,
    createdAt: safeCreatedAt(options.createdAt || new Date()),
  };
  return { ...normalized, [entityKey]: [note, ...(normalized[entityKey] || [])].slice(0, MAX_NOTES_PER_ENTITY) };
}

export function removePayNote(store, entityKey, noteId) {
  const normalized = normalizePayNotesStore(store);
  if (!normalized[entityKey]) return normalized;
  const notes = normalized[entityKey].filter((note) => note.id !== String(noteId));
  if (!notes.length) {
    const { [entityKey]: removed, ...rest } = normalized;
    return rest;
  }
  return { ...normalized, [entityKey]: notes };
}


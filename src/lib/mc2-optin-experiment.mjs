// Version the key when starting a different experiment. The random UUID is also
// the first-party funnel ID: the existing unique index counts each browser once.
const KEY = 'mc2_meta_affirmations_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assignMc2MetaOptin(win, doc, freshId) {
  function readCookie() {
    return doc.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(KEY + '='))?.slice(KEY.length + 1);
  }
  let id;
  try { id = win.localStorage.getItem(KEY); } catch {}
  if (!UUID.test(id || '')) {
    try { id = readCookie(); } catch {}
  }
  if (!UUID.test(id || '')) {
    id = freshId;
    let saved = false;
    try {
      win.localStorage.setItem(KEY, id);
      saved = win.localStorage.getItem(KEY) === id;
    } catch {}
    if (!saved) {
      try {
        doc.cookie = KEY + '=' + id + '; Path=/meta/mc2; Max-Age=15552000; SameSite=Lax' + (win.location.protocol === 'https:' ? '; Secure' : '');
        saved = readCookie() === id;
      } catch {}
    }
    if (!saved) return null;
  }
  // The first nibble of a v4 UUID is uniform, unlike the version nibble.
  const arm = parseInt(id[0], 16) < 8 ? 'a' : 'b';
  return { id, arm, variant: KEY + '_' + arm };
}

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet, supabasePost, supabasePatch, supabaseDelete } from './lib/supabase-rest.mjs';

const RICH_PAYS = ['France', 'Belgique', 'Suisse', 'Luxembourg', 'Monaco', 'Canada'];

// Alphabet sans ambiguïté (pas de I, L, O, 0, 1)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Code lisible et non devinable : CLZ-XXXX-XXXX (8 chars aléatoires, ~40 bits). */
function genCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `CLZ-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Réservé à l'admin (même session que le cockpit ES2)
  const session = getSessionFromRequest(req);
  if (!session) return json(401, { error: 'Non autorisé' });

  if (req.method === 'GET') {
    const resource = new URL(req.url).searchParams.get('resource');

    if (resource === 'candidatures') {
      const r = await supabaseGet('closer_candidatures?select=*&order=created_at.desc');
      if (!r.ok) {
        return json(500, { error: 'Table absente ? Exécute sql/closer_candidatures.sql une fois.' });
      }
      return json(200, { candidatures: Array.isArray(r.data) ? r.data : [] });
    }

    const r = await supabaseGet(
      'closer_access_codes?select=id,label,email,code,active,visit_count,first_visit_at,last_visit_at,consent_at,notes,created_at,phone_1,phone_2,checkout_full_url,checkout_discount_url&order=created_at.desc'
    );
    if (!r.ok) {
      return json(500, { error: 'Table absente ? Exécute sql/closer_access_codes.sql une fois.' });
    }
    return json(200, { codes: Array.isArray(r.data) ? r.data : [] });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Requête invalide' });
    }
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'create') {
      const label = (typeof body.label === 'string' ? body.label : '').trim().slice(0, 120);
      const notes = (typeof body.notes === 'string' ? body.notes : '').trim().slice(0, 2000);
      if (!label) return json(400, { error: 'Nom (label) requis' });

      // Génère un code unique (retry en cas de collision sur la contrainte unique)
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = genCode();
        const post = await supabasePost('closer_access_codes', { label, code, notes: notes || null });
        if (post.ok) {
          const row = Array.isArray(post.data) ? post.data[0] : post.data;
          return json(200, { ok: true, row });
        }
        // 409 = conflit unique -> on retente avec un autre code
        if (post.status !== 409) {
          return json(500, { error: 'Création impossible', detail: post.error });
        }
      }
      return json(500, { error: 'Impossible de générer un code unique, réessaie.' });
    }

    if (action === 'code-notes') {
      const id = Number(body.id);
      const notes = (typeof body.notes === 'string' ? body.notes : '').trim().slice(0, 2000);
      if (!Number.isInteger(id)) return json(400, { error: 'id invalide' });
      const patch = await supabasePatch('closer_access_codes', `id=eq.${id}`, { notes: notes || null });
      if (!patch.ok) return json(500, { error: 'Mise à jour impossible' });
      return json(200, { ok: true });
    }

    if (action === 'revoke') {
      const id = Number(body.id);
      const active = body.active === true;
      if (!Number.isInteger(id)) return json(400, { error: 'id invalide' });
      const patch = await supabasePatch('closer_access_codes', `id=eq.${id}`, { active });
      if (!patch.ok) return json(500, { error: 'Mise à jour impossible' });
      return json(200, { ok: true });
    }

    if (action === 'cand-status') {
      const id = Number(body.id);
      const status = typeof body.status === 'string' ? body.status : '';
      const allowed = ['nouveau', 'top', 'plus_tard', 'poubelle'];
      if (!Number.isInteger(id) || !allowed.includes(status)) {
        return json(400, { error: 'Paramètres invalides' });
      }
      const patch = await supabasePatch('closer_candidatures', `id=eq.${id}`, { status });
      if (!patch.ok) return json(500, { error: 'Mise à jour impossible' });
      return json(200, { ok: true });
    }

    if (action === 'delete') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json(400, { error: 'id invalide' });
      // Détache les candidatures liées (elles conservent code_label/code en texte) pour ne pas les perdre
      await supabasePatch('closer_candidatures', `code_id=eq.${id}`, { code_id: null });
      const del = await supabaseDelete('closer_access_codes', `id=eq.${id}`);
      if (!del.ok) return json(500, { error: 'Suppression impossible', detail: del.error });
      return json(200, { ok: true });
    }

    // Répartit équitablement (round-robin) les leads qualifiés non assignés
    // entre les closers actifs.
    if (action === 'assign-split') {
      const minMin = Number.isFinite(Number(body.min_minutes))
        ? Math.max(0, Math.floor(Number(body.min_minutes)))
        : 81;
      const sd =
        typeof body.session_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.session_date)
          ? body.session_date
          : null;

      let q =
        'webinaire_registrations?assigned_closer_id=is.null' +
        '&telephone=not.is.null' +
        '&or=(purchased.is.null,purchased.is.false)' +
        '&select=token';
      if (minMin > 0) q += `&watch_max_minutes=gte.${minMin}`;
      if (sd) q += `&session_date=gte.${sd}T00:00:00&session_date=lt.${sd}T23:59:59`;

      const leadsRes = await supabaseGet(q);
      if (!leadsRes.ok) return json(500, { error: 'Lecture leads impossible', detail: leadsRes.error });
      const tokens = (Array.isArray(leadsRes.data) ? leadsRes.data : []).map((r) => r.token).filter(Boolean);

      const codesRes = await supabaseGet('closer_access_codes?active=eq.true&select=id,label&order=id.asc');
      const codes = codesRes.ok && Array.isArray(codesRes.data) ? codesRes.data : [];
      if (!codes.length) return json(400, { error: 'Aucun closer actif.' });

      const buckets = codes.map(() => []);
      tokens.forEach((t, i) => buckets[i % codes.length].push(t));

      const perCloser = [];
      for (let i = 0; i < codes.length; i++) {
        const bucket = buckets[i];
        for (let j = 0; j < bucket.length; j += 50) {
          const slice = bucket.slice(j, j + 50);
          const filter = `token=in.(${slice.map((t) => encodeURIComponent(t)).join(',')})`;
          const upd = await supabasePatch('webinaire_registrations', filter, { assigned_closer_id: codes[i].id });
          if (!upd.ok) return json(500, { error: 'Assignation impossible', detail: upd.error });
        }
        perCloser.push({ id: codes[i].id, label: codes[i].label, count: bucket.length });
      }
      return json(200, { ok: true, total: tokens.length, perCloser });
    }

    // Réinitialise toutes les assignations.
    if (action === 'unassign-all') {
      const upd = await supabasePatch('webinaire_registrations', 'assigned_closer_id=not.is.null', {
        assigned_closer_id: null,
      });
      if (!upd.ok) return json(500, { error: 'Réinitialisation impossible' });
      return json(200, { ok: true });
    }

    // --- Créer un closer avec identifiants (email + mot de passe) ---
    if (action === 'create-closer') {
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!label) return json(400, { error: 'Nom requis' });
      if (!email || !/.+@.+\..+/.test(email)) return json(400, { error: 'Email invalide' });
      if (!password || password.length < 6) return json(400, { error: 'Mot de passe (6 caractères min) requis' });
      const passwordHash = await bcrypt.hash(password, 12);
      for (let i = 0; i < 6; i++) {
        const code = genCode();
        const post = await supabasePost(
          'closer_access_codes',
          { label, email, password_hash: passwordHash, code, notes: body.notes || null },
          { prefer: 'return=representation' },
        );
        if (post.ok) return json(200, { ok: true, row: Array.isArray(post.data) ? post.data[0] : post.data });
        const e = typeof post.error === 'string' ? post.error : JSON.stringify(post.error || {});
        if (e.includes('email') || e.includes('duplicate') || post.status === 409) {
          return json(409, { error: 'Cet email est déjà utilisé' });
        }
      }
      return json(500, { error: 'Création impossible, réessaie.' });
    }

    // --- Mettre à jour les identifiants d'un closer ---
    if (action === 'set-credentials') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json(400, { error: 'id invalide' });
      const patch = {};
      if (typeof body.email === 'string' && body.email.trim()) {
        const e = body.email.trim().toLowerCase();
        if (!/.+@.+\..+/.test(e)) return json(400, { error: 'Email invalide' });
        patch.email = e;
      }
      if (typeof body.password === 'string' && body.password) {
        if (body.password.length < 6) return json(400, { error: 'Mot de passe trop court (6 min)' });
        patch.password_hash = await bcrypt.hash(body.password, 12);
      }
      // Coordonnées affichées au closer (vide = on efface). Présence de la clé = on enregistre.
      const isUrl = (s) => /^https?:\/\/.+/i.test(s);
      if (typeof body.phone_1 === 'string') patch.phone_1 = body.phone_1.trim() || null;
      if (typeof body.phone_2 === 'string') patch.phone_2 = body.phone_2.trim() || null;
      if (typeof body.checkout_full_url === 'string') {
        const v = body.checkout_full_url.trim();
        if (v && !isUrl(v)) return json(400, { error: 'Lien tarif complet invalide (doit commencer par http)' });
        patch.checkout_full_url = v || null;
      }
      if (typeof body.checkout_discount_url === 'string') {
        const v = body.checkout_discount_url.trim();
        if (v && !isUrl(v)) return json(400, { error: 'Lien -5% invalide (doit commencer par http)' });
        patch.checkout_discount_url = v || null;
      }
      if (Object.keys(patch).length === 0) return json(400, { error: 'Rien à modifier' });
      const upd = await supabasePatch('closer_access_codes', `id=eq.${id}`, patch);
      if (!upd.ok) return json(500, { error: 'Mise à jour impossible', detail: upd.error });
      return json(200, { ok: true });
    }

    // --- Liste des sessions (dates) ayant des inscrits pays riches ---
    if (action === 'sessions') {
      const r = await supabaseGet(
        'webinaire_registrations' +
          `?pays=in.(${RICH_PAYS.map(encodeURIComponent).join(',')})` +
          '&select=session_date&order=session_date.desc',
      );
      const rows = r.ok && Array.isArray(r.data) ? r.data : [];
      const counts = {};
      for (const row of rows) {
        if (!row.session_date) continue;
        const d = String(row.session_date).slice(0, 10); // YYYY-MM-DD
        counts[d] = (counts[d] || 0) + 1;
      }
      const sessions = Object.keys(counts)
        .sort((a, b) => (a < b ? 1 : -1)) // plus récent d'abord
        .map((d) => ({ date: d, count: counts[d] }));
      return json(200, { sessions });
    }

    // --- Stats de perf par closer (option : filtrées sur une session) ---
    if (action === 'stats') {
      const sd =
        typeof body.session_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.session_date)
          ? body.session_date
          : null;
      let q =
        'webinaire_registrations?assigned_closer_id=not.is.null' +
        '&select=assigned_closer_id,prenom,call_status,purchased,purchased_at,call_log';
      if (sd) q += `&session_date=gte.${sd}T00:00:00&session_date=lt.${sd}T23:59:59`;
      const r = await supabaseGet(q);
      const rows = r.ok && Array.isArray(r.data) ? r.data : [];

      // Un appel "réel" (le closer a vraiment parlé au prospect).
      const REAL = new Set([
        'À rappeler', 'En réflexion', 'Dit oui (verbal)', 'Pas intéressé', // nouveaux
        'Joint', 'Rappel demande', 'A dit OUI', 'Refus', // anciens (compat)
      ]);
      // Renvoie l'instant (ms) du dernier appel réel ANTÉRIEUR à l'achat, sinon null.
      const lastContactBefore = (log, purchasedAt) => {
        if (!Array.isArray(log)) return null;
        const pa = purchasedAt ? new Date(purchasedAt).getTime() : null;
        let last = null;
        for (const e of log) {
          if (!e || !REAL.has(e.outcome) || !e.at) continue;
          const t = new Date(e.at).getTime();
          if (Number.isNaN(t)) continue;
          if (pa == null || t < pa) last = last == null ? t : Math.max(last, t);
        }
        return last;
      };

      const map = {};
      const blank = () => ({ leads: 0, calls: 0, contacted: 0, a_traiter: 0, rappels: 0, reflexion: 0, oui: 0, refus: 0, ventes: 0, achats_seuls: 0 });
      const global = blank();
      const recredit = []; // ventes valides (appel réel avant l'achat) à recréditer dans Spiffy
      const bump = (m, row, valide, seul) => {
        const nCalls = Array.isArray(row.call_log) ? row.call_log.length : 0;
        m.leads += 1;
        m.calls += nCalls;
        if (nCalls > 0) m.contacted += 1; else m.a_traiter += 1;
        if (row.call_status === 'A rappeler') m.rappels += 1;
        if (row.call_status === 'En reflexion') m.reflexion += 1;
        if (row.call_status === 'Dit oui (verbal)') m.oui += 1;
        if (row.call_status === 'Refuse') m.refus += 1;
        if (valide) m.ventes += 1;
        if (seul) m.achats_seuls += 1;
      };
      for (const row of rows) {
        const c = row.assigned_closer_id;
        if (c == null) continue;
        let valide = false, seul = false;
        if (row.purchased) {
          const lc = lastContactBefore(row.call_log, row.purchased_at);
          if (lc != null) {
            valide = true;
            recredit.push({
              closer_id: c,
              prenom: row.prenom || 'Lead',
              purchased_at: row.purchased_at || null,
              last_contact_at: new Date(lc).toISOString(),
            });
          } else {
            seul = true;
          }
        }
        if (!map[c]) map[c] = blank();
        bump(map[c], row, valide, seul);
        bump(global, row, valide, seul);
      }
      return json(200, { stats: map, global, recredit });
    }

    // --- Pool de leads pour l'assignation (pays riches) ---
    if (action === 'leads-pool') {
      const sd =
        typeof body.session_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.session_date)
          ? body.session_date
          : null;
      let q =
        'webinaire_registrations?select=token,prenom,telephone,email,pays,watch_max_minutes,purchased,assigned_closer_id,call_status,traffic_source' +
        `&pays=in.(${RICH_PAYS.map(encodeURIComponent).join(',')})` +
        '&order=watch_max_minutes.desc.nullslast';
      if (sd) q += `&session_date=gte.${sd}T00:00:00&session_date=lt.${sd}T23:59:59`;
      const r = await supabaseGet(q);
      if (!r.ok) return json(500, { error: 'Lecture du pool impossible', detail: r.error });
      return json(200, { leads: Array.isArray(r.data) ? r.data : [] });
    }

    // --- Assigner (ou désassigner) des leads à un closer ---
    if (action === 'assign') {
      const closerId = body.closer_id === null ? null : Number(body.closer_id);
      const tokens = Array.isArray(body.tokens) ? body.tokens.filter((t) => typeof t === 'string' && t) : [];
      if (!tokens.length) return json(400, { error: 'Aucun lead sélectionné' });
      if (closerId !== null && !Number.isInteger(closerId)) return json(400, { error: 'Closer invalide' });
      for (let i = 0; i < tokens.length; i += 50) {
        const slice = tokens.slice(i, i + 50);
        const filter = `token=in.(${slice.map(encodeURIComponent).join(',')})`;
        const upd = await supabasePatch('webinaire_registrations', filter, { assigned_closer_id: closerId });
        if (!upd.ok) return json(500, { error: 'Assignation impossible', detail: upd.error });
      }
      return json(200, { ok: true, count: tokens.length });
    }

    // --- Activité d'un closer : ses leads travaillés (LECTURE SEULE) ---
    if (action === 'closer-activity') {
      const id = Number(body.closer_id);
      if (!Number.isInteger(id)) return json(400, { error: 'closer_id invalide' });
      const q =
        `webinaire_registrations?assigned_closer_id=eq.${id}` +
        '&or=(call_count.gt.0,call_notes.not.is.null)' +
        '&select=prenom,telephone,email,call_status,call_log,call_notes,next_callback_at,purchased';
      const r = await supabaseGet(q);
      if (!r.ok) return json(500, { error: 'Lecture impossible', detail: r.error });
      return json(200, { leads: Array.isArray(r.data) ? r.data : [] });
    }

    // --- Résoudre une liste d'emails collée -> leads (pour l'assignation par liste) ---
    if (action === 'leads-by-emails') {
      const raw = Array.isArray(body.emails) ? body.emails : [];
      const emails = [...new Set(
        raw
          .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter((e) => e && e.includes('@')),
      )].slice(0, 500);
      if (!emails.length) return json(400, { error: 'Aucun email valide' });
      const found = [];
      for (let i = 0; i < emails.length; i += 50) {
        const slice = emails.slice(i, i + 50);
        const q =
          `webinaire_registrations?email=in.(${slice.map(encodeURIComponent).join(',')})` +
          '&select=token,email,prenom,assigned_closer_id,purchased,watch_max_minutes';
        const r = await supabaseGet(q);
        if (!r.ok) return json(500, { error: 'Lecture impossible', detail: r.error });
        if (Array.isArray(r.data)) found.push(...r.data);
      }
      const foundSet = new Set(found.map((l) => (l.email || '').toLowerCase()));
      const not_found = emails.filter((e) => !foundSet.has(e));
      return json(200, { leads: found, not_found });
    }

    return json(400, { error: 'Action inconnue' });
  }

  return json(405, { error: 'Method not allowed' });
};

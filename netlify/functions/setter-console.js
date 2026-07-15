import bcrypt from 'bcryptjs';
import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';
import { authSetterUserId } from './lib/setter-auth.mjs';

/**
 * API données de la console /setter (auth requise).
 *
 * GET ?view=overview        : compteurs par statut
 * GET ?view=conversations[&status=] : liste des conversations
 * GET ?view=conversation&id= : détail + messages
 * GET ?view=targets         : no-shows pays riches sans conversation (échantillon)
 * GET ?view=playbook / settings
 * POST { action: ... }      : réglages, playbook, statut conv, changement de mot de passe
 */

const RICH_COUNTRIES = ['France', 'Belgique', 'Suisse', 'Luxembourg', 'Monaco', 'Canada'];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const uid = await authSetterUserId(req);
  if (uid === null) return json(401, { error: 'Non authentifié' });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const view = url.searchParams.get('view') || 'overview';

    if (view === 'overview') {
      const r = await supabaseGet('setter_conversations?select=status,phone');
      const rows = r.ok && Array.isArray(r.data) ? r.data : [];
      const real = rows.filter((c) => !String(c.phone).startsWith('sim-'));
      const counts = {};
      real.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
      const sup = await supabaseGet('setter_suppression?select=phone&limit=1000');
      return json(200, {
        ok: true,
        total: real.length,
        counts,
        opt_outs: sup.ok && Array.isArray(sup.data) ? sup.data.length : 0,
        simulations: rows.length - real.length,
      });
    }

    if (view === 'conversations') {
      const status = url.searchParams.get('status') || '';
      const sim = url.searchParams.get('sim') === '1';
      let q = 'setter_conversations?select=id,phone,prenom,pays,status,supervised,last_inbound_at,last_outbound_at,booked_rdv_at,updated_at&order=updated_at.desc&limit=100';
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;
      q += sim ? '&phone=like.sim-*' : '&phone=not.like.sim-*';
      const r = await supabaseGet(q);
      if (!r.ok) return json(500, { error: 'Erreur lecture' });
      return json(200, { ok: true, conversations: r.data || [] });
    }

    if (view === 'conversation') {
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id)) return json(400, { error: 'id manquant' });
      const cr = await supabaseGet(`setter_conversations?id=eq.${id}&select=*`);
      const conv = cr.ok && Array.isArray(cr.data) && cr.data[0] ? cr.data[0] : null;
      if (!conv) return json(404, { error: 'Introuvable' });
      const mr = await supabaseGet(
        `setter_messages?conversation_id=eq.${id}&select=id,direction,body,ai_generated,status,created_at&order=created_at.asc&limit=200`,
      );
      return json(200, { ok: true, conversation: conv, messages: mr.ok ? mr.data || [] : [] });
    }

    if (view === 'targets') {
      // No-shows pays riches, jamais appelés, jamais contactés par le setter.
      const paysList = RICH_COUNTRIES.map((p) => `"${p}"`).join(',');
      const q =
        'webinaire_registrations?select=id,prenom,telephone,pays,session_date' +
        '&purchased=not.is.true&telephone=not.is.null' +
        `&pays=in.(${encodeURIComponent(paysList)})` +
        '&and=(or(watch_max_minutes.is.null,watch_max_minutes.eq.0),or(attended_live.is.null,attended_live.is.false),or(watched_replay.is.null,watched_replay.is.false),or(call_count.is.null,call_count.eq.0))' +
        '&order=session_date.desc&limit=300';
      const r = await supabaseGet(q);
      if (!r.ok) return json(500, { error: 'Erreur lecture ciblage', detail: r.error });
      const regs = r.data || [];
      const [convs, sups] = await Promise.all([
        supabaseGet('setter_conversations?select=phone&limit=10000'),
        supabaseGet('setter_suppression?select=phone&limit=10000'),
      ]);
      const norm = (t) => String(t || '').replace(/\D/g, '').slice(-9);
      const taken = new Set([
        ...((convs.ok && convs.data) || []).map((c) => norm(c.phone)),
        ...((sups.ok && sups.data) || []).map((s) => norm(s.phone)),
      ]);
      const targets = regs.filter((x) => {
        const d = norm(x.telephone);
        return d.length >= 8 && !taken.has(d) && !/^\+?(262|590|596|594|687|689)/.test(String(x.telephone));
      });
      return json(200, { ok: true, total_sample: targets.length, targets: targets.slice(0, 60) });
    }

    if (view === 'playbook') {
      const r = await supabaseGet('setter_playbook?select=*&order=created_at.desc&limit=100');
      return json(200, { ok: true, playbook: r.ok ? r.data || [] : [] });
    }

    if (view === 'settings') {
      const r = await supabaseGet('setter_settings?select=key,value');
      const out = {};
      ((r.ok && r.data) || []).forEach((s) => { out[s.key] = s.value; });
      return json(200, { ok: true, settings: out });
    }

    return json(400, { error: 'Vue inconnue' });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'setting_set') {
      const key = typeof body.key === 'string' ? body.key.slice(0, 60) : '';
      if (!key || body.value === undefined) return json(400, { error: 'Requête invalide' });
      const upd = await supabasePatch('setter_settings', `key=eq.${encodeURIComponent(key)}`, {
        value: body.value,
        updated_at: new Date().toISOString(),
      });
      if (!upd.ok || !Array.isArray(upd.data) || !upd.data.length) {
        await supabasePost('setter_settings', { key, value: body.value });
      }
      return json(200, { ok: true });
    }

    if (body.action === 'playbook_add') {
      const content = typeof body.content === 'string' ? body.content.trim().slice(0, 1000) : '';
      const kind = ['lecon', 'objection', 'opener'].includes(body.kind) ? body.kind : 'lecon';
      if (!content) return json(400, { error: 'Contenu manquant' });
      const ins = await supabasePost('setter_playbook', { kind, content, source: 'manuel (console)' });
      if (!ins.ok) return json(500, { error: 'Erreur écriture' });
      return json(200, { ok: true });
    }

    if (body.action === 'playbook_toggle') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json(400, { error: 'Requête invalide' });
      const cur = await supabaseGet(`setter_playbook?id=eq.${id}&select=active`);
      const row = cur.ok && Array.isArray(cur.data) && cur.data[0] ? cur.data[0] : null;
      if (!row) return json(404, { error: 'Introuvable' });
      await supabasePatch('setter_playbook', `id=eq.${id}`, { active: !row.active });
      return json(200, { ok: true });
    }

    if (body.action === 'conversation_status') {
      const id = Number(body.id);
      const status = ['ouvert', 'handoff', 'clos', 'booke'].includes(body.status) ? body.status : '';
      if (!Number.isInteger(id) || !status) return json(400, { error: 'Requête invalide' });
      await supabasePatch('setter_conversations', `id=eq.${id}`, { status, updated_at: new Date().toISOString() });
      return json(200, { ok: true });
    }

    if (body.action === 'password_change') {
      const current = typeof body.current === 'string' ? body.current : '';
      const next = typeof body.next === 'string' ? body.next : '';
      if (!current || next.length < 10) return json(400, { error: 'Nouveau mot de passe : 10 caractères minimum' });
      const r = await supabaseGet(`setter_users?id=eq.${uid}&select=password_hash`);
      const row = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
      if (!row || !(await bcrypt.compare(current, row.password_hash))) {
        return json(401, { error: 'Mot de passe actuel incorrect' });
      }
      const hash = await bcrypt.hash(next, 12);
      await supabasePatch('setter_users', `id=eq.${uid}`, { password_hash: hash });
      return json(200, { ok: true });
    }

    return json(400, { error: 'Action inconnue' });
  }

  return json(405, { error: 'Méthode non autorisée' });
};

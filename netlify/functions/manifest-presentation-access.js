// Deadline pour /manifest-presentation (leads envoyés par les closers, token ES2).
// Règle : même échéance que l'offre ES2 du lead (offre_expires_at, dimanche 23h Paris) si le lead
// ouvre la page pendant que l'offre est encore valide. Si sa 1ère ouverture arrive APRÈS (envoi
// tardif / rattrapage), fallback : 24h personnelles ancrées à cette 1ère ouverture.
// Sans token, accepte ?email= et retrouve le token ES2 dans webinaire_registrations (lecture seule).
// Ancre de 1ère ouverture en Netlify Blobs, store dédié — aucune fonction existante touchée.

import { getStore } from '@netlify/blobs';
import { supabaseGet } from './lib/supabase-rest.mjs';

const WINDOW_MS = 24 * 60 * 60 * 1000;

const JSON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

export default async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        });
    }

    if (req.method !== 'GET') {
        return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
            status: 405,
            headers: JSON_HEADERS,
        });
    }

    try {
        const url = new URL(req.url);
        let token = (url.searchParams.get('t') || url.searchParams.get('token') || '').trim();
        const email = (url.searchParams.get('email') || '').trim().toLowerCase();

        // Pas de token mais un email : on retrouve le token ES2 du lead (lecture seule)
        let offreExpiresMs = null;
        let offreLookupDone = false;
        if (!token && email) {
            if (email.length > 200 || !email.includes('@')) {
                return new Response(JSON.stringify({ ok: false, notFound: true }), {
                    status: 200,
                    headers: JSON_HEADERS,
                });
            }
            const lookup = await supabaseGet(
                `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,offre_expires_at&limit=1`,
            );
            const row = lookup.ok && Array.isArray(lookup.data) ? lookup.data[0] : null;
            if (!row || !row.token) {
                return new Response(JSON.stringify({ ok: false, notFound: true }), {
                    status: 200,
                    headers: JSON_HEADERS,
                });
            }
            token = String(row.token);
            offreLookupDone = true;
            if (row.offre_expires_at) {
                const ms = new Date(row.offre_expires_at).getTime();
                if (Number.isFinite(ms)) offreExpiresMs = ms;
            }
        }

        if (!token || token.length > 200) {
            return new Response(JSON.stringify({ ok: false, error: 'Token requis' }), {
                status: 400,
                headers: JSON_HEADERS,
            });
        }

        const store = getStore('manifest-presentation-deadlines');
        const now = Date.now();

        // Ancre de 1ère ouverture (persistée en Blobs, jamais réinitialisée)
        let entry = null;
        const raw = await store.get(token);
        if (raw) {
            try { entry = JSON.parse(raw); } catch { entry = null; }
        }

        if (!entry || !Number.isFinite(entry.startedAt)) {
            entry = { token, startedAt: now, createdAt: new Date(now).toISOString() };
            await store.set(token, JSON.stringify(entry));
        }

        const firstSeen = entry.startedAt;

        // Échéance ES2 du lead (si arrivé par ?t=, on la lit maintenant)
        if (!offreLookupDone) {
            const lookup = await supabaseGet(
                `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=offre_expires_at&limit=1`,
            );
            const row = lookup.ok && Array.isArray(lookup.data) ? lookup.data[0] : null;
            if (row && row.offre_expires_at) {
                const ms = new Date(row.offre_expires_at).getTime();
                if (Number.isFinite(ms)) offreExpiresMs = ms;
            }
        }

        // Règle : deadline ES2 si le lead a découvert la page pendant que l'offre était valide ;
        // sinon (1ère ouverture après l'échéance, ou token hors base) : 24h de rattrapage.
        const expiresAt = (offreExpiresMs && firstSeen < offreExpiresMs)
            ? offreExpiresMs
            : firstSeen + WINDOW_MS;

        return new Response(JSON.stringify({
            ok: true,
            token,
            startedAt: entry.startedAt,
            expiresAt,
            serverNow: now,
            expired: now >= expiresAt,
        }), {
            status: 200,
            headers: JSON_HEADERS,
        });
    } catch (error) {
        console.error('manifest-presentation-access error:', error);
        return new Response(JSON.stringify({ ok: false, error: 'Erreur serveur' }), {
            status: 500,
            headers: JSON_HEADERS,
        });
    }
};

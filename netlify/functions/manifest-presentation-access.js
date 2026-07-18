// Deadline personnelle 24h pour /manifest-presentation (leads envoyés par les closers, token ES2).
// À la 1ère ouverture avec un token, on ancre startedAt ; ensuite on renvoie toujours la même échéance.
// Sans token, accepte ?email= et retrouve le token ES2 dans webinaire_registrations (lecture seule).
// Stockage Netlify Blobs, store dédié — aucune fonction existante touchée.

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
        if (!token && email) {
            if (email.length > 200 || !email.includes('@')) {
                return new Response(JSON.stringify({ ok: false, notFound: true }), {
                    status: 200,
                    headers: JSON_HEADERS,
                });
            }
            const lookup = await supabaseGet(
                `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token&limit=1`,
            );
            const row = lookup.ok && Array.isArray(lookup.data) ? lookup.data[0] : null;
            if (!row || !row.token) {
                return new Response(JSON.stringify({ ok: false, notFound: true }), {
                    status: 200,
                    headers: JSON_HEADERS,
                });
            }
            token = String(row.token);
        }

        if (!token || token.length > 200) {
            return new Response(JSON.stringify({ ok: false, error: 'Token requis' }), {
                status: 400,
                headers: JSON_HEADERS,
            });
        }

        const store = getStore('manifest-presentation-deadlines');
        const now = Date.now();

        let entry = null;
        const raw = await store.get(token);
        if (raw) {
            try { entry = JSON.parse(raw); } catch { entry = null; }
        }

        if (!entry || !Number.isFinite(entry.startedAt)) {
            entry = { token, startedAt: now, createdAt: new Date(now).toISOString() };
            await store.set(token, JSON.stringify(entry));
        }

        const expiresAt = entry.startedAt + WINDOW_MS;

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

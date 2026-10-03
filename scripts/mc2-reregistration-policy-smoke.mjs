import assert from 'node:assert/strict';
import { mc2ReregistrationDecision as decide } from '../netlify/functions/lib/mc2-reregistration-policy.mjs';
const now = Date.parse('2026-10-03T10:00:00Z');
const previous = { statut: 'registered', session_ends_at: '2026-10-02T20:00:00Z' };
let checks = 0;
function check(input, action, reason) {
  assert.deepEqual(decide({ now, ...input }), { action, reason }); checks++;
}
check({}, 'register', 'no_confirmed_cta');
check({ registrations: [previous], exclusionReason: 'inscrit_mc2' }, 'reregister', 'no_confirmed_cta');
check({ registrations: [{ ...previous, attended_live: true, watch_max_seconds_live: 1200 }] }, 'reregister', 'no_confirmed_cta');
check({ registrations: [{ ...previous, watch_max_seconds_live: 4000 }] }, 'reregister', 'no_confirmed_cta');
check({ registrations: [{ ...previous, saw_offer: true }] }, 'reregister', 'no_confirmed_cta');
check({ registrations: [previous], events: [{ event_name: 'offer_available' }, { event_name: 'offer_visible' }] }, 'reregister', 'no_confirmed_cta');
check({ registrations: [previous], events: [{ event_name: 'cta_playback_present', route: '/mc2/session/' }] }, 'blocked', 'cta_playback');
check({ registrations: [previous], events: [{ event_name: 'cta_playback_present', route: '/mc2/replay/' }] }, 'blocked', 'cta_playback');
check({ registrations: [previous], historicalCtaConfirmed: true }, 'blocked', 'cta_playback');
check({ registrations: [{ ...previous, purchased_at: '2026-10-02T20:00:00Z' }] }, 'blocked', 'buyer');
check({ registrations: [{ ...previous, payment_status: 'paid' }] }, 'blocked', 'buyer');
check({ registrations: [{ ...previous, session_ends_at: '2026-10-03T12:00:00Z' }] }, 'existing_session', 'session_active');
check({ registrations: [{ ...previous, session_ends_at: null }] }, 'review', 'session_end_unknown');
check({ registrations: [previous], historyLoaded: false }, 'retry', 'history_unavailable');
check({ registrations: [previous], exclusionReason: 'inscrit_webinaire' }, 'reregister', 'no_confirmed_cta');
check({ registrations: [previous], exclusionReason: 'no_show_reactive_mc2' }, 'reregister', 'no_confirmed_cta');
check({ registrations: [previous], exclusionReason: 'acheteur_es' }, 'review', 'protected_exclusion');
console.log(`${checks} tests OK — politique isolée, aucun appel réseau.`);

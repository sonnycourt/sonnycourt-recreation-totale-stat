import { trackingMedia, OFFER_VERSION } from '../../../src/lib/mc2-tracking-contract.mjs';
export function unionSeconds(ranges) {
  const sorted = ranges.filter(([a, b]) => Number.isFinite(a) && b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of sorted) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
}
const observedForeground = meta => meta.foreground === true && !(meta.frames_supported === true && meta.frames_advanced !== true);
const fields = ['registrations', 'tracked', 'playback', 'ctaPresent', 'ctaBackground', 'offerPlayback', 'offerVisible', 'offerScrolled', 'checkoutOpened', 'step1', 'step2', 'step3', 'paymentFrameVisible', 'commitments', 'trackingGaps'];
const empty = () => Object.fromEntries(fields.map(key => [key, 0]));

export function summarizeTracking({ registrations, events, purchaseEvents = [], tests = [], now = Date.now(), partial = false, referenceCountries = ['France', 'Belgique', 'Suisse', 'Canada'] }) {
  const testTokens = new Set(tests.map(r => r.token));
  const people = new Map(registrations.filter(r => !testTokens.has(r.token)).map(r => [r.token, {
    id: r.id, country: r.pays || 'Inconnu', source: r.traffic_source || 'non_attribue', slot: r.slot_kind || 'inconnu',
    registeredAt: r.registration_completed_at, legacyOfferSignal: r.saw_offer === true,
    flags: new Set(), foregroundRanges: [], backgroundRanges: [], positions: new Map(),
    lastSeen: null, maxDepth: null, sections: new Set(), steps: new Set(), commitmentAt: null,
  }]));
  const latestPlayers = new Map();
  const seenIds = new Set();
  for (const event of events) {
    const person = people.get(event.token);
    if (!person || seenIds.has(event.event_id)) continue;
    if (event.offer_version && event.offer_version !== OFFER_VERSION) continue;
    if (event.webinar_version && event.webinar_version !== trackingMedia(event.route).version) continue;
    seenIds.add(event.event_id);
    const meta = event.metadata || {}, stamp = Date.parse(event.client_occurred_at);
    person.flags.add(event.event_name);
    if (!person.lastSeen || stamp > Date.parse(person.lastSeen)) person.lastSeen = event.client_occurred_at;
    if (event.event_name === 'checkout_step_viewed') person.steps.add(Number(meta.step));
    if (event.event_name === 'offer_depth') person.maxDepth = Math.max(person.maxDepth || 0, Number(meta.depth_percent) || 0);
    if (event.event_name === 'offer_section_visible' && meta.section) person.sections.add(meta.section);
    if (event.event_name === 'player_state') {
      const key = `${event.token}:${event.visit_id}`;
      if (!latestPlayers.has(key) || stamp > Date.parse(latestPlayers.get(key).client_occurred_at)) latestPlayers.set(key, event);
    }
    if (event.event_name === 'playback_interval') {
      const start = Date.parse(meta.interval_started_at) / 1000, end = Date.parse(meta.interval_ended_at) / 1000;
      if (meta.foreground === false) {
        person.backgroundRanges.push([start, end]);
        const threshold = trackingMedia(event.route).cta;
        if (Number(meta.position_start) <= threshold && Number(meta.position_end) >= threshold) person.flags.add('cta_background_playback');
      }
      if (!observedForeground(meta)) continue;
      person.foregroundRanges.push([start, end]);
      const a = Number(meta.position_start), b = Number(meta.position_end);
      if (!(b > a)) continue;
      const positions = person.positions.get(event.route) || [];
      positions.push([a, b]); person.positions.set(event.route, positions);
      const threshold = trackingMedia(event.route).cta;
      if (a <= threshold && b >= threshold) person.flags.add('cta_playback_present');
      if (b >= threshold) person.flags.add('offer_playback_present');
    }
  }
  for (const event of purchaseEvents) {
    const person = people.get(event.token);
    if (person && event.event_name === 'purchase_completed' && event.metadata?.provider === 'spiffy') {
      person.flags.add('commitment'); person.commitmentAt ||= event.occurred_at;
    }
  }
  const totals = empty(), groups = new Map(), retention = new Map();
  const countPerson = (row, person) => {
    row.registrations++;
    const f = person.flags;
    row.tracked += Number(f.has('journey_started'));
    row.playback += Number(f.has('playback_started'));
    row.ctaPresent += Number(f.has('cta_playback_present'));
    row.ctaBackground += Number(f.has('cta_background_playback'));
    row.offerPlayback += Number(f.has('offer_playback_present'));
    row.offerVisible += Number(f.has('offer_visible'));
    row.offerScrolled += Number(f.has('offer_scroll_started'));
    row.checkoutOpened += Number(f.has('checkout_opened'));
    for (const step of [1, 2, 3]) row['step' + step] += Number(person.steps.has(step));
    row.paymentFrameVisible += Number(f.has('payment_frame_visible'));
    row.commitments += Number(f.has('commitment'));
    row.trackingGaps += Number(f.has('tracking_diagnostic') || (f.has('commitment') && !f.has('checkout_opened')));
  };
  const details = [];
  for (const [token, person] of people) {
    const countryGroup = ['Autre', 'Inconnu', ''].includes(person.country) ? 'pays_non_classe'
      : referenceCountries.includes(person.country) ? 'pays_reference' : 'autres_pays_renseignes';
    countPerson(totals, person);
    const key = JSON.stringify([countryGroup, person.country, person.source, person.slot]);
    if (!groups.has(key)) groups.set(key, { countryGroup, country: person.country, source: person.source, slot: person.slot, ...empty() });
    countPerson(groups.get(key), person);
    for (const [route, positions] of person.positions) {
      const minuteRanges = new Map();
      const offset = route === '/mc2/session/' ? 1200 : 0;
      for (const [start, end] of positions) {
        for (let minute = Math.floor(start / 60); minute <= Math.floor((end - 0.001) / 60); minute++) {
          const range = [Math.max(start, minute * 60), Math.min(end, (minute + 1) * 60)];
          const ranges = minuteRanges.get(minute) || []; ranges.push(range); minuteRanges.set(minute, ranges);
        }
      }
      for (const [minute, ranges] of minuteRanges) {
        if (unionSeconds(ranges) < 1) continue;
        const key = JSON.stringify([route, minute, countryGroup]);
        if (!retention.has(key)) retention.set(key, { route, mediaMinute: minute, contentMinute: minute - offset / 60, countryGroup, people: 0 });
        retention.get(key).people++;
      }
    }
    details.push({ id: person.id, country: person.country, countryGroup, source: person.source, slot: person.slot,
      registeredAt: person.registeredAt, lastSeen: person.lastSeen, stages: [...person.flags].filter(x => !['player_state', 'playback_interval'].includes(x)),
      steps: [...person.steps].sort(), maxDepth: person.maxDepth, sections: [...person.sections],
      observedForegroundSeconds: Math.round(unionSeconds(person.foregroundRanges)),
      observedBackgroundSeconds: Math.round(unionSeconds(person.backgroundRanges)),
      commitmentAt: person.commitmentAt, legacyOfferSignal: person.legacyOfferSignal,
      measurement: person.flags.has('journey_started') ? 'v2_observed_not_exhaustive' : 'unknown_legacy_or_no_client_signal' });
  }
  const activeLive = new Set(), activeReplay = new Set();
  for (const event of latestPlayers.values()) {
    const age = now - Date.parse(event.client_occurred_at), meta = event.metadata || {};
    if (age >= -60000 && age <= 45000 && meta.is_playing === true && observedForeground(meta)) {
      (event.route === '/mc2/replay/' ? activeReplay : activeLive).add(event.token);
    }
  }
  return { schema: 2, partial, referenceCountries, totals, groups: [...groups.values()], people: details,
    retention: [...retention.values()].sort((a, b) => a.mediaMinute - b.mediaMinute),
    activeWithinCohort: { live: activeLive.size, replay: activeReplay.size },
    quality: { eventsRead: events.length, trackedRegistrations: totals.tracked, unobservedRegistrations: totals.registrations - totals.tracked,
      warning: partial ? 'Lecture tronquée : ne pas utiliser ces résultats comme totaux exhaustifs.' : 'Absence de trace ≠ absence de comportement. Les anciens signaux CTA ne sont pas fusionnés avec la v2.' },
  };
}

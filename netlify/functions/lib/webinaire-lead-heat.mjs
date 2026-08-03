function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function bool(value) {
  return value === true;
}

export function bestWatchMinutes(row) {
  return Math.max(
    number(row?.watch_max_minutes),
    number(row?.watch_max_seconds_live) / 60,
    number(row?.watch_max_seconds_replay) / 60,
  );
}

export function computeLeadHeat(row) {
  const watchMinutes = bestWatchMinutes(row);
  const scroll = number(row?.sales_max_scroll_pct);
  const salesSeconds = number(row?.pdv_seconds);
  const checkoutClicks = Math.max(number(row?.checkout_click_count), bool(row?.checkout_clicked) ? 1 : 0);
  const checkoutViews = number(row?.checkout_view_count);
  const reasons = [];
  let score = 0;

  if (watchMinutes >= 90) { score += 20; reasons.push('90 min+ de webinaire'); }
  else if (watchMinutes >= 75) { score += 16; reasons.push('75 min+ de webinaire'); }
  else if (watchMinutes >= 50) { score += 10; reasons.push('50 min+ de webinaire'); }
  else if (watchMinutes >= 30) { score += 5; reasons.push('30 min+ de webinaire'); }

  if (bool(row?.saw_offer)) { score += 8; reasons.push('offre vue'); }
  if (bool(row?.visited_sales)) { score += 10; reasons.push('page de vente visitée'); }

  if (scroll >= 90) { score += 14; reasons.push('page lue à 90 %'); }
  else if (scroll >= 75) { score += 11; reasons.push('page lue à 75 %'); }
  else if (scroll >= 50) { score += 6; reasons.push('page lue à 50 %'); }
  else if (scroll >= 25) { score += 3; reasons.push('page lue à 25 %'); }

  if (bool(row?.sales_pricing_viewed)) { score += 8; reasons.push('formules vues'); }
  if (bool(row?.sales_guarantee_viewed)) { score += 3; reasons.push('garantie vue'); }

  if (salesSeconds >= 900) { score += 14; reasons.push('15 min+ sur la vente'); }
  else if (salesSeconds >= 600) { score += 11; reasons.push('10 min+ sur la vente'); }
  else if (salesSeconds >= 300) { score += 8; reasons.push('5 min+ sur la vente'); }
  else if (salesSeconds >= 120) { score += 4; reasons.push('2 min+ sur la vente'); }

  if (checkoutViews > 0) {
    score += 30;
    reasons.push('checkout ouvert');
  } else if (checkoutClicks > 0) {
    score += 22;
    reasons.push('checkout cliqué');
  }
  if (checkoutViews > 1) { score += 7; reasons.push('retour checkout'); }
  if (bool(row?.checkout_engaged)) { score += 8; reasons.push('20 s+ sur le checkout'); }
  if (row?.checkout_last_plan === 'complet') score += 5;
  else if (row?.checkout_last_plan === 'avance') score += 3;
  if (String(row?.checkout_last_payment_mode || '') === '1') score += 3;

  score = Math.min(100, Math.round(score));

  let level = 'nourrir';
  let label = 'À nourrir';
  let priority = 5;
  if (bool(row?.purchased)) {
    level = 'acheteur';
    label = 'Acheteur';
    priority = 9;
  } else if (checkoutViews > 0) {
    level = 'brulant';
    label = 'Brûlant';
    priority = 1;
  } else if (checkoutClicks > 0) {
    level = 'tres_chaud';
    label = 'Très chaud';
    priority = 2;
  } else if (score >= 45) {
    level = 'chaud';
    label = 'Chaud';
    priority = 3;
  } else if (bool(row?.visited_sales) || score >= 20) {
    level = 'interesse';
    label = 'Intéressé';
    priority = 4;
  }

  return {
    heat_score: score,
    heat_level: level,
    heat_label: label,
    heat_priority: priority,
    heat_reason: reasons.slice(0, 6).join(' · '),
    watch_best_minutes: Math.round(watchMinutes),
  };
}

export function sortLeadsByHeat(a, b) {
  const ah = computeLeadHeat(a);
  const bh = computeLeadHeat(b);
  if (ah.heat_priority !== bh.heat_priority) return ah.heat_priority - bh.heat_priority;
  if (ah.heat_score !== bh.heat_score) return bh.heat_score - ah.heat_score;
  const bt = Date.parse(b?.last_intent_at || b?.checkout_last_viewed_at || b?.last_event_at || '') || 0;
  const at = Date.parse(a?.last_intent_at || a?.checkout_last_viewed_at || a?.last_event_at || '') || 0;
  if (at !== bt) return bt - at;
  return bestWatchMinutes(b) - bestWatchMinutes(a);
}

const screen = document.querySelector('[data-pay-resource-page]');

if (screen) {
  const API_STRIPE = '/.netlify/functions/pay-stripe-data';
  const API_PAYPAL = '/.netlify/functions/pay-paypal-data';
  const DAY = 86_400_000;
  const search = screen.querySelector('[data-resource-search]');
  const providerFilter = screen.querySelector('[data-resource-provider]');
  const statusFilter = screen.querySelector('[data-resource-status]');
  const count = screen.querySelector('[data-resource-count]');
  const state = screen.querySelector('[data-resource-state]');
  const table = screen.querySelector('[data-resource-table]');
  const rowsHost = screen.querySelector('[data-resource-rows]');
  const empty = screen.querySelector('[data-resource-empty]');
  const detailDialog = screen.querySelector('[data-resource-dialog]');
  const detailTitle = screen.querySelector('[data-resource-dialog-title]');
  const detailContent = screen.querySelector('[data-resource-dialog-content]');
  let rows = [];

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const stripeId = (value) => typeof value === 'string' ? value : value?.id || '';

  function currencyDigits(currency = 'eur') {
    try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits; }
    catch { return 2; }
  }

  function money(minor, currency = 'eur') {
    const divisor = 10 ** currencyDigits(currency);
    try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(Number(minor || 0) / divisor); }
    catch { return `${Number(minor || 0) / divisor} ${currency.toUpperCase()}`; }
  }

  function date(value, dateOnly = false) {
    const parsed = value instanceof Date ? value : new Date(typeof value === 'number' ? value * 1_000 : value);
    if (!Number.isFinite(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  }

  function providerCell(provider) {
    const label = provider === 'paypal' ? 'PayPal' : provider === 'spiffy' ? 'Spiffy' : 'Stripe';
    return `<span class="resource-provider resource-provider--${escapeHtml(provider)}">${label}</span>`;
  }

  function badge(label) {
    const normalized = clean(label).toLowerCase();
    const success = /réussi|actif|active|paid|complete|succeeded|trialing/.test(normalized);
    const warning = /attente|past|retard|open|pending|incomplete/.test(normalized);
    return `<span class="pay-badge ${success ? 'pay-badge--success' : warning ? 'pay-badge--warning' : 'pay-badge--draft'}">${escapeHtml(label || 'Inconnu')}</span>`;
  }

  function row(values, plain, provider, status, sortTime = 0) {
    return {
      values,
      plain: plain.map((value) => String(value ?? '')),
      provider,
      status: clean(status).toLowerCase() || 'inconnu',
      search: plain.join(' ').toLowerCase(),
      sortTime: Number(sortTime || 0),
    };
  }

  async function fetchStripeAll(resource, maxPages = 8) {
    const data = [];
    let cursor = '';
    for (let page = 0; page < maxPages; page += 1) {
      const parameters = new URLSearchParams({ resource, limit: '100' });
      if (cursor) parameters.set('starting_after', cursor);
      const response = await fetch(`${API_STRIPE}?${parameters}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.connected) throw new Error(payload.error || `stripe_${resource}_failed`);
      data.push(...(Array.isArray(payload.data) ? payload.data : []));
      if (!payload.has_more || !payload.next_cursor) break;
      cursor = payload.next_cursor;
    }
    return data;
  }

  async function fetchPayPal(days = 90) {
    const end = new Date(Date.now() - 3 * 60 * 60 * 1_000);
    const start = new Date(end.getTime() - Math.min(366, days) * DAY);
    const parameters = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const response = await fetch(`${API_PAYPAL}?${parameters}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.connected) throw new Error(payload.error || 'paypal_data_failed');
    return Array.isArray(payload.transactions) ? payload.transactions : [];
  }

  function stripeStatus(value) {
    if (['succeeded', 'paid', 'complete', 'active', 'trialing'].includes(value)) return 'Réussi';
    if (['processing', 'open', 'pending', 'incomplete', 'past_due', 'unpaid'].includes(value)) return value === 'past_due' ? 'En retard' : 'En attente';
    if (['canceled', 'cancelled', 'expired'].includes(value)) return 'Annulé';
    return value || 'Inconnu';
  }

  function stripeCustomer(object) {
    const details = object.customer_details || object.latest_charge?.billing_details || {};
    const metadata = object.metadata || {};
    const name = clean(details.name || metadata.customer_name || metadata.customer_first_name);
    const email = clean(details.email || object.receipt_email || metadata.customer_email).toLowerCase();
    return { name: name || email || 'Client Stripe', email };
  }

  async function loadOrders() {
    const [intents, paypal] = await Promise.all([fetchStripeAll('payment_intents', 20), fetchPayPal(366).catch(() => [])]);
    const stripeRows = intents.map((intent) => {
      const customer = stripeCustomer(intent);
      const amount = Number(intent.amount_received || intent.amount || 0);
      const status = stripeStatus(intent.status);
      const description = clean(intent.description || intent.metadata?.offer_name || intent.metadata?.offer_slug) || 'Commande Stripe';
      return row([
        `<strong>${escapeHtml(description)}</strong><small>#${escapeHtml(intent.id)}</small>`,
        `<strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email)}</small>`,
        date(intent.created), providerCell('stripe'), badge(status), `<strong>${money(amount, intent.currency)}</strong>`,
      ], [description, customer.name, customer.email, date(intent.created), 'Stripe', status, money(amount, intent.currency)], 'stripe', status, intent.created);
    });
    const paypalRows = paypal.filter((item) => ['sale', 'payment_plan'].includes(item.kind)).map((item) => row([
      `<strong>${escapeHtml(item.description)}</strong><small>#${escapeHtml(item.id)}</small>`,
      `<strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.email)}</small>`,
      date(item.created), providerCell('paypal'), badge(item.status), `<strong>${money(item.amount, item.currency)}</strong>`,
    ], [item.description, item.customer, item.email, date(item.created), 'PayPal', item.status, money(item.amount, item.currency)], 'paypal', item.status, item.created));
    return [...stripeRows, ...paypalRows].sort((a, b) => b.sortTime - a.sortTime);
  }

  async function loadCustomers() {
    const [customers, intents, paypal] = await Promise.all([
      fetchStripeAll('customers', 20),
      fetchStripeAll('payment_intents', 20).catch(() => []),
      fetchPayPal(366).catch(() => []),
    ]);
    const valueByCustomer = new Map();
    intents.filter((item) => item.status === 'succeeded').forEach((item) => {
      const id = stripeId(item.customer) || stripeCustomer(item).email;
      if (!id) return;
      const current = valueByCustomer.get(id) || { value: 0, orders: 0, currency: item.currency || 'eur' };
      current.value += Number(item.amount_received || item.amount || 0);
      current.orders += 1;
      valueByCustomer.set(id, current);
    });
    const stripeRows = customers.map((customer) => {
      const email = clean(customer.email).toLowerCase();
      const aggregate = valueByCustomer.get(customer.id) || valueByCustomer.get(email) || { value: 0, orders: 0, currency: customer.currency || 'eur' };
      const name = clean(customer.name) || email || 'Client Stripe';
      const status = customer.delinquent ? 'En retard' : 'Actif';
      return row([
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(customer.id)}</small>`, escapeHtml(email || '—'), providerCell('stripe'), String(aggregate.orders), `<strong>${money(aggregate.value, aggregate.currency)}</strong>`, badge(status),
      ], [name, email, 'Stripe', aggregate.orders, money(aggregate.value, aggregate.currency), status], 'stripe', status);
    });
    const paypalMap = new Map();
    paypal.filter((item) => item.email).forEach((item) => {
      const current = paypalMap.get(item.email) || { name: item.customer, email: item.email, value: 0, orders: 0, currency: item.currency, status: 'Actif' };
      if (item.status === 'Réussi' && ['sale', 'payment_plan'].includes(item.kind)) { current.value += item.signed_amount; current.orders += 1; }
      paypalMap.set(item.email, current);
    });
    const paypalRows = [...paypalMap.values()].map((customer) => row([
      `<strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email)}</small>`, escapeHtml(customer.email), providerCell('paypal'), String(customer.orders), `<strong>${money(customer.value, customer.currency)}</strong>`, badge(customer.status),
    ], [customer.name, customer.email, 'PayPal', customer.orders, money(customer.value, customer.currency), customer.status], 'paypal', customer.status));
    return [...stripeRows, ...paypalRows];
  }

  function subscriptionAmount(subscription) {
    const price = subscription.items?.data?.[0]?.price;
    return { amount: Number(price?.unit_amount || 0), currency: price?.currency || subscription.currency || 'eur', interval: price?.recurring?.interval || 'mois' };
  }

  async function loadSubscriptions(paymentPlansOnly = false) {
    const [subscriptions, paypal] = await Promise.all([fetchStripeAll('subscriptions', 20), fetchPayPal(366).catch(() => [])]);
    const stripeRows = subscriptions.map((subscription) => {
      const pricing = subscriptionAmount(subscription);
      const customer = typeof subscription.customer === 'object' ? subscription.customer : null;
      const name = clean(customer?.name || customer?.email) || stripeId(subscription.customer) || 'Client Stripe';
      const status = stripeStatus(subscription.status);
      const paid = Number(subscription.metadata?.installments_paid || 0);
      const total = Number(subscription.metadata?.installment_count || 0);
      return row(paymentPlansOnly ? [
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(subscription.id)}</small>`, providerCell('stripe'), `<strong>${money(pricing.amount, pricing.currency)} / ${escapeHtml(pricing.interval)}</strong>`, total ? `${paid}/${total}` : 'Récurrent', date(subscription.current_period_end, true), badge(status),
      ] : [
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(subscription.id)}</small>`, providerCell('stripe'), `<strong>${money(pricing.amount, pricing.currency)} / ${escapeHtml(pricing.interval)}</strong>`, date(subscription.current_period_end, true), badge(status),
      ], paymentPlansOnly ? [name, 'Stripe', money(pricing.amount, pricing.currency), total ? `${paid}/${total}` : 'Récurrent', date(subscription.current_period_end, true), status] : [name, 'Stripe', money(pricing.amount, pricing.currency), date(subscription.current_period_end, true), status], 'stripe', status);
    });
    const paypalGroups = new Map();
    paypal.filter((item) => item.is_plan_payment && item.reference_id).forEach((item) => {
      const current = paypalGroups.get(item.reference_id) || { id: item.reference_id, customer: item.customer, amount: item.amount, currency: item.currency, count: 0, latest: 0, status: item.status };
      current.count += item.status === 'Réussi' ? 1 : 0;
      current.latest = Math.max(current.latest, item.created);
      current.status = item.status;
      paypalGroups.set(item.reference_id, current);
    });
    const paypalRows = [...paypalGroups.values()].map((plan) => row(paymentPlansOnly ? [
      `<strong>${escapeHtml(plan.customer)}</strong><small>#${escapeHtml(plan.id)}</small>`, providerCell('paypal'), `<strong>${money(plan.amount, plan.currency)}</strong>`, `${plan.count} encaissée${plan.count === 1 ? '' : 's'}`, 'Selon plan PayPal', badge(plan.status),
    ] : [
      `<strong>${escapeHtml(plan.customer)}</strong><small>#${escapeHtml(plan.id)}</small>`, providerCell('paypal'), `<strong>${money(plan.amount, plan.currency)}</strong>`, 'Selon plan PayPal', badge(plan.status),
    ], paymentPlansOnly ? [plan.customer, 'PayPal', money(plan.amount, plan.currency), plan.count, 'Selon plan PayPal', plan.status] : [plan.customer, 'PayPal', money(plan.amount, plan.currency), 'Selon plan PayPal', plan.status], 'paypal', plan.status));
    return [...stripeRows, ...paypalRows];
  }

  async function loadProducts() {
    const prices = await fetchStripeAll('prices', 20);
    return prices.map((price) => {
      const product = typeof price.product === 'object' ? price.product : null;
      const name = clean(product?.name || price.nickname) || stripeId(price.product) || 'Produit Stripe';
      const billing = price.type === 'recurring' ? `Tous les ${price.recurring?.interval_count || 1} ${price.recurring?.interval || 'mois'}` : 'Paiement unique';
      const status = price.active && product?.active !== false ? 'Actif' : 'Archivé';
      return row([
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(price.id)}</small>`, providerCell('stripe'), escapeHtml(billing), `<strong>${money(price.unit_amount, price.currency)}</strong>`, badge(status),
      ], [name, 'Stripe', billing, money(price.unit_amount, price.currency), status], 'stripe', status);
    });
  }

  async function loadCheckouts() {
    const links = await fetchStripeAll('payment_links', 20);
    return links.map((link) => {
      const line = link.line_items?.data?.[0];
      const price = line?.price;
      const product = typeof price?.product === 'object' ? price.product : null;
      const name = clean(link.metadata?.checkout_name || product?.name) || `Checkout ${link.id.slice(-8)}`;
      const status = link.active ? 'Actif' : 'Archivé';
      const amount = price?.unit_amount;
      const priceText = Number.isFinite(Number(amount)) ? money(amount, price.currency) : 'Prix Stripe';
      const linkHtml = link.url ? `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">Ouvrir ↗</a>` : '—';
      return row([
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(link.id)}</small>`, providerCell('stripe'), `<strong>${escapeHtml(priceText)}</strong>`, badge(status), linkHtml,
      ], [name, 'Stripe', priceText, status, link.url || ''], 'stripe', status);
    });
  }

  async function loadDiscounts() {
    const [coupons, promotionCodes] = await Promise.all([fetchStripeAll('coupons', 10), fetchStripeAll('promotion_codes', 10)]);
    const couponById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    return promotionCodes.map((promotion) => {
      const coupon = promotion.coupon || promotion.promotion?.coupon || couponById.get(stripeId(promotion.coupon)) || {};
      const value = coupon.percent_off != null ? `${coupon.percent_off} %` : money(coupon.amount_off || 0, coupon.currency || 'eur');
      const status = promotion.active && (!promotion.expires_at || promotion.expires_at * 1_000 > Date.now()) ? 'Actif' : 'Expiré';
      return row([
        `<strong>${escapeHtml(promotion.code || promotion.id)}</strong><small>#${escapeHtml(promotion.id)}</small>`, providerCell('stripe'), `<strong>${escapeHtml(value)}</strong>`, promotion.expires_at ? date(promotion.expires_at, true) : 'Sans expiration', `${promotion.times_redeemed || 0}${promotion.max_redemptions ? ` / ${promotion.max_redemptions}` : ''}`, badge(status),
      ], [promotion.code || promotion.id, 'Stripe', value, promotion.expires_at ? date(promotion.expires_at, true) : 'Sans expiration', promotion.times_redeemed || 0, status], 'stripe', status);
    });
  }

  const loaders = {
    orders: loadOrders,
    customers: loadCustomers,
    subscriptions: () => loadSubscriptions(false),
    'payment-plans': () => loadSubscriptions(true),
    products: loadProducts,
    checkouts: loadCheckouts,
    discounts: loadDiscounts,
  };

  function populateStatuses() {
    const statuses = [...new Set(rows.map((item) => item.status).filter(Boolean))].sort();
    statusFilter.innerHTML = '<option value="all">Tous les statuts</option>' + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status.charAt(0).toUpperCase() + status.slice(1))}</option>`).join('');
  }

  function render() {
    const query = clean(search.value).toLowerCase();
    const provider = providerFilter.value;
    const status = statusFilter.value;
    const visible = rows.filter((item) => (!query || item.search.includes(query)) && (provider === 'all' || item.provider === provider) && (status === 'all' || item.status === status));
    rowsHost.innerHTML = visible.map((item) => `<div class="resource-row" role="button" tabindex="0" data-resource-index="${rows.indexOf(item)}" data-provider="${escapeHtml(item.provider)}" data-status="${escapeHtml(item.status)}">${item.values.map((value) => `<span>${value}</span>`).join('')}</div>`).join('');
    count.textContent = `${visible.length} résultat${visible.length === 1 ? '' : 's'}`;
    table.hidden = visible.length === 0;
    empty.hidden = visible.length !== 0;
  }

  function csvValue(value) {
    const normalized = String(value ?? '').replace(/\r?\n/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const headers = [...screen.querySelectorAll('.resource-head > span')].map((item) => item.textContent.trim());
    const visibleRows = rows.filter((item) => {
      const query = clean(search.value).toLowerCase();
      return (!query || item.search.includes(query)) && (providerFilter.value === 'all' || item.provider === providerFilter.value) && (statusFilter.value === 'all' || item.status === statusFilter.value);
    });
    const content = [headers, ...visibleRows.map((item) => item.plain)].map((line) => line.map(csvValue).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pay-${screen.dataset.payResourcePage}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    window.payToast?.('Export CSV préparé.');
  }

  search.addEventListener('input', render);
  providerFilter.addEventListener('change', render);
  statusFilter.addEventListener('change', render);
  document.querySelector('[data-resource-export]')?.addEventListener('click', exportCsv);

  function openDetails(item) {
    if (!item || !detailDialog) return;
    const headers = [...screen.querySelectorAll('.resource-head > span')].map((element) => element.textContent.trim());
    detailTitle.textContent = item.plain[0] || 'Détail';
    detailContent.innerHTML = headers.map((header, index) => `<div><small>${escapeHtml(header)}</small><strong>${escapeHtml(item.plain[index] || '—')}</strong></div>`).join('');
    detailDialog.showModal();
  }

  rowsHost.addEventListener('click', (event) => {
    if (event.target.closest('a,button')) return;
    const target = event.target.closest('[data-resource-index]');
    if (target) openDetails(rows[Number(target.dataset.resourceIndex)]);
  });
  rowsHost.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const target = event.target.closest('[data-resource-index]');
    if (!target) return;
    event.preventDefault();
    openDetails(rows[Number(target.dataset.resourceIndex)]);
  });
  screen.querySelectorAll('[data-resource-dialog-close]').forEach((button) => button.addEventListener('click', () => detailDialog?.close()));
  detailDialog?.addEventListener('click', (event) => { if (event.target === detailDialog) detailDialog.close(); });

  const loader = loaders[screen.dataset.payResourcePage];
  Promise.resolve(loader?.())
    .then((data) => {
      rows = Array.isArray(data) ? data : [];
      populateStatuses();
      state.hidden = true;
      render();
    })
    .catch((error) => {
      console.error('Pay resource page:', error);
      state.innerHTML = '<span class="resource-spinner" style="animation:none"></span><div><strong>Données momentanément indisponibles</strong><small>Stripe ou PayPal n’a pas répondu. Réessaie dans un instant.</small></div>';
      count.textContent = 'Connexion interrompue';
    });
}

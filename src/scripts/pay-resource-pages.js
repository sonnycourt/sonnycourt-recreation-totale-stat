import { collectPaySources, requirePaySource } from './pay-source-results.js';
import { matchesResourceFilter, normalizeResourceFilter, normalizeResourceView, normalizeSavedResourceViews } from './pay-resource-filters.js';
import { addPayNote, normalizePayNotesStore, payNotesEntityKey, removePayNote } from './pay-resource-notes.js';
import { payOrderPlainValues } from './pay-resource-rows.js';
import { normalizePayPageSize, payPageButtons, payPageItems } from './pay-resource-pagination.js';
import { findPayDraft, markPayDraftPublished, payDraftEditUrl, removePayDraft } from './pay-draft-store.js';
import {
  payCatalogDraftConfirmation,
  payCatalogDraftIdempotencyKey,
  payCatalogDraftInput,
  payCatalogDraftKind,
} from './pay-catalog-draft.js';

const screen = document.querySelector('[data-pay-resource-page]');

if (screen) {
  const API_STRIPE = '/.netlify/functions/pay-stripe-data';
  const API_PAYPAL = '/.netlify/functions/pay-paypal-data';
  const API_HISTORY = '/.netlify/functions/pay-history';
  const DAY = 86_400_000;
  const search = screen.querySelector('[data-resource-search]');
  const providerFilter = screen.querySelector('[data-resource-provider]');
  const statusFilter = screen.querySelector('[data-resource-status]');
  const count = screen.querySelector('[data-resource-count]');
  const state = screen.querySelector('[data-resource-state]');
  const table = screen.querySelector('[data-resource-table]');
  const rowsHost = screen.querySelector('[data-resource-rows]');
  const pagination = screen.querySelector('[data-resource-pagination]');
  const pageSummary = screen.querySelector('[data-resource-page-summary]');
  const pageSizeSelect = screen.querySelector('[data-resource-page-size]');
  const pageButtons = screen.querySelector('[data-resource-page-buttons]');
  const pagePrevious = screen.querySelector('[data-resource-page-previous]');
  const pageNext = screen.querySelector('[data-resource-page-next]');
  const empty = screen.querySelector('[data-resource-empty]');
  const detailDialog = screen.querySelector('[data-resource-dialog]');
  const detailTitle = screen.querySelector('[data-resource-dialog-title]');
  const detailContent = screen.querySelector('[data-resource-dialog-content]');
  const detailActions = screen.querySelector('[data-resource-dialog-actions]');
  const detailEdit = screen.querySelector('[data-resource-dialog-edit]');
  const detailPublish = screen.querySelector('[data-resource-dialog-publish]');
  const detailDelete = screen.querySelector('[data-resource-dialog-delete]');
  const publishDialog = screen.querySelector('[data-resource-publish-dialog]');
  const publishTitle = screen.querySelector('[data-resource-publish-title]');
  const publishState = screen.querySelector('[data-resource-publish-state]');
  const publishPlan = screen.querySelector('[data-resource-publish-plan]');
  const publishConfirmWrap = screen.querySelector('[data-resource-publish-confirm-wrap]');
  const publishConfirm = screen.querySelector('[data-resource-publish-confirm]');
  const publishConfirmHint = screen.querySelector('[data-resource-publish-confirm-hint]');
  const publishExecute = screen.querySelector('[data-resource-publish-execute]');
  const notesSection = screen.querySelector('[data-resource-notes]');
  const notesList = screen.querySelector('[data-resource-notes-list]');
  const noteInput = screen.querySelector('[data-resource-note-input]');
  const notesStorageKey = 'pay_resource_notes_v1';
  const notesEnabled = ['orders', 'customers', 'payment-plans'].includes(screen.dataset.payResourcePage);
  const advancedDialog = screen.querySelector('[data-resource-filter-dialog]');
  const advancedColumn = screen.querySelector('[data-resource-filter-column]');
  const advancedOperator = screen.querySelector('[data-resource-filter-operator]');
  const advancedValue = screen.querySelector('[data-resource-filter-value]');
  const filterSummary = screen.querySelector('[data-resource-filter-summary]');
  const filterSummaryText = screen.querySelector('[data-resource-filter-summary-text]');
  const viewsDialog = screen.querySelector('[data-resource-views-dialog]');
  const viewsList = screen.querySelector('[data-resource-views-list]');
  const viewName = screen.querySelector('[data-resource-view-name]');
  const columns = JSON.parse(screen.dataset.resourceColumns || '[]');
  const viewsStorageKey = `pay_resource_views_${screen.dataset.payResourcePage}`;
  const pageSizeStorageKey = 'pay_resource_page_size';
  let rows = [];
  let sourceLabels = [];
  let activeAdvancedFilter = normalizeResourceFilter({}, columns.length);
  let savedViews = readSavedViews();
  let activeNoteEntityKey = '';
  let activeDetailItem = null;
  let activePublication = null;
  let noteStore = readNoteStore();
  let currentPage = 1;
  let pageSize = readPageSize();

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const stripeId = (value) => typeof value === 'string' ? value : value?.id || '';
  const initialQuery = clean(new URLSearchParams(location.search).get('q') || '');
  if (search && initialQuery) search.value = initialQuery;

  function readSavedViews() {
    try { return normalizeSavedResourceViews(JSON.parse(localStorage.getItem(viewsStorageKey) || '[]'), columns.length); }
    catch { return []; }
  }

  function writeSavedViews() {
    localStorage.setItem(viewsStorageKey, JSON.stringify(savedViews));
  }

  function readNoteStore() {
    try { return normalizePayNotesStore(JSON.parse(sessionStorage.getItem(notesStorageKey) || '{}')); }
    catch { return {}; }
  }

  function writeNoteStore() {
    sessionStorage.setItem(notesStorageKey, JSON.stringify(noteStore));
  }

  function readPageSize() {
    try { return normalizePayPageSize(localStorage.getItem(pageSizeStorageKey)); }
    catch { return normalizePayPageSize(); }
  }

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

  function providerLabel(provider) {
    return provider === 'paypal' ? 'PayPal' : provider === 'spiffy' ? 'Spiffy' : provider === 'internal' ? 'Pay' : provider === 'stripe' ? 'Stripe' : clean(provider) || 'Inconnu';
  }

  function providerCell(provider, providers = []) {
    const values = [...new Set((Array.isArray(providers) && providers.length ? providers : [provider]).map((value) => clean(value).toLowerCase()).filter(Boolean))];
    const label = values.map(providerLabel).join(' + ') || providerLabel(provider);
    return `<span class="resource-provider resource-provider--${escapeHtml(provider)}">${escapeHtml(label)}</span>`;
  }

  function customerLifetimeText(customer) {
    const values = customer?.lifetime_values && typeof customer.lifetime_values === 'object' ? Object.entries(customer.lifetime_values) : [];
    return values.length ? values.map(([currency, amount]) => money(amount, currency)).join(' + ') : money(customer?.lifetime_value, customer?.currency);
  }

  function badge(label) {
    const normalized = clean(label).toLowerCase();
    const success = /réussi|actif|active|paid|complete|succeeded|trialing/.test(normalized);
    const warning = /attente|past|retard|open|pending|incomplete/.test(normalized);
    return `<span class="pay-badge ${success ? 'pay-badge--success' : warning ? 'pay-badge--warning' : 'pay-badge--draft'}">${escapeHtml(label || 'Inconnu')}</span>`;
  }

  function row(values, plain, provider, status, sortTime = 0, externalId = '', options = {}) {
    return {
      values,
      plain: plain.map((value) => String(value ?? '')),
      provider,
      status: clean(status).toLowerCase() || 'inconnu',
      search: plain.join(' ').toLowerCase(),
      sortTime: Number(sortTime || 0),
      externalId: clean(String(externalId || '')),
      ...options,
    };
  }

  function sourcesFrom(result, labels = {}) {
    sourceLabels = result.available.map((source) => labels[source] || source);
    return result.values;
  }

  function useHistorySource() {
    sourceLabels = ['Historique Pay'];
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

  async function fetchPayPalResource(resource, maxPages = 8) {
    const data = [];
    let nextPage = 1;
    for (let page = 0; page < maxPages && nextPage; page += 1) {
      const parameters = new URLSearchParams({ resource, page: String(nextPage) });
      const response = await fetch(`${API_PAYPAL}?${parameters}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.connected) throw new Error(payload.error || `paypal_${resource}_failed`);
      data.push(...(Array.isArray(payload.data) ? payload.data : []));
      nextPage = payload.has_more && payload.next_page ? Number(payload.next_page) : 0;
    }
    if (nextPage) throw new Error(`paypal_${resource}_truncated`);
    return data;
  }

  async function fetchHistory(resource) {
    try {
      const response = await fetch(`${API_HISTORY}?${new URLSearchParams({ resource })}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ready || !Array.isArray(payload.rows) || payload.rows.length === 0) return null;
      return payload.rows;
    } catch {
      return null;
    }
  }

  function stripeStatus(value) {
    if (value === 'refunded') return 'Remboursé';
    if (value === 'completed') return 'Terminé';
    if (value === 'expired') return 'Terminé';
    if (value === 'unpaid') return 'Impayé';
    if (['active', 'trialing'].includes(value)) return 'Actif';
    if (['succeeded', 'paid', 'complete'].includes(value)) return 'Réussi';
    if (['processing', 'open', 'pending', 'approval_pending', 'approved', 'incomplete', 'past_due'].includes(value)) return value === 'past_due' ? 'En retard' : 'En attente';
    if (value === 'suspended') return 'En retard';
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
    let drafts = [];
    try { drafts = JSON.parse(sessionStorage.getItem('pay_order_drafts') || '[]'); } catch {}
    const draftRows = Array.isArray(drafts) ? drafts.filter((draft) => draft.status !== 'published').map((draft) => {
      const status = 'Brouillon';
      const created = date(draft.createdAt);
      const amount = money(Math.round(Number(draft.checkoutAmount || 0) * 100), draft.currency || 'EUR');
      const description = draft.checkoutName || 'Commande manuelle';
      const customer = draft.customerName || 'Client';
      return row([
        `<strong>${escapeHtml(description)}</strong><small>#brouillon-${escapeHtml(draft.id)}</small>`,
        `<strong>${escapeHtml(customer)}</strong><small>${escapeHtml(draft.customerEmail || '')}</small>`,
        created, providerCell('internal'), badge(status), `<strong>${amount}</strong>`,
      ], payOrderPlainValues({ description, customer, email: draft.customerEmail, created, provider: 'Pay', status, total: amount }), 'internal', 'brouillon', Math.floor(new Date(draft.createdAt || Number(draft.id || 0)).getTime() / 1_000), `brouillon-${draft.id}`);
    }) : [];
    const history = await fetchHistory('orders');
    if (history) {
      sourceLabels = draftRows.length ? ['Pay', 'Historique Pay'] : ['Historique Pay'];
      const historyRows = history.map((item) => {
        const status = stripeStatus(item.status);
        const created = date(item.created_at);
        return row([
          `<strong>${escapeHtml(item.description)}</strong><small>#${escapeHtml(item.id)}</small>`,
          `<strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.email)}</small>`,
          created, providerCell(item.provider), badge(status), `<strong>${money(item.amount, item.currency)}</strong>`,
        ], payOrderPlainValues({ description: item.description, customer: item.customer, email: item.email, created, provider: item.provider, status, total: money(item.amount, item.currency) }), item.provider, status, Math.floor(new Date(item.created_at).getTime() / 1_000), item.id);
      });
      return [...draftRows, ...historyRows].sort((a, b) => b.sortTime - a.sortTime);
    }
    const sources = await collectPaySources({
      stripe: fetchStripeAll('payment_intents', 20),
      paypal: fetchPayPal(366),
    });
    if (!draftRows.length) requirePaySource(sources, 'pay_order_sources_unavailable');
    const values = sourcesFrom(sources, { stripe: 'Stripe', paypal: 'PayPal' });
    sourceLabels = [...new Set([...(draftRows.length ? ['Pay'] : []), ...sourceLabels])];
    const intents = values.stripe || [];
    const paypal = values.paypal || [];
    const stripeRows = intents.map((intent) => {
      const customer = stripeCustomer(intent);
      const amount = Number(intent.amount_received || intent.amount || 0);
      const status = stripeStatus(intent.status);
      const description = clean(intent.description || intent.metadata?.offer_name || intent.metadata?.offer_slug) || 'Commande Stripe';
      return row([
        `<strong>${escapeHtml(description)}</strong><small>#${escapeHtml(intent.id)}</small>`,
        `<strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email)}</small>`,
        date(intent.created), providerCell('stripe'), badge(status), `<strong>${money(amount, intent.currency)}</strong>`,
      ], payOrderPlainValues({ description, customer: customer.name, email: customer.email, created: date(intent.created), provider: 'Stripe', status, total: money(amount, intent.currency) }), 'stripe', status, intent.created, intent.id);
    });
    const paypalRows = paypal.filter((item) => ['sale', 'payment_plan'].includes(item.kind)).map((item) => row([
      `<strong>${escapeHtml(item.description)}</strong><small>#${escapeHtml(item.id)}</small>`,
      `<strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.email)}</small>`,
      date(item.created), providerCell('paypal'), badge(item.status), `<strong>${money(item.amount, item.currency)}</strong>`,
    ], payOrderPlainValues({ description: item.description, customer: item.customer, email: item.email, created: date(item.created), provider: 'PayPal', status: item.status, total: money(item.amount, item.currency) }), 'paypal', item.status, item.created, item.id));
    return [...draftRows, ...stripeRows, ...paypalRows].sort((a, b) => b.sortTime - a.sortTime);
  }

  async function loadCustomers() {
    const history = await fetchHistory('customers');
    if (history) {
      useHistorySource();
      return history.map((customer) => {
        const status = 'Actif';
        const providers = Array.isArray(customer.providers) && customer.providers.length ? customer.providers : [customer.provider];
        const providerText = providers.map(providerLabel).join(' + ');
        const lifetime = customerLifetimeText(customer);
        const stripeIdentity = (customer.identities || []).find((identity) => identity.provider === 'stripe')?.id || (customer.provider === 'stripe' ? customer.id : '');
        return row([
          `<strong>${escapeHtml(customer.name)}</strong><small>#${escapeHtml(customer.id)}</small>`, escapeHtml(customer.email || '—'), providerCell(customer.provider, providers), String(customer.order_count), `<strong>${escapeHtml(lifetime)}</strong>`, badge(status),
        ], [customer.name, customer.email, providerText, customer.order_count, lifetime, status], customer.provider, status, Math.floor(new Date(customer.updated_at || customer.created_at).getTime() / 1_000), customer.id, {
          providers,
          details: [
            ['Prénom', customer.first_name || '—'], ['Nom', customer.last_name || '—'], ['Téléphone', customer.phone || '—'], ['Pays', customer.country || '—'],
            ['Créé le', date(customer.created_at)], ['Mis à jour le', date(customer.updated_at)], ['Identités rapprochées', String(customer.source_count || 1)],
          ],
          customerProfile: { provider: customer.provider, stripeCustomerId: stripeIdentity, email: customer.email || '' },
        });
      });
    }
    const sources = requirePaySource(await collectPaySources({
      stripeCustomers: fetchStripeAll('customers', 20),
      stripePayments: fetchStripeAll('payment_intents', 20),
      paypal: fetchPayPal(366),
    }), 'pay_customer_sources_unavailable');
    const values = sourcesFrom(sources, { stripeCustomers: 'Stripe', stripePayments: 'Stripe', paypal: 'PayPal' });
    sourceLabels = [...new Set(sourceLabels)];
    const customers = values.stripeCustomers || [];
    const intents = values.stripePayments || [];
    const paypal = values.paypal || [];
    const valueByCustomer = new Map();
    intents.filter((item) => item.status === 'succeeded').forEach((item) => {
      const id = stripeId(item.customer) || stripeCustomer(item).email;
      if (!id) return;
      const current = valueByCustomer.get(id) || { value: 0, orders: 0, currency: item.currency || 'eur' };
      current.value += Number(item.amount_received || item.amount || 0);
      current.orders += 1;
      valueByCustomer.set(id, current);
    });
    const knownStripeCustomers = customers.length ? customers : [...new Map(intents.map((intent) => {
      const details = stripeCustomer(intent);
      const id = stripeId(intent.customer) || details.email;
      return id ? [id, { id, name: details.name, email: details.email, currency: intent.currency || 'eur', created: intent.created }] : null;
    }).filter(Boolean)).values()];
    const stripeRows = knownStripeCustomers.map((customer) => {
      const email = clean(customer.email).toLowerCase();
      const aggregate = valueByCustomer.get(customer.id) || valueByCustomer.get(email) || { value: 0, orders: 0, currency: customer.currency || 'eur' };
      const name = clean(customer.name) || email || 'Client Stripe';
      const status = customer.delinquent ? 'En retard' : 'Actif';
      const address = customer.address || customer.shipping?.address || {};
      const defaultMethod = customer.invoice_settings?.default_payment_method || customer.default_source || null;
      const defaultMethodId = stripeId(defaultMethod);
      return row([
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(customer.id)}</small>`, escapeHtml(email || '—'), providerCell('stripe'), String(aggregate.orders), `<strong>${money(aggregate.value, aggregate.currency)}</strong>`, badge(status),
      ], [name, email, 'Stripe', aggregate.orders, money(aggregate.value, aggregate.currency), status], 'stripe', status, Number(customer.created || 0), customer.id || email, {
        providers: ['stripe'],
        details: [
          ['Téléphone', customer.phone || '—'], ['Pays', address.country || '—'], ['Ville', address.city || '—'], ['Code postal', address.postal_code || '—'],
          ['Créé le', date(customer.created)], ['Défaut de paiement', customer.delinquent ? 'Oui' : 'Non'],
        ],
        customerProfile: { provider: 'stripe', stripeCustomerId: customer.id, defaultMethodId, email },
      });
    });
    const paypalMap = new Map();
    paypal.filter((item) => item.email).forEach((item) => {
      const current = paypalMap.get(item.email) || { name: item.customer, email: item.email, value: 0, orders: 0, currency: item.currency, status: 'Actif' };
      if (item.status === 'Réussi' && ['sale', 'payment_plan'].includes(item.kind)) { current.value += item.signed_amount; current.orders += 1; }
      paypalMap.set(item.email, current);
    });
    const paypalRows = [...paypalMap.values()].map((customer) => row([
      `<strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email)}</small>`, escapeHtml(customer.email), providerCell('paypal'), String(customer.orders), `<strong>${money(customer.value, customer.currency)}</strong>`, badge(customer.status),
    ], [customer.name, customer.email, 'PayPal', customer.orders, money(customer.value, customer.currency), customer.status], 'paypal', customer.status, 0, customer.email, {
      providers: ['paypal'],
      details: [['Email PayPal', customer.email], ['Transactions connues', String(customer.orders)]],
      customerProfile: { provider: 'paypal', email: customer.email },
    }));
    return [...stripeRows, ...paypalRows];
  }

  function subscriptionAmount(subscription) {
    const price = subscription.items?.data?.[0]?.price;
    return { amount: Number(price?.unit_amount || 0), currency: price?.currency || subscription.currency || 'eur', interval: price?.recurring?.interval || 'mois' };
  }

  async function loadSubscriptions(paymentPlansOnly = false) {
    const history = await fetchHistory(paymentPlansOnly ? 'payment_plans' : 'subscriptions');
    if (history) {
      useHistorySource();
      return history.map((item) => {
        const status = stripeStatus(item.status);
        const interval = item.interval_count > 1 ? `${item.interval_count} ${item.interval_unit}` : item.interval_unit;
        const name = item.customer || item.email || `Client ${item.provider}`;
        return row(paymentPlansOnly ? [
          `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(item.id)}</small>`, providerCell(item.provider), `<strong>${money(item.amount, item.currency)} / ${escapeHtml(interval)}</strong>`, item.installment_count ? `${item.installments_paid}/${item.installment_count}` : 'Récurrent', date(item.next_payment_at, true), badge(status),
        ] : [
          `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(item.id)}</small>`, providerCell(item.provider), `<strong>${money(item.amount, item.currency)} / ${escapeHtml(interval)}</strong>`, date(item.current_period_end, true), badge(status),
        ], paymentPlansOnly ? [name, item.provider, money(item.amount, item.currency), item.installment_count ? `${item.installments_paid}/${item.installment_count}` : 'Récurrent', date(item.next_payment_at, true), status] : [name, item.provider, money(item.amount, item.currency), date(item.current_period_end, true), status], item.provider, status, Math.floor(new Date(item.created_at).getTime() / 1_000), item.id);
      });
    }
    const sources = await collectPaySources({
      stripe: fetchStripeAll('subscriptions', 20),
      paypalNative: Promise.all([fetchPayPalResource('subscriptions', 20), fetchPayPalResource('plans', 8)])
        .then(([subscriptions, plans]) => ({ subscriptions, plans })),
    });
    let paypalFallback = null;
    if (!sources.values.paypalNative) {
      try { paypalFallback = await fetchPayPal(366); } catch {}
    }
    if (!sources.values.stripe && !sources.values.paypalNative && !paypalFallback) {
      throw new Error('pay_subscription_sources_unavailable');
    }
    sourceLabels = [
      ...(sources.values.stripe ? ['Stripe'] : []),
      ...(sources.values.paypalNative || paypalFallback ? ['PayPal'] : []),
    ];
    const subscriptions = (sources.values.stripe || []).filter((subscription) => {
      const installmentCount = Number(subscription.metadata?.installment_count || 0);
      return paymentPlansOnly ? installmentCount > 0 : installmentCount === 0;
    });
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
      ], paymentPlansOnly ? [name, 'Stripe', money(pricing.amount, pricing.currency), total ? `${paid}/${total}` : 'Récurrent', date(subscription.current_period_end, true), status] : [name, 'Stripe', money(pricing.amount, pricing.currency), date(subscription.current_period_end, true), status], 'stripe', status, 0, subscription.id);
    });
    if (sources.values.paypalNative) {
      const plansById = new Map(sources.values.paypalNative.plans.map((plan) => [plan.id, plan]));
      const paypalRows = sources.values.paypalNative.subscriptions.flatMap((subscription) => {
        const plan = plansById.get(subscription.plan_id) || null;
        const installment = plan?.billing_type === 'installment';
        if (paymentPlansOnly !== installment) return [];
        const first = subscription.subscriber?.name?.given_name || '';
        const last = subscription.subscriber?.name?.surname || '';
        const name = clean(`${first} ${last}`) || subscription.subscriber?.email_address || 'Client PayPal';
        const status = stripeStatus(subscription.status);
        const amount = plan ? money(plan.unit_amount_minor, plan.currency) : '—';
        const completed = (subscription.cycle_executions || []).reduce((total, cycle) => total + Number(cycle.cycles_completed || 0), 0);
        const cadence = plan?.interval_unit ? `${plan.interval_count || 1} ${plan.interval_unit}` : 'cadence inconnue';
        return [row(paymentPlansOnly ? [
          `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(subscription.id)}</small>`, providerCell('paypal'), `<strong>${escapeHtml(amount)} / ${escapeHtml(cadence)}</strong>`, plan?.installment_count ? `${completed}/${plan.installment_count}` : '—', date(subscription.next_billing_time, true), badge(status),
        ] : [
          `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(subscription.id)}</small>`, providerCell('paypal'), `<strong>${escapeHtml(amount)} / ${escapeHtml(cadence)}</strong>`, date(subscription.next_billing_time, true), badge(status),
        ], paymentPlansOnly ? [name, 'PayPal', amount, plan?.installment_count ? `${completed}/${plan.installment_count}` : '—', date(subscription.next_billing_time, true), status] : [name, 'PayPal', amount, date(subscription.next_billing_time, true), status], 'paypal', status, Math.floor(new Date(subscription.create_time || 0).getTime() / 1_000), subscription.id)];
      });
      return [...stripeRows, ...paypalRows];
    }
    const paypalGroups = new Map();
    (paypalFallback || []).filter((item) => item.is_plan_payment && item.reference_id).forEach((item) => {
      const current = paypalGroups.get(item.reference_id) || { id: item.reference_id, customer: item.customer, amount: item.amount, currency: item.currency, count: 0, latest: 0, status: item.status };
      current.count += item.status === 'Réussi' ? 1 : 0;
      current.latest = Math.max(current.latest, item.created);
      current.status = item.status;
      paypalGroups.set(item.reference_id, current);
    });
    const paypalRows = [...paypalGroups.values()].map((plan) => row(paymentPlansOnly ? [
      `<strong>${escapeHtml(plan.customer)}</strong><small>#${escapeHtml(plan.id)}</small>`, providerCell('paypal'), `<strong>${money(plan.amount, plan.currency)}</strong>`, `${plan.count} encaissée${plan.count === 1 ? '' : 's'}`, '—', badge(plan.status),
    ] : [
      `<strong>${escapeHtml(plan.customer)}</strong><small>#${escapeHtml(plan.id)}</small>`, providerCell('paypal'), `<strong>${money(plan.amount, plan.currency)}</strong>`, '—', badge(plan.status),
    ], paymentPlansOnly ? [plan.customer, 'PayPal', money(plan.amount, plan.currency), plan.count, '—', plan.status] : [plan.customer, 'PayPal', money(plan.amount, plan.currency), '—', plan.status], 'paypal', plan.status, 0, plan.id));
    return [...stripeRows, ...paypalRows];
  }

  async function loadProducts() {
    let drafts = [];
    try { drafts = JSON.parse(localStorage.getItem('pay_product_drafts') || '[]'); } catch {}
    const draftRows = Array.isArray(drafts) ? drafts.filter((draft) => draft.status !== 'published').map((draft) => {
      const billing = draft.billingType === 'recurring' ? `Tous les ${draft.intervalCount || 1} ${draft.intervalUnit || 'month'}` : 'Paiement unique';
      const status = 'Brouillon';
      return row([
        `<strong>${escapeHtml(draft.name || 'Produit sans nom')}</strong><small>#brouillon-${escapeHtml(draft.id)}</small>`, providerCell('internal'), escapeHtml(billing), `<strong>${money(Math.round(Number(draft.amount || 0) * 100), draft.currency || 'eur')}</strong>`, badge(status),
      ], [draft.name || 'Produit sans nom', 'Pay', billing, money(Math.round(Number(draft.amount || 0) * 100), draft.currency || 'eur'), status], 'internal', 'brouillon', Math.floor(Number(draft.id || 0) / 1000), String(draft.id), { draftKind: 'products' });
    }) : [];
    const history = await fetchHistory('products');
    if (history) {
      sourceLabels = draftRows.length ? ['Pay', 'Historique Pay'] : ['Historique Pay'];
      const historyRows = history.flatMap((product) => {
        const prices = product.prices?.length ? product.prices : [{ id: product.id, provider: product.provider, amount: 0, currency: 'eur', billing_type: 'unknown', active: product.active }];
        return prices.map((price) => {
          const billing = price.billing_type === 'recurring' ? `Tous les ${price.interval_count || 1} ${price.interval_unit || 'mois'}` : price.billing_type === 'installment' ? `${price.installment_count || '—'} échéances` : price.billing_type === 'one_time' ? 'Paiement unique' : 'Prix non renseigné';
          const status = product.active && price.active ? 'Actif' : 'Archivé';
          return row([
            `<strong>${escapeHtml(product.name)}</strong><small>#${escapeHtml(price.id)}</small>`, providerCell(product.provider), escapeHtml(billing), `<strong>${price.billing_type === 'unknown' ? '—' : money(price.amount, price.currency)}</strong>`, badge(status),
          ], [product.name, product.provider, billing, price.billing_type === 'unknown' ? '—' : money(price.amount, price.currency), status], product.provider, status, Math.floor(new Date(product.created_at).getTime() / 1_000));
        });
      });
      return [...draftRows, ...historyRows];
    }
    const sources = await collectPaySources({
      stripe: fetchStripeAll('prices', 20),
      paypal: Promise.all([fetchPayPalResource('products', 8), fetchPayPalResource('plans', 8)])
        .then(([products, plans]) => ({ products, plans })),
    });
    if (!draftRows.length) requirePaySource(sources, 'pay_product_sources_unavailable');
    const values = sourcesFrom(sources, { stripe: 'Stripe', paypal: 'PayPal' });
    sourceLabels = [...new Set([...(draftRows.length ? ['Pay'] : []), ...sourceLabels])];
    const stripeRows = (values.stripe || []).map((price) => {
      const product = typeof price.product === 'object' ? price.product : null;
      const name = clean(product?.name || price.nickname) || stripeId(price.product) || 'Produit Stripe';
      const billing = price.type === 'recurring' ? `Tous les ${price.recurring?.interval_count || 1} ${price.recurring?.interval || 'mois'}` : 'Paiement unique';
      const status = price.active && product?.active !== false ? 'Actif' : 'Archivé';
      return row([
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(price.id)}</small>`, providerCell('stripe'), escapeHtml(billing), `<strong>${money(price.unit_amount, price.currency)}</strong>`, badge(status),
      ], [name, 'Stripe', billing, money(price.unit_amount, price.currency), status], 'stripe', status);
    });
    const paypalCatalog = values.paypal || { products: [], plans: [] };
    const paypalProducts = new Map((paypalCatalog.products || []).map((product) => [product.id, product]));
    const planProductIds = new Set();
    const paypalPlanRows = (paypalCatalog.plans || []).map((plan) => {
      if (plan.product_id) planProductIds.add(plan.product_id);
      const product = paypalProducts.get(plan.product_id);
      const name = product?.name || plan.name || plan.product_id || 'Produit PayPal';
      const billing = plan.billing_type === 'installment'
        ? `${plan.installment_count || '—'} échéances · tous les ${plan.interval_count || 1} ${plan.interval_unit || 'mois'}`
        : `Tous les ${plan.interval_count || 1} ${plan.interval_unit || 'mois'}`;
      const status = plan.status === 'active' ? 'Actif' : 'Archivé';
      return row([
        `<strong>${escapeHtml(name)}</strong><small>#${escapeHtml(plan.id)}</small>`, providerCell('paypal'), escapeHtml(billing), `<strong>${money(plan.unit_amount_minor, plan.currency)}</strong>`, badge(status),
      ], [name, 'PayPal', billing, money(plan.unit_amount_minor, plan.currency), status], 'paypal', status, Math.floor(new Date(plan.create_time || 0).getTime() / 1_000), plan.id);
    });
    const paypalProductRows = (paypalCatalog.products || []).filter((product) => !planProductIds.has(product.id)).map((product) => {
      const status = product.status === 'archived' ? 'Archivé' : 'Actif';
      return row([
        `<strong>${escapeHtml(product.name)}</strong><small>#${escapeHtml(product.id)}</small>`, providerCell('paypal'), 'Prix non renseigné', '<strong>—</strong>', badge(status),
      ], [product.name, 'PayPal', 'Prix non renseigné', '—', status], 'paypal', status, Math.floor(new Date(product.create_time || 0).getTime() / 1_000), product.id);
    });
    return [...draftRows, ...stripeRows, ...paypalPlanRows, ...paypalProductRows];
  }

  async function loadCheckouts() {
    let drafts = [];
    try { drafts = JSON.parse(localStorage.getItem('pay_checkout_drafts') || '[]'); } catch {}
    const draftRows = Array.isArray(drafts) ? drafts.filter((draft) => draft.status !== 'published').map((draft) => {
      const status = 'Brouillon';
      return row([
        `<strong>${escapeHtml(draft.name || 'Checkout sans nom')}</strong><small>#brouillon-${escapeHtml(draft.id)}</small>`, providerCell('internal'), `<strong>${money(Math.round(Number(draft.amount || 0) * 100), draft.currency || 'EUR')}</strong>`, badge(status), 'Non publié',
      ], [draft.name || 'Checkout sans nom', 'Pay', money(Math.round(Number(draft.amount || 0) * 100), draft.currency || 'EUR'), status, 'Non publié'], 'internal', 'brouillon', Math.floor(Number(draft.id || 0) / 1000), String(draft.id), { draftKind: 'checkouts' });
    }) : [];
    const history = await fetchHistory('checkouts');
    if (history) {
      sourceLabels = draftRows.length ? ['Pay', 'Historique Pay'] : ['Historique Pay'];
      const historyRows = history.map((item) => {
        const status = stripeStatus(item.status);
        const linkHtml = item.public_url ? `<a href="${escapeHtml(item.public_url)}" target="_blank" rel="noreferrer">Ouvrir ↗</a>` : '—';
        return row([
          `<strong>${escapeHtml(item.name)}</strong><small>#${escapeHtml(item.id)}</small>`, providerCell(item.provider), '—', badge(status), linkHtml,
        ], [item.name, item.provider, '—', status, item.public_url || ''], item.provider, status, Math.floor(new Date(item.created_at).getTime() / 1_000));
      });
      return [...draftRows, ...historyRows];
    }
    const sources = await collectPaySources({ stripe: fetchStripeAll('payment_links', 20) });
    if (!draftRows.length) requirePaySource(sources, 'pay_checkout_sources_unavailable');
    const values = sourcesFrom(sources, { stripe: 'Stripe' });
    sourceLabels = [...new Set([...(draftRows.length ? ['Pay'] : []), ...sourceLabels])];
    const stripeRows = (values.stripe || []).map((link) => {
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
    return [...draftRows, ...stripeRows];
  }

  async function loadDiscounts() {
    const history = await fetchHistory('discounts');
    let drafts = [];
    try { drafts = JSON.parse(localStorage.getItem('pay_discount_drafts') || '[]'); } catch {}
    if (!Array.isArray(drafts)) drafts = [];
    const draftRows = drafts.filter((draft) => draft.status !== 'published').map((draft) => {
      const value = draft.type === 'percentage' ? `${draft.value} %` : money(Math.round(Number(draft.value || 0) * 100), draft.currency || 'eur');
      return row([
        `<strong>${escapeHtml(draft.code)}</strong><small>#brouillon-${escapeHtml(draft.id)}</small>`, providerCell('internal'), `<strong>${escapeHtml(value)}</strong>`, draft.expiresAt ? date(draft.expiresAt, true) : 'Sans expiration', '0', badge('Brouillon'),
      ], [draft.code, 'Pay', value, draft.expiresAt ? date(draft.expiresAt, true) : 'Sans expiration', 0, 'Brouillon'], 'internal', 'brouillon', Math.floor(Number(draft.id || 0) / 1000), String(draft.id), { draftKind: 'discounts' });
    });
    if (history) {
      sourceLabels = draftRows.length ? ['Pay', 'Historique Pay'] : ['Historique Pay'];
      const historyRows = history.map((discount) => {
        const value = discount.type === 'percentage' ? `${discount.percent_off || 0} %` : money(discount.amount || 0, discount.currency || 'eur');
        const status = stripeStatus(discount.status);
        return row([
          `<strong>${escapeHtml(discount.code)}</strong><small>#${escapeHtml(discount.id)}</small>`, providerCell(discount.provider), `<strong>${escapeHtml(value)}</strong>`, discount.expires_at ? date(discount.expires_at, true) : 'Sans expiration', `${discount.redeemed_count || 0}${discount.max_redemptions ? ` / ${discount.max_redemptions}` : ''}`, badge(status),
        ], [discount.code, discount.provider, value, discount.expires_at ? date(discount.expires_at, true) : 'Sans expiration', discount.redeemed_count || 0, status], discount.provider, status, Math.floor(new Date(discount.created_at).getTime() / 1_000));
      });
      return [...draftRows, ...historyRows];
    }
    const sources = await collectPaySources({
      coupons: fetchStripeAll('coupons', 10),
      promotionCodes: fetchStripeAll('promotion_codes', 10),
    });
    if (!draftRows.length) requirePaySource(sources, 'pay_discount_sources_unavailable');
    const values = sourcesFrom(sources, { coupons: 'Stripe', promotionCodes: 'Stripe' });
    sourceLabels = [...new Set([...(draftRows.length ? ['Pay'] : []), ...sourceLabels])];
    const coupons = values.coupons || [];
    const promotionCodes = values.promotionCodes || [];
    const couponById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    const stripeRows = promotionCodes.map((promotion) => {
      const coupon = promotion.coupon || promotion.promotion?.coupon || couponById.get(stripeId(promotion.coupon)) || {};
      const value = coupon.percent_off != null ? `${coupon.percent_off} %` : money(coupon.amount_off || 0, coupon.currency || 'eur');
      const status = promotion.active && (!promotion.expires_at || promotion.expires_at * 1_000 > Date.now()) ? 'Actif' : 'Expiré';
      return row([
        `<strong>${escapeHtml(promotion.code || promotion.id)}</strong><small>#${escapeHtml(promotion.id)}</small>`, providerCell('stripe'), `<strong>${escapeHtml(value)}</strong>`, promotion.expires_at ? date(promotion.expires_at, true) : 'Sans expiration', `${promotion.times_redeemed || 0}${promotion.max_redemptions ? ` / ${promotion.max_redemptions}` : ''}`, badge(status),
      ], [promotion.code || promotion.id, 'Stripe', value, promotion.expires_at ? date(promotion.expires_at, true) : 'Sans expiration', promotion.times_redeemed || 0, status], 'stripe', status);
    });
    return [...draftRows, ...stripeRows];
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

  function currentView(name = '', id = '') {
    return normalizeResourceView({
      id,
      name,
      query: search.value,
      provider: providerFilter.value,
      status: statusFilter.value,
      advanced: activeAdvancedFilter,
    }, columns.length);
  }

  function visibleRows() {
    const view = currentView();
    const query = clean(view.query).toLowerCase();
    return rows.filter((item) => (!query || item.search.includes(query))
      && (view.provider === 'all' || item.provider === view.provider || item.providers?.includes(view.provider))
      && (view.status === 'all' || item.status === view.status)
      && matchesResourceFilter(item, view.advanced, columns.length));
  }

  function filterLabel(filter = activeAdvancedFilter) {
    if (!filter.value) return '';
    const operators = { contains: 'contient', equals: 'est', starts_with: 'commence par', ends_with: 'se termine par', not_contains: 'ne contient pas' };
    return `${columns[filter.column] || 'Colonne'} ${operators[filter.operator] || 'contient'} « ${filter.value} »`;
  }

  function renderFilterSummary() {
    const parts = [];
    if (clean(search.value)) parts.push(`Recherche « ${clean(search.value)} »`);
    if (providerFilter.value !== 'all') parts.push(providerFilter.options[providerFilter.selectedIndex]?.text || providerFilter.value);
    if (statusFilter.value !== 'all') parts.push(statusFilter.options[statusFilter.selectedIndex]?.text || statusFilter.value);
    if (activeAdvancedFilter.value) parts.push(filterLabel());
    filterSummary.hidden = parts.length === 0;
    filterSummaryText.textContent = parts.length ? `Filtres actifs · ${parts.join(' · ')}` : '';
  }

  function render() {
    const visible = visibleRows();
    const page = payPageItems(visible, currentPage, pageSize);
    currentPage = page.page;
    rowsHost.innerHTML = page.items.map((item) => `<div class="resource-row" role="button" tabindex="0" data-resource-index="${rows.indexOf(item)}" data-provider="${escapeHtml(item.provider)}" data-status="${escapeHtml(item.status)}">${item.values.map((value) => `<span>${value}</span>`).join('')}</div>`).join('');
    const sourceSuffix = sourceLabels.length ? ` · ${sourceLabels.join(' + ')}` : '';
    count.textContent = `${visible.length} résultat${visible.length === 1 ? '' : 's'}${sourceSuffix}`;
    table.hidden = visible.length === 0;
    empty.hidden = visible.length !== 0;
    renderPagination(page);
    renderFilterSummary();
  }

  function renderPagination(page) {
    if (!pagination) return;
    pagination.hidden = page.total === 0;
    if (page.total === 0) return;
    if (pageSummary) pageSummary.textContent = `${page.start}–${page.end} sur ${page.total}`;
    if (pageSizeSelect) pageSizeSelect.value = String(page.pageSize);
    if (pagePrevious) pagePrevious.disabled = page.page <= 1;
    if (pageNext) pageNext.disabled = page.page >= page.pageCount;
    if (pageButtons) pageButtons.innerHTML = payPageButtons(page.page, page.pageCount).map((value) => value === 'ellipsis'
      ? '<span class="resource-pagination-ellipsis" aria-hidden="true">…</span>'
      : `<button type="button" data-resource-page="${value}" ${value === page.page ? 'aria-current="page" disabled' : ''}>${value}</button>`).join('');
  }

  function resetPageAndRender() {
    currentPage = 1;
    render();
  }

  function csvValue(value) {
    const normalized = String(value ?? '').replace(/\r?\n/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const headers = [...screen.querySelectorAll('.resource-head > span')].map((item) => item.textContent.trim());
    const exportedRows = visibleRows();
    const content = [headers, ...exportedRows.map((item) => item.plain)].map((line) => line.map(csvValue).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pay-${screen.dataset.payResourcePage}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    window.payToast?.('Export CSV préparé.');
  }

  search.addEventListener('input', resetPageAndRender);
  providerFilter.addEventListener('change', resetPageAndRender);
  statusFilter.addEventListener('change', resetPageAndRender);
  document.querySelector('[data-resource-export]')?.addEventListener('click', exportCsv);

  pageSizeSelect?.addEventListener('change', () => {
    pageSize = normalizePayPageSize(pageSizeSelect.value);
    currentPage = 1;
    try { localStorage.setItem(pageSizeStorageKey, String(pageSize)); } catch {}
    render();
  });
  pagePrevious?.addEventListener('click', () => { currentPage = Math.max(1, currentPage - 1); render(); });
  pageNext?.addEventListener('click', () => { currentPage += 1; render(); });
  pageButtons?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-resource-page]');
    if (!button) return;
    currentPage = Number(button.dataset.resourcePage) || 1;
    render();
  });

  function openAdvancedFilters() {
    advancedColumn.value = String(activeAdvancedFilter.column);
    advancedOperator.value = activeAdvancedFilter.operator;
    advancedValue.value = activeAdvancedFilter.value;
    advancedDialog?.showModal();
  }

  function clearFilters() {
    search.value = '';
    providerFilter.value = 'all';
    statusFilter.value = 'all';
    activeAdvancedFilter = normalizeResourceFilter({}, columns.length);
    resetPageAndRender();
    window.payToast?.('Filtres effacés.');
  }

  function savedViewDescription(view) {
    const parts = [];
    if (view.query) parts.push(`« ${view.query} »`);
    if (view.provider !== 'all') parts.push(view.provider === 'internal' ? 'Pay' : view.provider.charAt(0).toUpperCase() + view.provider.slice(1));
    if (view.status !== 'all') parts.push(view.status);
    if (view.advanced.value) parts.push(filterLabel(view.advanced));
    return parts.length ? parts.join(' · ') : 'Tous les résultats';
  }

  function renderSavedViews() {
    viewsList.innerHTML = savedViews.length ? savedViews.map((view) => `
      <div class="resource-view-row" data-resource-view-id="${escapeHtml(view.id)}">
        <span><strong>${escapeHtml(view.name)}</strong><small>${escapeHtml(savedViewDescription(view))}</small></span>
        <button type="button" data-resource-view-use>Utiliser</button>
        <button type="button" data-resource-view-delete>Supprimer</button>
      </div>`).join('') : '<div class="resource-views-empty">Aucune vue enregistrée pour cette page.</div>';
  }

  function openSavedViews() {
    renderSavedViews();
    viewName.value = '';
    viewsDialog?.showModal();
  }

  function applySavedView(view) {
    search.value = view.query;
    providerFilter.value = view.provider;
    statusFilter.value = [...statusFilter.options].some((option) => option.value === view.status) ? view.status : 'all';
    activeAdvancedFilter = normalizeResourceFilter(view.advanced, columns.length);
    resetPageAndRender();
    viewsDialog?.close();
    window.payToast?.(`Vue « ${view.name} » appliquée.`);
  }

  screen.querySelector('[data-resource-more-filters]')?.addEventListener('click', openAdvancedFilters);
  screen.querySelector('[data-resource-saved-filters]')?.addEventListener('click', openSavedViews);
  screen.querySelector('[data-resource-filter-clear]')?.addEventListener('click', clearFilters);
  screen.querySelector('[data-resource-filter-apply]')?.addEventListener('click', () => {
    activeAdvancedFilter = normalizeResourceFilter({ column: advancedColumn.value, operator: advancedOperator.value, value: advancedValue.value }, columns.length);
    advancedDialog?.close();
    resetPageAndRender();
    window.payToast?.(activeAdvancedFilter.value ? 'Filtre personnalisé appliqué.' : 'Filtre personnalisé effacé.');
  });
  advancedValue?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    screen.querySelector('[data-resource-filter-apply]')?.click();
  });
  screen.querySelectorAll('[data-resource-filter-close]').forEach((button) => button.addEventListener('click', () => advancedDialog?.close()));
  advancedDialog?.addEventListener('click', (event) => { if (event.target === advancedDialog) advancedDialog.close(); });

  screen.querySelector('[data-resource-view-save]')?.addEventListener('click', () => {
    const name = clean(viewName.value);
    if (!name) {
      window.payToast?.('Donne un nom à cette vue.');
      viewName.focus();
      return;
    }
    const view = currentView(name, `${Date.now()}`);
    savedViews = [view, ...savedViews.filter((item) => item.name.toLowerCase() !== name.toLowerCase())].slice(0, 30);
    try { writeSavedViews(); }
    catch { window.payToast?.('Impossible d’enregistrer cette vue dans ce navigateur.'); return; }
    viewName.value = '';
    renderSavedViews();
    window.payToast?.(`Vue « ${view.name} » enregistrée.`);
  });
  viewsList?.addEventListener('click', (event) => {
    const host = event.target.closest('[data-resource-view-id]');
    if (!host) return;
    const view = savedViews.find((item) => item.id === host.dataset.resourceViewId);
    if (!view) return;
    if (event.target.closest('[data-resource-view-use]')) {
      applySavedView(view);
      return;
    }
    const deleteButton = event.target.closest('[data-resource-view-delete]');
    if (!deleteButton) return;
    if (deleteButton.dataset.resourceViewDeleteConfirm !== 'true') {
      deleteButton.dataset.resourceViewDeleteConfirm = 'true';
      deleteButton.textContent = 'Confirmer la suppression';
      return;
    }
    savedViews = savedViews.filter((item) => item.id !== view.id);
    try { writeSavedViews(); } catch {}
    renderSavedViews();
    window.payToast?.(`Vue « ${view.name} » supprimée.`);
  });
  screen.querySelectorAll('[data-resource-views-close]').forEach((button) => button.addEventListener('click', () => viewsDialog?.close()));
  viewsDialog?.addEventListener('click', (event) => { if (event.target === viewsDialog) viewsDialog.close(); });

  function customerMethodLabel(method, defaultMethodId = '') {
    const card = method?.card || {};
    const brand = clean(card.brand || method?.type || 'carte');
    const last4 = clean(card.last4) ? `•••• ${clean(card.last4)}` : '';
    const expiry = card.exp_month && card.exp_year ? ` · ${String(card.exp_month).padStart(2, '0')}/${card.exp_year}` : '';
    const isDefault = method?.id && method.id === defaultMethodId ? ' · par défaut' : '';
    return `${brand}${last4 ? ` ${last4}` : ''}${expiry}${isDefault}`;
  }

  async function renderCustomerPaymentMethods(item) {
    const host = detailContent?.querySelector('[data-customer-payment-methods]');
    if (!host || !item?.customerProfile || activeDetailItem !== item) return;
    const stripeCustomerId = clean(item.customerProfile.stripeCustomerId);
    if (!stripeCustomerId) {
      host.innerHTML = item.customerProfile.provider === 'paypal'
        ? '<strong>À confirmer via le coffre PayPal</strong><span>L’historique des transactions ne révèle pas les jetons enregistrés. Nos futurs checkouts indiqueront ici si le moyen PayPal est réutilisable.</span>'
        : '<strong>Aucun jeton Stripe rattaché</strong><span>Ce client historique ne possède pas encore d’identité Stripe rapprochée dans Pay.</span>';
      return;
    }
    try {
      const query = new URLSearchParams({ resource: 'payment_methods', customer: stripeCustomerId, type: 'card', limit: '100' });
      const response = await fetch(`${API_STRIPE}?${query}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.connected) throw new Error(payload.error || 'stripe_payment_methods_failed');
      if (activeDetailItem !== item) return;
      const methods = Array.isArray(payload.data) ? payload.data : [];
      host.innerHTML = methods.length
        ? `<strong>Moyen réutilisable : oui</strong><span>${methods.map((method) => escapeHtml(customerMethodLabel(method, item.customerProfile.defaultMethodId))).join('<br>')}</span><small>Seuls le type, les quatre derniers chiffres et l’expiration sont visibles. Pay ne reçoit jamais le numéro complet ni le CVC.</small>`
        : '<strong>Moyen réutilisable : non détecté</strong><span>Aucune carte enregistrée et rattachée à ce client Stripe.</span>';
    } catch {
      if (activeDetailItem === item) host.innerHTML = '<strong>Vérification indisponible</strong><span>Stripe n’a pas répondu pour les moyens de paiement de ce client.</span>';
    }
  }

  function openDetails(item) {
    if (!item || !detailDialog) return;
    const headers = [...screen.querySelectorAll('.resource-head > span')].map((element) => element.textContent.trim());
    detailTitle.textContent = item.plain[0] || 'Détail';
    const standardDetails = headers.map((header, index) => `<div><small>${escapeHtml(header)}</small><strong>${escapeHtml(item.plain[index] || '—')}</strong></div>`);
    const extendedDetails = (Array.isArray(item.details) ? item.details : []).map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || '—')}</strong></div>`);
    const paymentMethods = item.customerProfile ? '<div class="resource-customer-methods" data-customer-payment-methods><strong>Vérification du moyen de paiement…</strong><span>Lecture sécurisée de la passerelle.</span></div>' : '';
    detailContent.innerHTML = [...standardDetails, ...extendedDetails, paymentMethods].join('');
    activeDetailItem = item;
    const editableDraft = item.provider === 'internal' && item.draftKind && item.externalId;
    if (detailActions) detailActions.hidden = !editableDraft;
    if (detailEdit && editableDraft) detailEdit.href = payDraftEditUrl(item.draftKind, item.externalId, { preview: new URLSearchParams(location.search).has('preview') });
    if (detailDelete) {
      delete detailDelete.dataset.resourceDialogDeleteConfirm;
      detailDelete.textContent = 'Supprimer';
    }
    activeNoteEntityKey = notesEnabled ? payNotesEntityKey(screen.dataset.payResourcePage, item.provider, item.externalId ? [item.externalId] : item.plain) : '';
    if (notesSection) notesSection.hidden = !notesEnabled;
    if (noteInput) noteInput.value = '';
    renderNotes();
    detailDialog.showModal();
    renderCustomerPaymentMethods(item);
  }

  function publicationErrorMessage(code) {
    const messages = {
      stripe_catalog_writes_disabled: 'La publication Stripe est verrouillée dans Netlify.',
      stripe_secret_missing: 'La connexion Stripe de Pay est indisponible.',
      pay_catalog_fingerprint_mismatch: 'Le brouillon a changé. Prépare une nouvelle publication.',
      pay_catalog_confirmation_required: 'La confirmation exacte est requise.',
    };
    return messages[code] || 'La publication ne peut pas être préparée pour le moment.';
  }

  async function catalogRequest(payload) {
    const response = await fetch('/.netlify/functions/pay-catalog-publish', {
      method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'pay_catalog_publish_failed');
      error.code = data.error || 'pay_catalog_publish_failed';
      throw error;
    }
    return data;
  }

  async function preparePublication(item) {
    if (!item?.draftKind || !item.externalId || !publishDialog) return;
    const draft = findPayDraft(localStorage, item.draftKind, item.externalId);
    if (!draft) {
      window.payToast?.('Ce brouillon n’existe plus.');
      return;
    }
    const draftKind = item.draftKind;
    const kind = payCatalogDraftKind(draftKind);
    const input = payCatalogDraftInput(draftKind, draft);
    const idempotencyKey = payCatalogDraftIdempotencyKey(draftKind, draft);
    activePublication = { draft, draftKind, kind, input, idempotencyKey, plan: null };
    detailDialog?.close();
    publishTitle.textContent = `Publier ${item.plain[0] || 'ce brouillon'} vers Stripe`;
    publishState.hidden = false;
    publishState.innerHTML = '<span class="resource-spinner" aria-hidden="true"></span><span><strong>Préparation du plan</strong><small>Aucune écriture n’est envoyée pendant cette étape.</small></span>';
    publishPlan.hidden = true;
    publishConfirmWrap.hidden = true;
    publishConfirm.value = '';
    publishConfirm.disabled = true;
    publishExecute.disabled = true;
    publishExecute.textContent = 'Publier vers Stripe';
    publishDialog.showModal();
    try {
      const response = await catalogRequest({ action: 'preview', kind, input, idempotency_key: idempotencyKey });
      activePublication.plan = response.plan;
      const labels = {
        'products.create': 'Créer le produit et son prix',
        'paymentLinks.create': 'Créer le lien de paiement',
        'coupons.create': 'Créer la réduction',
        'promotionCodes.create': 'Créer le code promotionnel',
      };
      const lines = response.plan.operations.map((operation, index) => `<div><span>${index + 1}. ${escapeHtml(labels[operation.stripe_method] || operation.stripe_method)}</span><small>${escapeHtml(operation.id)}</small></div>`);
      if (response.plan.schedule) lines.push(`<div><span>Total de l’échéancier</span><small>${escapeHtml(money(response.plan.schedule.total_minor, input.currency))}</small></div>`);
      publishPlan.innerHTML = lines.join('');
      publishPlan.hidden = false;
      publishConfirmWrap.hidden = false;
      publishConfirmHint.textContent = response.plan.confirmation;
      publishConfirm.disabled = !response.plan.writes_enabled;
      publishState.innerHTML = response.plan.writes_enabled
        ? '<span><strong>Plan vérifié</strong><small>Recopie la confirmation ci-dessous pour autoriser la publication.</small></span>'
        : '<span><strong>Plan vérifié · publication verrouillée</strong><small>Le brouillon est valide, mais aucune écriture Stripe ne peut partir tant que le verrou Netlify reste fermé.</small></span>';
      publishConfirm.focus();
    } catch (error) {
      publishState.innerHTML = `<span><strong>Publication indisponible</strong><small>${escapeHtml(publicationErrorMessage(error.code))}</small></span>`;
    }
  }

  detailPublish?.addEventListener('click', () => preparePublication(activeDetailItem));
  publishConfirm?.addEventListener('input', () => {
    const plan = activePublication?.plan;
    publishExecute.disabled = !plan?.writes_enabled || publishConfirm.value.trim() !== payCatalogDraftConfirmation(activePublication.draftKind);
  });
  publishExecute?.addEventListener('click', async () => {
    const publication = activePublication;
    if (!publication?.plan || publishExecute.disabled) return;
    publishExecute.disabled = true;
    publishExecute.textContent = 'Publication…';
    try {
      const response = await catalogRequest({
        action: 'execute', kind: publication.kind, input: publication.input,
        idempotency_key: publication.idempotencyKey, fingerprint: publication.plan.fingerprint,
        confirmation: publishConfirm.value.trim(),
      });
      markPayDraftPublished(localStorage, publication.draftKind, publication.draft.id, response.result || {});
      window.payToast?.('Publication Stripe terminée.');
      publishDialog.close();
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      publishState.innerHTML = `<span><strong>Publication interrompue</strong><small>${escapeHtml(publicationErrorMessage(error.code))}</small></span>`;
      publishExecute.textContent = 'Réessayer la publication';
      publishExecute.disabled = publishConfirm.value.trim() !== payCatalogDraftConfirmation(publication.draftKind);
    }
  });
  screen.querySelectorAll('[data-resource-publish-close]').forEach((button) => button.addEventListener('click', () => publishDialog?.close()));
  publishDialog?.addEventListener('close', () => { activePublication = null; });
  publishDialog?.addEventListener('click', (event) => { if (event.target === publishDialog) publishDialog.close(); });

  detailDelete?.addEventListener('click', () => {
    const item = activeDetailItem;
    if (!item?.draftKind || item.provider !== 'internal' || !item.externalId) return;
    if (detailDelete.dataset.resourceDialogDeleteConfirm !== 'true') {
      detailDelete.dataset.resourceDialogDeleteConfirm = 'true';
      detailDelete.textContent = 'Confirmer la suppression';
      return;
    }
    const result = removePayDraft(localStorage, item.draftKind, item.externalId);
    if (!result.removed) {
      window.payToast?.('Ce brouillon n’existe plus.');
      detailDialog?.close();
      return;
    }
    rows = rows.filter((candidate) => candidate !== item);
    const selectedStatus = statusFilter.value;
    populateStatuses();
    if ([...statusFilter.options].some((option) => option.value === selectedStatus)) statusFilter.value = selectedStatus;
    render();
    activeDetailItem = null;
    detailDialog?.close();
    window.payToast?.('Brouillon supprimé après confirmation.');
  });

  function renderNotes() {
    if (!notesEnabled || !notesList || !activeNoteEntityKey) return;
    const notes = noteStore[activeNoteEntityKey] || [];
    notesList.innerHTML = notes.length ? notes.map((note) => `
      <article class="resource-note" data-resource-note-id="${escapeHtml(note.id)}">
        <div><p>${escapeHtml(note.body)}</p><small>${escapeHtml(date(note.createdAt))}</small></div>
        <button type="button" data-resource-note-delete>Supprimer</button>
      </article>`).join('') : '<div class="resource-notes-empty">Aucune note pour cette fiche.</div>';
  }

  function saveNote() {
    const body = clean(noteInput?.value);
    if (!body || !activeNoteEntityKey) {
      window.payToast?.('Écris une note avant de l’ajouter.');
      noteInput?.focus();
      return;
    }
    noteStore = addPayNote(noteStore, activeNoteEntityKey, body);
    try { writeNoteStore(); }
    catch { window.payToast?.('Impossible de conserver cette note dans la session.'); return; }
    noteInput.value = '';
    renderNotes();
    window.payToast?.('Note ajoutée à cette session.');
  }

  screen.querySelector('[data-resource-note-add]')?.addEventListener('click', saveNote);
  noteInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    saveNote();
  });
  notesList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-resource-note-delete]');
    const host = event.target.closest('[data-resource-note-id]');
    if (!button || !host || !activeNoteEntityKey) return;
    if (button.dataset.resourceNoteDeleteConfirm !== 'true') {
      button.dataset.resourceNoteDeleteConfirm = 'true';
      button.textContent = 'Confirmer la suppression';
      return;
    }
    noteStore = removePayNote(noteStore, activeNoteEntityKey, host.dataset.resourceNoteId);
    try { writeNoteStore(); } catch {}
    renderNotes();
    window.payToast?.('Note supprimée de cette session.');
  });

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

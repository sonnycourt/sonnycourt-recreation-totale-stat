import { coachingSupabase, isLocalCoachingPreview } from './coaching-supabase.js';

const root = document.querySelector('[data-stripe-checkout]');
const form = root?.querySelector('.stripe-payment-form');
const loading = document.getElementById('loading-state');
const failure = document.getElementById('error-state');
const submit = root?.querySelector('[data-stripe-submit]');
const submitLabel = root?.querySelector('[data-stripe-submit-label]');
const errorNode = root?.querySelector('[data-stripe-error]');
const params = new URLSearchParams(window.location.search);
const formatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});
let checkoutClient = null;

const OFFER_COPY = {
  'session-1': { title: 'Le prochain pas', credits: '3', price: '247 €', description: 'Une séance de 45 minutes pour avancer sur un sujet précis.' },
  'pack-3': { title: 'Créer un mouvement', credits: '9', price: '591 €', description: 'Trois séances de 45 minutes à utiliser au rythme qui te convient.' },
  'pack-6': { title: 'Installer le changement', credits: '18', price: '882 €', description: 'Six séances de 45 minutes pour installer une véritable continuité.' },
  'membership-3': { title: 'Rythme léger', credits: '3 / mois', price: '177 € / mois', description: 'Une séance de 45 minutes ajoutée automatiquement chaque mois.' },
  'membership-6': { title: 'Continuité', credits: '6 / mois', price: '318 € / mois', description: 'Deux séances de 45 minutes ajoutées automatiquement chaque mois.' },
  'membership-12': { title: 'Accélération', credits: '12 / mois', price: '588 € / mois', description: 'Trois heures de coaching disponibles chaque mois.' },
};

function renderOfferCopy() {
  const offer = root?.dataset.offer || params.get('offer');
  const copy = OFFER_COPY[offer];
  if (!copy) return;
  document.querySelector('[data-checkout-title]')?.replaceChildren(copy.title);
  document.querySelector('[data-checkout-description]')?.replaceChildren(copy.description);
  document.querySelector('[data-checkout-credits]')?.replaceChildren(copy.credits);
  document.querySelector('[data-checkout-price]')?.replaceChildren(copy.price);
  if (submitLabel) submitLabel.textContent = `Payer ${copy.price}`;
}

function showFailure(message = '') {
  loading.hidden = true;
  if (form) form.hidden = true;
  failure.hidden = false;
  const paragraph = failure.querySelector('p');
  if (message && paragraph) paragraph.textContent = message;
}

function showForm() {
  loading.hidden = true;
  failure.hidden = true;
  form.hidden = false;
}

function setFirstConsultationIdentity(data) {
  const name = document.getElementById('customer-name');
  const email = document.getElementById('customer-email');
  const date = document.getElementById('appointment-date');
  if (name) name.textContent = data.name || 'Prénom enregistré';
  if (email) email.textContent = data.email || 'Email enregistré';
  if (date && data.start) date.textContent = formatter.format(new Date(data.start));
}

function previewCheckout() {
  const payment = root.querySelector('[data-stripe-payment-element]');
  payment.innerHTML = `
    <div class="stripe-preview">
      <div class="stripe-preview-wallets"><span>Apple Pay</span><span>Google Pay</span></div>
      <div class="stripe-preview-field">Numéro de carte</div>
      <div class="stripe-preview-row"><div class="stripe-preview-field">MM / AA</div><div class="stripe-preview-field">CVC</div></div>
      <div class="stripe-preview-field">Pays de facturation</div>
    </div>`;
  if (root.dataset.offer === 'first-consultation') {
    setFirstConsultationIdentity({
      name: params.get('name') || 'Sonny',
      email: params.get('email') || 'sonny@example.com',
      start: params.get('start') || new Date(Date.now() + 86400000).toISOString(),
    });
  }
  submit.disabled = false;
  submit.addEventListener('click', (event) => {
    event.preventDefault();
    errorNode.textContent = 'Aperçu local : aucun paiement n’est déclenché.';
  });
  showForm();
}

async function authorizationHeader() {
  const { data: { session } } = await coachingSupabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function bookingContext(booking) {
  const response = await fetch(`/.netlify/functions/coach-diagnostic?booking=${encodeURIComponent(booking)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !['pending_payment', 'payment_review'].includes(data.status)) throw new Error(data.error || 'Réservation introuvable.');
  setFirstConsultationIdentity(data);
}

function checkoutNonce(offer) {
  const key = `coaching_checkout_nonce_${offer}`;
  let value = window.sessionStorage.getItem(key);
  if (!value) {
    value = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(key, value);
  }
  return value;
}

async function createCheckout() {
  const offer = root.dataset.offer || params.get('offer');
  const booking = params.get(root.dataset.bookingParam || 'booking') || '';
  if (!offer) throw new Error('Offre de coaching introuvable.');
  if (offer === 'first-consultation') {
    if (!booking) throw new Error('Reviens choisir ton créneau.');
    await bookingContext(booking);
  }
  const response = await fetch('/.netlify/functions/coaching-stripe-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...await authorizationHeader() },
    body: JSON.stringify({ offer_slug: offer, booking, nonce: checkoutNonce(offer) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Le paiement ne peut pas être préparé.');
  return data;
}

async function mountStripe() {
  if (!root || !form) return;
  if (isLocalCoachingPreview()) return previewCheckout();
  if (!window.Stripe) throw new Error('Stripe.js ne peut pas être chargé.');
  const data = await createCheckout();
  const stripe = window.Stripe(data.publishable_key);
  const checkout = await stripe.initCheckout({ fetchClientSecret: () => Promise.resolve(data.client_secret) });
  const paymentElement = checkout.createPaymentElement({ layout: 'accordion' });
  paymentElement.mount(root.querySelector('[data-stripe-payment-element]'));
  checkoutClient = checkout;
  checkout.on('change', (session) => {
    submit.disabled = !session.canConfirm;
  });
  submit.disabled = false;
  showForm();
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!checkoutClient) return;
  submit.disabled = true;
  submit.classList.add('is-loading');
  errorNode.textContent = '';
  const result = await checkoutClient.confirm().catch((error) => ({ type: 'error', error }));
  if (result?.type === 'error' || result?.error) {
    errorNode.textContent = result.error?.message || 'Vérifie les informations de paiement.';
    submit.disabled = false;
    submit.classList.remove('is-loading');
  }
});

document.getElementById('retry-button')?.addEventListener('click', () => window.location.reload());

renderOfferCopy();
mountStripe().catch((error) => {
  console.error('Stripe coaching checkout', error);
  showFailure(error.message);
});

import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export const DELTA_SPIFFY_ORIGIN = 'https://sonnycourt.spiffy.co';
export function normalizeDeltaPhone(value, country) {
  const text = String(value || '').trim().replace(/^00/, '+');
  if (!text.startsWith('+') && !country) return null;
  const phone = parsePhoneNumberFromString(text, country);
  return phone?.isValid() && !phone.ext ? phone.number : null;
}
export function initDeltaPhoneCountry(dialog, fetcher = fetch) {
  const select=dialog.querySelector('#dv-phone-country'),input=dialog.querySelector('#dv-phone');
  let manual=false,requested=false;
  const render=()=>{
    const option=select.selectedOptions[0];
    dialog.querySelector('[data-dv-country-flag]').textContent=option.dataset.flag;
    dialog.querySelector('[data-dv-country-dial]').textContent=`+${option.dataset.dial}`;
  };
  select.addEventListener('change',()=>{manual=true;render();});
  input.addEventListener('input',()=>{
    manual=true;
    // International paste takes priority over the default country; keep a national input afterwards.
    const value=input.value.trim().replace(/^00/,'+');
    if(!value.startsWith('+'))return;
    const phone=parsePhoneNumberFromString(value);
    if(phone?.country && phone.isValid()){
      select.value=phone.country;render();input.value=phone.formatNational();
    }
  });
  render();
  return async()=>{
    if(requested)return;requested=true;
    try{
      const response=await fetcher('/.netlify/functions/delta-vision-country',{cache:'no-store',signal:AbortSignal.timeout(4000)});
      if(!response.ok)return;
      const {country}=await response.json();
      if(!manual && !input.value && [...select.options].some(option=>option.value===country)){select.value=country;render();}
    }catch{/* A failed IP lookup never blocks entry; France remains a changeable default. */}
  };
}
export function deltaCheckoutUrl(identity, parentHref) {
  const parent = new URL(parentHref);
  const url = new URL('/checkout/delta-vision', DELTA_SPIFFY_ORIGIN);
  url.searchParams.set('locale', 'fr');
  for (const [key, value] of Object.entries({name_first:identity.firstName, email:identity.email, phone_number:identity.phone})) url.searchParams.set(key, value);
  url.searchParams.set('dv_embed', '1');
  url.searchParams.set('dv_parent_origin', parent.origin);
  url.searchParams.set('elements', btoa(JSON.stringify({modality:'inline',uid:'delta-vision',from:parent.origin+parent.pathname,handles:{}})));
  return url;
}
export function deltaPaymentMessage(event, frame) {
  if (event.origin !== DELTA_SPIFFY_ORIGIN || event.source !== frame.contentWindow) return null;
  let data = event.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return null; } }
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'dv:payment-ready' && data.identityReady === true) return {ready:true};
  if (data.type === 'dv:payment-height' || data.event === 'form:size') {
    const height = Number(data.height ?? data.data?.height);
    if (Number.isFinite(height) && height >= 100 && height <= 10000) return {height:Math.min(2200, Math.ceil(height))};
  }
  // Only Spiffy's own thank-you destination. This is navigation, never proof of purchase.
  if (data.event === 'order:success' || data.event === 'redirect') {
    try {
      const destination = data.data?.forward || data.data?.url || data.url;
      if (typeof destination !== 'string') return null;
      const url = new URL(destination, DELTA_SPIFFY_ORIGIN);
      if (url.origin === DELTA_SPIFFY_ORIGIN && /^\/(thanks|thank-you)(\/|$)/.test(url.pathname) && !url.username && !url.password) return {redirect:url.href};
    } catch { /* Invalid messages are ignored. */ }
  }
  return null;
}

export function mountDeltaPayment(slot, identity) {
  const doc = slot.ownerDocument, view = doc.defaultView;
  const frame = doc.createElement('iframe');
  frame.className = 'dv-payment-frame'; frame.title = 'Paiement sécurisé Delta Vision — 47 €';
  frame.allow = 'payment'; frame.referrerPolicy = 'no-referrer';
  frame.style.cssText = 'height:350px;opacity:0;pointer-events:none';
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  const status = doc.createElement('p'); status.className = 'dv-payment-status'; status.setAttribute('role','status');
  status.textContent = 'Chargement du paiement sécurisé…';
  let ready = false, loaded = false, height = 0, stopped = false, timer;
  const reveal = () => {
    if (!ready || !loaded || !height || stopped) return;
    view.clearTimeout(timer); status.hidden = true;
    frame.style.height = `${height}px`; frame.style.opacity = '1'; frame.style.pointerEvents = 'auto';
    frame.setAttribute('aria-hidden', 'false'); frame.tabIndex = 0; slot.setAttribute('aria-busy','false');
  };
  const receive = event => {
    const message = deltaPaymentMessage(event, frame); if (!message || stopped) return;
    if (message.redirect) { view.location.assign(message.redirect); return; }
    if (message.ready) ready = true;
    if (message.height) height = message.height;
    reveal();
  };
  frame.addEventListener('load', () => { loaded = true; reveal(); });
  view.addEventListener('message', receive);
  const start = () => {
    ready = false; loaded = false; height = 0; status.hidden = false;
    frame.style.height = '350px'; frame.style.opacity = '0'; frame.style.pointerEvents = 'none';
    frame.setAttribute('aria-hidden','true'); frame.tabIndex = -1;
    status.textContent = 'Chargement du paiement sécurisé…'; slot.setAttribute('aria-busy','true');
    frame.src = deltaCheckoutUrl(identity, view.location.href).href;
    view.clearTimeout(timer);
    timer = view.setTimeout(() => {
      if (stopped || ready && loaded && height) return;
      frame.style.height = '0px';
      status.textContent = 'Le paiement n’a pas pu s’afficher. Tu n’as pas été débité. ';
      const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = 'Réessayer'; retry.addEventListener('click',start);
      status.append(retry); slot.setAttribute('aria-busy','false');
    }, 12000);
  };
  slot.replaceChildren(status, frame); start();
  return {destroy(){stopped=true;view.clearTimeout(timer);view.removeEventListener('message',receive);slot.replaceChildren();}};
}

export function initDeltaCheckout(doc = document) {
  const dialog = doc.querySelector('[data-dv-checkout]'); if (!dialog || dialog.dataset.bound) return;
  dialog.dataset.bound = 'true';
  const panels = [...dialog.querySelectorAll('[data-dv-panel]')];
  const identityForm = dialog.querySelector('[data-dv-identity]'), phoneForm = dialog.querySelector('[data-dv-phone]');
  const detectCountry=initDeltaPhoneCountry(dialog);
  let identity = {}, payment, paymentKey = '', busy = false, opener;
  const show = name => {
    panels.forEach(panel => { const active = panel.dataset.dvPanel === name; panel.hidden = !active; panel.inert = !active; });
    const panel = panels.find(panel => panel.dataset.dvPanel === name);
    dialog.setAttribute('aria-labelledby', name === 'identity' ? 'dv-checkout-title' : `dv-title-${name}`);
    const title = panel.querySelector('h2'); if (name !== 'identity') title.id = `dv-title-${name}`;
    dialog.scrollTop = 0; title.focus({preventScroll:true});
  };
  doc.querySelectorAll('a[href^="https://sonnycourt.spiffy.co/checkout/delta-vision"]').forEach(link => {
    link.setAttribute('aria-haspopup','dialog');
    link.addEventListener('click',event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); opener=link; dialog.showModal();detectCountry(); });
  });
  dialog.querySelector('[data-dv-close]').addEventListener('click',() => dialog.close());
  dialog.addEventListener('click',event => { if (event.target === dialog) {const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',() => opener?.focus({preventScroll:true}));
  dialog.querySelectorAll('[data-dv-back]').forEach(button => button.addEventListener('click',() => { if (!busy) show(button.dataset.dvBack); }));
  const save = async (form, data, errorEl) => {
    if (busy) return false; busy = true; errorEl.hidden = true;
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const response = await fetch('/.netlify/functions/delta-vision-register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
      const result = await response.json(); if (!response.ok || result.ok !== true) throw new Error('registration_failed');
      return true;
    } catch {
      errorEl.textContent = 'Impossible d’enregistrer pour le moment. Réessaie dans quelques instants.'; errorEl.hidden=false; return false;
    } finally {busy=false;button.disabled=false;}
  };
  identityForm.addEventListener('submit',async event => {
    event.preventDefault(); if (!identityForm.reportValidity() || busy) return;
    const data = new FormData(identityForm);
    const candidate = {firstName:String(data.get('firstName')).trim(),email:String(data.get('email')).trim().toLowerCase(),website:String(data.get('website') || '')};
    if (!candidate.firstName) {identityForm.elements.firstName.focus();return;}
    if (await save(identityForm,candidate,dialog.querySelector('[data-dv-identity-error]'))) {identity=candidate;show('phone');}
  });
  phoneForm.addEventListener('submit',async event => {
    event.preventDefault(); if (!phoneForm.reportValidity() || busy) return;
    const phone = normalizeDeltaPhone(phoneForm.elements.phone.value,phoneForm.elements.country.value), error = dialog.querySelector('[data-dv-phone-error]');
    if (!phone) {error.textContent='Vérifie ton numéro et le pays sélectionné.';error.hidden=false;return;}
    const candidate={...identity,phone};
    if (!(await save(phoneForm,candidate,error))) return;
    identity=candidate; show('payment');
    const key=JSON.stringify(identity);
    if (key !== paymentKey) {payment?.destroy();payment=mountDeltaPayment(dialog.querySelector('[data-dv-payment-slot]'),identity);paymentKey=key;}
  });
}

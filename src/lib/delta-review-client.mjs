const form = document.querySelector('#review-form');
const stars = document.querySelector('#stars');
const identityKey = 'delta-vision-review-identity-v1';
const draftKey = 'delta-vision-review-draft-v1';
const fields = ['firstName','email','review','improvements'];
const status = document.querySelector('#form-status');
let requestId = crypto.randomUUID(), busy = false;
const safeRead = (storage, key) => {
  try {const value = JSON.parse(window[storage].getItem(key)); return value && typeof value === 'object' ? value : {};} catch {return {};}
};
const safeWrite = (storage, key, value) => {try {window[storage].setItem(key, JSON.stringify(value));} catch {/* Storage restrictions never block a review. */}};
for (let n = 1; n <= 5; n++) {
  const option = document.createElement('div'); option.className = 'star-option';
  option.innerHTML = '<input type="radio" id="rating-'+n+'" name="rating" value="'+n+'" required aria-label="'+n+' sur 5"><label for="rating-'+n+'" title="'+n+' sur 5"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.07 6.28L12 17.36l-5.62 2.97 1.07-6.28L2.9 9.6l6.3-.9Z"/></svg></label>';
  stars.append(option);
}
function renderRating() {
  const rating = Number(new FormData(form).get('rating') || 0);
  stars.querySelectorAll('label').forEach((label,i) => label.classList.toggle('lit', i < rating));
  document.querySelector('#rating-caption').textContent = rating ? rating + ' sur 5 — merci pour ton avis sincère.' : 'Choisis entre 1 et 5 étoiles.';
}
const identity = safeRead('localStorage', identityKey);
for (const name of ['firstName','email']) if (typeof identity[name] === 'string') form.elements[name].value = identity[name];
const draft = safeRead('sessionStorage', draftKey);
if (typeof draft.at === 'number' && Date.now() - draft.at < 86400000) {
  for (const name of fields) if (typeof draft[name] === 'string') form.elements[name].value = draft[name];
  if (Number.isInteger(draft.rating) && draft.rating >= 1 && draft.rating <= 5) form.elements.rating.value = String(draft.rating);
  if (/^[0-9a-f-]{36}$/i.test(draft.requestId || '')) requestId = draft.requestId;
}
renderRating();
function values() {
  return {...Object.fromEntries(fields.map(name => [name, form.elements[name].value.trim()])),
    rating: Number(new FormData(form).get('rating') || 0), requestId, website: form.elements.website.value};
}
function rememberDraft() {safeWrite('sessionStorage', draftKey, {...values(), at: Date.now()});}
form.addEventListener('input', (event) => {
  event.target.setCustomValidity?.('');
  requestId = crypto.randomUUID();
  status.textContent = '';
  rememberDraft();
});
form.addEventListener('change', () => {renderRating(); rememberDraft();});
document.querySelector('#forget-identity').addEventListener('click', () => {
  for (const [storage,key] of [['localStorage',identityKey],['sessionStorage',draftKey]]) {
    try {window[storage].removeItem(key);} catch {}
  }
  for (const name of ['firstName','email']) form.elements[name].value = '';
  requestId = crypto.randomUUID();
  status.textContent = 'Coordonnées effacées de ce navigateur.';
  form.elements.firstName.focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  for (const name of ['firstName','review']) {
    const field = form.elements[name];
    field.setCustomValidity(field.value.trim() ? '' : 'Merci de compléter ce champ.');
  }
  if (!form.reportValidity()) return;
  const payload = values();
  rememberDraft();
  busy = true;
  const controls = [...form.querySelectorAll('input,textarea,button')];
  controls.forEach(el => {el.disabled = true;});
  const submit = form.querySelector('[type="submit"]');
  submit.textContent = 'Enregistrement…';
  status.textContent = '';
  form.setAttribute('aria-busy','true');
  try {
    const response = await fetch('/.netlify/functions/delta-vision-review', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      throw new Error(response.status === 429 ? 'Quelques instants de patience avant de réessayer.' :
        result.error || 'L’avis n’a pas pu être enregistré. Réessaie dans un instant.');
    }
    safeWrite('localStorage', identityKey, {firstName:payload.firstName,email:payload.email});
    try {sessionStorage.removeItem(draftKey);} catch {}
    document.querySelector('#confirmation').textContent = payload.firstName + ', ton retour compte et nous aide à améliorer l’expérience.';
    form.hidden = true;
    const success = document.querySelector('#success'); success.hidden = false; success.focus();
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ?
      'Connexion interrompue. Ton texte est conservé ; tu peux réessayer sans créer de doublon.' : error.message;
  } finally {
    busy = false; controls.forEach(el => {el.disabled = false;});
    submit.textContent = 'Partager mon expérience →'; form.removeAttribute('aria-busy');
  }
});

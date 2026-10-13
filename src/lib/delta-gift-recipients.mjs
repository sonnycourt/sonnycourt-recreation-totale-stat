// Pure helpers: no requests or customer writes. Entirely blank gifts stay available.
export function recipientPairs(entries) {
  const pairs=new Map();
  for(const [key,value] of entries){
    const match=/^recipient-(\d+)-(firstName|email)$/.exec(key);
    if(!match)continue;
    const slot=Number(match[1]);
    if(!pairs.has(slot))pairs.set(slot,{slot,firstName:'',email:''});
    pairs.get(slot)[match[2]]=String(value).trim();
  }
  return [...pairs.values()].filter(r=>r.firstName || r.email);
}
export function validateRecipientPairs(form) {
  for(const row of form.querySelectorAll('[data-recipient-pair]')){
    const name=row.querySelector('[data-recipient-name]'),email=row.querySelector('[data-recipient-email]');
    const started=!!(name.value.trim() || email.value.trim());
    name.required=started;email.required=started;
    name.setCustomValidity(started && !name.value.trim()?'Renseigne le prénom de ton proche.':/[<>\x00-\x1f]/.test(name.value)?'Vérifie le prénom de ton proche.':'');
  }
  return form.reportValidity();
}

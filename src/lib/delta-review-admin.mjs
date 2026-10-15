const $ = selector => document.querySelector(selector);
let page = 0, loading = false;
const node = (tag,text,cls) => {const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;};
async function load() {
  if (loading) return;
  loading = true;
  $('#notice').textContent = 'Chargement…';
  document.querySelectorAll('nav button').forEach(el => {el.disabled=true;});
  try {
    const response = await fetch('/.netlify/functions/admin-delta-vision-reviews?page='+page,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data = await response.json();
    if (response.status === 401) {
      $('#workspace').hidden=true;$('#reviews').replaceChildren();$('#login').hidden=false;
      $('#notice').textContent='Connecte-toi avec le mot de passe de ton espace privé.';return;
    }
    if (!response.ok) throw new Error(data.error || 'Chargement indisponible.');
    $('#login').hidden=true;$('#workspace').hidden=false;$('#reviews').replaceChildren();
    for (const review of data.reviews) {
      const article=document.createElement('article');
      article.append(node('h2',review.first_name),node('p',review.email+' · '+new Intl.DateTimeFormat('fr-CH',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Zurich'}).format(new Date(review.created_at)),'meta'),
        node('div','★'.repeat(review.rating)+'☆'.repeat(5-review.rating)+' — '+review.rating+'/5','rating'),
        node('p',review.review,'review-text'));
      if (review.improvements) {const suggestion=node('div','','suggestion');suggestion.append(node('strong','SUGGESTION PRIVÉE'),document.createTextNode(review.improvements));article.append(suggestion);}
      $('#reviews').append(article);
    }
    $('#notice').textContent=data.reviews.length ? '' : 'Aucun avis pour le moment.';
    $('#page').textContent='Page '+(page+1);
    $('#previous').disabled=page===0;$('#next').disabled=!data.hasMore;
  } catch(error) {$('#notice').textContent=error.message || 'Connexion indisponible.';}
  finally {loading=false;$('#reload').disabled=false;}
}
$('#login').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#login button');button.disabled=true;
  try {
    const response=await fetch('/.netlify/functions/admin-es2-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#password').value}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Connexion refusée. Vérifie ton mot de passe ou réessaie plus tard.');
    $('#password').value='';await load();
  }catch(error){$('#notice').textContent=error.message;}finally{button.disabled=false;}
});
$('#reload').addEventListener('click',load);
$('#previous').addEventListener('click',()=>{if(page>0){page--;load();}});
$('#next').addEventListener('click',()=>{page++;load();});
load();

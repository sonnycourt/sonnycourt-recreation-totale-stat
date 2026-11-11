import { CHANNELS, FORMATS, PLACEMENTS, DESTINATIONS, buildDestination, linkCode, shortUrl, validateCreate, publicationUrl, validatePublicationUpdate } from './marketing-links-contract.mjs';

export function initMarketingLinksAdmin(doc = document, win = window) {
  const $ = id => doc.getElementById(id);
  const demo = !['sonnycourt.com','www.sonnycourt.com'].includes(win.location.hostname) && new URLSearchParams(win.location.search).get('demo') === '1';
  const preview = !['sonnycourt.com','www.sonnycourt.com'].includes(win.location.hostname);
  const endpoint = '/.netlify/functions/admin-marketing-links';
  let state = { contents: [], links: [], totals: {} }, operationId = win.crypto.randomUUID(), contentId = win.crypto.randomUUID(), limit = 8, busy = false;
  let customCampaign=false, customPlacement=false, customFormat=false;
  let editingPublication=null;
  const defaults={instagram:['dm','short'],youtube:['description','long'],tiktok:['bio','short'],facebook:['button','post'],email:['button','email'],sms:['body','sms'],meta_ads:['button','short']};
  const value = id => $(id).value;
  const urlFor = code => demo ? shortUrl(code).replace('sonnycourt.com','exemple.invalid') : shortUrl(code);
  const formatNumber = n => Number(n || 0).toLocaleString('fr-CH');
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; win.setTimeout(() => $('toast').hidden = true, 2200); }
  async function copy(text) {
    try { await win.navigator.clipboard.writeText(text); toast('Lien copié.'); }
    catch { $('created').hidden = false; $('created-url').value = text; $('created-url').focus(); $('created-url').select(); toast('Sélectionné : utilise Copier sur ton appareil.'); }
  }
  function populateContents() {
    const selected = value('content-select'); $('content-select').replaceChildren(new Option('+ Enregistrer un nouveau contenu','new'));
    for (const content of state.contents) $('content-select').append(new Option(content.title, content.id));
    $('content-select').value = state.contents.some(c => c.id === selected) ? selected : 'new';
    toggleContent();
    $('mode-existing').disabled = state.contents.length===0;
  }
  function toggleContent() {
    const fresh = value('content-select') === 'new'; $('new-content').hidden = !fresh; $('title').required = fresh;
    $('existing-content').hidden=fresh;
    $('mode-new').setAttribute('aria-pressed',String(fresh)); $('mode-existing').setAttribute('aria-pressed',String(!fresh));
    $('format').disabled=!fresh;
  }
  function render() {
    for (const key of ['contents','links','arrivals','registrations']) $('total-'+key).textContent = formatNumber(state.totals[key]);
    $('library-count').textContent = `${formatNumber(state.totals.links)} lien${state.totals.links === 1 ? '' : 's'} · ${formatNumber(state.totals.contents)} contenu${state.totals.contents === 1 ? '' : 's'}`;
    const term = value('search').trim().toLocaleLowerCase('fr');
    const rows = state.links.filter(r => (!value('filter-channel') || r.channel === value('filter-channel')) && [r.title,r.campaign,r.topic,r.angle,r.publication_label,r.code].join(' ').toLocaleLowerCase('fr').includes(term));
    $('link-list').replaceChildren(); $('empty').hidden = rows.length > 0;
    $('empty').querySelector('h3').textContent = state.links.length ? 'Aucun lien ne correspond.' : 'Ton prochain contenu commence ici.';
    $('empty').querySelector('p').textContent = state.links.length ? 'Essaie un autre mot-clé ou un autre canal.' : 'Crée ton premier lien. Il apparaîtra ici avec ses paramètres de suivi.';
    for (const row of rows.slice(0,limit)) {
      const card = el('article','link-card'), top = el('div','link-top'), identity = el('div');
      card.dataset.channel=row.channel;
      identity.append(el('h3','link-title',row.title),el('p','link-subtitle',`${FORMATS[row.format] || row.format} · ${PLACEMENTS[row.placement]}${row.publication_label ? ' · '+row.publication_label : ''}`));
      top.append(identity,el('span','channel-tag',CHANNELS[row.channel].label));
      const middle = el('div','link-middle'), link = el('a','short-link',urlFor(row.code).replace('https://',''));
      link.href = urlFor(row.code); link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (demo) link.addEventListener('click', e => { e.preventDefault(); toast('Exemple de lien : aucune redirection réelle.'); });
      const copyButton = el('button','copy-button','Copier'); copyButton.type = 'button'; copyButton.addEventListener('click', () => copy(urlFor(row.code))); middle.append(link,copyButton);
      const bottom = el('div','link-bottom'), stats = el('div','link-stats');
      for (const [key,label] of [['arrivals','arrivées'],['registrations','inscrits MC2']]) { const span = el('span'); span.append(el('b','',formatNumber(row[key])),doc.createTextNode(label)); stats.append(span); }
      bottom.append(el('span','campaign-tag',row.campaign),stats);
      const details = el('details'), summary = el('summary','','Détails du lien ↗'), detail = el('p','field-help',buildDestination(row)); detail.style.overflowWrap = 'anywhere'; details.append(summary,detail);
      card.append(top,middle,bottom);
      let postUrl=null; try { postUrl=publicationUrl(row.publication_url); } catch { /* Never render unsafe legacy URLs. */ }
      {
        const meta=el('div','publication-meta');
        if (row.published_on) {
          const date=el('time','',new Date(row.published_on+'T00:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})); date.dateTime=row.published_on;meta.append(date);
        }
        if (postUrl) {
          const open=el('a','publication-open','Voir la publication ↗');open.href=postUrl;open.target='_blank';open.rel='noopener noreferrer';open.title='Ouvrir la publication dans une nouvelle fenêtre';
          open.addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();win.open(postUrl,'_blank','noopener,noreferrer,popup,width=1100,height=850');});meta.append(open);
        }
        const edit=el('button','publication-edit',row.published_on || postUrl ? 'Modifier la fiche' : '＋ Ajouter la publication');edit.type='button';edit.disabled=!demo&&state.schema_version!==2;
        edit.addEventListener('click',()=>{editingPublication=row.publication_id||row.id;$('publication-title').textContent=row.title;$('edit-published-on').value=row.published_on||'';$('edit-publication-url').value=postUrl||'';$('publication-status').textContent='';$('publication-dialog').showModal();});meta.append(edit);
        card.append(meta);
      }
      card.append(details); $('link-list').append(card);
    }
    const scope = state.totals.links > state.links.length ? ` · recherche sur les ${state.links.length} liens les plus récents` : '';
    $('shown-count').textContent = `${Math.min(limit,rows.length)} sur ${rows.length} liens${scope}`;
    $('show-more').hidden = limit >= rows.length;
  }
  function helpers() {
    const destination = value('channel') === 'meta_ads' && value('destination') === 'mc2' ? 'meta_mc2' : value('destination');
    $('destination-preview').textContent = DESTINATIONS[destination].url.replace('https://','');
    $('auto-summary').textContent=`${CHANNELS[value('channel')].label.replace(' · MailerLite','')} → ${DESTINATIONS[value('destination')].label}`;
    doc.querySelectorAll('[data-channel]').forEach(button=>{if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.channel===value('channel')));});
    doc.querySelectorAll('[data-destination]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.destination===value('destination'))));
    $('channel-help').textContent = value('placement') === 'bio'
      ? 'Une bio identifie le canal, pas la vidéo qui a déclenché la visite. Garde ce lien stable.'
      : value('channel') === 'youtube' && value('format') === 'short'
        ? 'Shorts : utilise la bio ou une vidéo associée. Un lien en description ne sera pas cliquable.'
        : 'Un lien distinct par canal et par emplacement. Réutilise le même contenu dans la liste ci-dessus.';
  }
  async function load() {
    if (busy) return;
    $('refresh').disabled = true;
    try {
      if (!demo) {
        const res = await win.fetch(endpoint,{ credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000) });
        const data = await res.json();
        if (res.status === 401) { $('auth').hidden = false; $('fields').disabled = true; $('connection').textContent = 'Connexion requise'; return; }
        if (!res.ok) throw new Error(data.error || 'Impossible de lire le registre.');
        state = data;
      }
      $('auth').hidden = true; $('fields').disabled = false;
      $('connection').textContent = demo ? 'Démo interactive' : 'Connecté';
      $('connection').parentElement.classList.toggle('ready',!demo);
      if (!demo) {
        $('notice').hidden = !preview;
        $('notice').textContent = 'PRÉVERSION — Le registre Supabase est réel. Les liens sonnycourt.com/r/… deviendront utilisables après publication de cette version. Ne les diffuse pas encore.';
      }
      populateContents(); render();
      if(!demo && state.schema_version!==2){$('fields').disabled=true;$('notice').hidden=false;$('notice').textContent='Le registre est connecté. Exécute marketing_links_publication_v2.sql pour activer la date et le lien de publication.';}
    } catch (error) {
      $('notice').textContent = error.message || 'Le registre est momentanément indisponible.'; $('notice').hidden = false;
      $('connection').textContent = 'Connexion à finaliser'; $('fields').disabled = true;
    } finally { $('refresh').disabled = false; }
  }
  $('link-form').addEventListener('invalid', event => {
    if ($('advanced').contains(event.target)) $('advanced').open = true;
  }, true);
  $('link-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !$('link-form').reportValidity()) return;
    let input;
    const content = state.contents.find(c => c.id === value('content-select'));
    try {
      input = validateCreate({ id:operationId, content_id:content?.id || contentId, title:content?.title || value('title'),format:content?.format || value('format'),topic:content?.topic || value('topic'),angle:content?.angle || value('angle'),channel:value('channel'),placement:value('placement'),campaign:value('campaign'),destination:value('destination'),publication_label:value('publication-label'),published_on:value('published-on'),publication_url:value('publication-url') });
    } catch (e) { $('form-status').textContent = e.message; return; }
    busy = true; $('fields').disabled = true; $('form-status').textContent = 'Enregistrement…';
    try {
      let link;
      if (demo) {
        link = {...input,code:linkCode(input.id),created_at:new Date().toISOString(),arrivals:0,registrations:0};
        state.links.unshift(link);
        if (!content) state.contents.unshift({...input,id:input.content_id});
        state.totals.contents = state.contents.length; state.totals.links = state.links.length;
      } else {
        const res = await win.fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(12000)});
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Création impossible.'); link = data.link;
      }
      $('created-url').value = urlFor(link.code); $('created').hidden = false;
      $('created-help').textContent = demo ? 'Exemple non utilisable. Rien n’est enregistré dans Supabase.' : 'Enregistré dans Supabase. Tu peux réutiliser ce lien à tout moment.';
      $('form-status').textContent = demo ? 'Exemple créé dans cette page uniquement.' : 'Lien enregistré.';
      operationId = win.crypto.randomUUID(); contentId = win.crypto.randomUUID();
      busy = false; await load();
      $('content-select').value = input.content_id; toggleContent();
      $('published-on').value='';$('publication-url').value='';
      $('created').scrollIntoView({behavior:'smooth',block:'nearest'});
    } catch (error) { $('form-status').textContent = `${error.message} Tu peux réessayer : le même lien ne sera pas créé deux fois.`; }
    finally { busy = false; $('fields').disabled = !demo && state.schema_version!==2; }
  });
  $('link-form').addEventListener('input', () => { if (!busy) operationId = win.crypto.randomUUID(); helpers(); });
  $('content-select').addEventListener('change',toggleContent);
  $('mode-new').addEventListener('click',()=>{$('content-select').value='new';contentId=win.crypto.randomUUID();operationId=win.crypto.randomUUID();toggleContent();$('title').focus();});
  $('mode-existing').addEventListener('click',()=>{if(!state.contents.length)return;$('content-select').value=state.contents[0].id;operationId=win.crypto.randomUUID();toggleContent();});
  for (const button of doc.querySelectorAll('button[data-channel]')) button.addEventListener('click',()=>{
    $('channel').value=button.dataset.channel;
    if(!customPlacement)$('placement').value=defaults[value('channel')][0];
    if(!customFormat && value('content-select')==='new')$('format').value=defaults[value('channel')][1];
    operationId=win.crypto.randomUUID();helpers();
  });
  for (const button of doc.querySelectorAll('button[data-destination]')) button.addEventListener('click',()=>{
    $('destination').value=button.dataset.destination;
    if(!customCampaign)$('campaign').value={mc2:'mc2-evergreen',delta:'delta-vision',papa:'guide-papa'}[value('destination')];
    operationId=win.crypto.randomUUID();helpers();
  });
  $('campaign').addEventListener('input',()=>customCampaign=true);
  $('placement').addEventListener('change',()=>customPlacement=true);
  $('format').addEventListener('change',()=>customFormat=true);
  $('channel').addEventListener('change', helpers);
  $('search').addEventListener('input', () => { limit = 8; render(); });
  $('filter-channel').addEventListener('change', () => { limit = 8; render(); });
  $('show-more').addEventListener('click', () => { limit += 8; render(); });
  $('refresh').addEventListener('click',load);
  $('copy-created').addEventListener('click', () => copy(value('created-url')));
  $('close-publication').addEventListener('click',()=>$('publication-dialog').close());
  $('publication-form').addEventListener('submit',async e=>{
    e.preventDefault();if($('save-publication').disabled)return;
    let input;try{input=validatePublicationUpdate({publication_id:editingPublication,published_on:value('edit-published-on'),publication_url:value('edit-publication-url')});}catch(error){$('publication-status').textContent=error.message;return;}
    $('save-publication').disabled=true;$('publication-status').textContent='Enregistrement…';
    try{
      if(!demo){const res=await win.fetch(endpoint,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(12000)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Enregistrement impossible.');}
      for(const row of state.links)if((row.publication_id||row.id)===input.publication_id){row.published_on=input.published_on;row.publication_url=input.publication_url;}
      render();$('publication-dialog').close();toast(demo?'Fiche modifiée dans la démo.':'Publication enregistrée.');
    }catch(error){$('publication-status').textContent=error.message;}
    finally{$('save-publication').disabled=false;}
  });
  if (demo) {
    $('notice').textContent = 'Mode démo · Teste librement : les exemples restent dans cette page, rien n’est enregistré.'; $('notice').hidden = false;
    const samples = [
      ['Les 7 affirmations','short','instagram','dm','mc2-evergreen','mc2','Reel · réponse au commentaire cœur'],
      ['12 minutes pour changer ton état','email','email','button','delta-vision','delta','Email de découverte'],
      ['Invitation à la masterclass','sms','sms','body','mc2-evergreen','mc2','Prochaine campagne SMS'],
    ];
    for (const [title,format,channel,placement,campaign,destination,publication_label] of samples) {
      const id = win.crypto.randomUUID(), cId = win.crypto.randomUUID();
      const content = {id:cId,title,format,topic:'',angle:''}; state.contents.push(content);
      state.links.push({...content,id,content_id:cId,channel,placement,campaign,destination,publication_label,code:linkCode(id),arrivals:0,registrations:0,published_on:'2026-11-11',publication_url:null});
    }
    state.totals = {contents:3,links:3,arrivals:0,registrations:0};
  }
  helpers(); void load();
}

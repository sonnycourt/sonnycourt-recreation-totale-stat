export function bioRates(row) {
  const choices=Number(row.choices||0),visits=Number(row.visits||0);
  return {delta:choices?100*row.delta/choices:null,mc2:choices?100*row.mc2/choices:null,choice:visits?100*choices/visits:null};
}
export function initBioAnalytics(doc=document,win=window) {
  const $=id=>doc.getElementById(id),demo=!['sonnycourt.com','www.sonnycourt.com'].includes(win.location.hostname)&&new URLSearchParams(win.location.search).get('demo')==='1';
  const n=v=>Number(v||0).toLocaleString('fr-CH'),pct=v=>v===null?'—':v.toLocaleString('fr-FR',{maximumFractionDigits:1})+' %';
  const empty={visits:0,choices:0,mc2:0,delta:0,no_choice:0};
  let loaded=false,generation=0;
  const el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  function render(data){
    const total=data.totals,rates=bioRates(total);
    $('bio-results').hidden=false;$('bio-empty').hidden=total.visits>0;
    $('bio-visits').textContent=n(total.visits);$('bio-choices').textContent=n(total.choices);$('bio-choice-rate').textContent=pct(rates.choice)+' des visites';$('bio-no-choice').textContent=n(total.no_choice);
    $('bio-mc2-share').textContent=pct(rates.mc2);$('bio-delta-share').textContent=pct(rates.delta);
    $('bio-mc2-count').textContent=n(total.mc2)+' premiers choix';$('bio-delta-count').textContent=n(total.delta)+' premiers choix';
    $('bio-mc2-bar').style.width=(rates.mc2||0)+'%';$('bio-delta-bar').style.width=(rates.delta||0)+'%';
    $('bio-denominator').textContent=total.choices?`Répartition parmi les ${n(total.choices)} visites ayant choisi un programme.`:'La répartition apparaîtra dès le premier choix enregistré.';
    const rows=[{...empty,...data.bio_links.find(r=>r.code==='e7dd5eb52276'),label:'TikTok',path:'/links/tt'}, {...empty,...data.bio_links.find(r=>r.code==='d70aca695f3c'),label:'YouTube',path:'/links/yt'}];
    const others={label:'Autres accès',path:'Direct et autres liens'};
    for(const key of Object.keys(empty))others[key]=total[key]-rows.reduce((sum,r)=>sum+r[key],0);
    rows.push(others);$('bio-source-rows').replaceChildren();
    for(const row of rows){
      const tr=el('tr'),label=el('th'),r=bioRates(row);label.scope='row';label.append(el('strong','',row.label),el('small','',row.path));tr.append(label);
      tr.append(el('td','',n(row.visits)));
      const choice=el('td');choice.append(el('strong','',pct(r.choice)),el('small','',n(row.choices)+' choix'));tr.append(choice);
      for(const key of ['mc2','delta']){const cell=el('td','bio-'+key);cell.append(el('strong','',pct(r[key])),el('small','',n(row[key])+' choix'));tr.append(cell);}
      $('bio-source-rows').append(tr);
    }
    $('bio-status').textContent=demo?'Démonstration · chiffres fictifs.':data.first_observed_at?'Suivi depuis le '+new Date(data.first_observed_at).toLocaleDateString('fr-FR',{timeZone:'Europe/Zurich'})+' · actualisé à '+new Date(data.generated_at).toLocaleTimeString('fr-FR',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit'}):'Le suivi est actif. Les prochaines visites apparaîtront ici.';
  }
  async function load(){
    const version=++generation;$('refresh-bio').disabled=true;$('bio-status').textContent='Lecture des choix…';$('bio-results').hidden=true;
    try{
      let data;
      if(demo)data={totals:{visits:1000,choices:700,mc2:420,delta:280,no_choice:300},bio_links:[{code:'e7dd5eb52276',visits:600,choices:360,mc2:180,delta:180,no_choice:240},{code:'d70aca695f3c',visits:300,choices:270,mc2:216,delta:54,no_choice:30}]};
      else {
        const res=await win.fetch('/.netlify/functions/admin-marketing-bio?days='+$('bio-period').value,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
        data=await res.json();if(res.status===401)doc.dispatchEvent(new Event('marketing-auth-required'));
        if(!res.ok)throw new Error(data.error||'Lecture momentanément indisponible.');
      }
      if(version!==generation)return;
      render(data);loaded=true;
    }catch(error){if(version===generation)$('bio-status').textContent=error.message||'Lecture momentanément indisponible.';}
    finally{if(version===generation)$('refresh-bio').disabled=false;}
  }
  function clear(){generation++;loaded=false;$('bio-results').hidden=true;$('bio-source-rows').replaceChildren();$('bio-status').textContent='';$('refresh-bio').disabled=false;}
  doc.addEventListener('marketing-auth-required',clear);
  $('tab-bio').addEventListener('click',()=>{
    for(const key of ['links','purchases','bio']){$(key+'-panel').hidden=key!=='bio';$('tab-'+key).setAttribute('aria-pressed',String(key==='bio'));}
    if(!loaded)void load();
  });
  $('refresh-bio').addEventListener('click',()=>void load());$('bio-period').addEventListener('change',()=>void load());
}

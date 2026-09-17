import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.ONBOARDING_UI_URL || 'http://127.0.0.1:4378';
const browser=await puppeteer.launch({headless:true});
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1060,deviceScaleFactor:1});
  await page.goto(`${base}/onboarding/?demo=1`,{waitUntil:'networkidle0'});
  await page.waitForSelector('#case-form');
  const logContact=async(kind,note='')=>{
    await page.click('#log-contact');
    await page.waitForSelector('#contact-dialog[open]');
    await page.select('#contact-kind',kind);
    if(note)await page.type('#contact-note',note);
    await page.click('#contact-form button[type=submit]');
    await page.waitForFunction(()=>!document.querySelector('#contact-dialog').open);
  };
  assert.equal(await page.$$eval('a[href^="tel:"]',e=>e.length),0);
  assert.equal(await page.$$eval('.checks input',e=>e.length),3);
  assert.equal(await page.$$eval('.person',e=>e.length),4);
  assert.equal(await page.$eval('#count-due',e=>e.textContent),'2');
  await page.screenshot({path:'/private/tmp/onboarding-desktop.png',fullPage:true});
  await page.type('[name=goal]','Mon objectif concret');
  await logContact('call_no_answer');
  await page.waitForFunction(()=>document.querySelector('[name=status]').value==='contacting');
  assert.equal(await page.$eval('[name=goal]',e=>e.value),'Mon objectif concret');
  assert.equal(await page.$eval('[name=next_action]',e=>e.value),'sms');
  await logContact('sms_sent');
  await page.waitForFunction(()=>document.querySelector('[name=status]').value==='awaiting');
  assert.equal(await page.$eval('[name=next_action]',e=>e.value),'whatsapp');
  assert.equal(await page.$$eval('#history li',e=>e.length),2);
  // Switch and back: saved notes persist in the demo store, not only the form.
  await page.click('.person:nth-of-type(1)');
  await page.click('[data-case="00000000-0000-4000-8000-000000000002"]');
  await page.waitForFunction(()=>document.querySelector('.detail-title h2').textContent==='Alex Bernard');
  await page.click('[data-case="00000000-0000-4000-8000-000000000001"]');
  await page.waitForFunction(()=>document.querySelector('.detail-title h2').textContent==='Camille Martin');
  assert.equal(await page.$eval('[name=goal]',e=>e.value),'Mon objectif concret');
  // Dirty guard: cancel switching; draft must remain.
  await page.type('[name=notes]','Brouillon à conserver');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.click('[data-case="00000000-0000-4000-8000-000000000002"]');
  assert.equal(await page.$eval('[name=notes]',e=>e.value),'Brouillon à conserver');
  await page.click('#case-form button[type=submit]');
  await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Fiche enregistrée');
  // HTML in notes is displayed as text, not executed.
  await logContact('note','<img src=x onerror="window.__xss=true">');
  await page.waitForFunction(()=>document.querySelector('#history').textContent.includes('<img'));
  assert.equal(await page.evaluate(()=>Boolean(window.__xss)),false);
  assert.equal(await page.$$eval('#history img',e=>e.length),0);
  const historyBefore=await page.$$eval('#history li',e=>e.length);
  page.once('dialog',dialog=>dialog.accept());
  await page.click('[data-delete-event]');
  await page.waitForFunction(n=>document.querySelectorAll('#history li').length===n-1,{},historyBefore);
  assert.equal(await page.$eval('[name=notes]',e=>e.value),'Brouillon à conserver');
  for(const width of [390,640,820,1440]){
    await page.setViewport({width,height:900,deviceScaleFactor:1});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no horizontal overflow at ${width}`);
    if(width===390){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/private/tmp/onboarding-mobile.png',fullPage:true});}
  }
  await page.select('#filter','done');
  await page.waitForFunction(()=>document.querySelectorAll('.person').length===1);
  assert.ok(await page.$eval('#case-list',e=>e.textContent.includes('Noa Petit')));
  assert.equal(errors.length,0,errors.join('\n'));

  // Real-mode UI with intercepted synthetic responses: network/conflict must not erase notes.
  const live=await browser.newPage();await live.setViewport({width:1440,height:1000});
  await live.setRequestInterception(true);
  const c={id:'00000000-0000-4000-8000-000000000001',name:'Fiche synthétique',email:'fixture@example.test',country:'FR',display_name:'Fiche synthétique',status:'new',next_action:'call',source:'mc2',version:1,purchased_at:'2026-09-17T12:00:00Z',first_payment_date:'2026-09-24',coaching_from:'2026-10-20',feedback_date:'2026-10-01',plan_label:'12 × 197 €',goal:'',notes:'',motivations:'',obstacles:'',routine:''};
  let writes=0;const commands=[];
  live.on('request',async req=>{
    if(!req.url().includes('/.netlify/functions/onboarding-crm'))return req.continue();
    if(req.method()==='POST'){
      writes++;commands.push(JSON.parse(req.postData()).command_id);
      return req.respond({status:writes===1?503:409,contentType:'application/json',body:JSON.stringify({error:writes===1?'Indisponible. Réessaie.':'Dossier modifié ailleurs. Brouillon conservé.'})});
    }
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify(req.url().includes('?id=')?{case:c,events:[]}:{cases:[c],total:1,counts:{new:1,due:1,booked:0,done:0},actor:{name:'Coach test'},refreshedAt:new Date().toISOString()})});
  });
  await live.goto(`${base}/onboarding/`,{waitUntil:'networkidle0'});
  await live.click('.person');await live.waitForSelector('#case-form');
  await live.type('[name=notes]','Ne pas perdre ces notes');
  await live.click('#case-form button[type=submit]');
  await live.waitForSelector('#detail-message:not([hidden])');
  assert.equal(await live.$eval('[name=notes]',e=>e.value),'Ne pas perdre ces notes');
  await live.click('#case-form button[type=submit]');
  await live.waitForFunction(()=>document.querySelector('#detail-message').textContent.includes('ailleurs'));
  assert.equal(commands[0],commands[1],'idempotent network retry');
  assert.equal(await live.$eval('[name=notes]',e=>e.value),'Ne pas perdre ces notes');
  console.log('UI onboarding : desktop/mobile, contact/SMS, notes, filtres, XSS, conflit, coupure et retry vérifiés.');
} finally { await browser.close(); }

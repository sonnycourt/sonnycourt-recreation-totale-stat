import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({headless:true});
try {
 for (const width of [390,1280]) {
  const context=await browser.createBrowserContext();
  const page=await context.newPage();
  await page.setViewport({width,height:900});
  await page.evaluateOnNewDocument(()=>{
    localStorage.setItem('mc2_registration_token','fixture-old-token');
    // Le widget externe est simulé, comme les API ; aucun CDN réel contacté.
    window.intlTelInput=input=>({getNumber:()=>input.value,isValidNumber:()=>true,getSelectedCountryData:()=>({iso2:'fr'})});
  });
  await page.setRequestInterception(true);
  const registrations=[];
  page.on('request',async req=>{
   const url=new URL(req.url());
   if(url.hostname!=='reregister.test') return req.abort();
   const json=body=>req.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname.endsWith('/get-mc2-registration')) return json({valid:true,token:'fixture-old-token',statut:'registered',sessionStartsAt:'2026-01-01T12:00:00Z',sessionEndsAt:'2026-01-01T14:00:00Z'});
   if(url.pathname.endsWith('/check-mc2-eligibility') || url.pathname.endsWith('/check-mc2-phone-country')) return json({eligible:true});
   if(url.pathname.endsWith('/register-mc2')) {
    registrations.push(JSON.parse(req.postData()));
    return json({success:true,token:'fixture-old-token',sessionGeneration:registrations.at(-1).telephone?1:0,alreadyRegistered:true});
   }
   if(url.pathname.startsWith('/.netlify/functions/')) return json({ok:true});
   if(url.pathname.startsWith('/mc2/confirmation')) return req.respond({status:200,contentType:'text/html',body:'<h1>Confirmation fixture</h1>'});
   const file=path.resolve('dist',url.pathname.slice(1)+(url.pathname.endsWith('/')?'index.html':''));
   if(!file.startsWith(path.resolve('dist')+path.sep)||!existsSync(file))return req.abort();
   return req.respond({status:200,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:readFileSync(file)});
  });
  await page.goto('https://reregister.test/mc2/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-main.is-visible');
  await page.click('.popup-trigger');
  await page.waitForSelector('#name',{visible:true});
  await page.waitForFunction(()=>!document.getElementById('pre-optin-overlay')?.classList.contains('is-visible'));
  await page.type('#name','Fixture');
  await page.type('#email','fixture@example.invalid');
  await page.click('#step1-button');
  try { await page.waitForSelector('#phone',{visible:true}); }
  catch(error) { console.error(await page.$eval('#custom-popup',e=>e.innerText)); throw error; }
  await page.type('#phone','+33612345678');
  await page.click('#step2-next');
  await page.waitForSelector('#commit-present',{visible:true});
  await page.click('#commit-present');
  await page.click('#step3-submit');
  await page.waitForFunction(()=>location.pathname.startsWith('/mc2/confirmation'));
  assert.equal(registrations.length,2);
  assert.equal(registrations[0].telephone,undefined);
  assert.equal(registrations[1].telephone,'+33612345678');
  assert.equal(new URL(page.url()).searchParams.get('t'),'fixture-old-token');
  console.log(`PASS ${width}px: ancien cookie, étapes email/téléphone/engagement, confirmation même token. Réseau entièrement simulé.`);
  await context.close();
 }
} finally {await browser.close();}

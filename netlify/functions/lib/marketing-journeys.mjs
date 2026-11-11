import { database } from './marketing-links.mjs';

const TOKEN = /^[a-zA-Z0-9_-]{16,160}$/;
const ID = /^[1-9]\d*$/;
const regSelect = 'id,token,email,prenom,registration_completed_at,session_joined_at,cta_clicked_at,checkout_last_viewed_at,purchased_at,saw_offer';
const inTokens = tokens => tokens.filter(t => TOKEN.test(t)).map(encodeURIComponent).join(',');

export function purchaseSummary(event, registration) {
  const m = event.metadata || {};
  return { id:String(event.id), order_id:String(m.order_id || ''), registration_id:registration.id,
    name:registration.prenom || m.purchase_first_name || '', email:registration.email,
    product:'Esprit Subconscient 2.0', purchased_at:event.occurred_at,
    payment_mode:m.payment_mode || '', initial_minor:Number.isSafeInteger(m.amount_cents) ? m.amount_cents : null };
}

export async function readMarketingPurchases(read = database) {
  const events = await read('mc2_funnel_events?event_name=eq.purchase_completed&metadata->>provider=eq.spiffy&select=id,token,occurred_at,metadata&order=occurred_at.desc,id.desc&limit=101');
  const tokens = [...new Set(events.map(e => e.token).filter(t => TOKEN.test(t)))];
  if (!tokens.length) return { purchases:[], limited:false, scope:'MC2 · commandes Spiffy confirmées' };
  const filter = inTokens(tokens);
  const [registrations, tests] = await Promise.all([
    read(`mc2_registrations?token=in.(${filter})&select=${regSelect}&limit=101`),
    read(`mc2_tracking_test_registrations?token=in.(${filter})&select=token&limit=101`),
  ]);
  const excluded = new Set(tests.map(t => t.token)), byToken = new Map(registrations.map(r => [r.token,r]));
  const orders = new Set(), purchases = [];
  for (const e of events.slice(0,100)) {
    const order = String(e.metadata?.order_id || ''), r = byToken.get(e.token);
    if (!r || excluded.has(e.token) || !ID.test(order) || orders.has(order)) continue;
    orders.add(order); purchases.push(purchaseSummary(e,r));
  }
  return { purchases, limited:events.length>100, scope:'MC2 · commandes Spiffy confirmées' };
}

export function verifiedOrderPayments(order, expectedId) {
  if (String(order?.id)!==String(expectedId) || !Array.isArray(order.payments)) return { available:false };
  const seen = new Set(), payments = [];
  for (const p of order.payments) {
    if (String(p.order_id)!==String(expectedId) || seen.has(String(p.id))) continue;
    if (!['succeeded','refunded','partially_refunded'].includes(p.status)) continue;
    const gross=Number(p.amount_paid), refunded=Number(p.amount_refunded || 0);
    if (!p.id || !Number.isSafeInteger(gross) || gross<0 || !Number.isSafeInteger(refunded) || refunded<0 || refunded>gross || String(p.currency).toLowerCase()!=='eur') return {available:false};
    seen.add(String(p.id)); payments.push({date:p.created_at, gross_minor:gross, refunded_minor:refunded});
  }
  const gross=payments.reduce((n,p)=>n+p.gross_minor,0), refunds=payments.reduce((n,p)=>n+p.refunded_minor,0);
  return {available:true,currency:'EUR',gross_minor:gross,refunded_minor:refunds,net_minor:gross-refunds,payments,checked_at:new Date().toISOString(),status:order.payment_status};
}

async function orderPayments(orderId) {
  const key=String(process.env.SPIFFY_ONBOARDING_API_KEY || '').trim();
  if (!key) return {available:false};
  try {
    const res=await fetch(`https://api.spiffy.co/v2/orders/${orderId}?include=payments`,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if (!res.ok) return {available:false};
    return verifiedOrderPayments((await res.json()).data,orderId);
  } catch {return {available:false};}
}

export async function readMarketingJourney(id, read=database, commerce=orderPayments) {
  if (!ID.test(String(id))) return null;
  const [e] = await read(`mc2_funnel_events?id=eq.${id}&event_name=eq.purchase_completed&metadata->>provider=eq.spiffy&select=id,token,occurred_at,metadata&limit=1`);
  if (!e || !TOKEN.test(e.token) || !ID.test(String(e.metadata?.order_id || ''))) return null;
  const [registrations,tests] = await Promise.all([
    read(`mc2_registrations?token=eq.${encodeURIComponent(e.token)}&select=${regSelect}&limit=1`),
    read(`mc2_tracking_test_registrations?token=eq.${encodeURIComponent(e.token)}&select=token&limit=1`),
  ]);
  const r=registrations[0]; if (!r || tests.length) return null;
  const cutoff=encodeURIComponent(e.occurred_at);
  const [points,surveys,cash] = await Promise.all([
    read(`marketing_mc2_attribution?registration_id=eq.${r.id}&select=marketing_touchpoints!inner(id,visitor_id,occurred_at,marketing_links!inner(code,channel,campaign,created_at,marketing_publications!inner(published_on,publication_url,marketing_contents!inner(title))))&marketing_touchpoints.occurred_at=lte.${cutoff}&order=linked_at.asc,touchpoint_id.asc&limit=501`),
    read(`mc2_survey_responses?registration_id=eq.${r.id}&created_at=lte.${cutoff}&select=priority,familiarity,profession,urgency,created_at,updated_at&order=created_at.desc&limit=1`),
    commerce(String(e.metadata.order_id)),
  ]);
  const timeline=[];
  const push=(at,label,extra={})=>{if(at && Number.isFinite(Date.parse(at)) && Date.parse(at)<=Date.parse(e.occurred_at))timeline.push({at,label,...extra});};
  // Later email/SMS clicks on a consented browser need no second opt-in.
  // Only attach them when that browser has a single known registration in the
  // 90-day window. A shared/ambiguous browser is never guessed into a person.
  const allPoints=new Map(points.slice(0,500).map(a=>[a.marketing_touchpoints.id,a.marketing_touchpoints]));
  const visitors=[...new Set([...allPoints.values()].map(t=>t.visitor_id).filter(v=>/^[a-f0-9-]{36}$/.test(v || '')))];
  let limited=points.length>500;
  if (visitors.length) {
    const since=encodeURIComponent(new Date(Date.parse(e.occurred_at)-90*86400000).toISOString());
    const filter=`visitor_id=in.(${visitors.join(',')})&occurred_at=gte.${since}&occurred_at=lte.${cutoff}`;
    const [ownership,later]=await Promise.all([
      read(`marketing_mc2_attribution?select=registration_id,marketing_touchpoints!inner(visitor_id,occurred_at)&marketing_touchpoints.visitor_id=in.(${visitors.join(',')})&marketing_touchpoints.occurred_at=gte.${since}&marketing_touchpoints.occurred_at=lte.${cutoff}&limit=501`),
      read(`marketing_touchpoints?${filter}&select=id,visitor_id,occurred_at,marketing_links!inner(code,channel,campaign,created_at,marketing_publications!inner(published_on,publication_url,marketing_contents!inner(title)))&order=occurred_at.asc,id.asc&limit=501`),
    ]);
    limited ||= ownership.length>500 || later.length>500;
    if (ownership.length<=500) for (const t of later.slice(0,500)) {
      const owners=new Set(ownership.filter(a=>a.marketing_touchpoints.visitor_id===t.visitor_id).map(a=>String(a.registration_id)));
      if (owners.size===1 && owners.has(String(r.id))) allPoints.set(t.id,t);
    }
  }
  for (const t of allPoints.values()) {
    const l=t.marketing_links, p=l.marketing_publications;
    push(t.occurred_at,p.marketing_contents.title,{kind:'contact',channel:l.channel,publication_url:p.publication_url,link_created_at:l.created_at,published_on:p.published_on});
  }
  push(r.registration_completed_at,'Inscription à la masterclass',{kind:'registration'});
  push(r.session_joined_at,'Entrée dans la salle',{kind:'session'});
  push(r.cta_clicked_at,'Clic sur le bouton de l’offre',{kind:'cta'});
  push(r.checkout_last_viewed_at,'Ouverture du checkout',{kind:'checkout'});
  push(e.occurred_at,'Commande Spiffy confirmée',{kind:'purchase'});
  timeline.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const survey=surveys[0] && Date.parse(surveys[0].updated_at)<=Date.parse(e.occurred_at) ? surveys[0] : null;
  return {...purchaseSummary(e,r),timeline,survey,commerce:cash,limited,
    observed_contacts:timeline.filter(t=>t.kind==='contact').length,offer_reached:r.saw_offer===true};
}

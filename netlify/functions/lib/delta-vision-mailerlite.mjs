export function deltaIdentity(input) {
  const firstName = String(input?.firstName || '').trim();
  const email = String(input?.email || '').trim().toLowerCase();
  const phone = String(input?.phone || '').trim();
  if (!firstName || firstName.length > 100 || /[<>\x00-\x1f]/.test(firstName)) return null;
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return {firstName,email,...(phone ? {phone} : {})};
}
export async function saveDeltaSubscriber(identity, {buyer=false, env=process.env, fetcher=fetch}={}) {
  const apiKey=env.MAILERLITE_API_KEY;
  const group=buyer ? env.MAILERLITE_GROUP_DELTA_VISION_BUYERS : env.MAILERLITE_GROUP_DELTA_VISION_REGISTRATIONS;
  if (!apiKey || !/^\d+$/.test(group || '')) throw new Error('delta_mailerlite_not_configured');
  const fields={};
  if (identity.firstName) fields.name=identity.firstName;
  if (identity.phone) fields.phone=identity.phone;
  // POST is additive; never reset existing groups, status, or opt-out preferences.
  const response=await fetcher('https://connect.mailerlite.com/api/subscribers',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({email:identity.email,fields,groups:[group]}),signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`delta_mailerlite_${response.status}`);
  const body=await response.json();
  if (!body.data?.id) throw new Error('delta_mailerlite_invalid_response');
  return true;
}
export function deltaJson(status, body) {return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}

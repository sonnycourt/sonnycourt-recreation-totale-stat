export const DVP_GROUP_ID='204040026040829106';
export const validToken=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export async function dvpDb(path,{env=process.env,fetcher=fetch,method='GET',body}={}) {
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('dvp_database_not_configured');
  const res=await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('dvp_database_error');
  const raw=await res.text();return raw?JSON.parse(raw):null;
}
export function publicAccess(row,now=Date.now()) {
  return {token:row.token,expiresAt:row.expires_at,serverNow:new Date(now).toISOString(),position:row.position_seconds,offerUnlocked:row.offer_unlocked,expired:now>=Date.parse(row.expires_at)};
}
export async function requestBody(req,max=4096) {
  if(req.method!=='POST')return {status:405};
  if(req.headers.get('origin')!==new URL(req.url).origin)return {status:403};
  if(!req.headers.get('content-type')?.startsWith('application/json'))return {status:415};
  if(Number(req.headers.get('content-length'))>max)return {status:413};
  try{const raw=await req.text();if(raw.length>max)return {status:413};const input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))return {status:400};return {input};}catch{return {status:400};}
}

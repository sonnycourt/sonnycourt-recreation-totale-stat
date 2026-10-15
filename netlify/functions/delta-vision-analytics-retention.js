import {getSupabaseConfig,supabaseHeaders} from './lib/supabase-rest.mjs';
// Netlify scheduled functions reject direct public invocations.
export default async function handler(){
 const cutoff=new Date(Date.now()-90*86400000).toISOString();
 const {url,key}=getSupabaseConfig();if(!url||!key)throw new Error('delta_analytics_not_configured');
 const result=await fetch(`${url}/rest/v1/delta_vision_analytics_events?received_at=lt.${encodeURIComponent(cutoff)}`,{method:'DELETE',headers:supabaseHeaders({Prefer:'return=minimal'}),signal:AbortSignal.timeout(25000)});
 if(!result.ok)throw new Error('delta_analytics_retention_failed');
 return new Response(null,{status:204});
}
export const config={schedule:'17 3 * * *'};

import {getSupabaseConfig,supabaseHeaders} from './supabase-rest.mjs';
import {InterviewError} from './es2-interview-domain.mjs';
const TABLE='es2_interviews';
export async function db(path,{method='GET',body,prefer}={}){
 const {url,key}=getSupabaseConfig();if(!url||!key)throw new InterviewError('configuration',503);
 const response=await fetch(`${url}/rest/v1/${path}`,{method,headers:supabaseHeaders(prefer?{Prefer:prefer}:{}),...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 const value=await response.json().catch(()=>null);
 if(!response.ok){if(value?.code==='42P01'||value?.code==='PGRST205')throw new InterviewError('storage_not_ready',503);throw new InterviewError('storage_unavailable',503);}
 return value;
}
export const getByHash=async hash=>(await db(`${TABLE}?token_hash=eq.${hash}&limit=1`))?.[0]||null;
export const getById=async id=>(await db(`${TABLE}?id=eq.${id}&limit=1`))?.[0]||null;
export async function cas(row,patch){return (await db(`${TABLE}?id=eq.${row.id}&version=eq.${row.version}`,{method:'PATCH',body:{...patch,version:row.version+1,updated_at:new Date().toISOString()},prefer:'return=representation'}))?.[0]||null;}
export async function insertInvitation(row){const rows=await db(`${TABLE}?on_conflict=email`,{method:'POST',body:row,prefer:'resolution=ignore-duplicates,return=representation'});return rows?.[0]||(await db(`${TABLE}?email=eq.${encodeURIComponent(row.email)}&limit=1`))?.[0];}
export const listInterviews=()=>db(`${TABLE}?select=id,email,first_name,status,created_at,updated_at,completed_at,job&order=updated_at.desc&limit=100`);

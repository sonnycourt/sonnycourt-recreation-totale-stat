// Read-only connection check. Credentials stay in child-process/session memory.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SESSION_COOKIE, signMarketingSession } from '../netlify/functions/lib/marketing-auth.mjs';
import { fetchAdminAuthRow } from '../netlify/functions/lib/admin-es2-supabase.mjs';
import { database } from '../netlify/functions/lib/marketing-links.mjs';

try {
  const cli = resolve('node_modules/.bin/netlify');
  const env = name => execFileSync(cli,['env:get',name,'--context','production','--scope','functions','--site','0f20b797-5d46-4b6f-96f2-8716f3f6a0e9'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  process.env.SUPABASE_URL = env('SUPABASE_URL');
  process.env.SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  const report = await database('rpc/marketing_links_overview',{});
  console.log(JSON.stringify({supabase:'connected',totals:report.totals}));
  if (process.argv[2]) {
    const base = new URL(process.argv[2]);
    if (base.protocol !== 'https:' || !(base.hostname.endsWith('.netlify.app') || base.hostname==='sonnycourt.com')) throw new Error('invalid_preview');
    const auth=await fetchAdminAuthRow();
    if(!auth.ok || !auth.row?.password_hash)throw new Error('auth_unavailable');
    const cookie = SESSION_COOKIE+'='+signMarketingSession(auth.row.password_hash);
    const response = await fetch(new URL('/.netlify/functions/admin-marketing-links',base),{headers:{cookie},signal:AbortSignal.timeout(15000)});
    const data = await response.json();
    console.log(JSON.stringify({preview_status:response.status,connected:data.connected===true,totals:data.totals || null}));
    if (!response.ok || !data.connected) process.exitCode=1;
    const anonymous=await fetch(new URL('/.netlify/functions/admin-marketing-journeys',base));
    const purchases=await fetch(new URL('/.netlify/functions/admin-marketing-journeys',base),{headers:{cookie}});
    console.log(JSON.stringify({anonymous_purchases:anonymous.status,authenticated_purchases:purchases.status}));
    if(anonymous.status!==401 || purchases.status!==200)process.exitCode=1;
  }
} catch { console.error('Lecture de vérification indisponible. Aucun secret affiché, aucune écriture effectuée.'); process.exitCode=1; }

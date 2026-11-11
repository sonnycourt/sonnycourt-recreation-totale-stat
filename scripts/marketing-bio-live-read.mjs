// Read-only verification. Never create test analytics in production.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {SESSION_COOKIE,signMarketingSession} from '../netlify/functions/lib/marketing-auth.mjs';
import {fetchAdminAuthRow} from '../netlify/functions/lib/admin-es2-supabase.mjs';
import {database} from '../netlify/functions/lib/marketing-links.mjs';
try {
  const cli=resolve('node_modules/.bin/netlify');
  const env=name=>execFileSync(cli,['env:get',name,'--context','production','--scope','functions','--site','0f20b797-5d46-4b6f-96f2-8716f3f6a0e9'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  process.env.SUPABASE_URL=env('SUPABASE_URL');process.env.SUPABASE_SERVICE_ROLE_KEY=env('SUPABASE_SERVICE_ROLE_KEY');
  const report=await database('rpc/marketing_bio_report',{p_days:0});
  assert.equal(report.version,1);assert.equal(report.totals.choices,report.totals.mc2+report.totals.delta);
  console.log(JSON.stringify({supabase:'connected',version:report.version,totals:report.totals}));
  if(process.argv[2]){
    const base=new URL(process.argv[2]);if(base.protocol!=='https:'||!(base.hostname==='sonnycourt.com'||base.hostname.endsWith('.netlify.app')))throw Error('invalid_url');
    const auth=await fetchAdminAuthRow();if(!auth.ok||!auth.row?.password_hash)throw Error('auth_unavailable');
    const cookie=SESSION_COOKIE+'='+signMarketingSession(auth.row.password_hash);
    const anonymous=await fetch(new URL('/.netlify/functions/admin-marketing-bio',base));assert.equal(anonymous.status,401);
    for(const days of [0,7,30]){
      const res=await fetch(new URL('/.netlify/functions/admin-marketing-bio?days='+days,base),{headers:{cookie},signal:AbortSignal.timeout(15000)});
      const data=await res.json();assert.equal(res.status,200);assert.equal(data.version,1);assert.equal(data.days,days);
      console.log(JSON.stringify({days,private_status:res.status,anonymous_status:anonymous.status,totals:data.totals}));
    }
    const collector=await fetch(new URL('/.netlify/functions/marketing-bio-event',base));assert.equal(collector.status,405);
    console.log('PASS — collector deployed, GET cannot write; report private and readable.');
  }
}catch{console.error('Read-only verification failed; no secrets displayed and no data written.');process.exitCode=1;}

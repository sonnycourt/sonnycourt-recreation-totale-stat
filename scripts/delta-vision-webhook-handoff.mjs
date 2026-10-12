// Generates a private, temporary UI handoff file. Never prints the credential.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const preview=new URL(process.argv[2]);
if(preview.href!=='https://sonnycourt.com/' && !/^https:\/\/[a-z0-9]+--sonnycourt-recreation-totale\.netlify\.app\/$/.test(preview.href))throw new Error('Destination Delta Vision invalide');
const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url),'utf8')).siteId;
const env=JSON.parse(execFileSync('npx',['netlify','env:list','--site',site,'--context','production','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const token=env.DELTA_VISION_SPIFFY_WEBHOOK_TOKEN;
if(!token || token.length<32)throw new Error('Secret absent');
const url=new URL('/.netlify/functions/delta-vision-purchase',preview);
url.searchParams.set('token',token);
writeFileSync('/private/tmp/delta-vision-spiffy-webhook-url.txt',url.href,{mode:0o600,flag:'w'});
console.log('URL du webhook préparée dans un fichier temporaire privé, secret non affiché.');

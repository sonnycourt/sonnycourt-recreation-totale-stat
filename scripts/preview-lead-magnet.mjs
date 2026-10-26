// Proxy local uniquement. La clé reste en mémoire, jamais envoyée au navigateur.
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHandler} from '../netlify/functions/lead-magnet-register.js';

const live=process.argv.includes('--live');
const port=4474;
const env={...process.env};
if(live){
  const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url))).siteId;
  const remote=JSON.parse(execFileSync('npx',['netlify','env:list','--context','production','--json','--site',site],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  env.MAILERLITE_API_KEY=remote.MAILERLITE_API_KEY;
  env.MAILERLITE_GROUP_LEAD_MAGNET_PAPA='202390291667223625';
  env.LEAD_MAGNET_PAPA_ENABLED='true';
  if(!env.MAILERLITE_API_KEY)throw new Error('Clé MailerLite indisponible');
}
const handler=createHandler({env});
const windows=new Map();
http.createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`){res.writeHead(403).end();return;}
  if(req.url?.split('?')[0]==='/.netlify/functions/lead-magnet-register'){
    const key=req.socket.remoteAddress;
    const now=Date.now();const recent=(windows.get(key)||[]).filter(at=>now-at<60000);
    if(recent.length>=8){res.writeHead(429,{'Content-Type':'application/json'}).end('{"ok":false}');return;}
    recent.push(now);windows.set(key,recent);
    try{
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){res.writeHead(413).end();return;}}
      const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}:{})});
      const response=await handler(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    }catch{res.writeHead(503,{'Content-Type':'application/json'}).end('{"ok":false}');}
    return;
  }
  const upstream=http.request({hostname:'127.0.0.1',port:4463,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:4463'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502).end('Démarrer Astro sur le port 4463.');});req.pipe(upstream);
}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/ressources/papa/ — ${live?'inscription MailerLite active, aucun email configuré':'inscription désactivée'}`));

/** Preflight by default; --apply explicitly deploys the separate staging worker.
 * Never accepts secrets on the command line or prints token/provider responses. */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const e=process.env;
const id=x=>typeof x==='string'&&/^[1-9]\d{0,15}$/.test(x)&&Number.isSafeInteger(Number(x));
const token=e.STAGING_BOT_TOKEN?.trim(),bot=e.STAGING_BOT_ID,prod=e.PRODUCTION_BOT_ID,origin=e.STAGING_ORIGIN,admins=e.STAGING_ADMIN_IDS;
class SafeError extends Error {}
function check(ok,msg){if(!ok)throw new SafeError(msg);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stage='preflight';
async function request(url,options){
 try{return await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{return null;}
}
async function json(response){try{return await response?.json();}catch{return null;}}
function status(response){return response?'HTTP '+response.status:'connection/timeout';}
async function telegram(method){
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000)});
 const data=await json(response);
 check(response.ok&&data?.ok,'Telegram preflight failed: '+method+' ('+status(response)+')');
 return data.result;
}
function wrangler(args,input){
 const bin=[resolve(dir,'../../node_modules/wrangler/bin/wrangler.js'),resolve(dir,'node_modules/wrangler/bin/wrangler.js')].find(existsSync);
 check(bin,'Install project dependencies with npm ci first.');
 const env={...e,WRANGLER_SEND_METRICS:'false'};
 delete env.STAGING_BOT_TOKEN;delete env.BOT_TOKEN;
 const p=spawnSync(process.execPath,[bin,...args,'--config','wrangler.staging.toml'],{cwd:dir,env,input,encoding:'utf8',maxBuffer:4*1024*1024});
 // Log only fixed categories and numeric provider error codes; never raw output.
 const raw=(p.stdout??'')+'\n'+(p.stderr??'');
 const codes=[...new Set([...raw.matchAll(/(?:\bcode\s*[:=]?\s*|\[code:\s*)(\d{3,8})/gi)].map(m=>m[1]))].join(',');
 const missing=/10007|does not exist on your account/i.test(raw);
 const permission=/not authorized|authentication error|permission|10000|9109/i.test(raw);
 return {ok:p.status===0,output:p.stdout??'',missing,permission,codes,exit:p.status};
}
try{
 const args=process.argv.slice(2);
 check(args.length===0||(args.length===1&&args[0]==='--apply'),'Use no arguments for preflight, or --apply for deployment.');
 check(id(bot)&&id(prod)&&bot!==prod,'Distinct STAGING_BOT_ID and PRODUCTION_BOT_ID required.');
 check(token?.startsWith(bot+':'),'Token does not match staging ID.');
 check(typeof origin==='string'&&/^https:\/\/hypernova-v2-staging\.[a-z0-9-]+\.workers\.dev$/.test(origin),'Invalid staging worker origin.');
 check(typeof admins==='string'&&admins.split(',').every(x=>id(x.trim())),'Explicit staging admin IDs required.');
 const me=await telegram('getMe'),hook=await telegram('getWebhookInfo');
 if(e.STAGING_EXPECTED_USERNAME)check(typeof me.username==='string'&&me.username.toLowerCase()===e.STAGING_EXPECTED_USERNAME.toLowerCase(),'Unexpected staging bot username.');
 check(String(me.id)===bot&&String(me.id)!==prod&&me.is_bot===true,'Wrong Telegram bot identity.');
 check(hook.url===''||hook.url===origin+'/telegram/webhook','Existing webhook points elsewhere. No change made.');
 console.log('Preflight OK: @'+me.username+' → '+origin);
 if(args[0]==='--apply'){
  check(e.STAGING_CONFIRM==='hypernova-v2-staging','Set STAGING_CONFIRM=hypernova-v2-staging to explicitly approve deployment.');
  stage='Cloudflare deploy';
  check(e.CLOUDFLARE_API_TOKEN?.trim()&&e.CLOUDFLARE_ACCOUNT_ID?.trim(),'Missing staging Cloudflare credentials.');
  const deployArgs=['deploy','--var','STAGING_BOT_ID:'+bot,'--var','PRODUCTION_BOT_ID:'+prod,'--var','STAGING_ORIGIN:'+origin,'--var','ADMIN_IDS:'+admins];
  let deployed;
  for(let n=1;n<=5;n++){
   deployed=wrangler(deployArgs);
   if(deployed.ok)break;
   console.log('Deploy attempt '+n+' failed; exit '+deployed.exit+(deployed.codes?' codes '+deployed.codes:'')+(deployed.permission?' (check Cloudflare permissions)':''));
   if(!deployed.missing||n===5)break;
   await sleep(15000);
  }
  check(deployed?.ok,'Cloudflare deploy failed; see numeric codes above.');
  check(deployed.output.includes(origin),'Deployment output did not confirm the expected origin. Webhook unchanged.');
  console.log('Cloudflare deploy OK: '+origin);
  stage='Cloudflare staging secret';
  let saved;
  for(let n=1;n<=3;n++){
   saved=wrangler(['secret','put','BOT_TOKEN'],token+'\n');
   if(saved.ok)break;
   console.log('Secret upload attempt '+n+' failed; exit '+saved.exit+(saved.codes?' codes '+saved.codes:'')+(saved.permission?' (check Cloudflare permissions)':''));
   if(n<3)await sleep(10000);
  }
  check(saved?.ok,'Cloudflare secret upload failed.');
  console.log('Staging bot secret saved.');
  stage='Worker readiness';
  let ready=false;
  for(let n=1;n<=12;n++){
   const response=await request(origin+'/health',{method:'GET'});
   const body=await json(response);
   if(response?.ok&&body?.status==='ok'&&body.bot==='configured'){ready=true;break;}
   console.log('Worker readiness '+n+': '+status(response));
   if(n<12)await sleep(5000);
  }
  check(ready,'Worker did not become ready; verify staging variables and secret propagation.');
  console.log('Worker health OK.');
  stage='Telegram webhook setup';
  const key=createHash('sha256').update('mafia-setup|'+token).digest('hex');
  let verified=false;
  for(let n=1;n<=8;n++){
   const setup=await request(origin+'/telegram/setup',{method:'POST',headers:{'x-setup-key':key}});
   const result=await json(setup);
   if(setup?.ok&&result?.ok&&result.username===me.username&&result.webhook===origin+'/telegram/webhook'){verified=true;break;}
   console.log('Setup attempt '+n+': '+status(setup)+(result?' (JSON response)':' (no JSON response)'));
   // A 403 is a deliberate safety rejection: never retry or override.
   if(setup?.status===403)break;
   if(n<8)await sleep(5000);
  }
  check(verified,'Staging setup failed; see HTTP status above. No foreign webhook override.');
  console.log('Staging webhook verified: https://t.me/'+me.username);
 }else console.log('Read-only preflight; nothing deployed or changed.');
}catch(err){
 // Network errors can contain request URLs in some runtimes; only allow our
 // explicitly sanitized validation errors into logs.
 console.error('Staging stopped at '+stage+'. '+(err instanceof SafeError?err.message:'Unexpected network or runtime error; no raw credentials or response printed.'));
 process.exitCode=1;
}

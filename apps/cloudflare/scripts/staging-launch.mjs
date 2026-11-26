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
function check(ok,msg){if(!ok)throw new Error(msg);}
async function telegram(method){
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000)});
 const data=await response.json();
 check(response.ok&&data.ok,'Telegram preflight failed: '+method);
 return data.result;
}
function wrangler(args,input){
 const bin=[resolve(dir,'../../node_modules/wrangler/bin/wrangler.js'),resolve(dir,'node_modules/wrangler/bin/wrangler.js')].find(existsSync);
 check(bin,'Install project dependencies with npm ci first.');
 const env={...e,WRANGLER_SEND_METRICS:'false'};
 delete env.STAGING_BOT_TOKEN;delete env.BOT_TOKEN;
 const p=spawnSync(process.execPath,[bin,...args,'--config','wrangler.staging.toml'],{cwd:dir,env,input,encoding:'utf8',maxBuffer:4*1024*1024});
 // Do not print raw child output (especially on secret upload failures).
 check(p.status===0,'Wrangler command failed: '+args[0]);
 return p.stdout??'';
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
  const output=wrangler(['deploy','--var','STAGING_BOT_ID:'+bot,'--var','PRODUCTION_BOT_ID:'+prod,'--var','STAGING_ORIGIN:'+origin,'--var','ADMIN_IDS:'+admins]);
  check(output.includes(origin),'Deployment output did not confirm the expected origin. Webhook unchanged.');
  wrangler(['secret','put','BOT_TOKEN'],token+'\n');
  const key=createHash('sha256').update('mafia-setup|'+token).digest('hex');
  const setup=await fetch(origin+'/telegram/setup',{method:'POST',headers:{'x-setup-key':key},redirect:'error',signal:AbortSignal.timeout(90000)});
  const result=await setup.json();
  check(setup.ok&&result.ok&&result.username===me.username&&result.webhook===origin+'/telegram/webhook','Staging setup failed; inspect staging configuration.');
  console.log('Staging webhook verified: https://t.me/'+me.username);
 }else console.log('Read-only preflight; nothing deployed or changed.');
}catch(err){
 // Network errors can contain request URLs in some runtimes; only allow our
 // explicitly sanitized validation errors into logs.
 console.error('Staging stopped. '+(err instanceof Error&&err.constructor===Error?err.message:'Check the staging inputs and connectivity.'));
 process.exitCode=1;
}

/** Defense in depth for an isolated Telegram preview; no secrets are returned. */
export type StagingEnv={
 STAGING_MODE?:string;STAGING_BOT_ID?:string;PRODUCTION_BOT_ID?:string;STAGING_ORIGIN?:string;
 BOT_TOKEN?:string;ADMIN_IDS?:string;V2_PREVIEW?:string;V2_LOCAL_LEDGER?:string;
 STARS_MODE?:string;TEST_HOOKS?:string;DEV_FAKE_PLAYERS?:string;TELEGRAM_API?:string;
};
const id=(v:string|undefined)=>!!v&&/^[1-9]\d{0,15}$/.test(v)&&Number.isSafeInteger(Number(v));
export function stagingAllowed(e:StagingEnv,origin?:string):boolean{
 if(e.STAGING_MODE!=='true')return true;
 const bot=e.STAGING_BOT_ID,prod=e.PRODUCTION_BOT_ID,host=e.STAGING_ORIGIN;
 if(!id(bot)||!id(prod)||bot===prod||!e.BOT_TOKEN?.startsWith(bot+':'))return false;
 if(!host||!/^https:\/\/hypernova-v2-staging\.[a-z0-9-]+\.workers\.dev$/.test(host)||(origin!==undefined&&host!==origin))return false;
 if(!e.ADMIN_IDS?.split(',').every(x=>id(x.trim()))||!e.ADMIN_IDS.trim())return false;
 return e.V2_PREVIEW==='true'&&e.STARS_MODE==='off'&&e.V2_LOCAL_LEDGER==='false'&&e.TEST_HOOKS==='false'&&e.DEV_FAKE_PLAYERS==='false'&&!e.TELEGRAM_API;
}
export function stagingWebhookAllowed(e:StagingEnv,actualBotId:number,existingUrl:string):boolean{
 return e.STAGING_MODE!=='true'||(stagingAllowed(e)&&String(actualBotId)===e.STAGING_BOT_ID&&
 (existingUrl===''||existingUrl===e.STAGING_ORIGIN+'/telegram/webhook'));
}

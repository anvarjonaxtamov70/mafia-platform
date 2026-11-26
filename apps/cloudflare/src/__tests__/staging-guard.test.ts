import {describe,it,expect} from 'vitest';
import {stagingAllowed,stagingWebhookAllowed,type StagingEnv} from '../staging-guard';
const env:StagingEnv={STAGING_MODE:'true',STAGING_BOT_ID:'123',PRODUCTION_BOT_ID:'456',BOT_TOKEN:'123:test',STAGING_ORIGIN:'https://hypernova-v2-staging.example.workers.dev',ADMIN_IDS:'1,2',V2_PREVIEW:'true',V2_LOCAL_LEDGER:'false',STARS_MODE:'off',TEST_HOOKS:'false',DEV_FAKE_PLAYERS:'false'};
describe('isolated staging safety',()=>{
 it('leaves production and local tests unchanged',()=>{expect(stagingAllowed({})).toBe(true);expect(stagingAllowed({STAGING_MODE:'false',TELEGRAM_API:'http://127.0.0.1:8080'})).toBe(true);});
 it('fails closed on blank config, production token, ID collision or wrong worker',()=>{
  expect(stagingAllowed(env,env.STAGING_ORIGIN)).toBe(true);
  for(const patch of [{STAGING_BOT_ID:''},{PRODUCTION_BOT_ID:''},{BOT_TOKEN:'456:test'},{PRODUCTION_BOT_ID:'123'},{STAGING_ORIGIN:'https://mafia-bot.example.workers.dev'},{ADMIN_IDS:''},{ADMIN_IDS:'1,no'}])expect(stagingAllowed({...env,...patch})).toBe(false);
  expect(stagingAllowed(env,'https://mafia-bot.example.workers.dev')).toBe(false);
 });
 it('requires preview-only flags and refuses another bot or existing foreign webhook',()=>{
  for(const patch of [{V2_PREVIEW:'false'},{V2_LOCAL_LEDGER:'true'},{STARS_MODE:'all'},{TEST_HOOKS:'true'},{DEV_FAKE_PLAYERS:'true'},{TELEGRAM_API:'http://127.0.0.1:8080'}])expect(stagingAllowed({...env,...patch})).toBe(false);
  expect(stagingWebhookAllowed(env,123,'')).toBe(true);
  expect(stagingWebhookAllowed(env,123,env.STAGING_ORIGIN+'/telegram/webhook')).toBe(true);
  expect(stagingWebhookAllowed(env,456,'')).toBe(false);
  expect(stagingWebhookAllowed(env,123,'https://mafia-bot.example.workers.dev/telegram/webhook')).toBe(false);
 });
});

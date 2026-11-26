import {describe,it,expect} from 'vitest';
import {World,privateText,callback,GROUP} from './harness';
import {v2BuyView,v2InventoryView,v2SceneInfo} from '../v2-economy-views';
import {visualBlob} from '../visuals';
import {catalogItem,decode} from '@mafia/bot-core';
describe('integrated staging V2 profile, shop, inventory and hero ranking',()=>{
 it('routes live private balances, buys and arms items, then shows the actual V2 hero leaderboard',async()=>{
  const w=new World({v2Preview:true,v2SettingsMode:true,v2Ledger:true});
  const r=w.registryCore,e=r.eco;
  for(const id of [2,3,4])await w.send(privateText(id,'/start'));
  for(const id of [2,3]){
   e.creditDiamonds(id,200,'TEST','gems-'+id);
   expect(r.heroV2.purchase(id,'BUY','hero-'+id)).toBe('OK');
  }
  expect(r.heroV2.purchase(3,'XP1000','xp-3')).toBe('OK');
  expect(r.heroV2.purchase(2,'XP500','xp-2')).toBe('OK');
  e.credit(2,1000,'TEST',null,'cash-2');
  const before=e.coins(2);
  const open=async(raw:string)=>{await w.advance(3100);await w.send(callback(2,raw));};
  const edit=()=>w.tg.calls.filter(x=>x.method==='editMessageText').at(-1)!;
  const controls=()=>(edit().params.reply_markup as {inline_keyboard:{callback_data:string;text:string}[][]}).inline_keyboard.flat();
  await open('m:profile');
  expect(edit().params.text).toContain('HYPERNOVA | PROFIL');expect(edit().params.text).toContain('1 000 $');
  expect(controls().some(b=>b.callback_data==='m:inventory')).toBe(true);
  await open('m:shop');expect(edit().params.text).toContain('HYPERNOVA | DO‘KON');
  expect(controls().some(b=>b.callback_data==='e:buy:SHIELD'&&b.text.includes('300 $'))).toBe(true);
  await open('e:buy:SHIELD');expect(edit().params.text).toContain('XARID');
  expect(e.coins(2)).toBe(before);
  await open('e:buyok:SHIELD');expect(e.coins(2)).toBe(before-300);
  expect(edit().params.text).toContain('HYPERNOVA | DO‘KON');
  await open('m:inventory');expect(edit().params.text).toContain('HYPERNOVA | INVENTAR');
  expect(controls().some(b=>b.callback_data==='e:arm:SHIELD')).toBe(true);
  expect(controls().some(b=>b.callback_data==='e:arm:FAKE_DOC')).toBe(false);
  await open('e:arm:SHIELD');expect(e.inventory(2).items.find(i=>i.code==='SHIELD')?.armed).toBe(true);
  expect(edit().params.text).toContain('HYPERNOVA | INVENTAR');expect(edit().params.text).toContain('✅ Faol');
  await open('m:hero');expect(controls().some(b=>b.callback_data==='m:herotop')).toBe(true);
  await open('m:herotop');expect(edit().params.text).toContain('GEROYLAR TOP 10');
  expect(String(edit().params.text).indexOf('U3')).toBeLessThan(String(edit().params.text).indexOf('U2'));
  expect(edit().params.text).toContain('1 000 ball');expect(edit().params.text).not.toContain('U4');
  expect(r.heroV2.top().map(row=>row.points)).toEqual([1000,500]);
  for(const b of controls())expect(decode(b.callback_data)).not.toBeNull();
  const cash=e.coins(2);await w.send(callback(2,'e:buyok:SHIELD',GROUP));expect(e.coins(2)).toBe(cash);
  const depleted={...e.inventory(2),coins:0,permanentOwner:false};
  expect(v2BuyView(catalogItem('SHIELD')!,depleted).keyboard.flat().some(b=>'callback_data'in b&&b.callback_data==='e:buyok:SHIELD')).toBe(false);
  expect(v2InventoryView(depleted).text).toContain('1 dona');
  expect(r.heroV2.top().map(row=>row.points)).toEqual([1000,500]);
 });
 it('opens curated section art only in private staging and preserves authoritative menu messages',async()=>{
  const w=new World({v2Preview:true,v2SettingsMode:true,v2Ledger:true,visuals:true});
  await w.send(privateText(2,'/start'));
  const sections=['home','profile','shop','inventory','para'];
  const distinct=new Set<string>();
  for(const section of sections){
    const info=v2SceneInfo(section)!;
    expect(info).toBeTruthy();
    const blob=visualBlob(info.key)!;expect(blob.type).toBe('image/jpeg');expect(blob.size).toBeLessThanOrEqual(110000);
    distinct.add(Buffer.from(await blob.arrayBuffer()).toString('base64'));
    await w.advance(5100);await w.send(callback(2,'m:'+section));
    const edit=w.tg.calls.filter(c=>c.method==='editMessageText').at(-1)!;
    const buttons=(edit.params.reply_markup as {inline_keyboard:{callback_data?:string}[][]}).inline_keyboard.flat();
    const art=buttons.find(b=>b.callback_data==='m:vscene_'+section)?.callback_data;
    expect(art).toBeTruthy();expect(decode(art!)).not.toBeNull();
    const before=w.tg.calls.filter(c=>c.method==='sendPhoto').length;
    await w.advance(5100);await w.send(callback(2,art!,GROUP));
    expect(w.tg.calls.filter(c=>c.method==='sendPhoto')).toHaveLength(before);
    await w.advance(5100);await w.send(callback(2,art!));
    const photos=w.tg.calls.filter(c=>c.method==='sendPhoto');expect(photos).toHaveLength(before+1);
    expect(photos.at(-1)?.params.chat_id).toBe(2);
    expect((photos.at(-1)?.params.photo as Blob).type).toBe('image/jpeg');
  }
  expect(distinct.size).toBe(5);expect(v2SceneInfo('unknown')).toBeNull();
 });

});

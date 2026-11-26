import {describe,it,expect} from 'vitest';
import {seededRng,v2CreateFixed,v2Submit,type V2Role} from '@mafia/game-engine';
import {encodeV2Button} from '@mafia/bot-core';
import {World,privateText,groupText,callback,GROUP} from './harness';
async function start(roles:V2Role[],hero=false){
 const w=new World({v2Preview:true,v2Ledger:true}),ids=[1,2,3,4];
 for(const id of ids)await w.send(privateText(id,'/start'));
 const r=w.registryCore;
 if(hero){for(const id of [1,2]){r.eco.creditDiamonds(id,90,'TEST','d'+id);expect(r.heroV2.purchase(id,'BUY','b'+id)).toBe('OK');}}
 await w.send(groupText(1,'/game v2classic'));
 const core=await w.loaded(GROUP),n=core.data.game!.number;
 for(const id of ids.slice(1))await w.send(callback(id,'l:j:'+n,GROUP));
 await w.send(groupText(1,'/startgame'));
 const s=core.data.game!.v2Session!;
 const old=s.state;
 s.state=v2CreateFixed(ids.map(String),roles,'CLASSIC',w.now,seededRng(1));
 for(const p of s.state.players){const previous=old.players.find(x=>x.id===p.id)!;p.heroDefense=previous.heroDefense;p.heroCharges=previous.heroCharges;p.heroDamage=previous.heroDamage;}
 return {w,r,core,n,s};
}
describe('v2 durable RoomCore settlement with isolated test ledger',()=>{
 it('persists night plan before debit, retries a lost response after restart and freezes mutations',async()=>{
  const {w,r,core,n,s}=await start(['DON','GRENCH','CITIZEN','CITIZEN']);
  s.state=v2Submit(s.state,{actor:'1',target:null,kind:'SKIP'},1);
  s.state=v2Submit(s.state,{actor:'2',target:'3',kind:'CHOOSE'},1);
  r.eco.credit(3,200,'TEST',null,'seed');
  await core.forceDeadline();
  const original=w.v2Settlement!.settleNight;
  let amount=0,calls=0;
  w.v2Settlement!.settleNight=async (...args)=>{
    calls++;
    const stored=w.stores.get(GROUP)!.data;
    expect(stored?.ops.some(o=>o.type==='v2Night')).toBe(true);
    amount=args[2][0]!.amount;
    const receipt=await original(...args);
    if(calls===1)throw Error('response lost after commit');
    return receipt;
  };
  await w.advance(30001);
  expect(calls).toBe(1);
  expect(r.eco.coins(3)).toBe(200-amount);
  expect(core.data.game!.v2Session!.state.phase).toBe('NIGHT');
  expect((await core.leave(3)).ok).toBe(false);
  expect((await core.cancel({by:1,isAdmin:true})).ok).toBe(false);
  w.restart(GROUP);
  await w.advance(2100);
  const restored=await w.loaded(GROUP);
  expect(calls).toBe(2);
  expect(restored.data.ops.some(o=>o.type==='v2Night')).toBe(false);
  expect(restored.data.game!.number).toBe(n);
  expect(restored.data.game!.v2Session!.state.phase).toBe('DAWN');
  expect(restored.data.game!.v2Session!.state.players[2]?.hp).toBe(100);
  expect(r.eco.coins(3)).toBe(200-amount);expect(r.eco.coins(2)).toBe(amount);
 });
 it('Klaus gift and Seller offer resolve through night queue even without Grench',async()=>{
  const {w,r,core,n,s}=await start(['DON','KLAUS','SELLER','CITIZEN']);
  s.state=v2Submit(s.state,{actor:'1',target:null,kind:'SKIP'},1);
  s.state=v2Submit(s.state,{actor:'2',target:'4',kind:'CHOOSE'},1);
  s.state=v2Submit(s.state,{actor:'3',target:'4',kind:'CHOOSE'},1);
  const original=w.v2Settlement!.settleDawn;let calls=0,amount=0;
  w.v2Settlement!.settleDawn=async (...args)=>{
    calls++;expect(w.stores.get(GROUP)!.data?.ops.some(o=>o.type==='v2Night')).toBe(true);
    const receipt=await original(...args);
    if(receipt.status==='OK'){const gift=receipt.entries.find(e=>e.kind==='KLAUS');if(gift?.kind==='KLAUS')amount=gift.amount;}
    if(calls===1)throw Error('lost response');
    return receipt;
  };
  await core.forceDeadline();
  expect(calls).toBe(1);expect(amount).toBeGreaterThanOrEqual(50);
  expect(r.eco.coins(4)).toBe(amount);
  expect(core.data.game!.v2Session!.state.phase).toBe('NIGHT');
  w.restart(GROUP);await w.advance(2100);
  const restored=await w.loaded(GROUP);
  expect(calls).toBe(2);expect(r.eco.coins(4)).toBe(amount);
  expect(restored.data.game!.v2Session!.state.phase).toBe('DAWN');
  expect(restored.data.game!.number).toBe(n);
  expect(w.tg.texts(4).join(' ')).toContain('Klaus');
  expect(w.tg.texts(4).join(' ')).toContain('50% chegirmali');
  expect(w.tg.texts(GROUP).join(' ')).not.toContain('Klaus sizga');
 });
 it('hero shot is persisted before charge, replayed after restart and applied once',async()=>{
  const {w,r,core,n,s}=await start(['DON','CITIZEN','CITIZEN','CITIZEN'],true);
  s.state.phase='DAWN';s.state.seq=2;s.state.deadline=w.now+30000;
  const raw=encodeV2Button({game:n,seq:2,op:'H',seat:2});
  const original=w.v2Settlement!.settleHero;let calls=0;
  w.v2Settlement!.settleHero=async request=>{
    calls++;
    expect(w.stores.get(GROUP)!.data?.ops.some(o=>o.type==='v2Hero')).toBe(true);
    const receipt=await original(request);
    if(calls===1)throw Error('response lost after commit');
    return receipt;
  };
  expect((await core.v2Button({tgId:1,privateChatId:1,number:n,raw})).ok).toBe(true);
  await w.runAlarms();
  expect(calls).toBe(1);expect(r.heroV2.view(1)?.charges).toBe(9);
  expect(core.data.game!.v2Session!.state.players[1]?.hp).toBe(100);
  expect((await core.v2Button({tgId:1,privateChatId:1,number:n,raw})).ok).toBe(false);
  w.restart(GROUP);
  await w.advance(2100);
  const restored=await w.loaded(GROUP);
  expect(calls).toBe(2);
  expect(restored.data.game!.v2Session!.state.players[1]?.hp).toBe(63);
  expect(r.heroV2.view(1)).toMatchObject({charges:9,points:6});
  expect(restored.data.ops.some(o=>o.type==='v2Hero')).toBe(false);
 });
});

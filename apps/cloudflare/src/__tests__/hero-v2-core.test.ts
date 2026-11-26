import {describe,it,expect} from 'vitest';
import {World,privateText,GROUP} from './harness';
import type {HeroV2ShotRequest} from '../hero-v2-core';
function running(w:World,ids:number[]){const r=w.registryCore,n=r.allocateGame(GROUP);for(const id of ids)r.claim(id,GROUP,n);r.markRunning(n,ids.length);return n;}
function request(game:number,targetDefense=0):HeroV2ShotRequest{return {game,seq:2,actor:2,target:3,targetHp:100,blocked:false,actorCharges:10,damage:45,targetDefense};}
describe('draft hero v2 persistent economy',()=>{
 it('purchase charges 90 gems once; packs, recharge, defense and rename are transactional',async()=>{
  const w=new World();await w.send(privateText(2,'/start'));await w.send(privateText(3,'/start'));
  const r=w.registryCore,h=r.heroV2,e=r.eco;
  e.creditDiamonds(2,200,'TEST','test-diamond-2');
  e.credit(2,2000,'TEST',null,'test-dollar-2');
  expect(h.purchase(2,'BUY','buy')).toBe('OK');expect(e.diamonds(2)).toBe(110);
  expect(h.purchase(2,'BUY','buy')).toBe('OK');expect(e.diamonds(2)).toBe(110);
  expect(h.purchase(2,'BUY','buy-new')).toBe('FULL');
  expect(h.view(2)).toMatchObject({level:1,damage:45,defense:8,charges:10,points:0});
  expect(h.purchase(2,'XP500','xp')).toBe('OK');expect(h.purchase(2,'XP500','xp')).toBe('OK');
  expect(e.diamonds(2)).toBe(75);expect(h.view(2)?.points).toBe(500);
  expect(h.purchase(2,'XP1000','xp')).toBe('CONFLICT');
  expect(h.purchase(2,'RENAME','name','Nova')).toBe('OK');expect(e.coins(2)).toBe(1220);
  expect(h.view(2)?.name).toBe('Nova');
  expect(h.purchase(2,'RELOAD','already-full')).toBe('FULL');
  const game=running(w,[2,3]),req=request(game);
  const shot=h.settleShot(req);expect(shot).toMatchObject({status:'PAID',lostHp:45,points:7});
  expect(h.view(2)).toMatchObject({charges:9,points:507});
  expect(h.settleShot({...req})).toEqual(shot);
  expect(h.settleShot({...req,targetHp:90})).toEqual({status:'CONFLICT'});
  expect(h.view(2)).toMatchObject({charges:9,points:507});
  r.releaseGame(game,'FINISHED');
  expect(h.settleShot(req)).toEqual(shot);
  expect(h.purchase(2,'RELOAD','reload')).toBe('OK');expect(h.view(2)?.charges).toBe(10);
  expect(e.coins(2)).toBe(1015);
 });
 it('quotes bind account, price, expiry and one confirmation; declined attempts cannot charge later',async()=>{
  const w=new World();for(const id of [2,3])await w.send(privateText(id,'/start'));
  const h=w.registryCore.heroV2,e=w.registryCore.eco;
  e.creditDiamonds(2,200,'TEST','d2');
  const q=h.quote(2,'BUY');if(q.status!=='OK')throw Error('quote missing');
  expect(q.quote).toMatchObject({price:90,currency:'DIAMOND'});
  expect(h.confirm(3,q.quote.id)).toBe('UNAVAILABLE');expect(e.diamonds(2)).toBe(200);
  expect(h.confirm(2,q.quote.id)).toBe('OK');expect(h.confirm(2,q.quote.id)).toBe('OK');
  expect(e.diamonds(2)).toBe(110);
  const a=h.quote(2,'XP500'),b=h.quote(2,'XP1000');
  if(a.status!=='OK'||b.status!=='OK')throw Error('quote missing');
  expect(h.confirm(2,a.quote.id)).toBe('UNAVAILABLE');
  expect(h.confirm(2,b.quote.id)).toBe('OK');expect(h.confirm(2,b.quote.id)).toBe('OK');
  expect(e.diamonds(2)).toBe(45);
  const exp=h.quote(2,'XP500');if(exp.status!=='OK')throw Error('quote missing');
  w.now+=120001;expect(h.confirm(2,exp.quote.id)).toBe('UNAVAILABLE');
  const poor=h.quote(2,'RENAME','Nova');if(poor.status!=='OK')throw Error('quote missing');
  expect(h.confirm(2,poor.quote.id)).toBe('INSUFFICIENT');
  e.credit(2,1000,'TEST',null,'c2');
  expect(h.confirm(2,poor.quote.id)).toBe('INSUFFICIENT');expect(e.coins(2)).toBe(1000);
  const fresh=h.quote(2,'RENAME','Nova');if(fresh.status!=='OK')throw Error('quote missing');
  const game=running(w,[2,3]);expect(h.confirm(2,fresh.quote.id)).toBe('UNAVAILABLE');
  w.registryCore.releaseGame(game,'FINISHED');expect(h.confirm(2,fresh.quote.id)).toBe('UNAVAILABLE');
  expect(h.view(2)?.name).toBe('Hypernova');
 });
 it('defense is persistent, normal nonhero match awards do not modify v2 account',async()=>{
  const w=new World();for(const id of [2,3])await w.send(privateText(id,'/start'));
  const h=w.registryCore.heroV2,e=w.registryCore.eco;
  for(const id of [2,3]){e.creditDiamonds(id,90,'TEST','d'+id);expect(h.purchase(id,'BUY','buy'+id)).toBe('OK');}
  const game=running(w,[2,3]);
  expect(h.settleShot(request(game,7))).toEqual({status:'CONFLICT'});
  expect(h.view(2)?.charges).toBe(10);
  expect(h.settleShot(request(game,8))).toMatchObject({status:'PAID',absorbed:8,lostHp:37,defense:0});
  w.registryCore.releaseGame(game,'FINISHED');
  expect(h.view(3)?.defense).toBe(0);
  expect(h.purchase(3,'RESTORE','restore')).toBe('INSUFFICIENT');
  e.credit(3,200,'TEST',null,'c3');expect(h.purchase(3,'RESTORE','restore')).toBe('OK');
  expect(h.view(3)?.defense).toBe(8);expect(e.coins(3)).toBe(0);
  expect(h.purchase(3,'XP500','no-gems')).toBe('INSUFFICIENT');
 });
 it('rejects nonmembers and persists blocked shots without awarding points',async()=>{
  const w=new World();for(const id of [2,3,4])await w.send(privateText(id,'/start'));
  const h=w.registryCore.heroV2,e=w.registryCore.eco;
  e.creditDiamonds(2,90,'TEST','d2');expect(h.purchase(2,'BUY','buy2')).toBe('OK');
  const game=running(w,[2,3]);
  expect(h.settleShot({...request(game),target:4})).toEqual({status:'UNAVAILABLE'});
  const req={...request(game),blocked:true};
  const shot=h.settleShot(req);
  expect(shot).toMatchObject({status:'PAID',hp:100,lostHp:0,points:0,charges:9});
  expect(h.settleShot(req)).toEqual(shot);
  expect(h.view(2)).toMatchObject({points:0,charges:9});
 });
});

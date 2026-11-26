import {describe,it,expect} from 'vitest';
import {World,privateText} from './harness';
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
  const shot=h.settleShot(1,2,3,100,false);expect(shot?.lostHp).toBe(45);
  expect(shot?.points).toBe(7);expect(h.view(2)).toMatchObject({charges:9,points:507});
  expect(h.settleShot(1,2,3,100,false)).toBeNull();
  expect(h.purchase(2,'RELOAD','reload')).toBe('OK');expect(h.view(2)?.charges).toBe(10);
  expect(e.coins(2)).toBe(1015);
 });
 it('defense is persistent, normal nonhero match awards do not modify v2 account',async()=>{
  const w=new World();for(const id of [2,3])await w.send(privateText(id,'/start'));
  const h=w.registryCore.heroV2,e=w.registryCore.eco;
  for(const id of [2,3]){e.creditDiamonds(id,90,'TEST','d'+id);expect(h.purchase(id,'BUY','buy'+id)).toBe('OK');}
  expect(h.settleShot(2,2,3,100,false)).toMatchObject({absorbed:8,lostHp:37,defense:0});
  expect(h.view(3)?.defense).toBe(0);
  expect(h.purchase(3,'RESTORE','restore')).toBe('INSUFFICIENT');
  e.credit(3,200,'TEST',null,'c3');expect(h.purchase(3,'RESTORE','restore')).toBe('OK');
  expect(h.view(3)?.defense).toBe(8);expect(e.coins(3)).toBe(0);
  expect(h.purchase(3,'XP500','no-gems')).toBe('INSUFFICIENT');
 });
});

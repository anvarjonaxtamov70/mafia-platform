import {describe,it,expect} from 'vitest';
import {seededRng} from '@mafia/game-engine';
import {encodeV2Button} from '@mafia/bot-core';
import {createV2RoomSession} from '../v2-room-session';
import {prepareV2HeroShot,finalizeV2HeroShot,type PendingV2HeroShot} from '../v2-hero-settlement';
import {World,privateText,GROUP} from './harness';
describe('v2 hero settlement bridge',()=>{
 it('durable pending request survives reload; registry receipt matches room once',async()=>{
  const w=new World();const ids=[2,3,4,5];
  for(const id of ids)await w.send(privateText(id,'/start'));
  const r=w.registryCore,h=r.heroV2;
  const game=r.allocateGame(GROUP);
  const room=createV2RoomSession(game,GROUP,'CLASSIC',ids.map(id=>({id,name:'U'+id})),0,seededRng(4)).room;
  const a=room.state.players.find(p=>p.role==='DON')!,t=room.state.players.find(p=>p.role==='CITIZEN')!;
  for(const p of [a,t]){const id=Number(p.id);r.eco.creditDiamonds(id,90,'TEST','d'+id);expect(h.purchase(id,'BUY','b'+id)).toBe('OK');}
  for(const id of ids)r.claim(id,GROUP,game);r.markRunning(game,ids.length);
  a.heroCharges=10;a.heroDamage=45;t.heroDefense=8;
  room.state.phase='DAWN';room.state.seq=2;room.state.deadline=60000;
  const raw=encodeV2Button({game,seq:2,op:'H',seat:room.state.players.indexOf(t)+1});
  expect(()=>prepareV2HeroShot(room,Number(a.id),GROUP,raw,31000)).toThrow();
  const pending=JSON.parse(JSON.stringify(prepareV2HeroShot(room,Number(a.id),Number(a.id),raw,31000))) as PendingV2HeroShot;
  const receipt=h.settleShot(pending.request);expect(receipt).toMatchObject({status:'PAID',lostHp:37,defense:0,charges:9});
  expect(h.settleShot(pending.request)).toEqual(receipt);
  expect(()=>finalizeV2HeroShot(room,pending,{status:'UNAVAILABLE'})).toThrow();
  if(receipt.status!=='PAID')throw Error('receipt missing');
  expect(()=>finalizeV2HeroShot(room,pending,{...receipt,hp:99})).toThrow();
  const next=finalizeV2HeroShot(room,pending,receipt);
  expect(next.room.state.players.find(p=>p.id===t.id)?.hp).toBe(63);
  expect(room.state.players.find(p=>p.id===t.id)?.hp).toBe(100);
  expect(()=>finalizeV2HeroShot(next.room,pending,receipt)).toThrow();
  expect(h.view(Number(a.id))?.charges).toBe(9);
 });
});

import {describe,it,expect} from 'vitest';
import {seededRng,v2CreateFixed,v2Submit,v2BeginNightSession,v2AnswerNightSession} from '@mafia/game-engine';
import {World,privateText,GROUP} from './harness';
import {prepareV2NightSettlement,finalizeV2NightSettlement,type PendingV2NightSettlement} from '../v2-night-settlement';
import type {V2RoomSession} from '../v2-room-session';
async function fixture(){
 const w=new World(),ids=[1,2,3,4];
 for(const id of ids)await w.send(privateText(id,'/start'));
 const r=w.registryCore,game=r.allocateGame(GROUP);
 for(const id of ids)r.claim(id,GROUP,game);r.markRunning(game,ids.length);
 let state=v2CreateFixed(ids.map(String),['DON','GRENCH','CITIZEN','CITIZEN'],'CLASSIC',0,seededRng(1));
 state=v2Submit(state,{actor:'1',target:null,kind:'SKIP'},1);
 state=v2Submit(state,{actor:'2',target:'3',kind:'CHOOSE'},1);
 const night=v2BeginNightSession(state,1000,42);
 const room:V2RoomSession={version:2,game,chatId:GROUP,state,night,lastWords:{},names:{},revision:1};
 return {room,r};
}
describe('v2 night ledger bridge',()=>{
 it('waits for actual receipt, replays money settlement and rejects changed receipt',async()=>{
  const {room,r}=await fixture();
  expect(()=>prepareV2NightSettlement(room,1001)).toThrow();
  const pending=JSON.parse(JSON.stringify(prepareV2NightSettlement(room,31000))) as PendingV2NightSettlement;
  const amount=pending.debits[0]!.amount;
  r.eco.credit(3,200,'TEST',null,'seed');
  const receipt=r.roleV2Economy.settleGrenchBatch(pending.game,pending.round,pending.debits);
  expect(receipt).toMatchObject({status:'OK',entries:[{status:'PAID',amount}]});
  expect(r.roleV2Economy.settleGrenchBatch(pending.game,pending.round,pending.debits)).toEqual(receipt);
  expect(()=>finalizeV2NightSettlement(room,pending,{status:'UNAVAILABLE'},31000)).toThrow();
  if(receipt.status!=='OK')throw Error('receipt missing');
  expect(()=>finalizeV2NightSettlement(room,pending,{...receipt,entries:[]},31000)).toThrow();
  const result=finalizeV2NightSettlement(room,pending,receipt,35000);
  expect(result.room.state.players.find(p=>p.id==='3')?.hp).toBe(100);
  expect(result.room.state.phase).toBe('DAWN');
  expect(result.room.state.deadline).toBe(65000);
  expect(r.eco.coins(3)).toBe(200-amount);expect(r.eco.coins(2)).toBe(amount);
  expect(()=>finalizeV2NightSettlement(result.room,pending,receipt,35000)).toThrow();
 });
 it('insufficient balance and explicit HP choice do not mint money',async()=>{
  const {room,r}=await fixture();
  const pending=prepareV2NightSettlement(room,31000);
  const receipt=r.roleV2Economy.settleGrenchBatch(pending.game,pending.round,pending.debits);
  expect(finalizeV2NightSettlement(room,pending,receipt,31000).room.state.players[2]?.hp).toBe(83);
  const hpRoom={...room,night:v2AnswerNightSession(room.night!,'3','g:2','HP',2000)};
  const hp=prepareV2NightSettlement(hpRoom,2000);
  expect(hp.debits).toEqual([]);
  const empty={status:'OK' as const,game:hp.game,round:hp.round,entries:[]};
  expect(finalizeV2NightSettlement(hpRoom,hp,empty,2000).room.state.players[2]?.hp).toBe(83);
  expect(r.eco.coins(2)).toBe(0);
 });
});

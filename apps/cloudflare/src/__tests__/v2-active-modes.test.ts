import {describe,it,expect} from 'vitest';
import {decodeV2Button} from '@mafia/bot-core';
import {type V2Mode,type V2Role} from '@mafia/game-engine';
import {World,privateText,groupText,callback,GROUP} from './harness';

async function start(mode:V2Mode){
 const w=new World({v2Preview:true,v2Ledger:true});
 const ids=[1,2,3,4];
 for(const id of ids)await w.send(privateText(id,'/start'));
 await w.send(groupText(1,'/game_v2'+mode.toLowerCase()));
 const core=await w.loaded(GROUP),number=core.data.game!.number;
 for(const id of ids.slice(1))await w.send(callback(id,'l:j:'+number,GROUP));
 await w.send(groupText(1,'/startgame'));
 const state=()=>core.data.game!.v2Session!.state;
 const players=()=>state().players;
 const role=(role:V2Role)=>Number(players().find(p=>p.role===role)!.id);
 const seat=(id:number)=>players().findIndex(p=>p.id===String(id))+1;
 const press=async(id:number,op:string,target?:number)=>{
  const raw=w.tg.sent(id).flatMap(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat()??[])
   .map(b=>b.callback_data??'').find(raw=>{const b=decodeV2Button(raw);return b?.game===number&&b.seq===state().seq&&b.op===op&&b.seat===(target===undefined?0:seat(target));});
  expect(raw,mode+' '+state().phase+' '+id+' '+op).toBeTruthy();
  await w.send(callback(id,raw!));
  expect(w.tg.calls.filter(c=>c.method==='answerCallbackQuery').at(-1)?.params.text).toBe('Qabul qilindi');
 };
 const advance=async(phase:string)=>{await w.advance(30001);expect(state().phase).toBe(phase);};
 const finish=async(reason:string)=>{
  expect(state().phase).toBe('ENDED');expect(state().outcome?.reason).toBe(reason);
  expect(players().every(p=>p.death!=='AFK'&&(p.missedTotal??0)===0)).toBe(true);
  await w.advance(30001);
  expect(core.data.game).toBeNull();
  for(const id of ids){
   expect(w.registryCore.activeOf(id)).toBeNull();
   expect(w.registryCore.gameHistory(id)).toContain(mode);
  }
  const balances=ids.map(id=>[w.registryCore.eco.coins(id),w.registryCore.points(id)]);
  await w.advance(60001);
  expect(ids.map(id=>[w.registryCore.eco.coins(id),w.registryCore.points(id)])).toEqual(balances);
 };
 return {w,ids,state,players,role,press,advance,finish};
}

describe('active multiplayer V2 scenarios without real Telegram users',()=>{
 it('Zombie: doctor protects one target, conversion wins across two nights',async()=>{
  const g=await start('ZOMBIE');
  const don=g.role('DON'),comm=g.role('COMMISSAR'),doc=g.role('DOCTOR'),z=g.role('ZOMBIE');
  await g.press(don,'C',doc);await g.press(comm,'I',don);await g.press(doc,'C',doc);await g.press(z,'C',comm);
  expect(g.state().phase).toBe('DAWN');
  expect(g.players().find(p=>p.id===String(doc))?.hp).toBe(100);
  expect(g.players().find(p=>p.id===String(comm))?.role).toBe('ZOMBIE');
  await g.advance('DISCUSSION');await g.advance('VOTING');await g.advance('NIGHT');
  await g.press(don,'K');await g.press(doc,'C',comm);await g.press(z,'C',don);await g.press(comm,'C',doc);
  expect(g.state().phase).toBe('DAWN');expect(g.players().every(p=>p.role==='ZOMBIE')).toBe(true);
  await g.advance('ENDED');await g.finish('ZOMBIE');
 });
 it('Hypernova: active-only roles, protected target and Commissar defeats Don',async()=>{
  const g=await start('HYPERNOVA');
  const don=g.role('DON'),comm=g.role('COMMISSAR'),docs=g.players().filter(p=>p.role==='DOCTOR').map(p=>Number(p.id));
  expect(docs).toHaveLength(2);
  await g.press(don,'C',docs[0]);await g.press(comm,'S',don);await g.press(docs[0]!,'C',docs[1]);await g.press(docs[1]!,'C',docs[0]);
  expect(g.state().phase).toBe('DAWN');
  expect(g.players().find(p=>p.id===String(don))?.hp).toBe(0);
  expect(g.players().filter(p=>p.role==='DOCTOR').every(p=>p.hp===100)).toBe(true);
  await g.advance('ENDED');await g.finish('CITY');
 });
 it('VS: equal colours, opposite-colour attack and final vote decide the team',async()=>{
  const g=await start('VS'),don=g.role('DON'),comm=g.role('COMMISSAR');
  const colour=g.players().find(p=>p.id===String(don))!.colour;
  const allies=g.players().filter(p=>p.colour===colour).map(p=>Number(p.id));
  const enemies=g.players().filter(p=>p.colour!==colour).map(p=>Number(p.id));
  expect(allies).toHaveLength(2);expect(enemies).toHaveLength(2);
  await g.press(don,'C',enemies[0]);await g.press(comm,'K');
  for(const p of g.players().filter(p=>p.role==='DOCTOR'))await g.press(Number(p.id),'K');
  expect(g.state().phase).toBe('DAWN');
  expect(g.players().find(p=>p.id===String(enemies[0]))?.hp).toBe(0);
  await g.advance('DISCUSSION');await g.advance('VOTING');
  for(const id of allies)await g.press(id,'V',enemies[1]);
  await g.advance('VERDICT');
  for(const id of allies)await g.press(id,'Y');
  await g.advance('ENDED');
  expect(g.state().outcome?.winners).toEqual(allies.map(String));
  await g.finish('TEAM');
 });
});

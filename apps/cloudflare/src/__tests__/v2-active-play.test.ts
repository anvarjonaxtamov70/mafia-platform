import {describe,it,expect} from 'vitest';
import {decodeV2Button} from '@mafia/bot-core';
import {World,privateText,groupText,callback,GROUP} from './harness';

describe('V2 active play through actual Telegram router and durable registry',()=>{
 it('private check, live votes, verdict, last word and one final reward without AFK',async()=>{
  const w=new World({v2Preview:true,v2Ledger:true});
  const ids=[1,2,3,4],r=w.registryCore;
  for(const id of ids)await w.send(privateText(id,'/start'));
  await w.send(groupText(1,'/game v2classic'));
  let core=await w.loaded(GROUP);
  const number=core.data.game!.number;
  for(const id of ids.slice(1))await w.send(callback(id,'l:j:'+number,GROUP));
  await w.send(groupText(1,'/startgame'));
  const state=()=>core.data.game!.v2Session!.state;
  const don=Number(state().players.find(p=>p.role==='DON')!.id);
  const commissar=Number(state().players.find(p=>p.role==='COMMISSAR')!.id);
  const donSeat=state().players.findIndex(p=>p.id===String(don))+1;
  const press=async(id:number,op:string,seat:number)=>{
   const raw=w.tg.sent(id).flatMap(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat()??[])
    .map(b=>b.callback_data??'').find(raw=>{const b=decodeV2Button(raw);return b?.game===number&&b.seq===state().seq&&b.op===op&&b.seat===seat;});
   expect(raw).toBeTruthy();
   await w.send(callback(id,raw!));
   expect(w.tg.calls.filter(c=>c.method==='answerCallbackQuery').at(-1)?.params.text).toBe('Qabul qilindi');
  };
  const doctor=Number(state().players.find(p=>p.role==='DOCTOR')!.id);
  await press(don,'K',0);await press(commissar,'I',donSeat);await press(doctor,'K',0);
  expect(state().phase).toBe('DAWN');
  expect(w.tg.texts(commissar).some(x=>x.includes('🔎')&&x.includes('Don'))).toBe(true);
  expect(w.tg.texts(GROUP).some(x=>x.includes('🔎'))).toBe(false);
  await w.advance(30001);expect(state().phase).toBe('DISCUSSION');
  await w.advance(30001);expect(state().phase).toBe('VOTING');
  for(const id of ids.filter(id=>id!==don))await press(id,'V',donSeat);
  await w.advance(30001);expect(state().phase).toBe('VERDICT');expect(state().candidate).toBe(String(don));
  for(const id of ids.filter(id=>id!==don))await press(id,'Y',0);
  await w.advance(30001);expect(state().phase).toBe('ENDED');
  expect(state().outcome).toEqual({reason:'CITY',winners:ids.filter(id=>id!==don).map(String)});
  expect(core.data.game!.v2Session!.lastWords[String(don)]?.sent).toBe(false);
  w.restart(GROUP);core=await w.loaded(GROUP);
  await w.send(privateText(don,'Oxirgi so‘z: yaxshi o‘yin!'));
  expect(w.tg.texts(GROUP).filter(x=>x.includes('yaxshi o‘yin!'))).toHaveLength(1);
  await w.advance(30001);
  expect(core.data.game).toBeNull();
  for(const id of ids){
   expect(r.activeOf(id)).toBeNull();
   expect(r.gameHistory(id)).toContain('CLASSIC');
  }
  expect(r.eco.coins(commissar)).toBeGreaterThan(0);
  expect(r.points(commissar)).toBeGreaterThan(0);
  const balance=r.eco.coins(commissar),points=r.points(commissar);
  await w.advance(60001);
  expect(r.eco.coins(commissar)).toBe(balance);expect(r.points(commissar)).toBe(points);
 });
});

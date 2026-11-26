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
   const verdict=op==='Y'||op==='N';
   const raw=w.tg.sent(verdict?GROUP:id).flatMap(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat()??[])
    .map(b=>b.callback_data??'').find(raw=>{const b=decodeV2Button(raw);return b?.game===number&&b.seq===state().seq&&b.op===op&&b.seat===seat;});
   expect(raw).toBeTruthy();
   await w.send(verdict?callback(id,raw!,GROUP,core.data.refs['v2phase:'+number+':'+state().seq]!.messageId):callback(id,raw!));
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
  const verdictMessage=core.data.refs['v2phase:'+number+':'+state().seq]!.messageId;
  const yes=ids.filter(id=>id!==don);
  const verdictSeq=state().seq;
  const keyboard=w.tg.sent(GROUP).flatMap(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat()??[]);
  const rawYes=keyboard.find(k=>{const b=decodeV2Button(k.callback_data??'');return b?.game===number&&b.seq===verdictSeq&&b.op==='Y';})?.callback_data!;
  const rawNo=keyboard.find(k=>{const b=decodeV2Button(k.callback_data??'');return b?.game===number&&b.seq===verdictSeq&&b.op==='N';})?.callback_data!;
  expect(rawYes).toBeTruthy();expect(rawNo).toBeTruthy();
  const privateVerdict=w.tg.sent(yes[0]).some(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat().some(k=>k.callback_data===rawYes||k.callback_data===rawNo));
  expect(privateVerdict).toBe(false);
  await w.send(callback(yes[0]!,rawYes)); // DM is not a verdict surface
  await w.send(callback(yes[0]!,rawYes,GROUP-1,verdictMessage)); // wrong group
  await w.send(callback(yes[0]!,rawYes,GROUP,verdictMessage+1)); // wrong message
  await w.send(callback(99,rawYes,GROUP,verdictMessage)); // nonparticipant
  expect(state().verdicts).toHaveLength(0);
  // The callback rate limit must not mask the one-vote assertion.
  await w.advance(3100);
  await press(yes[0]!,'Y',0);
  await w.advance(3100);
  await w.send(callback(yes[0]!,rawNo,GROUP,verdictMessage));
  expect(state().verdicts).toEqual([{actor:String(yes[0]),yes:true}]);
  w.restart(GROUP);core=await w.loaded(GROUP);
  await w.advance(3100);
  await w.send(callback(yes[0]!,rawNo,GROUP,verdictMessage));
  expect(state().verdicts).toEqual([{actor:String(yes[0]),yes:true}]);
  for(const id of yes.slice(1))await press(id,'Y',0);
  const live=w.tg.calls.filter(c=>c.method==='editMessageText'&&c.params.chat_id===GROUP&&c.params.message_id===verdictMessage).at(-1);
  expect(JSON.stringify(live?.params.reply_markup)).toContain('👍 3');
  await w.advance(30001);expect(state().phase).toBe('ENDED');
  const closed=w.tg.calls.filter(c=>c.method==='editMessageText'&&c.params.chat_id===GROUP&&c.params.message_id===verdictMessage).at(-1);
  expect(closed?.params.text).toContain('Ha: 3');expect(JSON.stringify(closed?.params.reply_markup)).not.toContain('callback_data');
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

import {describe,it,expect} from 'vitest';
import {decodeV2Button} from '@mafia/bot-core';
import {V2_MODES,V2_DEFS,v2Eligible,v2VerdictTally,type V2State} from '@mafia/game-engine';
import type {RecordGameInput,RecordResult} from '../registry-core';
import {World,privateText,groupText,callback,GROUP} from './harness';

describe('V2 full 30-player matches through real application routes',()=>{
 for(const mode of V2_MODES)it(mode+' — full roster, emitted controls, active rounds and durable results',async()=>{
  const w=new World({v2Preview:true,v2SettingsMode:true,v2Ledger:true});
  const ids=Array.from({length:30},(_,i)=>i+1);
  const committed:{input:RecordGameInput;result:RecordResult}[]=[];
  const ledger=w.v2Settlement!,record=ledger.recordResult.bind(ledger);
  ledger.recordResult=async input=>{const result=await record(input);committed.push(structuredClone({input,result}));return result;};
  for(const id of ids)await w.send(privateText(id,'/start'));
  if(mode!=='CLASSIC'){
   await w.send(groupText(1,'/settings'));
   await w.send(callback(1,'gs:v2mode_'+mode+':'+GROUP,GROUP));
   expect(w.registryCore.getSettings(GROUP).v2Mode).toBe(mode);
  }
  await w.send(groupText(1,'/game'));
  let core=await w.loaded(GROUP);
  const n=core.data.game!.number;
  const join=w.tg.sent(GROUP).flatMap(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat()??[]).find(b=>b.callback_data==='l:j:'+n)?.callback_data??'';
  expect(join).toBeTruthy();
  for(const id of ids.slice(1))await w.send(callback(id,join,GROUP));
  expect(core.data.game?.players).toHaveLength(30);
  await w.send(groupText(1,'/startgame'));
  const state=()=>core.data.game?.v2Session?.state;
  const initial=state()!;
  expect(initial.mode).toBe(mode);expect(initial.players).toHaveLength(30);
  expect(initial.players.filter(p=>p.role==='DOCTOR')).toHaveLength(1);
  expect(initial.players.filter(p=>p.role==='DON')).toHaveLength(1);
  if(mode==='VS'){
   expect(initial.players.filter(p=>p.colour==='RED')).toHaveLength(15);
   expect(initial.players.filter(p=>p.colour==='BLUE')).toHaveLength(15);
  }
  if(mode==='VS'||mode==='HYPERNOVA')expect(initial.players.every(p=>V2_DEFS[p.role].active)).toBe(true);
  for(const id of ids)expect(w.tg.texts(id).filter(t=>t.includes('Sizning rolingiz:'))).toHaveLength(1);
  expect(w.tg.texts(GROUP).some(t=>t.includes('Sizning rolingiz:'))).toBe(false);
  const buttons=(id:number,seq:number)=>w.tg.sent(id).flatMap(c=>(c.params.reply_markup as {inline_keyboard?:{callback_data?:string}[][]}|undefined)?.inline_keyboard?.flat()??[]).map(b=>b.callback_data??'').filter(raw=>{const b=decodeV2Button(raw);return b?.game===n&&b.seq===seq;});
  const find=(id:number,s:V2State,op:string,seat=0)=>buttons(id,s.seq).find(raw=>{const b=decodeV2Button(raw);return b?.op===op&&b.seat===seat;})??'';
  let actions=0,nominations=0,verdicts=0,rounds=0,restarted=false;
  const press=async(id:number,raw:string,s:V2State,group=false)=>{
   expect(raw,mode+' '+s.phase+' '+id).toBeTruthy();
   const ref=group?core.data.refs['v2phase:'+n+':'+s.seq]:core.data.refs['v2choice:'+n+':'+s.seq+':'+id+':phase'];
   expect(ref,mode+' missing emitted message '+s.phase+' '+id).toBeDefined();
   await w.send(group?callback(id,raw,GROUP,ref!.messageId):callback(id,raw,undefined,ref!.messageId));
   expect(w.tg.calls.filter(c=>c.method==='answerCallbackQuery').at(-1)?.params.text).toBe('Qabul qilindi');
  };
  const advance=async()=>{const s=state();if(s?.deadline!==null&&s?.deadline!==undefined)await w.advance(Math.max(1,s.deadline-w.now+1));else await w.advance(30001);};
  for(let step=0;step<180&&state();step++){
   const s=state()!;
   const eligible=s.players.filter(p=>p.hp>0&&!p.left&&p.blockedUntil<s.round);
   if(s.phase==='NIGHT'){
    rounds++;
    const doc=s.players.find(p=>p.role==='DOCTOR'&&v2Eligible(s,p));
    for(const p of s.players.filter(p=>v2Eligible(s,p))){
     const id=Number(p.id);
     let raw=find(id,s,'K');
     // First night includes actual attack, self-heal and investigation where legal.
     // Later nights skip deliberately; every eligible player still responds.
     if(rounds===1&&p.role==='DOCTOR')raw=find(id,s,'C',s.players.indexOf(p)+1)||raw;
     if(rounds===1&&p.role==='DON'&&doc)raw=find(id,s,'C',s.players.indexOf(doc)+1)||raw;
     if(rounds===1&&p.role==='COMMISSAR'){
      const don=s.players.findIndex(x=>x.role==='DON')+1;
      raw=find(id,s,'I',don)||raw;
     }
     await press(id,raw,s);actions++;
    }
    if(rounds===1&&doc)expect(state()?.players.find(p=>p.id===doc.id)?.hp).toBe(100);
    if(state()?.phase==='NIGHT')await advance();
   }else if(s.phase==='VOTING'){
    const target=eligible.find(p=>p.role==='DON')??eligible.find(p=>p.role!=='SUIDSID'&&p.role!=='KAMIKAZE')??eligible[0];
    expect(target).toBeDefined();
    const seat=s.players.indexOf(target!)+1;
    for(const p of eligible){
     const id=Number(p.id);
     await press(id,find(id,s,'V',p.id===target!.id?0:seat),s);nominations++;
    }
    expect(state()?.votes).toHaveLength(eligible.length-1);
    expect(state()?.abstentions).toEqual([target!.id]);
    await advance();
    expect(state()?.phase).toBe('VERDICT');
    expect(state()?.candidate).toBe(target!.id);
   }else if(s.phase==='VERDICT'){
    const ref=core.data.refs['v2phase:'+n+':'+s.seq]!;
    const yes=find(GROUP,s,'Y'),no=find(GROUP,s,'N');
    for(const p of eligible){
     await press(Number(p.id),yes,s,true);verdicts++;
    }
    const tally=v2VerdictTally(state()!);
    expect(tally.yes).toBe(eligible.reduce((sum,p)=>sum+(p.role==='JANOB'?2:1),0));expect(tally.no).toBe(0);
    const lastEdit=()=>w.tg.calls.filter(c=>c.method==='editMessageText'&&c.params.chat_id===GROUP&&c.params.message_id===ref.messageId).at(-1);
    expect(JSON.stringify(lastEdit()?.params.reply_markup)).toContain('👍 '+tally.yes);
    if(!restarted){
     w.restart(GROUP);core=await w.loaded(GROUP);restarted=true;
     await w.advance(3100);
     await w.send(callback(Number(eligible[0]!.id),no,GROUP,ref.messageId));
     expect(v2VerdictTally(state()!)).toEqual(tally);
    }
    await advance();
    expect(lastEdit()?.params.text).toContain('Ha: '+tally.yes);
    expect(JSON.stringify(lastEdit()?.params.reply_markup)).not.toContain('callback_data');
   }else if(s.phase==='REVENGE'){
    const id=Number(s.revenge);
    const raw=buttons(id,s.seq).find(x=>decodeV2Button(x)?.op==='R')??'';
    if(raw)await press(id,raw,s);else await advance();
   }else await advance();
  }
  expect(core.data.game).toBeNull();
  expect(rounds).toBeGreaterThan(1);expect(actions).toBeGreaterThanOrEqual(15);
  expect(nominations).toBeGreaterThanOrEqual(30);expect(verdicts).toBeGreaterThanOrEqual(30);expect(restarted).toBe(true);
  expect(committed).toHaveLength(1);
  const {input,result}=committed[0]!;
  expect(input.number).toBe(n);expect(input.mode).toBe(mode);expect(input.ranked).toBe(true);
  expect(input.players).toHaveLength(30);expect(result.players).toHaveLength(30);
  expect(input.players.every(p=>p.active&&!p.left&&!p.afk&&p.missed===0)).toBe(true);
  expect(w.tg.texts(GROUP).filter(t=>t.includes('🏁 <b>O‘yin tugadi!</b>'))).toHaveLength(1);
  for(const id of ids){expect(w.registryCore.activeOf(id)).toBeNull();expect(w.registryCore.gameHistory(id)).toContain(mode);}
  const balances=ids.map(id=>[w.registryCore.eco.coins(id),w.registryCore.points(id)]);
  await w.advance(60001);expect(committed).toHaveLength(1);
  expect(ids.map(id=>[w.registryCore.eco.coins(id),w.registryCore.points(id)])).toEqual(balances);
 },60000);
});

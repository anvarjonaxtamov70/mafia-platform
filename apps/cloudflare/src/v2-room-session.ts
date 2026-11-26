/** Serializable v2 room transition adapter. All outputs must be committed with the
 * room snapshot before delivery, using the existing durable outbox. No live routing
 * is enabled yet: wallet and hero receipts must be coordinated with Registry.
 */
import {v2Create,v2Submit,v2CanEndNight,v2BeginNightSession,v2AnswerNightSession,v2NightSessionReady,v2NightDebits,v2FinishNightSession,v2Advance,v2HeroShot,v2Vote,v2Verdict,v2Revenge,type V2State,type V2Mode,type V2Effect,type V2NightSession,type V2NightAnswer,type Rng} from '@mafia/game-engine';
import {decodeV2Button,v2PrivateRoleView,v2PrivatePhaseView,v2PublicPhaseView,v2PromptViews,v2EffectDrafts,type OutboxDraft,type V2Op} from '@mafia/bot-core';
import {escapeHtml} from '@mafia/localization';
export type V2RoomSession={version:2;game:number;chatId:number;state:V2State;names:Record<string,string>;night:V2NightSession|null;lastWords:Record<string,{until:number;sent:boolean}>;revision:number};
export type V2RoomTransition={room:V2RoomSession;outbox:OutboxDraft[];effects:V2Effect[]};
const copy=(room:V2RoomSession):V2RoomSession=>JSON.parse(JSON.stringify(room)) as V2RoomSession;
function empty(room:V2RoomSession):V2RoomTransition{return {room,outbox:[],effects:[]};}
function send(result:V2RoomTransition,chat:number,text:string,keyboard?:import('@mafia/bot-core').Keyboard){
 const r=result.room;
 result.outbox.push({chatId:BigInt(chat),payload:{kind:'SEND',text,...(keyboard?{keyboard}:{})},dedupeKey:'v2room:'+r.game+':'+r.revision+':'+result.outbox.length});
}
function publishPhase(result:V2RoomTransition){
 const r=result.room;
 const v=v2PublicPhaseView(r.state,r.names);send(result,r.chatId,v.text,v.keyboard);
 for(const p of r.state.players){const view=v2PrivatePhaseView(r.state,r.game,p.id,r.names);if(view)send(result,Number(p.id),view.text,view.keyboard);}
}
function apply(result:V2RoomTransition,state:V2State,effects:V2Effect[],now:number){
 const r=result.room,oldSeq=r.state.seq;
 r.state=state;result.effects.push(...effects);
 result.outbox.push(...v2EffectDrafts(effects,BigInt(r.chatId),r.names,r.game,r.revision));
 for(const e of effects)if(e.kind==='DEATH'&&e.reason!=='AFK'&&!r.lastWords[e.target]){
  r.lastWords[e.target]={until:now+29000,sent:false};
  send(result,Number(e.target),'Oxirgi so‘zingizni 29 soniya ichida yozing.');
 }
 if(oldSeq!==state.seq)publishPhase(result);
}
export function createV2RoomSession(game:number,chatId:number,mode:V2Mode,users:readonly {id:number;name:string}[],now:number,rng:Rng):V2RoomTransition{
 if(!Number.isSafeInteger(game)||game<1||!Number.isSafeInteger(chatId)||chatId>=0||users.some(u=>!Number.isSafeInteger(u.id)||u.id<=0))throw Error('invalid room');
 const state=v2Create(users.map(u=>String(u.id)),mode,now,rng);
 const room:V2RoomSession={version:2,game,chatId,state,names:Object.fromEntries(users.map(u=>[String(u.id),u.name])),night:null,lastWords:{},revision:1};
 const result=empty(room);
 for(const p of state.players){const view=v2PrivateRoleView(state,p.id,room.names);if(view)send(result,Number(p.id),view.text,view.keyboard);}
 publishPhase(result);return result;
}
const responseOps:V2Op[]=['F','X','P','M'];
export function v2RoomButton(input:V2RoomSession,actorId:number,privateChatId:number,raw:string,now:number):V2RoomTransition{
 const b=decodeV2Button(raw);
 if(!b||b.game!==input.game||b.seq!==input.state.seq||privateChatId!==actorId||!input.state.players.some(p=>p.id===String(actorId)))throw Error('invalid or stale button');
 const room=copy(input);room.revision++;
 const result=empty(room),actor=String(actorId),s=room.state,target=s.players[b.seat-1]?.id;
 if(responseOps.includes(b.op)){
  if(!room.night||!target)throw Error('no pending response');
  const wizard=b.op==='F'||b.op==='X';
  const answer:V2NightAnswer=b.op==='F'?'FORGIVE':b.op==='X'?'REFUSE':b.op==='P'?'HP':'MONEY';
  room.night=v2AnswerNightSession(room.night,actor,(wizard?'w:':'g:')+target,answer,now);return result;
 }
 if(room.night||s.deadline===null||now>=s.deadline)throw Error('phase expired');
 switch(b.op){
  case 'C':case 'I':case 'S':case 'K':{
   if(b.op!=='K'&&!target)throw Error('invalid target');
   if(b.op==='K'&&b.seat!==0)throw Error('invalid skip');
   room.state=v2Submit(s,{actor,target:b.op==='K'?null:target!,kind:b.op==='C'?'CHOOSE':b.op==='I'?'CHECK':b.op==='S'?'SHOOT':'SKIP'},b.seq);break;
  }
  case 'V':if(!target)throw Error('invalid vote');room.state=v2Vote(s,actor,target,b.seq);break;
  case 'Y':case 'N':if(b.seat!==0)throw Error('invalid verdict');room.state=v2Verdict(s,actor,b.op==='Y',b.seq);break;
  case 'H':{
   if(!target)throw Error('invalid hero target');
   // Persistent hero receipt must be committed by trusted Registry before this
   // proposed transition can be applied to a real room.
   const shot=v2HeroShot(s,actor,target,b.seq);apply(result,shot.state,shot.effects,now);break;
  }
  case 'R':if(!target)throw Error('invalid revenge');{const next=v2Revenge(s,actor,target,b.seq,now);apply(result,next.state,next.effects,now);break;}
  default:throw Error('invalid operation');
 }
 return result;
}
export function v2RoomDeadline(room:V2RoomSession):number|null{
 if(room.night)return room.night.deadline;
 return room.state.deadline;
}
/** Can be called after any action or timer. Returns pending debit requests instead
 * of assuming that money has been paid. Caller persists room and retries receipts.
 */
export function v2RoomTick(input:V2RoomSession,now:number,rng:Rng,receipts:ReadonlyMap<string,'PAID'|'INSUFFICIENT'>=new Map()):V2RoomTransition & {debits:ReturnType<typeof v2NightDebits>}{
 const room=copy(input);room.revision++;
 const result={...empty(room),debits:[] as ReturnType<typeof v2NightDebits>};
 const state=room.state;
 if(state.phase==='ENDED')return result;
 if(state.phase==='NIGHT'&&!room.night){
  if(!v2CanEndNight(state)&&(state.deadline===null||now<state.deadline))return result;
  room.night=v2BeginNightSession(state,now,rng.int(0x7fffffff));
  for(const p of v2PromptViews(room.night,room.game,room.names))send(result,Number(p.recipient),p.view.text,p.view.keyboard);
 }
 if(room.night){
  if(!v2NightSessionReady(room.night,now))return result;
  result.debits=v2NightDebits(room.night,now);
  if(result.debits.some(d=>!receipts.has(d.key)))return result;
  const next=v2FinishNightSession(room.night,now,receipts);
  room.night=null;apply(result,next.state,next.effects,now);return result;
 }
 if(state.deadline!==null&&now>=state.deadline){
  const next=v2Advance(state,now,state.seq);apply(result,next.state,next.effects,now);
 }
 return result;
}
export function v2RoomLastWord(input:V2RoomSession,actorId:number,text:string,now:number):V2RoomTransition{
 const id=String(actorId),word=input.lastWords[id],body=text.trim();
 if(!word||word.sent||now>=word.until||!body||body.startsWith('/'))throw Error('no valid last word window');
 const room=copy(input);room.revision++;room.lastWords[id]!.sent=true;
 const result=empty(room);
 send(result,room.chatId,'🗣 <b>'+escapeHtml(room.names[id]??'O‘yinchi')+'</b>ning oxirgi so‘zi:\n'+escapeHtml(body.slice(0,1000)));
 return result;
}
export function v2RoomSilence(room:V2RoomSession,id:number):boolean{
 const p=room.state.players.find(x=>x.id===String(id));
 if(!p||room.state.phase==='ENDED')return false;
 return room.state.phase==='NIGHT'||p.hp<=0||p.left||p.blockedUntil>=room.state.round;
}

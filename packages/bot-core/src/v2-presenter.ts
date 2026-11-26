/** Native Telegram views for v2. The room adapter must enforce game/phase,
 * authenticated actor, audience and deadline again; callback data is untrusted.
 */
import {V2_ROLES,V2_DEFS,v2Eligible,v2Submit,v2SameMafia,type V2State,type V2Role,type V2Action,type V2Effect,type V2NightSession} from '@mafia/game-engine';
import {escapeHtml} from '@mafia/localization';
import {REFERENCE_ROLES} from './reference-roles';
import {rows,buttonLabel,type Button,type Keyboard,type OutboxDraft} from './outbox-types';
export type V2Op='C'|'I'|'S'|'K'|'H'|'V'|'Y'|'N'|'R'|'F'|'X'|'P'|'M';
export type V2Button={game:number;seq:number;op:V2Op;seat:number};
export function encodeV2Button(b:V2Button):string{
 const raw='v2:'+b.game+':'+b.seq+':'+b.op+':'+b.seat;
 if(!decodeV2Button(raw))throw Error('invalid v2 button');
 return raw;
}
export function decodeV2Button(raw:string):V2Button|null{
 if(raw.length>64)return null;
 const m=/^v2:(\d+):(\d+):([CISKHVYNRFXPM]):(\d+)$/.exec(raw);
 if(!m)return null;
 const game=Number(m[1]),seq=Number(m[2]),seat=Number(m[4]);
 if(!Number.isSafeInteger(game)||game<1||!Number.isSafeInteger(seq)||seq<1||!Number.isInteger(seat)||seat<0||seat>30)return null;
 return {game,seq,op:m[3] as V2Op,seat};
}
type PlayerNames=Readonly<Record<string,string>>;
type V2View={text:string;keyboard?:Keyboard};
const named=(names:PlayerNames,id:string)=>escapeHtml(names[id]??'O‘yinchi');
const short=(names:PlayerNames,id:string)=>buttonLabel(names[id]??'O‘yinchi');
export function v2RoleLabel(role:V2Role){
 const ref=REFERENCE_ROLES[V2_ROLES.indexOf(role)]!;
 return ref.emoji+' '+ref.name;
}
const roleDescription=(role:V2Role)=>REFERENCE_ROLES[V2_ROLES.indexOf(role)]!.description;
function make(game:number,s:V2State,op:V2Op,seat:number,text:string):Button{return {text,callback_data:encodeV2Button({game,seq:s.seq,op,seat})};}
export function v2PrivateRoleView(s:V2State,id:string,names:PlayerNames):V2View|null{
 const p=s.players.find(x=>x.id===id);if(!p)return null;
 const mafia=V2_DEFS[p.role].faction==='MAFIA'?s.players.filter(x=>x.id!==id&&v2SameMafia(s,p,x)).map(x=>named(names,x.id)+' — '+escapeHtml(v2RoleLabel(x.role))):[];
 return {text:'Sizning rolingiz: <b>'+escapeHtml(v2RoleLabel(p.role))+'</b>\n\n'+escapeHtml(roleDescription(p.role))+(p.colour?'\n\nJamoangiz: '+(p.colour==='RED'?'🔴 Qizillar':'🔵 Ko‘klar')+'\n'+s.players.filter(x=>x.id!==id&&x.colour===p.colour).map(x=>named(names,x.id)).join(', '):'')+(mafia.length?'\n\nMafia jamoasi:\n'+mafia.join('\n'):'')};
}
export function v2PrivatePhaseView(s:V2State,game:number,id:string,names:PlayerNames):V2View|null{
 const p=s.players.find(x=>x.id===id);if(!p||p.left)return null;
 const targetButtons=(op:V2Op,valid:(target:string)=>boolean,prefix='')=>s.players.flatMap((x,i)=>x.hp>0&&!x.left&&valid(x.id)?[make(game,s,op,i+1,prefix+(i+1)+'. '+short(names,x.id))]:[]);
 if(s.phase==='REVENGE'&&s.revenge===id)return {text:'💣 O‘zingiz bilan olib ketadigan o‘yinchini tanlang.',keyboard:rows(targetButtons('R',x=>x!==id))};
 if(p.hp===0||p.blockedUntil>=s.round)return null;
 if(s.phase==='NIGHT'&&v2Eligible(s,p)){
  const valid=(target:string,kind:V2Action)=>{try{v2Submit(s,{actor:id,target,kind},s.seq);return true;}catch{return false;}};
  const buttons=p.role==='COMMISSAR'?[...targetButtons('I',x=>valid(x,'CHECK'),'🔎 '),...targetButtons('S',x=>valid(x,'SHOOT'),'🎯 ')]:targetButtons('C',x=>valid(x,'CHOOSE'));
  return {text:'🌙 <b>'+escapeHtml(v2RoleLabel(p.role))+'</b>\nHarakatingizni tanlang.',keyboard:[...rows(buttons),[make(game,s,'K',0,'O‘tkazib yuborish')]]};
 }
 if(s.phase==='DAWN'&&['DON','COMMISSAR','MERGAN'].includes(p.role)&&p.heroCharges>0&&!p.heroUsed)return {text:'🥷 Geroy bilan hujum qilish',keyboard:rows(targetButtons('H',x=>x!==id))};
 if(s.phase==='VOTING')return {text:'🗳 Kimga ovoz berasiz?',keyboard:rows(targetButtons('V',x=>x!==id))};
 if(s.phase==='VERDICT'&&s.candidate)return {text:'⚖️ '+named(names,s.candidate)+' osilsinmi?',keyboard:[[make(game,s,'Y',0,'✅ Ha'),make(game,s,'N',0,'❌ Yo‘q')]]};
 return null;
}
export function v2PublicPhaseView(s:V2State,names:PlayerNames):V2View{
 const phases={NIGHT:'🌙 Tun boshlandi',DAWN:'🌅 Tong otdi',DISCUSSION:'☀️ Muhokama',VOTING:'🗳 Ovoz berish',VERDICT:'⚖️ Osishni tasdiqlash',REVENGE:'💣 Kamikaze tanlovi',ENDED:'🏁 O‘yin tugadi'};
 const living=s.players.filter(p=>p.hp>0&&!p.left);
 const roster=living.map((p,i)=>(i+1)+'. '+named(names,p.id)+(p.colour?(p.colour==='RED'?' 🔴':' 🔵'):'')+' — '+p.hp+'%');
 return {text:'<b>'+phases[s.phase]+'</b>\n'+(s.outcome?'G‘oliblar: '+(s.outcome.winners.map(id=>named(names,id)).join(', ')||'Hech kim'):'Tirik o‘yinchilar: '+living.length+'\n'+roster.join('\n'))};
}
export function v2PromptViews(session:V2NightSession,game:number,names:PlayerNames):{recipient:string;view:V2View}[]{
 return session.prompts.map(p=>{
  const s=session.source;
  const seat=s.players.findIndex(x=>x.id===(p.kind==='WIZARD'?p.recipient:p.actor))+1;
  if(p.kind==='WIZARD')return {recipient:p.recipient,view:{text:'🧙 Sizga hujum qilishdi. Barcha hujumchilarni kechirasizmi?',keyboard:[[make(game,s,'F',seat,'✅ Kechirish'),make(game,s,'X',seat,'❌ Kechirmaslik')]]}};
  return {recipient:p.recipient,view:{text:'💚 '+named(names,p.actor)+' sizdan '+p.amount+' Dollar yoki 17% jon so‘ramoqda.',keyboard:[[make(game,s,'M',seat,p.amount+' $'),make(game,s,'P',seat,'17% jon')]]}};
 });
}
export function v2EffectDrafts(effects:readonly V2Effect[],chatId:bigint,names:PlayerNames,game:number,seq:number):OutboxDraft[]{
 const out:OutboxDraft[]=[];
 const send=(id:bigint,text:string,i:number)=>out.push({chatId:id,payload:{kind:'SEND',text},dedupeKey:'v2:'+game+':'+seq+':'+i+':'+id});
 effects.forEach((e,i)=>{
  switch(e.kind){
   case 'CHECK':send(BigInt(e.recipient),'🔎 '+named(names,e.target)+' — '+escapeHtml(v2RoleLabel(e.role)),i);break;
   case 'WITNESS':send(BigInt(e.recipient),'👀 '+named(names,e.target)+' uyida: '+e.attackers.map(a=>named(names,a.id)+' ('+escapeHtml(v2RoleLabel(a.role))+')').join(', '),i);break;
   case 'ROLE':send(BigInt(e.target),'Yangi rolingiz: '+escapeHtml(v2RoleLabel(e.role)),i);break;
   case 'DEATH':send(chatId,'💀 '+named(names,e.target)+' o‘yindan chiqdi.',i);break;
   case 'HP':send(chatId,'❤️ '+named(names,e.target)+' — '+e.hp+'% jon.',i);break;
   case 'HANGING_PROTECTED':send(chatId,named(names,e.target)+' '+(e.reason==='ITEM'?'himoya buyumi':'Advokat yoki Tentak himoyasi')+' tufayli osilmadi.',i);break;
   // Wallet effects and prompt requests are routed by trusted settlement adapter.
   default:break;
  }
 });
 return out;
}

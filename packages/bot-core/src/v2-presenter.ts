/** Native Telegram views for v2. The room adapter must enforce game/phase,
 * authenticated actor, audience and deadline again; callback data is untrusted.
 */
import {V2_ROLES,V2_DEFS,v2Eligible,v2Submit,v2SameMafia,v2VerdictTally,type V2State,type V2Role,type V2Action,type V2Effect,type V2NightSession} from '@mafia/game-engine';
import {escapeHtml} from '@mafia/localization';
import {REFERENCE_ROLES} from './reference-roles';
import {encode} from './callback-data';
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
const rosterName=(names:PlayerNames,id:string)=>{let out='';for(const ch of Array.from(short(names,id))){const next=escapeHtml(ch);if(out.length+next.length>64)return out+'…';out+=next;}return out;};
export function v2RoleLabel(role:V2Role){
 const ref=REFERENCE_ROLES[V2_ROLES.indexOf(role)]!;
 return ref.emoji+' '+ref.name;
}
const roleDescription=(role:V2Role)=>REFERENCE_ROLES[V2_ROLES.indexOf(role)]!.description;
function make(game:number,s:V2State,op:V2Op,seat:number,text:string):Button{return {text,callback_data:encodeV2Button({game,seq:s.seq,op,seat})};}
export function v2PrivateRoleView(s:V2State,id:string,names:PlayerNames):V2View|null{
 const p=s.players.find(x=>x.id===id);if(!p)return null;
 const mafia=V2_DEFS[p.role].faction==='MAFIA'?s.players.filter(x=>x.id!==id&&v2SameMafia(s,p,x)).map(x=>named(names,x.id)+' — '+escapeHtml(v2RoleLabel(x.role))):[];
 return {text:'Sizning rolingiz: <b>'+escapeHtml(v2RoleLabel(p.role))+'</b>\n\n'+escapeHtml(roleDescription(p.role))+(p.colour?'\n\nJamoangiz: '+(p.colour==='RED'?'🔴 Qizillar':'🔵 Ko‘klar')+'\n'+s.players.filter(x=>x.id!==id&&x.colour===p.colour).map(x=>named(names,x.id)).join(', '):'')+(mafia.length?'\n\nMafia jamoasi:\n'+mafia.join('\n'):''),keyboard:[[{text:'🖼 Personaj rasmi',callback_data:encode({t:'menu',section:'vportrait_'+REFERENCE_ROLES[V2_ROLES.indexOf(p.role)]!.id})}]]};
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
 if(s.phase==='VOTING')return {text:'🗳 Kimga ovoz berasiz?',keyboard:[...rows(targetButtons('V',x=>x!==id)),[make(game,s,'V',0,'O‘tkazib yuborish')]]};
 return null;
}
export function v2GroupVerdictView(s:V2State,game:number,names:PlayerNames,closed=false):V2View{
 if(s.phase!=='VERDICT'||!s.candidate)throw Error('not a verdict');
 const {yes,no}=v2VerdictTally(s);
 const question='⚖️ <b>Rostdan ham '+named(names,s.candidate)+'ni osmoqchimisiz?</b>';
 if(closed)return {text:question+'\n\nOvoz berish yakunlandi.\n👍 Ha: '+yes+'   👎 Yo‘q: '+no,keyboard:[]};
 return {text:question+'\n\n30 soniya. Har bir o‘yinchi bir marta ovoz beradi.',keyboard:[[make(game,s,'Y',0,'👍 '+yes),make(game,s,'N',0,'👎 '+no)]]};
}
const outcomeLabels:Record<string,string>={CITY:'Tinch aholi g‘alaba qozondi!',MAFIA:'Mafia g‘alaba qozondi!',ZOMBIE:'Zombilar g‘alaba qozondi!',SOLO:'Yakka rol g‘alaba qozondi!',NEUTRAL:'Betaraflar g‘alaba qozondi!',SUIDSID:'Suidsid g‘alaba qozondi!',TEAM:'Jamoa g‘alaba qozondi!',DRAW:'Durrang!'};
const factionLabels={CITY:'Tinch aholi',MAFIA:'Mafia',SOLO:'Yakka rollar',NEUTRAL:'Betaraflar',ZOMBIE:'Zombilar'};
export function v2PublicPhaseView(s:V2State,names:PlayerNames,durationMs?:number):V2View{
 const phases={NIGHT:'🌙 Tun boshlandi',DAWN:'🌅 Tong otdi',DISCUSSION:'☀️ Muhokama',VOTING:'🗳 Ovoz berish',VERDICT:'⚖️ Osishni tasdiqlash',REVENGE:'💣 Kamikaze tanlovi',ENDED:'🏁 O‘yin tugadi'};
 if(s.outcome){
  const winners=new Set(s.outcome.winners);
  const line=(p:V2State['players'][number])=>rosterName(names,p.id)+' — '+escapeHtml(v2RoleLabel(p.role))+(p.left?' (tark etdi)':p.hp>0?' (tirik)':' (halok bo‘lgan)');
  const won=s.players.filter(p=>winners.has(p.id)),others=s.players.filter(p=>!winners.has(p.id));
  const seconds=durationMs===undefined?undefined:Math.max(0,Math.floor(durationMs/1000));
  const time=seconds===undefined?'':'\n⏱ Davomiyligi: '+Math.floor(seconds/60)+' daqiqa '+seconds%60+' soniya';
  const colour=s.mode==='VS'&&s.outcome.reason==='TEAM'?(won[0]?.colour==='RED'?' 🔴 Qizillar':' 🔵 Ko‘klar'):'';
  return {text:'🏁 <b>O‘yin tugadi!</b>\n'+escapeHtml(outcomeLabels[s.outcome.reason]??'Natijalar')+colour+'\n\n🏆 <b>G‘oliblar:</b>\n'+(won.map(line).join('\n')||'Hech kim')+'\n\n👥 <b>Boshqa ishtirokchilar:</b>\n'+(others.map(line).join('\n')||'Yo‘q')+time};
 }
 const living=s.players.filter(p=>p.hp>0&&!p.left);
 const roster=s.players.flatMap((p,i)=>p.hp>0&&!p.left?[(i+1)+'. '+rosterName(names,p.id)+(p.colour?(p.colour==='RED'?' 🔴':' 🔵'):'')+' — '+p.hp+'%']:[]);
 const counts=(s.phase==='DAWN'||s.phase==='DISCUSSION')?Object.entries(factionLabels).map(([f,label])=>{
  const roles=V2_ROLES.map(role=>({role,n:living.filter(p=>p.role===role&&V2_DEFS[role].faction===f).length})).filter(x=>x.n>0);
  return roles.length?label+' ('+roles.reduce((a,x)=>a+x.n,0)+'): '+roles.map(x=>escapeHtml(v2RoleLabel(x.role))+(x.n>1?' ×'+x.n:'')).join(', '):'';
 }).filter(Boolean):[];
 const timing=s.phase==='NIGHT'||s.phase==='VOTING'||s.phase==='DISCUSSION'?'\n⏱ 30 soniya.':'';
 return {text:'<b>'+phases[s.phase]+'</b> · '+s.round+'-kun'+timing+'\n\nTirik o‘yinchilar: '+living.length+'\n'+roster.join('\n')+(counts.length?'\n\n<b>Qolgan rollar:</b>\n'+counts.join('\n'):'')};
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
   case 'DEATH':{
    const victim='<b>'+named(names,e.target)+'</b>'+(e.victimRole?' — '+escapeHtml(v2RoleLabel(e.victimRole)):'');
    const roles=(e.attackerRoles??[]).map(role=>escapeHtml(v2RoleLabel(role))).join(', ');
    const reason=e.reason==='VOTE'?'guruh ovozi bilan osildi.':e.reason==='AFK'?'faol bo‘lmagani sabab o‘yindan chiqarildi.':e.reason==='LEAVE'?'o‘yinni tark etdi.':e.reason==='HERO'?'geroy hujumidan halok bo‘ldi.':e.reason==='KRAMPOUS_SELF'?'o‘z portlashidan halok bo‘ldi.':'halok bo‘ldi.';
    send(chatId,'💀 '+victim+' '+reason+(roles?'\nSababchi rol: '+roles:''),i);break;
   }
   case 'HP':send(chatId,'❤️ '+named(names,e.target)+' — '+e.hp+'% jon.',i);break;
   case 'HANGING_PROTECTED':send(chatId,named(names,e.target)+' '+(e.reason==='ITEM'?'himoya buyumi':'Advokat yoki Tentak himoyasi')+' tufayli osilmadi.',i);break;
   // Wallet effects and prompt requests are routed by trusted settlement adapter.
   default:break;
  }
 });
 return out;
}

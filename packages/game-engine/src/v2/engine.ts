/** Versioned pure v2 rules. No direct DB or Telegram access. Effects requiring a
 * wallet or a private response remain explicit adapter obligations. Do not enable
 * this engine for real rooms until the durable adapter and integration tests exist.
 */
import {shuffle} from '../rng';
import type {Rng} from '../types';
import {V2_DEFS,V2_PHASE_SECONDS,V2_LAST_WORD_SECONDS,distributeV2,v2ModeAllows,type V2Role,type V2Mode,type V2Action} from './catalog';
export type V2Phase='NIGHT'|'DAWN'|'DISCUSSION'|'VOTING'|'VERDICT'|'REVENGE'|'ENDED';
export type V2Colour='RED'|'BLUE';
export type V2Player={
  id:string; role:V2Role; colour:V2Colour|null; hp:number; left:boolean;
  shield:number; document:boolean; voteShield:boolean; heroShield:boolean;
  heroDefense:number; heroCharges:number; heroDamage:number; heroUsed:boolean;
  missed:number; missedTotal?:number; lucky:boolean; selfHeal:boolean; blockedUntil:number;
  lastFrozen:string|null; changed:boolean; marks:string[]; hangingProtection:boolean;
  personal:'WIN'|'LOSS'|null; death:string|null;
};
export type V2Intent={actor:string;target:string|null;kind:V2Action};
export type V2Effect=
  |{kind:'CHECK';recipient:string;target:string;role:V2Role}
  |{kind:'WITNESS';recipient:string;target:string;attackers:{id:string;role:V2Role}[]}
  |{kind:'GRENCH';actor:string;target:string;amount:number}
  |{kind:'WIZARD_CHOICE';recipient:string;attackers:string[]}
  |{kind:'KLAUS';actor:string;target:string;amount:number}
  |{kind:'SELLER';actor:string;target:string}
  |{kind:'DEATH';target:string;reason:string;attackers:string[]}
  |{kind:'ROLE';target:string;role:V2Role}
  |{kind:'HERO';actor:string;target:string;hpLost:number;killed:boolean;absorbed:number}
  |{kind:'HP';target:string;hp:number}
  |{kind:'HANGING_PROTECTED';target:string;reason:'LAWYER_OR_TENTAK'|'ITEM'};
export type V2Outcome={reason:string;winners:string[]};
export type V2State={version:2;mode:V2Mode;phase:V2Phase;seq:number;deadline:number|null;round:number;players:V2Player[];intents:V2Intent[];votes:{actor:string;target:string}[];verdicts:{actor:string;yes:boolean}[];candidate:string|null;revenge:string|null;outcome:V2Outcome|null};
export type V2Resolution={state:V2State;effects:V2Effect[]};
export type V2NightChoices={wizard?:ReadonlyMap<string,'FORGIVE'|'REFUSE'>;grench?:ReadonlyMap<string,'HP'|'MONEY'>;/** Ledger adapter must attest that a debit was actually committed; absent means pending effect, not free debit. */paidGrench?:ReadonlySet<string>};
const alive=(p:V2Player)=>p.hp>0&&!p.left;
const faction=(p:V2Player)=>V2_DEFS[p.role].faction;
const clone=(s:V2State):V2State=>JSON.parse(JSON.stringify(s)) as V2State;
const player=(s:V2State,id:string)=>s.players.find(p=>p.id===id);
const asleep=(s:V2State,p:V2Player)=>p.blockedUntil>=s.round;
const phase=(s:V2State,next:V2Phase,now:number)=>{s.phase=next;s.seq++;s.deadline=next==='ENDED'?null:now+V2_PHASE_SECONDS*1000;};
export function v2Create(ids:readonly string[],mode:V2Mode,now:number,rng:Rng):V2State {
  return v2CreateFixed(ids,distributeV2(ids.length,mode,rng),mode,now,rng);
}
/** For simulation and trusted fixtures, never expose fixed-role selection to clients. */
export function v2CreateFixed(ids:readonly string[],roles:readonly V2Role[],mode:V2Mode,now:number,rng:Rng):V2State{
  if(ids.length!==roles.length||ids.length<4||ids.length>30||new Set(ids).size!==ids.length||ids.some(id=>!id)||roles.some(r=>!v2ModeAllows(r,mode))||(mode==='VS'&&ids.length%2))throw new RangeError('invalid v2 composition');
  const colours=mode==='VS'?shuffle(ids.map((_,i):V2Colour=>i<ids.length/2?'RED':'BLUE'),rng):ids.map(()=>null);
  return {version:2,mode,phase:'NIGHT',seq:1,deadline:now+30000,round:1,players:ids.map((id,i)=>({id,role:roles[i]!,colour:colours[i]!,hp:100,left:false,shield:0,document:false,voteShield:false,heroShield:false,heroDefense:0,heroCharges:0,heroDamage:45,heroUsed:false,missed:0,lucky:true,selfHeal:true,blockedUntil:0,lastFrozen:null,changed:false,marks:[],hangingProtection:false,personal:null,death:null})),intents:[],votes:[],verdicts:[],candidate:null,revenge:null,outcome:null};
}
function requireActor(s:V2State,id:string,seq:number,p:V2Phase){
  if(s.seq!==seq||s.phase!==p||s.outcome)throw new Error('stale or invalid phase');
  const a=player(s,id);
  if(!a||!alive(a)||asleep(s,a))throw new Error('ineligible actor');
  return a;
}
export function v2Eligible(s:V2State,p:V2Player){return alive(p)&&!asleep(s,p)&&V2_DEFS[p.role].active;}
export function v2Submit(s:V2State,intent:V2Intent,seq:number):V2State{
  const a=requireActor(s,intent.actor,seq,'NIGHT');
  if(!v2Eligible(s,a))throw new Error('passive role');
  if(intent.kind!=='SKIP'){
    const t=intent.target===null?undefined:player(s,intent.target);
    if(!t||!alive(t))throw new Error('invalid target');
    if(a.role==='COMMISSAR'? !['CHECK','SHOOT'].includes(intent.kind):intent.kind!=='CHOOSE')throw new Error('invalid action');
    if(a.id===t.id&&!(a.role==='DOCTOR'&&a.selfHeal)&&a.role!=='KRAMPOUS')throw new Error('self target');
    if(a.role==='FROZEN'&&a.lastFrozen===t.id)throw new Error('repeated frozen target');
    if(a.role==='CHAMELEON'&&!['CITY','MAFIA','SOLO'].includes(faction(t)))throw new Error('invalid chameleon target');
    if(a.role==='KRAMPOUS'&&a.marks.includes(t.id))throw new Error('repeated mark');
    if((a.role==='DON'||a.role==='MAFIOSO')&&faction(t)==='MAFIA'&&s.mode!=='VS')throw new Error('mafia teammate');
  }else if(intent.target!==null)throw new Error('skip with target');
  const n=clone(s);n.intents=n.intents.filter(x=>x.actor!==a.id);n.intents.push({...intent});return n;
}
export function v2CanEndNight(s:V2State){return s.phase==='NIGHT'&&s.players.filter(p=>v2Eligible(s,p)).every(p=>s.intents.some(i=>i.actor===p.id));}
function uniqueTop(entries:readonly {target:string;weight:number}[]):string|null{
  const totals=new Map<string,number>();for(const e of entries)totals.set(e.target,(totals.get(e.target)??0)+e.weight);
  const sorted=[...totals].sort((a,b)=>b[1]-a[1]);return sorted.length&&sorted[0]![1]>(sorted[1]?.[1]??0)?sorted[0]![0]:null;
}
type Attack={actor:string;target:string;role:V2Role;cause:string;force?:boolean};
export function v2ResolveNight(input:V2State,now:number,rng:Rng,choices:V2NightChoices={}):V2Resolution{
  if(input.phase!=='NIGHT'||input.outcome)throw new Error('invalid night');
  const s=clone(input),effects:V2Effect[]=[];
  const active=s.players.filter(p=>v2Eligible(s,p));
  const initial=new Map(s.players.map(p=>[p.id,p.role]));
  for(const p of s.players)p.hangingProtection=false;
  for(const p of active)if(p.role==='FROZEN'&&!s.intents.some(i=>i.actor===p.id&&i.kind!=='SKIP'))p.lastFrozen=null;
  const intents=s.intents.filter(i=>active.some(p=>p.id===i.actor)&&i.kind!=='SKIP'&&i.target!==null&&s.players.some(p=>p.id===i.target&&alive(p)));
  // Proposed simultaneous freeze priority: all valid Frozen intents resolve together.
  const frozen=new Set<string>();
  for(const i of intents){const a=player(s,i.actor)!;if(a.role==='FROZEN'){frozen.add(i.target!);a.lastFrozen=i.target;}}
  for(const id of frozen)player(s,id)!.blockedUntil=s.round;
  const usable=intents.filter(i=>!frozen.has(i.actor)||player(s,i.actor)!.role==='FROZEN');
  const attacks:Attack[]=[];
  const hit=(a:V2Player,t:string,cause:string=a.role,force=false)=>attacks.push({actor:a.id,target:t,role:initial.get(a.id)!,cause,force});
  const don=s.players.find(p=>p.role==='DON'&&alive(p));
  const mafiaIntents=usable.filter(i=>['DON','MAFIOSO'].includes(player(s,i.actor)!.role));
  const mafiaTarget=don&&!frozen.has(don.id)&&!asleep(s,don)?mafiaIntents.find(i=>i.actor===don.id)?.target??uniqueTop(mafiaIntents.filter(i=>i.actor!==don.id).map(i=>({target:i.target!,weight:1}))):null;
  // The effective Don visit, not each ordinary mafia ballot, is the actual attack.
  const visits=usable.filter(i=>!['DON','MAFIOSO'].includes(player(s,i.actor)!.role));
  if(don&&mafiaTarget)visits.push({actor:don.id,target:mafiaTarget,kind:'CHOOSE'});
  const trapped=new Set<string>();
  for(const i of visits.filter(i=>player(s,i.actor)!.role==='MINIOR')){
    const miner=player(s,i.actor)!;
    for(const v of visits)if(v.target===i.target&&v.actor!==miner.id&&v.actor!==i.target&&player(s,v.actor)!.role!=='MERGAN'){
      trapped.add(v.actor);hit(miner,v.actor,'MINIOR',true);
    }
  }
  const actions=usable.filter(i=>!trapped.has(i.actor));
  const protectedIds=new Set<string>(),masked=new Set<string>();
  for(const i of actions){
    const a=player(s,i.actor)!,t=player(s,i.target!)!;
    if(a.role==='DOCTOR'){protectedIds.add(t.id);if(a.id===t.id)a.selfHeal=false;}
    if(a.role==='CHEMIST'&&faction(t)==='MAFIA')protectedIds.add(t.id);
    if(a.role==='LAWYER'){if(faction(t)==='MAFIA')masked.add(t.id);t.hangingProtection=true;}
    if(a.role==='TENTAK'&&faction(t)==='CITY')t.hangingProtection=true;
  }
  if(don&&mafiaTarget&&!trapped.has(don.id))hit(don,mafiaTarget,'MAFIA');
  const conversions:{actor:string;target:string}[]=[];
  const detonations:V2Player[]=[];
  for(const i of actions){
    const a=player(s,i.actor)!,t=player(s,i.target!)!;
    switch(a.role){
      case 'COMMISSAR':
      case 'SPY':{
        if(i.kind==='SHOOT'){hit(a,t.id);break;}
        const role=masked.has(t.id)||t.document?'CITIZEN':t.role;
        if(t.document&&!masked.has(t.id))t.document=false;
        effects.push({kind:'CHECK',recipient:a.id,target:t.id,role});
        if(a.role==='COMMISSAR')for(const p of s.players.filter(p=>p.role==='SERGEANT'&&alive(p)))effects.push({kind:'CHECK',recipient:p.id,target:t.id,role});
        break;
      }
      case 'MANYAK':case 'MERGAN':hit(a,t.id);break;
      case 'KILLER':if(t.role==='COMMISSAR')hit(t,a.id,'COMMISSAR');else hit(a,t.id);break;
      case 'CHEMIST':if(faction(t)!=='MAFIA')hit(a,t.id);break;
      case 'TENTAK':if(faction(t)!=='CITY')hit(a,t.id);break;
      case 'CHAMELEON':{
        const f=faction(t);const next=f==='CITY'?'SERGEANT':f==='MAFIA'?'MAFIOSO':f==='SOLO'?'MANYAK':null;
        if(next){a.role=next;a.changed=true;effects.push({kind:'ROLE',target:a.id,role:next});}break;
      }
      case 'ZOMBIE':conversions.push({actor:a.id,target:t.id});break;
      case 'KRAMPOUS':
        if(a.id===t.id){detonations.push(a);for(const id of a.marks)if(player(s,id)&&alive(player(s,id)!))hit(a,id);hit(a,a.id,'KRAMPOUS_SELF',true);}else a.marks.push(t.id);
        break;
      case 'GRENCH':{
        const amount=50+10*rng.int(11);
        if(choices.grench?.get(a.id)==='HP'){t.hp=Math.max(0,t.hp-17);effects.push({kind:'HP',target:t.id,hp:t.hp});if(!t.hp){t.death='GRENCH';effects.push({kind:'DEATH',target:t.id,reason:'GRENCH',attackers:[a.id]});}}
        else if(!choices.paidGrench?.has(a.id))effects.push({kind:'GRENCH',actor:a.id,target:t.id,amount});
        break;
      }
      case 'KLAUS':effects.push({kind:'KLAUS',actor:a.id,target:t.id,amount:50+rng.int(151)});break;
      case 'SELLER':effects.push({kind:'SELLER',actor:a.id,target:t.id});break;
      default:break;
    }
  }
  // Collect attacks before applying deaths. Doctor protection precedes lucky and
  // consumables. Forced trap deaths bypass ordinary healing; Minior cancels visits.
  const deaths=new Map<string,Attack[]>();
  const record=(id:string,attack:Attack)=>{const a=deaths.get(id)??[];a.push(attack);deaths.set(id,a);};
  const wizardRetaliations:Attack[]=[];
  for(const target of s.players){
    if(!alive(target))continue;
    const incoming=attacks.filter(a=>a.target===target.id&&!(target.role==='MERGAN'&&V2_DEFS[a.role].faction==='SOLO'));
    const residual=incoming.filter(a=>{
      if(a.force)return true;
      if(protectedIds.has(target.id))return false;
      if(target.role==='LUCKY'&&target.lucky){target.lucky=false;return false;}
      if(target.shield>0){target.shield--;return false;}return true;
    });
    if(!residual.length)continue;
    if(target.role==='WIZARD'&&!residual.some(a=>a.force)){
      const choice=choices.wizard?.get(target.id);
      if(!choice)effects.push({kind:'WIZARD_CHOICE',recipient:target.id,attackers:[...new Set(residual.map(a=>a.actor))]});
      if(choice==='FORGIVE')continue;
      if(choice==='REFUSE'){for(const a of residual)wizardRetaliations.push({actor:target.id,target:a.actor,role:'WIZARD',cause:'WIZARD'});continue;}
    }
    for(const a of residual)record(target.id,a);
  }
  for(const a of wizardRetaliations)record(a.target,a);
  // Kamikaze chains are bounded by the number of players.
  const expanded=new Set<string>();
  while(true){
    const entry=[...deaths].find(([id])=>player(s,id)?.role==='KAMIKAZE'&&!expanded.has(id));if(!entry)break;
    const [id,as]=entry;expanded.add(id);
    const k=player(s,id)!;k.personal=as.some(a=>a.role==='COMMISSAR')?'LOSS':'WIN';
    for(const a of as)if(a.actor!==id){
      const p=player(s,a.actor);
      if(p&&alive(p)){record(a.actor,{actor:id,target:a.actor,role:'KAMIKAZE',cause:'KAMIKAZE'});if(a.role==='COMMISSAR')p.personal='LOSS';}
    }
  }
  for(const [id,as] of deaths){
    const p=player(s,id)!;if(!alive(p))continue;
    p.hp=0;p.death=as[0]!.cause;effects.push({kind:'DEATH',target:id,reason:p.death,attackers:[...new Set(as.map(a=>a.actor))]});
  }
  for(const i of actions.filter(i=>initial.get(i.actor)==='DAYDI')){
    const a=player(s,i.actor)!;if(!alive(a))continue;
    const killers=deaths.get(i.target!);
    if(killers)effects.push({kind:'WITNESS',recipient:a.id,target:i.target!,attackers:killers.map(k=>({id:k.actor,role:k.role}))});
  }
  for(const c of conversions){
    const t=player(s,c.target)!;if(!alive(t)||t.role==='ZOMBIE'||protectedIds.has(t.id))continue;
    if(t.shield>0){t.shield--;continue;}
    t.role='ZOMBIE';t.marks=[];effects.push({kind:'ROLE',target:t.id,role:'ZOMBIE'});
  }
  for(const a of detonations)if(a.marks.filter(id=>player(s,id)?.hp===0).length>=3)a.personal='WIN';
  for(const p of active){
    if(!alive(p)||frozen.has(p.id))continue;
    const acted=s.intents.some(i=>i.actor===p.id);
    if(!acted)p.missedTotal=(p.missedTotal??0)+1;
    p.missed=acted?0:p.missed+1;
    if(p.missed>=2){p.hp=0;p.left=true;p.personal='LOSS';p.death='AFK';effects.push({kind:'DEATH',target:p.id,reason:'AFK',attackers:[]});}
  }
  promote(s,effects);phase(s,'DAWN',now);return {state:s,effects};
}
function promote(s:V2State,effects:V2Effect[]){
  for(const [old,next] of [['DON','MAFIOSO'],['COMMISSAR','SERGEANT']] as const){
    if(s.players.some(p=>alive(p)&&p.role===old))continue;
    const successor=s.players.filter(p=>alive(p)&&p.role===next).sort((a,b)=>Number(b.changed)-Number(a.changed))[0];
    if(successor){successor.role=old;effects.push({kind:'ROLE',target:successor.id,role:old});}
  }
}
export function v2Victory(s:V2State):V2Outcome|null{
  const living=s.players.filter(alive);
  const suic=s.players.find(p=>p.role==='SUIDSID'&&p.personal==='WIN');
  if(suic)return {reason:'SUIDSID',winners:[suic.id]};
  const personal=s.players.filter(p=>p.personal==='WIN'&&!p.left).map(p=>p.id);
  if(!living.length)return {reason:'DRAW',winners:s.mode==='VS'?[]:personal};
  if(s.mode==='VS'){
    const colours=new Set(living.map(p=>p.colour));
    return colours.size===1?{reason:'TEAM',winners:s.players.filter(p=>!p.left&&p.colour===living[0]!.colour).map(p=>p.id)}:null;
  }
  const city=living.filter(p=>faction(p)==='CITY');
  const mafia=living.filter(p=>faction(p)==='MAFIA');
  const solo=living.filter(p=>faction(p)==='SOLO');
  const zombie=living.filter(p=>faction(p)==='ZOMBIE');
  const neutral=living.filter(p=>faction(p)==='NEUTRAL'&&p.role!=='SUIDSID');
  let reason:string|null=null;let winners:string[]=[];
  // Proposed generalized end conditions for cases not explicitly specified.
  if(zombie.length){if(zombie.length===living.length){reason='ZOMBIE';winners=s.players.filter(p=>p.role==='ZOMBIE').map(p=>p.id);}}
  else if(solo.length>1){return null;}
  else if(solo.length===1){
    if(city.length+mafia.length<=1||(solo[0]!.role==='MANYAK'||solo[0]!.role==='MERGAN')&&mafia.length===0&&city.length<=2){reason='SOLO';winners=[solo[0]!.id];}
  }else if(mafia.length&&(mafia.length>city.length||city.length<=1)){reason='MAFIA';winners=s.players.filter(p=>faction(p)==='MAFIA').map(p=>p.id);}
  else if(!mafia.length){reason=city.length?'CITY':'NEUTRAL';winners=s.players.filter(p=>faction(p)==='CITY').map(p=>p.id);}
  if(!reason)return null;
  const all=new Set([...winners,...neutral.map(p=>p.id),...personal]);
  return {reason,winners:s.players.filter(p=>all.has(p.id)&&!p.left&&p.personal!=='LOSS'&&(p.role!=='KAMIKAZE'||p.personal==='WIN')).map(p=>p.id)};
}
function finishOr(s:V2State,next:V2Phase,now:number){s.outcome=v2Victory(s);phase(s,s.outcome?'ENDED':next,now);}
/** Explicit departure forfeits the player's result and all pending actions. */
export function v2Leave(input:V2State,id:string,now:number):V2Resolution{
  const original=player(input,id);
  if(!original||original.left||input.outcome||input.phase==='ENDED')throw Error('invalid departure');
  const s=clone(input),p=player(s,id)!,effects:V2Effect[]=[];
  const wasAlive=alive(p);
  p.left=true;p.hp=0;p.personal='LOSS';p.death='LEAVE';
  s.intents=s.intents.filter(i=>i.actor!==id&&i.target!==id);
  s.votes=s.votes.filter(v=>v.actor!==id&&v.target!==id);
  s.verdicts=s.verdicts.filter(v=>v.actor!==id);
  if(wasAlive)effects.push({kind:'DEATH',target:id,reason:'LEAVE',attackers:[]});
  promote(s,effects);
  if(s.phase==='REVENGE'&&s.revenge===id){
    const next=v2Advance(s,now,s.seq);
    return {state:next.state,effects:[...effects,...next.effects]};
  }
  return {state:s,effects};
}
export function v2HeroShot(input:V2State,actor:string,target:string,seq:number):V2Resolution{
  const a=requireActor(input,actor,seq,'DAWN'),t=player(input,target);
  if(!t||!alive(t)||a.id===t.id||!['DON','COMMISSAR','MERGAN'].includes(a.role)||a.heroUsed||a.heroCharges<1||!Number.isInteger(a.heroDamage)||a.heroDamage<45||a.heroDamage>100)throw new Error('invalid hero shot');
  const s=clone(input),shooter=player(s,actor)!,victim=player(s,target)!;
  shooter.heroUsed=true;shooter.heroCharges--;
  let absorbed=0,lostHp=0;
  if(victim.heroShield)victim.heroShield=false;
  else {absorbed=Math.min(victim.heroDefense,shooter.heroDamage);victim.heroDefense-=absorbed;lostHp=Math.min(victim.hp,shooter.heroDamage-absorbed);victim.hp-=lostHp;}
  const effects:V2Effect[]=[{kind:'HERO',actor,target,hpLost:lostHp,killed:!victim.hp,absorbed},{kind:'HP',target,hp:victim.hp}];
  if(!victim.hp){victim.death='HERO';if(victim.role==='KAMIKAZE')victim.personal='WIN';effects.push({kind:'DEATH',target,reason:'HERO',attackers:[actor]});promote(s,effects);}
  return {state:s,effects};
}
export function v2Vote(input:V2State,actor:string,target:string,seq:number):V2State{
  requireActor(input,actor,seq,'VOTING');const t=player(input,target);
  if(!t||!alive(t)||actor===target)throw new Error('invalid vote');
  const s=clone(input);s.votes=s.votes.filter(v=>v.actor!==actor);s.votes.push({actor,target});return s;
}
export function v2Verdict(input:V2State,actor:string,yes:boolean,seq:number):V2State{
  requireActor(input,actor,seq,'VERDICT');const s=clone(input);s.verdicts=s.verdicts.filter(v=>v.actor!==actor);s.verdicts.push({actor,yes});return s;
}
export function v2Advance(input:V2State,now:number,seq:number):V2Resolution{
  if(input.seq!==seq||input.outcome)throw new Error('stale phase');
  const s=clone(input),effects:V2Effect[]=[];
  function nextNight(){s.round++;s.intents=[];s.votes=[];s.verdicts=[];s.candidate=null;s.revenge=null;finishOr(s,'NIGHT',now);}
  if(s.phase==='DAWN')finishOr(s,'DISCUSSION',now);
  else if(s.phase==='DISCUSSION')phase(s,'VOTING',now);
  else if(s.phase==='VOTING'){
    s.candidate=uniqueTop(s.votes.filter(v=>{const p=player(s,v.actor);return p&&alive(p)&&!asleep(s,p);}).map(v=>({target:v.target,weight:player(s,v.actor)!.role==='JANOB'?2:1})));
    if(s.candidate)phase(s,'VERDICT',now);else nextNight();
  }else if(s.phase==='VERDICT'){
    const candidate=s.candidate?player(s,s.candidate):undefined;
    let tally=0;for(const v of s.verdicts){const p=player(s,v.actor);if(p&&alive(p)&&!asleep(s,p))tally+=(v.yes?1:-1)*(p.role==='JANOB'?2:1);}
    if(candidate&&alive(candidate)&&tally>0){
      if(candidate.hangingProtection)effects.push({kind:'HANGING_PROTECTED',target:candidate.id,reason:'LAWYER_OR_TENTAK'});
      else if(candidate.voteShield){candidate.voteShield=false;effects.push({kind:'HANGING_PROTECTED',target:candidate.id,reason:'ITEM'});}
      else{
        candidate.hp=0;candidate.death='VOTE';effects.push({kind:'DEATH',target:candidate.id,reason:'VOTE',attackers:[]});
        if(candidate.role==='SUIDSID')candidate.personal='WIN';
        if(candidate.role==='KAMIKAZE'){candidate.personal='WIN';s.revenge=candidate.id;phase(s,'REVENGE',now);return {state:s,effects};}
        promote(s,effects);
      }
    }
    nextNight();
  }else if(s.phase==='REVENGE'){promote(s,effects);nextNight();}else throw new Error('use night resolver');
  return {state:s,effects};
}
export function v2Revenge(input:V2State,actor:string,target:string,seq:number,now:number):V2Resolution{
  if(input.phase!=='REVENGE'||input.seq!==seq||input.revenge!==actor||!player(input,target)||!alive(player(input,target)!))throw new Error('invalid revenge');
  const s=clone(input),t=player(s,target)!;t.hp=0;t.death='KAMIKAZE';
  const result=v2Advance(s,now,seq);
  result.effects.unshift({kind:'DEATH',target,reason:'KAMIKAZE',attackers:[actor]});return result;
}
export function v2LastWordUntil(deathAt:number){return deathAt+V2_LAST_WORD_SECONDS*1000;}

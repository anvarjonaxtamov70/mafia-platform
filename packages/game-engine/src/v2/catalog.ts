/** Isolated v2 engine. This registry deliberately does not change v1 snapshots. */
import {shuffle} from '../rng';
import type {Rng} from '../types';
export const V2_ROLES = ['CITIZEN','DON','MAFIOSO','MANYAK','COMMISSAR','DOCTOR','SERGEANT','DAYDI','FROZEN','LAWYER','SUIDSID','KILLER','KAMIKAZE','GRENCH','MINIOR','SPY','ZOMBIE','CHEMIST','TENTAK','CHAMELEON','SELLER','KRAMPOUS','LUCKY','KLAUS','WIZARD','MERGAN','JANOB'] as const;
export type V2Role = typeof V2_ROLES[number];
export const V2_MODES = ['CLASSIC','ZOMBIE','HYPERNOVA','VS'] as const;
export type V2Mode = typeof V2_MODES[number];
export type V2Faction = 'CITY'|'MAFIA'|'SOLO'|'NEUTRAL'|'ZOMBIE';
export type V2Action = 'CHOOSE'|'CHECK'|'SHOOT'|'SKIP';
type Definition = { faction: V2Faction; active:boolean; min:number };
export const V2_DEFS: Record<V2Role,Definition> = {
  CITIZEN:{faction:'CITY',active:false,min:4}, DON:{faction:'MAFIA',active:true,min:4},
  MAFIOSO:{faction:'MAFIA',active:true,min:6}, MANYAK:{faction:'SOLO',active:true,min:12},
  COMMISSAR:{faction:'CITY',active:true,min:4}, DOCTOR:{faction:'CITY',active:true,min:7},
  SERGEANT:{faction:'CITY',active:false,min:10}, DAYDI:{faction:'CITY',active:true,min:8},
  FROZEN:{faction:'CITY',active:true,min:8}, LAWYER:{faction:'MAFIA',active:true,min:11},
  SUIDSID:{faction:'NEUTRAL',active:false,min:10}, KILLER:{faction:'MAFIA',active:true,min:19},
  KAMIKAZE:{faction:'CITY',active:false,min:13}, GRENCH:{faction:'NEUTRAL',active:true,min:14},
  MINIOR:{faction:'SOLO',active:true,min:18}, SPY:{faction:'MAFIA',active:true,min:15},
  ZOMBIE:{faction:'ZOMBIE',active:true,min:4}, CHEMIST:{faction:'MAFIA',active:true,min:23},
  TENTAK:{faction:'CITY',active:true,min:18}, CHAMELEON:{faction:'NEUTRAL',active:true,min:15},
  SELLER:{faction:'NEUTRAL',active:true,min:18}, KRAMPOUS:{faction:'SOLO',active:true,min:26},
  LUCKY:{faction:'CITY',active:false,min:9}, KLAUS:{faction:'NEUTRAL',active:true,min:20},
  WIZARD:{faction:'NEUTRAL',active:false,min:16}, MERGAN:{faction:'SOLO',active:true,min:22},
  JANOB:{faction:'CITY',active:false,min:14}
};
export const V2_PHASE_SECONDS = 30;
export const V2_LAST_WORD_SECONDS = 29;
export function v2ModeAllows(role:V2Role,mode:V2Mode):boolean {
  if(role==='ZOMBIE') return mode==='ZOMBIE';
  if(mode==='ZOMBIE') return !(['CITIZEN','SUIDSID','SELLER','KLAUS'] as V2Role[]).includes(role);
  if(mode==='HYPERNOVA'||mode==='VS')return V2_DEFS[role].active;
  return true;
}
export function v2FactionPlan(n:number,mode:V2Mode){
  if(!Number.isInteger(n)||n<4||n>30||(mode==='VS'&&n%2!==0))throw new RangeError('invalid player count');
  const mafia=Math.floor((n+2)/4);
  const other=Math.floor((n-4)/4);
  const zombie=mode==='ZOMBIE'?1:0;
  const neutral=Math.max(0,other-zombie);
  return {mafia,neutral,zombie,city:n-mafia-neutral-zombie};
}
/** Proposed allocation; not evidence of Bloody internals. For active-only/no-citizen
 * modes, repeat the least numerous eligible support roles, never duplicate Don or
 * Commissar. Special lethal roles are unique and at most two initial solo attackers.
 */
export function distributeV2(n:number,mode:V2Mode,rng:Rng):V2Role[]{
  const plan=v2FactionPlan(n,mode);
  const eligible=V2_ROLES.filter(r=>v2ModeAllows(r,mode)&&V2_DEFS[r].min<=n);
  const mafia:V2Role[]=['DON'];
  const specialists=shuffle(eligible.filter(r=>V2_DEFS[r].faction==='MAFIA'&&r!=='DON'&&r!=='MAFIOSO'),rng);
  const specialCount=Math.min(specialists.length,Math.floor((plan.mafia-1)/2));
  mafia.push(...specialists.slice(0,specialCount));
  while(mafia.length<plan.mafia)mafia.push('MAFIOSO');
  const others:V2Role[]=[];
  let solos=0;
  for(const role of shuffle(eligible.filter(r=>['NEUTRAL','SOLO'].includes(V2_DEFS[r].faction)),rng)){
    if(others.length>=plan.neutral)break;
    if(V2_DEFS[role].faction==='SOLO'){
      if(solos>=(n>=20?2:1))continue;
      solos++;
    }
    others.push(role);
  }
  if(plan.zombie)others.push('ZOMBIE');
  const cityCount=n-mafia.length-others.length;
  const city:V2Role[]=['COMMISSAR'];
  if((n>=7||mode!=='CLASSIC')&&city.length<cityCount)city.push('DOCTOR');
  const cityPool=shuffle(eligible.filter(r=>V2_DEFS[r].faction==='CITY'&&r!=='CITIZEN'&&!city.includes(r)),rng);
  const maxSpecial=mode==='CLASSIC'?Math.max(city.length,Math.ceil(cityCount*0.65)):cityCount;
  city.push(...cityPool.slice(0,Math.max(0,maxSpecial-city.length)));
  const repeatPool:V2Role[]=mode==='CLASSIC'?['CITIZEN']:['DOCTOR',...eligible.filter(r=>r==='DAYDI'||r==='FROZEN')];
  while(city.length<cityCount){
    const min=Math.min(...repeatPool.map(r=>city.filter(x=>x===r).length));
    const least=repeatPool.filter(r=>city.filter(x=>x===r).length===min);
    city.push(least[rng.int(least.length)]!);
  }
  return shuffle([...mafia,...others,...city],rng);
}

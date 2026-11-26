/** Deterministic, serializable night response phase. The server must durably
 * persist the session and obtain actual ledger receipts before finalizing.
 * Preview effects are not publishable as final events.
 */
import {seededRng} from '../rng';
import {v2ResolveNight,v2CanEndNight,type V2State,type V2Resolution} from './engine';
export type V2NightPrompt =
  | {kind:'WIZARD';key:string;recipient:string;attackers:string[]}
  | {kind:'GRENCH';key:string;recipient:string;actor:string;amount:number};
export type V2NightAnswer='FORGIVE'|'REFUSE'|'HP'|'MONEY';
export type V2NightSession={
  version:1;source:V2State;seed:number;startedAt:number;deadline:number;
  prompts:V2NightPrompt[];answers:{key:string;answer:V2NightAnswer}[];
};
export function v2BeginNightSession(s:V2State,now:number,seed:number):V2NightSession {
  if(s.phase!=='NIGHT'||s.outcome||!Number.isSafeInteger(seed)||(!v2CanEndNight(s)&&(s.deadline===null||now<s.deadline)))throw Error('night not ready');
  const preview=v2ResolveNight(s,now,seededRng(seed));
  const prompts:V2NightPrompt[]=[];
  for(const e of preview.effects){
    if(e.kind==='WIZARD_CHOICE')prompts.push({kind:'WIZARD',key:'w:'+e.recipient,recipient:e.recipient,attackers:e.attackers});
    if(e.kind==='GRENCH')prompts.push({kind:'GRENCH',key:'g:'+e.actor,recipient:e.target,actor:e.actor,amount:e.amount});
  }
  return {version:1,source:JSON.parse(JSON.stringify(s)) as V2State,seed,startedAt:now,deadline:now+30000,prompts,answers:[]};
}
export function v2AnswerNightSession(session:V2NightSession,recipient:string,key:string,answer:V2NightAnswer,now:number):V2NightSession {
  const prompt=session.prompts.find(p=>p.key===key);
  if(!prompt||prompt.recipient!==recipient||now>=session.deadline||session.answers.some(a=>a.key===key))throw Error('invalid or stale night answer');
  if(prompt.kind==='WIZARD'?!['FORGIVE','REFUSE'].includes(answer):!['HP','MONEY'].includes(answer))throw Error('invalid night answer kind');
  return {...session,answers:[...session.answers,{key,answer}]};
}
export function v2NightSessionReady(session:V2NightSession,now:number):boolean{
  return now>=session.deadline||session.prompts.every(p=>session.answers.some(a=>a.key===p.key));
}
/** The server must debit exactly the quoted amount or supply INSUFFICIENT.
 * Failure to reach the ledger is NOT insufficient funds; it must be retried.
 */
export function v2NightDebits(session:V2NightSession,now:number){
  if(!v2NightSessionReady(session,now))throw Error('night responses pending');
  return session.prompts.flatMap(p=>p.kind==='GRENCH'&&session.answers.find(a=>a.key===p.key)?.answer!=='HP'?[{key:p.key,actor:p.actor,target:p.recipient,amount:p.amount}]:[]);
}
export function v2FinishNightSession(session:V2NightSession,now:number,receipts:ReadonlyMap<string,'PAID'|'INSUFFICIENT'>):V2Resolution{
  if(!v2NightSessionReady(session,now))throw Error('night responses pending');
  const wizard=new Map<string,'FORGIVE'|'REFUSE'>(),grench=new Map<string,'HP'|'MONEY'>(),paidGrench=new Set<string>();
  for(const p of session.prompts){
    const answer=session.answers.find(a=>a.key===p.key)?.answer;
    if(p.kind==='WIZARD'){
      if(answer==='FORGIVE'||answer==='REFUSE')wizard.set(p.recipient,answer);
    }else{
      if(answer==='HP'){grench.set(p.actor,'HP');continue;}
      const receipt=receipts.get(p.key);
      if(!receipt)throw Error('missing ledger receipt');
      if(receipt==='INSUFFICIENT')grench.set(p.actor,'HP');
      else{grench.set(p.actor,'MONEY');paidGrench.add(p.actor);}
    }
  }
  const result=v2ResolveNight(session.source,now,seededRng(session.seed),{wizard,grench,paidGrench});
  // These are response prompts only; never forward them as final public effects.
  result.effects=result.effects.filter(e=>e.kind!=='WIZARD_CHOICE'&&e.kind!=='GRENCH');
  return result;
}

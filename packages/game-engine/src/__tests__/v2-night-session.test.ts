import {describe,it,expect} from 'vitest';
import {seededRng} from '../rng';
import {v2CreateFixed,v2Submit,v2BeginNightSession,v2AnswerNightSession,v2NightDebits,v2FinishNightSession,type V2Role} from '../v2';
function setup(roles:V2Role[]){return v2CreateFixed(roles.map((_,i)=>String(i)),roles,'CLASSIC',0,seededRng(1));}
describe('serializable v2 night response window',()=>{
 it('wizard only responds to own prompt, all attackers share the decision',()=>{
  let s=setup(['DON','MANYAK','WIZARD','CITIZEN','CITIZEN']);
  s=v2Submit(s,{actor:'0',target:'2',kind:'CHOOSE'},1);
  s=v2Submit(s,{actor:'1',target:'2',kind:'CHOOSE'},1);
  const window=v2BeginNightSession(s,1000,42);
  expect(window.prompts).toEqual([{kind:'WIZARD',key:'w:2',recipient:'2',attackers:['0','1']}]);
  expect(()=>v2AnswerNightSession(window,'1','w:2','REFUSE',2000)).toThrow();
  expect(()=>v2FinishNightSession(window,2000,new Map())).toThrow();
  const answered=v2AnswerNightSession(window,'2','w:2','REFUSE',2000);
  expect(()=>v2AnswerNightSession(answered,'2','w:2','FORGIVE',2001)).toThrow();
  const restored=JSON.parse(JSON.stringify(answered)) as typeof answered;
  const result=v2FinishNightSession(restored,2001,new Map());
  expect(result.state.players.slice(0,3).map(p=>p.hp)).toEqual([0,0,100]);
  expect(result.effects.some(e=>e.kind==='WIZARD_CHOICE')).toBe(false);
  expect(v2FinishNightSession(window,31000,new Map()).state.players[2]!.hp).toBe(0);
 });
 it('Grench default money needs durable receipt; insufficient funds becomes 17 HP',()=>{
  let s=setup(['DON','GRENCH','CITIZEN','CITIZEN','CITIZEN']);
  s=v2Submit(s,{actor:'0',target:null,kind:'SKIP'},1);
  s=v2Submit(s,{actor:'1',target:'2',kind:'CHOOSE'},1);
  const window=v2BeginNightSession(s,1000,42);
  const debits=v2NightDebits(window,31000);
  expect(debits).toHaveLength(1);
  expect(debits[0]!.amount).toBeGreaterThanOrEqual(50);expect(debits[0]!.amount).toBeLessThanOrEqual(150);
  expect(()=>v2FinishNightSession(window,31000,new Map())).toThrow('missing ledger receipt');
  const paid=v2FinishNightSession(window,31000,new Map([['g:1','PAID']]));
  expect(paid.state.players[2]!.hp).toBe(100);
  const poor=v2FinishNightSession(window,31000,new Map([['g:1','INSUFFICIENT']]));
  expect(poor.state.players[2]!.hp).toBe(83);
  const hp=v2AnswerNightSession(window,'2','g:1','HP',2000);
  expect(v2NightDebits(hp,2000)).toEqual([]);
  expect(v2FinishNightSession(hp,2000,new Map()).state.players[2]!.hp).toBe(83);
 });
});

import {describe,it,expect} from 'vitest';
import {seededRng} from '../rng';
import {V2_ROLES,V2_MODES,V2_DEFS,distributeV2,v2ModeAllows,v2CreateFixed,v2Submit,v2ResolveNight,v2CanEndNight,v2Victory,v2HeroShot,v2Advance,v2Vote,v2Verdict,type V2Role,type V2State,type V2Action} from '../v2';
const rng=()=>seededRng(1);
const game=(roles:V2Role[])=>v2CreateFixed(roles.map((_,i)=>String(i)),roles,'CLASSIC',0,rng());
function act(s:V2State,a:number,t:number,kind:V2Action='CHOOSE'){return v2Submit(s,{actor:String(a),target:String(t),kind},s.seq);}
const night=(s:V2State)=>v2ResolveNight(s,30000,rng());
describe('v2 independent engine',()=>{
 it('allocates all legal counts and modes across 100 seeds',()=>{
  expect(V2_ROLES).toHaveLength(27);
  for(const mode of V2_MODES)for(let n=4;n<=30;n++){
   if(mode==='VS'&&n%2){expect(()=>distributeV2(n,mode,rng())).toThrow();continue;}
   for(let seed=0;seed<100;seed++){
    const roles=distributeV2(n,mode,seededRng(seed));
    expect(roles).toHaveLength(n);expect(roles.filter(r=>r==='DON')).toHaveLength(1);
    expect(roles.every(r=>v2ModeAllows(r,mode))).toBe(true);
    expect(roles.filter(r=>V2_DEFS[r].faction==='MAFIA').length).toBeLessThan(n/2);
    expect(roles.filter(r=>r==='ZOMBIE')).toHaveLength(mode==='ZOMBIE'?1:0);
   }
  }
 },60000);
 it('Don override, fallback responsibility and Kamikaze',()=>{
  let s=game(['DON','MAFIOSO','KAMIKAZE','CITIZEN','CITIZEN']);
  s=act(s,1,2);const r=night(s);
  expect(r.state.players[0]!.hp).toBe(0);expect(r.state.players[2]!.personal).toBe('WIN');
  expect(r.state.players[1]!.role).toBe('DON');
  s=game(['DON','MAFIOSO','KAMIKAZE','CITIZEN','CITIZEN']);
  s=act(act(s,0,3),1,2);expect(night(s).state.players[2]!.hp).toBe(100);
 });
 it('simultaneous lethal attacks and doctor saves all without shield debit',()=>{
  let s=game(['DON','COMMISSAR','DOCTOR','MANYAK','CITIZEN']);
  s.players[1]!.shield=1;
  s=act(act(act(s,0,1),3,1),2,1);
  const r=night(s);expect(r.state.players[1]!.hp).toBe(100);expect(r.state.players[1]!.shield).toBe(1);
  s=game(['DON','COMMISSAR','CITIZEN','CITIZEN']);
  s=act(act(s,0,1),1,0,'SHOOT');expect(night(s).state.players.slice(0,2).map(p=>p.hp)).toEqual([0,0]);
 });
 it('freeze Don blocks team and early end waits for eligible actors',()=>{
  let s=game(['DON','MAFIOSO','FROZEN','CITIZEN','CITIZEN']);
  s=act(act(s,0,3),1,3);expect(v2CanEndNight(s)).toBe(false);
  s=act(s,2,0);expect(v2CanEndNight(s)).toBe(true);expect(night(s).state.players[3]!.hp).toBe(100);
 });
 it('Mergan immune to solo; natural luck precedes purchased shield',()=>{
  let s=game(['DON','MANYAK','MERGAN','LUCKY','CITIZEN']);
  s.players[3]!.shield=1;s=act(act(s,0,3),1,2);const r=night(s);
  expect(r.state.players[2]!.hp).toBe(100);expect(r.state.players[3]!.lucky).toBe(false);expect(r.state.players[3]!.shield).toBe(1);
 });
 it('minior removes visiting doctor before healing',()=>{
  let s=game(['DON','DOCTOR','MINIOR','CITIZEN','CITIZEN']);
  s=act(act(act(s,0,3),1,3),2,3);const r=night(s);
  expect(r.state.players.map(p=>p.hp)).toEqual([0,0,100,100,100]);
 });
 it('confirmed endings and VS teams',()=>{
  expect(v2Victory(game(['DON','MAFIOSO','CITIZEN','CITIZEN']))).toBeNull();
  const s=game(['DON','MAFIOSO','MAFIOSO','CITIZEN','CITIZEN']);expect(v2Victory(s)?.reason).toBe('MAFIA');
  const t=game(['MANYAK','MERGAN','CITIZEN','CITIZEN']);t.players[2]!.hp=0;t.players[3]!.hp=0;expect(v2Victory(t)).toBeNull();
  const v=v2CreateFixed(['a','b','c','d'],['DON','COMMISSAR','DOCTOR','FROZEN'],'VS',0,rng());
  const red=v.players.filter(p=>p.colour==='RED');for(const p of v.players.filter(p=>p.colour==='BLUE'))p.hp=0;
  expect(v2Victory(v)?.winners).toEqual(red.map(p=>p.id));
 });
 it('Suidsid execution ends match; tied vote does not execute',()=>{
  let s=game(['DON','SUIDSID','CITIZEN','COMMISSAR','CITIZEN']);
  s.phase='VOTING';s=v2Vote(s,'0','1',s.seq);s=v2Vote(s,'2','1',s.seq);
  s=v2Advance(s,1,s.seq).state;expect(s.phase).toBe('VERDICT');
  s=v2Verdict(s,'0',true,s.seq);s=v2Verdict(s,'2',true,s.seq);
  expect(v2Advance(s,2,s.seq).state.outcome).toEqual({reason:'SUIDSID',winners:['1']});
 });
 it('hero only three roles, stacked damage, no normal retaliation',()=>{
  let s=game(['DON','COMMISSAR','KAMIKAZE','CITIZEN']);
  s.phase='DAWN';s.players[0]!.heroCharges=1;s.players[1]!.heroCharges=1;s.players[3]!.heroCharges=1;
  expect(()=>v2HeroShot(s,'3','2',s.seq)).toThrow();
  s=v2HeroShot(s,'0','2',s.seq).state;
  expect(s.players[2]!.hp).toBe(55);expect(()=>v2HeroShot(s,'0','2',s.seq)).toThrow();
  s=v2HeroShot(s,'1','2',s.seq).state;expect(s.players[2]!.hp).toBe(10);
 });
 it('all ordered role pairs accept or reject with immutable original state',()=>{
  for(const a of V2_ROLES)for(const b of V2_ROLES){
    const mode=a==='ZOMBIE'||b==='ZOMBIE'?'ZOMBIE':'CLASSIC';
    if(!v2ModeAllows(a,mode)||!v2ModeAllows(b,mode))continue;
    const filler=mode==='ZOMBIE'?'DOCTOR':'CITIZEN';
    const s=v2CreateFixed(['a','b','c','d'],[a,b,'DON',filler],mode,0,rng());
    const before=JSON.stringify(s);
    let next:V2State|undefined;try{next=v2Submit(s,{actor:'a',target:'b',kind:a==='COMMISSAR'?'CHECK':'CHOOSE'},s.seq);}catch(e){expect(e).toBeInstanceOf(Error);}
    if(next){const resolved=night(next);expect(resolved.state.players.every(p=>p.hp>=0&&p.hp<=100)).toBe(true);}
    expect(JSON.stringify(s)).toBe(before);
  }
 });
});

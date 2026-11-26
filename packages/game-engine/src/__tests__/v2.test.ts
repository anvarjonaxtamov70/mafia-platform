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
    expect(roles.filter(r=>r==='DOCTOR')).toHaveLength(1);
    expect(roles.filter(r=>r==='COMMISSAR')).toHaveLength(1);
    expect(roles.every(r=>v2ModeAllows(r,mode))).toBe(true);
    expect(roles.filter(r=>V2_DEFS[r].faction==='MAFIA').length).toBeLessThan(n/2);
    expect(roles.filter(r=>r==='ZOMBIE')).toHaveLength(mode==='ZOMBIE'?1:0);
   }
  }
 },60000);
 it('uses approved four-player rosters in every mode',()=>{
  const expected={CLASSIC:['DON','COMMISSAR','DOCTOR','CITIZEN'],ZOMBIE:['DON','COMMISSAR','DOCTOR','ZOMBIE'],HYPERNOVA:['DON','COMMISSAR','DOCTOR','DAYDI'],VS:['DON','COMMISSAR','DOCTOR','DAYDI']};
  for(const mode of V2_MODES)for(let seed=0;seed<100;seed++)expect(distributeV2(4,mode,seededRng(seed)).sort()).toEqual([...expected[mode]].sort());
 });
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
 it('ordinary shields are consumed per hit and never consume persistent hero defense',()=>{
  let s=game(['DON','COMMISSAR','MANYAK','CITIZEN','CITIZEN']);
  s.players[3]!.shield=1;s.players[3]!.heroDefense=100;s.players[3]!.heroShield=true;
  s=act(s,0,3);let r=night(s);
  expect(r.state.players[3]).toMatchObject({hp:100,shield:0,heroDefense:100,heroShield:true});
  s=act(s,2,3);r=night(s);
  expect(r.state.players[3]).toMatchObject({hp:0,shield:0,heroDefense:100,heroShield:true});
 });
 it('paid document masks spy and commissar, lawyer mask does not spend document',()=>{
  let s=game(['DON','COMMISSAR','SPY','LAWYER','MAFIOSO','CITIZEN']);
  s.players[4]!.document=true;s=act(act(s,1,4,'CHECK'),3,4);
  let r=night(s);
  expect(r.effects).toContainEqual({kind:'CHECK',recipient:'1',target:'4',role:'CITIZEN'});
  expect(r.state.players[4]!.document).toBe(true);
  s=game(['DON','SPY','COMMISSAR','CITIZEN']);
  s.players[2]!.document=true;s=act(s,1,2);r=night(s);
  expect(r.effects).toContainEqual({kind:'CHECK',recipient:'1',target:'2',role:'CITIZEN'});
  expect(r.state.players[2]!.document).toBe(false);
 });
 it('zombie conversion consumes only ordinary shield; doctor preserves it',()=>{
  const make=()=>v2CreateFixed(['0','1','2','3','4'],['DON','ZOMBIE','DOCTOR','COMMISSAR','DOCTOR'],'ZOMBIE',0,rng());
  let s=make();s.players[3]!.shield=1;s.players[3]!.heroDefense=80;
  s=act(s,1,3);let r=night(s);
  expect(r.state.players[3]).toMatchObject({role:'COMMISSAR',shield:0,heroDefense:80});
  s=act(s,2,3);r=night(s);
  expect(r.state.players[3]).toMatchObject({role:'COMMISSAR',shield:1,heroDefense:80});
 });
 it('hero shield precedes persistent defense and leaves ordinary shield intact',()=>{
  const s=game(['DON','COMMISSAR','CITIZEN','CITIZEN']);
  s.phase='DAWN';s.players[0]!.heroCharges=1;s.players[1]!.heroCharges=1;
  Object.assign(s.players[2]!,{shield:1,heroShield:true,heroDefense:8});
  const a=v2HeroShot(s,'0','2',s.seq);
  expect(a.state.players[2]).toMatchObject({hp:100,shield:1,heroShield:false,heroDefense:8});
  const b=v2HeroShot(a.state,'1','2',s.seq);
  expect(b.state.players[2]).toMatchObject({hp:63,shield:1,heroShield:false,heroDefense:0});
  expect(s.players[2]).toMatchObject({hp:100,heroShield:true,heroDefense:8});
 });
 it('role hanging protection precedes vote shield and shield is consumed once',()=>{
  const s=game(['DON','COMMISSAR','CITIZEN','CITIZEN','CITIZEN']);
  s.phase='VERDICT';s.candidate='2';s.players[2]!.hangingProtection=true;s.players[2]!.voteShield=true;
  const voted=v2Verdict(s,'1',true,s.seq);
  const a=v2Advance(voted,1,s.seq);
  expect(a.state.players[2]).toMatchObject({hp:100,voteShield:true});
  expect(a.effects).toContainEqual({kind:'HANGING_PROTECTED',target:'2',reason:'LAWYER_OR_TENTAK'});
  s.players[2]!.hangingProtection=false;
  const b=v2Advance(v2Verdict(s,'1',true,s.seq),1,s.seq);
  expect(b.state.players[2]).toMatchObject({hp:100,voteShield:false});
  expect(b.effects).toContainEqual({kind:'HANGING_PROTECTED',target:'2',reason:'ITEM'});
 });
 it('arrival order cannot change night RNG, effects or item consumption',()=>{
  const s=game(['DON','GRENCH','KLAUS','CITIZEN','CITIZEN']);
  const a=act(act(act(s,0,4),1,3),2,3);
  const b=act(act(act(s,2,3),1,3),0,4);
  const x=night(a),y=night(b);
  expect(x.effects).toEqual(y.effects);expect(x.state.players).toEqual(y.state.players);
 });
 it('Minior cannot trap another Minior, and Lawyer can protect only mafia',()=>{
  let s=game(['DON','MINIOR','MINIOR','DOCTOR','CITIZEN']);
  s=act(act(act(s,1,4),2,4),3,4);
  const r=night(s);
  expect(r.state.players[1]!.hp).toBe(100);expect(r.state.players[2]!.hp).toBe(100);expect(r.state.players[3]!.hp).toBe(0);
  s=game(['DON','LAWYER','CITIZEN','CITIZEN']);
  expect(()=>act(s,1,2)).toThrow();expect(()=>act(s,1,0)).not.toThrow();
 });
 it('Grench lethal HP and Wizard prompt remain deterministic across answers',()=>{
  let s=game(['DON','GRENCH','WIZARD','CITIZEN','CITIZEN']);
  s.players[2]!.hp=17;
  s=act(act(s,0,2),1,2);
  const preview=night(s);
  expect(preview.effects.some(e=>e.kind==='WIZARD_CHOICE')).toBe(true);
  const resolved=v2ResolveNight(s,30000,rng(),{wizard:new Map([['2','FORGIVE']]),grench:new Map([['1','HP']])});
  expect(resolved.state.players[2]).toMatchObject({hp:0,death:'GRENCH'});
  expect(resolved.state.players[0]!.hp).toBe(100);
  expect(resolved.effects.filter(e=>e.kind==='DEATH'&&e.target==='2')).toHaveLength(1);
  const refused=v2ResolveNight(s,30000,rng(),{wizard:new Map([['2','REFUSE']]),grench:new Map([['1','HP']])});
  expect(refused.state.players[0]!.hp).toBe(0);
  expect(refused.state.players[2]!.hp).toBe(0);
 });
 it('Zombie and Chameleon target validation does not disclose hidden factions',()=>{
  const z=v2CreateFixed(['0','1','2','3'],['DON','ZOMBIE','ZOMBIE','COMMISSAR'],'ZOMBIE',0,rng());
  const redundant=night(act(z,1,2));
  expect(redundant.state.players[2]!.role).toBe('ZOMBIE');
  expect(redundant.effects.some(e=>e.kind==='ROLE'&&e.target==='2')).toBe(false);
  const c=game(['DON','CHAMELEON','KLAUS','CITIZEN','COMMISSAR']);
  expect(night(act(c,1,2)).state.players[1]!.role).toBe('CHAMELEON');
  expect(night(act(c,1,3)).state.players[1]!.role).toBe('SERGEANT');
 });
 it('VS mafia ballots stay within colour teams; no-Don colour has independent attack',()=>{
  let s=v2CreateFixed(['0','1','2','3','4','5'],['DON','MAFIOSO','MAFIOSO','DOCTOR','COMMISSAR','DOCTOR'],'VS',0,rng());
  for(const p of s.players)p.colour=['0','2','4'].includes(p.id)?'RED':'BLUE';
  expect(()=>act(s,0,2)).toThrow();expect(()=>act(s,1,3)).toThrow();
  s=act(act(s,0,3),1,4);
  const r=night(s);expect(r.state.players[3]!.hp).toBe(0);expect(r.state.players[4]!.hp).toBe(0);
  expect(r.effects).toContainEqual({kind:'DEATH',target:'4',reason:'MAFIA',attackers:['1']});
 });
 it('Spy shares a masked result with own mafia but never opposite colour in VS',()=>{
  let s=v2CreateFixed(['0','1','2','3','4','5'],['DON','SPY','MAFIOSO','MAFIOSO','COMMISSAR','DOCTOR'],'VS',0,rng());
  for(const p of s.players)p.colour=['0','1','2'].includes(p.id)?'RED':'BLUE';
  s.players[4]!.document=true;s=act(s,1,4);
  const checks=night(s).effects.filter(e=>e.kind==='CHECK');
  expect(checks).toEqual(['1','0','2'].map(recipient=>({kind:'CHECK',recipient,target:'4',role:'CITIZEN'})));
 });
 it('Kamikaze ordinary multi-attacker death punishes Commissar, hero hit does not retaliate',()=>{
  let s=game(['DON','COMMISSAR','KAMIKAZE','CITIZEN','CITIZEN']);
  s=act(act(s,0,2),1,2,'SHOOT');
  let r=night(s);
  expect(r.state.players.slice(0,3).map(p=>p.hp)).toEqual([0,0,0]);
  expect(r.state.players[1]!.personal).toBe('LOSS');expect(r.state.players[2]!.personal).toBe('LOSS');
  s=game(['DON','COMMISSAR','KAMIKAZE','CITIZEN']);
  s.phase='DAWN';s.players[0]!.heroCharges=1;s.players[0]!.heroDamage=100;
  r=v2HeroShot(s,'0','2',s.seq);
  expect(r.state.players[0]!.hp).toBe(100);expect(r.state.players[2]).toMatchObject({hp:0,personal:'WIN'});
 });
 it('Krampous counts prior eliminated marks, not departures; protection saves marks',()=>{
  let s=game(['DON','KRAMPOUS','DOCTOR','CITIZEN','CITIZEN','CITIZEN','CITIZEN']);
  s.players[1]!.marks=['3','4','5','6'];s.players[3]!.hp=0;s.players[3]!.death='MAFIA';
  s.players[4]!.hp=0;s.players[4]!.left=true;s.players[4]!.death='LEAVE';
  s.players[5]!.shield=1;
  s=act(act(s,1,1),2,6);
  let r=night(s);
  expect(r.state.players[1]).toMatchObject({hp:0,personal:null});
  expect(r.state.players[5]).toMatchObject({hp:100,shield:0});expect(r.state.players[6]!.hp).toBe(100);
  s=game(['DON','KRAMPOUS','CITIZEN','CITIZEN','CITIZEN','CITIZEN']);
  s.players[1]!.marks=['2','3','4'];s.players[2]!.hp=0;s.players[2]!.death='MAFIA';
  expect(()=>act(s,1,3)).toThrow();
  r=night(act(s,1,1));expect(r.state.players[1]).toMatchObject({hp:0,personal:'WIN'});
 });
 it('Frozen blocks Wizard response and hero/vote, but does not penalize a missed frozen night',()=>{
  let s=game(['DON','FROZEN','WIZARD','COMMISSAR','CITIZEN','CITIZEN']);
  s=act(act(s,0,2),1,2);
  let r=night(s);
  expect(r.effects.some(e=>e.kind==='WIZARD_CHOICE')).toBe(false);expect(r.state.players[2]!.hp).toBe(0);
  s=game(['DON','FROZEN','COMMISSAR','CITIZEN','CITIZEN']);
  s.players[2]!.missed=1;s.players[2]!.heroCharges=1;
  r=night(act(s,1,2));expect(r.state.players[2]).toMatchObject({hp:100,missed:1,blockedUntil:1});
  expect(()=>v2HeroShot(r.state,'2','0',r.state.seq)).toThrow();
  r.state.phase='VOTING';expect(()=>v2Vote(r.state,'2','0',r.state.seq)).toThrow();
  r.state.phase='NIGHT';r.state.round=2;
  expect(()=>act(r.state,2,0,'CHECK')).not.toThrow();
 });
 it('Chameleon faction changes only after living night resolution',()=>{
  let s=game(['DON','CHAMELEON','COMMISSAR','CITIZEN','CITIZEN']);
  s=act(act(s,1,3),0,1);
  const r=night(s);expect(r.state.players[1]).toMatchObject({hp:0,role:'CHAMELEON'});
  s=game(['DON','CHAMELEON','COMMISSAR','CITIZEN','CITIZEN']);
  const q=night(act(s,1,3));expect(q.state.players[1]!.role).toBe('SERGEANT');
 });
 it('VS promotion stays with the former leader colour; completed round is not incremented at game end',()=>{
  let s=v2CreateFixed(['0','1','2','3','4','5'],['DON','MAFIOSO','MAFIOSO','DOCTOR','COMMISSAR','DOCTOR'],'VS',0,rng());
  for(const p of s.players)p.colour=['0','2','4'].includes(p.id)?'RED':'BLUE';
  s.players[0]!.hp=0;
  const r=night(s);expect(r.state.players[2]!.role).toBe('DON');expect(r.state.players[1]!.role).toBe('MAFIOSO');
  s=game(['DON','SUIDSID','CITIZEN','COMMISSAR','CITIZEN']);
  s.phase='VERDICT';s.candidate='1';const end=v2Advance(v2Verdict(s,'2',true,s.seq),1,s.seq);
  expect(end.state.phase).toBe('ENDED');expect(end.state.round).toBe(1);
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

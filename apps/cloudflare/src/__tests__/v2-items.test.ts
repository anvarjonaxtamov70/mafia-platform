import {describe,it,expect} from 'vitest';
import {World,privateText,groupText,callback,GROUP} from './harness';
import {usedV2Items} from '../v2-items';
async function lobby(){
 const w=new World({v2Preview:true,v2Ledger:true});
 for(const id of [1,2,3,4])await w.send(privateText(id,'/start'));
 const e=w.registryCore.eco;
 e.credit(2,1000,'TEST',null,'cash');e.creditDiamonds(2,10,'TEST','gems');
 for(const code of ['SHIELD','FAKE_DOC','VOTE_SHIELD','HERO_SHIELD']){
  expect(e.buy(2,code,'item:'+code).ok).toBe(true);expect(e.toggleArm(2,code)).toBe(true);
 }
 await w.send(groupText(1,'/game v2classic'));
 const core=await w.loaded(GROUP),g=core.data.game!;
 for(const id of [2,3,4])await w.send(callback(id,'l:j:'+g.number,GROUP));
 g.config.allowArcadeItems=true;
 return {w,e,core,g};
}
describe('v2 paid item lifecycle',()=>{
 it('reserved once on start replay, consumed only when used; unused returned even after cancellation',async()=>{
  const {w,e}=await lobby();
  const original=w.v2Settlement!.markRunning;let calls=0;
  w.v2Settlement!.markRunning=async (...args)=>{
   calls++;const items=await original(...args);
   if(calls===1)throw Error('lost start receipt');
   return items;
  };
  await w.send(groupText(1,'/startgame'));
  expect(calls).toBe(1);expect(e.items(2).filter(x=>x.code!=='PERSONAL_HERO').every(x=>x.qty===0)).toBe(true);
  w.restart(GROUP);await w.advance(2100);
  const restored=await w.loaded(GROUP),game=restored.data.game!;
  expect(calls).toBe(2);
  const p=game.v2Session!.state.players.find(x=>x.id==='2')!;
  expect(p).toMatchObject({shield:1,document:true,voteShield:true,heroShield:true});
  p.shield=0;p.heroShield=false;
  expect(usedV2Items(game)).toEqual({'2':['SHIELD','HERO_SHIELD']});
  await w.send(groupText(1,'/stop'));
  expect(restored.data.game).toBeNull();
  const qty=Object.fromEntries(e.items(2).map(i=>[i.code,i.qty]));
  expect(qty).toMatchObject({SHIELD:0,HERO_SHIELD:0,FAKE_DOC:1,VOTE_SHIELD:1});
  expect(w.registryCore.activeOf(2)).toBeNull();
 });
 it('disallowed items stay in inventory; no loadout is applied',async()=>{
  const {w,e,g}=await lobby();g.config.allowArcadeItems=false;
  await w.send(groupText(1,'/startgame'));
  expect(g.v2Session!.state.players.find(x=>x.id==='2')).toMatchObject({shield:0,document:false,voteShield:false,heroShield:false});
  expect(e.items(2).every(x=>x.qty===1)).toBe(true);
 });
});

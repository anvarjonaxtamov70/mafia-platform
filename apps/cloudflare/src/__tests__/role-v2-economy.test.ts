import {describe,it,expect} from 'vitest';
import {World,privateText,GROUP} from './harness';
async function fixture(){
 const w=new World();for(const id of [1,2,3,4])await w.send(privateText(id,'/start'));
 const r=w.registryCore,n=r.allocateGame(GROUP);
 for(const id of [1,2,3])r.claim(id,GROUP,n);
 r.markRunning(n,3);
 return {w,r,n,e:r.eco,roles:r.roleV2Economy};
}
describe('v2 role economy',()=>{
 it('Grench transfers once, preserves total, records insufficient funds and rejects cross-game users',async()=>{
  const {n,e,roles}=await fixture();
  e.credit(2,200,'TEST',null,'seed');
  expect(roles.grench(n,1,1,2,100)).toBe('PAID');
  expect(roles.grench(n,1,1,2,100)).toBe('PAID');
  expect(e.coins(1)).toBe(100);expect(e.coins(2)).toBe(100);
  expect(roles.grench(n,1,1,2,150)).toBe('CONFLICT');
  expect(roles.grench(n,2,1,2,150)).toBe('INSUFFICIENT');
  expect(roles.grench(n,2,1,4,100)).toBe('CONFLICT');
  expect(roles.grench(n,3,1,4,100)).toBe('UNAVAILABLE');
 });
 it('Grench batch rolls back unavailable member, preserves order, and replays after cleanup',async()=>{
  const {n,e,roles,r}=await fixture();
  e.credit(2,150,'TEST',null,'batch-seed');
  const first={actor:1,target:2,amount:100},wrong={actor:3,target:4,amount:50};
  expect(roles.settleGrenchBatch(n,1,[first,wrong])).toEqual({status:'UNAVAILABLE'});
  expect(e.coins(1)).toBe(0);expect(e.coins(2)).toBe(150);
  const second={actor:3,target:2,amount:100};
  const receipt=roles.settleGrenchBatch(n,1,[first,second]);
  expect(receipt).toEqual({status:'OK',game:n,round:1,entries:[{...first,status:'PAID'},{...second,status:'INSUFFICIENT'}]});
  expect(e.coins(1)).toBe(100);expect(e.coins(2)).toBe(50);expect(e.coins(3)).toBe(0);
  expect(roles.settleGrenchBatch(n,1,[second,first])).toEqual({status:'CONFLICT'});
  r.releaseGame(n,'FINISHED');
  expect(roles.settleGrenchBatch(n,1,[first,second])).toEqual(receipt);
  expect(e.coins(1)).toBe(100);
 });
 it('Klaus pays once, seller half-price purchase and commission atomic',async()=>{
  const {n,e,roles}=await fixture();
  expect(roles.klaus(n,1,1,2,200)).toBe('PAID');
  expect(roles.klaus(n,1,1,2,200)).toBe('PAID');
  expect(e.coins(2)).toBe(200);
  const id=roles.offer(n,1,1,2)!;
  expect(roles.buyOffer(3,id,'SHIELD')).toBe('UNAVAILABLE');
  expect(roles.buyOffer(2,id,'SHIELD')).toBe('PAID');
  expect(roles.buyOffer(2,id,'SHIELD')).toBe('PAID');
  expect(e.coins(2)).toBe(50);expect(e.coins(1)).toBe(15);
  expect(roles.buyOffer(2,id,'FAKE_DOC')).toBe('CONFLICT');
 });
});

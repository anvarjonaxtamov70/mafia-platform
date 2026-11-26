import {describe,it,expect} from 'vitest';
import {v2CreateFixed,seededRng,V2_ROLES} from '@mafia/game-engine';
import {v2RoleLabel,v2PrivateRoleView,v2PrivatePhaseView,v2PublicPhaseView,v2EffectDrafts,decodeV2Button,REFERENCE_ROLES} from '@mafia/bot-core';
describe('native v2 presenter',()=>{
 it('all 27 labels preserve reference order; role assignment and actions private',()=>{
  expect(V2_ROLES.map(v2RoleLabel)).toEqual(REFERENCE_ROLES.map(r=>r.emoji+' '+r.name));
  const s=v2CreateFixed(['1','2','3','4'],['DON','COMMISSAR','DOCTOR','CITIZEN'],'CLASSIC',0,seededRng(1));
  const names={'1':'<Don>','2':'Bob','3':'Doc','4':'Other'};
  expect(v2PrivateRoleView(s,'1',names)?.text).toContain('Don');
  expect(v2PublicPhaseView(s,names).text).not.toContain('Komissar');
  expect(v2PublicPhaseView(s,names).text).toContain('&lt;Don&gt;');
  const v=v2PrivatePhaseView(s,123,'2',names)!;
  expect(v.keyboard?.flat().some(b=>'callback_data'in b&&decodeV2Button(b.callback_data)?.op==='I')).toBe(true);
  expect(v2PrivatePhaseView(s,123,'4',names)).toBeNull();
  expect(decodeV2Button('v2:123:1:C:31')).toBeNull();
 });
 it('private check/witness/role never sent to group',()=>{
  const d=v2EffectDrafts([{kind:'CHECK',recipient:'1',target:'2',role:'DON'},{kind:'ROLE',target:'2',role:'MANYAK'},{kind:'HP',target:'2',hp:83}],-100n,{},1,2);
  expect(d.map(x=>x.chatId)).toEqual([1n,2n,-100n]);
  expect(d[2]?.payload).toMatchObject({kind:'SEND',text:expect.stringContaining('83%')});
 });
});

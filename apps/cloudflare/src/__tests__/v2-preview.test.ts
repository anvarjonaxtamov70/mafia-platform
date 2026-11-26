import {describe,it,expect} from 'vitest';
import {World,privateText,groupText,callback,GROUP} from './harness';
import {encodeV2Button} from '@mafia/bot-core';
describe('owner-only v2 preview in actual RoomCore',()=>{
 it('off by default and ordinary users cannot create previews',async()=>{
  const off=new World();await off.send(privateText(1,'/start'));await off.send(groupText(1,'/game v2classic'));
  expect((await off.loaded(GROUP)).data.game).toBeNull();
  const on=new World({v2Preview:true});await on.send(privateText(2,'/start'));await on.send(groupText(2,'/game v2classic'));
  expect((await on.loaded(GROUP)).data.game).toBeNull();
 });
 it('native callbacks, durable phase progression, no wallet changes and /stop',async()=>{
  const w=new World({v2Preview:true});
  for(const id of [1,2,3,4])await w.send(privateText(id,'/start'));
  await w.send(groupText(1,'/game v2classic'));
  const core=await w.loaded(GROUP);const n=core.data.game!.number;
  for(const id of [2,3,4])await w.send(callback(id,'l:j:'+n,GROUP));
  await w.send(groupText(1,'/startgame'));
  const s=core.data.game!.v2Session!;
  expect(s.state.phase).toBe('NIGHT');
  expect(w.tg.texts(GROUP).join(' ')).toContain('V2 SINOV');
  const don=s.state.players.find(p=>p.role==='DON')!;
  const seat=s.state.players.findIndex(p=>p.role==='CITIZEN')+1;
  const action=encodeV2Button({game:n,seq:1,op:'C',seat});
  await w.send(callback(Number(don.id),action,GROUP));expect(core.data.game!.v2Session!.state.intents).toHaveLength(0);
  await w.send(callback(Number(don.id),action));expect(core.data.game!.v2Session!.state.intents).toHaveLength(1);
  await w.advance(30001);
  expect(core.data.game!.v2Session!.state.phase).toBe('DAWN');
  expect(w.registryCore.eco.coins(Number(don.id))).toBe(0);
  await w.send(groupText(1,'/stop'));
  expect(core.data.game).toBeNull();expect(w.registryCore.activeOf(1)).toBeNull();
 });
});

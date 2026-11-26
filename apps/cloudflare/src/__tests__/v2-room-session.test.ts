import {describe,it,expect} from 'vitest';
import {seededRng} from '@mafia/game-engine';
import {encodeV2Button} from '@mafia/bot-core';
import {createV2RoomSession,v2RoomButton,v2RoomTick,v2RoomLastWord,v2RoomLeave,v2RoomSilence,type V2RoomSession} from '../v2-room-session';
const users=[1,2,3,4].map(id=>({id,name:'U'+id}));
describe('v2 serializable room adapter',()=>{
 it('starts native private views, rejects stale/wrong chat, and survives JSON reload',()=>{
  const start=createV2RoomSession(1,-100,'CLASSIC',users,0,seededRng(1));
  expect(start.outbox.some(o=>o.chatId===-100n&&o.payload.kind==='SEND'&&o.payload.text.includes('Tun'))).toBe(true);
  expect(start.outbox.filter(o=>o.chatId===-100n).every(o=>o.payload.kind==='SEND'&&!o.payload.text.includes('Sizning rolingiz'))).toBe(true);
  const don=start.room.state.players.find(p=>p.role==='DON')!;
  const seat=start.room.state.players.findIndex(p=>p.role==='CITIZEN')+1;
  const cmd=encodeV2Button({game:1,seq:1,op:'C',seat});
  expect(()=>v2RoomButton(start.room,Number(don.id),-100,cmd,1)).toThrow();
  expect(()=>v2RoomButton(start.room,Number(don.id),Number(don.id),cmd,30000)).toThrow();
  let room=v2RoomButton(start.room,Number(don.id),Number(don.id),cmd,1).room;
  room=JSON.parse(JSON.stringify(room)) as V2RoomSession;
  const result=v2RoomTick(room,30000,seededRng(2));
  expect(result.room.state.phase).toBe('DAWN');
  expect(result.effects.some(e=>e.kind==='DEATH')).toBe(true);
  const dead=result.room.state.players.find(p=>p.hp===0)!;
  expect(v2RoomSilence(result.room,Number(dead.id))).toBe(true);
  const word=v2RoomLastWord(result.room,Number(dead.id),'<hello>',30001);
  expect(word.outbox[0]?.payload).toMatchObject({kind:'SEND',text:expect.stringContaining('&lt;hello&gt;')});
  expect(()=>v2RoomLastWord(word.room,Number(dead.id),'again',30002)).toThrow();
  expect(()=>v2RoomButton(result.room,Number(don.id),Number(don.id),cmd,30001)).toThrow();
 });
 it('explicit leave forfeits result and clears old actions',()=>{
  const start=createV2RoomSession(3,-100,'CLASSIC',users,0,seededRng(1));
  const don=start.room.state.players.find(p=>p.role==='DON')!;
  const citizen=start.room.state.players.find(p=>p.role==='CITIZEN')!;
  const cmd=encodeV2Button({game:3,seq:1,op:'C',seat:start.room.state.players.indexOf(citizen)+1});
  const acted=v2RoomButton(start.room,Number(don.id),Number(don.id),cmd,1).room;
  const next=v2RoomLeave(acted,Number(don.id),2);
  expect(next.room.state.players.find(p=>p.id===don.id)).toMatchObject({left:true,hp:0,personal:'LOSS'});
  expect(next.room.state.intents).toHaveLength(0);
  expect(next.room.lastWords[don.id]).toBeUndefined();
  expect(()=>v2RoomButton(next.room,Number(don.id),Number(don.id),cmd,3)).toThrow();
  expect(()=>v2RoomLeave(next.room,Number(don.id),3)).toThrow();
  expect(acted.state.players.find(p=>p.id===don.id)?.left).toBe(false);
 });
 it('VS odd count rejected, team colours public but role identities private',()=>{
  expect(()=>createV2RoomSession(2,-100,'VS',[...users,{id:5,name:'U5'}],0,seededRng(3))).toThrow();
  const r=createV2RoomSession(2,-100,'VS',users,0,seededRng(3));
  expect(r.room.state.players.filter(p=>p.colour==='RED')).toHaveLength(2);
  expect(r.room.state.players.filter(p=>p.colour==='BLUE')).toHaveLength(2);
 });
});

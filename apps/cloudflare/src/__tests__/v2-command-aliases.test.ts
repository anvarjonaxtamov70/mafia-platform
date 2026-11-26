import {describe,it,expect} from 'vitest';
import {World,privateText,groupText,GROUP} from './harness';

describe('Telegram V2 command aliases',()=>{
 for(const mode of ['classic','zombie','hypernova','vs'] as const){
  it('creates '+mode+' with an underscore command',async()=>{
   const w=new World({v2Preview:true});
   await w.send(privateText(1,'/start'));
   await w.send(groupText(1,'/game_v2'+mode+'@test_mafia_bot'));
   expect((await w.loaded(GROUP)).data.game?.v2Mode).toBe(mode.toUpperCase());
  });
 }
 it('keeps legacy /game and space syntax compatible',async()=>{
  const old=new World({v2Preview:true});
  await old.send(privateText(1,'/start'));
  await old.send(groupText(1,'/game'));
  const g=(await old.loaded(GROUP)).data.game;
  expect(g).not.toBeNull();expect(g?.v2Mode).toBeUndefined();
  const preview=new World({v2Preview:true});
  await preview.send(privateText(1,'/start'));
  await preview.send(groupText(1,'/game v2vs'));
  expect((await preview.loaded(GROUP)).data.game?.v2Mode).toBe('VS');
 });
 it('rejects unauthorized, disabled and malformed aliases without creating V1 games',async()=>{
  for(const [enabled,actor,cmd] of [[true,2,'/game_v2vs'],[false,1,'/game_v2vs'],[true,1,'/game_v2vs extra']] as const){
   const w=new World({v2Preview:enabled});
   await w.send(privateText(actor,'/start'));
   await w.send(groupText(actor,cmd));
   expect((await w.loaded(GROUP)).data.game).toBeNull();
   expect(w.tg.texts(GROUP).some(t=>t.includes('V2 sinov rejimi mavjud emas'))).toBe(true);
  }
 });
});

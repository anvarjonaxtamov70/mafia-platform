import { describe, expect, it } from 'vitest';
import { applySettingsOp, normalizeSettings } from '@mafia/bot-core';
import { World, GROUP, callback, groupText, privateText } from './harness';
import { TgError } from '../telegram';

describe('group administration v11', () => {
  it('ordinary member cannot create either mode; promoted admin can create immediately and demoted host cannot control', async () => {
    const w = new World();
    for (const id of [2,3,4,5]) await w.send(privateText(id,'/start'));
    for (const cmd of ['/game','/quick']) {
      await w.send(groupText(2,cmd));
      expect((await w.loaded(GROUP)).data.game).toBeNull();
    }
    w.tg.admins.add(2);
    await w.send(groupText(2,'/game'));
    const core=await w.loaded(GROUP);
    const number=core.data.game!.number;
    const sent=w.tg.sent(GROUP).find(c=>String(c.params['text']).includes('YANGI MAFIA'));
    const markup=sent?.params['reply_markup'] as {inline_keyboard:{callback_data?:string}[][]};
    expect(markup.inline_keyboard.flat().map(b=>b.callback_data).filter(Boolean)).toEqual(['l:j:'+number,'l:c:'+number]);
    for(const id of [3,4,5])await w.send(callback(id,'l:j:'+number,GROUP));
    w.tg.admins.delete(2);
    await w.send(groupText(2,'/gstart'));
    await w.send(callback(2,'l:s:'+number,GROUP));
    await w.send(callback(2,'l:c:'+number,GROUP));
    await w.send(groupText(2,'/cancelgame'));
    expect(core.data.game?.status).toBe('LOBBY');
    expect(core.data.game?.players).toHaveLength(4);
    await w.send(callback(3,'l:l:'+number,GROUP));
    expect(core.data.game?.players).toHaveLength(4);
    w.tg.admins.add(3);
    await w.send(groupText(3,'/gstart'));
    expect(core.data.game?.status).toBe('RUNNING');
  });
  it('fresh admin list fallback fails closed for nonmembers',async()=>{
    const w=new World();
    await w.send(privateText(8,'/start'));
    w.tg.admins.add(8);
    w.tg.failNext=new TgError(400,'getChatMember unavailable');
    await w.send(groupText(8,'/game'));
    expect((await w.loaded(GROUP)).data.game?.status).toBe('LOBBY');
    expect(w.tg.calls.some(c=>c.method==='getChatAdministrators')).toBe(true);
    await w.send(groupText(8,'/cancelgame'));
    w.tg.admins.delete(8);
    w.tg.failNext=new TgError(400,'getChatMember unavailable');
    await w.send(groupText(8,'/game'));
    expect((await w.loaded(GROUP)).data.game).toBeNull();
  });
  it('anonymous same-group admin opens lobby without phantom participant; linked-channel sender cannot control',async()=>{
    const w=new World();
    const message=groupText(1087968824,'/game').message!;
    const anonymous={...message,from:{...message.from!,is_bot:true},sender_chat:message.chat};
    await w.send({message:{...anonymous,sender_chat:{id:GROUP-99,type:'channel',title:'linked'}}});
    expect((await w.loaded(GROUP)).data.game).toBeNull();
    await w.send({message:anonymous});
    const g=(await w.loaded(GROUP)).data.game!;
    expect(g.status).toBe('LOBBY');
    expect(g.players).toHaveLength(0);
    expect(w.registryCore.activeOf(1087968824)).toBeNull();
    for(const id of [2,3,4,5]){
      await w.send(privateText(id,'/start'));
      await w.send(callback(id,'l:j:'+g.number,GROUP));
    }
    await w.advance(200_000);
    expect((await w.loaded(GROUP)).data.game?.status).toBe('RUNNING');
    const admission=w.registryCore.security.begin(999999,GROUP);
    expect(admission).toBe('ALLOW');
    w.registryCore.security.finish(999999,true);
    expect(w.registryCore.security.begin(999999,GROUP)).toBe('DUPLICATE');
  });
  it('old permissive settings cannot re-enable member creation; timer controls stay bounded',()=>{
    const s=normalizeSettings({adminOnlyCreate:false});
    expect(s.adminOnlyCreate).toBe(true);
    expect(applySettingsOp(s,'admin').adminOnlyCreate).toBe(true);
    expect(applySettingsOp(s,'lobby').lobbySec).toBe(240);
    expect(applySettingsOp(s,'verdict').verdictSec).toBe(20);
  });
});

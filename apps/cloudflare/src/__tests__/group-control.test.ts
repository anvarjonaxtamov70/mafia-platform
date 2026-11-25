import { describe, expect, it } from 'vitest';
import { applySettingsOp, normalizeSettings } from '@mafia/bot-core';
import { World, GROUP, callback, groupText, privateText } from './harness';
import { TgError } from '../telegram';

describe('group administration v11', () => {
  it('ordinary member can open; only current admins can start or cancel', async () => {
    const w = new World();
    for (const id of [2,3,4,5]) await w.send(privateText(id,'/start'));
    await w.send(groupText(2,'/game'));
    const core=await w.loaded(GROUP);
    const number=core.data.game!.number;
    const sent=w.tg.sent(GROUP).find(c=>String(c.params['text']).includes('YANGI MAFIA'));
    const markup=sent?.params['reply_markup'] as {inline_keyboard:{callback_data?:string}[][]};
    expect(markup.inline_keyboard.flat().map(b=>b.callback_data).filter(Boolean)).toEqual(['l:j:'+number]);
    expect(markup.inline_keyboard.flat()).toHaveLength(1);
    expect(sent?.params['text']).not.toContain('Rejim:');
    for(const id of [3,4,5])await w.send(callback(id,'l:j:'+number,GROUP));
    await w.send(groupText(2,'/startgame'));
    await w.send(callback(2,'l:s:'+number,GROUP));
    await w.send(callback(2,'l:c:'+number,GROUP));
    await w.send(groupText(2,'/cancelgame'));
    expect(core.data.game?.status).toBe('LOBBY');
    expect(core.data.game?.players).toHaveLength(4);
    await w.send(callback(3,'l:l:'+number,GROUP));
    expect(core.data.game?.players).toHaveLength(4);
    w.tg.admins.add(3);
    await w.send(groupText(3,'/startgame'));
    expect(core.data.game?.status).toBe('RUNNING');
    const messages=w.tg.sent(GROUP).filter(c=>/O‘YIN BOSHLANDI|TUN BOSHLANDI/.test(String(c.params['text'])));
    expect(messages.length).toBeGreaterThan(0);
    for(const msg of messages) expect(JSON.stringify(msg.params['reply_markup'])).toContain('https://t.me/test_mafia_bot');
    w.tg.admins.delete(3);
    await w.send(groupText(3,'/cancelgame'));
    expect(core.data.game?.status).toBe('RUNNING');
  });
  it('fresh admin list fallback fails closed for nonmembers',async()=>{
    const w=new World();
    await w.send(privateText(8,'/start'));
    w.tg.admins.add(8);
    w.tg.failNext=new TgError(400,'getChatMember unavailable');
    await w.send(groupText(8,'/settings'));
    expect(w.tg.texts(GROUP).at(-1)).toContain('O‘YIN SOZLAMALARI');
    expect(w.tg.calls.some(c=>c.method==='getChatAdministrators')).toBe(true);
    w.tg.admins.delete(8);
    w.tg.failNext=new TgError(400,'getChatMember unavailable');
    await w.send(groupText(8,'/settings'));
    expect(w.tg.texts(GROUP).at(-1)).not.toContain('O‘YIN SOZLAMALARI');
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
    expect((await w.loaded(GROUP)).data.game?.status).toBe('LOBBY');
    await w.send({message:{...anonymous,text:'/startgame'}});
    expect((await w.loaded(GROUP)).data.game?.status).toBe('RUNNING');
    const admission=w.registryCore.security.begin(999999,GROUP);
    expect(admission).toBe('ALLOW');
    w.registryCore.security.finish(999999,true);
    expect(w.registryCore.security.begin(999999,GROUP)).toBe('DUPLICATE');
  });
  it('old settings normalize to open creation; timer controls stay bounded',()=>{
    const s=normalizeSettings({adminOnlyCreate:false});
    expect(s.adminOnlyCreate).toBe(false);
    expect(normalizeSettings({adminOnlyCreate:true}).adminOnlyCreate).toBe(false);
    expect(applySettingsOp(s,'admin').adminOnlyCreate).toBe(false);
    expect(applySettingsOp(s,'lobby').lobbySec).toBe(s.lobbySec);
    expect(normalizeSettings({autostart:true}).autostart).toBe(false);
    expect(applySettingsOp({...s,autostart:true},'auto').autostart).toBe(false);
    expect(applySettingsOp(s,'verdict').verdictSec).toBe(20);
  });
});


describe('manual start only',()=>{
  it('rejects old commands and callbacks even for owners; ordinary hosts cannot start; old alarms are disabled',async()=>{
    const w=new World();
    for(const id of [2,3,4,5])await w.send(privateText(id,'/start'));
    await w.send(groupText(2,'/game'));
    const core=await w.loaded(GROUP),n=core.data.game!.number;
    for(const id of [3,4,5])await w.send(callback(id,'l:j:'+n,GROUP));
    expect(core.data.game?.deadline).toBeNull();
    for(const id of [1,2,3]){
      await w.send(groupText(id,'/gstart'));
      await w.send(groupText(id,'/autostart on'));
      await w.send(callback(id,'l:s:'+n,GROUP));
      await w.send(callback(id,'gs:auto:'+GROUP,GROUP));
      expect(core.data.game?.status).toBe('LOBBY');
    }
    expect(await core.start('auto',n)).toMatchObject({ok:false,error:'NO_PERMISSION'});
    expect(await core.start({by:2,isAdmin:false},n)).toMatchObject({ok:false,error:'NO_PERMISSION'});
    const store=w.stores.get(GROUP)!;
    const legacy=store.data!;
    legacy.game!.config.lobby.autostart=true;
    legacy.game!.deadline=w.now+1000;
    await store.save(legacy);
    w.restart(GROUP);
    const restored=await w.loaded(GROUP);
    await w.advance(86_400_000);
    expect(restored.data.game?.status).toBe('LOBBY');
    expect(restored.data.game?.deadline).toBeNull();
    expect(restored.data.game?.config.lobby.autostart).toBe(false);
    await w.send(groupText(2,'/startgame'));
    expect(restored.data.game?.status).toBe('LOBBY');
    await w.send(groupText(1,'/startgame'));
    expect(restored.data.game?.status).toBe('RUNNING');
  });
  it('admin-only start across all modes and roster counts at or below minimum',async()=>{
    for(const mode of ['CLASSIC','ADVANCED','CHAOS','ARCADE','PRIVATE']){
      const w=new World();
      for(const id of [2,3,4,5])await w.send(privateText(id,'/start'));
      await w.send(groupText(2,'/game '+mode));
      const c=await w.loaded(GROUP),n=c.data.game!.number;
      const needed=c.data.game!.config.minPlayers;
      w.tg.admins.add(3);
      for(const id of [1,2,3]){
        await w.send(groupText(id,'/startgame'));
        expect(c.data.game?.status).toBe('LOBBY');
      }
      for(let id=3;id<=needed+1;id++){
        await w.send(privateText(id,'/start'));
        await w.send(callback(id,'l:j:'+n,GROUP));
      }
      await w.send(groupText(2,'/startgame'));
      expect(c.data.game?.status).toBe('LOBBY');
      await w.send(groupText(3,'/startgame'));
      expect(c.data.game?.status).toBe('RUNNING');
    }
  });
  it('first-time join uses the single button to open private bot and does not register before /start',async()=>{
    const w=new World();await w.send(privateText(2,'/start'));
    await w.send(groupText(2,'/game'));
    const g=(await w.loaded(GROUP)).data.game!;
    await w.send(callback(9,'l:j:'+g.number,GROUP));
    expect(g.players.some(p=>p.id===9)).toBe(false);
    expect(w.tg.calls.some(c=>c.method==='answerCallbackQuery'&&String(c.params['url']).includes('start=join_'+g.number))).toBe(true);
    await w.send(privateText(9,'/start join_'+g.number));
    expect(g.players.some(p=>p.id===9)).toBe(true);
  });
});

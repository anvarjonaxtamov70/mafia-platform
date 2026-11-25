import { describe, expect, it } from 'vitest';
import { World, GROUP, groupText, privateText, lobby, callback } from './harness';
import { TgError } from '../telegram';
import { t } from '@mafia/localization';

describe('/stop', () => {
  it('only current admins can stop registration; exact command deleted after response; unrelated group survives', async () => {
    const w = new World();
    const other = GROUP - 1;
    await w.send(privateText(2, '/start'));
    await w.send(privateText(3, '/start'));
    await w.send(groupText(2, '/game'));
    await w.send(groupText(3, '/game', other));
    const room = await w.loaded(GROUP);
    const second = await w.loaded(other);
    const number = room.data.game!.number;
    const otherNumber = second.data.game!.number;
    await w.send(groupText(2, '/stop'));
    expect(room.data.game?.number).toBe(number);
    w.tg.admins.add(4);
    const command = groupText(4, '/stop@Test_Mafia_Bot');
    const before = w.tg.calls.length;
    await w.send(command);
    expect(room.data.game).toBeNull();
    expect(w.registryCore.activeOf(2)).toBeNull();
    expect(second.data.game?.number).toBe(otherNumber);
    expect(w.registryCore.activeOf(3)?.number).toBe(otherNumber);
    const calls = w.tg.calls.slice(before);
    const reply = calls.findIndex(c => c.method === 'sendMessage' && c.params['chat_id'] === GROUP && c.params['text'] === t('lobby.cancelled'));
    expect(reply).toBeGreaterThanOrEqual(0);
    expect(calls.findIndex(c => c.method === 'deleteMessage' && c.params['chat_id'] === GROUP && c.params['message_id'] === command.message!.message_id)).toBeGreaterThan(reply);
    expect(calls.some(c => c.method === 'unpinChatMessage' && c.params['chat_id'] === GROUP)).toBe(true);
    expect(calls.some(c => c.params['chat_id'] === other)).toBe(false);
    await w.send(groupText(4, '/stop'));
    expect(w.tg.texts(GROUP).at(-1)).toBe(t('lobby.not_found'));
  });

  it('superadmin can stop a running match; ordinary or demoted admin cannot; timers and claims are cleared', async () => {
    const w = new World();
    const number = await lobby(w, [2,3,4,5]);
    await w.send(groupText(2, '/startgame'));
    const room = await w.loaded(GROUP);
    expect(room.data.game?.status).toBe('RUNNING');
    w.tg.admins.delete(2);
    await w.send(groupText(2, '/stop'));
    expect(room.data.game?.status).toBe('RUNNING');
    await w.send(privateText(1, '/stop'));
    expect(room.data.game?.status).toBe('RUNNING');
    await w.send(groupText(1, '/stop@another_bot'));
    expect(room.data.game?.status).toBe('RUNNING');
    expect(await room.cancel({by:2,isAdmin:false},undefined,number)).toMatchObject({ok:false,error:'NO_PERMISSION'});
    await w.send(groupText(1, '/stop'));
    expect(room.data.game).toBeNull();
    expect(w.tg.texts(GROUP).at(-1)).toBe(t('game.cancelled_admin'));
    for (const id of [2,3,4,5]) expect(w.registryCore.activeOf(id)).toBeNull();
    const before = w.tg.sent(GROUP).length;
    w.restart(GROUP);
    await w.advance(86_400_000);
    expect((await w.loaded(GROUP)).data.game).toBeNull();
    expect(w.tg.sent(GROUP)).toHaveLength(before);
    await w.send(groupText(2,'/game'));
    const next=(await w.loaded(GROUP)).data.game!;
    expect(next.number).not.toBe(number);
    await w.send(callback(3,'l:j:'+number,GROUP));
    expect(next.players.some(p=>p.id===3)).toBe(false);
  });

  it('anonymous same-group administrator can stop; linked-channel sender and failed admin lookup cannot', async () => {
    const w = new World();
    await lobby(w,[1,2]);
    const room=await w.loaded(GROUP);
    const update=groupText(1087968824,'/stop');
    const msg=update.message!;
    const anonymous={...msg,from:{...msg.from!,is_bot:true},sender_chat:msg.chat};
    await w.send({message:{...anonymous,sender_chat:{id:GROUP-1,type:'channel',title:'linked'}}});
    expect(room.data.game?.status).toBe('LOBBY');
    const original=w.tg.call.bind(w.tg);
    w.tg.call=async <T=unknown>(method:string,params:Record<string,unknown>={})=>{
      if(method==='getChatMember'||method==='getChatAdministrators')throw new TgError(403,'unavailable');
      return original<T>(method,params);
    };
    await w.send(groupText(2,'/stop'));
    expect(room.data.game?.status).toBe('LOBBY');
    await w.send({message:anonymous});
    expect(room.data.game).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { World, GROUP, groupText, privateText, lobby } from './harness';
import { TgError } from '../telegram';

const lastIndex=<T>(items:T[],predicate:(v:T)=>boolean)=>items.map(predicate).lastIndexOf(true);
const deletion=(w:World,id:number)=>w.tg.calls.findIndex(c=>c.method==='deleteMessage'&&c.params['chat_id']===GROUP&&c.params['message_id']===id);
describe('group command cleanup',()=>{
  it('member, admin, owner and anonymous admin: direct reply precedes exact command deletion',async()=>{
    const w=new World();w.tg.admins.add(3);
    for(const id of [1,2,3,4]){
      const u=groupText(id,id===2?'/startgame@TEST_MAFIA_BOT':id===4?'/settings':'/status');
      if(id===4)u.message={...u.message!,from:{...u.message!.from!,is_bot:true},sender_chat:u.message!.chat};
      const before=w.tg.calls.length;
      await w.send(u);
      const reply=w.tg.calls.findIndex((c,i)=>i>=before&&c.method==='sendMessage'&&c.params['chat_id']===GROUP);
      expect(reply).toBeGreaterThanOrEqual(before);
      expect(deletion(w,u.message!.message_id)).toBeGreaterThan(reply);
      expect(w.tg.calls[reply]?.params['reply_parameters']).toBeUndefined();
    }
  });
  it('unrelated messages, unknown commands, other bots and private commands untouched',async()=>{
    const w=new World();
    for(const u of [groupText(2,'hello'),groupText(2,'/not_a_command'),groupText(2,'/game@another_bot'),privateText(2,'/start')]){
      await w.send(u);
      expect(w.tg.calls.some(c=>c.method==='deleteMessage'&&c.params['chat_id']===u.message!.chat.id&&c.params['message_id']===u.message!.message_id)).toBe(false);
    }
    expect((await w.loaded(GROUP)).data.game).toBeNull();
  });
  it('queued create and coalesced repost commands remain until their board is sent',async()=>{
    const w=new World();await w.send(privateText(2,'/start'));
    const open=groupText(2,'/game');
    await w.send(open);
    const first=w.tg.calls.findIndex(c=>c.method==='sendMessage'&&c.params['chat_id']===GROUP&&String(c.params['text']).includes('YANGI MAFIA'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(deletion(w,open.message!.message_id)).toBeGreaterThan(first);
    const a=groupText(3,'/game'),b=groupText(4,'/game');
    await w.send(a);await w.send(b);
    expect(deletion(w,a.message!.message_id)).toBe(-1);
    expect(deletion(w,b.message!.message_id)).toBe(-1);
    w.restart(GROUP);await w.advance(2000);
    const last=lastIndex(w.tg.calls, c=>c.method==='sendMessage'&&c.params['chat_id']===GROUP&&String(c.params['text']).includes('YANGI MAFIA'));
    expect(last).toBeGreaterThan(first);
    expect(deletion(w,a.message!.message_id)).toBeGreaterThan(last);
    expect(deletion(w,b.message!.message_id)).toBeGreaterThan(last);
  });
  it('join, start and cancel clean up their own commands, after group output',async()=>{
    const w=new World();await lobby(w,[1,2,3]);
    await w.send(privateText(4,'/start'));
    const join=groupText(4,'/join');await w.send(join);
    const edit=lastIndex(w.tg.calls, c=>c.method==='editMessageText'&&c.params['chat_id']===GROUP);
    expect(deletion(w,join.message!.message_id)).toBeGreaterThan(edit);
    const start=groupText(1,'/startgame');await w.send(start);
    expect((await w.loaded(GROUP)).data.game?.status).toBe('RUNNING');
    const sent=w.tg.calls.findIndex(c=>c.method==='sendMessage'&&c.params['chat_id']===GROUP&&/O‘YIN BOSHLANDI|TUN BOSHLANDI/.test(String(c.params['text'])));
    expect(sent).toBeGreaterThanOrEqual(0);
    expect(deletion(w,start.message!.message_id)).toBeGreaterThan(sent);
    const beforeCancel=w.tg.calls.length;
    const cancel=groupText(1,'/cancelgame');await w.send(cancel);
    expect((await w.loaded(GROUP)).data.game?.status).toBeNull();
    const cancelReply=w.tg.calls.findIndex((c,i)=>i>=beforeCancel&&c.method==='sendMessage'&&c.params['chat_id']===GROUP&&String(c.params['text']).includes('administrator tomonidan bekor qilindi'));
    expect(cancelReply).toBeGreaterThanOrEqual(beforeCancel);
    expect(deletion(w,cancel.message!.message_id)).toBeGreaterThan(cancelReply);
    expect(w.tg.calls.filter(c=>c.method==='deleteMessage'&&c.params['chat_id']===GROUP&&c.params['message_id']===cancel.message!.message_id)).toHaveLength(1);
  });
  it('night and dead moderation preserve response ordering, while ordinary chat stays moderated',async()=>{
    const w=new World();await lobby(w,[1,2,3,4]);await w.send(groupText(1,'/startgame'));
    const g=(await w.loaded(GROUP)).data.game!;
    expect(g.state?.phase).toBe('NIGHT');
    g.silenceNight=true;g.silenceDead=true;
    const check=async(id:number)=>{
      const before=w.tg.calls.length;
      const cmd=groupText(id,'/status');await w.send(cmd);
      const reply=w.tg.calls.findIndex((c,i)=>i>=before&&c.method==='sendMessage'&&c.params['chat_id']===GROUP);
      expect(reply).toBeGreaterThanOrEqual(before);
      expect(deletion(w,cmd.message!.message_id)).toBeGreaterThan(reply);
      expect(w.tg.calls.filter(c=>c.method==='deleteMessage'&&c.params['chat_id']===GROUP&&c.params['message_id']===cmd.message!.message_id)).toHaveLength(1);
    };
    await check(2);
    const normal=groupText(2,'night chat');await w.send(normal);expect(deletion(w,normal.message!.message_id)).toBeGreaterThanOrEqual(0);
    const unknown=groupText(2,'/unknown_command');await w.send(unknown);expect(deletion(w,unknown.message!.message_id)).toBeGreaterThanOrEqual(0);
    g.state!.phase='DAY_DISCUSSION';
    g.state!.players.find(p=>p.id==='3')!.status='DEAD';
    await check(3);
    const dead=groupText(3,'dead chat');await w.send(dead);expect(deletion(w,dead.message!.message_id)).toBeGreaterThanOrEqual(0);
    const original=w.tg.call.bind(w.tg);
    w.tg.call=async <T=unknown>(method:string,params:Record<string,unknown>={})=>{
      if(method==='sendMessage'&&params['chat_id']===GROUP)throw new TgError(403,'cannot send');
      return original<T>(method,params);
    };
    const failed=groupText(3,'/status');await w.send(failed);expect(deletion(w,failed.message!.message_id)).toBe(-1);
  });
  it('no deletion on failed response; 429 deletion retries, 403 does not break game',async()=>{
    const w=new World();const original=w.tg.call.bind(w.tg);
    let failSend=true,deleteMode=0;
    w.tg.call=async <T=unknown>(method:string,params:Record<string,unknown>={})=>{
      if(method==='sendMessage'&&params['chat_id']===GROUP&&failSend)throw new TgError(403,'cannot send');
      if(method==='deleteMessage'&&deleteMode===1){deleteMode=0;throw new TgError(429,'retry later',2);}
      if(method==='deleteMessage'&&deleteMode===2)throw new TgError(403,'no delete rights');
      return original<T>(method,params);
    };
    const failed=groupText(2,'/status');await w.send(failed);expect(deletion(w,failed.message!.message_id)).toBe(-1);
    failSend=false;deleteMode=1;
    const retry=groupText(2,'/status');await w.send(retry);expect(deletion(w,retry.message!.message_id)).toBe(-1);
    w.restart(GROUP);await w.advance(2000);expect(deletion(w,retry.message!.message_id)).toBeGreaterThanOrEqual(0);
    deleteMode=2;
    await lobby(w,[1,2,3,4]);await w.send(groupText(1,'/startgame'));
    expect((await w.loaded(GROUP)).data.game?.status).toBe('RUNNING');
  });
});

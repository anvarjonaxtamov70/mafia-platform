import {describe,expect,it} from 'vitest';
import {World,GROUP,privateText,groupText,callback,lobby,playToEnd} from './harness';
import {TgError} from '../telegram';
const OTHER=GROUP-1, THIRD=GROUP-2;
async function open(w:World,chat:number,id:number){
  await w.send(privateText(id,'/start'));await w.send(groupText(id,'/game',chat));
  return (await w.loaded(chat)).data.game!;
}
const board=(w:World,chat=GROUP)=>w.tg.sent(chat).filter(c=>String(c.params['text']).includes('YANGI MAFIA'));
const pins=(w:World,method='pinChatMessage')=>w.tg.calls.filter(c=>c.method===method);
describe('lobby v12',()=>{
  it('refresh same game without altering timer, host, mode or participant list; pin new and retire old',async()=>{
    const w=new World();const n=await lobby(w,[1,2,3,4]);const core=await w.loaded(GROUP);
    const deadline=core.data.game!.deadline;
    const old=core.data.refs['lobby:'+core.data.game!.id]!.messageId;
    expect(pins(w).at(-1)?.params['message_id']).toBe(old);
    await w.send(groupText(5,'/game ARCADE'));await w.advance(2000);
    expect(core.data.game).toMatchObject({number:n,deadline,hostId:1,mode:'CLASSIC'});
    expect(core.data.game!.players.map(p=>p.id)).toEqual([1,2,3,4]);
    expect(board(w)).toHaveLength(2);
    const msg=board(w).at(-1)!;expect(msg.params['text']).toContain('4/30');
    expect(JSON.stringify(msg.params['reply_markup'])).toContain('l:j:'+n);
    const fresh=core.data.refs['lobby:'+core.data.game!.id]!.messageId;
    expect(fresh).not.toBe(old);
    expect(pins(w,'unpinChatMessage').some(c=>c.params['message_id']===old)).toBe(true);
    expect(pins(w).at(-1)?.params['message_id']).toBe(fresh);
    await w.send(groupText(1,'/startgame'));
    expect(pins(w,'unpinChatMessage').some(c=>c.params['message_id']===fresh)).toBe(true);
    expect(w.tg.calls.some(c=>c.method==='unpinAllChatMessages')).toBe(false);
    expect(core.data.game?.status).toBe('RUNNING');
    await w.send(groupText(2,'/game'));
    expect(board(w)).toHaveLength(2);
  });
  it('automatic transfer before start; no transfer or leave after start; unlock only on finish',async()=>{
    const w=new World();const n=await lobby(w,[1,2,3,4,5]);const b=await open(w,OTHER,50);
    await w.send(callback(2,'l:j:'+b.number,OTHER));
    expect(w.registryCore.activeOf(2)?.number).toBe(b.number);
    expect((await w.loaded(GROUP)).data.game!.players.some(p=>p.id===2)).toBe(false);
    await w.send(callback(2,'l:j:'+n,GROUP));
    expect(w.registryCore.activeOf(2)?.number).toBe(n);
    await w.send(groupText(1,'/startgame'));
    await w.send(groupText(2,'/leave'));
    await w.send(callback(2,'l:j:'+b.number,OTHER));
    expect(w.registryCore.activeOf(2)?.number).toBe(n);
    expect((await w.loaded(OTHER)).data.game!.players.some(p=>p.id===2)).toBe(false);
    await playToEnd(w,n);await w.runAlarms();
    expect(w.registryCore.activeOf(2)).toBeNull();
    // The other lobby may expire while the first game plays; reopen if needed.
    const next=(await w.loaded(OTHER)).data.game??await open(w,OTHER,50);
    await w.send(callback(2,'l:j:'+next.number,OTHER));
    expect(w.registryCore.activeOf(2)?.number).toBe(next.number);
  });
  it('concurrent transfers keep one claim, stale target does not release source',async()=>{
    const w=new World();await lobby(w,[1,2,3,4]);const a=await open(w,OTHER,50),b=await open(w,THIRD,60);
    const original=w.registryCore.activeOf(2)!;
    await w.send(callback(2,'l:j:'+(a.number+9999),OTHER));
    expect(w.registryCore.activeOf(2)).toEqual(original);
    await Promise.all([w.router.handle({update_id:101,...callback(2,'l:j:'+a.number,OTHER)}),w.router.handle({update_id:102,...callback(2,'l:j:'+b.number,THIRD)})]);
    await w.runAlarms();
    const rooms=await Promise.all([GROUP,OTHER,THIRD].map(c=>w.loaded(c)));
    expect(rooms.filter(c=>c.data.game?.players.some(p=>p.id===2))).toHaveLength(1);
    const active=w.registryCore.activeOf(2)!;
    expect(rooms.find(c=>c.data.game?.number===active.number)?.data.game?.players.some(p=>p.id===2)).toBe(true);
  });
  it('cancel unpins only the lobby; restart and time passage leave it pinned',async()=>{
    const w=new World();await lobby(w,[1,2]);const core=await w.loaded(GROUP);
    const id=core.data.refs['lobby:'+core.data.game!.id]!.messageId;
    w.restart(GROUP);await w.advance(200_000);
    expect((await w.loaded(GROUP)).data.game?.status).toBe('LOBBY');
    expect(pins(w,'unpinChatMessage').some(c=>c.params['message_id']===id)).toBe(false);
    await w.send(groupText(1,'/cancelgame'));
    expect((await w.loaded(GROUP)).data.game).toBeNull();
    expect(pins(w,'unpinChatMessage').at(-1)?.params['message_id']).toBe(id);
    const g=await open(w,GROUP,1);
    const id2=(await w.loaded(GROUP)).data.refs['lobby:'+g.id]!.messageId;
    await w.send(groupText(1,'/cancelgame'));
    expect(pins(w,'unpinChatMessage').at(-1)?.params['message_id']).toBe(id2);
    expect(w.tg.calls.every(c=>c.method!=='unpinAllChatMessages')).toBe(true);
  });
  it('pin permission failure does not prevent registration or game start',async()=>{
    const w=new World();const original=w.tg.call.bind(w.tg);
    w.tg.call=async <T=unknown>(method:string,params:Record<string,unknown>={})=>{
      if(method==='pinChatMessage'||method==='unpinChatMessage')throw new TgError(403,'not enough rights');
      return original<T>(method,params);
    };
    await lobby(w,[1,2,3,4]);await w.send(groupText(1,'/startgame'));
    expect((await w.loaded(GROUP)).data.game?.status).toBe('RUNNING');
    expect(w.tg.texts(2).some(t=>t.includes('SIZNING ROLINGIZ'))).toBe(true);
  });
  it('registry outage fails closed; delayed release cannot erase a later claim',async()=>{
    const w=new World();const n=await lobby(w,[1,2,3,4]);const other=await open(w,OTHER,50);
    const release=w.registryCore.release.bind(w.registryCore);let fail=true;
    w.registryCore.release=(id,num)=>{if(fail)throw Error('outage');release(id,num);};
    await w.send(callback(2,'l:j:'+other.number,OTHER));
    expect(w.registryCore.activeOf(2)?.number).toBe(n);
    expect((await w.loaded(OTHER)).data.game!.players.some(p=>p.id===2)).toBe(false);
    await w.send(callback(2,'l:j:'+n,GROUP));
    expect((await w.loaded(GROUP)).data.game!.players.some(p=>p.id===2)).toBe(false);
    fail=false;w.restart(GROUP);await w.advance(3000);
    await w.send(callback(2,'l:j:'+other.number,OTHER));
    expect(w.registryCore.activeOf(2)?.number).toBe(other.number);
  });
});

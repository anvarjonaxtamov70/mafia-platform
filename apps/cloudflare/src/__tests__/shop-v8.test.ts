import { describe, expect, it } from 'vitest';
import { World, callback, privateText, GROUP } from './harness';
import { DAY_MS } from '@mafia/bot-core';
import { createGame, advancePhase, seededRng, type GameState } from '@mafia/game-engine';

describe('v8 shop', () => {
  it('diamond purchase is atomic, idempotent and owner allowance is not minted', async () => {
    const w = new World({ ownerBenefits: true });
    w.admins.add(6);
    const e = w.registryCore.eco;
    expect(e.buy(2, 'VOTE_SHIELD', 'a')).toMatchObject({ ok: false, error: 'INSUFFICIENT' });
    e.creditDiamonds(2, 3, 'TEST', 'seed');
    expect(e.buy(2, 'VOTE_SHIELD', 'a')).toMatchObject({ ok: true, balance: 2 });
    expect(e.buy(2, 'VOTE_SHIELD', 'a')).toMatchObject({ ok: true, balance: 2 });
    expect(e.buy(3, 'VOTE_SHIELD', 'a').ok).toBe(false);
    expect(e.inventory(2).items.find(i => i.code === 'VOTE_SHIELD')?.qty).toBe(1);
    expect(e.coins(2)).toBe(0);
    for (const id of [1,6]) {
      expect(e.buy(id, 'VOTE_SHIELD', 'owner' + id)).toMatchObject({ ok: true, balance: 1_000_000_000 });
      expect(e.diamonds(id)).toBe(0);
    }
    expect(e.buy(2, 'KNIFE', 'no').ok).toBe(false);
    expect(e.buy(2, 'HERO_SHIELD', 'no2')).toMatchObject({ok:true,balance:0});
    expect(e.toggleArm(2, 'VOTE_SHIELD')).toBe(true);
    expect(e.reserveArcade(7,[2])['2']?.voteShield).toBe(true);
    expect(e.reserveArcade(7,[2])['2']?.voteShield).toBe(true);
    e.releaseArcade(7);
    expect(e.inventory(2).items.find(i=>i.code==='VOTE_SHIELD')?.qty).toBe(1);
    e.reserveArcade(8,[2]); e.settleArcade(8,{'2':['VOTE_SHIELD']}); e.settleArcade(8,{});
    expect(e.inventory(2).items.find(i=>i.code==='VOTE_SHIELD')?.qty).toBe(0);
  });
  it('VIP costs 30 diamonds, extends once, preserves real Stars payment ledger', () => {
    const w = new World({ownerBenefits:true});
    const e = w.registryCore.eco;
    e.creditDiamonds(2,60,'TEST','vipseed');
    expect(e.buyDiamondVip(2,'one').ok).toBe(true);
    expect(e.tierInfo(2).vipUntil).toBe(w.now+30*DAY_MS);
    expect(e.buyDiamondVip(2,'one').ok).toBe(true);
    expect(e.diamonds(2)).toBe(30);
    expect(e.buyDiamondVip(2,'two').ok).toBe(true);
    expect(e.tierInfo(2).vipUntil).toBe(w.now+60*DAY_MS);
    expect(e.buyDiamondVip(2,'three').ok).toBe(false);
    expect(e.diamonds(2)).toBe(0);
    expect(e.buyDiamondVip(1,'owner').ok).toBe(true);
    expect(e.wallet(1).tier).toBe('VIP_PRO');
    expect(e.diamonds(1)).toBe(0);
  });
  it('private shop and currency labels; group purchase rejected', async () => {
    const w = new World();
    await w.send(privateText(2,'/start'));
    const e=w.registryCore.eco;
    e.creditDiamonds(2,31,'TEST','ui');
    await w.send(callback(2,'e:buy:VOTE_SHIELD'));
    expect(String(w.tg.calls.filter(c=>c.method==='editMessageText').at(-1)?.params['text'])).toContain('1 💎');
    await w.send(callback(2,'e:buyok:VOTE_SHIELD',GROUP));
    expect(e.diamonds(2)).toBe(31);
    await w.send(callback(2,'e:buyok:VOTE_SHIELD'));
    expect(e.diamonds(2)).toBe(30);
    await w.send(callback(2,'e:vipdia:'));
    await w.send(callback(2,'e:vipdiok:'));
    expect(e.diamonds(2)).toBe(0);
    expect(e.wallet(2).tier).toBe('VIP');
  });
});

function voting(mode: 'ARCADE' | 'CLASSIC'): GameState {
  const g=createGame({id:'vote-shield',mode,players:['1','2','3','4'].map(id=>({id,name:id})),fixedRoles:['DON','COMMISSAR','DOCTOR','CITIZEN'],now:1,rng:seededRng(1),items:{'1':{voteShield:true}}});
  if(!g.ok) throw Error(g.error);
  const s=g.state;
  s.phase='DAY_VOTING';s.dayNumber=1;
  s.day={votes:{'1':'NONE','2':'1','3':'1','4':'1'},candidateId:null};
  return s;
}
describe('v8 vote shield engine',()=>{
  it('blocks one execution, not the second, and never applies in Classic',()=>{
    const s=voting('ARCADE');
    const first=advancePhase(s,(s.phaseEndsAt??0)+1,seededRng(2),s.phaseSeq);
    if(!first.ok) throw Error(first.error);
    expect(first.events.some(e=>e.type==='VOTE_PROTECTED')).toBe(true);
    expect(first.state.players[0]?.status).toBe('ALIVE');
    expect(first.state.players[0]?.items.voteShield).toBe(false);
    expect(s.players[0]?.items.voteShield).toBe(true);
    const next=first.state;
    next.phase='DAY_VOTING';next.day={votes:{'1':'NONE','2':'1','3':'1','4':'1'},candidateId:null};
    const second=advancePhase(next,(next.phaseEndsAt??0)+1,seededRng(2),next.phaseSeq);
    if(!second.ok) throw Error(second.error);
    expect(second.state.players[0]?.status).toBe('DEAD');
    const classic=voting('CLASSIC');
    expect(classic.players[0]?.items.voteShield).toBeUndefined();
    const normal=advancePhase(classic,(classic.phaseEndsAt??0)+1,seededRng(2),classic.phaseSeq);
    if(!normal.ok) throw Error(normal.error);
    expect(normal.state.players[0]?.status).toBe('DEAD');
  });
});

import { describe, expect, it } from 'vitest';
import { ALL_ROLES, type PlayerOutcome } from '@mafia/game-engine';
import { matchReward, type MatchRewardContext, type MatchRewardPlayer } from '../match-rewards';
import { World, privateText, groupText, GROUP } from './harness';
import type { RecordPlayer } from '../registry-core';
const peak: MatchRewardContext = { playerCount: 30, days: 8, durationMs: 30 * 60_000, activeRatio: 1, ranked: true, practice: false };
const city: MatchRewardPlayer = { role: 'CITIZEN', faction: 'CITY', outcome: 'WIN', active: true, left: false, fake: false };
describe('V7 reward matrix', () => {
  it('exact maxima and nonparticipation', () => {
    expect(matchReward(peak, city)).toEqual({ points: 120, dollars: 66 });
    expect(matchReward(peak, { ...city, role: 'DON', faction: 'MAFIA' })).toEqual({ points: 120, dollars: 66 });
    expect(matchReward(peak, { ...city, role: 'SERIAL_KILLER', faction: 'NEUTRAL' })).toEqual({ points: 150, dollars: 66 });
    expect(matchReward(peak, { ...city, role: 'JESTER', faction: 'NEUTRAL', outcome: 'PERSONAL_WIN' })).toEqual({ points: 70, dollars: 66 });
    expect(matchReward(peak, { ...city, outcome: 'LOSS' }).dollars).toBe(33);
    expect(matchReward(peak, { ...city, afk: true })).toEqual({ points: -8, dollars: 0 });
    expect(matchReward(peak, { ...city, left: true })).toEqual({ points: -8, dollars: 0 });
    expect(matchReward({ ...peak, practice: true }, city)).toEqual({ points: 0, dollars: 0 });
    expect(matchReward({ ...peak, ranked: false }, city)).toEqual({ points: 0, dollars: 0 });
    expect(matchReward(peak, { ...city, fake: true })).toEqual({ points: 0, dollars: 0 });
  });
  it('all 30 role codes, 27 sizes, outcomes, depth, activity and AFK combinations stay bounded', () => {
    for (const role of ALL_ROLES) for (let n = 4; n <= 30; n++) for (const outcome of ['WIN','LOSS','DRAW','PERSONAL_WIN'] as PlayerOutcome[]) for (const days of [1,4,8,20]) for (const durationMs of [0, 600_000, 1_800_000, 7_200_000]) for (const activeRatio of [0,.5,1]) for (const active of [true,false]) for (const afk of [true,false]) {
      const p = { ...city, role: role.code, faction: role.faction, outcome, active, afk };
      const a = matchReward({ ...peak, playerCount: n, days, durationMs, activeRatio }, p);
      const cap = outcome === 'LOSS' ? 33 : outcome === 'DRAW' ? 16 : 66;
      if (!Number.isInteger(a.points) || a.points < -8 || a.points > 150 || !Number.isInteger(a.dollars) || a.dollars < 0 || a.dollars > cap) throw new Error(JSON.stringify({p,a,n,days,durationMs,activeRatio}));
      if (afk && (a.points !== -8 || a.dollars !== 0)) throw new Error('AFK');
    }
  });
  it('larger, deeper, more active wins cannot lower rewards', () => {
    const small = { ...peak, playerCount: 4, days: 1, durationMs: 10_000, activeRatio: .5 };
    expect(matchReward(peak, city).points).toBeGreaterThan(matchReward(small, city).points);
    expect(matchReward({ ...small, durationMs: 30 * 60_000 }, city)).toEqual(matchReward(small, city));
    expect(matchReward(peak, { ...city, active: false, missed: 2 }).points).toBeLessThan(120);
  });
});

describe('V7 ledger and TOP', () => {
  it('scope, rolling periods, owner gate, duplicate prevention, balances and escaped names', async () => {
    const w = new World({ ownerBenefits: true });
    w.admins.add(6);
    for (const id of [1,2,3,4,5,6]) await w.send(privateText(id, '/start'));
    w.registryCore.upsertUser({id: 2, first_name: '<A>'}, true);
    const rec = (chatId: number, ids: number[], outcome: PlayerOutcome = 'WIN') => {
      const number = w.registryCore.allocateGame(chatId);
      const players: RecordPlayer[] = ids.map((tgId) => ({tgId, name:'U'+tgId, role:'CITIZEN', faction:'CITY', outcome, survived:true, left:false, active:true, fake:false}));
      const input = {gameId:'v7-'+number, number, chatId, ranked:true, outcome:'CITY' as const, days:8, durationMs: 1_800_000, completedAt:w.now, rewardVersion:1 as const, players};
      const result = w.registryCore.recordGame(input);
      expect(w.registryCore.recordGame(input).players).toHaveLength(0);
      return result;
    };
    const a = rec(GROUP,[1,2,3,4]);
    const pts = a.players.find(p=>p.tgId===2)!.points!;
    expect(w.registryCore.points(2)).toBe(pts);
    expect(w.registryCore.eco.coins(2)).toBe(a.players.find(p=>p.tgId===2)!.coins);
    rec(GROUP-1,[1,3,5,6]);
    expect(w.registryCore.pointsTop(GROUP,0,1)).not.toContain('U5');
    expect(w.registryCore.pointsTop(GROUP,0,1)).toContain('&lt;A&gt;');
    expect(w.registryCore.pointsTop(null,0,1)).toContain('U5');
    expect(w.registryCore.pointsTop(null,0,2)).not.toContain('U5');
    w.now += 2*86_400_000;
    expect(w.registryCore.pointsTop(GROUP,1,1)).not.toContain('&lt;A&gt;');
    expect(w.registryCore.pointsTop(GROUP,7,1)).toContain('&lt;A&gt;');
    w.now += 8*86_400_000;
    expect(w.registryCore.pointsTop(GROUP,7,1)).not.toContain('&lt;A&gt;');
    expect(w.registryCore.pointsTop(GROUP,30,1)).toContain('&lt;A&gt;');
    w.now += 31*86_400_000;
    expect(w.registryCore.pointsTop(GROUP,30,1)).not.toContain('&lt;A&gt;');
    expect(w.registryCore.pointsTop(GROUP,0,1)).toContain('&lt;A&gt;');
    await w.send(groupText(1,'/top'));
    expect(w.tg.texts(GROUP).at(-1)).toContain('Guruh TOP 20');
    await w.send(groupText(6,'/fulltop'));
    expect(w.tg.texts(GROUP).at(-1)).toContain('Umumiy TOP 20');
    await w.send(groupText(2,'/fulltop'));
    expect(w.tg.texts(GROUP).at(-1)).not.toContain('Umumiy TOP 20');
    expect(w.registryCore.eco.wallet(6).diamonds).toBe(1_000_000_000);
    expect(w.registryCore.eco.wallet(2).diamonds).toBe(0);
    const eco = w.registryCore.eco;
    expect(eco.creditDiamonds(2, 5, 'test', 'd1').balance).toBe(5);
    expect(eco.creditDiamonds(2, 5, 'test', 'd1').duplicate).toBe(true);
    expect(()=>eco.creditDiamonds(2,-6,'test','d2')).toThrow();
    expect(()=>eco.creditDiamonds(3,5,'test','d1')).toThrow();
    expect(eco.diamonds(2)).toBe(5);
  });
});


describe('TOP 20 limits and authorization', () => {
  it('lists only the twenty highest scores with stable ties, all seven commands and no unauthorized global access', async () => {
    const w = new World({ ownerBenefits: true });
    w.admins.add(6);
    w.tg.admins.add(2);
    const ids = Array.from({length:25},(_,i)=>100+i);
    for (const id of [...ids,1,2,6,9]) w.registryCore.upsertUser({id,first_name:'Player'+id},true);
    const number = w.registryCore.allocateGame(GROUP);
    const players: RecordPlayer[] = ids.map(tgId=>({tgId,name:'Player'+tgId,role:'CITIZEN',faction:'CITY',outcome:'WIN',survived:true,left:false,active:true,fake:false}));
    w.registryCore.recordGame({gameId:'twenty',number,chatId:GROUP,ranked:true,outcome:'CITY',days:8,durationMs:1_800_000,completedAt:w.now,rewardVersion:1,players});
    const text = w.registryCore.pointsTop(GROUP,0,2);
    expect(text.split('\n').filter(x=>/^\d+\. /.test(x))).toHaveLength(20);
    expect(text).toContain('Player119');
    expect(text).not.toContain('Player120');
    for (const cmd of ['/top','/top1','/top7','/top30']) {
      await w.send(groupText(2,cmd));
      expect(w.tg.texts(GROUP).at(-1)).toContain('Guruh TOP 20');
    }
    for (const cmd of ['/fulltop','/fulltop7','/fulltop30']) {
      await w.send(groupText(6,cmd));
      expect(w.tg.texts(GROUP).at(-1)).toContain('Umumiy TOP 20');
      await w.send(groupText(2,cmd));
      expect(w.tg.texts(GROUP).at(-1)).not.toContain('Umumiy TOP 20');
    }
    await w.send(groupText(9,'/top'));
    expect(w.tg.texts(GROUP).at(-1)).toContain('administratorlari');
  });
});

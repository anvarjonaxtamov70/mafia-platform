import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@mafia/game-engine';
import { Sweeper } from '../infra/timers';
import { makeServices, CHAT_ID, lobbyWithPlayers, resetDb, silentLogger, stateOf, testDb, tgUser, type TestServices } from './test-utils';

const db = testDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDb(db);
});

async function telegramIdOf(s: TestServices, userId: string): Promise<bigint> {
  const u = await s.db.user.findUniqueOrThrow({ where: { id: userId } });
  return u.telegramId;
}

/** Shahar uchun "aqlli" o'yin: Mafia hujum qilmaydi, kunduz hamma Mafiaga ovoz beradi. */
async function playUntilEnd(s: TestServices, gameId: string, number: number): Promise<GameState> {
  for (let step = 0; step < 100; step++) {
    const state = await stateOf(s.db, gameId);
    if (state.status === 'FINISHED') return state;
    const alive = state.players.filter((p) => p.status === 'ALIVE');
    if (state.phase === 'NIGHT') {
      for (const p of alive) {
        const tg = await telegramIdOf(s, p.id);
        if (p.faction === 'MAFIA') await s.games.mafiaVote(number, tg, 0, state.phaseSeq);
        await s.games.skip(number, tg, state.phaseSeq);
      }
    } else if (state.phase === 'DAY_VOTING') {
      const mafia = alive.find((p) => p.faction === 'MAFIA')!;
      for (const p of alive) {
        if (p.id === mafia.id) continue;
        await s.games.dayVote(number, await telegramIdOf(s, p.id), mafia.seat, state.phaseSeq);
      }
    }
    const after = await stateOf(s.db, gameId);
    if (after.phaseSeq === state.phaseSeq && after.status === 'RUNNING') {
      s.clock.now = (after.phaseEndsAt ?? s.clock.now) + 2000;
      await s.games.onPhaseTimer(gameId, after.phaseSeq);
    }
  }
  throw new Error('game did not finish');
}

describe('Lobby (§3.4–3.5)', () => {
  it('lobby yaratiladi, outbox ga lobby xabari yoziladi, taymer rejalashtiriladi', async () => {
    const s = makeServices(db);
    await s.users.upsert(tgUser(1), { dmOpened: true });
    const r = await s.lobby.createLobby({ chatId: CHAT_ID, title: 'G', host: tgUser(1), isAdmin: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hostJoined).toBe(true);
    const out = await db.outboxMessage.findMany();
    expect(out).toHaveLength(1);
    expect(out[0]!.storeRefAs).toBe(`lobby:${r.gameId}`);
    expect(s.timers.jobs[0]!.phaseSeq).toBe(0);
  });

  it('guruhda bir vaqtda faqat bitta faol o‘yin', async () => {
    const s = makeServices(db);
    await s.lobby.createLobby({ chatId: CHAT_ID, title: 'G', host: tgUser(1), isAdmin: false });
    const r2 = await s.lobby.createLobby({ chatId: CHAT_ID, title: 'G', host: tgUser(2), isAdmin: false });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('GROUP_ACTIVE_GAME');
  });

  it('ikki marta qo‘shilmaydi; shaxsiy chat ochilmagan bo‘lsa qo‘shilmaydi; boshqa o‘yinda bo‘lsa qo‘shilmaydi', async () => {
    const s = makeServices(db);
    const { number } = await lobbyWithPlayers(s, 2);
    const again = await s.lobby.join({ number }, tgUser(1001));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe('ALREADY_JOINED');

    const noDm = await s.lobby.join({ number }, tgUser(5000));
    expect(noDm.ok).toBe(false);
    if (!noDm.ok) expect(noDm.error).toBe('NEED_DM');

    await s.users.upsert(tgUser(1001), { dmOpened: true });
    const other = await s.lobby.createLobby({ chatId: -100999, title: 'G2', host: tgUser(7000), isAdmin: true });
    if (!other.ok) throw new Error('lobby2');
    const busy = await s.lobby.join({ number: other.number }, tgUser(1001));
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.error).toBe('IN_OTHER_GAME');
  });

  it('parallel qo‘shilish: bitta foydalanuvchi faqat bir marta', async () => {
    const s = makeServices(db);
    const { number } = await lobbyWithPlayers(s, 1);
    await s.users.upsert(tgUser(42), { dmOpened: true });
    const results = await Promise.all(Array.from({ length: 5 }, () => s.lobby.join({ number }, tgUser(42))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.gamePlayer.count({ where: { user: { telegramId: 42n } } })).toBe(1);
  });

  it('4 dan kam o‘yinchi bilan boshlanmaydi (minimal 4)', async () => {
    const s = makeServices(db);
    const { number } = await lobbyWithPlayers(s, 3);
    const r = await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('NOT_ENOUGH');
  });

  it('faqat tashkilotchi yoki admin boshlay oladi', async () => {
    const s = makeServices(db);
    const { number } = await lobbyWithPlayers(s, 4);
    const r = await s.lobby.start({ number }, { telegramId: 1002n, isAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('NO_PERMISSION');
  });

  it('shaxsiy chati yopiq o‘yinchilar boshlashdan oldin aniqlanadi va chiqariladi', async () => {
    const s = makeServices(db);
    const { number, gameId } = await lobbyWithPlayers(s, 5);
    s.probe.failingIds.add('1003');
    const r = await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('DM_FAILED');
    expect(await db.gamePlayer.count({ where: { gameId } })).toBe(4);
    s.probe.failingIds.clear();
    const r2 = await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    expect(r2.ok).toBe(true);
  });

  it('lobby muddati tugasa, yetarli o‘yinchi bo‘lmasa bekor qilinadi', async () => {
    const s = makeServices(db);
    const { gameId } = await lobbyWithPlayers(s, 2);
    s.clock.now += 200_000;
    await s.lobby.onLobbyTimeout(gameId);
    const g = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(g.status).toBe('CANCELLED');
    expect(g.activeGroupKey).toBeNull();
  });

  it('lobby muddati tugasa va yetarli o‘yinchi bo‘lsa avtomatik boshlanadi', async () => {
    const s = makeServices(db);
    const { gameId } = await lobbyWithPlayers(s, 4);
    s.clock.now += 200_000;
    await s.lobby.onLobbyTimeout(gameId);
    const g = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(g.status).toBe('RUNNING');
  });
});

describe('To‘liq o‘yin (§40)', () => {
  it('8 kishilik Classic: boshidan oxirigacha, natija va statistika saqlanadi', async () => {
    const s = makeServices(db);
    const { gameId, number } = await lobbyWithPlayers(s, 8);
    const start = await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    expect(start.ok).toBe(true);

    const st = await stateOf(db, gameId);
    expect(st.players).toHaveLength(8);
    // Har bir o'yinchiga rol DM yuborilgan (maxfiy) — 8 ta ROLE xabari
    const roleDms = await db.outboxMessage.findMany({ where: { gameId, chatId: { gt: 0n } } });
    expect(roleDms.length).toBeGreaterThanOrEqual(8);
    // Guruhga yuborilgan xabarlarda rol nomlari oshkor qilinmagan (boshlanishda)
    const groupMsgs = await db.outboxMessage.findMany({ where: { gameId, chatId: BigInt(CHAT_ID), kind: 'SEND' } });
    for (const m of groupMsgs) expect(JSON.stringify(m.payload)).not.toMatch(/KOMISSAR|DOKTOR/);

    const final = await playUntilEnd(s, gameId, number);
    expect(final.result?.outcome).toBe('CITY');
    const game = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game.status).toBe('FINISHED');
    expect(game.activeGroupKey).toBeNull();
    expect(await db.gameResult.count({ where: { gameId } })).toBe(8);
    const winner = final.players.find((p) => p.faction === 'CITY')!;
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: winner.id } });
    expect(profile.gamesPlayed).toBe(1);
    expect(profile.gamesWon).toBe(1);
    expect(profile.xp).toBeGreaterThanOrEqual(50);
    expect(profile.rating).toBe(1020);
    // O'yin tugagach foydalanuvchilar yangi o'yinga qo'shila oladi
    expect(await db.gamePlayer.count({ where: { gameId, activeUserKey: { not: null } } })).toBe(0);
    // Hodisalar jurnali yozilgan
    expect(await db.gameEvent.count({ where: { gameId } })).toBeGreaterThan(10);
    // Ovozlar bazada
    expect(await db.vote.count({ where: { gameId } })).toBeGreaterThan(0);
  });

  it('o‘yin tugaganidan keyin harakat qabul qilinmaydi', async () => {
    const s = makeServices(db);
    const { gameId, number } = await lobbyWithPlayers(s, 4);
    await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    const final = await playUntilEnd(s, gameId, number);
    const r = await s.games.dayVote(number, 1000n, 1, final.phaseSeq);
    expect(r.ok).toBe(false);
  });

  it('eskirgan tugma (eski phaseSeq) rad etiladi', async () => {
    const s = makeServices(db);
    const { gameId, number } = await lobbyWithPlayers(s, 4);
    await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    const st = await stateOf(db, gameId);
    s.clock.now = st.phaseEndsAt! + 2000;
    await s.games.onPhaseTimer(gameId, st.phaseSeq);
    const r = await s.games.skip(number, 1000n, st.phaseSeq);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('STALE_PHASE');
  });

  it('boshqa o‘yinchi nomidan harakat qilib bo‘lmaydi (o‘yinda bo‘lmagan foydalanuvchi)', async () => {
    const s = makeServices(db);
    const { gameId, number } = await lobbyWithPlayers(s, 4);
    await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    const st = await stateOf(db, gameId);
    await s.users.upsert(tgUser(9999), { dmOpened: true });
    const r = await s.games.skip(number, 9999n, st.phaseSeq);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('NOT_A_PLAYER');
  });
});

describe('Ishonchlilik (§12.5, §29)', () => {
  it('ikki parallel taymer bitta bosqichni ikki marta yakunlamaydi', async () => {
    const s = makeServices(db);
    const { gameId, number } = await lobbyWithPlayers(s, 6);
    await s.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    const st = await stateOf(db, gameId);
    s.clock.now = st.phaseEndsAt! + 2000;
    const results = await Promise.all(Array.from({ length: 5 }, () => s.games.onPhaseTimer(gameId, st.phaseSeq)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = await stateOf(db, gameId);
    expect(after.phaseSeq).toBeGreaterThan(st.phaseSeq);
    const dawns = await db.gameEvent.count({ where: { gameId, eventType: 'DAWN' } });
    expect(dawns).toBe(1);
  });

  it('server restart: yangi servis nusxasi va sweeper o‘tib ketgan bosqichni davom ettiradi', async () => {
    const s1 = makeServices(db);
    const { gameId, number } = await lobbyWithPlayers(s1, 5);
    await s1.lobby.start({ number }, { telegramId: 1000n, isAdmin: false });
    const before = await stateOf(db, gameId);

    // "Restart": xotiradagi hech narsa saqlanmagan yangi nusxa
    const s2 = makeServices(db, { seed: 99 });
    s2.clock.now = before.phaseEndsAt! + 5000;
    const sweeper = new Sweeper(
      db,
      async (job) => {
        const g = await db.game.findUniqueOrThrow({ where: { id: job.gameId } });
        if (g.status === 'RUNNING') await s2.games.onPhaseTimer(job.gameId, job.phaseSeq);
      },
      silentLogger,
    );
    const rescheduled = await sweeper.rescheduleAll(s2.timers);
    expect(rescheduled).toBe(1);
    const n = await sweeper.sweep(s2.clock.now);
    expect(n).toBe(1);
    const after = await stateOf(db, gameId);
    expect(after.phaseSeq).toBeGreaterThan(before.phaseSeq);
  });

  it('yuzlab alohida o‘yin parallel ishlaydi va aralashmaydi (50 guruh × 4 o‘yinchi)', async () => {
    const s = makeServices(db);
    const games: { gameId: string; number: number }[] = [];
    for (let gi = 0; gi < 50; gi++) {
      const tg = Array.from({ length: 4 }, (_, i) => 100_000 + gi * 10 + i);
      for (const id of tg) await s.users.upsert(tgUser(id), { dmOpened: true });
      const r = await s.lobby.createLobby({ chatId: -200_000 - gi, title: `G${gi}`, host: tgUser(tg[0]!), isAdmin: true });
      if (!r.ok) throw new Error(r.error);
      for (const id of tg.slice(1)) await s.lobby.join({ number: r.number }, tgUser(id));
      games.push({ gameId: r.gameId, number: r.number });
    }
    const started = await Promise.all(games.map((g) => s.lobby.start({ number: g.number }, 'auto')));
    expect(started.every((r) => r.ok)).toBe(true);
    const states = await Promise.all(games.map((g) => stateOf(db, g.gameId)));
    for (const [i, st] of states.entries()) {
      expect(st.id).toBe(games[i]!.gameId);
      expect(st.players).toHaveLength(4);
    }
    // Har bir o'yinchi faqat o'z o'yinida
    const players = await db.gamePlayer.findMany({ where: { activeUserKey: { not: null } } });
    expect(new Set(players.map((p) => p.userId)).size).toBe(players.length);
  }, 120_000);
});

describe('Development bot-o‘yinchilar', () => {
  it('/devfill bilan 1 inson + 4 bot o‘yinni oxirigacha o‘ynaydi', async () => {
    const s = makeServices(db, { devFake: true });
    await s.users.upsert(tgUser(1), { dmOpened: true });
    const r = await s.lobby.createLobby({ chatId: CHAT_ID, title: 'G', host: tgUser(1), isAdmin: true });
    if (!r.ok) throw new Error(r.error);
    const f = await s.lobby.devFill(CHAT_ID, 4);
    expect(f.ok && f.added).toBe(4);
    const st = await s.lobby.start({ number: r.number }, { telegramId: 1n, isAdmin: true });
    expect(st.ok).toBe(true);
    for (let i = 0; i < 200; i++) {
      const state = await stateOf(db, r.gameId);
      if (state.status === 'FINISHED') break;
      s.clock.now = (state.phaseEndsAt ?? s.clock.now) + 2000;
      await s.games.onPhaseTimer(r.gameId, state.phaseSeq);
    }
    const final = await stateOf(db, r.gameId);
    expect(final.status).toBe('FINISHED');
    // Bot-o'yinchilarga xabar yuborilmaydi
    const fakeMsgs = await db.outboxMessage.count({ where: { chatId: { gte: 9_000_000_000_000n } } });
    expect(fakeMsgs).toBe(0);
    // Bot-o'yinchilar statistikaga yozilmaydi
    expect(await db.gameResult.count({ where: { gameId: r.gameId } })).toBe(1);
  });

  it('/devfill development rejimida o‘chiq bo‘lsa ishlamaydi', async () => {
    const s = makeServices(db, { devFake: false });
    await s.lobby.createLobby({ chatId: CHAT_ID, title: 'G', host: tgUser(1), isAdmin: true });
    const f = await s.lobby.devFill(CHAT_ID, 4);
    expect(f.ok).toBe(false);
  });
});

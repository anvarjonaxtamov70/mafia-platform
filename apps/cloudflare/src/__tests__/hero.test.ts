import { describe, expect, it } from 'vitest';
import { HEROES, HERO_DAILY_CAP, HERO_MAX_XP, heroLevel, heroThreshold } from '../hero-core';
import type { RecordGameInput, RecordPlayer } from '../registry-core';
import { World, privateText, callback, GROUP, lobby, groupText, playToEnd } from './harness';

const players = (overrides: Partial<RecordPlayer> = {}): RecordPlayer[] => [1,2,3,4].map((tgId) => ({
  tgId, name: 'U' + tgId, role: 'CITIZEN', faction: 'CITY', outcome: 'WIN', survived: true, left: false, active: true, fake: false,
  ...(tgId === 2 ? overrides : {}),
}));
async function world(ownerBenefits = false) {
  const w = new World({ ownerBenefits });
  for (const id of [1,2,3,4,6]) await w.send(privateText(id, '/start'));
  return w;
}
function record(w: World, p = players(), opts: Partial<RecordGameInput> = {}) {
  const number = w.registryCore.allocateGame(GROUP);
  for (const player of p) if (!player.fake) w.registryCore.claim(player.tgId, GROUP, number);
  const input: RecordGameInput = { gameId: 'hero-' + number, number, chatId: GROUP, ranked: true, outcome: 'CITY', days: 2, players: p, ...opts };
  return { input, result: w.registryCore.recordGame(input) };
}

describe('Hero v6', () => {
  it('ten unique heroes, five rarities, level thresholds and capped maximum', () => {
    expect(HEROES).toHaveLength(10);
    expect(new Set(HEROES.map((h) => h.code)).size).toBe(10);
    expect(new Set(HEROES.map((h) => h.rarity)).size).toBe(5);
    for (let level = 1; level <= 100; level++) {
      expect(heroLevel(heroThreshold(level))).toBe(level);
      if (level > 1) expect(heroLevel(heroThreshold(level) - 1)).toBe(level - 1);
    }
    expect(heroLevel(HERO_MAX_XP + 999)).toBe(100);
  });
  it('starter, two owners, no wallet changes, revoked owner access and protected selection', async () => {
    const w = await world(true);
    w.admins.add(6);
    const r = w.registryCore;
    expect(r.heroAccount(2).heroes.filter((h) => h.unlocked)).toHaveLength(1);
    expect(r.selectHero(2, 'don')).toBe('LOCKED');
    expect(r.selectHero(2, '__proto__')).toBe('UNKNOWN');
    expect(r.selectHero(999, 'citizen')).toBe('UNAVAILABLE');
    for (const id of [1,6]) {
      expect(r.heroAccount(id).heroes.every((h) => h.unlocked)).toBe(true);
      expect(r.selectHero(id, 'don')).toBe('OK');
      expect(r.heroAccount(id).selected).toBe('don');
      expect(r.heroAccount(id).totalXp).toBe(0);
      expect(r.eco.coins(id)).toBe(0);
    }
    expect(r.heroTop()).toHaveLength(0);
    w.admins.delete(6);
    expect(r.heroAccount(6).selected).toBe('citizen');
    expect(r.selectHero(6, 'don')).toBe('LOCKED');
    expect(r.eco.wallet(1).permanentOwner).toBe(true);
  });
  it('authoritative reward, unlock, duplicate result, snapshot and daily cap', async () => {
    const w = await world();
    const r = w.registryCore;
    const first = record(w);
    expect(first.result.players.find((p) => p.tgId === 2)?.hero).toMatchObject({ code: 'citizen', xp: 50 });
    expect(r.recordGame(first.input).players).toHaveLength(0);
    expect(r.heroAccount(2).totalXp).toBe(50);
    record(w);
    expect(r.heroAccount(2).heroes.find((h) => h.code === 'doctor')?.unlocked).toBe(true);
    expect(r.selectHero(2, 'doctor')).toBe('OK');
    const n = r.allocateGame(GROUP);
    for (const p of players()) r.claim(p.tgId, GROUP, n);
    expect(r.selectHero(2, 'citizen')).toBe('IN_GAME');
    const result = r.recordGame({ gameId: 'snapshot', number: n, chatId: GROUP, ranked: true, outcome: 'CITY', days: 2, players: players() });
    expect(result.players.find((p) => p.tgId === 2)?.hero?.code).toBe('doctor');
    for (let i = 0; i < 8; i++) record(w);
    const a = r.heroAccount(2);
    expect(a.totalXp).toBe(HERO_DAILY_CAP);
    expect(a.todayXp).toBe(HERO_DAILY_CAP);
    expect(a.heroes.find((h) => h.code === 'doctor')?.xp).toBe(200);
    w.now += 24 * 60 * 60_000;
    expect(r.heroAccount(2).todayXp).toBe(0);
    record(w);
    expect(r.heroAccount(2).totalXp).toBe(350);
  });
  it('AFK, inactive, left, unranked, fake, practice and undersized matches do not reward', async () => {
    const w = await world();
    for (const patch of [{ afk: true }, { active: false }, { left: true }]) record(w, players(patch));
    record(w, players(), { ranked: false });
    record(w, players({ fake: true }));
    record(w, players(), { practice: true });
    record(w, players().slice(0,3));
    expect(w.registryCore.heroAccount(2).totalXp).toBe(0);
    const loss = record(w, players({ outcome: 'LOSS' }));
    expect(loss.result.players.find((p) => p.tgId === 2)?.hero?.xp).toBe(25);
    expect(w.registryCore.heroAccount(2).totalXp).toBe(25);
  });
  it('cancellation releases lock; private menu, group forgery and anonymized leaderboard', async () => {
    const w = await world();
    const r = w.registryCore;
    const n = r.allocateGame(GROUP);
    r.claim(2, GROUP, n);
    expect(r.selectHero(2, 'citizen')).toBe('IN_GAME');
    r.releaseGame(n);
    expect(r.selectHero(2, 'citizen')).toBe('OK');
    record(w); record(w);
    await w.send(callback(2, 'm:pick_doctor', GROUP));
    expect(r.heroAccount(2).selected).toBe('citizen');
    await w.send(callback(2, 'm:pick_doctor'));
    expect(r.heroAccount(2).selected).toBe('citizen');
    await w.send(privateText(2, '/hero'));
    expect(w.tg.texts(2).at(-1)).toContain('100 💎');
    await w.send(privateText(2, '/heroes'));
    expect(w.tg.texts(2).at(-1)).toContain('100 💎');
    expect(r.heroTop().some((p) => p.first_name === 'U2')).toBe(true);
    expect(r.anonymize(2)).toBe('OK');
    expect(r.heroTop().some((p) => p.first_name === 'U2' || p.first_name === 'Deleted')).toBe(false);
    expect(r.selectHero(2, 'citizen')).toBe('UNAVAILABLE');
  });
  it('real RoomCore game rewards at least one active player and sends Hero XP notice', async () => {
    const w = new World();
    const n = await lobby(w, [1,2,3,4]);
    await w.send(groupText(1, '/gstart'));
    await playToEnd(w, n);
    await w.runAlarms();
    expect([1,2,3,4].some((id) => w.registryCore.heroAccount(id).totalXp > 0)).toBe(true);
    expect([1,2,3,4].some((id) => w.tg.texts(id).some((s) => s.includes('Geroy tajribasi')))).toBe(true);
  });
});

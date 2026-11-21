import { describe, expect, it } from 'vitest';
import { createGame, seededRng, type ActionKind } from '@mafia/game-engine';
import { decode, encode } from '../telegram/callback-data';
import { normalizeSettings } from '../game/group-settings';
import { levelForXp, totalXpForLevel, xpFor } from '../game/progression';
import { present } from '../game/presenter';
import { scrubSecrets } from '../infra/logger';

describe('callback_data', () => {
  it('64 baytdan oshmaydi va qaytadan o‘qiladi', () => {
    const kinds: ActionKind[] = ['COMMISSAR_CHECK', 'JOURNALIST_COMPARE', 'CUPID_LINK', 'WIZARD_BARRIER'];
    for (const kind of kinds) {
      const raw = encode({ t: 'action', game: 99_999_999, seq: 9999, kind, seats: [29, 30] });
      expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64);
      expect(decode(raw)).toEqual({ t: 'action', game: 99_999_999, seq: 9999, kind, seats: [29, 30] });
    }
    expect(decode(encode({ t: 'vote', game: 1, seq: 2, seat: 0 }))).toEqual({ t: 'vote', game: 1, seq: 2, seat: 0 });
    expect(decode(encode({ t: 'gs', op: 'min+', chat: -1001234567890 }))).toEqual({ t: 'gs', op: 'min+', chat: -1001234567890 });
  });

  it('noto‘g‘ri ma’lumot rad etiladi', () => {
    expect(decode('a:1:2:XX:3')).toBeNull();
    expect(decode('v:abc:1:1')).toBeNull();
    expect(decode('a:1:2:CC:1.2.3')).toBeNull();
    expect(decode('zzz')).toBeNull();
  });
});

describe('guruh sozlamalari', () => {
  it('minimal o‘yinchi 4 dan kam bo‘lmaydi', () => {
    expect(normalizeSettings({ minPlayers: 2 }).minPlayers).toBe(4);
    expect(normalizeSettings({ minPlayers: 50 }).minPlayers).toBe(30);
    expect(normalizeSettings({}).minPlayers).toBe(4);
    expect(normalizeSettings({}, 8).minPlayers).toBe(8);
    expect(normalizeSettings({ minPlayers: 10, maxPlayers: 5 }).maxPlayers).toBe(10);
    expect(normalizeSettings({ mode: 'HACK' }).mode).toBe('CLASSIC');
  });
});

describe('XP va daraja (T4)', () => {
  it('formula: L-daraja = 100 × (L−1)² jami XP', () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(12)).toBe(12_100);
    expect(levelForXp(12_450)).toBe(12);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
  });

  it('chiqib ketganga XP berilmaydi', () => {
    const base = { playerId: 'x', role: 'CITIZEN' as const, faction: 'CITY' as const, survived: false, achievements: [] };
    expect(xpFor({ ...base, outcome: 'LOSS', left: true }, true)).toBe(0);
    expect(xpFor({ ...base, outcome: 'WIN', left: false }, true)).toBe(55);
  });
});

describe('presenter: maxfiylik', () => {
  it('rollar faqat shaxsiy chatga, guruhga emas', () => {
    const r = createGame({
      id: 'g1',
      mode: 'CLASSIC',
      players: Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, name: `<b>U${i}</b>` })),
      now: 0,
      rng: seededRng(1),
    });
    if (!r.ok) throw new Error();
    const users = new Map(r.state.players.map((p, i) => [p.id, { telegramId: BigInt(100 + i), isFake: false }]));
    const drafts = present({ game: { id: 'g1', number: 1, chatId: -1n }, version: 1, state: r.state, events: r.events, users, prevPhaseSeq: 0 });
    const group = drafts.filter((d) => d.chatId === -1n);
    const dms = drafts.filter((d) => d.chatId > 0n);
    expect(group.length).toBeGreaterThan(0);
    for (const g of group) expect(JSON.stringify(g.payload)).not.toMatch(/SIZNING ROLINGIZ|MAFIA JAMOANGIZ/);
    expect(dms.filter((d) => JSON.stringify(d.payload).includes('SIZNING ROLINGIZ'))).toHaveLength(8);
    // Ismlar HTML escape qilingan
    // Ismlar xabar matnida HTML escape qilingan (tugma matni HTML emas, u yerda oddiy matn)
    for (const d of drafts) if ('text' in d.payload) expect(d.payload.text).not.toContain('<b>U');
    // Dedupe kalitlari takrorlanmaydi
    expect(new Set(drafts.map((d) => d.dedupeKey)).size).toBe(drafts.length);
  });
});

describe('log xavfsizligi', () => {
  it('bot tokeni xabardan olib tashlanadi', () => {
    const msg = 'Call to https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789/sendMessage failed';
    expect(scrubSecrets(msg)).not.toContain('ABCdef');
  });
});

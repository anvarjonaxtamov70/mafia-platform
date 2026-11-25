import { describe, expect, it } from 'vitest';
import { decode, learningView } from '@mafia/bot-core';
import { ALL_ROLES } from '@mafia/game-engine';
import type { GameState } from '@mafia/game-engine';
import { TgError } from '../telegram';
import { callback, GROUP, groupText, privateText, World } from './harness';

/** Outbox dagi yuborilgan xabarlardan foydalanuvchi uchun tungi tugmani topish */
function buttonsFor(w: World, chatId: number): string[] {
  return w.tg
    .sent(chatId)
    .flatMap((c) => ((c.params['reply_markup'] as { inline_keyboard?: { callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat())
    .map((b) => b.callback_data)
    .filter((x): x is string => !!x);
}

async function lobby(w: World, ids: number[]): Promise<number> {
  for (const id of ids) await w.send(privateText(id, '/start'));
  w.tg.admins.add(ids[0]!);
  await w.send(groupText(ids[0]!, '/game'));
  const core = await w.loaded(GROUP);
  const number = core.data.game!.number;
  for (const id of ids.slice(1)) await w.send(callback(id, `l:j:${number}`, GROUP));
  return number;
}

function state(w: World): GameState | null {
  return w.rooms.get(GROUP)?.data.game?.state ?? null;
}

/** Shahar uchun ochiq o'yin: Mafia hujum qilmaydi, hamma Mafiaga ovoz beradi */
async function playToEnd(w: World, number: number): Promise<void> {
  for (let step = 0; step < 200; step++) {
    const s = state(w);
    if (!s) return;
    const alive = s.players.filter((p) => p.status === 'ALIVE');
    if (s.phase === 'NIGHT') {
      for (const p of alive) {
        const id = Number(p.id);
        if (p.faction === 'MAFIA') await w.send(callback(id, `mv:${number}:${s.phaseSeq}:0`));
        await w.send(callback(id, `a:${number}:${s.phaseSeq}:SKIP`));
      }
    } else if (s.phase === 'DAY_VOTING') {
      const mafia = alive.find((p) => p.faction === 'MAFIA')!;
      for (const p of alive) if (p.id !== mafia.id) await w.send(callback(Number(p.id), `v:${number}:${s.phaseSeq}:${mafia.seat}`, GROUP));
    }
    const after = state(w);
    if (after && after.phaseSeq === s.phaseSeq) await w.advance((after.phaseEndsAt ?? w.now) - w.now + 1000);
  }
  throw new Error('game did not finish');
}

describe('Registry (SQLite)', () => {
  it('foydalanuvchi bir marta yaratiladi, username o‘zgarsa saqlanadi', async () => {
    const w = new World();
    w.registryCore.upsertUser({ id: 5, first_name: 'A', username: 'a' }, true);
    w.registryCore.upsertUser({ id: 5, first_name: 'A', username: 'b' }, false);
    const info = w.registryCore.userInfo(5)!;
    expect(info.dmAvailable).toBe(true);
    expect(w.registryCore.adminStats()).toContain('Foydalanuvchilar: 1');
  });

  it('bir foydalanuvchi bir vaqtda faqat bitta o‘yinda', () => {
    const w = new World();
    const a = w.registryCore.allocateGame(-1);
    const b = w.registryCore.allocateGame(-2);
    expect(w.registryCore.claim(7, -1, a)).toBe('OK');
    expect(w.registryCore.claim(7, -1, a)).toBe('ALREADY');
    expect(w.registryCore.claim(7, -2, b)).toBe('BUSY');
    w.registryCore.releaseGame(a);
    expect(w.registryCore.claim(7, -2, b)).toBe('OK');
  });

  it('minimal o‘yinchi 4 dan pastga tushmaydi (global va guruh)', () => {
    const w = new World();
    expect(w.registryCore.setGlobalMinPlayers(2, 'x')).toBe(4);
    expect(w.registryCore.setGlobalMinPlayers(6, 'x')).toBe(6);
    expect(w.registryCore.getSettings(-5).minPlayers).toBe(6);
    const saved = w.registryCore.saveSettings(-5, { ...w.registryCore.getSettings(-5), minPlayers: 1 }, 'x');
    expect(saved.minPlayers).toBe(4);
  });

  it('xatolar jurnali: oxirgi 200 ta saqlanadi, /admin_stats da ko‘rinadi', () => {
    const w = new World();
    for (let i = 0; i < 205; i++) w.registryCore.logError('webhook', `xato ${i}`);
    const e = w.registryCore.recentErrors();
    expect(e.count24h).toBe(200);
    expect(e.last[0]!.message).toBe('xato 204');
    expect(w.registryCore.adminStats()).toContain('Ichki xatolar (24 soat): 200');
  });

  it('natijalar bir marta yoziladi (idempotent)', () => {
    const w = new World();
    const n = w.registryCore.allocateGame(-1);
    w.registryCore.upsertUser({ id: 9, first_name: 'A' }, true);
    const input = {
      gameId: 'g',
      number: n,
      chatId: -1,
      ranked: true,
      outcome: 'CITY' as const,
      days: 3,
      players: [{ tgId: 9, name: 'A', role: 'CITIZEN' as const, faction: 'CITY' as const, outcome: 'WIN' as const, survived: true, left: false, active: true, fake: false }],
    };
    expect(w.registryCore.recordGame(input).players).toHaveLength(1);
    expect(w.registryCore.recordGame(input).players).toHaveLength(0);
    expect(w.registryCore.profileText(9)).toContain('G‘alabalar: 1');
    expect(w.registryCore.globalRating(9)).toContain('1020 RP');
  });
});

describe('Cloudflare: to‘liq oqim (router → GameRoom → Registry)', () => {
  it('/start → menyu; /game → lobby; tugma bilan qo‘shilish; /gstart → rollar DM', async () => {
    const w = new World();
    const ids = [1, 2, 3, 4];
    const number = await lobby(w, ids);
    expect(w.tg.texts(1).some((t) => t.includes('MAFIA GAME'))).toBe(true);
    expect(w.tg.texts(GROUP).some((t) => t.includes('YANGI MAFIA O‘YINI'))).toBe(true);
    expect(w.rooms.get(GROUP)!.data.game!.players).toHaveLength(4);
    // Lobby xabari tahrirlangan (yangi xabar emas)
    expect(w.tg.calls.filter((c) => c.method === 'editMessageText' && Number(c.params['chat_id']) === GROUP).length).toBeGreaterThan(0);

    await w.send(groupText(3, '/gstart'));
    expect(state(w)).toBeNull();
    await w.send(groupText(1, '/gstart'));
    const s = state(w)!;
    expect(s.status).toBe('RUNNING');
    for (const id of ids) expect(w.tg.texts(id).some((t) => t.includes('SIZNING ROLINGIZ'))).toBe(true);
    // Guruhga rol oshkor qilinmaydi
    for (const t of w.tg.texts(GROUP)) expect(t).not.toContain('SIZNING ROLINGIZ');
    expect(number).toBeGreaterThan(0);
  });

  it('o‘yin boshidan oxirigacha alarm orqali, natijalar va profil yangilanadi', async () => {
    const w = new World();
    const number = await lobby(w, [1, 2, 3, 4, 5, 6]);
    await w.send(groupText(1, '/gstart'));
    await playToEnd(w, number);
    expect(w.rooms.get(GROUP)!.data.game).toBeNull();
    expect(w.tg.texts(GROUP).some((t) => t.includes('SHAHAR G‘ALABA QOZONDI'))).toBe(true);
    expect(w.tg.texts(2).some((t) => t.includes('O‘yin tugadi'))).toBe(true);
    // Faol o'yinchilar bo'shatildi — yangi o'yinga qo'shila oladi
    expect(w.registryCore.activeOf(2)).toBeNull();
    // Statistikalar
    const played = [1, 2, 3, 4, 5, 6].map((id) => w.registryCore.profileText(id));
    for (const p of played) expect(p).toContain('O‘yinlar: 1');
    expect(w.registryCore.groupLeaderboard(GROUP)).toContain('g‘alaba');
  });

  it('eskirgan tugma rad etiladi; boshqa o‘yinchi nomidan harakat qilib bo‘lmaydi', async () => {
    const w = new World();
    const number = await lobby(w, [1, 2, 3, 4]);
    await w.send(groupText(1, '/gstart'));
    const s = state(w)!;
    const commissar = s.players.find((p) => p.role === 'COMMISSAR')!;
    const btn = buttonsFor(w, Number(commissar.id)).find((d) => decode(d)?.t === 'action')!;
    expect(btn).toBeTruthy();
    // Begona foydalanuvchi
    await w.send(callback(999, btn));
    expect(w.rooms.get(GROUP)!.data.game!.state!.night.actions[commissar.id]).toBeUndefined();
    // O'zi
    await w.send(callback(Number(commissar.id), btn));
    const after = w.rooms.get(GROUP)!.data.game!.state!;
    expect(after.night.actions[commissar.id] !== undefined || after.phase !== 'NIGHT').toBe(true);
    // Eskirgan
    const stale = btn.replace(/^a:(\d+):(\d+)/, `a:$1:${s.phaseSeq + 50}`);
    await w.send(callback(Number(commissar.id), stale));
    const ans = w.tg.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!;
    expect(String(ans.params['text'])).toContain('eskirgan');
    expect(number).toBeGreaterThan(0);
  });

  it('restart: DO xotirasi yo‘qolsa ham o‘yin storage dan davom etadi', async () => {
    const w = new World();
    const number = await lobby(w, [1, 2, 3, 4, 5]);
    await w.send(groupText(1, '/gstart'));
    const seq = state(w)!.phaseSeq;
    w.restart(GROUP);
    await w.advance(200_000);
    const core = await w.loaded(GROUP);
    expect(core.data.game === null || core.data.game.state!.phaseSeq > seq).toBe(true);
    expect(number).toBeGreaterThan(0);
  });

  it('bitta foydalanuvchi ikki guruhda bir vaqtda o‘ynay olmaydi', async () => {
    const w = new World();
    await lobby(w, [1, 2, 3, 4]);
    const OTHER = -1007770002;
    await w.send(privateText(50, '/start'));
    w.tg.admins.add(50);
    await w.send(groupText(50, '/game', OTHER));
    const other = (await w.loaded(OTHER)).data.game!;
    await w.send(callback(2, `l:j:${other.number}`, OTHER));
    expect(other.players.some((p) => p.id === 2)).toBe(false);
    expect((await w.loaded(OTHER)).data.game!.players.some((p) => p.id === 2)).toBe(false);
  });

  it('lobby muddati tugasa: kam bo‘lsa bekor, yetarli bo‘lsa avtostart', async () => {
    const w = new World();
    await lobby(w, [1, 2]);
    await w.advance(200_000);
    expect((await w.loaded(GROUP)).data.game).toBeNull();
    expect(w.registryCore.activeOf(1)).toBeNull();

    const w2 = new World();
    await lobby(w2, [1, 2, 3, 4]);
    await w2.advance(200_000);
    expect(w2.rooms.get(GROUP)!.data.game!.status).toBe('RUNNING');
  });

  it('shaxsiy chati yopiq o‘yinchi boshlashdan oldin chiqariladi', async () => {
    const w = new World();
    const number = await lobby(w, [1, 2, 3, 4, 5]);
    w.tg.blocked.add(3);
    await w.send(groupText(1, '/gstart'));
    const g = w.rooms.get(GROUP)!.data.game!;
    expect(g.status).toBe('LOBBY');
    expect(g.players.map((p) => p.id)).not.toContain(3);
    expect(w.registryCore.activeOf(3)).toBeNull();
    await w.send(groupText(1, '/gstart'));
    expect(w.rooms.get(GROUP)!.data.game!.status).toBe('RUNNING');
    expect(number).toBeGreaterThan(0);
  });

  it('bepul tarif: bitta alarm chaqiruvida Telegramga 40 tadan ko‘p so‘rov yuborilmaydi', async () => {
    const w = new World({ devFake: true });
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    for (const id of ids) await w.send(privateText(id, '/start'));
    w.tg.admins.add(1);
    await w.send(groupText(1, '/game'));
    const core = await w.loaded(GROUP);
    const number = core.data.game!.number;
    core.data.game!.config.maxPlayers = 30;
    for (const id of ids.slice(1)) await w.send(callback(id, `l:j:${number}`, GROUP));
    expect(core.data.game!.players).toHaveLength(30);
    w.tg.calls = [];
    await w.router.handle({ update_id: 1, ...groupText(1, '/gstart') });
    // start chaqiruvi: faqat DM tekshiruvlari (30) + javoblar
    const store = w.stores.get(GROUP)!;
    expect(store.alarm).not.toBeNull();
    let rounds = 0;
    while (store.alarm !== null && store.alarm <= w.now && rounds < 20) {
      w.tg.calls = [];
      store.alarm = null;
      await core.alarm();
      const telegramCalls = w.tg.calls.length;
      expect(telegramCalls).toBeLessThanOrEqual(40);
      rounds++;
    }
    expect(rounds).toBeGreaterThan(1);
    expect(core.data.outbox).toHaveLength(0);
  });

  it('429: retry_after bo‘yicha kechiktiriladi; 403: o‘sha chatga yuborish to‘xtaydi', async () => {
    const w = new World();
    await lobby(w, [1, 2, 3, 4]);
    const core = await w.loaded(GROUP);
    core.data.outbox.push({ id: 9001, chatId: 4, payload: { kind: 'SEND', text: 'x' }, attempts: 0, notBefore: 0 });
    w.tg.failNext = new TgError(429, 'Too Many Requests', 7);
    await core.flush();
    expect(core.data.outbox[0]!.notBefore).toBe(w.now + 7000);
    core.data.outbox = [
      { id: 1, chatId: 5, payload: { kind: 'SEND', text: 'a' }, attempts: 0, notBefore: 0 },
      { id: 2, chatId: 5, payload: { kind: 'SEND', text: 'b' }, attempts: 0, notBefore: 0 },
      { id: 3, chatId: 6, payload: { kind: 'SEND', text: 'c' }, attempts: 0, notBefore: 0 },
    ];
    w.tg.blocked.add(5);
    await core.flush();
    expect(core.data.outbox).toHaveLength(0);
    expect(w.tg.texts(6)).toContain('c');
    expect(core.data.ops.some((o) => o.type === 'dmBlocked')).toBe(true);
  });

  it('/devfill: 1 inson + 5 bot o‘yinni oxirigacha o‘ynaydi, botlarga xabar yuborilmaydi, statistika yozilmaydi', async () => {
    const w = new World({ devFake: true });
    await w.send(privateText(1, '/start'));
    w.tg.admins.add(1);
    await w.send(groupText(1, '/game'));
    await w.send(groupText(1, '/devfill 5'));
    await w.send(groupText(1, '/gstart'));
    for (let i = 0; i < 100 && w.rooms.get(GROUP)!.data.game; i++) {
      const s = state(w)!;
      await w.advance((s.phaseEndsAt ?? w.now) - w.now + 1000);
    }
    expect(w.rooms.get(GROUP)!.data.game).toBeNull();
    expect(w.tg.sent().every((c) => Number(c.params['chat_id']) < 9_000_000_000_000)).toBe(true);
    expect(w.registryCore.profileText(1)).toContain('O‘yinlar: 0');
    expect(w.tg.texts(1).some((t) => t.includes('Mashq o‘yini tugadi'))).toBe(true);
  });

  it('/settings faqat admin; minimal 4 dan pastga tushmaydi', async () => {
    const w = new World();
    w.tg.admins.add(10);
    await w.send(groupText(11, '/settings'));
    expect(w.tg.texts(GROUP).at(-1)).toContain('faqat guruh administratori');
    await w.send(groupText(10, '/settings'));
    for (let i = 0; i < 3; i++) await w.send(callback(10, `gs:min-:${GROUP}`, GROUP));
    expect(w.registryCore.getSettings(GROUP).minPlayers).toBe(4);
    await w.send(callback(10, `gs:min+:${GROUP}`, GROUP));
    expect(w.registryCore.getSettings(GROUP).minPlayers).toBe(5);
    await w.send(callback(11, `gs:min+:${GROUP}`, GROUP));
    expect(w.registryCore.getSettings(GROUP).minPlayers).toBe(5);
  });

  it('superadmin /admin_minplayers; boshqalar uchun ruxsat yo‘q', async () => {
    const w = new World();
    await w.send(privateText(1, '/admin_minplayers 3'));
    expect(w.tg.texts(1).at(-1)).toContain('4..30');
    await w.send(privateText(1, '/admin_minplayers 7'));
    expect(w.registryCore.globalMinPlayers()).toBe(7);
    await w.send(privateText(2, '/admin_minplayers 5'));
    expect(w.tg.texts(2).at(-1)).toContain('Ruxsat yo‘q');
  });

  it('o‘lgan o‘yinchining guruhdagi xabari o‘chiriladi, tirikniki kunduzi qoladi', async () => {
    const w = new World();
    await lobby(w, [1, 2, 3, 4]);
    await w.send(groupText(1, '/gstart'));
    const core = w.rooms.get(GROUP)!;
    const st = core.data.game!.state!;
    const victim = st.players.find((p) => p.faction !== 'MAFIA')!;
    victim.status = 'DEAD';
    st.phase = 'DAY_DISCUSSION';
    const alive = st.players.find((p) => p.status === 'ALIVE')!;
    await w.send(groupText(Number(victim.id), 'salom'));
    const deletes = () => w.tg.calls.filter((c) => c.method === 'deleteMessage').length;
    expect(deletes()).toBe(1);
    w.now += 20_000; // kesh yangilanishi
    await w.send(groupText(Number(alive.id), 'men tirikman'));
    expect(deletes()).toBe(1);
  });

  it('tunda Mafia chati jamoadoshlarga yetkaziladi', async () => {
    const w = new World();
    await lobby(w, [1, 2, 3, 4, 5, 6, 7]);
    await w.send(groupText(1, '/gstart'));
    const st = w.rooms.get(GROUP)!.data.game!.state!;
    const mafia = st.players.filter((p) => p.faction === 'MAFIA');
    expect(mafia.length).toBe(2);
    await w.send(privateText(Number(mafia[0]!.id), 'Anvarni olamiz'));
    expect(w.tg.texts(Number(mafia[1]!.id)).some((t) => t.includes('Anvarni olamiz'))).toBe(true);
    const city = st.players.find((p) => p.faction === 'CITY')!;
    expect(w.tg.texts(Number(city.id)).some((t) => t.includes('Anvarni olamiz'))).toBe(false);
  });
});


describe('Hypernova v2 — Telegram-first', () => {
  it('eski lobby chiqish va bekor qilish tugmalari yangi lobbyga ta’sir qilmaydi', async () => {
    const w = new World();
    const old = await lobby(w, [1, 2, 3, 4]);
    await w.send(groupText(1, '/cancelgame'));
    const current = await lobby(w, [1, 2, 3, 4]);
    expect(current).not.toBe(old);
    await w.send(callback(2, 'l:l:' + old, GROUP));
    await w.send(callback(1, 'l:c:' + old, GROUP));
    const g = (await w.loaded(GROUP)).data.game!;
    expect(g.number).toBe(current);
    expect(g.players).toHaveLength(4);
  });

  it('/quick qisqa taymerli reytingsiz o‘yin yaratadi va guruh sozlamasini o‘zgartirmaydi', async () => {
    const w = new World();
    await w.send(privateText(1, '/start'));
    const before = w.registryCore.getSettings(GROUP);
    await w.send(groupText(1, '/quick'));
    const g = (await w.loaded(GROUP)).data.game!;
    expect(g.mode).toBe('PRIVATE');
    expect(g.config).toMatchObject({ ranked: false, allowArcadeItems: false, nightDurationSec: 45, discussionDurationSec: 60, votingDurationSec: 30, verdictDurationSec: 10 });
    expect(w.registryCore.getSettings(GROUP)).toEqual(before);
    expect(w.tg.texts(GROUP).join(' ')).toContain('TEZKOR O‘YIN');
  });

  it('katalogda 30 ta rol va yaroqli callback tugmalari bor', async () => {
    const w = new World();
    await w.send(privateText(1, '/characters'));
    expect(w.tg.texts(1).join(' ')).toContain('PERSONAJLAR KATALOGI');
    await w.send(callback(1, 'm:roles_city'));
    await w.send(callback(1, 'm:role_commissar'));
    expect(w.tg.calls.filter((c) => c.method === 'editMessageText').at(-1)?.params['text']).toContain('KOMISSAR');
    for (const role of ALL_ROLES) {
      const section = 'role_' + role.code.toLowerCase();
      expect(decode('m:' + section)).toEqual({ t: 'menu', section });
      expect(learningView(section)?.text).toContain('minimal');
    }
    await w.send(privateText(1, '/guide'));
    expect(w.tg.texts(1).join(' ')).toContain('BIRINCHI O‘YININGIZ');
  });
});


describe('Stability regression', () => {
  it('ten independent group rooms finish without cross-room state or stuck players', async () => {
    const w = new World();
    const groups = Array.from({ length: 10 }, (_, i) => ({ chat: GROUP - i - 1, ids: Array.from({ length: 4 }, (_, j) => 100 + i * 4 + j) }));
    for (const group of groups) {
      for (const id of group.ids) await w.send(privateText(id, '/start'));
      const host = group.ids[0]!;
      w.tg.admins.add(host);
      await w.send(groupText(host, '/game', group.chat));
      const n = (await w.loaded(group.chat)).data.game!.number;
      for (const id of group.ids.slice(1)) await w.send(callback(id, 'l:j:' + n, group.chat));
    }
    await Promise.all(groups.map((group, i) => w.router.handle({ update_id: 10000 + i, ...groupText(group.ids[0]!, '/gstart', group.chat) })));
    await w.runAlarms();
    for (const group of groups) {
      expect((await w.loaded(group.chat)).data.game?.state?.players.map((p) => Number(p.id)).sort((a, b) => a - b)).toEqual(group.ids);
      w.restart(group.chat);
    }
    for (let step = 0; step < 150; step++) {
      if (groups.every((group) => !w.stores.get(group.chat)?.data?.game)) break;
      await w.advance(200_000);
    }
    for (const group of groups) {
      expect((await w.loaded(group.chat)).data.game).toBeNull();
      for (const id of group.ids) expect(w.registryCore.activeOf(id)).toBeNull();
    }
  }, 60_000);

  it('two concurrent start requests cannot start the same lobby twice', async () => {
    const w = new World();
    const number = await lobby(w, [1, 2, 3, 4]);
    const core = await w.loaded(GROUP);
    const results = await Promise.all([core.start({ by: 1, isAdmin: true }, number), core.start({ by: 1, isAdmin: true }, number)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await w.runAlarms();
    for (const id of [1, 2, 3, 4]) expect(w.tg.texts(id).filter((text) => text.includes('SIZNING ROLINGIZ'))).toHaveLength(1);
  });
});

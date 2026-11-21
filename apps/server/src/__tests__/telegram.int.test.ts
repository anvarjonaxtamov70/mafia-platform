/**
 * Telegram qatlami E2E (tarmoqsiz): grammY ga soxta Bot API ulanadi, haqiqiy Update obyektlari yuboriladi.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Api, type Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { availableNightActions, type GameState } from '@mafia/game-engine';
import { loadEnv } from '@mafia/config';
import { createBot } from '../telegram/bot';
import { AdminChecker } from '../telegram/helpers';
import { decode } from '@mafia/bot-core';
import { makeServices, resetDb, silentLogger, stateOf, testDb, type TestServices } from './test-utils';

const db = testDb();
const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const GROUP = -1005550001;

afterAll(async () => {
  await db.$disconnect();
});

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

function fakeTransport(calls: Call[], admins: Set<number>) {
  let mid = 1000;
  return async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    let result: unknown = true;
    if (method === 'sendMessage') result = { message_id: mid++, date: 0, chat: { id: payload['chat_id'], type: 'private' }, text: payload['text'] };
    if (method === 'getChatMember') result = { status: admins.has(Number(payload['user_id'])) ? 'administrator' : 'member', user: { id: payload['user_id'], is_bot: false, first_name: 'x' } };
    return { ok: true, result } as never;
  };
}

const botInfo = {
  id: 1,
  is_bot: true,
  first_name: 'Mafia',
  username: 'test_mafia_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as unknown as UserFromGetMe;

let updateId = 1;
const user = (id: number) => ({ id, is_bot: false, first_name: `U${id}`, username: `u${id}` });

function privateText(from: number, text: string): Update {
  const entities = text.startsWith('/') ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }] : undefined;
  return {
    update_id: updateId++,
    message: { message_id: updateId, date: 0, chat: { id: from, type: 'private', first_name: `U${from}` }, from: user(from), text, ...(entities ? { entities } : {}) },
  } as Update;
}

function groupText(from: number, text: string): Update {
  const entities = text.startsWith('/') ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }] : undefined;
  return {
    update_id: updateId++,
    message: { message_id: updateId, date: 0, chat: { id: GROUP, type: 'supergroup', title: 'Mafia guruh' }, from: user(from), text, ...(entities ? { entities } : {}) },
  } as Update;
}

function callback(from: number, data: string, inGroup = false): Update {
  const chat = inGroup ? { id: GROUP, type: 'supergroup', title: 'Mafia guruh' } : { id: from, type: 'private', first_name: `U${from}` };
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: user(from),
      chat_instance: 'x',
      data,
      message: { message_id: 77, date: 0, chat, text: 'x' },
    },
  } as unknown as Update;
}

describe('Telegram adapter E2E', () => {
  let s: TestServices;
  let bot: Bot;
  let calls: Call[];

  beforeEach(async () => {
    await resetDb(db);
    s = makeServices(db);
    calls = [];
    const admins = new Set<number>([1]);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', BOT_TOKEN: TOKEN, SUPERADMIN_IDS: '1' });
    const adminApi = new Api(TOKEN);
    adminApi.config.use(fakeTransport(calls, admins) as never);
    bot = createBot(TOKEN, {
      env,
      db,
      users: s.users,
      lobby: s.lobby,
      games: s.games,
      queries: s.queries,
      admin: new AdminChecker(adminApi, new Set(['1'])),
      logger: silentLogger,
      botUsername: 'test_mafia_bot',
      botInfo,
    });
    bot.api.config.use(fakeTransport(calls, admins) as never);
  });

  const sent = (chatId: number) => calls.filter((c) => c.method === 'sendMessage' && c.payload['chat_id'] === chatId);

  it('/start: akkaunt yaratiladi, bosh menyu ko‘rsatiladi; qayta /start akkauntni qayta yaratmaydi', async () => {
    await bot.handleUpdate(privateText(10, '/start'));
    await bot.handleUpdate(privateText(10, '/start'));
    expect(await db.user.count()).toBe(1);
    const msg = sent(10).at(-1)!;
    expect(String(msg.payload['text'])).toContain('MAFIA GAME');
    const kb = (msg.payload['reply_markup'] as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard;
    expect(kb.flat().map((b) => b.callback_data)).toContain('m:play');
  });

  it('menyu: profil va "keyingi bosqich" bo‘limlari', async () => {
    await bot.handleUpdate(privateText(10, '/start'));
    await bot.handleUpdate(callback(10, 'm:profile'));
    const edit = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(edit.payload['text'])).toContain('O‘YINCHI PROFILI');
    await bot.handleUpdate(callback(10, 'm:shop'));
    expect(String(calls.filter((c) => c.method === 'editMessageText').at(-1)!.payload['text'])).toContain('keyingi bosqichda');
  });

  it('guruhda /game → lobby, tugma orqali qo‘shilish, /gstart → rollar shaxsiy chatga, tungi tugma ishlaydi', async () => {
    for (const id of [1, 2, 3, 4]) await bot.handleUpdate(privateText(id, '/start'));
    await bot.handleUpdate(groupText(1, '/game'));
    const game = await db.game.findFirstOrThrow({ where: { status: 'LOBBY' } });
    // Shaxsiy chat ochmagan foydalanuvchi qo'shila olmaydi
    await bot.handleUpdate(callback(50, `l:j:${game.number}`, true));
    const alert = calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!;
    expect(alert.payload['show_alert']).toBe(true);
    for (const id of [2, 3, 4]) await bot.handleUpdate(callback(id, `l:j:${game.number}`, true));
    expect(await db.gamePlayer.count({ where: { gameId: game.id } })).toBe(4);
    // Oddiy o'yinchi boshlay olmaydi
    await bot.handleUpdate(groupText(3, '/gstart'));
    expect((await db.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe('LOBBY');
    await bot.handleUpdate(groupText(1, '/gstart'));
    expect((await db.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe('RUNNING');

    const state: GameState = await stateOf(db, game.id);
    // Rol DM lari outbox da (har bir o'yinchiga)
    const outbox = await db.outboxMessage.findMany({ where: { gameId: game.id } });
    for (const tg of [1, 2, 3, 4]) {
      expect(outbox.some((m) => m.chatId === BigInt(tg) && JSON.stringify(m.payload).includes('SIZNING ROLINGIZ'))).toBe(true);
    }

    // Komissar tungi tugmasini bosadi (outbox dagi haqiqiy tugma ma'lumoti bilan)
    const commissar = state.players.find((p) => p.role === 'COMMISSAR')!;
    const cu = await db.user.findUniqueOrThrow({ where: { id: commissar.id } });
    const actionMsg = outbox.find((m) => m.chatId === cu.telegramId && JSON.stringify(m.payload).includes('"callback_data":"a:'))!;
    const buttons = (actionMsg.payload as { keyboard: { callback_data?: string }[][] }).keyboard.flat();
    const target = buttons.find((b) => b.callback_data && decode(b.callback_data)?.t === 'action')!;
    await bot.handleUpdate(callback(Number(cu.telegramId), target.callback_data!));
    const after = await stateOf(db, game.id);
    const recorded = after.night.actions[commissar.id] ?? (after.phase !== 'NIGHT' ? 'advanced' : undefined);
    expect(recorded).toBeTruthy();
    expect(await db.roleAction.count({ where: { gameId: game.id } })).toBe(1);
    const edit = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(edit.payload['text'])).toContain('Qabul qilindi');

    // Boshqa o'yinchi Komissar tugmasini bosa olmaydi (o'z roli yo'q)
    const other = state.players.find((p) => p.role === 'CITIZEN' || (p.id !== commissar.id && availableNightActions(state, p).every((a) => a.kind !== 'COMMISSAR_CHECK')))!;
    const ou = await db.user.findUniqueOrThrow({ where: { id: other.id } });
    await bot.handleUpdate(callback(Number(ou.telegramId), target.callback_data!));
    expect(await db.roleAction.count({ where: { gameId: game.id } })).toBe(1);

    // Eskirgan tugma
    await bot.handleUpdate(callback(Number(cu.telegramId), target.callback_data!.replace(/^a:(\d+):(\d+)/, 'a:$1:9999')));
    expect(String(calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!.payload['text'])).toContain('eskirgan');
  });

  it('/settings faqat admin; minimal o‘yinchi 4 dan pastga tushmaydi', async () => {
    await bot.handleUpdate(groupText(2, '/settings'));
    expect(String(sent(GROUP).at(-1)!.payload['text'])).toContain('faqat guruh administratori');
    await bot.handleUpdate(groupText(1, '/settings'));
    expect(String(sent(GROUP).at(-1)!.payload['text'])).toContain('O‘YIN SOZLAMALARI');
    for (let i = 0; i < 3; i++) await bot.handleUpdate(callback(1, `gs:min-:${GROUP}`, true));
    const group = await db.group.findUniqueOrThrow({ where: { telegramChatId: BigInt(GROUP) }, include: { settings: true } });
    expect((group.settings!.data as { minPlayers: number }).minPlayers).toBe(4);
    for (let i = 0; i < 2; i++) await bot.handleUpdate(callback(1, `gs:min+:${GROUP}`, true));
    const g2 = await db.groupSettings.findUniqueOrThrow({ where: { groupId: group.id } });
    expect((g2.data as { minPlayers: number }).minPlayers).toBe(6);
    // Oddiy a'zo o'zgartira olmaydi
    await bot.handleUpdate(callback(2, `gs:min+:${GROUP}`, true));
    const g3 = await db.groupSettings.findUniqueOrThrow({ where: { groupId: group.id } });
    expect((g3.data as { minPlayers: number }).minPlayers).toBe(6);
  });

  it('superadmin global minimal sonni o‘rnatadi, 4 dan kam rad etiladi', async () => {
    await bot.handleUpdate(privateText(1, '/admin_minplayers 3'));
    expect(String(sent(1).at(-1)!.payload['text'])).toContain('4..30');
    await bot.handleUpdate(privateText(1, '/admin_minplayers 6'));
    const row = await db.appSetting.findUniqueOrThrow({ where: { key: 'defaultMinPlayers' } });
    expect(row.value).toBe(6);
    await bot.handleUpdate(privateText(2, '/admin_minplayers 5'));
    expect(String(sent(2).at(-1)!.payload['text'])).toContain('Ruxsat yo‘q');
  });

  it('o‘lgan o‘yinchining guruhdagi xabari o‘chiriladi', async () => {
    for (const id of [1, 2, 3, 4]) await bot.handleUpdate(privateText(id, '/start'));
    await bot.handleUpdate(groupText(1, '/game'));
    const game = await db.game.findFirstOrThrow({ where: { status: 'LOBBY' } });
    for (const id of [2, 3, 4]) await bot.handleUpdate(callback(id, `l:j:${game.number}`, true));
    await bot.handleUpdate(groupText(1, '/gstart'));
    const state = await stateOf(db, game.id);
    const victim = state.players.find((p) => p.faction !== 'MAFIA')!;
    state.players.find((p) => p.id === victim.id)!.status = 'DEAD';
    await db.game.update({ where: { id: game.id }, data: { state: state as unknown as object } });
    const vu = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const before = calls.filter((c) => c.method === 'deleteMessage').length;
    await bot.handleUpdate(groupText(Number(vu.telegramId), 'salom'));
    expect(calls.filter((c) => c.method === 'deleteMessage').length).toBe(before + 1);
  });
});

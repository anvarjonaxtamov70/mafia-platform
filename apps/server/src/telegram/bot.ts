/**
 * Telegram adapter (grammY). Faqat buyruq va tugmalarni qabul qilib, servislarni chaqiradi va javobni ko'rsatadi.
 * O'yin qoidalari bu yerda yo'q (§2.2).
 */
import { Bot, type Context, GrammyError } from 'grammy';
import type { Message, UserFromGetMe } from 'grammy/types';
import { availableNightActions, getRole, GAME_MODES, MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR, ALL_ROLES, type EngineErrorCode, type GameMode, type GameState } from '@mafia/game-engine';
import type { AppEnv } from '@mafia/config';
import type { Db } from '@mafia/database';
import { escapeHtml, t } from '@mafia/localization';
import type { Logger } from '../infra/logger';
import { scrubSecrets } from '../infra/logger';
import type { CommandResult, GameService } from '../game/game.service';
import { loadGroupSettings, saveGroupSettings, setGlobalMinPlayers, type GroupSettingsData } from '../game/group-settings';
import type { LobbyError, LobbyService } from '../game/lobby.service';
import { mafiaVoteMessage, nightActionMessage, targetKeyboard } from '../game/presenter';
import type { QueriesService } from '../game/queries.service';
import type { TgUser, UsersService } from '../game/users.service';
import { decode, encode, type CallbackData } from './callback-data';
import type { AdminChecker } from './helpers';
import { RateLimiter } from './helpers';
import type { Keyboard } from './outbox-types';

export interface BotDeps {
  env: AppEnv;
  db: Db;
  users: UsersService;
  lobby: LobbyService;
  games: GameService;
  queries: QueriesService;
  admin: AdminChecker;
  logger: Logger;
  botUsername: string;
  botInfo?: UserFromGetMe;
}

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

function kb(keyboard: Keyboard) {
  return { reply_markup: { inline_keyboard: keyboard } };
}

function isGroup(ctx: Context): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

export function engineErrorText(e: EngineErrorCode | 'NOT_FOUND' | 'CONFLICT'): string {
  switch (e) {
    case 'STALE_PHASE':
    case 'NOT_FOUND':
      return t('cb.stale');
    case 'GAME_FINISHED':
      return t('cb.finished');
    case 'NOT_A_PLAYER':
      return t('cb.not_player');
    case 'PLAYER_NOT_ALIVE':
      return t('cb.not_alive');
    case 'INVALID_TARGET':
    case 'NOT_MAFIA':
      return t('cb.invalid_target');
    case 'NO_CHARGES':
      return t('cb.no_charges');
    case 'ALREADY_USED':
      return t('cb.already_used');
    case 'CANNOT_VOTE_SELF':
      return t('cb.self_vote');
    case 'WRONG_PHASE':
    case 'NO_SUCH_ACTION':
      return t('cb.wrong_phase');
    default:
      return t('common.error');
  }
}

export function lobbyErrorText(e: LobbyError, details?: Record<string, string | number>): string {
  switch (e) {
    case 'GROUP_ACTIVE_GAME':
      return t('lobby.exists');
    case 'NOT_FOUND':
    case 'NOT_LOBBY':
      return t('lobby.not_found');
    case 'FULL':
      return t('lobby.full');
    case 'NEED_DM':
      return t('lobby.need_dm');
    case 'IN_OTHER_GAME':
      return t('lobby.in_other_game');
    case 'ALREADY_JOINED':
      return t('lobby.already_joined');
    case 'NOT_JOINED':
      return t('lobby.not_joined');
    case 'NO_PERMISSION':
      return t('lobby.no_permission');
    case 'NOT_ENOUGH':
      return t('lobby.not_enough', { min: details?.['min'] ?? MIN_PLAYERS_FLOOR, count: details?.['count'] ?? 0 });
    case 'BANNED':
      return t('common.banned');
    case 'CREATE_FORBIDDEN':
      return t('lobby.create_forbidden');
    case 'DM_FAILED':
      return t('lobby.dm_failed', { names: String(details?.['names'] ?? '') });
  }
}

// ───────────────────────────── Menyular ─────────────────────────────

function mainMenu(): Keyboard {
  const b = (key: string, section: string) => ({ text: t(key), callback_data: encode({ t: 'menu', section }) });
  return [
    [b('menu.play', 'play')],
    [b('menu.profile', 'profile'), b('menu.rating', 'rating')],
    [b('menu.shop', 'shop'), b('menu.inventory', 'inventory')],
    [b('menu.vip', 'vip'), b('menu.daily', 'daily')],
    [b('menu.invite', 'invite')],
    [b('menu.rules', 'rules'), b('menu.settings', 'settings')],
    [b('menu.help', 'help')],
  ];
}

const backRow = () => [{ text: t('common.back'), callback_data: encode({ t: 'menu', section: 'home' }) }];

function rolesText(): string {
  const section = (title: string, cat: string) =>
    `${t(title)}\n${ALL_ROLES.filter((r) => r.category === cat)
      .map((r) => `${r.emoji} <b>${t(`role.${r.code}.name`)}</b> — ${t(`role.${r.code}.desc`)}`)
      .join('\n')}`;
  return [t('rules.roles_title'), section('rules.city', 'CITY'), section('rules.mafia', 'MAFIA'), section('rules.neutral', 'NEUTRAL'), section('rules.special', 'SPECIAL')].join('\n\n');
}

function splitLong(text: string, limit = 3900): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const block of text.split('\n\n')) {
    if ((cur + '\n\n' + block).length > limit && cur) {
      parts.push(cur);
      cur = block;
    } else cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) parts.push(cur);
  return parts;
}

// ───────────────────────────── Guruh sozlamalari paneli ─────────────────────────────

const NIGHT_STEPS = [30, 45, 60, 90, 120, 180];
const DISCUSSION_STEPS = [30, 60, 90, 120, 180, 300];
const VOTING_STEPS = [30, 45, 60, 90, 120];

function nextStep(steps: number[], cur: number): number {
  const i = steps.findIndex((s) => s > cur);
  return i === -1 ? steps[0]! : steps[i]!;
}

function settingsView(s: GroupSettingsData, chatId: number): { text: string; keyboard: Keyboard } {
  const onoff = (v: boolean) => t(v ? 'gsettings.on' : 'gsettings.off');
  const text = t('gsettings.text', {
    mode: t(`mode.${s.mode}`),
    min: s.minPlayers,
    max: s.maxPlayers,
    night: s.nightSec,
    discussion: s.discussionSec,
    voting: s.votingSec,
    verdict: s.verdictSec,
    lobby: s.lobbySec,
    reveal: onoff(s.revealRoles),
    autostart: onoff(s.autostart),
    adminOnly: onoff(s.adminOnlyCreate),
    silenceDead: onoff(s.silenceDead),
    silenceNight: onoff(s.silenceNight),
  });
  const b = (key: string, op: string) => ({ text: t(key), callback_data: encode({ t: 'gs', op, chat: chatId }) });
  return {
    text,
    keyboard: [
      [b('gsettings.btn_mode', 'mode')],
      [b('gsettings.btn_min_minus', 'min-'), b('gsettings.btn_min_plus', 'min+')],
      [b('gsettings.btn_max_minus', 'max-'), b('gsettings.btn_max_plus', 'max+')],
      [b('gsettings.btn_night', 'night'), b('gsettings.btn_discussion', 'disc'), b('gsettings.btn_voting', 'vote')],
      [b('gsettings.btn_reveal', 'reveal'), b('gsettings.btn_autostart', 'auto')],
      [b('gsettings.btn_admin_only', 'admin'), b('gsettings.btn_silence_dead', 'sdead')],
      [b('gsettings.btn_silence_night', 'snight')],
      [b('gsettings.btn_close', 'close')],
    ],
  };
}

const SELECTABLE_MODES: GameMode[] = GAME_MODES.filter((m) => m !== 'TOURNAMENT');

function applySettingsOp(s: GroupSettingsData, op: string): GroupSettingsData {
  const n = { ...s };
  switch (op) {
    case 'mode':
      n.mode = SELECTABLE_MODES[(SELECTABLE_MODES.indexOf(s.mode) + 1) % SELECTABLE_MODES.length]!;
      break;
    case 'min-':
      n.minPlayers = Math.max(MIN_PLAYERS_FLOOR, s.minPlayers - 1);
      break;
    case 'min+':
      n.minPlayers = Math.min(s.maxPlayers, s.minPlayers + 1);
      break;
    case 'max-':
      n.maxPlayers = Math.max(s.minPlayers, s.maxPlayers - 1);
      break;
    case 'max+':
      n.maxPlayers = Math.min(MAX_PLAYERS_CEILING, s.maxPlayers + 1);
      break;
    case 'night':
      n.nightSec = nextStep(NIGHT_STEPS, s.nightSec);
      break;
    case 'disc':
      n.discussionSec = nextStep(DISCUSSION_STEPS, s.discussionSec);
      break;
    case 'vote':
      n.votingSec = nextStep(VOTING_STEPS, s.votingSec);
      break;
    case 'reveal':
      n.revealRoles = !s.revealRoles;
      break;
    case 'auto':
      n.autostart = !s.autostart;
      break;
    case 'admin':
      n.adminOnlyCreate = !s.adminOnlyCreate;
      break;
    case 'sdead':
      n.silenceDead = !s.silenceDead;
      break;
    case 'snight':
      n.silenceNight = !s.silenceNight;
      break;
  }
  return n;
}

// ───────────────────────────── Bot ─────────────────────────────

export function createBot(token: string, deps: BotDeps): Bot {
  const bot = new Bot(token, deps.botInfo ? { botInfo: deps.botInfo } : {});
  const { users, lobby, games, queries, admin, logger } = deps;
  const clickLimiter = new RateLimiter(6, 3000);
  const chatLimiter = new RateLimiter(3, 3000);

  const from = (ctx: Context): TgUser | null => (ctx.from && !ctx.from.is_bot ? (ctx.from as TgUser) : null);

  async function isAdminCtx(ctx: Context): Promise<boolean> {
    if (!ctx.chat || !ctx.from) return false;
    // Anonim admin (guruh nomidan yozgan)
    const sender = (ctx.message as Message | undefined)?.sender_chat;
    if (sender && sender.id === ctx.chat.id) return true;
    return admin.isChatAdmin(ctx.chat.id, ctx.from.id);
  }

  async function replyHtml(ctx: Context, text: string, keyboard?: Keyboard) {
    const replyTo = ctx.message?.message_id;
    return ctx.reply(text, {
      ...HTML,
      ...(keyboard ? kb(keyboard) : {}),
      ...(replyTo && isGroup(ctx) ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    });
  }

  async function safeEdit(ctx: Context, text: string, keyboard?: Keyboard) {
    try {
      await ctx.editMessageText(text, { ...HTML, ...(keyboard ? kb(keyboard) : { reply_markup: { inline_keyboard: [] } }) });
    } catch (e) {
      if (e instanceof GrammyError && e.description.includes('message is not modified')) return;
      throw e;
    }
  }

  // Bot o'zi qo'shilgan / chiqarilgan / admin qilingan
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const status = ctx.myChatMember.new_chat_member.status;
    const oldStatus = ctx.myChatMember.old_chat_member.status;
    const title = 'title' in chat ? chat.title : '';
    if (status === 'left' || status === 'kicked') {
      await deps.db.group.updateMany({ where: { telegramChatId: BigInt(chat.id) }, data: { status: 'LEFT' } });
      return;
    }
    const group = await lobby.ensureGroup(chat.id, title);
    await deps.db.group.update({ where: { id: group.id }, data: { botIsAdmin: status === 'administrator' } });
    if (oldStatus === 'left' || oldStatus === 'kicked') {
      await ctx.reply(t('group.welcome'), HTML).catch(() => undefined);
    }
  });

  bot.on('message:migrate_to_chat_id', async (ctx) => {
    await lobby.migrateChat(ctx.chat.id, ctx.message.migrate_to_chat_id);
  });

  // ───── Shaxsiy chat ─────
  const pm = bot.chatType('private');

  pm.command('start', async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const user = await users.upsert(u, { dmOpened: true });
    const payload = ctx.match.trim();
    const join = /^join_(\d+)$/.exec(payload);
    if (join) {
      const r = await lobby.join({ number: Number(join[1]) }, u, { dmOpened: true });
      if (r.ok) {
        await ctx.reply(t('lobby.joined_dm', { group: escapeHtml(r.groupTitle) }), HTML);
        return;
      }
      if (r.error !== 'ALREADY_JOINED') await ctx.reply(lobbyErrorText(r.error, r.details), HTML);
    }
    await ctx.reply(t('menu.welcome', { name: escapeHtml(user.firstName || 'do‘st') }), { ...HTML, ...kb(mainMenu()) });
  });

  pm.command('help', (ctx) => ctx.reply(t('help.text'), HTML));
  pm.command(['support', 'report', 'paysupport'], (ctx) => ctx.reply(t('support.text'), HTML));
  pm.command('privacy', (ctx) => ctx.reply(t('privacy.text'), HTML));
  pm.command('rules', (ctx) => ctx.reply(t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }), HTML));
  pm.command('roles', async (ctx) => {
    for (const part of splitLong(rolesText())) await ctx.reply(part, HTML);
  });
  pm.command(['profile', 'mystats'], async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const user = await users.upsert(u, { dmOpened: true });
    await ctx.reply(await queries.profileText(user.id), HTML);
  });
  pm.command('delete_me', async (ctx) => {
    await ctx.reply(t('delete.confirm'), {
      ...HTML,
      ...kb([[{ text: t('common.yes'), callback_data: encode({ t: 'delme', op: 'y' }) }, { text: t('common.no'), callback_data: encode({ t: 'delme', op: 'n' }) }]]),
    });
  });

  // Superadmin buyruqlari (bot egasi)
  bot.command('admin_minplayers', async (ctx) => {
    if (!ctx.from || !admin.isSuperadmin(ctx.from.id)) return ctx.reply(t('admin.no_access'));
    const n = Number(ctx.match.trim());
    if (!Number.isInteger(n) || n < MIN_PLAYERS_FLOOR || n > MAX_PLAYERS_CEILING) return ctx.reply(t('admin.min_usage'));
    const v = await setGlobalMinPlayers(deps.db, n, String(ctx.from.id));
    return ctx.reply(t('admin.min_set', { min: v }), HTML);
  });
  bot.command('admin_stats', async (ctx) => {
    if (!ctx.from || !admin.isSuperadmin(ctx.from.id)) return ctx.reply(t('admin.no_access'));
    return ctx.reply(await queries.adminStats(), HTML);
  });

  // Tunda Mafia ichki chati
  pm.on('message:text', async (ctx, next) => {
    // Buyruqlar keyingi handlerlarga o'tadi (masalan, /admin_* buyruqlari)
    if (ctx.message.text.startsWith('/')) return next();
    const u = from(ctx);
    if (!u) return;
    if (!chatLimiter.allow(`chat:${u.id}`)) return;
    const user = await users.byTelegramId(u.id);
    if (!user) return;
    await games.relayMafiaChat(user.id, ctx.message.message_id, ctx.message.text);
  });

  // ───── Guruh ─────
  const grp = bot.chatType(['group', 'supergroup']);

  grp.command('game', async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const arg = ctx.match.trim().toUpperCase();
    const mode = SELECTABLE_MODES.includes(arg as GameMode) ? (arg as GameMode) : undefined;
    const r = await lobby.createLobby({ chatId: ctx.chat.id, title: ctx.chat.title ?? '', host: u, isAdmin: await isAdminCtx(ctx), ...(mode ? { mode } : {}) });
    if (!r.ok) return replyHtml(ctx, lobbyErrorText(r.error, r.details));
    if (!r.hostJoined) return replyHtml(ctx, t('lobby.need_dm'));
    return undefined;
  });

  grp.command('join', async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const r = await lobby.join({ chatId: ctx.chat.id }, u);
    if (!r.ok) await replyHtml(ctx, lobbyErrorText(r.error, r.details));
  });

  grp.command('leave', async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const r = await lobby.leave({ chatId: ctx.chat.id }, u);
    await replyHtml(ctx, r.ok ? t('lobby.left') : lobbyErrorText(r.error));
  });

  grp.command('players', async (ctx) => replyHtml(ctx, await queries.statusText(ctx.chat.id)));
  grp.command('status', async (ctx) => replyHtml(ctx, await queries.statusText(ctx.chat.id)));
  grp.command('rules', (ctx) => replyHtml(ctx, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING })));
  grp.command('help', (ctx) => replyHtml(ctx, t('help.text')));
  grp.command('leaderboard', async (ctx) => replyHtml(ctx, await queries.groupLeaderboard(ctx.chat.id)));
  grp.command('mystats', async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const user = await users.upsert(u);
    await replyHtml(ctx, await queries.profileText(user.id));
  });

  grp.command('gstart', async (ctx) => {
    if (!ctx.from) return;
    const r = await lobby.start({ chatId: ctx.chat.id }, { telegramId: BigInt(ctx.from.id), isAdmin: await isAdminCtx(ctx) });
    if (!r.ok && r.error !== 'DM_FAILED') await replyHtml(ctx, lobbyErrorText(r.error, r.details));
  });

  grp.command('cancelgame', async (ctx) => {
    if (!ctx.from) return;
    const r = await lobby.cancel({ chatId: ctx.chat.id }, { telegramId: BigInt(ctx.from.id), isAdmin: await isAdminCtx(ctx) });
    if (!r.ok) await replyHtml(ctx, lobbyErrorText(r.error));
  });

  grp.command('settings', async (ctx) => {
    if (!(await isAdminCtx(ctx))) return replyHtml(ctx, t('gsettings.only_admin'));
    const group = await lobby.ensureGroup(ctx.chat.id, ctx.chat.title ?? '');
    const s = await loadGroupSettings(deps.db, group.id);
    const view = settingsView(s, ctx.chat.id);
    const note = (s.silenceDead || s.silenceNight) && !group.botIsAdmin ? `\n\n${t('gsettings.no_delete_rights')}` : '';
    return replyHtml(ctx, view.text + note, view.keyboard);
  });

  grp.command('devfill', async (ctx) => {
    if (!deps.env.DEV_FAKE_PLAYERS || !(await isAdminCtx(ctx))) return;
    const n = Math.max(1, Math.min(29, Number(ctx.match.trim()) || 5));
    const r = await lobby.devFill(ctx.chat.id, n);
    await replyHtml(ctx, r.ok ? t('lobby.dev_filled', { count: r.added }) : lobbyErrorText(r.error));
  });

  // O'lganlar va tungi jimlik (§ foydalanuvchi talabi). Bot admin bo'lishi kerak.
  grp.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (!ctx.from || ctx.from.is_bot || msg.text?.startsWith('/')) return next();
    const user = await users.byTelegramId(ctx.from.id);
    if (!user) return next();
    const g = await games.activeRunningGameOf(user.id);
    if (!g || g.chatId !== BigInt(ctx.chat.id)) return next();
    const me = g.state.players.find((p) => p.id === user.id);
    if (!me) return next();
    const group = await deps.db.group.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
    if (!group) return next();
    const s = await loadGroupSettings(deps.db, group.id);
    const dead = me.status !== 'ALIVE';
    const shouldDelete = (dead && s.silenceDead) || (!dead && g.state.phase === 'NIGHT' && s.silenceNight);
    if (!shouldDelete) return next();
    try {
      await ctx.deleteMessage();
    } catch (e) {
      if (group.botIsAdmin) await deps.db.group.update({ where: { id: group.id }, data: { botIsAdmin: false } });
      logger.debug({ err: scrubSecrets(String(e)) }, 'cannot delete message');
    }
    return undefined;
  });

  // ───── Tugmalar ─────
  bot.on('callback_query:data', async (ctx) => {
    const u = from(ctx);
    const data = decode(ctx.callbackQuery.data);
    if (!u || !data) return ctx.answerCallbackQuery({ text: t('cb.stale') });
    if (!clickLimiter.allow(`cb:${u.id}`)) return ctx.answerCallbackQuery({ text: t('common.rate_limited') });
    try {
      await handleCallback(ctx, u, data);
    } catch (e) {
      logger.error({ err: scrubSecrets(String(e)), data: data.t }, 'callback failed');
      await ctx.answerCallbackQuery({ text: t('common.error') }).catch(() => undefined);
    }
    return undefined;
  });

  async function handleCallback(ctx: Context, u: TgUser, data: CallbackData): Promise<void> {
    const tgId = BigInt(u.id);
    switch (data.t) {
      case 'menu':
        await handleMenu(ctx, u, data.section);
        await ctx.answerCallbackQuery();
        return;
      case 'delme': {
        if (data.op === 'n') {
          await safeEdit(ctx, t('menu.welcome', { name: escapeHtml(u.first_name) }), mainMenu());
          await ctx.answerCallbackQuery();
          return;
        }
        const user = await users.upsert(u);
        const busy = await deps.db.gamePlayer.findUnique({ where: { activeUserKey: user.id } });
        if (busy) {
          await ctx.answerCallbackQuery({ text: t('delete.in_game'), show_alert: true });
          return;
        }
        await users.anonymize(user.id);
        await safeEdit(ctx, t('delete.done'));
        await ctx.answerCallbackQuery();
        return;
      }
      case 'lobby': {
        const where = { number: data.game };
        if (data.op === 'j') {
          const r = await lobby.join(where, u);
          await ctx.answerCallbackQuery({ text: r.ok ? t('lobby.joined') : lobbyErrorText(r.error, r.details), show_alert: !r.ok && r.error === 'NEED_DM' });
        } else if (data.op === 'l') {
          const r = await lobby.leave(where, u);
          await ctx.answerCallbackQuery({ text: r.ok ? t('lobby.left') : lobbyErrorText(r.error) });
        } else if (data.op === 's') {
          const r = await lobby.start(where, { telegramId: tgId, isAdmin: await isAdminCtx(ctx) });
          await ctx.answerCallbackQuery(r.ok ? {} : { text: lobbyErrorText(r.error, r.details).replace(/<[^>]+>/g, '').slice(0, 190), show_alert: true });
        } else {
          const r = await lobby.cancel(where, { telegramId: tgId, isAdmin: await isAdminCtx(ctx) });
          await ctx.answerCallbackQuery(r.ok ? {} : { text: lobbyErrorText(r.error) });
        }
        return;
      }
      case 'gs': {
        if (!ctx.chat || ctx.chat.id !== data.chat || !(await isAdminCtx(ctx))) {
          await ctx.answerCallbackQuery({ text: t('gsettings.only_admin'), show_alert: true });
          return;
        }
        if (data.op === 'close') {
          await ctx.deleteMessage().catch(() => undefined);
          await ctx.answerCallbackQuery();
          return;
        }
        const group = await lobby.ensureGroup(ctx.chat.id, 'title' in ctx.chat ? (ctx.chat.title ?? '') : '');
        const cur = await loadGroupSettings(deps.db, group.id);
        const saved = await saveGroupSettings(deps.db, group.id, applySettingsOp(cur, data.op), String(u.id));
        await deps.db.auditLog.create({ data: { actorId: String(u.id), actorType: 'USER', action: `GROUP_SETTINGS_${data.op}`, entityType: 'group_settings', entityId: group.id, beforeJson: cur as object, afterJson: saved as object } });
        const view = settingsView(saved, ctx.chat.id);
        await safeEdit(ctx, view.text, view.keyboard);
        await ctx.answerCallbackQuery({ text: t('gsettings.saved') });
        return;
      }
      case 'vote': {
        const r = await games.dayVote(data.game, tgId, data.seat, data.seq);
        if (!r.ok) {
          await ctx.answerCallbackQuery({ text: engineErrorText(r.error) });
          return;
        }
        const target = data.seat === 0 ? null : r.state.players.find((p) => p.seat === data.seat);
        await ctx.answerCallbackQuery({ text: target ? t('cb.voted', { target: target.name }) : t('cb.voted_none') });
        return;
      }
      case 'mafia': {
        const r = await games.mafiaVote(data.game, tgId, data.seat, data.seq);
        if (!r.ok) {
          await ctx.answerCallbackQuery({ text: engineErrorText(r.error) });
          return;
        }
        const target = data.seat === 0 ? null : r.state.players.find((p) => p.seat === data.seat);
        const still = r.state.phase === 'NIGHT' && r.state.phaseSeq === data.seq;
        const text = `${mafiaVoteMessage(r.state, data.game).text}\n\n${target ? t('dm.mafia_voted', { target: escapeHtml(target.name) }) : t('dm.mafia_vote_skip', { voter: escapeHtml(u.first_name) })}`;
        await safeEdit(ctx, text, still ? mafiaVoteMessage(r.state, data.game).keyboard : undefined);
        await ctx.answerCallbackQuery();
        return;
      }
      case 'mayor': {
        const r = await games.revealMayor(data.game, tgId);
        if (r.ok) await safeEdit(ctx, t('game.mayor', { name: escapeHtml(u.first_name) }));
        await ctx.answerCallbackQuery(r.ok ? {} : { text: engineErrorText(r.error) });
        return;
      }
      case 'veto': {
        const r = await games.judgeVeto(data.game, tgId, data.seq);
        if (r.ok) await safeEdit(ctx, t('dm.judge_done'));
        await ctx.answerCallbackQuery(r.ok ? {} : { text: engineErrorText(r.error) });
        return;
      }
      case 'skip': {
        const r = await games.skip(data.game, tgId, data.seq);
        await afterNightCommand(ctx, r, data.game, data.seq, t('dm.skipped'));
        return;
      }
      case 'action':
        await handleAction(ctx, u, data);
        return;
    }
  }

  async function handleAction(ctx: Context, u: TgUser, data: Extract<CallbackData, { t: 'action' }>): Promise<void> {
    const peek = await games.peek(data.game);
    const state = peek?.state;
    if (!peek || !state || state.phaseSeq !== data.seq || state.status !== 'RUNNING') {
      await ctx.answerCallbackQuery({ text: t('cb.stale') });
      return;
    }
    const user = await users.byTelegramId(u.id);
    const player = user ? state.players.find((p) => p.id === user.id) : undefined;
    if (!player) {
      await ctx.answerCallbackQuery({ text: t('cb.not_player') });
      return;
    }
    const spec = availableNightActions(state, player).find((s) => s.kind === data.kind);
    if (!spec) {
      await ctx.answerCallbackQuery({ text: t('cb.wrong_phase') });
      return;
    }
    const needs = spec.targets.count;
    if (data.seats.length < needs) {
      const emoji = getRole(player.role).emoji;
      const role = t(`role.${player.role}.name`);
      const first = data.seats[0] ? state.players.find((p) => p.seat === data.seats[0]) : undefined;
      const text = first
        ? t('dm.night_second', { emoji, role, first: escapeHtml(first.name) })
        : t('dm.night_prompt', { emoji, role, prompt: t(`role.${player.role}.prompt`) || t(`action.${data.kind}`) });
      await safeEdit(ctx, text, targetKeyboard(state, player, data.game, data.kind, data.seats));
      await ctx.answerCallbackQuery();
      return;
    }
    const r = await games.nightAction(data.game, BigInt(u.id), data.kind, data.seats, data.seq);
    const names = data.seats.map((s) => state.players.find((p) => p.seat === s)?.name ?? '?');
    const accepted = spec.targets.self === 'only' ? t('dm.accepted_self') : t('dm.accepted', { target: escapeHtml(names.join(', ')) });
    await afterNightCommand(ctx, r, data.game, data.seq, accepted);
  }

  async function afterNightCommand(ctx: Context, r: CommandResult, gameNumber: number, seq: number, acceptedText: string): Promise<void> {
    if (!r.ok) {
      await ctx.answerCallbackQuery({ text: engineErrorText(r.error) });
      return;
    }
    const state: GameState = r.state;
    const me = state.players.find((p) => p.id === r.playerId);
    const still = state.phase === 'NIGHT' && state.phaseSeq === seq && me;
    const head = me ? `${getRole(me.role).emoji} <b>${t(`role.${me.role}.name`)}</b>\n\n` : '';
    const view = still ? nightActionMessage(state, me, gameNumber) : null;
    await safeEdit(ctx, head + acceptedText, view?.keyboard);
    await ctx.answerCallbackQuery();
  }

  async function handleMenu(ctx: Context, u: TgUser, section: string): Promise<void> {
    const user = await users.upsert(u, ctx.chat?.type === 'private' ? { dmOpened: true } : {});
    switch (section) {
      case 'home':
        return safeEdit(ctx, t('menu.welcome', { name: escapeHtml(user.firstName || 'do‘st') }), mainMenu());
      case 'play':
        return safeEdit(ctx, t('play.text'), [
          ...(deps.botUsername ? [[{ text: t('play.add_to_group'), url: `https://t.me/${deps.botUsername}?startgroup=true` }]] : []),
          [{ text: t('play.rules'), callback_data: encode({ t: 'menu', section: 'rules' }) }],
          backRow(),
        ]);
      case 'profile':
        return safeEdit(ctx, await queries.profileText(user.id), [backRow()]);
      case 'rating':
        return safeEdit(ctx, await queries.globalRating(user.id), [backRow()]);
      case 'rules':
        return safeEdit(ctx, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }), [
          [{ text: '🎭 /roles', callback_data: encode({ t: 'menu', section: 'roles' }) }],
          backRow(),
        ]);
      case 'roles': {
        const parts = splitLong(rolesText());
        await safeEdit(ctx, parts[0]!, parts.length === 1 ? [backRow()] : undefined);
        for (let i = 1; i < parts.length; i++) await ctx.reply(parts[i]!, { ...HTML, ...(i === parts.length - 1 ? kb([backRow()]) : {}) });
        return;
      }
      case 'settings':
        return safeEdit(ctx, t('settings.text'), [backRow()]);
      case 'help':
        return safeEdit(ctx, t('help.text'), [backRow()]);
      case 'shop':
      case 'inventory':
      case 'vip':
      case 'daily':
      case 'invite':
        return safeEdit(ctx, t('common.soon', { section: t(`menu.${section}`) }), [backRow()]);
      default:
        return safeEdit(ctx, t('menu.welcome', { name: escapeHtml(user.firstName) }), mainMenu());
    }
  }

  bot.catch((err) => {
    logger.error({ err: scrubSecrets(String(err.error)), update: err.ctx.update.update_id }, 'bot handler error');
  });

  return bot;
}

/** BotFather buyruqlar menyusi (guruh va shaxsiy chat uchun alohida) va bot tavsifi — §3.3 */
export async function registerCommands(bot: Bot): Promise<void> {
  await bot.api.setMyDescription(t('bot.description'));
  await bot.api.setMyShortDescription(t('bot.short_description'));
  await bot.api.setMyCommands(
    [
      { command: 'start', description: 'Bosh menyu' },
      { command: 'profile', description: 'Mening profilim' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'roles', description: 'Rollar' },
      { command: 'help', description: 'Yordam' },
      { command: 'privacy', description: 'Maxfiylik' },
    ],
    { scope: { type: 'all_private_chats' } },
  );
  await bot.api.setMyCommands(
    [
      { command: 'game', description: 'Yangi o‘yin yaratish' },
      { command: 'join', description: 'O‘yinga qo‘shilish' },
      { command: 'leave', description: 'O‘yindan chiqish' },
      { command: 'players', description: 'Ishtirokchilar' },
      { command: 'gstart', description: 'O‘yinni boshlash' },
      { command: 'status', description: 'O‘yin holati' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'mystats', description: 'Mening statistikam' },
      { command: 'leaderboard', description: 'Guruh reytingi' },
      { command: 'cancelgame', description: 'O‘yinni bekor qilish' },
      { command: 'settings', description: 'Guruh sozlamalari' },
    ],
    { scope: { type: 'all_group_chats' } },
  );
}

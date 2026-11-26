/**
 * Telegram adapter (grammY). Faqat buyruq va tugmalarni qabul qilib, servislarni chaqiradi va javobni ko'rsatadi.
 * O'yin qoidalari bu yerda yo'q (§2.2).
 */
import { Bot, type Context, GrammyError } from 'grammy';
import type { Message, UserFromGetMe } from 'grammy/types';
import { availableNightActions, getRole, MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR, type GameMode, type GameState } from '@mafia/game-engine';
import {
  applySettingsOp,
  backRow,
  decode,
  encode,
  engineErrorText,
  lobbyErrorText,
  mafiaVoteMessage,
  mainMenu,
  nightActionMessage,
  rolesText,
  referenceRolesView,
  referenceRoleDetail,
  learningView,
  SELECTABLE_MODES,
  settingsView,
  splitLong,
  targetKeyboard,
  type CallbackData,
  type Keyboard,
} from '@mafia/bot-core';
import type { AppEnv } from '@mafia/config';
import type { Db } from '@mafia/database';
import { escapeHtml, t } from '@mafia/localization';
import type { Logger } from '../infra/logger';
import { scrubSecrets } from '../infra/logger';
import type { CommandResult, GameService } from '../game/game.service';
import { loadGroupSettings, saveGroupSettings, setGlobalMinPlayers } from '../game/group-settings';
import type { LobbyService } from '../game/lobby.service';
import type { QueriesService } from '../game/queries.service';
import type { TgUser, UsersService } from '../game/users.service';
import type { AdminChecker } from './helpers';
import { RateLimiter } from './helpers';

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
  pm.command('characters', (ctx) => { const view = learningView('characters')!; return ctx.reply(view.text, { ...HTML, ...kb(view.keyboard) }); });
  pm.command('guide', (ctx) => { const view = learningView('guide')!; return ctx.reply(view.text, { ...HTML, ...kb(view.keyboard) }); });
  pm.command('roles', (ctx) => {const view=referenceRolesView();return ctx.reply(view.text,{...HTML,...kb(view.keyboard)});});
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

  grp.command('quick', async (ctx) => {
    const u = from(ctx);
    if (!u) return;
    const r = await lobby.createLobby({ chatId: ctx.chat.id, title: ctx.chat.title ?? '', host: u, isAdmin: await isAdminCtx(ctx), mode: 'PRIVATE', quick: true });
    if (!r.ok) return replyHtml(ctx, lobbyErrorText(r.error, r.details));
    if (!r.hostJoined) return replyHtml(ctx, t('lobby.need_dm'));
    return undefined;
  });

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

  grp.command('startgame', async (ctx) => {
    if (!ctx.from) return;
    const r = await lobby.start({ chatId: ctx.chat.id }, { telegramId: BigInt(ctx.from.id), isAdmin: await isAdminCtx(ctx) });
    if (!r.ok && r.error !== 'DM_FAILED') await replyHtml(ctx, lobbyErrorText(r.error, r.details));
  });

  grp.command(['stop', 'cancelgame'], async (ctx) => {
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
      case 'menu': {
        if(data.section.startsWith('ref_')) {
          const role=referenceRoleDetail(data.section);
          if(!role||ctx.chat?.type!=='private'||ctx.chat.id!==u.id){await ctx.answerCallbackQuery({text:t('cb.stale')});return;}
          if(role.alert){await ctx.answerCallbackQuery({text:role.text,show_alert:true});return;}
          await ctx.reply(escapeHtml(role.text),HTML);
          await ctx.answerCallbackQuery();return;
        }
        await handleMenu(ctx, u, data.section);
        await ctx.answerCallbackQuery();
        return;
      }
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
          await ctx.answerCallbackQuery({text:t('cb.stale'),show_alert:true});
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
      case 'eco':
        // Iqtisodiyot hozircha Cloudflare versiyasida; VPS versiyasiga o'tishda qo'shiladi
        await ctx.answerCallbackQuery({ text: t('common.soon', { section: '' }).replace(/<[^>]+>/g, '').slice(0, 190) });
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
    const learning = learningView(section);
    if (learning) return safeEdit(ctx, learning.text, learning.keyboard);
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
          [{ text: t('menu.characters'), callback_data: encode({ t: 'menu', section: 'characters' }) }],
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
      { command: 'characters', description: 'Personajlar katalogi' },
      { command: 'guide', description: 'Boshlovchilar qo‘llanmasi' },
      { command: 'help', description: 'Yordam' },
      { command: 'privacy', description: 'Maxfiylik' },
    ],
    { scope: { type: 'all_private_chats' } },
  );
  await bot.api.setMyCommands(
    [
      { command: 'game', description: 'Yangi o‘yin yaratish' },
      { command: 'quick', description: 'Tezkor, reytingsiz o‘yin' },
      { command: 'join', description: 'O‘yinga qo‘shilish' },
      { command: 'leave', description: 'O‘yindan chiqish' },
      { command: 'players', description: 'Ishtirokchilar' },
      { command: 'startgame', description: 'O‘yinni boshlash (admin)' },
      { command: 'status', description: 'O‘yin holati' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'mystats', description: 'Mening statistikam' },
      { command: 'leaderboard', description: 'Guruh reytingi' },
      { command: 'stop', description: 'O‘yinni to‘xtatish (admin)' },
      { command: 'settings', description: 'Guruh sozlamalari' },
    ],
    { scope: { type: 'all_group_chats' } },
  );
}

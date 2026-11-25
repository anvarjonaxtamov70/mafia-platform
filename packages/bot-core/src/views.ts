/**
 * Runtime-mustaqil ko'rinishlar: menyular, lobby xabari, xato matnlari.
 */
import { ALL_ROLES, MIN_PLAYERS_FLOOR, type EngineErrorCode, type GameConfig } from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import { encode } from './callback-data';
import type { Keyboard } from './outbox-types';

export function displayName(u: { firstName: string; lastName?: string | null; username?: string | null }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const name = full || (u.username ? `@${u.username}` : 'O‘yinchi');
  return name.slice(0, 32);
}

// ───────────────────────────── Menyular ─────────────────────────────

export function mainMenu(competition = false, visuals = false, heroes = false): Keyboard {
  const b = (key: string, section: string) => ({ text: t(key), callback_data: encode({ t: 'menu', section }) });
  return [
    [b('menu.play', 'play')],
    [b('menu.profile', 'profile'), b('menu.rating', 'rating')],
    ...(heroes ? [[b('hero.menu', 'hero'), b('hero.collection', 'heroes')]] : []),
    ...(competition ? [[b('menu.history', 'history')]] : []),
    [b('menu.shop', 'shop'), b('menu.inventory', 'inventory')],
    [b('menu.vip', 'vip'), b('menu.daily', 'daily')],
    [b('menu.invite', 'invite')],
    [b('menu.characters', 'characters'), b('menu.guide', 'guide')],
    ...(visuals ? [[b('visual.intro_button', 'intro')]] : []),
    [b('menu.rules', 'rules'), b('menu.settings', 'settings')],
    [b('menu.help', 'help')],
  ];
}

export const backRow = () => [{ text: t('common.back'), callback_data: encode({ t: 'menu', section: 'home' }) }];

/** Interaktiv katalog va qo‘llanma: Telegram xabarlari, Mini App talab qilinmaydi. */
export function learningView(section: string, visuals = false): { text: string; keyboard: Keyboard } | null {
  const button = (text: string, section: string) => ({ text, callback_data: encode({ t: 'menu', section }) });
  const categories = ['CITY', 'MAFIA', 'NEUTRAL', 'SPECIAL'] as const;
  if (section === 'guide') {
    return { text: t('guide.text'), keyboard: [[button(t('menu.characters'), 'characters')], [button(t('menu.rules'), 'rules')], backRow()] };
  }
  if (section === 'characters') {
    return {
      text: t('characters.home', { count: ALL_ROLES.length }),
      keyboard: [...categories.map((c) => [button(t('rules.' + c.toLowerCase()).replace(/<[^>]+>/g, '') + ' · ' + ALL_ROLES.filter((r) => r.category === c).length, 'roles_' + c.toLowerCase())]), backRow()],
    };
  }
  const category = categories.find((c) => section === 'roles_' + c.toLowerCase());
  if (category) {
    const roles = ALL_ROLES.filter((r) => r.category === category);
    return {
      text: t('rules.' + category.toLowerCase()) + '\n\n' + t('characters.select'),
      keyboard: [...roles.map((r) => [button(r.emoji + ' ' + t('role.' + r.code + '.name'), 'role_' + r.code.toLowerCase())]), [button(t('common.back'), 'characters')]],
    };
  }
  if (section.startsWith('role_')) {
    const role = ALL_ROLES.find((r) => section === 'role_' + r.code.toLowerCase());
    if (!role) return null;
    return {
      text: role.emoji + ' <b>' + t('role.' + role.code + '.name') + '</b>\n\n' + t('role.' + role.code + '.desc') + '\n\n' + t('characters.minimum', { count: Math.max(MIN_PLAYERS_FLOOR, role.minPlayers) }) + '\n' + t('characters.modes', { modes: role.modes.map((m) => t('mode.' + m)).join(', ') }),
      keyboard: [...(visuals ? [[button(t('visual.card_button'), 'art_' + role.code.toLowerCase())]] : []), [button(t('common.back'), 'roles_' + role.category.toLowerCase())], backRow()],
    };
  }
  return null;
}

export function rolesText(): string {
  const section = (title: string, cat: string) =>
    `${t(title)}\n${ALL_ROLES.filter((r) => r.category === cat)
      .map((r) => `${r.emoji} <b>${t(`role.${r.code}.name`)}</b> — ${t(`role.${r.code}.desc`)}`)
      .join('\n')}`;
  return [t('rules.roles_title'), section('rules.city', 'CITY'), section('rules.mafia', 'MAFIA'), section('rules.neutral', 'NEUTRAL'), section('rules.special', 'SPECIAL')].join('\n\n');
}

export function splitLong(text: string, limit = 3900): string[] {
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

export const SOON_SECTIONS = ['shop', 'inventory', 'vip', 'daily', 'invite'] as const;

// ───────────────────────────── Lobby ─────────────────────────────

export interface LobbySnapshot {
  lobbySec: number;
  autostart: boolean;
  quick?: boolean;
}

export type ConfigSnapshot = GameConfig & { lobby: LobbySnapshot };

export interface LobbyViewInput {
  number: number;
  mode: string;
  config: ConfigSnapshot;
  hostName: string;
  deadline: number | null;
}

export function renderLobby(game: LobbyViewInput, names: string[], opts: { now: number; botUsername: string }): { text: string; keyboard: Keyboard } {
  const min = game.config.minPlayers;
  const list = names.length ? names.map((n, i) => `${i + 1}. ${escapeHtml(n)} ✅`).join('\n') : t('lobby.empty_list');
  const secondsLeft = game.deadline ? Math.max(0, Math.round((game.deadline - opts.now) / 1000)) : 0;
  const hint =
    names.length < min
      ? t('lobby.need_more', { min })
      : game.config.lobby.autostart
        ? t('lobby.ready', { seconds: secondsLeft })
        : t('lobby.ready_manual');
  const text = (game.config.lobby.quick ? t('quick.banner') + '\n\n' : '') + t('lobby.title', {
    host: escapeHtml(game.hostName),
    mode: t(`mode.${game.mode}`),
    count: names.length,
    max: game.config.maxPlayers,
    list,
    hint,
  });
  const keyboard: Keyboard = [
    [
      { text: t('lobby.join'), callback_data: encode({ t: 'lobby', op: 'j', game: game.number }) },
      { text: t('lobby.leave'), callback_data: encode({ t: 'lobby', op: 'l', game: game.number }) },
    ],
    [
      { text: t('lobby.start'), callback_data: encode({ t: 'lobby', op: 's', game: game.number }) },
      { text: t('lobby.cancel'), callback_data: encode({ t: 'lobby', op: 'c', game: game.number }) },
    ],
  ];
  if (opts.botUsername) {
    keyboard.push([{ text: t('lobby.open_bot'), url: `https://t.me/${opts.botUsername}?start=join_${game.number}` }]);
  }
  return { text, keyboard };
}

// ───────────────────────────── Xato matnlari ─────────────────────────────

export type LobbyError =
  | 'GROUP_ACTIVE_GAME'
  | 'NOT_FOUND'
  | 'NOT_LOBBY'
  | 'FULL'
  | 'NEED_DM'
  | 'IN_OTHER_GAME'
  | 'ALREADY_JOINED'
  | 'NOT_JOINED'
  | 'NO_PERMISSION'
  | 'NOT_ENOUGH'
  | 'BANNED'
  | 'CREATE_FORBIDDEN'
  | 'DM_FAILED';

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

/** Callback javobi uchun: HTML teglarsiz, 200 belgigacha */
export function plainAlert(text: string): string {
  return text.replace(/<[^>]+>/g, '').slice(0, 190);
}

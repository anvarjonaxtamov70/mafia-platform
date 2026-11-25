/**
 * Guruh sozlamalari: tiplar, standartlar, normallashtirish va /settings paneli (runtime-mustaqil).
 */
import { buildConfig, GAME_MODES, MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR, type GameConfig, type GameMode } from '@mafia/game-engine';
import { t } from '@mafia/localization';
import { encode } from './callback-data';
import type { Keyboard } from './outbox-types';

export interface GroupSettingsData {
  mode: GameMode;
  minPlayers: number;
  maxPlayers: number;
  nightSec: number;
  discussionSec: number;
  votingSec: number;
  verdictSec: number;
  lobbySec: number;
  revealRoles: boolean;
  autostart: boolean;
  adminOnlyCreate: boolean;
  silenceDead: boolean;
  silenceNight: boolean;
}

export const DEFAULT_MIN_PLAYERS_KEY = 'defaultMinPlayers';

export function defaultGroupSettings(minPlayers = MIN_PLAYERS_FLOOR): GroupSettingsData {
  return {
    mode: 'CLASSIC',
    minPlayers,
    maxPlayers: 20,
    nightSec: 90,
    discussionSec: 120,
    votingSec: 60,
    verdictSec: 15,
    lobbySec: 180,
    revealRoles: true,
    autostart: true,
    adminOnlyCreate: false,
    silenceDead: true,
    silenceNight: true,
  };
}

const clamp = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : d;
  return Math.min(hi, Math.max(lo, v));
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export function clampMinPlayers(n: number): number {
  return Math.max(MIN_PLAYERS_FLOOR, Math.min(MAX_PLAYERS_CEILING, Math.round(n)));
}

/** Saqlangan JSON ni xavfsiz qiymatlarga keltiradi (qo'lda tahrirlangan noto'g'ri qiymatlar ham). */
export function normalizeSettings(raw: unknown, globalMin = MIN_PLAYERS_FLOOR): GroupSettingsData {
  const d = defaultGroupSettings(globalMin);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = GAME_MODES.includes(r['mode'] as GameMode) ? (r['mode'] as GameMode) : d.mode;
  const minPlayers = clamp(r['minPlayers'], MIN_PLAYERS_FLOOR, MAX_PLAYERS_CEILING, d.minPlayers);
  return {
    mode,
    minPlayers,
    maxPlayers: clamp(r['maxPlayers'], minPlayers, MAX_PLAYERS_CEILING, Math.max(minPlayers, d.maxPlayers)),
    nightSec: clamp(r['nightSec'], 20, 600, d.nightSec),
    discussionSec: clamp(r['discussionSec'], 15, 900, d.discussionSec),
    votingSec: clamp(r['votingSec'], 15, 600, d.votingSec),
    verdictSec: clamp(r['verdictSec'], 5, 120, d.verdictSec),
    lobbySec: clamp(r['lobbySec'], 30, 1800, d.lobbySec),
    revealRoles: bool(r['revealRoles'], d.revealRoles),
    autostart: bool(r['autostart'], d.autostart),
    adminOnlyCreate: bool(r['adminOnlyCreate'], d.adminOnlyCreate),
    silenceDead: bool(r['silenceDead'], d.silenceDead),
    silenceNight: bool(r['silenceNight'], d.silenceNight),
  };
}

export function settingsToConfig(s: GroupSettingsData, mode: GameMode = s.mode, quick = false): GameConfig {
  return buildConfig(mode, {
    minPlayers: s.minPlayers,
    maxPlayers: s.maxPlayers,
    nightDurationSec: quick ? 45 : s.nightSec,
    discussionDurationSec: quick ? 60 : s.discussionSec,
    votingDurationSec: quick ? 30 : s.votingSec,
    verdictDurationSec: quick ? 10 : s.verdictSec,
    ...(quick ? { ranked: false, allowArcadeItems: false } : {}),
    revealRolesOnDeath: s.revealRoles,
  });
}

// ───────────────────────────── /settings paneli ─────────────────────────────

const NIGHT_STEPS = [30, 45, 60, 90, 120, 180];
const DISCUSSION_STEPS = [30, 60, 90, 120, 180, 300];
const VOTING_STEPS = [30, 45, 60, 90, 120];

function nextStep(steps: number[], cur: number): number {
  const i = steps.findIndex((s) => s > cur);
  return i === -1 ? steps[0]! : steps[i]!;
}

export const SELECTABLE_MODES: GameMode[] = GAME_MODES.filter((m) => m !== 'TOURNAMENT');

export function settingsView(s: GroupSettingsData, chatId: number): { text: string; keyboard: Keyboard } {
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

export function applySettingsOp(s: GroupSettingsData, op: string): GroupSettingsData {
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

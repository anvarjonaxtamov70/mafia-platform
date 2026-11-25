/**
 * callback_data kodlash (Telegram limiti: 64 bayt). Ma'lumot faqat "nima bosildi"ni bildiradi;
 * kim bosgani ctx.from dan olinadi va barcha ruxsatlar serverda tekshiriladi (§31.3).
 */
import type { ActionKind } from '@mafia/game-engine';

const ACTION_CODES: Record<ActionKind, string> = {
  COMMISSAR_CHECK: 'CC',
  DOCTOR_HEAL: 'DH',
  SHERIFF_ARREST: 'SA',
  BODYGUARD_GUARD: 'BG',
  DETECTIVE_TRACK: 'DT',
  JOURNALIST_COMPARE: 'JC',
  WATCHER_WATCH: 'WW',
  PRIEST_CLEANSE: 'PC',
  AVENGER_MARK: 'AM',
  ENGINEER_INSTALL: 'EI',
  CONSIGLIERE_CHECK: 'KC',
  LAWYER_MASK: 'LM',
  SPY_TRACK: 'ST',
  FORGER_FRAME: 'FF',
  BLOCKER_BLOCK: 'BB',
  MAFIA_GUARD_PROTECT: 'MG',
  SERIAL_KILLER_KILL: 'SK',
  THIEF_STEAL: 'TS',
  HUNTER_SHOT: 'HS',
  WIZARD_MIRAGE: 'WM',
  WIZARD_BARRIER: 'WB',
  LONE_WOLF_SHIELD: 'LW',
  CUPID_LINK: 'CL',
};

const CODE_TO_ACTION = new Map<string, ActionKind>(
  Object.entries(ACTION_CODES).map(([k, v]) => [v, k as ActionKind]),
);

export type CallbackData =
  | { t: 'action'; game: number; seq: number; kind: ActionKind; seats: number[] }
  | { t: 'skip'; game: number; seq: number }
  | { t: 'mafia'; game: number; seq: number; seat: number }
  | { t: 'vote'; game: number; seq: number; seat: number }
  | { t: 'mayor'; game: number }
  | { t: 'veto'; game: number; seq: number }
  | { t: 'lobby'; op: 'j' | 'l' | 's' | 'c'; game: number }
  | { t: 'menu'; section: string }
  | { t: 'gs'; op: string; chat: number }
  | { t: 'delme'; op: 'y' | 'n' }
  /** Iqtisodiyot: do'kon, inventar, kunlik mukofot, VIP. op — kichik harflar, arg — katalog kodi */
  | { t: 'eco'; op: string; arg: string };

const int = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : null);

export function encode(d: CallbackData): string {
  let out: string;
  switch (d.t) {
    case 'action':
      out = `a:${d.game}:${d.seq}:${ACTION_CODES[d.kind]}${d.seats.length ? `:${d.seats.join('.')}` : ''}`;
      break;
    case 'skip':
      out = `a:${d.game}:${d.seq}:SKIP`;
      break;
    case 'mafia':
      out = `mv:${d.game}:${d.seq}:${d.seat}`;
      break;
    case 'vote':
      out = `v:${d.game}:${d.seq}:${d.seat}`;
      break;
    case 'mayor':
      out = `my:${d.game}`;
      break;
    case 'veto':
      out = `jv:${d.game}:${d.seq}`;
      break;
    case 'lobby':
      out = `l:${d.op}:${d.game}`;
      break;
    case 'menu':
      out = `m:${d.section}`;
      break;
    case 'gs':
      out = `gs:${d.op}:${d.chat}`;
      break;
    case 'delme':
      out = `dm:${d.op}`;
      break;
    case 'eco':
      if (!/^[a-z]{1,8}$/.test(d.op) || !/^[A-Z0-9_]{0,24}$/.test(d.arg)) throw new Error('invalid eco callback');
      out = `e:${d.op}:${d.arg}`;
      break;
  }
  if (Buffer.byteLength(out, 'utf8') > 64) throw new Error('callback_data too long');
  return out;
}

export function decode(raw: string): CallbackData | null {
  if (Buffer.byteLength(raw, 'utf8') > 64) return null;
  const p = raw.split(':');
  switch (p[0]) {
    case 'a': {
      const game = int(p[1]);
      const seq = int(p[2]);
      if (p.length < 4 || p.length > 5 || game === null || seq === null || !p[3]) return null;
      if (p[3] === 'SKIP') return p.length === 4 ? { t: 'skip', game, seq } : null;
      const kind = CODE_TO_ACTION.get(p[3]);
      if (!kind) return null;
      const seats = p[4] ? p[4].split('.').map((x) => int(x)) : [];
      if (seats.some((s) => s === null) || seats.length > 2) return null;
      return { t: 'action', game, seq, kind, seats: seats as number[] };
    }
    case 'mv':
    case 'v': {
      const game = int(p[1]);
      const seq = int(p[2]);
      const seat = int(p[3]);
      if (p.length !== 4 || game === null || seq === null || seat === null) return null;
      return { t: p[0] === 'mv' ? 'mafia' : 'vote', game, seq, seat };
    }
    case 'my': {
      const game = int(p[1]);
      return p.length !== 2 || game === null ? null : { t: 'mayor', game };
    }
    case 'jv': {
      const game = int(p[1]);
      const seq = int(p[2]);
      return p.length !== 3 || game === null || seq === null ? null : { t: 'veto', game, seq };
    }
    case 'l': {
      const game = int(p[2]);
      if (p.length !== 3 || game === null || !['j', 'l', 's', 'c'].includes(p[1] ?? '')) return null;
      return { t: 'lobby', op: p[1] as 'j' | 'l' | 's' | 'c', game };
    }
    case 'm':
      return p.length === 2 && p[1] && /^[a-z_]{1,20}$/.test(p[1]) ? { t: 'menu', section: p[1] } : null;
    case 'gs': {
      const chat = int(p[2]?.replace(/^-/, ''));
      if (p.length !== 3 || !p[1] || !/^-?\d+$/.test(p[2] ?? '') || chat === null || chat === 0) return null;
      return { t: 'gs', op: p[1], chat: p[2]!.startsWith('-') ? -chat : chat };
    }
    case 'dm':
      return p.length === 2 && (p[1] === 'y' || p[1] === 'n') ? { t: 'delme', op: p[1] } : null;
    case 'e': {
      const op = p[1] ?? '';
      const arg = p[2] ?? '';
      if (p.length > 3 || !/^[a-z]{1,8}$/.test(op) || !/^[A-Z0-9_]{0,24}$/.test(arg)) return null;
      return { t: 'eco', op, arg };
    }
    default:
      return null;
  }
}

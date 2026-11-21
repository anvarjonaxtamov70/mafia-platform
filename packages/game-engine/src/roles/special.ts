/**
 * Maxsus shahar rollari — 3 ta (§10). G'alaba nuqtayi nazaridan SHAHAR.
 */
import { ADVANCED_ONLY, role } from './role';

const SPECIAL_MODES = [...ADVANCED_ONLY, 'TOURNAMENT' as const];

export const Cupid = role({
  code: 'CUPID',
  faction: 'CITY',
  category: 'SPECIAL',
  emoji: '💘',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: SPECIAL_MODES,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'CUPID_LINK',
      stage: 'PREP',
      order: 1,
      targets: { count: 2, self: 'forbid' },
      visits: true,
      // Faqat birinchi tun. Tanlov bo'lmasa (yoki bloklansa) server tasodifiy bog'laydi (Q15).
      available: ({ nightNumber }) => nightNumber === 1,
      resolve(api, a) {
        const [x, y] = a.record.targetIds as [string, string];
        api.linkLovers(x, y, false);
      },
    },
  ],
});

export const Twin = role({
  code: 'TWIN',
  faction: 'CITY',
  category: 'SPECIAL',
  emoji: '👯',
  unique: true,
  slots: 2,
  minPlayers: 12,
  modes: SPECIAL_MODES,
  weight: 3,
  blocksMainWin: false,
  isNeutralKiller: false,
});

/** Feniks passiv: qayta tirilish resolverda eng oxirgi himoya sifatida qo'shiladi. */
export const Phoenix = role({
  code: 'PHOENIX',
  faction: 'CITY',
  category: 'SPECIAL',
  emoji: '🔥',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: SPECIAL_MODES,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
});

export const SPECIAL_ROLES = [Cupid, Twin, Phoenix];

/**
 * Mafia jamoasi — 8 ta rol (§8).
 * Jamoaviy tungi hujum (§13) rollarning individual harakatlaridan alohida: night/resolver.ts.
 */
import { always, ALL_MODES, ADVANCED_ONLY, hasCharge, role } from './role';

const ADVANCED_MAFIA = [...ADVANCED_ONLY, 'TOURNAMENT' as const];

export const Mafioso = role({
  code: 'MAFIOSO',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '🔫',
  unique: false,
  slots: 1,
  minPlayers: 0,
  modes: ALL_MODES,
  weight: 0,
  blocksMainWin: false,
  isNeutralKiller: false,
});

export const Don = role({
  code: 'DON',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '🎩',
  unique: true,
  slots: 1,
  minPlayers: 0,
  modes: ALL_MODES,
  weight: 0,
  blocksMainWin: false,
  isNeutralKiller: false,
});

export const Consigliere = role({
  code: 'CONSIGLIERE',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '🧠',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: ADVANCED_MAFIA,
  weight: 6,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'CONSIGLIERE_CHECK',
      stage: 'INFO',
      order: 2,
      targets: { count: 1, self: 'forbid', excludeFaction: 'MAFIA' },
      visits: true,
      available: always,
      // Aniq rol — hech qanday aldov ta'sir qilmaydi (Q6)
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.deferMafia(a.actor.id, { type: 'ROLE_RESULT', targetId: t, role: api.player(t).role });
      },
    },
  ],
});

export const Lawyer = role({
  code: 'LAWYER',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '💼',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_MAFIA,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  initialAbility: () => ({ charges: { mask: 1 } }),
  night: [
    {
      kind: 'LAWYER_MASK',
      stage: 'DECEIVE',
      order: 1,
      targets: { count: 1, self: 'allow', onlyFaction: 'MAFIA' },
      visits: true,
      available: ({ player }) => hasCharge(player, 'mask'),
      resolve(api, a) {
        api.addDeception('LAWYER', a.record.targetIds[0]!, 'CITY');
        api.consumeCharge(a.actor.id, 'mask');
      },
    },
  ],
});

export const Spy = role({
  code: 'SPY',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '🕶',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_MAFIA,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'SPY_TRACK',
      stage: 'INFO',
      order: 4,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.deferMafia(a.actor.id, { type: 'TRACK_RESULT', source: 'SPY', targetId: t, visitedIds: api.visitsBy(t) });
      },
    },
  ],
});

export const Forger = role({
  code: 'FORGER',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '📜',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_MAFIA,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  initialAbility: () => ({ charges: { frame: 1 } }),
  night: [
    {
      kind: 'FORGER_FRAME',
      stage: 'DECEIVE',
      order: 2,
      targets: { count: 1, self: 'allow' },
      visits: true,
      available: ({ player }) => hasCharge(player, 'frame'),
      resolve(api, a) {
        api.addDeception('FORGER', a.record.targetIds[0]!, 'MAFIA');
        api.consumeCharge(a.actor.id, 'frame');
      },
    },
  ],
});

export const Blocker = role({
  code: 'BLOCKER',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '⛓',
  unique: true,
  slots: 1,
  minPlayers: 8,
  modes: ADVANCED_MAFIA,
  weight: 6,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'BLOCKER_BLOCK',
      stage: 'BLOCK',
      order: 2,
      targets: { count: 1, self: 'forbid', noConsecutive: true },
      visits: true,
      available: always,
      // Blok resolverda bir vaqtda qo'llanadi; qo'shimcha natija yo'q.
      resolve() {},
    },
  ],
});

export const MafiaGuard = role({
  code: 'MAFIA_GUARD',
  faction: 'MAFIA',
  category: 'MAFIA',
  emoji: '🦺',
  unique: true,
  slots: 1,
  minPlayers: 15,
  modes: ADVANCED_MAFIA,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'MAFIA_GUARD_PROTECT',
      stage: 'PROTECT',
      order: 5,
      targets: { count: 1, self: 'forbid', onlyFaction: 'MAFIA', noConsecutive: true },
      visits: true,
      available: always,
      resolve(api, a) {
        api.addProtection('MAFIA_GUARD', a.actor.id, a.record.targetIds[0]!);
      },
    },
  ],
});

export const MAFIA_ROLES = [Mafioso, Don, Consigliere, Lawyer, Spy, Forger, Blocker, MafiaGuard];

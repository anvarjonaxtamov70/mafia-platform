/**
 * Shahar jamoasi — 13 ta rol (§7). Har bir rol alohida eksport qilinadigan modul-obyekt.
 */
import { always, CLASSIC_LIKE, hasCharge, role, ALL_MODES, ADVANCED_ONLY } from './role';
import type { Faction } from '../types';

const ADVANCED_CITY = [...ADVANCED_ONLY, 'TOURNAMENT' as const];

export const Citizen = role({
  code: 'CITIZEN',
  faction: 'CITY',
  category: 'CITY',
  emoji: '👤',
  unique: false,
  slots: 1,
  minPlayers: 0,
  modes: ALL_MODES,
  weight: 0,
  blocksMainWin: false,
  isNeutralKiller: false,
});

export const Commissar = role({
  code: 'COMMISSAR',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🔎',
  unique: true,
  slots: 1,
  minPlayers: 4,
  modes: CLASSIC_LIKE,
  weight: 10,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'COMMISSAR_CHECK',
      stage: 'INFO',
      order: 1,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.deferPrivate(a.actor.id, { type: 'CHECK_RESULT', targetId: t, faction: api.apparentFaction(t) });
      },
    },
  ],
});

export const Doctor = role({
  code: 'DOCTOR',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🩺',
  unique: true,
  slots: 1,
  minPlayers: 4,
  modes: CLASSIC_LIKE,
  weight: 10,
  blocksMainWin: false,
  isNeutralKiller: false,
  initialAbility: () => ({ charges: { selfHeal: 1 } }),
  night: [
    {
      kind: 'DOCTOR_HEAL',
      stage: 'PROTECT',
      order: 4,
      targets: { count: 1, self: 'allow', noConsecutive: true },
      visits: true,
      available: always,
      extraValidate(actor, targetIds) {
        if (targetIds[0] === actor.id && !hasCharge(actor, 'selfHeal')) return 'NO_CHARGES';
        return null;
      },
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.addProtection('DOCTOR', a.actor.id, t);
        if (t === a.actor.id) api.consumeCharge(a.actor.id, 'selfHeal');
      },
    },
  ],
});

export const Sheriff = role({
  code: 'SHERIFF',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🚔',
  unique: true,
  slots: 1,
  minPlayers: 8,
  modes: CLASSIC_LIKE,
  weight: 6,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'SHERIFF_ARREST',
      stage: 'BLOCK',
      order: 1,
      targets: { count: 1, self: 'forbid', noConsecutive: true },
      visits: true,
      available: always,
      // Bloklashning o'zi resolverda bir vaqtda qo'llanadi. Bu yerda faqat hisobot (Q2).
      resolve(api, a) {
        if (api.isBlocked(a.actor.id)) return;
        const t = a.record.targetIds[0]!;
        api.deferPrivate(a.actor.id, { type: 'SHERIFF_RESULT', targetId: t, acted: api.intendedAction(t) });
      },
    },
  ],
});

export const Bodyguard = role({
  code: 'BODYGUARD',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🛡',
  unique: true,
  slots: 1,
  minPlayers: 8,
  modes: CLASSIC_LIKE,
  weight: 7,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'BODYGUARD_GUARD',
      stage: 'PROTECT',
      order: 6,
      targets: { count: 1, self: 'forbid', noConsecutive: true },
      visits: true,
      available: always,
      resolve(api, a) {
        api.addProtection('BODYGUARD', a.actor.id, a.record.targetIds[0]!);
      },
    },
  ],
});

export const Detective = role({
  code: 'DETECTIVE',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🕵️',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: CLASSIC_LIKE,
  weight: 6,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'DETECTIVE_TRACK',
      stage: 'INFO',
      order: 3,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.deferPrivate(a.actor.id, {
          type: 'TRACK_RESULT',
          source: 'DETECTIVE',
          targetId: t,
          visitedIds: api.visitsBy(t),
        });
      },
    },
  ],
});

/** Jurnalist uchun "tomon": mustaqil rollar alohida shaxsiy fraksiya (§7.7). */
function side(faction: Faction, playerId: string): string {
  return faction === 'NEUTRAL' ? `NEUTRAL:${playerId}` : faction;
}

export const Journalist = role({
  code: 'JOURNALIST',
  faction: 'CITY',
  category: 'CITY',
  emoji: '📰',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_CITY,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'JOURNALIST_COMPARE',
      stage: 'INFO',
      order: 5,
      targets: { count: 2, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        const [x, y] = a.record.targetIds as [string, string];
        const same = side(api.apparentFaction(x), x) === side(api.apparentFaction(y), y);
        api.deferPrivate(a.actor.id, { type: 'COMPARE_RESULT', aId: x, bId: y, same });
      },
    },
  ],
});

export const Judge = role({
  code: 'JUDGE',
  faction: 'CITY',
  category: 'CITY',
  emoji: '⚖️',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: ADVANCED_CITY,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  day: { judgeVeto: true },
});

export const Mayor = role({
  code: 'MAYOR',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🏛',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: ADVANCED_CITY,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  day: { mayorReveal: true },
});

export const Watcher = role({
  code: 'WATCHER',
  faction: 'CITY',
  category: 'CITY',
  emoji: '👁',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_CITY,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'WATCHER_WATCH',
      stage: 'INFO',
      order: 6,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.deferPrivate(a.actor.id, {
          type: 'WATCH_RESULT',
          targetId: t,
          visitorIds: api.visitorsOf(t).filter((v) => v !== a.actor.id),
        });
      },
    },
  ],
});

export const Priest = role({
  code: 'PRIEST',
  faction: 'CITY',
  category: 'CITY',
  emoji: '✝️',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_CITY,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'PRIEST_CLEANSE',
      stage: 'CLEANSE',
      order: 1,
      targets: { count: 1, self: 'allow', noConsecutive: true },
      visits: true,
      available: always,
      resolve(api, a) {
        api.cleanse(a.record.targetIds[0]!);
      },
    },
  ],
});

export const Avenger = role({
  code: 'AVENGER',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🗡',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: ADVANCED_CITY,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'AVENGER_MARK',
      stage: 'PREP',
      order: 2,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        api.markAvenger(a.actor.id, a.record.targetIds[0]!);
      },
    },
  ],
});

export const Engineer = role({
  code: 'ENGINEER',
  faction: 'CITY',
  category: 'CITY',
  emoji: '🔧',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: ADVANCED_CITY,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  initialAbility: () => ({ charges: { install: 1 } }),
  night: [
    {
      kind: 'ENGINEER_INSTALL',
      stage: 'PROTECT',
      order: 1,
      targets: { count: 1, self: 'allow' },
      visits: true,
      available: ({ player }) => hasCharge(player, 'install'),
      resolve(api, a) {
        const t = a.record.targetIds[0]!;
        api.addProtection('ENGINEER', a.actor.id, t);
        api.consumeCharge(a.actor.id, 'install');
        api.trackEngineer(a.actor.id, t);
      },
    },
  ],
});

export const CITY_ROLES = [
  Citizen,
  Commissar,
  Doctor,
  Sheriff,
  Bodyguard,
  Detective,
  Journalist,
  Judge,
  Mayor,
  Watcher,
  Priest,
  Avenger,
  Engineer,
];

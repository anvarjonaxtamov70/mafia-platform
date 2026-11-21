/**
 * Mustaqil rollar — 6 ta (§9).
 * Shaxsiy g'alaba shartlari victory.ts da.
 */
import { ADVANCED_ONLY, ALL_MODES, always, hasCharge, role } from './role';

export const SerialKiller = role({
  code: 'SERIAL_KILLER',
  faction: 'NEUTRAL',
  category: 'NEUTRAL',
  emoji: '🔪',
  unique: true,
  slots: 1,
  minPlayers: 15,
  modes: ADVANCED_ONLY,
  weight: 5,
  blocksMainWin: true,
  isNeutralKiller: true,
  night: [
    {
      kind: 'SERIAL_KILLER_KILL',
      stage: 'ATTACK',
      order: 2,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: always,
      resolve(api, a) {
        api.addAttack('SERIAL_KILLER', a.actor.id, a.record.targetIds[0]!);
      },
    },
  ],
});

export const Thief = role({
  code: 'THIEF',
  faction: 'NEUTRAL',
  category: 'NEUTRAL',
  emoji: '🦝',
  unique: true,
  slots: 1,
  minPlayers: 10,
  modes: ADVANCED_ONLY,
  weight: 5,
  blocksMainWin: false,
  isNeutralKiller: false,
  initialAbility: () => ({ counters: { thiefSuccess: 0 } }),
  night: [
    {
      kind: 'THIEF_STEAL',
      stage: 'PREP',
      order: 3,
      targets: { count: 1, self: 'forbid', noConsecutive: true },
      visits: true,
      available: always,
      resolve(api, a) {
        api.addSteal(a.actor.id, a.record.targetIds[0]!);
      },
    },
  ],
});

export const Jester = role({
  code: 'JESTER',
  faction: 'NEUTRAL',
  category: 'NEUTRAL',
  emoji: '🃏',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ALL_MODES,
  weight: 6,
  blocksMainWin: false,
  isNeutralKiller: false,
});

export const Hunter = role({
  code: 'HUNTER',
  faction: 'NEUTRAL',
  category: 'NEUTRAL',
  emoji: '🎯',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_ONLY,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: true,
  initialAbility: () => ({ charges: { shot: 1 } }),
  night: [
    {
      kind: 'HUNTER_SHOT',
      stage: 'ATTACK',
      order: 3,
      targets: { count: 1, self: 'forbid' },
      visits: true,
      available: ({ player }) => hasCharge(player, 'shot'),
      resolve(api, a) {
        api.addAttack('HUNTER', a.actor.id, a.record.targetIds[0]!);
        api.consumeCharge(a.actor.id, 'shot');
      },
    },
  ],
});

export const Wizard = role({
  code: 'WIZARD',
  faction: 'NEUTRAL',
  category: 'NEUTRAL',
  emoji: '🧙',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_ONLY,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  night: [
    {
      kind: 'WIZARD_MIRAGE',
      stage: 'DECEIVE',
      order: 1,
      targets: { count: 1, self: 'only' },
      visits: false,
      available: ({ player }) => !player.ability.flags['mirageUsed'],
      resolve(api, a) {
        api.addDeception('MIRAGE', a.actor.id, 'CITY');
        api.setFlag(a.actor.id, 'mirageUsed');
      },
    },
    {
      kind: 'WIZARD_BARRIER',
      stage: 'PROTECT',
      order: 3,
      targets: { count: 1, self: 'only' },
      visits: false,
      available: ({ player }) => !player.ability.flags['barrierUsed'],
      resolve(api, a) {
        api.addProtection('BARRIER', a.actor.id, a.actor.id);
        api.setFlag(a.actor.id, 'barrierUsed');
      },
    },
  ],
});

export const LoneWolf = role({
  code: 'LONE_WOLF',
  faction: 'NEUTRAL',
  category: 'NEUTRAL',
  emoji: '🐺',
  unique: true,
  slots: 1,
  minPlayers: 12,
  modes: ADVANCED_ONLY,
  weight: 4,
  blocksMainWin: false,
  isNeutralKiller: false,
  initialAbility: () => ({ charges: { shield: 1 } }),
  night: [
    {
      kind: 'LONE_WOLF_SHIELD',
      stage: 'PROTECT',
      order: 3,
      targets: { count: 1, self: 'only' },
      visits: false,
      available: ({ player }) => hasCharge(player, 'shield'),
      resolve(api, a) {
        api.addProtection('BARRIER', a.actor.id, a.actor.id);
        api.consumeCharge(a.actor.id, 'shield');
      },
    },
  ],
});

export const NEUTRAL_ROLES = [SerialKiller, Thief, Jester, Hunter, Wizard, LoneWolf];

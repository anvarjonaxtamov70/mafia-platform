import { getRole } from './roles';
import type { NightActionSpec } from './roles/role';
import type { ActionKind, EngineErrorCode, GameState, PlayerState } from './types';

/** O'yinchi shu kecha qaysi harakatlarni qila oladi. */
export function availableNightActions(state: GameState, player: PlayerState): NightActionSpec[] {
  if (state.phase !== 'NIGHT' || player.status !== 'ALIVE') return [];
  const n = state.nightNumber;
  return getRole(player.role).night.filter((spec) => {
    if (n === 1 && !state.config.firstNightActions && spec.kind !== 'CUPID_LINK') return false;
    return spec.available({ state, player, nightNumber: n });
  });
}

/** Tanlanishi mumkin bo'lgan nishonlar (UI uchun). */
export function validTargets(state: GameState, player: PlayerState, spec: NightActionSpec): PlayerState[] {
  return state.players.filter((t) => targetError(state, player, spec, t) === null);
}

function targetError(
  state: GameState,
  actor: PlayerState,
  spec: NightActionSpec,
  target: PlayerState,
): EngineErrorCode | null {
  const rules = spec.targets;
  if (target.status !== 'ALIVE') return 'INVALID_TARGET';
  const isSelf = target.id === actor.id;
  if (rules.self === 'forbid' && isSelf) return 'INVALID_TARGET';
  if (rules.self === 'only' && !isSelf) return 'INVALID_TARGET';
  if (rules.onlyFaction && target.faction !== rules.onlyFaction) return 'INVALID_TARGET';
  if (rules.excludeFaction && target.faction === rules.excludeFaction) return 'INVALID_TARGET';
  if (
    rules.noConsecutive &&
    actor.ability.lastNight === state.nightNumber - 1 &&
    actor.ability.lastTargets.includes(target.id)
  ) {
    return 'INVALID_TARGET';
  }
  return null;
}

export function validateNightAction(
  state: GameState,
  actor: PlayerState,
  kind: ActionKind,
  targetIds: string[],
): EngineErrorCode | null {
  if (state.status !== 'RUNNING') return 'GAME_FINISHED';
  if (state.phase !== 'NIGHT') return 'WRONG_PHASE';
  if (actor.status !== 'ALIVE') return 'PLAYER_NOT_ALIVE';
  const spec = availableNightActions(state, actor).find((s) => s.kind === kind);
  if (!spec) return 'NO_SUCH_ACTION';
  if (targetIds.length !== spec.targets.count) return 'INVALID_TARGET';
  if (new Set(targetIds).size !== targetIds.length) return 'INVALID_TARGET';
  for (const id of targetIds) {
    const t = state.players.find((p) => p.id === id);
    if (!t) return 'INVALID_TARGET';
    const err = targetError(state, actor, spec, t);
    if (err) return err;
  }
  return spec.extraValidate?.(actor, targetIds, state) ?? null;
}

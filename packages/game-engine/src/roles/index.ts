import type { ActionKind, RoleCode } from '../types';
import { CITY_ROLES } from './city';
import { MAFIA_ROLES } from './mafia';
import { NEUTRAL_ROLES } from './neutral';
import type { NightActionSpec, RoleDefinition } from './role';
import { SPECIAL_ROLES } from './special';

export * from './role';
export * from './city';
export * from './mafia';
export * from './neutral';
export * from './special';

export const ALL_ROLES: readonly RoleDefinition[] = [...CITY_ROLES, ...MAFIA_ROLES, ...NEUTRAL_ROLES, ...SPECIAL_ROLES];

const byCode = new Map<RoleCode, RoleDefinition>(ALL_ROLES.map((r) => [r.code, r]));
const byAction = new Map<ActionKind, { role: RoleDefinition; spec: NightActionSpec }>();
for (const r of ALL_ROLES) {
  for (const spec of r.night) byAction.set(spec.kind, { role: r, spec });
}

export function getRole(code: RoleCode): RoleDefinition {
  const r = byCode.get(code);
  if (!r) throw new Error(`Unknown role ${code}`);
  return r;
}

export function getActionSpec(kind: ActionKind): { role: RoleDefinition; spec: NightActionSpec } | undefined {
  return byAction.get(kind);
}

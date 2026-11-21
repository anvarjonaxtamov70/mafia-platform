/**
 * NightResolver (§12). Tungi harakatlarni qat'iy, deterministik tartibda hisoblaydi.
 *
 * Tartib:
 *  1. Harakatlarni yig'ish va qayta validatsiya
 *  2. Bloklash (bir vaqtda)
 *  3. Mafia jamoaviy hujum ijrochisini aniqlash (§13)
 *  4. Tashriflarni oldindan qayd etish
 *  5. Bosqichlar: PROTECT → DECEIVE → CLEANSE → PREP → INFO → ATTACK
 *  6. Hujumlarni himoya zanjiri orqali hisoblash
 *  7. O'limdan keyingi effektlar (Qasoskor, yurak ezilishi)
 *  8. Holatni yangilash va shaxsiy natijalarni shakllantirish
 */
import { getRole } from '../roles';
import {
  DECEPTION_LAYER,
  PROTECTION_PRIORITY,
  type DeceptionSource,
  type NightApi,
  type ProtectionType,
  type ResolvedAction,
} from '../roles/role';
import { pick } from '../rng';
import {
  NIGHT_STAGE_ORDER,
  type AttackKind,
  type DeathCause,
  type EventBody,
  type Faction,
  type GameEvent,
  type GameState,
  type PlayerState,
  type Rng,
} from '../types';
import { validateNightAction } from '../validation';

interface Protection {
  type: ProtectionType;
  ownerId: string;
  targetId: string;
  priority: number;
  remaining: number;
}

interface Attack {
  kind: AttackKind;
  attackerId: string;
  targetId: string;
}

const ATTACK_ORDER: Record<AttackKind, number> = { MAFIA: 1, SERIAL_KILLER: 2, HUNTER: 3, AVENGER: 4 };

/** Mafia hujum ijrochisi ustuvorligi (§13). */
function executorPriority(p: PlayerState): number {
  if (p.role === 'DON') return 0;
  if (p.role === 'MAFIOSO') return 1;
  return 2;
}

export function computeMafiaTarget(state: GameState): string | null {
  const alive = new Map(state.players.filter((p) => p.status === 'ALIVE').map((p) => [p.id, p]));
  const tally = new Map<string, number>();
  for (const [voterId, target] of Object.entries(state.night.mafiaVotes)) {
    const voter = alive.get(voterId);
    if (!voter || voter.faction !== 'MAFIA' || target === 'SKIP') continue;
    const t = alive.get(target);
    if (!t || t.faction === 'MAFIA') continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  const max = Math.max(...tally.values());
  const tied = [...tally.entries()].filter(([, c]) => c === max).map(([id]) => id);
  if (tied.length === 1) return tied[0]!;
  const don = [...alive.values()].find((p) => p.role === 'DON');
  const donVote = don ? state.night.mafiaVotes[don.id] : undefined;
  if (donVote && donVote !== 'SKIP' && tied.includes(donVote)) return donVote;
  return null;
}

class NightContext implements NightApi {
  readonly nightNumber: number;
  readonly blocked = new Set<string>();
  readonly intended = new Set<string>();
  readonly protections: Protection[] = [];
  readonly deceptions = new Map<string, { layer: number; seq: number; apparent: Faction }[]>();
  readonly cleansed = new Set<string>();
  readonly visits = new Map<string, string[]>();
  readonly attacks: Attack[] = [];
  readonly dying = new Map<string, DeathCause>();
  readonly avengerMarks = new Map<string, string>();
  readonly steals: { thiefId: string; targetId: string }[] = [];
  readonly engineers = new Map<string, string>();
  readonly engineerTriggered = new Set<string>();
  readonly usedFakeDocuments = new Set<string>();
  readonly revived: string[] = [];
  readonly deferredPrivate: { to: string; body: EventBody }[] = [];
  readonly deferredMafia: { source: string; body: EventBody }[] = [];
  savedCount = 0;
  loversRandom = false;
  private deceptionSeq = 0;
  private readonly byId: Map<string, PlayerState>;

  constructor(readonly state: GameState) {
    this.nightNumber = state.nightNumber;
    this.byId = new Map(state.players.map((p) => [p.id, p]));
  }

  player(id: string): PlayerState {
    const p = this.byId.get(id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }

  isAliveNow(id: string): boolean {
    return this.player(id).status === 'ALIVE' && !this.dying.has(id);
  }

  addProtection(type: ProtectionType, ownerId: string, targetId: string): void {
    this.protections.push({ type, ownerId, targetId, priority: PROTECTION_PRIORITY[type], remaining: 1 });
  }

  addDeception(source: DeceptionSource, targetId: string, apparent: Faction): void {
    const list = this.deceptions.get(targetId) ?? [];
    list.push({ layer: DECEPTION_LAYER[source], seq: this.deceptionSeq++, apparent });
    this.deceptions.set(targetId, list);
  }

  cleanse(targetId: string): void {
    this.cleansed.add(targetId);
  }

  apparentFaction(targetId: string): Faction {
    const p = this.player(targetId);
    const base = p.faction;
    if (this.cleansed.has(targetId)) return base;
    const layers = [...(this.deceptions.get(targetId) ?? [])];
    if (this.state.config.allowArcadeItems && p.items.fakeDocument) {
      layers.push({ layer: DECEPTION_LAYER.FAKE_DOCUMENT, seq: -1, apparent: 'CITY' });
      this.usedFakeDocuments.add(targetId);
    }
    if (layers.length === 0) return base;
    layers.sort((a, b) => a.layer - b.layer || a.seq - b.seq);
    return layers[layers.length - 1]!.apparent;
  }

  visitsBy(actorId: string): string[] {
    return [...(this.visits.get(actorId) ?? [])];
  }

  visitorsOf(targetId: string): string[] {
    const out: string[] = [];
    for (const p of this.state.players) {
      if ((this.visits.get(p.id) ?? []).includes(targetId)) out.push(p.id);
    }
    return out;
  }

  isBlocked(actorId: string): boolean {
    return this.blocked.has(actorId);
  }

  intendedAction(playerId: string): boolean {
    return this.intended.has(playerId);
  }

  block(targetId: string): void {
    this.blocked.add(targetId);
  }

  addAttack(kind: AttackKind, attackerId: string, targetId: string): void {
    this.attacks.push({ kind, attackerId, targetId });
  }

  linkLovers(a: string, b: string, random: boolean): void {
    if (this.state.links.lovers) return;
    this.state.links.lovers = [a, b];
    this.loversRandom = random;
    this.deferPrivate(a, { type: 'LOVERS_LINKED', partnerId: b });
    this.deferPrivate(b, { type: 'LOVERS_LINKED', partnerId: a });
    const cupid = this.state.players.find((p) => p.role === 'CUPID');
    if (cupid) this.deferPrivate(cupid.id, { type: 'CUPID_RESULT', loverIds: [a, b], random });
  }

  markAvenger(avengerId: string, targetId: string): void {
    this.avengerMarks.set(avengerId, targetId);
  }

  addSteal(thiefId: string, targetId: string): void {
    this.steals.push({ thiefId, targetId });
  }

  trackEngineer(engineerId: string, targetId: string): void {
    this.engineers.set(engineerId, targetId);
  }

  consumeCharge(actorId: string, key: string): void {
    const p = this.player(actorId);
    p.ability.charges[key] = Math.max(0, (p.ability.charges[key] ?? 0) - 1);
  }

  setFlag(actorId: string, key: string): void {
    this.player(actorId).ability.flags[key] = true;
  }

  deferPrivate(recipientId: string, body: EventBody): void {
    this.deferredPrivate.push({ to: recipientId, body });
  }

  deferMafia(sourceId: string, body: EventBody): void {
    this.deferredMafia.push({ source: sourceId, body });
  }

  /** Bitta hujumni himoya zanjiri orqali hisoblash (§12.2.8, Q4, Q5). */
  resolveAttack(kind: AttackKind, attackerId: string, targetId: string, depth = 0): void {
    if (!this.isAliveNow(targetId)) return;
    const prots = this.protections
      .filter((p) => p.targetId === targetId && p.remaining > 0)
      .sort((a, b) => a.priority - b.priority);
    for (const p of prots) {
      if (p.type === 'BODYGUARD') {
        if (p.ownerId === targetId || !this.isAliveNow(p.ownerId)) continue;
        p.remaining = 0;
        if (depth < 3) this.resolveAttack(kind, attackerId, p.ownerId, depth + 1);
        else this.dying.set(p.ownerId, kind);
        return;
      }
      p.remaining = 0;
      if (p.type === 'PHOENIX') {
        this.setFlag(targetId, 'phoenixUsed');
        this.revived.push(targetId);
        return;
      }
      if (p.type === 'ARCADE_SHIELD') this.player(targetId).items.shield = false;
      if (p.type === 'ENGINEER') this.engineerTriggered.add(p.ownerId);
      this.savedCount++;
      return;
    }
    this.dying.set(targetId, kind);
  }
}

export interface NightResolution {
  events: GameEvent[];
  deaths: string[];
}

/** Holatni joyida o'zgartiradi (chaqiruvchi klon beradi). */
export function resolveNight(state: GameState, rng: Rng): NightResolution {
  const ctx = new NightContext(state);
  const n = state.nightNumber;
  const aliveAtStart = state.players.filter((p) => p.status === 'ALIVE');

  // 1. Harakatlarni yig'ish va qayta validatsiya
  const actions: ResolvedAction[] = [];
  const records = Object.values(state.night.actions).sort((a, b) => a.seq - b.seq);
  for (const rec of records) {
    const actor = ctx.player(rec.actorId);
    if (actor.status !== 'ALIVE') continue;
    const spec = getRole(actor.role).night.find((s) => s.kind === rec.kind);
    if (!spec) continue;
    if (validateNightAction(state, actor, rec.kind, rec.targetIds) !== null) continue;
    actions.push({ record: rec, actor, spec, status: 'PENDING' });
    ctx.intended.add(actor.id);
  }
  for (const [voterId, v] of Object.entries(state.night.mafiaVotes)) {
    if (v !== 'SKIP') ctx.intended.add(voterId);
  }

  // 2. Bloklash — barcha bloklar bir vaqtda qo'llanadi (§12.2.3, vaziyat 12)
  for (const a of actions) {
    if (a.spec.stage === 'BLOCK') ctx.block(a.record.targetIds[0]!);
  }
  for (const a of actions) {
    if (a.spec.stage !== 'BLOCK' && ctx.isBlocked(a.actor.id)) {
      a.status = 'BLOCKED';
      ctx.deferPrivate(a.actor.id, { type: 'ACTION_FAILED', kind: a.record.kind, reason: 'BLOCKED' });
    }
  }

  // 3. Mafia jamoaviy hujumi (§13)
  const mafiaTarget = computeMafiaTarget(state);
  let executor: PlayerState | null = null;
  if (mafiaTarget) {
    executor =
      aliveAtStart
        .filter((p) => p.faction === 'MAFIA' && !ctx.isBlocked(p.id))
        .sort((a, b) => executorPriority(a) - executorPriority(b) || a.seat - b.seat)[0] ?? null;
  }

  // 4. Tashriflar (Q3)
  for (const a of actions) {
    if (a.status === 'BLOCKED' || !a.spec.visits) continue;
    const targets = a.record.targetIds.filter((t) => t !== a.actor.id);
    if (targets.length === 0) continue;
    ctx.visits.set(a.actor.id, [...(ctx.visits.get(a.actor.id) ?? []), ...targets]);
  }
  if (executor && mafiaTarget) {
    ctx.visits.set(executor.id, [...(ctx.visits.get(executor.id) ?? []), mafiaTarget]);
  }

  // 5. Bosqichlar
  for (const stage of NIGHT_STAGE_ORDER) {
    if (stage === 'PROTECT') {
      for (const p of aliveAtStart) {
        if (p.role === 'PHOENIX' && !p.ability.flags['phoenixUsed']) ctx.addProtection('PHOENIX', p.id, p.id);
        if (state.config.allowArcadeItems && p.items.shield) ctx.addProtection('ARCADE_SHIELD', p.id, p.id);
      }
    }
    if (stage === 'ATTACK' && executor && mafiaTarget) {
      ctx.addAttack('MAFIA', executor.id, mafiaTarget);
    }
    const stageActions = actions
      .filter((a) => a.spec.stage === stage && (a.status !== 'BLOCKED' || stage === 'BLOCK'))
      .sort((a, b) => a.spec.order - b.spec.order || a.actor.seat - b.actor.seat || a.record.seq - b.record.seq);
    for (const a of stageActions) {
      a.spec.resolve(ctx, a);
      if (a.status !== 'BLOCKED') a.status = 'RESOLVED';
    }
    if (stage === 'PREP' && n === 1 && !state.links.lovers) {
      const cupid = aliveAtStart.find((p) => p.role === 'CUPID');
      if (cupid) {
        const pool = aliveAtStart.filter((p) => p.id !== cupid.id);
        const first = pick(pool, rng);
        const second = first ? pick(pool.filter((p) => p.id !== first.id), rng) : undefined;
        if (first && second) ctx.linkLovers(first.id, second.id, true);
      }
    }
  }

  // 6. Hujumlar (qat'iy tartib: Mafia → Manyak → Ovchi)
  const ordered = ctx.attacks
    .map((a, i) => ({ a, i }))
    .sort((x, y) => ATTACK_ORDER[x.a.kind] - ATTACK_ORDER[y.a.kind] || x.i - y.i)
    .map((x) => x.a);
  for (const atk of ordered) ctx.resolveAttack(atk.kind, atk.attackerId, atk.targetId);

  // 7. O'limdan keyingi effektlar (Qasoskor, yurak ezilishi) — barqarorlashguncha
  const avengerDone = new Set<string>();
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    for (const [avengerId, markId] of ctx.avengerMarks) {
      const cause = ctx.dying.get(avengerId);
      if (!cause || cause === 'HEARTBREAK' || avengerDone.has(avengerId)) continue;
      avengerDone.add(avengerId);
      if (ctx.isAliveNow(markId)) {
        ctx.resolveAttack('AVENGER', avengerId, markId);
        changed = true;
      }
    }
    const lovers = state.links.lovers;
    if (lovers) {
      const [a, b] = lovers;
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        const xDead = ctx.dying.has(x) || ctx.player(x).status === 'DEAD';
        if (xDead && ctx.isAliveNow(y)) {
          ctx.dying.set(y, 'HEARTBREAK');
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 8. Holatni yangilash
  const deaths = [...ctx.dying.keys()].sort((a, b) => ctx.player(a).seat - ctx.player(b).seat);
  for (const id of deaths) {
    const p = ctx.player(id);
    p.status = 'DEAD';
    p.death = { cause: ctx.dying.get(id)!, at: 'NIGHT', number: n };
  }

  const resolvedByActor = new Map(actions.filter((a) => a.status === 'RESOLVED').map((a) => [a.actor.id, a]));
  for (const p of aliveAtStart) {
    const a = resolvedByActor.get(p.id);
    p.ability.lastTargets = a ? [...a.record.targetIds] : [];
    p.ability.lastNight = n;
  }

  for (const id of ctx.usedFakeDocuments) ctx.player(id).items.fakeDocument = false;

  // O'g'ri (Q10)
  for (const s of ctx.steals) {
    const success = ctx.isAliveNow(s.targetId);
    const thief = ctx.player(s.thiefId);
    if (success) {
      thief.ability.counters['thiefSuccess'] = (thief.ability.counters['thiefSuccess'] ?? 0) + 1;
      state.votePenaltyDay[s.targetId] = n;
      ctx.deferPrivate(s.targetId, { type: 'VOTE_WEAKENED', dayNumber: n });
    }
    ctx.deferPrivate(s.thiefId, {
      type: 'THIEF_RESULT',
      targetId: s.targetId,
      success,
      total: thief.ability.counters['thiefSuccess'] ?? 0,
    });
  }

  // Muhandis hisoboti
  for (const [engineerId, targetId] of ctx.engineers) {
    ctx.deferPrivate(engineerId, {
      type: 'ENGINEER_RESULT',
      targetId,
      triggered: ctx.engineerTriggered.has(engineerId),
    });
  }

  // Egizaklar bonusi (§10.2)
  if (state.links.twins) grantTwinBonus(state, deaths, n, (to, body) => ctx.deferPrivate(to, body));

  // AFK hisobi (§32.3): harakat imkoni bo'lib, hech narsa qilmaganlar
  for (const p of aliveAtStart) {
    if (state.night.actions[p.id] || state.night.skipped.includes(p.id)) continue;
    if (getRole(p.role).night.length > 0) p.missedActions++;
  }

  // Shaxsiy natijalar — faqat tirik qolganlarga (§12.3)
  const events: GameEvent[] = [];
  for (const d of ctx.deferredPrivate) {
    if (ctx.player(d.to).status === 'ALIVE') events.push({ ...d.body, audience: { kind: 'private', playerId: d.to } });
  }
  for (const d of ctx.deferredMafia) {
    if (ctx.player(d.source).status === 'ALIVE') events.push({ ...d.body, audience: { kind: 'mafia' } });
  }

  events.push({
    type: 'DAWN',
    nightNumber: n,
    deaths: deaths.map((id) => ({
      playerId: id,
      role: state.config.revealRolesOnDeath ? ctx.player(id).role : null,
    })),
    savedCount: state.config.announceSavedAttacks ? ctx.savedCount : 0,
    revivedIds: state.config.revealPhoenixIdentity ? [...ctx.revived] : [],
    revivedCount: ctx.revived.length,
    aliveCount: state.players.filter((p) => p.status === 'ALIVE').length,
    audience: { kind: 'public' },
  });

  state.night = { actions: {}, skipped: [], mafiaVotes: {} };
  return { events, deaths };
}

/** Egizaklardan biri halok bo'lsa, ikkinchisi keyingi kunduz ovozida 2 ovoz oladi (bir marta). */
export function grantTwinBonus(
  state: GameState,
  deaths: string[],
  forDay: number,
  notify: (to: string, body: EventBody) => void,
): void {
  const twins = state.links.twins;
  if (!twins) return;
  for (const [x, y] of [
    [twins[0], twins[1]],
    [twins[1], twins[0]],
  ] as const) {
    const other = state.players.find((p) => p.id === y);
    if (deaths.includes(x) && other?.status === 'ALIVE' && !other.ability.flags['twinBonusGranted']) {
      other.ability.flags['twinBonusGranted'] = true;
      state.twinBonusDay[y] = forDay;
      notify(y, { type: 'TWIN_BONUS', dayNumber: forDay });
    }
  }
}

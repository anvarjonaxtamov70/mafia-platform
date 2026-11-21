import { expect } from 'vitest';
import {
  advancePhase,
  createGame,
  judgeVeto,
  leaveGame,
  revealMayor,
  skipNightAction,
  submitDayVote,
  submitMafiaVote,
  submitNightAction,
} from '../engine';
import { seededRng } from '../rng';
import type { ActionKind, EventType, GameConfig, GameEvent, GameMode, GameState, PlayerState, RoleCode } from '../types';

/** Rollari aniq berilgan test o'yini. O'yinchi ID: p1..pN (rollar tartibida). */
export class TestGame {
  state: GameState;
  now = 1_000_000;
  rng = seededRng(7);
  log: GameEvent[] = [];

  constructor(roles: RoleCode[], config: Partial<GameConfig> = {}, mode: GameMode = 'PRIVATE') {
    const r = createGame({
      id: 'test',
      mode,
      players: roles.map((_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
      fixedRoles: roles,
      config: { maxPlayers: 30, ...config },
      now: this.now,
      rng: this.rng,
    });
    if (!r.ok) throw new Error(`createGame: ${r.error}`);
    this.state = r.state;
    this.log.push(...r.events);
  }

  /** Rol bo'yicha o'yinchi ID (nth — shu roldagi nechanchi o'yinchi) */
  id(role: RoleCode, nth = 0): string {
    const list = this.state.players.filter((p) => p.role === role);
    const p = list[nth];
    if (!p) throw new Error(`no ${role}#${nth}`);
    return p.id;
  }

  p(id: string): PlayerState {
    return this.state.players.find((x) => x.id === id)!;
  }

  private apply(r: { ok: boolean; state: GameState; events?: GameEvent[]; error?: string }): GameEvent[] {
    if (!r.ok) throw new Error(`engine error: ${r.error}`);
    this.state = r.state;
    const ev = r.events ?? [];
    this.log.push(...ev);
    return ev;
  }

  act(actorId: string, kind: ActionKind, ...targetIds: string[]): GameEvent[] {
    return this.apply(submitNightAction(this.state, { actorId, kind, targetIds, now: this.now }));
  }

  skip(actorId: string): GameEvent[] {
    return this.apply(skipNightAction(this.state, actorId));
  }

  mafia(actorId: string, targetId: string | null): GameEvent[] {
    return this.apply(submitMafiaVote(this.state, actorId, targetId));
  }

  vote(voterId: string, choice: string): GameEvent[] {
    return this.apply(submitDayVote(this.state, voterId, choice));
  }

  revealMayor(id: string): GameEvent[] {
    return this.apply(revealMayor(this.state, id));
  }

  veto(id: string): GameEvent[] {
    return this.apply(judgeVeto(this.state, id, this.now, this.rng));
  }

  leave(id: string): GameEvent[] {
    return this.apply(leaveGame(this.state, id, this.now, this.rng));
  }

  advance(): GameEvent[] {
    this.now += 1000;
    return this.apply(advancePhase(this.state, this.now, this.rng));
  }

  /** Tunni yakunlab, kunduz muhokamasiga o'tadi */
  endNight(): GameEvent[] {
    expect(this.state.phase).toBe('NIGHT');
    return this.advance();
  }

  /** Muhokama → ovoz berish */
  toVoting(): void {
    expect(this.state.phase).toBe('DAY_DISCUSSION');
    this.advance();
    expect(this.state.phase).toBe('DAY_VOTING');
  }

  /** Kunduzni hech kim chiqarilmasdan o'tkazish */
  skipDay(): void {
    this.toVoting();
    this.advance();
  }

  /** Hamma tirik o'yinchi (nomzoddan tashqari) nomzodga ovoz beradi */
  voteOut(targetId: string): GameEvent[] {
    this.toVoting();
    for (const p of this.state.players.filter((x) => x.status === 'ALIVE' && x.id !== targetId)) {
      this.vote(p.id, targetId);
    }
    return this.advance();
  }
}

export function eventsOf<T extends EventType>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

export function privateTo<T extends EventType>(events: GameEvent[], type: T, playerId: string): Extract<GameEvent, { type: T }>[] {
  return eventsOf(events, type).filter((e) => e.audience.kind === 'private' && e.audience.playerId === playerId);
}

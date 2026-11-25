import { describe, expect, it } from 'vitest';
import { advancePhase, createGame, submitDayVote } from '../engine';
import { seededRng } from '../rng';
import type { GameState } from '../types';

function game(): GameState {
  const r = createGame({ id: 'afk', mode: 'CLASSIC', players: ['1','2','3','4'].map((id) => ({ id, name: id })), fixedRoles: ['DON','COMMISSAR','DOCTOR','CITIZEN'], config: { firstNightActions: false }, now: 1, rng: seededRng(1) });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function phase(s: GameState) {
  const r = advancePhase(s, (s.phaseEndsAt ?? 0) + 1, seededRng(2), s.phaseSeq);
  if (!r.ok) throw new Error(r.error);
  return r;
}
function untilVoting(s: GameState): GameState {
  while (s.phase !== 'DAY_VOTING' && s.status === 'RUNNING') s = phase(s).state;
  if (s.phase !== 'DAY_VOTING') throw new Error('game unexpectedly finished');
  return s;
}
describe('AFK accounting', () => {
  it('first unavailable night does not count as a missed action', () => {
    const s = phase(game()).state;
    expect(s.players.every((p) => p.missedActions === 0)).toBe(true);
  });
  it('warns privately once, penalizes after two missed votes without ejecting the player', () => {
    const first = phase(untilVoting(game()));
    expect(first.events.filter((e) => e.type === 'AFK_NOTICE')).toHaveLength(4);
    const second = phase(untilVoting(first.state));
    expect(second.state.players.every((p) => p.afkPenalized && p.status === 'ALIVE')).toBe(true);
    expect(second.events.filter((e) => e.type === 'AFK_NOTICE' && e.penalized)).toHaveLength(4);
    expect(second.events.filter((e) => e.type === 'AFK_NOTICE').every((e) => e.audience.kind === 'private')).toBe(true);
  });
  it('explicit abstention resets the streak', () => {
    const first = phase(untilVoting(game()));
    const second = untilVoting(first.state);
    const vote = submitDayVote(second, '4', 'NONE', second.phaseSeq);
    if (!vote.ok) throw new Error(vote.error);
    const s = phase(vote.state).state;
    expect(s.players.find((p) => p.id === '4')).toMatchObject({ consecutiveMissedVotes: 0, afkPenalized: false });
    expect(s.players.find((p) => p.id === '1')?.afkPenalized).toBe(true);
  });
});

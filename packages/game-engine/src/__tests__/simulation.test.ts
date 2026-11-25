import { describe, expect, it } from 'vitest';
import { runSimulations, simulateGame } from '../simulator';
import { advancePhase, createGame } from '../engine';
import { seededRng } from '../rng';
import type { GameMode } from '../types';

describe('Simulyatsiya (§37.4)', () => {
  const cases: { mode: GameMode; players: number }[] = [
    { mode: 'CLASSIC', players: 4 },
    { mode: 'CLASSIC', players: 8 },
    { mode: 'CLASSIC', players: 12 },
    { mode: 'ADVANCED', players: 20 },
    { mode: 'ADVANCED', players: 30 },
    { mode: 'CHAOS', players: 25 },
  ];

  for (const c of cases) {
    it(`${c.mode} ${c.players} kishi: 200 o‘yin, hammasi tugaydi`, () => {
      const stats = runSimulations(200, c);
      expect(stats.unfinished).toBe(0);
      expect(stats.outcomes.CITY + stats.outcomes.MAFIA + stats.outcomes.SERIAL_KILLER + stats.outcomes.DRAW).toBe(200);
    }, 120_000);
  }

  it('1000 ta aralash o‘yin: invariantlar buzilmaydi', () => {
    const modes: GameMode[] = ['CLASSIC', 'ADVANCED', 'CHAOS', 'PRIVATE'];
    for (let seed = 1; seed <= 1000; seed++) {
      const players = 4 + (seed % 27);
      const mode = modes[seed % modes.length]!;
      const r = simulateGame({ players, mode, seed });
      expect(r.finished).toBe(true);
      const s = r.state;
      // Har bir o'yinchi bitta rolga ega va natija bor
      expect(s.result!.players).toHaveLength(players);
      // Bitta shaxsiy g'alaba ikki marta berilmaydi
      expect(new Set(s.result!.players.map((p) => p.playerId)).size).toBe(players);
      // O'lganlarning o'lim sababi bor
      for (const p of s.players) if (p.status === 'DEAD') expect(p.death).not.toBeNull();
      // Zaryadlar manfiy emas
      for (const p of s.players) for (const v of Object.values(p.ability.charges)) expect(v).toBeGreaterThanOrEqual(0);
    }
  }, 300_000);
});


describe('All mode / player-count stability matrix', () => {
  const modes: GameMode[] = ['CLASSIC', 'ADVANCED', 'CHAOS', 'PRIVATE', 'ARCADE', 'TOURNAMENT'];
  for (const mode of modes) {
    it(mode + ': 4–30 players, random play and complete inactivity terminate', () => {
      for (let players = 4; players <= 30; players++) {
        for (const seed of [17, 813]) {
          const r = simulateGame({ players, mode, seed });
          expect(r.finished, mode + '/' + players + '/' + seed).toBe(true);
        }
        const rng = seededRng(players);
        const created = createGame({ id: 'afk-' + mode + '-' + players, mode, players: Array.from({ length: players }, (_, i) => ({ id: String(i + 1), name: 'P' + i })), config: { maxPlayers: 30 }, now: 0, rng });
        if (!created.ok) throw new Error('createGame: ' + created.error);
        let state = created.state;
        for (let step = 0; step < 250 && state.status === 'RUNNING'; step++) {
          const next = advancePhase(state, (state.phaseEndsAt ?? 0) + 1, rng, state.phaseSeq);
          if (!next.ok) throw new Error('advancePhase: ' + next.error);
          state = next.state;
        }
        expect(state.status, mode + '/' + players + '/afk').toBe('FINISHED');
      }
    }, 120_000);
  }
});

import { runSimulations } from '../simulator';
import type { GameMode } from '../types';

const count = Number(process.argv[2] ?? 1000);
const modes: GameMode[] = ['CLASSIC', 'ADVANCED', 'CHAOS'];
const sizes = [4, 6, 8, 10, 12, 15, 20, 25, 30];

for (const mode of modes) {
  for (const players of sizes) {
    const s = runSimulations(count, { players, mode });
    const pct = (n: number) => `${((n / s.games) * 100).toFixed(1)}%`;
    console.log(
      `${mode.padEnd(9)} ${String(players).padStart(2)}p | city ${pct(s.outcomes.CITY).padStart(6)} | mafia ${pct(
        s.outcomes.MAFIA,
      ).padStart(6)} | maniac ${pct(s.outcomes.SERIAL_KILLER).padStart(6)} | draw ${pct(s.outcomes.DRAW).padStart(
        6,
      )} | unfinished ${s.unfinished} | avg days ${s.avgDays.toFixed(1)} | personal ${JSON.stringify(s.personalWins)}`,
    );
  }
}

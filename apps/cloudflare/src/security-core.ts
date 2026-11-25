import type { Sql } from './sql';

export type Admission = 'ALLOW' | 'DUPLICATE' | 'BUSY' | 'RATE_LIMITED';
const RETENTION = 48 * 60 * 60 * 1000;
const LEASE = 120_000;
const WINDOW = 10_000;
const LIMIT = 60;
const ALERT_COOLDOWN = 15 * 60 * 1000;

/** Persist metadata only, never message content or payment payloads. */
export class SecurityCore {
  private admissions = 0;
  constructor(private readonly sql: Sql, private readonly clock: () => number = Date.now) {}

  migrate(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS security_updates (update_id INTEGER PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS security_updates_at ON security_updates(at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS security_rate (telegram_id INTEGER PRIMARY KEY, window_at INTEGER NOT NULL, hits INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS security_rate_at ON security_rate(window_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS security_alerts (kind TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS security_game_signals (game_number INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, roster TEXT NOT NULL, at INTEGER NOT NULL, inactive INTEGER NOT NULL, players INTEGER NOT NULL, flagged INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS security_signals_at ON security_game_signals(at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS security_signals_roster ON security_game_signals(chat_id, roster, at)`);
  }

  begin(updateId: number, userId: number): Admission {
    if (!Number.isSafeInteger(updateId) || updateId < 0 || !Number.isSafeInteger(userId) || userId <= 0) return 'RATE_LIMITED';
    const now = this.clock();
    return this.sql.tx(() => {
      if (++this.admissions % 128 === 0) {
        this.sql.exec(`DELETE FROM security_updates WHERE update_id IN (SELECT update_id FROM security_updates WHERE at < ? ORDER BY at LIMIT 512)`, now - RETENTION);
        this.sql.exec(`DELETE FROM security_rate WHERE telegram_id IN (SELECT telegram_id FROM security_rate WHERE window_at < ? ORDER BY window_at LIMIT 512)`, now - RETENTION);
      }
      const prior = this.sql.exec<{ state: string; at: number }>(`SELECT state, at FROM security_updates WHERE update_id = ?`, updateId)[0];
      if (prior) {
        if (prior.state !== 'PROCESSING') return 'DUPLICATE';
        if (now - prior.at < LEASE) return 'BUSY';
        // An interrupted non-idempotent command may already have changed state.
        // Do not blindly replay it; retain the uncertain outcome for operators.
        this.sql.exec(`UPDATE security_updates SET state = 'UNCERTAIN', at = ? WHERE update_id = ?`, now, updateId);
        return 'DUPLICATE';
      }
      const rate = this.sql.exec<{ hits: number }>(
        `INSERT INTO security_rate (telegram_id, window_at, hits) VALUES (?, ?, 1)
         ON CONFLICT (telegram_id) DO UPDATE SET
           hits = CASE WHEN security_rate.window_at <= ? THEN 1 ELSE MIN(security_rate.hits + 1, ?) END,
           window_at = CASE WHEN security_rate.window_at <= ? THEN excluded.window_at ELSE security_rate.window_at END
         RETURNING hits`, userId, now, now - WINDOW, LIMIT + 1, now - WINDOW,
      )[0]!;
      const allowed = rate.hits <= LIMIT;
      this.sql.exec(`INSERT INTO security_updates (update_id, state, at) VALUES (?, ?, ?)`, updateId, allowed ? 'PROCESSING' : 'LIMITED', now);
      return allowed ? 'ALLOW' : 'RATE_LIMITED';
    });
  }

  finish(updateId: number, ok: boolean): void {
    this.sql.exec(`UPDATE security_updates SET state = ?, at = ? WHERE update_id = ? AND state = 'PROCESSING'`, ok ? 'DONE' : 'UNCERTAIN', this.clock(), updateId);
  }

  claimAlert(kind: 'webhook' | 'alarm' | 'registry'): boolean {
    const now = this.clock();
    return this.sql.exec(`INSERT INTO security_alerts (kind, at) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET at = excluded.at WHERE security_alerts.at <= ? RETURNING kind`, kind, now, now - ALERT_COOLDOWN).length === 1;
  }

  /** Review-only signal, not proof of cheating. No automatic ban or confiscation. */
  observeGame(number: number, chat: number, players: readonly { tgId: number; active: boolean; fake: boolean; left: boolean }[]): void {
    const real = players.filter((p) => !p.fake);
    if (real.length < 4) return;
    const now = this.clock();
    const roster = real.map((p) => p.tgId).sort((a, b) => a - b).join(',');
    const inactive = real.filter((p) => !p.active || p.left).length;
    const repeat = this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM security_game_signals WHERE chat_id = ? AND roster = ? AND at >= ? AND game_number <> ?`, chat, roster, now - 60 * 60 * 1000, number)[0]!.c;
    const flagged = repeat >= 5 && inactive * 2 >= real.length ? 1 : 0;
    this.sql.exec(`INSERT OR IGNORE INTO security_game_signals (game_number, chat_id, roster, at, inactive, players, flagged) VALUES (?, ?, ?, ?, ?, ?, ?)`, number, chat, roster, now, inactive, real.length, flagged);
    this.sql.exec(`DELETE FROM security_game_signals WHERE game_number IN (SELECT game_number FROM security_game_signals WHERE at < ? ORDER BY at LIMIT 256)`, now - RETENTION);
  }

  abuseStats(): { suspiciousGames: number } {
    return { suspiciousGames: this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM security_game_signals WHERE flagged = 1 AND at >= ?`, this.clock() - 24 * 60 * 60 * 1000)[0]!.c };
  }

  stats(): { limited: number; uncertain: number; processing: number } {
    const now = this.clock();
    const rows = this.sql.exec<{ state: string; count: number }>(`SELECT CASE WHEN state = 'PROCESSING' AND at <= ? THEN 'UNCERTAIN' ELSE state END AS state, COUNT(*) AS count FROM security_updates WHERE at >= ? GROUP BY 1`, now - LEASE, now - 24 * 60 * 60 * 1000);
    const count = (state: string) => rows.find((row) => row.state === state)?.count ?? 0;
    return { limited: count('LIMITED'), uncertain: count('UNCERTAIN'), processing: count('PROCESSING') };
  }
}

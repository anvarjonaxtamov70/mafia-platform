import { seededRng, type GameState } from '@mafia/game-engine';
import { createPrismaClient, type Db } from '@mafia/database';
import pino from 'pino';
import { GameService } from '../game/game.service';
import { LobbyService } from '../game/lobby.service';
import { MemoryScheduler, type DmProbe } from '../game/ports';
import { QueriesService } from '../game/queries.service';
import { UsersService, type TgUser } from '../game/users.service';

export const silentLogger = pino({ level: process.env['DEBUG_TESTS'] ? 'debug' : 'silent' });

let shared: Db | null = null;
export function testDb(): Db {
  if (!shared) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL required for integration tests (npm run test:integration)');
    shared = createPrismaClient(url, { poolSize: 10 });
  }
  return shared;
}

export async function resetDb(db: Db): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export class StubProbe implements DmProbe {
  failingIds = new Set<string>();
  async failing(ids: bigint[]): Promise<bigint[]> {
    return ids.filter((id) => this.failingIds.has(String(id)));
  }
}

export interface TestServices {
  db: Db;
  clock: { now: number };
  timers: MemoryScheduler;
  probe: StubProbe;
  users: UsersService;
  games: GameService;
  lobby: LobbyService;
  queries: QueriesService;
}

export function makeServices(db: Db, opts: { devFake?: boolean; seed?: number } = {}): TestServices {
  const clock = { now: Date.now() };
  const timers = new MemoryScheduler();
  const probe = new StubProbe();
  const rng = seededRng(opts.seed ?? 11);
  const users = new UsersService(db);
  const notifier = { kick() {} };
  const games = new GameService(db, timers, notifier, silentLogger, () => clock.now, rng);
  const lobby = new LobbyService(db, users, games, timers, notifier, probe, silentLogger, { botUsername: 'test_mafia_bot', devFakePlayers: !!opts.devFake }, () => clock.now, rng);
  const queries = new QueriesService(db, () => clock.now);
  return { db, clock, timers, probe, users, games, lobby, queries };
}

export function tgUser(id: number, name = `User${id}`): TgUser {
  return { id, first_name: name, username: `u${id}` };
}

export const CHAT_ID = -1001234567890;

export async function stateOf(db: Db, gameId: string): Promise<GameState> {
  const g = await db.game.findUniqueOrThrow({ where: { id: gameId } });
  return g.state as unknown as GameState;
}

/** n ta foydalanuvchi /start bosgan va lobbyga qo'shilgan */
export async function lobbyWithPlayers(s: TestServices, n: number): Promise<{ gameId: string; number: number; tg: number[] }> {
  const tg = Array.from({ length: n }, (_, i) => 1000 + i);
  for (const id of tg) await s.users.upsert(tgUser(id), { dmOpened: true });
  const r = await s.lobby.createLobby({ chatId: CHAT_ID, title: 'Test guruh', host: tgUser(tg[0]!), isAdmin: true });
  if (!r.ok) throw new Error(r.error);
  for (const id of tg.slice(1)) {
    const j = await s.lobby.join({ number: r.number }, tgUser(id));
    if (!j.ok) throw new Error(j.error);
  }
  return { gameId: r.gameId, number: r.number, tg };
}

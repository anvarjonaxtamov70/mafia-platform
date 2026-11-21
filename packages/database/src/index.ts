import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

export interface DbOptions {
  /** Ulanishlar havzasi hajmi (connection pooling) */
  poolSize?: number;
}

export function createPrismaClient(databaseUrl: string, opts: DbOptions = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: opts.poolSize ?? 10 });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
/** Interaktiv tranzaksiya ichidagi klient */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

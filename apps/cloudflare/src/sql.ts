/**
 * SQL qatlami: Workers'da ctx.storage.sql (Durable Object SQLite), testlarda node:sqlite.
 */
export type SqlParam = string | number | null;

export interface Sql {
  exec<T = Record<string, unknown>>(query: string, ...params: SqlParam[]): T[];
  /**
   * Atomik tranzaksiya: fn ichida xato bo'lsa hammasi bekor qilinadi.
   * Ichma-ich chaqiruvlar tashqi tranzaksiyaga qo'shiladi.
   */
  tx<T>(fn: () => T): T;
}

/** Ichma-ich tx chaqiruvlarini bitta tashqi tranzaksiyaga birlashtiradi. */
export function reentrantTx(run: <T>(fn: () => T) => T): <T>(fn: () => T) => T {
  let depth = 0;
  return <T>(fn: () => T): T => {
    if (depth > 0) return fn();
    depth++;
    try {
      return run(fn);
    } finally {
      depth--;
    }
  };
}

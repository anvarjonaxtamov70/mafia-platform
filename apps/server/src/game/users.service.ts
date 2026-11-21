import type { Db, Tx, User } from '@mafia/database';

export interface TgUser {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
  is_bot?: boolean;
}

export function displayName(u: { firstName: string; lastName?: string | null; username?: string | null }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const name = full || (u.username ? `@${u.username}` : 'O‘yinchi');
  return name.slice(0, 32);
}

export class UsersService {
  constructor(private readonly db: Db) {}

  /** Telegram user_id asosiy identifikator; username o'zgarsa akkaunt saqlanadi (§3.1). */
  async upsert(from: TgUser, opts: { dmOpened?: boolean } = {}, tx: Db | Tx = this.db): Promise<User> {
    const telegramId = BigInt(from.id);
    const data = {
      username: from.username ?? null,
      firstName: from.first_name ?? '',
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
      lastActiveAt: new Date(),
      ...(opts.dmOpened ? { dmAvailable: true, dmBlockedAt: null } : {}),
    };
    const user = await tx.user.upsert({
      where: { telegramId },
      create: { telegramId, ...data, dmAvailable: !!opts.dmOpened, profile: { create: {} } },
      update: data,
    });
    return user;
  }

  async byTelegramId(id: number | bigint, tx: Db | Tx = this.db): Promise<User | null> {
    return tx.user.findUnique({ where: { telegramId: BigInt(id) } });
  }

  async isBanned(userId: string, tx: Db | Tx = this.db): Promise<boolean> {
    const now = new Date();
    const ban = await tx.ban.findFirst({
      where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    return !!ban;
  }

  async markDmBlocked(telegramId: bigint): Promise<void> {
    await this.db.user.updateMany({ where: { telegramId }, data: { dmAvailable: false, dmBlockedAt: new Date() } });
  }

  /** /delete_me: anonimlashtirish. To'lov va audit yozuvlari saqlanadi (§31.6). */
  async anonymize(userId: string): Promise<void> {
    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { username: null, firstName: 'Deleted', lastName: null, languageCode: null, deletedAt: new Date() },
      }),
      this.db.auditLog.create({ data: { actorId: userId, actorType: 'USER', action: 'DELETE_ME', entityType: 'users', entityId: userId } }),
    ]);
  }
}

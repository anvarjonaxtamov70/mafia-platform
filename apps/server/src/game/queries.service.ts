import type { GameState } from '@mafia/game-engine';
import type { Db } from '@mafia/database';
import { escapeHtml, t } from '@mafia/localization';
import { totalXpForLevel } from '@mafia/bot-core';
import { displayName } from './users.service';

/** Faqat o'qish uchun so'rovlar (profil, reyting, holat). Maxfiy rollar chiqarilmaydi. */
export class QueriesService {
  constructor(private readonly db: Db, private readonly clock: () => number = Date.now) {}

  async profileText(userId: string): Promise<string> {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) return t('common.error');
    const p = user.profile ?? (await this.db.userProfile.create({ data: { userId } }));
    const decided = p.gamesWon + p.gamesLost;
    const winRate = decided > 0 ? ((p.gamesWon / (p.gamesWon + p.gamesLost + p.gamesDrawn)) * 100).toFixed(2) : '0.00';
    return t('profile.text', {
      name: escapeHtml(displayName(user)),
      id: String(user.telegramId),
      level: p.level,
      xp: p.xp,
      nextXp: totalXpForLevel(p.level + 1),
      rating: p.rating,
      played: p.gamesPlayed,
      won: p.gamesWon,
      lost: p.gamesLost,
      drawn: p.gamesDrawn,
      winRate,
      mafiaWins: p.mafiaWins,
      cityWins: p.cityWins,
      neutralWins: p.neutralWins,
      streak: p.currentWinStreak,
      bestStreak: p.bestWinStreak,
    });
  }

  async globalRating(userId: string | null): Promise<string> {
    const top = await this.db.userProfile.findMany({
      where: { gamesPlayed: { gt: 0 }, user: { isFake: false, deletedAt: null } },
      orderBy: [{ rating: 'desc' }, { gamesWon: 'desc' }],
      take: 10,
      include: { user: true },
    });
    if (top.length === 0) return `${t('rating.title')}\n\n${t('rating.empty')}`;
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((p, i) =>
      t('rating.line', { place: medals[i] ? `${medals[i]} ${i + 1}` : i + 1, name: escapeHtml(displayName(p.user)), rp: p.rating }),
    );
    let you = '';
    if (userId) {
      const me = await this.db.userProfile.findUnique({ where: { userId } });
      if (me && me.gamesPlayed > 0) {
        const better = await this.db.userProfile.count({ where: { rating: { gt: me.rating }, gamesPlayed: { gt: 0 }, user: { isFake: false } } });
        you = t('rating.you', { place: better + 1, rp: me.rating });
      }
    }
    return `${t('rating.title')}\n\n${lines.join('\n')}\n${you}`;
  }

  async groupLeaderboard(chatId: number): Promise<string> {
    const group = await this.db.group.findUnique({ where: { telegramChatId: BigInt(chatId) } });
    if (!group) return `${t('group_rating.title')}\n\n${t('rating.empty')}`;
    const rows = await this.db.gameResult.groupBy({
      by: ['userId'],
      where: { groupId: group.id },
      _count: { _all: true },
    });
    const wins = await this.db.gameResult.groupBy({
      by: ['userId'],
      where: { groupId: group.id, resultType: { in: ['WIN', 'PERSONAL_WIN'] } },
      _count: { _all: true },
    });
    const winMap = new Map(wins.map((w) => [w.userId, w._count._all]));
    const sorted = rows
      .map((r) => ({ userId: r.userId, games: r._count._all, wins: winMap.get(r.userId) ?? 0 }))
      .sort((a, b) => b.wins - a.wins || b.games - a.games)
      .slice(0, 10);
    if (sorted.length === 0) return `${t('group_rating.title')}\n\n${t('rating.empty')}`;
    const users = await this.db.user.findMany({ where: { id: { in: sorted.map((s) => s.userId) } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const lines = sorted.map((s, i) =>
      t('group_rating.line', { place: i + 1, name: escapeHtml(byId.get(s.userId) ? displayName(byId.get(s.userId)!) : '?'), wins: s.wins, games: s.games }),
    );
    return `${t('group_rating.title')}\n\n${lines.join('\n')}`;
  }

  async activeGame(chatId: number) {
    const group = await this.db.group.findUnique({ where: { telegramChatId: BigInt(chatId) } });
    if (!group) return null;
    return this.db.game.findUnique({
      where: { activeGroupKey: group.id },
      include: { players: { orderBy: { joinedAt: 'asc' } } },
    });
  }

  async statusText(chatId: number): Promise<string> {
    const game = await this.activeGame(chatId);
    if (!game) return t('game.no_active');
    if (game.status === 'LOBBY') {
      return t('lobby.players_title', {
        count: game.players.length,
        list: game.players.map((p, i) => `${i + 1}. ${escapeHtml(p.displayName)}`).join('\n') || t('lobby.empty_list'),
      });
    }
    const state = game.state as unknown as GameState;
    const alive = state.players.filter((p) => p.status === 'ALIVE');
    const left = state.phaseEndsAt ? Math.max(0, Math.round((state.phaseEndsAt - this.clock()) / 1000)) : 0;
    return t('game.status', {
      mode: t(`mode.${state.mode}`),
      phase: t(`phase.${state.phase}`),
      night: state.nightNumber,
      day: state.dayNumber,
      left,
      aliveCount: alive.length,
      alive: alive.map((p) => `${p.seat}. ${escapeHtml(p.name)}`).join('\n'),
    });
  }

  async adminStats(): Promise<string> {
    const startOfDay = new Date(this.clock());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [users, groups, active, today, outbox] = await Promise.all([
      this.db.user.count({ where: { isFake: false } }),
      this.db.group.count({ where: { status: 'ACTIVE' } }),
      this.db.game.count({ where: { status: { in: ['LOBBY', 'RUNNING'] } } }),
      this.db.game.count({ where: { status: 'FINISHED', finishedAt: { gte: startOfDay } } }),
      this.db.outboxMessage.count({ where: { status: { in: ['PENDING', 'SENDING'] } } }),
    ]);
    return t('admin.stats', { users, groups, active, today, outbox });
  }
}

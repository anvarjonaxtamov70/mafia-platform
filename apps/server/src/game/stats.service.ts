import type { GameState } from '@mafia/game-engine';
import type { Tx } from '@mafia/database';
import { t } from '@mafia/localization';
import type { OutboxDraft } from '../telegram/outbox-types';
import { levelForXp, simpleRating, xpFor, type RatingStrategy } from './progression';

export interface StatsGame {
  id: string;
  groupId: string;
}

export interface StatsUser {
  telegramId: bigint;
  isFake: boolean;
}

/**
 * O'yin natijalarini saqlash va profillarni yangilash. Bir o'yin uchun faqat bir marta
 * (game_results (game_id, user_id) unique + o'yin yakunlanishi qulf ostida bir marta bo'ladi).
 */
export class StatsService {
  constructor(private readonly rating: RatingStrategy = simpleRating) {}

  async recordGame(tx: Tx, game: StatsGame, state: GameState, users: Map<string, StatsUser>): Promise<OutboxDraft[]> {
    const result = state.result;
    if (!result) return [];
    const drafts: OutboxDraft[] = [];
    for (const r of result.players) {
      const u = users.get(r.playerId);
      if (!u || u.isFake) continue;
      const p = state.players.find((x) => x.id === r.playerId)!;
      const active = p.missedVotes === 0 && p.missedActions === 0;
      const xp = xpFor(r, active);
      const ratingChange = this.rating.change(r, state.config.ranked);
      const created = await tx.gameResult.createMany({
        data: [
          {
            gameId: game.id,
            userId: r.playerId,
            roleId: r.role,
            faction: r.faction,
            resultType: r.outcome,
            survived: r.survived,
            xpAwarded: xp,
            ratingChange,
            ranked: state.config.ranked,
            groupId: game.groupId,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0) continue;

      const profile = await tx.userProfile.upsert({ where: { userId: r.playerId }, create: { userId: r.playerId }, update: {} });
      const won = r.outcome === 'WIN' || r.outcome === 'PERSONAL_WIN';
      const newXp = Math.max(0, profile.xp + xp);
      const streak = won ? profile.currentWinStreak + 1 : r.outcome === 'DRAW' ? profile.currentWinStreak : 0;
      await tx.userProfile.update({
        where: { userId: r.playerId },
        data: {
          xp: newXp,
          level: levelForXp(newXp),
          rating: Math.max(0, profile.rating + ratingChange),
          gamesPlayed: { increment: 1 },
          gamesFinished: { increment: r.left ? 0 : 1 },
          gamesLeft: { increment: r.left ? 1 : 0 },
          gamesWon: { increment: won ? 1 : 0 },
          gamesLost: { increment: r.outcome === 'LOSS' ? 1 : 0 },
          gamesDrawn: { increment: r.outcome === 'DRAW' ? 1 : 0 },
          personalWins: { increment: r.outcome === 'PERSONAL_WIN' ? 1 : 0 },
          mafiaWins: { increment: won && r.faction === 'MAFIA' ? 1 : 0 },
          cityWins: { increment: won && r.faction === 'CITY' ? 1 : 0 },
          neutralWins: { increment: won && r.faction === 'NEUTRAL' ? 1 : 0 },
          survivedGames: { increment: r.survived ? 1 : 0 },
          afkStrikes: { increment: p.missedVotes + p.missedActions >= 3 ? 1 : 0 },
          currentWinStreak: streak,
          bestWinStreak: Math.max(profile.bestWinStreak, streak),
        },
      });
      await tx.userRoleStat.upsert({
        where: { userId_role: { userId: r.playerId, role: r.role } },
        create: { userId: r.playerId, role: r.role, played: 1, won: won ? 1 : 0 },
        update: { played: { increment: 1 }, won: { increment: won ? 1 : 0 } },
      });
      const rating = ratingChange !== 0 ? ` · 🏅 ${ratingChange > 0 ? '+' : ''}${ratingChange} RP` : '';
      drafts.push({
        chatId: u.telegramId,
        payload: { kind: 'SEND', text: t('dm.game_over', { outcome: t(`dm.outcome.${r.outcome}`), xp, rating }) },
        dedupeKey: `g:${game.id}:result:${r.playerId}`,
        gameId: game.id,
      });
    }
    return drafts;
  }
}

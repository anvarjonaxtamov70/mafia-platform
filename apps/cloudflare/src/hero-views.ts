import { backRow, displayName, encode, type Keyboard } from '@mafia/bot-core';
import { escapeHtml, t } from '@mafia/localization';
import { HERO_DAILY_CAP, HERO_MAX_LEVEL, heroThreshold, type HeroAccount, type HeroCore } from './hero-core';

type View = { text: string; keyboard: Keyboard };
const button = (text: string, section: string) => ({ text, callback_data: encode({ t: 'menu', section }) });
const nav = (): Keyboard => [[button(t('hero.menu'), 'hero'), button(t('hero.collection'), 'heroes')], [button(t('hero.top'), 'herotop')], backRow()];
const rarityIcon = { COMMON: '⚪', RARE: '🔵', EPIC: '🟣', LEGENDARY: '🟠', MYTHIC: '🔴' } as const;

export function heroView(a: HeroAccount, section: string, visuals: boolean): View {
  if (section === 'heroes') return {
    text: t('hero.collection_title', { count: a.heroes.filter((h) => h.unlocked).length, total: a.heroes.length, xp: a.totalXp }) + '\n\n' + t('hero.unlock_info'),
    keyboard: [...a.heroes.map((h) => [button((h.unlocked ? rarityIcon[h.rarity] : '🔒') + ' ' + h.name + (a.selected === h.code ? ' ✓' : ''), 'hero_' + h.code)]), ...nav()],
  };
  const h = a.heroes.find((x) => x.code === (section.startsWith('hero_') ? section.slice(5) : a.selected)) ?? a.heroes[0]!;
  const lo = heroThreshold(h.level);
  const hi = heroThreshold(h.level + 1);
  const filled = h.level === HERO_MAX_LEVEL ? 10 : Math.floor(10 * (h.xp - lo) / Math.max(1, hi - lo));
  const bar = '▰'.repeat(Math.max(0, Math.min(10, filled))) + '▱'.repeat(Math.max(0, 10 - Math.max(0, Math.min(10, filled))));
  const progress = h.level === HERO_MAX_LEVEL ? 'MAX' : String(h.xp - lo) + ' / ' + (hi - lo);
  return {
    text: t('hero.title', { name: escapeHtml(h.name), rarity: rarityIcon[h.rarity] + ' ' + h.rarity, level: h.level, bar, progress, total: a.totalXp, daily: a.todayXp, cap: HERO_DAILY_CAP }) +
      '\n\n' + (!h.unlocked ? t('hero.locked', { xp: h.unlockXp }) : h.code === a.selected ? t('hero.selected') : t('hero.available')) +
      (a.owner ? '\n' + t('hero.owner') : '') + '\n\n' + t('hero.rules'),
    keyboard: [...(h.unlocked && h.code !== a.selected ? [[button(t('hero.select'), 'pick_' + h.code)]] : []), ...(visuals ? [[button(t('visual.card_button'), 'art_' + h.art.toLowerCase())]] : []), ...nav()],
  };
}
export function heroTopView(rows: ReturnType<HeroCore['top']>): View {
  return { text: t('hero.top_title') + '\n\n' + (rows.length ? rows.map((x, i) => t('hero.top_line', { rank: i + 1, name: escapeHtml(displayName({ firstName: x.first_name, lastName: x.last_name, username: x.username })), xp: x.total_xp })).join('\n') : t('hero.top_empty')) + '\n\n' + t('hero.top_info'), keyboard: nav() };
}

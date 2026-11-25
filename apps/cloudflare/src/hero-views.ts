import { backRow, displayName, encode, type Keyboard } from '@mafia/bot-core';
import { escapeHtml, t } from '@mafia/localization';
import type { HeroCore } from './hero-core';
type View = { text: string; keyboard: Keyboard };
const btn = (text: string, section: string) => ({ text, callback_data: encode({t:'menu',section}) });
export function heroView(a: ReturnType<HeroCore['single']>): View {
  if (!a.owned) return {text:t('hero.single_locked'),keyboard:[[{text:'Sotib olish · 100 💎',callback_data:encode({t:'eco',op:'herobuy',arg:''})}], [btn('Do‘kon','shop')],backRow()]};
  return {text:t('hero.single_owned',{level:a.level,xp:a.totalXp})+(a.owner?'\n\n'+t('hero.owner_level_help'):''),
    keyboard:[[btn('Geroylar reytingi','herotop')],[btn('Profil','profile')],backRow()]};
}
export function heroTopView(rows: ReturnType<HeroCore['top']>): View {
  return { text: '<b>Geroylar TOP 10</b>\n\n'+(rows.length?rows.map((x,i)=>(i+1)+'. '+escapeHtml(displayName({firstName:x.first_name,lastName:x.last_name,username:x.username}))+' — '+(Math.floor(Math.sqrt(x.total_xp/5))+1)+' daraja').join('\n'):t('hero.top_empty')), keyboard:[[btn('Mening geroyim','hero')],backRow()] };
}

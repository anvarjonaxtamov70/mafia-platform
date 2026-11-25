/**
 * Iqtisodiyot ko'rinishlari: do'kon, inventar, kunlik mukofot, VIP, taklif, rol statistikasi.
 * Faqat ma'lumotdan matn va tugma yasaydi — saqlash va tekshiruv serverda.
 */
import { getRole, type RoleCode } from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import { encode } from './callback-data';
import {
  CATALOG,
  catalogItem,
  formatDate,
  isAvailable,
  REFERRAL,
  starsProduct,
  type CatalogItem,
  type DailyInfo,
  type InventoryInfo,
  type ItemKind,
  type ReferralInfo,
  type RoleStatRow,
  type WalletInfo,
} from './economy';
import { rows, type Button, type Keyboard } from './outbox-types';
import { backRow } from './views';

export interface View {
  text: string;
  keyboard: Keyboard;
}

const eb = (text: string, op: string, arg = ''): Button => ({ text, callback_data: encode({ t: 'eco', op, arg }) });
const menuBtn = (text: string, section: string): Button => ({ text, callback_data: encode({ t: 'menu', section }) });

export const itemName = (code: string): string => t(`item.${code}`);

// ───────────────────────────── Do'kon ─────────────────────────────

export function shopHomeView(coins: number): View {
  return {
    text: t('shop.title', { coins }),
    keyboard: [
      [eb(t('shop.cat.FRAME'), 'cat', 'FRAME')],
      [eb(t('shop.cat.TITLE'), 'cat', 'TITLE')],
      [eb(t('shop.cat.ARCADE'), 'cat', 'ARCADE')],
      [menuBtn(t('shop.cat.VIP'), 'vip')],
      [menuBtn(t('menu.inventory'), 'inventory')],
      backRow(),
    ],
  };
}

export function shopCategoryView(kind: ItemKind, inv: InventoryInfo): View {
  const lines: string[] = [];
  const buttons: Button[] = [];
  for (const it of CATALOG.filter((i) => i.kind === kind)) {
    const name = itemName(it.code);
    if (it.kind === 'ARCADE') {
      const qty = inv.items.find((x) => x.code === it.code)?.qty ?? 0;
      lines.push(t('shop.item_arcade', { emoji: it.emoji, name, price: it.price ?? 0, qty }));
      lines.push(`   <i>${t(`item_desc.${it.code}`)}</i>`);
      buttons.push(eb(t('shop.btn_buy', { name, price: it.price ?? 0 }), 'buy', it.code));
      continue;
    }
    const available = isAvailable(it, inv);
    if (it.price === null) {
      lines.push(t('shop.item_tier', { emoji: it.emoji, name, tier: t(`tier.${it.tier}`) }) + (available ? ' ✅' : ''));
    } else if (available) {
      lines.push(t('shop.item_owned', { emoji: it.emoji, name }));
    } else {
      lines.push(t('shop.item_line', { emoji: it.emoji, name, price: it.price }));
      buttons.push(eb(t('shop.btn_buy', { name, price: it.price }), 'buy', it.code));
    }
  }
  const text = `${t(`shop.cat.${kind}`)}\n\n${t(`shop.cat_desc.${kind}`)}\n\n${lines.join('\n')}\n\n${t('shop.balance', { coins: inv.coins })}`;
  return { text, keyboard: [...rows(buttons, 1), [eb(t('common.back'), 'shop')]] };
}

export function buyConfirmView(item: CatalogItem, coins: number): View {
  return {
    text: t('shop.confirm', { emoji: item.emoji, name: itemName(item.code), price: item.price ?? 0, coins }),
    keyboard: [[eb(t('common.yes'), 'buyok', item.code), eb(t('common.no'), 'cat', item.kind)]],
  };
}

// ───────────────────────────── Inventar ─────────────────────────────

export function inventoryView(inv: InventoryInfo): View {
  const parts: string[] = [t('inv.title', { coins: inv.coins })];
  const buttons: Button[] = [];
  const onoff = (v: boolean) => t(v ? 'gsettings.on' : 'gsettings.off');

  const arcade = CATALOG.filter((i) => i.kind === 'ARCADE')
    .map((it) => ({ it, row: inv.items.find((x) => x.code === it.code) }))
    .filter((x) => x.row && (x.row.qty > 0 || x.row.armed));
  if (arcade.length > 0) {
    parts.push(t('inv.arcade_title'));
    for (const { it, row } of arcade) {
      parts.push(t('inv.arcade_line', { emoji: it.emoji, name: itemName(it.code), qty: row!.qty, armed: onoff(row!.armed) }));
      buttons.push(eb(t('inv.btn_arm', { emoji: it.emoji, name: itemName(it.code), state: row!.armed ? '✅' : '❌' }), 'arm', it.code));
    }
    parts.push(`<i>${t('inv.arcade_note')}</i>`);
  }

  for (const kind of ['FRAME', 'TITLE'] as const) {
    const owned = CATALOG.filter((i) => i.kind === kind && isAvailable(i, inv));
    if (owned.length === 0) continue;
    parts.push(t(kind === 'FRAME' ? 'inv.frames_title' : 'inv.titles_title'));
    const current = kind === 'FRAME' ? inv.frame : inv.title;
    for (const it of owned) {
      const equipped = current === it.code;
      parts.push(t('inv.cosmetic_line', { emoji: it.emoji, name: itemName(it.code), equipped: equipped ? t('inv.equipped') : '' }));
      const op = equipped ? (kind === 'FRAME' ? 'uf' : 'ut') : kind === 'FRAME' ? 'ef' : 'et';
      buttons.push(eb(t(equipped ? 'inv.btn_unequip' : 'inv.btn_equip', { emoji: it.emoji, name: itemName(it.code) }), op, equipped ? '' : it.code));
    }
  }
  if (parts.length === 1) parts.push(t('inv.empty'));
  return { text: parts.join('\n'), keyboard: [...rows(buttons, 1), [menuBtn(t('menu.shop'), 'shop')], backRow()] };
}

// ───────────────────────────── VIP ─────────────────────────────

export function vipView(w: WalletInfo, o: { starsAllowed: boolean; isAdmin: boolean }): View {
  if (w.permanentOwner) {
    return { text: t('owner.vip'), keyboard: [...(o.starsAllowed && o.isAdmin ? [[eb(t('vip.btn_test'), 'star', 'TEST_1')]] : []), [menuBtn(t('menu.shop'), 'shop')], backRow()] };
  }
  const until = w.tier === 'VIP_PRO' ? w.proUntil : w.tier === 'VIP' ? w.vipUntil : null;
  const vip = starsProduct('VIP_30')!;
  const pro = starsProduct('VIP_PRO_30')!;
  const text = [
    t('vip.title', {
      tier: t(`tier.${w.tier}`),
      until: until ? t('vip.until', { date: formatDate(until) }) : '',
      vipPrice: vip.stars,
      proPrice: pro.stars,
    }),
    o.starsAllowed ? t('vip.repeat_note') : t('vip.stars_soon'),
  ].join('\n\n');
  const keyboard: Keyboard = [];
  if (o.starsAllowed) {
    keyboard.push([eb(t('vip.btn_buy_vip', { stars: vip.stars }), 'star', 'VIP_30')]);
    keyboard.push([eb(t('vip.btn_buy_pro', { stars: pro.stars }), 'star', 'VIP_PRO_30')]);
    if (o.isAdmin) keyboard.push([eb(t('vip.btn_test'), 'star', 'TEST_1')]);
  }
  keyboard.push([menuBtn(t('menu.shop'), 'shop')], backRow());
  return { text, keyboard };
}

// ───────────────────────────── Kunlik mukofot va vazifalar ─────────────────────────────

export function dailyView(d: DailyInfo): View {
  const status = d.claimedToday ? t('daily.claimed', { amount: d.nextAmount }) : t('daily.ready', { amount: d.nextAmount, day: d.nextStreak });
  const quests = d.quests
    .map((q) =>
      t('quest.line', {
        mark: q.claimed ? '✅' : q.progress >= q.target ? '🎁' : '▫️',
        name: t(`quest.${q.code}`),
        progress: Math.min(q.progress, q.target),
        target: q.target,
        reward: q.reward,
      }),
    )
    .join('\n');
  const keyboard: Keyboard = [];
  if (!d.claimedToday) keyboard.push([eb(t('daily.btn_claim', { amount: d.nextAmount }), 'daily')]);
  for (const q of d.quests) {
    if (!q.claimed && q.progress >= q.target) keyboard.push([eb(t('quest.btn_claim', { name: t(`quest.${q.code}`), reward: q.reward }), 'qc', q.code)]);
  }
  keyboard.push([menuBtn(t('menu.shop'), 'shop')], backRow());
  return {
    text: `${t('daily.title', { status, quests, coins: d.coins })}\n\n<i>${t('daily.streak_note')}\n${t('quest.note')}</i>`,
    keyboard,
  };
}

// ───────────────────────────── Taklif ─────────────────────────────

export function inviteView(info: ReferralInfo, link: string): View {
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('invite.share_text'))}`;
  return {
    text: t('invite.title', { link: escapeHtml(link), games: REFERRAL.gamesRequired, reward: REFERRAL.reward, invited: info.invited, rewarded: info.rewarded }),
    keyboard: [[{ text: t('invite.btn_share'), url: share }], backRow()],
  };
}

// ───────────────────────────── Profil va statistika ─────────────────────────────

export function profileKeyboard(): Keyboard {
  return [[eb(t('profile.btn_stats'), 'stats'), menuBtn(t('profile.btn_inventory'), 'inventory')], backRow()];
}

export function roleStatsView(stats: RoleStatRow[], w: WalletInfo): View {
  if (w.tier === 'FREE') return { text: t('stats.vip_only'), keyboard: [[menuBtn(t('menu.vip'), 'vip')], backRow()] };
  const lines = stats
    .filter((s) => s.played > 0)
    .sort((a, b) => b.played - a.played)
    .map((s) => {
      const def = (() => {
        try {
          return getRole(s.role as RoleCode);
        } catch {
          return null;
        }
      })();
      return t('stats.line', {
        emoji: def?.emoji ?? '🎭',
        role: t(`role.${s.role}.name`),
        played: s.played,
        won: s.won,
        rate: ((s.won / s.played) * 100).toFixed(0),
      });
    });
  return { text: `${t('stats.title')}\n\n${lines.length ? lines.join('\n') : t('stats.empty')}`, keyboard: [backRow()] };
}

export function walletBadge(w: Pick<WalletInfo, 'tier'>): string {
  return w.tier === 'VIP_PRO' ? '💎' : w.tier === 'VIP' ? '👑' : '';
}

export { catalogItem };

import { describe, expect, it } from 'vitest';
import { DAY_MS, decode, encode, refCode, tashkentDay } from '@mafia/bot-core';
import { callback, GROUP, groupText, lobby, playToEnd, privateText, user, World } from './harness';

const lastEdit = (w: World) => String(w.tg.calls.filter((c) => c.method === 'editMessageText').at(-1)?.params['text'] ?? '');
const lastAnswer = (w: World) => String(w.tg.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.params['text'] ?? '');
const invoices = (w: World) => w.tg.calls.filter((c) => c.method === 'sendInvoice');

function paymentUpdate(from: number, payload: string, amount: number, charge: string) {
  return {
    message: {
      message_id: 1,
      chat: { id: from, type: 'private' as const },
      from: user(from),
      successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: charge },
    },
  };
}

function preCheckout(from: number, payload: string, amount: number, id = 'pc') {
  return { pre_checkout_query: { id, from: user(from), currency: 'XTR', total_amount: amount, invoice_payload: payload } };
}

/** Admin VIP sotib oladi: invoice → pre_checkout → successful_payment */
async function buyStars(w: World, tgId: number, product: string, charge: string): Promise<string> {
  await w.send(callback(tgId, `e:star:${product}`));
  const inv = invoices(w).at(-1)!;
  const payload = String(inv.params['payload']);
  const amount = (inv.params['prices'] as { amount: number }[])[0]!.amount;
  await w.send(preCheckout(tgId, payload, amount, `pc-${charge}`));
  await w.send(paymentUpdate(tgId, payload, amount, charge));
  return payload;
}

describe('callback_data: iqtisodiyot', () => {
  it('kodlanadi, 64 baytdan oshmaydi, noto‘g‘ri qiymat rad etiladi', () => {
    const raw = encode({ t: 'eco', op: 'buyok', arg: 'DETECTIVE_MASTER' });
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64);
    expect(decode(raw)).toEqual({ t: 'eco', op: 'buyok', arg: 'DETECTIVE_MASTER' });
    expect(decode('e:shop:')).toEqual({ t: 'eco', op: 'shop', arg: '' });
    expect(decode('e:BUY:X')).toBeNull();
    expect(decode('e:buy:x;drop')).toBeNull();
    expect(decode('e:buy:A:B')).toBeNull();
  });
});

describe('Coins ledger', () => {
  it('kirim/chiqim, idempotentlik, manfiy balans yo‘q, kesh = ledger yig‘indisi', () => {
    const w = new World();
    const eco = w.registryCore.eco;
    expect(eco.credit(1, 100, 'TEST', null, 'a').balance).toBe(100);
    expect(eco.credit(1, 100, 'TEST', null, 'a')).toEqual({ balance: 100, duplicate: true });
    expect(eco.credit(1, -40, 'TEST', null, 'b').balance).toBe(60);
    expect(() => eco.credit(1, -100, 'TEST', null, 'c')).toThrow();
    expect(eco.coins(1)).toBe(60);
    expect(eco.ledgerBalance(1)).toBe(60);
  });
});

describe('Kunlik mukofot (§22.1)', () => {
  it('kuniga bir marta; ketma-ket kunlar 50→75→…; kun o‘tkazilsa 1-kundan', () => {
    const w = new World();
    const eco = w.registryCore.eco;
    const r1 = eco.claimDaily(5);
    expect(r1).toMatchObject({ ok: true, amount: 50, streak: 1 });
    expect(eco.claimDaily(5)).toEqual({ ok: false, error: 'ALREADY' });
    w.now += DAY_MS;
    expect(eco.claimDaily(5)).toMatchObject({ ok: true, amount: 75, streak: 2 });
    w.now += 2 * DAY_MS;
    expect(eco.claimDaily(5)).toMatchObject({ ok: true, amount: 50, streak: 1 });
    for (let i = 0; i < 7; i++) {
      w.now += DAY_MS;
      eco.claimDaily(5);
    }
    // 8-kun → yana 50
    expect(eco.dailyInfo(5).claimedToday).toBe(true);
    expect(eco.coins(5)).toBe(50 + 75 + 50 + (75 + 100 + 125 + 150 + 200 + 300 + 50));
  });

  it('kun Toshkent vaqti bo‘yicha (UTC+5)', () => {
    // 2026-11-21 19:30 UTC = 2026-11-22 00:30 Toshkent
    expect(tashkentDay(Date.UTC(2026, 10, 21, 19, 30))).toBe('2026-11-22');
    expect(tashkentDay(Date.UTC(2026, 10, 21, 18, 59))).toBe('2026-11-21');
  });

  it('menyu orqali: tugma bosilganda mukofot, ikkinchi bosishda yo‘q', async () => {
    const w = new World();
    await w.send(privateText(5, '/start'));
    await w.send(callback(5, 'm:daily'));
    expect(lastEdit(w)).toContain('KUNLIK MUKOFOT');
    await w.send(callback(5, 'e:daily:'));
    expect(lastAnswer(w)).toContain('+50');
    await w.send(callback(5, 'e:daily:'));
    expect(lastAnswer(w)).toContain('allaqachon');
    expect(w.registryCore.eco.coins(5)).toBe(50);
  });
});

describe('O‘yin mukofotlari va vazifalar', () => {
  it('o‘yin tugaganda Coins va vazifa progressi; mukofot bir marta olinadi', async () => {
    const w = new World();
    const ids = [1, 2, 3, 4, 5];
    let number = await lobby(w, ids);
    await w.send(groupText(1, '/gstart'));
    await playToEnd(w, number);
    const eco = w.registryCore.eco;
    for (const id of ids) {
      const coins = eco.coins(id);
      expect([10, 25]).toContain(coins);
    }
    expect(w.tg.texts(2).some((x) => x.includes('🪙 +'))).toBe(true);
    const q1 = eco.dailyInfo(2).quests.find((q) => q.code === 'PLAY_2')!;
    expect(q1.progress).toBe(1);
    expect(eco.claimQuest(2, 'PLAY_2')).toEqual({ ok: false });

    number = await lobby(w, ids);
    await w.send(groupText(1, '/gstart'));
    await playToEnd(w, number);
    const before = eco.coins(2);
    await w.send(callback(2, 'e:qc:PLAY_2'));
    expect(eco.coins(2)).toBe(before + 60);
    await w.send(callback(2, 'e:qc:PLAY_2'));
    expect(eco.coins(2)).toBe(before + 60);
  });

  it('mashq o‘yini (bot-o‘yinchilar) Coins va vazifa bermaydi', async () => {
    const w = new World({ devFake: true });
    await w.send(privateText(1, '/start'));
    w.tg.admins.add(1);
    await w.send(groupText(1, '/game'));
    await w.send(groupText(1, '/devfill 5'));
    await w.send(groupText(1, '/gstart'));
    for (let i = 0; i < 100 && w.rooms.get(GROUP)!.data.game; i++) {
      const s = w.rooms.get(GROUP)!.data.game!.state!;
      await w.advance((s.phaseEndsAt ?? w.now) - w.now + 1000);
    }
    expect(w.registryCore.eco.coins(1)).toBe(0);
    expect(w.registryCore.eco.dailyInfo(1).quests.every((q) => q.progress === 0)).toBe(true);
  });
});

describe('Do‘kon va inventar (§18, §21)', () => {
  it('Coins bilan sotib olish, yetmasa rad, ikkinchi marta olinmaydi, tanlash profilda ko‘rinadi', async () => {
    const w = new World();
    await w.send(privateText(7, '/start'));
    w.registryCore.eco.credit(7, 1000, 'TEST', null, 'seed');
    await w.send(callback(7, 'm:shop'));
    expect(lastEdit(w)).toContain('MAFIA DO‘KONI');
    await w.send(callback(7, 'e:cat:FRAME'));
    expect(lastEdit(w)).toContain('Bronze ramka');
    await w.send(callback(7, 'e:buy:BRONZE'));
    expect(lastEdit(w)).toContain('Sotib olasizmi');
    await w.send(callback(7, 'e:buyok:BRONZE'));
    expect(lastAnswer(w)).toContain('Sotib olindi');
    expect(w.registryCore.eco.coins(7)).toBe(700);
    await w.send(callback(7, 'e:buyok:BRONZE'));
    expect(lastAnswer(w)).toContain('allaqachon');
    await w.send(callback(7, 'e:buyok:GOLD'));
    expect(lastAnswer(w)).toContain('yetarli emas');
    expect(w.registryCore.eco.coins(7)).toBe(700);
    w.now += 3000; // tugma bosish tezligi chegarasi: 3 soniyada 6 ta
    await w.send(callback(7, 'e:ef:BRONZE'));
    expect(w.registryCore.profileText(7)).toContain('🥉━');
    await w.send(callback(7, 'e:uf:'));
    expect(w.registryCore.profileText(7)).not.toContain('🥉━');
    expect(w.registryCore.eco.ledgerBalance(7)).toBe(700);
  });

  it('VIP buyumini Coins bilan olib bo‘lmaydi, sotib olinmagan ramkani tanlab bo‘lmaydi', async () => {
    const w = new World();
    await w.send(privateText(7, '/start'));
    w.registryCore.eco.credit(7, 5000, 'TEST', null, 'seed');
    await w.send(callback(7, 'e:buyok:DIAMOND'));
    expect(lastAnswer(w)).toContain('VIP');
    expect(w.registryCore.eco.equip(7, 'FRAME', 'GOLD')).toBe(false);
    expect(w.registryCore.eco.equip(7, 'FRAME', 'DIAMOND')).toBe(false);
    expect(w.registryCore.eco.coins(7)).toBe(5000);
  });

  it('Arcade buyumlari to‘planadi, Arcade’da ishlatish yoqiladi/o‘chiriladi', async () => {
    const w = new World();
    await w.send(privateText(7, '/start'));
    w.registryCore.eco.credit(7, 1000, 'TEST', null, 'seed');
    await w.send(callback(7, 'e:buyok:SHIELD'));
    await w.send(callback(7, 'e:buyok:SHIELD'));
    expect(w.registryCore.eco.inventory(7).items.find((i) => i.code === 'SHIELD')).toEqual({ code: 'SHIELD', qty: 2, armed: false });
    await w.send(callback(7, 'e:arm:SHIELD'));
    expect(w.registryCore.eco.inventory(7).items.find((i) => i.code === 'SHIELD')!.armed).toBe(true);
    await w.send(callback(7, 'm:inventory'));
    expect(lastEdit(w)).toContain('Qalqon: 2 ta');
  });
});

describe('Arcade rejimi: buyumlarni band qilish va hisob-kitob', () => {
  it('yoqilgan qalqon o‘yin boshida band qilinadi, e’lon qilinadi; ishlatilmasa qaytadi', async () => {
    const w = new World();
    const ids = [1, 2, 3, 4];
    for (const id of ids) await w.send(privateText(id, '/start'));
    const eco = w.registryCore.eco;
    eco.credit(2, 500, 'TEST', null, 'seed');
    eco.buy(2, 'SHIELD', 'b1');
    eco.toggleArm(2, 'SHIELD');
    const number = await lobby(w, ids, 'arcade');
    await w.send(groupText(1, '/gstart'));
    expect(w.tg.texts(GROUP).some((x) => x.includes('Qalqon bilan: 1'))).toBe(true);
    expect(eco.inventory(2).items.find((i) => i.code === 'SHIELD')!.qty).toBe(0);
    // Mafia hujum qilmaydi → qalqon ishlatilmaydi → qaytariladi
    await playToEnd(w, number);
    expect(eco.inventory(2).items.find((i) => i.code === 'SHIELD')!.qty).toBe(1);
  });

  it('Classic rejimida buyumlar band qilinmaydi', async () => {
    const w = new World();
    const ids = [1, 2, 3, 4];
    for (const id of ids) await w.send(privateText(id, '/start'));
    const eco = w.registryCore.eco;
    eco.credit(2, 500, 'TEST', null, 'seed');
    eco.buy(2, 'SHIELD', 'b1');
    eco.toggleArm(2, 'SHIELD');
    await lobby(w, ids);
    await w.send(groupText(1, '/gstart'));
    expect(eco.inventory(2).items.find((i) => i.code === 'SHIELD')!.qty).toBe(1);
    expect(w.tg.texts(GROUP).some((x) => x.includes('ARCADE BUYUMLARI'))).toBe(false);
  });

  it('hisob-kitob: ishlatilgani sarflanadi, bekor qilinsa hammasi qaytadi, takroriy chaqiruv xavfsiz', () => {
    const w = new World();
    const eco = w.registryCore.eco;
    for (const id of [10, 11]) {
      eco.credit(id, 1000, 'TEST', null, `s${id}`);
      eco.buy(id, 'SHIELD', `a${id}`);
      eco.buy(id, 'FAKE_DOC', `b${id}`);
      eco.toggleArm(id, 'SHIELD');
      eco.toggleArm(id, 'FAKE_DOC');
    }
    const got = eco.reserveArcade(77, [10, 11]);
    expect(got['10']).toEqual({ shield: true, fakeDocument: true });
    expect(eco.reserveArcade(77, [10, 11])['10']).toEqual({ shield: true, fakeDocument: true });
    const qty = (id: number, code: string) => eco.inventory(id).items.find((i) => i.code === code)!.qty;
    expect(qty(10, 'SHIELD')).toBe(0);
    eco.settleArcade(77, { '10': ['SHIELD'] });
    eco.settleArcade(77, { '10': ['SHIELD'] });
    expect(qty(10, 'SHIELD')).toBe(0);
    expect(qty(10, 'FAKE_DOC')).toBe(1);
    expect(qty(11, 'SHIELD')).toBe(1);

    eco.reserveArcade(78, [11]);
    expect(qty(11, 'SHIELD')).toBe(0);
    w.registryCore.releaseGame(78);
    expect(qty(11, 'SHIELD')).toBe(1);
    expect(qty(11, 'FAKE_DOC')).toBe(1);
  });
});

describe('Referal (§23)', () => {
  it('yangi do‘st 2 ta o‘yin yakunlasa taklif qilgan 100 Coins oladi (bir marta)', async () => {
    const w = new World();
    await w.send(privateText(100, '/start'));
    await w.send(privateText(5, `/start ref_${refCode(100)}`));
    expect(w.tg.texts(5).some((x) => x.includes('do‘stingiz taklifi'))).toBe(true);
    const ids = [1, 2, 3, 5];
    for (let g = 0; g < 3; g++) {
      const number = await lobby(w, ids);
      await w.send(groupText(1, '/gstart'));
      await playToEnd(w, number);
      if (g === 0) expect(w.registryCore.eco.coins(100)).toBe(0);
    }
    expect(w.registryCore.eco.coins(100)).toBe(100);
    expect(w.tg.texts(100).some((x) => x.includes('+100'))).toBe(true);
    expect(w.registryCore.eco.referralInfo(100)).toEqual({ invited: 1, rewarded: 1 });
  });

  it('o‘zini taklif qilish, o‘ynagan foydalanuvchi va ikkinchi taklif rad etiladi', async () => {
    const w = new World();
    await w.send(privateText(100, '/start'));
    await w.send(privateText(200, '/start'));
    await w.send(privateText(300, `/start ref_${refCode(300)}`));
    expect(w.registryCore.eco.referralInfo(300).invited).toBe(0);
    await w.send(privateText(400, `/start ref_${refCode(100)}`));
    await w.send(privateText(400, `/start ref_${refCode(200)}`));
    expect(w.registryCore.eco.referralInfo(100).invited).toBe(1);
    expect(w.registryCore.eco.referralInfo(200).invited).toBe(0);
    await w.send(callback(100, 'm:invite'));
    expect(lastEdit(w)).toContain(`start=ref_${refCode(100)}`);
  });
});

describe('Telegram Stars va VIP (§19, §20)', () => {
  it('admin rejimi: oddiy foydalanuvchiga invoice yuborilmaydi, admin uchun XTR invoice', async () => {
    const w = new World({ starsMode: 'admins' });
    await w.send(privateText(2, '/start'));
    await w.send(callback(2, 'e:star:VIP_30'));
    expect(invoices(w)).toHaveLength(0);
    await w.send(privateText(1, '/start'));
    await w.send(callback(1, 'e:star:VIP_30'));
    const inv = invoices(w)[0]!;
    expect(inv.params['currency']).toBe('XTR');
    expect(inv.params['provider_token']).toBe('');
    expect(inv.params['prices']).toEqual([{ label: 'VIP — 30 kun', amount: 99 }]);
    expect(String(inv.params['payload'])).toMatch(/^o:[0-9a-f]+$/);
  });

  it('pre_checkout: noto‘g‘ri summa / boshqa foydalanuvchi rad etiladi, to‘g‘risi tasdiqlanadi', async () => {
    const w = new World({ starsMode: 'all' });
    await w.send(privateText(2, '/start'));
    await w.send(callback(2, 'e:star:VIP_30'));
    const payload = String(invoices(w)[0]!.params['payload']);
    const answers = () => w.tg.calls.filter((c) => c.method === 'answerPreCheckoutQuery');
    await w.send(preCheckout(2, payload, 1, 'a'));
    expect(answers().at(-1)!.params['ok']).toBe(false);
    await w.send(preCheckout(3, payload, 99, 'b'));
    expect(answers().at(-1)!.params['ok']).toBe(false);
    await w.send(preCheckout(2, 'o:deadbeefdeadbeef', 99, 'c'));
    expect(answers().at(-1)!.params['ok']).toBe(false);
    await w.send(preCheckout(2, payload, 99, 'd'));
    expect(answers().at(-1)!.params).toEqual({ pre_checkout_query_id: 'd', ok: true });
  });

  it('to‘lovdan keyin VIP 30 kun; takroriy update ikki marta bermaydi; qayta xarid muddatni uzaytiradi', async () => {
    const w = new World({ starsMode: 'all' });
    await w.send(privateText(2, '/start'));
    const payload = await buyStars(w, 2, 'VIP_30', 'ch-1');
    const eco = w.registryCore.eco;
    expect(eco.tierInfo(2).tier).toBe('VIP');
    expect(eco.tierInfo(2).vipUntil).toBe(w.now + 30 * DAY_MS);
    expect(w.tg.texts(2).some((x) => x.includes('To‘lov qabul qilindi'))).toBe(true);
    // Telegram update ni qayta yuborsa
    await w.send(paymentUpdate(2, payload, 99, 'ch-1'));
    expect(eco.tierInfo(2).vipUntil).toBe(w.now + 30 * DAY_MS);
    await buyStars(w, 2, 'VIP_30', 'ch-2');
    expect(eco.tierInfo(2).vipUntil).toBe(w.now + 60 * DAY_MS);
    // VIP imkoniyatlari: belgi, ramka, statistika
    expect(w.registryCore.userInfo(2)!.badge).toBe('👑');
    expect(eco.equip(2, 'FRAME', 'DIAMOND')).toBe(true);
    await w.send(callback(2, 'e:stats:'));
    expect(lastEdit(w)).toContain('ROL STATISTIKASI');
    // Muddat tugagach
    w.now += 61 * DAY_MS;
    expect(eco.tierInfo(2).tier).toBe('FREE');
    expect(eco.wallet(2).frame).toBeNull();
    expect(w.registryCore.userInfo(2)!.badge).toBe('');
  });

  it('summa mos kelmagan to‘lov UNMATCHED: mahsulot berilmaydi, adminlarga xabar', async () => {
    const w = new World({ starsMode: 'all' });
    await w.send(privateText(2, '/start'));
    await w.send(callback(2, 'e:star:VIP_PRO_30'));
    const payload = String(invoices(w)[0]!.params['payload']);
    await w.send(paymentUpdate(2, payload, 5, 'ch-x'));
    expect(w.registryCore.eco.tierInfo(2).tier).toBe('FREE');
    expect(w.tg.texts(1).some((x) => x.includes('Mos kelmagan to‘lov'))).toBe(true);
  });

  it('/refund: faqat admin; Telegram refundStarPayment, VIP davri bekor, keyingi davr suriladi', async () => {
    const w = new World({ starsMode: 'all' });
    await w.send(privateText(2, '/start'));
    await buyStars(w, 2, 'VIP_30', 'ch-1');
    await buyStars(w, 2, 'VIP_30', 'ch-2');
    await w.send(privateText(2, '/refund ch-1'));
    expect(w.tg.calls.some((c) => c.method === 'refundStarPayment')).toBe(false);
    await w.send(privateText(1, '/refund ch-1'));
    const call = w.tg.calls.find((c) => c.method === 'refundStarPayment')!;
    expect(call.params).toEqual({ user_id: 2, telegram_payment_charge_id: 'ch-1' });
    expect(w.registryCore.eco.tierInfo(2).vipUntil).toBe(w.now + 30 * DAY_MS);
    expect(w.registryCore.eco.tierInfo(2).tier).toBe('VIP');
    expect(w.tg.texts(2).some((x) => x.includes('qaytarildi'))).toBe(true);
    await w.send(privateText(1, '/refund ch-1'));
    expect(w.tg.calls.filter((c) => c.method === 'refundStarPayment')).toHaveLength(1);
    await w.send(privateText(1, '/admin_payments'));
    expect(w.tg.texts(1).at(-1)).toContain('REFUNDED');
  });

  it('test to‘lov (1 ⭐) faqat admin uchun, hech narsa bermaydi', async () => {
    const w = new World({ starsMode: 'all' });
    await w.send(privateText(2, '/start'));
    await w.send(callback(2, 'e:star:TEST_1'));
    expect(invoices(w)).toHaveLength(0);
    await w.send(privateText(1, '/start'));
    await buyStars(w, 1, 'TEST_1', 'ch-t');
    expect(w.tg.texts(1).some((x) => x.includes('/refund ch-t'))).toBe(true);
    expect(w.registryCore.eco.tierInfo(1).tier).toBe('FREE');
  });

  it('VIP sahifasi: to‘lov yopiq bo‘lsa tugma yo‘q', async () => {
    const w = new World({ starsMode: 'off' });
    await w.send(privateText(1, '/start'));
    await w.send(callback(1, 'm:vip'));
    expect(lastEdit(w)).toContain('tez orada');
    const kb = (w.tg.calls.filter((c) => c.method === 'editMessageText').at(-1)!.params['reply_markup'] as { inline_keyboard: { callback_data?: string }[][] })
      .inline_keyboard.flat()
      .map((b) => b.callback_data);
    expect(kb.some((d) => d?.startsWith('e:star'))).toBe(false);
  });
});

describe('Murojaatlar: /support, /paysupport, /reply', () => {
  it('murojaat adminlarga yetadi, admin javobi foydalanuvchiga boradi, kunlik limit', async () => {
    const w = new World({ starsMode: 'all' });
    await w.send(privateText(1, '/start'));
    await w.send(privateText(5, '/start'));
    await w.send(privateText(5, '/paysupport'));
    expect(w.tg.texts(5).at(-1)).toContain('/paysupport matn');
    await w.send(privateText(5, '/paysupport Stars yechildi,\nVIP kelmadi'));
    const adminMsg = w.tg.texts(1).at(-1)!;
    expect(adminMsg).toContain('Murojaat #1');
    expect(adminMsg).toContain('VIP kelmadi');
    await w.send(privateText(1, '/reply 1 Tekshirdik, VIP berildi'));
    expect(w.tg.texts(5).at(-1)).toContain('Tekshirdik, VIP berildi');
    await w.send(privateText(5, '/reply 1 men admin emasman'));
    expect(w.tg.texts(5).at(-1)).toContain('Ruxsat yo‘q');
    for (let i = 0; i < 5; i++) await w.send(privateText(5, `/support savol ${i}`));
    expect(w.tg.texts(5).at(-1)).toContain('juda ko‘p');
  });
});

describe('Menyu bo‘limlari', () => {
  it('barcha bo‘limlar xatosiz ochiladi', async () => {
    const w = new World();
    await w.send(privateText(9, '/start'));
    for (const [section, expected] of [
      ['shop', 'DO‘KONI'],
      ['inventory', 'INVENTARINGIZ'],
      ['vip', 'VIP OBUNA'],
      ['daily', 'KUNLIK MUKOFOT'],
      ['invite', 'TAKLIF QILISH'],
      ['profile', 'Tangalar'],
    ] as const) {
      await w.send(callback(9, `m:${section}`));
      expect(lastEdit(w)).toContain(expected);
    }
    for (const cmd of ['/shop', '/daily', '/vip', '/invite', '/inventory', '/profile']) {
      const before = w.tg.sent(9).length;
      await w.send(privateText(9, cmd));
      expect(w.tg.sent(9).length).toBe(before + 1);
    }
    expect(w.registryCore.recentErrors().count24h).toBe(0);
  });
});

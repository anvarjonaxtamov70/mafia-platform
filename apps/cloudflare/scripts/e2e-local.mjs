#!/usr/bin/env node
/**
 * Lokal E2E: haqiqiy Cloudflare runtime (workerd, `wrangler dev`) + soxta Telegram API.
 * Durable Objects, SQLite, alarm va webhook xavfsizligini to'liq o'yin orqali tekshiradi.
 *
 *   node scripts/e2e-local.mjs
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = '123456789:E2E_TEST_TOKEN_abcdefghijklmnopqrstu';
const TG_PORT = 18081;
const WORKER_PORT = 18787;
const GROUP = -1001112223334;
const secret = createHash('sha256').update(`mafia-webhook|${TOKEN}`).digest('hex');

// ───── Soxta Telegram API ─────
const calls = [];
let nextId = 1;
const tg = createServer((req, res) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', async () => {
    try {
    const method = req.url.split('/').pop();
    const raw = Buffer.concat(parts);
    const multipart = String(req.headers['content-type']).includes('multipart/form-data');
    let params;
    if (multipart) {
      const form = await new Response(raw, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      const media = form.get(method === 'sendAnimation' ? 'animation' : 'photo');
      const bytes = media instanceof Blob ? Buffer.from(await media.arrayBuffer()) : Buffer.alloc(0);
      params = { chat_id: Number(form.get('chat_id')), png: bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), gif: bytes.subarray(0, 6).equals(Buffer.from('GIF89a')) };
    } else {
      params = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    }
    calls.push({ method, params });
    let result = true;
    if (method === 'sendMessage' || method === 'sendInvoice' || method === 'sendPhoto' || method === 'sendAnimation') result = { message_id: nextId++ };
    if (method === 'getMe') result = { id: 1, is_bot: true, first_name: 'Mafia', username: 'e2e_mafia_bot' };
    if (method === 'getChatMember') result = { status: params.user_id === 1 ? 'creator' : params.user_id === 8 ? 'administrator' : 'member' };
    if (method === 'getWebhookInfo') result = { url: 'x', pending_update_count: 0 };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      console.error('Fake Telegram request parse failed:', e.name);
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error_code: 400, description: 'test request parse failure' }));
    }
  });
});
await new Promise((r) => tg.listen(TG_PORT, '127.0.0.1', r));

// ───── Worker (workerd) ─────
const persist = mkdtempSync(join(tmpdir(), 'mafia-e2e-'));
const wrangler = spawn(
  'npx',
  [
    'wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--show-interactive-dev-session=false',
    '--var', `BOT_TOKEN:${TOKEN}`, '--var', `TELEGRAM_API:http://127.0.0.1:${TG_PORT}`, '--var', 'TEST_HOOKS:true', '--var', 'ADMIN_IDS:1,6', '--var', 'STARS_MODE:all',
  ],
  { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
wrangler.stdout.on('data', (d) => (log += d));
wrangler.stderr.on('data', (d) => (log += d));

const base = `http://127.0.0.1:${WORKER_PORT}`;
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failures++;
};

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      // hali ishga tushmagan
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`worker did not start:\n${log}`);
}

let uid = 1;
const user = (id) => ({ id, is_bot: false, first_name: `U${id}` });
const send = (update, headers = { 'x-telegram-bot-api-secret-token': secret }) =>
  fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ update_id: uid++, ...update }) });
const pm = (from, text) => send({ message: { message_id: uid, chat: { id: from, type: 'private' }, from: user(from), text } });
const gm = (from, text) => send({ message: { message_id: uid, chat: { id: GROUP, type: 'supergroup', title: 'E2E' }, from: user(from), text } });
const cb = (from, data, group = false) =>
  send({ callback_query: { id: String(uid), from: user(from), data, message: { message_id: 1, chat: group ? { id: GROUP, type: 'supergroup' } : { id: from, type: 'private' } } } });
const setupSecret = createHash('sha256').update(`mafia-setup|${TOKEN}`).digest('hex');
const force = () => fetch(`${base}/__test/force?chat=${GROUP}`, { method: 'POST', headers: { 'x-setup-key': setupSecret } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const texts = (chat) => calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === chat).map((c) => c.params.text);
const edits = (chat) => calls.filter((c) => c.method === 'editMessageText' && c.params.chat_id === chat).map((c) => c.params.text);
const buttons = (chat) =>
  calls
    .filter((c) => c.method === 'sendMessage' && c.params.chat_id === chat)
    .flatMap((c) => (c.params.reply_markup?.inline_keyboard ?? []).flat())
    .map((b) => b.callback_data)
    .filter(Boolean);
/** Faqat eng so'nggi bosqich tugmalari (eski tugmalar rate limitni band qilmasin) */
const seqOf = (d) => Number(d.split(':')[2]);
const latest = (list) => {
  const max = Math.max(-1, ...list.map(seqOf));
  return list.filter((d) => seqOf(d) === max);
};

try {
  await waitReady();
  check((await (await fetch(`${base}/health`)).json()).status === 'ok', '/health');
  check((await send({}, { 'x-telegram-bot-api-secret-token': 'wrong' })).status === 403, 'noto‘g‘ri secret token rad etiladi');

  check((await fetch(`${base}/telegram/diag`, { method: 'POST' })).status === 403, 'diag requires secret');
  check((await fetch(`${base}/telegram/setup`, { method: 'POST' })).status === 403, 'setup requires secret');
  check((await fetch(`${base}/__test/force?chat=${GROUP}`, { method: 'POST' })).status === 403, 'test hook requires secret');
  const authHeaders = { 'x-telegram-bot-api-secret-token': secret, 'content-type': 'application/json' };
  const raw = (body) => fetch(`${base}/telegram/webhook`, { method: 'POST', headers: authHeaders, body });
  check((await raw('null')).status === 400, 'invalid update rejected');
  check((await raw(JSON.stringify({ update_id: 10, message: { chat: null } }))).status === 400, 'malformed message rejected');
  check((await raw(JSON.stringify({ update_id: 11, pad: 'x'.repeat(300_000) }))).status === 413, 'oversized update rejected');

  // Diagnose the common outbound transport before cascading into unrelated scenarios.
  const probe = await fetch(`${base}/telegram/diag`, { method: 'POST', headers: { 'x-setup-key': setupSecret } });
  const probeData = await probe.json();
  if (!calls.some((c) => c.method === 'getWebhookInfo')) throw new Error('outbound Telegram probe failed: ' + JSON.stringify({ registry: probeData.registry?.ok, room: probeData.room?.ok, webhook: probeData.webhook }));
  const players = [1, 2, 3, 4, 5];
  for (const p of players) await pm(p, '/start');
  if (!texts(1).some((t) => t.includes('MAFIA GAME'))) throw new Error('start menu missing: methods=' + calls.map((c) => c.method).join(','));
  check(texts(1).some((t) => t.includes('MAFIA GAME')), '/start bosh menyu');
  const replay = { update_id: 900001, message: { message_id: 900001, chat: { id: 5, type: 'private' }, from: user(5), text: '/profile' } };
  const beforeReplay = texts(5).length;
  await send(replay);
  await send(replay);
  check(texts(5).length === beforeReplay + 1, 'identical update ID processed once');

  await cb(4, 'm:art_don');
  check(calls.some((c) => c.method === 'sendPhoto' && c.params.chat_id === 4 && c.params.png), 'role card is valid multipart PNG');
  await pm(5, '/intro');
  check(calls.some((c) => c.method === 'sendAnimation' && c.params.chat_id === 5 && c.params.gif), 'intro is valid multipart GIF');
  await pm(7, '/hero');
  check(texts(7).some(t=>t.includes('100 💎')), 'one locked hero costs 100 diamonds');
  await pm(6, '/hero');
  check(texts(6).some(t=>t.includes('Daraja:')), 'owner has single hero');
  await pm(6, '/admin_hero_level 1000');
  await pm(6, '/hero');
  check(texts(6).some(t=>t.includes('Daraja: 1000')), 'owner display level');
  await pm(7, '/herotop');
  check(texts(7).some(t=>t.includes('Geroylar TOP 10')), 'hero top');
  await gm(7, '/game');
  await sleep(1200);
  check(texts(GROUP).some(t=>t.includes('YANGI MAFIA')), 'ordinary member can create game');
  await gm(7,'/cancelgame');
  check(texts(GROUP).some(t=>t.includes('faqat guruh administratori')), 'ordinary member cannot cancel game');
  await pm(8,'/start');
  await gm(8,'/cancelgame');
  await sleep(1000);
  await gm(8,'/game');
  await sleep(1200);
  const regularAdminLobby = calls.filter(c=>c.method==='sendMessage'&&c.params.chat_id===GROUP&&c.params.text.includes('YANGI MAFIA')).at(-1);
  check(!!regularAdminLobby,'non-owner Telegram administrator creates lobby');
  const lobbyKeys = (regularAdminLobby?.params.reply_markup.inline_keyboard??[]).flat().map(b=>b.callback_data??'');
  check(lobbyKeys.length===1&&lobbyKeys[0].startsWith('l:j:'), 'lobby has exactly one join button');
  await gm(8,'/cancelgame');
  await sleep(1000);
  await gm(1, '/game');
  await sleep(1500);
  const lobbyMsg = calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === GROUP && c.params.text.includes('YANGI MAFIA')).at(-1);
  check(!!lobbyMsg, 'lobby xabari guruhga yuborildi (alarm orqali)');
  const joinBtn = lobbyMsg?.params.reply_markup.inline_keyboard[0][0].callback_data;
  check(calls.some(c=>c.method==='pinChatMessage'&&c.params.chat_id===GROUP), 'registration pinned');
  await gm(2,'/game');
  await sleep(2500);
  const refreshed=calls.filter(c=>c.method==='sendMessage'&&c.params.chat_id===GROUP&&c.params.text.includes('YANGI MAFIA')).at(-1);
  check(refreshed!==lobbyMsg&&refreshed?.params.reply_markup.inline_keyboard[0][0].callback_data===joinBtn,'same active registration reposted');
  for (const p of players.slice(1)) await cb(p, joinBtn, true);
  await gm(1, '/gstart');
  await sleep(2000);
  check(calls.some(c=>c.method==='unpinChatMessage'&&c.params.chat_id===GROUP),'registration unpinned');
  for (const p of players) check(texts(p).some((t) => t.includes('SIZNING ROLINGIZ')), `o‘yinchi ${p} ga rol yuborildi`);
  check(!texts(GROUP).some((t) => t.includes('SIZNING ROLINGIZ')), 'guruhga rol oshkor qilinmadi');
  check(texts(GROUP).some((t) => t.includes('TUN BOSHLANDI')), 'tun boshlandi');
  check(calls.some(c=>c.method==='sendMessage'&&c.params.chat_id===GROUP&&c.params.text.includes('TUN BOSHLANDI')&&c.params.reply_markup?.inline_keyboard.flat().some(b=>b.url==='https://t.me/e2e_mafia_bot')), 'game phase message opens bot');
  check(calls.some((c) => c.method === 'sendPhoto' && c.params.chat_id === GROUP && c.params.png), 'public game start card');

  // O'yin: hamma tunda o'tkazadi, bosqichlar test hook bilan tezlashtiriladi
  for (let round = 0; round < 80; round++) {
    if (texts(GROUP).some((t) => t.includes('O‘YIN TUGADI'))) break;
    for (const p of players) {
      for (const data of latest(buttons(p).filter((d) => d.endsWith(':SKIP') || /^mv:\d+:\d+:0$/.test(d)))) await cb(p, data);
    }
    const votes = latest(buttons(GROUP).filter((d) => /^v:\d+:\d+:\d+$/.test(d) && !d.endsWith(':0')));
    if (votes.length > 0) {
      // Hamma bitta nomzodga (o'zi bo'lsa, keyingisiga) ovoz beradi
      for (const p of players) await cb(p, votes[0], true);
      for (const p of players) await cb(p, votes[1] ?? votes[0], true);
    }
    await force();
    await sleep(500);
  }
  check(texts(GROUP).some((t) => t.includes('O‘YIN TUGADI')), 'o‘yin oxirigacha yetdi (alarm + Durable Object)');
  await sleep(1500);
  check(players.some((p) => texts(p).some((t) => t.includes('O‘yin tugadi'))), 'natija DM va profil (Registry SQLite)');

  await pm(2, '/profile');
  await sleep(300);
  check(texts(2).some((t) => t.includes('Barcha o‘yinlar: 1')), 'profil statistikasi saqlandi');

  await gm(1, '/top');
  check(texts(GROUP).some((t) => t.includes('Guruh TOP 20') && t.includes('ball')), 'group points TOP uses persisted results');
  await gm(1, '/fulltop7');
  check(texts(GROUP).some((t) => t.includes('Umumiy TOP 20') && t.includes('7 kun')), 'owner global 7-day TOP');
  // ───── Iqtisodiyot (Durable Object SQLite transactionSync bilan) ─────
  check(texts(2).some((t) => t.includes('💵 +')), 'o‘yin tugaganda Coins berildi');
  await cb(2, 'e:daily:');
  await sleep(200);
  const dailyAnswer = calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.params.text ?? '';
  check(dailyAnswer.includes('+50'), `kunlik mukofot (${dailyAnswer})`);
  await cb(2, 'e:daily:');
  await sleep(200);
  check((calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.params.text ?? '').includes('allaqachon'), 'kunlik mukofot ikkinchi marta berilmaydi');

  // Owner access and real checkout are independent scenarios.
  await sleep(3100);
  await pm(6, '/start');
  await pm(6, '/profile');
  check(texts(6).some((t) => t.includes('doimiy') && t.includes('1000000000')), 'second owner permanent VIP and allowance');
  await cb(1, 'm:vip');
  check((edits(1).at(-1) ?? '').includes('doimiy'), 'first owner permanent VIP');
  const beforeOwnerInvoice = calls.filter((c) => c.method === 'sendInvoice').length;
  await cb(1, 'e:star:VIP_30');
  check(calls.filter((c) => c.method === 'sendInvoice').length === beforeOwnerInvoice, 'owner not charged for VIP');
  await cb(6, 'e:buyok:SHIELD');
  check((calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.params.text ?? '').includes('1000000000'), 'owner purchase allowance does not decrease');
  await cb(2, 'e:star:VIP_30');
  const inv = calls.filter((c) => c.method === 'sendInvoice').at(-1);
  check(inv && inv.params.chat_id === 2 && inv.params.currency === 'XTR' && inv.params.prices[0].amount === 99, 'normal user VIP invoice (XTR, 99 Stars)');
  if (!inv?.params.payload) throw new Error('missing invoice payload');
  const payload = inv.params.payload;
  await send({ pre_checkout_query: { id: 'pc-wrong-user', from: user(3), currency: 'XTR', total_amount: 99, invoice_payload: payload } });
  check(calls.filter((c) => c.method === 'answerPreCheckoutQuery').at(-1)?.params.ok === false, 'other user cannot pay this order');
  await send({ pre_checkout_query: { id: 'pc1', from: user(2), currency: 'XTR', total_amount: 99, invoice_payload: payload } });
  check(calls.filter((c) => c.method === 'answerPreCheckoutQuery').at(-1)?.params.ok === true, 'pre_checkout approved');
  const pay = { message: { message_id: uid, chat: { id: 2, type: 'private' }, from: user(2), successful_payment: { currency: 'XTR', total_amount: 99, invoice_payload: payload, telegram_payment_charge_id: 'e2e-charge-1' } } };
  await send(pay);
  await send(pay);
  check(texts(2).filter((t) => t.includes('To‘lov qabul qilindi')).length === 1, 'payment delivered once');
  await sleep(3100);
  await cb(2, 'm:vip');
  check((edits(2).at(-1) ?? '').includes('gacha'), 'normal user paid VIP expiry');
  await pm(2, '/refund e2e-charge-1');
  check(!calls.some((c) => c.method === 'refundStarPayment'), 'normal user cannot refund');
  await pm(1, '/refund e2e-charge-1');
  check(calls.some((c) => c.method === 'refundStarPayment' && c.params.telegram_payment_charge_id === 'e2e-charge-1' && c.params.user_id === 2), 'owner refund targets actual payer');

  const setup = await fetch(`${base}/telegram/setup`, { method: 'POST', headers: { 'x-setup-key': createHash('sha256').update(`mafia-setup|${TOKEN}`).digest('hex') } });
  check(setup.status === 200, '/telegram/setup ishlaydi');
  check(calls.some((c) => c.method === 'setWebhook' && c.params.secret_token === secret), 'webhook secret_token bilan o‘rnatildi');
  check(calls.some((c) => c.method === 'setWebhook' && c.params.allowed_updates.includes('pre_checkout_query')), 'webhook pre_checkout_query ni qabul qiladi');
  const diag = await fetch(`${base}/telegram/diag`, { method: 'POST', headers: { 'x-setup-key': createHash('sha256').update(`mafia-setup|${TOKEN}`).digest('hex') } });
  const diagBody = await diag.json();
  check(typeof diagBody.security?.uncertain === 'number', 'security diagnostics exposed only through authenticated diag');
  check(diagBody.registry?.ok && diagBody.room?.ok && diagBody.registry.finished >= 1, `/telegram/diag: registry va GameRoom ishlaydi (${JSON.stringify(diagBody.registry)})`);
} catch (e) {
  failures++;
  console.error('E2E error:', e.message);
  console.error(log.slice(-12000));
} finally {
  wrangler.kill('SIGTERM');
  tg.close();
  rmSync(persist, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nE2E: hammasi o‘tdi' : `\nE2E: ${failures} ta xato`);
if (failures > 0 && process.env.E2E_DEBUG) console.log(log.slice(-5000));
process.exit(failures === 0 ? 0 : 1);

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
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    const params = body ? JSON.parse(body) : {};
    calls.push({ method, params });
    let result = true;
    if (method === 'sendMessage') result = { message_id: nextId++ };
    if (method === 'getMe') result = { id: 1, is_bot: true, first_name: 'Mafia', username: 'e2e_mafia_bot' };
    if (method === 'getChatMember') result = { status: params.user_id === 1 ? 'creator' : 'member' };
    if (method === 'getWebhookInfo') result = { url: 'x', pending_update_count: 0 };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result }));
  });
});
await new Promise((r) => tg.listen(TG_PORT, '127.0.0.1', r));

// ───── Worker (workerd) ─────
const persist = mkdtempSync(join(tmpdir(), 'mafia-e2e-'));
const wrangler = spawn(
  'npx',
  [
    'wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--show-interactive-dev-session=false',
    '--var', `BOT_TOKEN:${TOKEN}`, '--var', `TELEGRAM_API:http://127.0.0.1:${TG_PORT}`, '--var', 'TEST_HOOKS:true', '--var', 'ADMIN_IDS:1',
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
const force = () => fetch(`${base}/__test/force?chat=${GROUP}`, { method: 'POST' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const texts = (chat) => calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === chat).map((c) => c.params.text);
const buttons = (chat) =>
  calls
    .filter((c) => c.method === 'sendMessage' && c.params.chat_id === chat)
    .flatMap((c) => (c.params.reply_markup?.inline_keyboard ?? []).flat())
    .map((b) => b.callback_data)
    .filter(Boolean);

try {
  await waitReady();
  check((await (await fetch(`${base}/health`)).json()).status === 'ok', '/health');
  check((await send({}, { 'x-telegram-bot-api-secret-token': 'wrong' })).status === 403, 'noto‘g‘ri secret token rad etiladi');

  const players = [1, 2, 3, 4, 5];
  for (const p of players) await pm(p, '/start');
  check(texts(1).some((t) => t.includes('MAFIA GAME')), '/start bosh menyu');

  await gm(1, '/game');
  await sleep(1500);
  const lobbyMsg = calls.find((c) => c.method === 'sendMessage' && c.params.chat_id === GROUP && c.params.text.includes('YANGI MAFIA'));
  check(!!lobbyMsg, 'lobby xabari guruhga yuborildi (alarm orqali)');
  const joinBtn = lobbyMsg?.params.reply_markup.inline_keyboard[0][0].callback_data;
  for (const p of players.slice(1)) await cb(p, joinBtn, true);
  await gm(1, '/gstart');
  await sleep(2000);
  for (const p of players) check(texts(p).some((t) => t.includes('SIZNING ROLINGIZ')), `o‘yinchi ${p} ga rol yuborildi`);
  check(!texts(GROUP).some((t) => t.includes('SIZNING ROLINGIZ')), 'guruhga rol oshkor qilinmadi');
  check(texts(GROUP).some((t) => t.includes('TUN BOSHLANDI')), 'tun boshlandi');

  // O'yin: hamma tunda o'tkazadi, bosqichlar test hook bilan tezlashtiriladi
  for (let round = 0; round < 40; round++) {
    if (texts(GROUP).some((t) => t.includes('O‘YIN TUGADI'))) break;
    for (const p of players) {
      for (const data of buttons(p).filter((d) => d.endsWith(':SKIP') || /^mv:\d+:\d+:0$/.test(d))) await cb(p, data);
    }
    const vote = [...buttons(GROUP)].reverse().find((d) => /^v:\d+:\d+:\d+$/.test(d) && !d.endsWith(':0'));
    if (vote) for (const p of players) await cb(p, vote, true);
    await force();
    await sleep(700);
  }
  check(texts(GROUP).some((t) => t.includes('O‘YIN TUGADI')), 'o‘yin oxirigacha yetdi (alarm + Durable Object)');
  await sleep(1500);
  check(players.some((p) => texts(p).some((t) => t.includes('O‘yin tugadi'))), 'natija DM va profil (Registry SQLite)');

  await pm(2, '/profile');
  await sleep(300);
  check(texts(2).some((t) => t.includes('O‘yinlar: 1')), 'profil statistikasi saqlandi');

  const setup = await fetch(`${base}/telegram/setup`, { method: 'POST', headers: { 'x-setup-key': createHash('sha256').update(`mafia-setup|${TOKEN}`).digest('hex') } });
  check(setup.status === 200, '/telegram/setup ishlaydi');
  check(calls.some((c) => c.method === 'setWebhook' && c.params.secret_token === secret), 'webhook secret_token bilan o‘rnatildi');
} catch (e) {
  failures++;
  console.error('E2E error:', e.message);
  console.error(log.slice(-3000));
} finally {
  wrangler.kill('SIGTERM');
  tg.close();
  rmSync(persist, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nE2E: hammasi o‘tdi' : `\nE2E: ${failures} ta xato`);
if (failures > 0 && process.env.E2E_DEBUG) console.log(log.slice(-5000));
process.exit(failures === 0 ? 0 : 1);

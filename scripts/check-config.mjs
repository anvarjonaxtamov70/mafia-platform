#!/usr/bin/env node
/**
 * Deploy oldidan: GitHub Secrets/Variables to'g'ri kiritilganini tekshiradi va
 * nima yetishmayotganini tushunarli qilib ko'rsatadi (GitHub Actions jurnalida).
 */
import { appendFileSync } from 'node:fs';

const e = process.env;
const rows = [];
let bad = 0;

function check(name, kind, ok, hint, optional = false) {
  const value = (e[name] ?? '').trim();
  let mark = '✅';
  let note = '';
  if (!value && optional) {
    mark = '➖';
    note = 'ixtiyoriy, berilmagan';
  } else if (!value) {
    mark = '❌';
    note = `YO'Q — ${hint}`;
    bad++;
  } else if (!ok(value)) {
    mark = '❌';
    note = `noto'g'ri — ${hint}`;
    bad++;
  }
  rows.push(`${mark} ${kind.padEnd(8)} ${name.padEnd(22)} ${note}`);
}

check('CLOUDFLARE_API_TOKEN', 'secret', (v) => v.length >= 30, 'Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers"');
check('BOT_TOKEN', 'secret', (v) => /^\d{5,}:[\w-]{30,}$/.test(v), '@BotFather bergan token (123456789:AA...)');
check('ADMIN_IDS', 'variable', (v) => /^\d{3,20}(\s*,\s*\d{3,20})*$/.test(v), "bot egalarining Telegram ID lari, vergul bilan (berilmasa wrangler.toml dagi standart)", true);
check('CLOUDFLARE_ACCOUNT_ID', 'secret', (v) => /^[a-f0-9]{32}$/.test(v), 'Cloudflare → Workers & Pages → o\'ng tomonda "Account ID"', true);
check('DEV_FAKE_PLAYERS', 'variable', (v) => v === 'true' || v === 'false', 'true yoki false (berilmasa wrangler.toml dagi standart)', true);

console.log('Sozlamalar (GitHub → Settings → Secrets and variables → Actions):\n');
console.log(rows.join('\n'));

const ready = (v) => {
  if (e.GITHUB_OUTPUT) appendFileSync(e.GITHUB_OUTPUT, `ready=${v}\n`);
};

if (!(e.CLOUDFLARE_API_TOKEN ?? '').trim() && !(e.BOT_TOKEN ?? '').trim()) {
  console.log("\n::notice::Sozlamalar hali kiritilmagan — deploy o'tkazib yuborildi. docs/04-CLOUDFLARE.md dagi qadamlarni bajaring.");
  ready(false);
  process.exit(0);
}
if (bad > 0) {
  console.log(`\n::error::${bad} ta sozlama noto'g'ri yoki yo'q. Yuqoridagi ❌ qatorlarni tuzating va Deploy ni qayta ishga tushiring.`);
  ready(false);
  process.exit(1);
}
console.log('\nHammasi joyida.');
ready(true);

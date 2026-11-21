/**
 * Bepul tarif: Worker / Durable Object chaqiruvi uchun 10 ms CPU. Eng og'ir amallar (30 kishilik o'yin
 * boshlanishi, tun hisoblanishi, alarm partiyasi) shu chegaradan ancha past bo'lishi kerak.
 */
import { describe, expect, it } from 'vitest';
import { callback, GROUP, groupText, privateText, World } from './harness';

function cpuMs(fn: () => Promise<void>): Promise<number> {
  const start = process.cpuUsage();
  return fn().then(() => {
    const d = process.cpuUsage(start);
    return (d.user + d.system) / 1000;
  });
}

describe('CPU byudjeti (bepul tarif: 10 ms)', () => {
  it('30 kishilik o‘yin: start, tun hisoblash va alarm partiyalari', async () => {
    const w = new World();
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    for (const id of ids) await w.send(privateText(id, '/start'));
    w.tg.admins.add(1);
    await w.send(groupText(1, '/game'));
    const core = await w.loaded(GROUP);
    core.data.game!.config.maxPlayers = 30;
    for (const id of ids.slice(1)) await w.send(callback(id, `l:j:${core.data.game!.number}`, GROUP));

    // JIT ni isitish (Cloudflare isolate ham qayta ishlatiladi)
    for (let i = 0; i < 3; i++) {
      const warm = new World();
      for (const id of ids) await warm.send(privateText(id, '/start'));
      warm.tg.admins.add(1);
      await warm.send(groupText(1, '/game'));
      const c = await warm.loaded(GROUP);
      c.data.game!.config.maxPlayers = 30;
      for (const id of ids.slice(1)) await warm.send(callback(id, `l:j:${c.data.game!.number}`, GROUP));
      await warm.router.handle({ update_id: 1, ...groupText(1, '/gstart') });
      await warm.advance(200_000);
    }

    const startMs = await cpuMs(() => core.start({ by: 1, isAdmin: true }).then(() => undefined));
    const store = w.stores.get(GROUP)!;
    let maxAlarm = 0;
    for (let i = 0; i < 10 && store.alarm !== null && store.alarm <= w.now; i++) {
      store.alarm = null;
      maxAlarm = Math.max(maxAlarm, await cpuMs(() => core.alarm()));
    }
    // Tunni yakunlash (30 o'yinchi uchun NightResolver + presenter)
    w.now = (core.data.game!.state!.phaseEndsAt ?? w.now) + 1000;
    store.alarm = null;
    const nightMs = await cpuMs(() => core.alarm());
    console.log(`CPU: start=${startMs.toFixed(2)}ms alarm(max)=${maxAlarm.toFixed(2)}ms night=${nightMs.toFixed(2)}ms`);
    // Node da o'lchov; workerd taxminan shunga yaqin. Zaxira bilan 10 ms dan past bo'lishi kerak
    expect(startMs).toBeLessThan(10);
    expect(nightMs).toBeLessThan(10);
  }, 60_000);
});

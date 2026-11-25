import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { ROLE_CODES } from '@mafia/game-engine';
import { learningView } from '@mafia/bot-core';
import { sendVisual, visualBlob } from '../visuals';
import { TelegramClient, TgError } from '../telegram';
import { World, callback, privateText, GROUP, groupText, lobby } from './harness';

describe('Visual v5', () => {
  it('all 30 roles have distinct valid PNG headers and private catalog buttons', async () => {
    const hashes = new Set<string>();
    for (const role of ROLE_CODES) {
      const blob = visualBlob('role_' + role.toLowerCase())!;
      expect(blob.type).toBe('image/png');
      const data = new Uint8Array(await blob.arrayBuffer());
      expect([...data.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
      const png = Buffer.from(data);
      expect(png.readUInt32BE(16)).toBe(512);
      expect(png.readUInt32BE(20)).toBe(320);
      const compressed: Buffer[] = [];
      for (let at = 8; at + 12 <= png.length;) {
        const length = png.readUInt32BE(at);
        if (png.toString('ascii', at + 4, at + 8) === 'IDAT') compressed.push(png.subarray(at + 8, at + 8 + length));
        at += length + 12;
      }
      expect(inflateSync(Buffer.concat(compressed)).length).toBe((512 * 3 + 1) * 320);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      hashes.add(Buffer.from(digest).toString('hex'));
      expect(learningView('role_' + role.toLowerCase(), true)?.keyboard.flat().some((b) => 'callback_data' in b && b.callback_data === 'm:art_' + role.toLowerCase())).toBe(true);
    }
    expect(hashes.size).toBe(30);
    expect(visualBlob('__proto__')).toBeNull();
    expect(visualBlob('unknown')).toBeNull();
    const gif = new Uint8Array(await visualBlob('intro')!.arrayBuffer());
    expect(Buffer.from(gif.slice(0,6)).toString()).toBe('GIF89a');
    expect(gif.at(-1)).toBe(0x3b);
    // Parse frames and verify the actual pixel-code count, not only the file header.
    const raw = Buffer.from(gif);
    const width = raw.readUInt16LE(6), height = raw.readUInt16LE(8);
    expect([width, height]).toEqual([256, 144]);
    let offset = 13 + 3 * (2 ** ((raw[10]! & 7) + 1));
    let frames = 0;
    while (raw[offset] !== 0x3b && offset < raw.length) {
      const tag = raw[offset++]!;
      if (tag === 0x21) {
        offset++;
        while (raw[offset]) offset += 1 + raw[offset]!;
        offset++;
        continue;
      }
      expect(tag).toBe(0x2c);
      const flags = raw[offset + 8]!;
      offset += 9;
      if (flags & 0x80) offset += 3 * (2 ** ((flags & 7) + 1));
      expect(raw[offset++]).toBe(4);
      const blocks: Buffer[] = [];
      while (raw[offset]) {
        const n = raw[offset++]!;
        blocks.push(raw.subarray(offset, offset + n));
        offset += n;
      }
      offset++;
      const codes = Buffer.concat(blocks);
      let pixels = 0, ended = false;
      for (let bit = 0; bit + 5 <= codes.length * 8; bit += 5) {
        const at = bit >> 3;
        const code = (((codes[at] ?? 0) | ((codes[at + 1] ?? 0) << 8)) >> (bit & 7)) & 31;
        if (code === 17) { ended = true; break; }
        if (code === 16) continue;
        expect(code).toBeLessThan(16);
        pixels++;
      }
      expect(ended).toBe(true);
      expect(pixels).toBe(width * height);
      frames++;
    }
    expect(frames).toBe(8);
  });
  it('uses actual multipart uploads without adding JSON content type', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return Response.json({ ok: true, result: { message_id: 1 } });
    };
    const tg = new TelegramClient('test', 'https://example.invalid', fake);
    expect(await sendVisual(tg, 1, 'role_don')).toBe(true);
    expect(await sendVisual(tg, 1, 'intro')).toBe(true);
    expect(calls[0]!.url.endsWith('/sendPhoto')).toBe(true);
    const form = calls[0]!.init.body as FormData;
    expect(form.get('chat_id')).toBe('1');
    expect((form.get('photo') as Blob).type).toBe('image/png');
    expect(calls[0]!.init.headers).toBeUndefined();
    expect((calls[1]!.init.body as FormData).get('animation')).toBeInstanceOf(Blob);
  });
  it('private gallery is rate limited, cannot be invoked from a group, failure is nonfatal', async () => {
    const w = new World({ visuals: true });
    await w.send(privateText(1, '/start'));
    await w.send(callback(1, 'm:art_don', GROUP));
    expect(w.tg.calls.filter((c) => c.method === 'sendPhoto')).toHaveLength(0);
    await w.send(callback(1, 'm:art_don'));
    await w.send(callback(1, 'm:art_doctor'));
    expect(w.tg.calls.filter((c) => c.method === 'sendPhoto')).toHaveLength(1);
    w.now += 6000;
    w.tg.failNext = new TgError(500, 'temporary');
    await w.send(privateText(1, '/intro'));
    expect(w.tg.texts(1).some((v) => v.includes('vaqtincha yuklanmadi'))).toBe(true);
    const n = await lobby(w, [1,2,3,4]);
    await w.send(groupText(1, '/gstart'));
    const core = await w.loaded(GROUP);
    expect(core.data.game?.number).toBe(n);
    expect(w.tg.texts(1).some((v) => v.includes('SIZNING ROLINGIZ'))).toBe(true);
    expect(w.tg.calls.filter((c) => c.method === 'sendPhoto' && c.params['chat_id'] === GROUP)).toHaveLength(1);
    expect(w.tg.texts(GROUP).some((v) => v.includes('SIZNING ROLINGIZ'))).toBe(false);
  });
});

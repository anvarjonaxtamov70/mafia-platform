import { VISUAL_ASSETS } from './generated/visual-assets';
import type { Telegram } from './telegram';
import type { Keyboard } from '@mafia/bot-core';

const animations=new Set(['intro','v2_night','v2_dawn','v2_vote','v2_end']);
export function visualBlob(key: string): Blob | null {
  if (!Object.hasOwn(VISUAL_ASSETS, key)) return null;
  const raw = VISUAL_ASSETS[key];
  if (!raw) return null;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return new Blob([bytes.buffer], { type: animations.has(key) ? 'image/gif' : 'image/png' });
}

/** Decorative only: never retry or prevent text/game delivery on media failure. */
export async function sendVisual(tg: Telegram, chatId: number, key: string, caption?: string, keyboard?: Keyboard): Promise<boolean> {
  try {
    const file = visualBlob(key);
    if (!file) return false;
    const animation = animations.has(key);
    await tg.call(animation ? 'sendAnimation' : 'sendPhoto', {
      chat_id: chatId,
      [animation ? 'animation' : 'photo']: file,
      ...(caption ? { caption: caption.slice(0, 900) } : {}),
      disable_notification: true,
      ...(keyboard ? {reply_markup:{inline_keyboard:keyboard}} : {}),
    });
    return true;
  } catch {
    return false;
  }
}

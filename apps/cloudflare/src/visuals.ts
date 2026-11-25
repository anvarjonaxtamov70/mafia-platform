import { VISUAL_ASSETS } from './generated/visual-assets';
import type { Telegram } from './telegram';

export function visualBlob(key: string): Blob | null {
  if (!Object.hasOwn(VISUAL_ASSETS, key)) return null;
  const raw = VISUAL_ASSETS[key];
  if (!raw) return null;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return new Blob([bytes.buffer], { type: key === 'intro' ? 'image/gif' : 'image/png' });
}

/** Decorative only: never retry or prevent text/game delivery on media failure. */
export async function sendVisual(tg: Telegram, chatId: number, key: string, caption?: string): Promise<boolean> {
  const file = visualBlob(key);
  if (!file) return false;
  try {
    const animation = key === 'intro';
    await tg.call(animation ? 'sendAnimation' : 'sendPhoto', {
      chat_id: chatId,
      [animation ? 'animation' : 'photo']: file,
      ...(caption ? { caption: caption.slice(0, 900) } : {}),
      disable_notification: true,
    });
    return true;
  } catch {
    return false;
  }
}

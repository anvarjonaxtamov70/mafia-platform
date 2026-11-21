/**
 * Localization: barcha matnlar kalitlar orqali (§34). Asosiy til — o'zbekcha (lotin).
 * ru / en — keyingi bosqichda; yetishmagan kalitlar o'zbekchaga qaytadi.
 */
import en from './locales/en.json';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

export type Locale = 'uz' | 'ru' | 'en';
export type MessageKey = keyof typeof uz;

const dictionaries: Record<Locale, Record<string, string>> = { uz, ru, en };

export type Params = Record<string, string | number>;

export function t(key: MessageKey | string, params: Params = {}, locale: Locale = 'uz'): string {
  const template = dictionaries[locale][key] ?? dictionaries.uz[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

export function hasKey(key: string, locale: Locale = 'uz'): boolean {
  return key in dictionaries[locale];
}

/** HTML parse_mode uchun xavfsiz matn (foydalanuvchi ismlari). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function allKeys(locale: Locale = 'uz'): string[] {
  return Object.keys(dictionaries[locale]);
}

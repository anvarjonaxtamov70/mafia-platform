import pino, { type Logger } from 'pino';

/**
 * Structured log. Bot tokeni, maxfiy rollar va to'lov ma'lumotlari logga tushmasligi uchun redaksiya (§31.1, §36).
 */
export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: {
      paths: ['token', 'botToken', '*.token', '*.BOT_TOKEN', 'BOT_TOKEN', 'state', '*.state', 'role', '*.role', 'roles', 'payload.text'],
      censor: '[REDACTED]',
    },
    transport: pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
}

/** Telegram xato xabaridan tokenni olib tashlaydi (grammY ba'zan URL ni xatoga qo'shadi). */
export function scrubSecrets(message: string): string {
  return message.replace(/bot\d+:[A-Za-z0-9_-]{30,}/g, 'bot[REDACTED]').replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, '[REDACTED]');
}

export type { Logger };

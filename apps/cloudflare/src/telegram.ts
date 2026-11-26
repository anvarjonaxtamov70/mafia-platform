/**
 * Minimal Telegram Bot API klienti (fetch). Workers va Node (testlar) da bir xil ishlaydi.
 */
export class TgError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${code}: ${description}`);
    this.name = 'TgError';
  }
}

export interface Telegram {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export class TelegramClient implements Telegram {
  constructor(
    private readonly token: string,
    private readonly base = 'https://api.telegram.org',
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    // Keep JSON methods on the already-proven v4 transport. Only media uses multipart.
    let res: Response;
    try {
      const url = `${this.base}/bot${this.token}/${method}`;
      const multipart = (method === 'sendPhoto' || method === 'sendAnimation') && Object.values(params).some((v) => v instanceof Blob);
      // Wrangler's local HTTP proxy can redirect internally. Keep its original fetch behavior;
      // the real HTTPS provider never needs redirects and must not forward the bot token.
      const policy = this.base === 'https://api.telegram.org' ? { redirect: 'manual' as const } : {};
      if (multipart) {
        const form = new FormData();
        for (const [key, value] of Object.entries(params)) {
          if (value instanceof Blob) form.append(key, value, value.type === 'image/gif' ? 'hypernova.gif' : value.type === 'image/jpeg' ? 'hypernova.jpg' : 'hypernova.png');
          else if (value !== undefined && value !== null) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        res = await this.fetchFn(url, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(2_500),
          ...policy,
        });
      } else {
        res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(8_000),
          ...policy,
        });
      }
    } catch (e) {
      // Never include the URL or provider credentials.
      throw new TgError(0, `network error: ${(e as Error).name}`);
    }
    if (res.status >= 300 && res.status < 400) throw new TgError(res.status, 'unexpected redirect');
    let body: { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new TgError(res.status, 'invalid response');
    }
    if (!body.ok) throw new TgError(body.error_code ?? res.status, body.description ?? 'error', body.parameters?.retry_after);
    return body.result as T;
  }
}

export const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const webhookSecret = (token: string) => sha256Hex(`mafia-webhook|${token}`);
export const setupKey = (token: string) => sha256Hex(`mafia-setup|${token}`);

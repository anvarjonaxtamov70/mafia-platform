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
    const multipart = (method === 'sendPhoto' || method === 'sendAnimation') && Object.values(params).some((v) => v instanceof Blob);
    let bodyData: string | FormData = JSON.stringify(params);
    if (multipart) {
      const form = new FormData();
      for (const [key, value] of Object.entries(params)) {
        if (value instanceof Blob) form.append(key, value, value.type === 'image/gif' ? 'hypernova.gif' : 'hypernova.png');
        else if (value !== undefined && value !== null) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      bodyData = form;
    }
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/bot${this.token}/${method}`, {
        method: 'POST',
        ...(multipart ? {} : { headers: { 'content-type': 'application/json' } }),
        body: bodyData,
        signal: AbortSignal.timeout(multipart ? 2_500 : 8_000),
        redirect: 'error',
      });
    } catch (e) {
      // Tarmoq xatosi — token URL ichida, xabarga qo'shilmaydi
      throw new TgError(0, `network error: ${(e as Error).name}`);
    }
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

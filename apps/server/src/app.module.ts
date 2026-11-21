import { Controller, Get, HttpCode, Inject, Module, Post, Req, Res, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Runtime } from './runtime';

export const RUNTIME = Symbol('RUNTIME');

@Controller()
class HealthController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  @Get('health')
  async health() {
    return this.rt.health();
  }
}

@Controller('telegram')
class WebhookController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  /** Telegram webhook. Secret token grammY tomonidan X-Telegram-Bot-Api-Secret-Token sarlavhasida tekshiriladi. */
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Res() res: Response) {
    if (!this.rt.webhookHandler) {
      res.status(404).end();
      return;
    }
    await this.rt.webhookHandler(req, res);
  }
}

class ShutdownHook implements OnApplicationShutdown {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}
  async onApplicationShutdown() {
    await this.rt.stop();
  }
}

@Module({})
export class AppModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, WebhookController],
      providers: [{ provide: RUNTIME, useValue: runtime }, ShutdownHook],
    };
  }
}

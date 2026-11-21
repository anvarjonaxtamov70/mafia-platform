import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@mafia/config';
import { AppModule } from './app.module';
import { scrubSecrets } from './infra/logger';
import { Runtime } from './runtime';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const runtime = new Runtime(env);
  await runtime.start();
  const app = await NestFactory.create(AppModule.register(runtime), { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  await app.listen(env.HTTP_PORT);
  runtime.logger.info({ port: env.HTTP_PORT }, 'http listening');
}

bootstrap().catch((e) => {
  // Token xato xabariga tushib qolmasin
  console.error('fatal:', scrubSecrets(String(e instanceof Error ? (e.stack ?? e.message) : e)));
  process.exit(1);
});

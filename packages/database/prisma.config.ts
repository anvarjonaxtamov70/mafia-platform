import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Generatsiya uchun URL shart emas; migratsiyada .env dagi DATABASE_URL ishlatiladi
    url: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/mafia',
  },
});

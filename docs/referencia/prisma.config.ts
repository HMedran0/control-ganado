// Referencia para apps/api/prisma.config.ts (Prisma 7).
// Verificar contra la documentación oficial vigente al iniciar M0.3.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

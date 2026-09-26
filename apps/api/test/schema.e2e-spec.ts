import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { PrismaService } from '../src/infra/prisma.service.js';
import { createTestApp } from './helpers/app.js';

/**
 * La migración manual se aplicó de verdad (03-modelo-datos.md §5).
 *
 * Prisma no expresa índices parciales, índices GIN de trigramas ni restricciones CHECK, así que
 * van en una migración SQL escrita a mano. Esta prueba no da por hecho que corrió: le pregunta
 * al catálogo de PostgreSQL. Si alguien crea una migración nueva que las pierda, falla aquí.
 */
describe('Esquema de la base de datos', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tiene la extensión pg_trgm para la búsqueda difusa', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `;
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['animals_farm_code_active_uq', 'deleted_at IS NULL'],
    ['identifiers_farm_type_value_active_uq', 'retired_at IS NULL'],
    ['pregnancies_dam_pending_uq', "outcome = 'PENDING'"],
    ['sales_animal_active_uq', 'voided_at IS NULL'],
  ])('tiene el índice único parcial %s con su condición', async (name, condition) => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('UNIQUE');
    expect(rows[0]?.indexdef).toContain(condition);
  });

  it('tiene el índice parcial de animales activos', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'animals_farm_active_idx'
    `;
    expect(rows[0]?.indexdef).toContain('deleted_at IS NULL');
    expect(rows[0]?.indexdef).toContain('exit_type IS NULL');
  });

  it.each(['animals_code_trgm_idx', 'animals_name_trgm_idx', 'identifiers_value_trgm_idx'])(
    'tiene el índice de trigramas %s',
    async (name) => {
      const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toContain('gin');
      expect(rows[0]?.indexdef).toContain('gin_trgm_ops');
    },
  );

  it('tiene las 14 restricciones CHECK de la migración manual', async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace
      ORDER BY conname
    `;

    expect(rows.map((row) => row.conname)).toEqual([
      'allocation_amount_nonneg_ck',
      'animals_exit_consistency_ck',
      'animals_not_own_dam_ck',
      'animals_not_own_sire_ck',
      'breed_gestation_ck',
      'cycle_dates_ck',
      'expense_amount_positive_ck',
      'identifier_rfid_format_ck',
      'pregnancy_stillborn_ck',
      'sale_amount_positive_ck',
      'username_format_ck',
      'vaccine_age_window_ck',
      'vaccine_interval_ck',
      'weight_positive_ck',
    ]);
  });

  it('las restricciones CHECK rechazan datos inválidos de verdad', async () => {
    // Un nombre de usuario con mayúsculas viola username_format_ck (08 §2.4).
    await expect(
      prisma.$executeRaw`
        INSERT INTO users (id, name, username, password_hash, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Prueba', 'Mayusculas', 'hash', now(), now())
      `,
    ).rejects.toThrow();
  });

  it('las 26 tablas del modelo existen', async () => {
    const rows = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
    `;
    expect(Number(rows[0]?.total)).toBe(26);
  });
});

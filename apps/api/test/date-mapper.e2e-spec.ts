import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toIsoDate, type IsoDate } from '@hato/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { fromPrismaDate, toPrismaDate } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import { cleanDatabase, createAnimal, createFarm, type TestFarm } from './helpers/fixtures.js';

/**
 * Las fechas de negocio no se corren un día al pasar por PostgreSQL (ADR-002).
 *
 * Es el riesgo concreto que motivó el ADR: `node-postgres` y `Date` de JavaScript pueden
 * interpretar una columna `date` en la hora local, y en Bogotá (UTC−5) el 1 de marzo se leería
 * como 28 de febrero. La suite corre en las dos zonas (`pnpm test:tz`), así que si la
 * conversión dependiera de `TZ`, una de las dos ejecuciones fallaría.
 */
describe('Conversión de fechas de negocio contra PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;

  /** Fechas peligrosas: inicio de mes, fin de mes, 29 de febrero y fin de año. */
  const fechas: readonly IsoDate[] = [
    toIsoDate('2026-03-01'),
    toIsoDate('2026-01-01'),
    toIsoDate('2026-01-31'),
    toIsoDate('2024-02-29'),
    toIsoDate('2025-12-31'),
    toIsoDate('2026-06-15'),
  ];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'Finca de fechas');
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('la zona horaria del proceso de prueba está declarada', () => {
    // Deja constancia en el informe de en qué zona corrió esta ejecución.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBeTruthy();
  });

  it.each(fechas)('guarda y lee %s sin cambiar el día', async (fecha) => {
    const id = await createAnimal(prisma, farm, { code: `F-${fecha}`, birthDate: fecha });

    const row = await prisma.animal.findUniqueOrThrow({
      where: { id },
      select: { birthDate: true, entryDate: true },
    });

    expect(fromPrismaDate(row.birthDate)).toBe(fecha);
    expect(fromPrismaDate(row.entryDate)).toBe(fecha);
  });

  it('la ida y la vuelta son inversas exactas', () => {
    for (const fecha of fechas) {
      expect(fromPrismaDate(toPrismaDate(fecha))).toBe(fecha);
    }
  });

  it('una consulta por rango de fechas incluye los extremos', async () => {
    const codes = await prisma.animal.findMany({
      where: {
        farmId: farm.farmId,
        birthDate: {
          gte: toPrismaDate(toIsoDate('2026-01-01')),
          lte: toPrismaDate(toIsoDate('2026-01-31')),
        },
      },
      select: { code: true },
      orderBy: { code: 'asc' },
    });

    expect(codes.map((row) => row.code)).toEqual(['F-2026-01-01', 'F-2026-01-31']);
  });

  it('PostgreSQL guarda el día tal cual, comprobado en SQL crudo', async () => {
    const rows = await prisma.$queryRaw<{ code: string; texto: string }[]>`
      SELECT code, to_char(birth_date, 'YYYY-MM-DD') AS texto
      FROM animals
      WHERE farm_id = ${farm.farmId}::uuid AND code = 'F-2026-03-01'
    `;

    expect(rows[0]?.texto).toBe('2026-03-01');
  });
});

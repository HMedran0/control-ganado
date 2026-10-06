import { appendFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@hato/shared';
import request from 'supertest';

import { resetFarmData } from '../../prisma/seed/write.js';
import { PrismaService } from '../../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from '../helpers/app.js';
import { createFarm, type TestFarm } from '../helpers/fixtures.js';

/**
 * Rendimiento de la importación del inventario (ANI-09 CA7): 5.000 filas confirmadas en 25 s o
 * menos. En M4d tardaban de 21 a 23 s; en M8a llegaron a 40 s (una vez 62, por encima del tope de
 * 60 de la transacción), porque se validaban fila por fila contra la base —candado y consulta del
 * código, consulta del identificador: unas 15.000 consultas en serie— y cada milisegundo de
 * latencia sumaba 15 s. Desde M8b se validan en bloque (`findCodeHolders`, `findIdentifierUses`).
 *
 * Corre sobre la base de pruebas junto a la finca de carga, en una finca propia que crea y borra
 * al terminar. Como las demás de rendimiento: en local aplica el umbral y en la integración
 * continua (`CI` definida) solo reporta el tiempo.
 */

const ROWS = 5_000;
const LIMIT_S = 25;
const CI = process.env.CI !== undefined;
const CSV_HEADER = 'Código;Nombre;Sexo;Raza;Fecha de nacimiento;Lote;Chapeta visual';

describe('rendimiento de la importación (ANI-09 CA7)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let seconds = Number.NaN;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    farm = await createFarm(prisma, 'Rendimiento de la importación');
  }, 60_000);

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { id: farm.userId } });
    await resetFarmData(prisma, farm.farmId, user === null ? [] : [user.username]);
    const line = `| Importar ${ROWS.toLocaleString('es-CO')} filas | ${seconds.toFixed(1)} s | ${LIMIT_S} s |`;
    const table = ['| Escenario | Tiempo | Límite |', '|---|---:|---:|', line].join('\n');
    process.stdout.write(`\nRendimiento de la importación\n${table}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined && summary !== '') {
      appendFileSync(summary, `### Importación del inventario (ANI-09 CA7)\n\n${table}\n`);
    }
    await app.close();
  }, 120_000);

  it(`${ROWS} filas válidas se confirman en ${LIMIT_S} s o menos`, async () => {
    const rows = Array.from(
      { length: ROWS },
      (_, index) =>
        `P-${index + 1};;${index % 2 === 0 ? 'Hembra' : 'Macho'};Brahman;01/01/2022;;${index + 1}`,
    );
    const headers = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));

    const started = performance.now();
    const response = await request(app.getHttpServer())
      .post('/api/v1/imports/animals')
      .set(headers)
      .field('importKey', uuidv7())
      .field('expectedRows', String(ROWS))
      .attach('file', Buffer.from([CSV_HEADER, ...rows].join('\n'), 'utf8'), {
        filename: 'inventario.csv',
        contentType: 'text/csv',
      });
    seconds = (performance.now() - started) / 1000;

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ created: ROWS });
    if (!CI) expect(seconds).toBeLessThanOrEqual(LIMIT_S);
  }, 120_000);
});

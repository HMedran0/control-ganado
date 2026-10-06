import { appendFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { PrismaService } from '../../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from '../helpers/app.js';

/**
 * Rendimiento de la búsqueda, el listado y el tablero (RNF-01, ANI-05 CA2, RPT-01 CA2): con 5.000
 * animales y 50.000 eventos, búsqueda por debajo de 1 s, y listado filtrado y tablero por debajo de
 * 2 s, en el percentil 95.
 *
 * Necesita la finca del seed de carga en la base de pruebas:
 * `DATABASE_URL=$TEST_DATABASE_URL pnpm db:seed:load`, y luego
 * `pnpm --filter @hato/api test:perf`.
 *
 * Mide la aplicación completa en proceso —Fastify, guards, validación, consultas y
 * serialización—, no solo el SQL. En local aplica los umbrales de RNF-01; en la integración
 * continua (`CI` definida) solo reporta los tiempos, porque la máquina compartida del runner no
 * es la del servidor de la finca y un umbral ahí fallaría por ruido, no por el código.
 */

const RUNS = 40;
const WARMUP = 5;
const SEARCH_LIMIT_MS = 1_000;
const LIST_LIMIT_MS = 2_000;
const CI = process.env.CI !== undefined;

type Scenario = { readonly name: string; readonly path: string; readonly limitMs: number };
type Measure = Scenario & { readonly p50: number; readonly p95: number; readonly max: number };

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? Number.NaN;
}

describe('rendimiento con el seed de carga (RNF-01)', () => {
  let app: NestFastifyApplication;
  let headers: Record<string, string>;
  const results: Measure[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { username: 'carga.admin' } });
    const membership =
      user === null
        ? null
        : await prisma.membership.findFirst({
            where: { userId: user.id },
            select: { farmId: true },
          });
    if (user === null || membership === null) {
      throw new Error(
        'No está la finca de carga. Ejecuta antes: DATABASE_URL=$TEST_DATABASE_URL pnpm db:seed:load',
      );
    }
    const active = await prisma.animal.count({
      where: { farmId: membership.farmId, deletedAt: null, exitType: null },
    });
    expect(active).toBeGreaterThan(4_500);
    headers = bearer(await signTestToken(app, { userId: user.id, farmId: membership.farmId }));
  }, 60_000);

  afterAll(async () => {
    const table = [
      '| Escenario | p50 (ms) | p95 (ms) | máx. (ms) | Límite RNF-01 (ms) |',
      '|---|---:|---:|---:|---:|',
      ...results.map(
        (result) =>
          `| ${result.name} | ${result.p50} | ${result.p95} | ${result.max} | ${result.limitMs} |`,
      ),
    ].join('\n');
    process.stdout.write(`\nRendimiento (${RUNS} corridas por escenario)\n${table}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined && summary !== '') {
      appendFileSync(summary, `### Rendimiento RNF-01 (${RUNS} corridas)\n\n${table}\n`);
    }
    for (const result of results) {
      if (CI) {
        process.stdout.write(
          `::notice title=RNF-01 ${result.name}::p95 ${result.p95} ms (límite ${result.limitMs} ms)\n`,
        );
      }
    }
    await app.close();
  });

  async function measure(scenario: Scenario): Promise<Measure> {
    const server = app.getHttpServer();
    for (let run = 0; run < WARMUP; run += 1) {
      await request(server).get(scenario.path).set(headers).expect(200);
    }
    const times: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      await request(server).get(scenario.path).set(headers).expect(200);
      times.push(performance.now() - started);
    }
    times.sort((left, right) => left - right);
    const result = {
      ...scenario,
      p50: Math.round(percentile(times, 0.5)),
      p95: Math.round(percentile(times, 0.95)),
      max: Math.round(times.at(-1) ?? Number.NaN),
    };
    results.push(result);
    return result;
  }

  const search = (name: string, q: string): Scenario => ({
    name: `Búsqueda: ${name}`,
    path: `/api/v1/animals/search?q=${encodeURIComponent(q)}`,
    limitMs: SEARCH_LIMIT_MS,
  });
  const list = (name: string, query: string): Scenario => ({
    name: `Listado: ${name}`,
    path: `/api/v1/animals?${query}`,
    limitMs: LIST_LIMIT_MS,
  });

  const scenarios: Scenario[] = [
    search('código exacto', 'C-02500'),
    search('RFID exacto', '170000000002499'),
    search('RFID anterior (retirado)', '982000000002451'),
    // Una lectura del lector que no está registrada: no hay exacta y corre la difusa.
    search('RFID no registrado', '170999999999999'),
    search('difusa por nombre', 'estrel'),
    search('difusa por parte del código', '0250'),
    list('primera página', 'limit=50'),
    list('vacas preñadas', 'category=COW&tags=PREGNANT&limit=50'),
    list('hembras por último peso', 'sex=FEMALE&sort=-lastWeight&limit=50'),
    list('alertas de vacuna vencida', 'alerts=vaccine_overdue&limit=50'),
    list(
      'combinado: edad, partos próximos y orden por edad',
      'category=COW,HEIFER&ageMinMonths=18&alerts=calving_soon&sort=age&limit=50',
    ),
    list('máximo por página (200)', 'limit=200&sort=code'),
    // M8a: todas las cifras de Inicio en una pasada de la clasificación (RPT-01 CA2).
    { name: 'Tablero (Inicio)', path: '/api/v1/dashboard', limitMs: LIST_LIMIT_MS },
  ];

  for (const scenario of scenarios) {
    it(
      scenario.name,
      async () => {
        const result = await measure(scenario);
        if (!CI) expect(result.p95).toBeLessThan(scenario.limitMs);
      },
      120_000,
    );
  }
});

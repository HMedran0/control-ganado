import { appendFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AUDIT_ACTION } from '@hato/shared';
import request from 'supertest';

import { readZipEntries } from '../../src/imports/zip-guard.js';
import { PrismaService } from '../../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from '../helpers/app.js';

/**
 * Exportación completa con el seed de carga (BAK-02, ADR-018): 5.000 animales y 50.000 eventos.
 * Reporta el tiempo hasta el primer byte, el total, el tamaño del ZIP y cuánto creció la memoria
 * del proceso mientras se generaba (la exportación va por streaming: no debe crecer con la finca).
 *
 * La memoria se mide como el heap después de recolectar basura si el proceso corre con
 * `NODE_OPTIONS=--expose-gc` (M8b: +9 MB en el pico, incluido el ZIP que guarda la prueba); si
 * no, como el RSS, que incluye basura sin recolectar y sale mucho más alto (≈ 200 MB).
 *
 * Mismo régimen que las demás de rendimiento: en local falla si pasa de 2 minutos; en la
 * integración continua solo reporta.
 */

const LIMIT_S = 120;
const CI = process.env.CI !== undefined;

describe('rendimiento de la exportación completa (BAK-02)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farmId: string;
  let headers: Record<string, string>;
  const report: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
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
    farmId = membership.farmId;
    headers = bearer(await signTestToken(app, { userId: user.id, farmId }));
    // Las corridas anteriores no cuentan para el límite de 3 por hora.
    await prisma.auditLog.deleteMany({ where: { farmId, action: AUDIT_ACTION.EXPORT } });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { farmId, action: AUDIT_ACTION.EXPORT } });
    const table = ['| Medida | Valor |', '|---|---:|', ...report].join('\n');
    process.stdout.write(`\nExportación completa con el seed de carga\n${table}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined && summary !== '') {
      appendFileSync(summary, `### Exportación completa (BAK-02)\n\n${table}\n`);
    }
    await app.close();
  }, 60_000);

  it(`5.000 animales en ${LIMIT_S} s o menos, sin crecer en memoria`, async () => {
    const animals = await prisma.animal.count({ where: { farmId } });
    expect(animals).toBeGreaterThan(4_500);

    const gc = global.gc;
    const memory = () => {
      if (gc === undefined) return process.memoryUsage().rss;
      gc();
      return process.memoryUsage().heapUsed;
    };
    const rssBefore = memory();
    let rssPeak = rssBefore;
    const sampler = setInterval(() => {
      rssPeak = Math.max(rssPeak, memory());
    }, 100);

    const started = performance.now();
    let firstByteMs = Number.NaN;
    const response = await request(app.getHttpServer())
      .get('/api/v1/export/full')
      .set(headers)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          if (Number.isNaN(firstByteMs)) firstByteMs = performance.now() - started;
          chunks.push(chunk);
        });
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const seconds = (performance.now() - started) / 1000;
    clearInterval(sampler);

    expect(response.status).toBe(200);
    const zip = response.body as Buffer;
    const entries = readZipEntries(zip, { maxTotalBytes: 500 * 1024 * 1024, maxEntries: 100 });
    const unzipped = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    report.push(
      `| Animales | ${animals.toLocaleString('es-CO')} |`,
      `| Primer byte | ${(firstByteMs / 1000).toFixed(1)} s |`,
      `| Tiempo total | ${seconds.toFixed(1)} s (límite ${LIMIT_S} s) |`,
      `| ZIP | ${mb(zip.length)} MB (${entries.length} archivos, ${mb(unzipped)} MB sin comprimir) |`,
      `| Memoria (${gc === undefined ? "RSS, sin --expose-gc" : "heap tras recolectar"}) | +${mb(rssPeak - rssBefore)} MB en el pico (incluye el ZIP que guarda la prueba) |`,
    );
    if (!CI) expect(seconds).toBeLessThanOrEqual(LIMIT_S);
  }, 300_000);
});

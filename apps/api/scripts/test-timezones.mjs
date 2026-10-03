/**
 * Ejecuta las pruebas sensibles a la zona horaria en dos zonas muy separadas: Bogotá (UTC−5) y
 * Tokio (UTC+9). Si la conversión entre `IsoDate` y las columnas `date` de PostgreSQL usara la
 * hora local, el día se correría en una de las dos y la prueba fallaría (ADR-002).
 *
 * También las marcas de tiempo (`timestamptz`): la base de pruebas abre sus sesiones en la zona
 * de Bogotá y la API debe conservar la hora exacta (`test/timestamps.e2e-spec.ts`).
 *
 * Solo las pruebas de fechas, no toda la suite: las demás no dependen de la zona y las de
 * integración tardan lo suyo.
 */

import { spawnSync } from 'node:child_process';

const timeZones = ['America/Bogota', 'Asia/Tokyo'];
const targets = [
  'src/infra/date-mapper.spec.ts',
  'test/date-mapper.e2e-spec.ts',
  // Marcas de tiempo con la sesión de PostgreSQL fuera de UTC (el error de M5).
  'test/timestamps.e2e-spec.ts',
];

let failed = false;

for (const timeZone of timeZones) {
  process.stdout.write(`\n=== TZ=${timeZone} ===\n`);
  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', ...targets], {
    stdio: 'inherit',
    env: { ...process.env, TZ: timeZone },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);

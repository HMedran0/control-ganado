/**
 * Ejecuta toda la suite en dos zonas horarias muy separadas para demostrar que las fechas de
 * negocio no dependen de TZ (ADR-002). Bogotá está en UTC−5 y Tokio en UTC+9: si alguna
 * función usara la hora local, el día cambiaría y las pruebas fallarían en una de las dos.
 *
 * Node puro, sin dependencias, para que funcione igual en Windows y en el CI de Linux.
 */

import { spawnSync } from 'node:child_process';

const timeZones = ['America/Bogota', 'Asia/Tokyo'];
const vitestArgs = ['vitest', 'run', '--coverage=false', ...process.argv.slice(2)];

let failed = false;

for (const timeZone of timeZones) {
  process.stdout.write(`\n=== TZ=${timeZone} ===\n`);
  const result = spawnSync('pnpm', ['exec', ...vitestArgs], {
    stdio: 'inherit',
    env: { ...process.env, TZ: timeZone },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);

/**
 * Seed de la finca de referencia (08 §3, 03-modelo-datos.md §6).
 *
 * Marcador de posición del hito **M0.3b**, que cargará la finca La Esperanza completa:
 * usuarios, catálogos, 284 animales activos con su historial 2024–2026, y todo determinista
 * con `SEED_TODAY=2026-09-25` para que las pruebas afirmen cifras exactas.
 *
 * Existe desde ya porque Prisma 7 quitó `--skip-seed` de `migrate reset`: el comando siempre
 * ejecuta lo que declara `migrations.seed` en `prisma.config.ts`. Así `pnpm db:reset` crea el
 * esquema sin fallar mientras el seed real no exista.
 */

process.stdout.write('Seed pendiente del hito M0.3b: el esquema quedó creado, sin datos.\n');

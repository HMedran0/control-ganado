// Configuración de Prisma 7. Copiada de docs/referencia/prisma.config.ts y verificada contra
// la documentación vigente: `datasource.url` es la forma recomendada de dar la conexión a los
// comandos de migración (la propiedad `adapter` se eliminó en Prisma 7) y Prisma **no** carga
// .env por su cuenta, de ahí el import de dotenv.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * `prisma generate` no toca la base de datos, pero el archivo de configuración se evalúa
 * igual, y el ayudante `env()` de Prisma lanza si la variable falta. Como `db:generate` es
 * requisito de `build`, `typecheck` y `test`, exigir la URL ahí rompería esos comandos en un
 * clon recién hecho. Con el marcador, generar el cliente funciona sin `.env` y los comandos de
 * migración fallan al intentar conectarse, que es cuando la URL hace falta de verdad.
 */
const SIN_CONFIGURAR = 'postgresql://configura-DATABASE_URL-en-tu-.env/hato';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Node 24 ejecuta TypeScript borrando los tipos, sin necesidad de un ejecutor aparte.
    // `--conditions=development` resuelve @hato/shared a su código fuente (ADR-003) y el
    // gancho `ts-resolve` traduce las importaciones `.js` del cliente generado (ADR-006).
    //
    // Este comando lo ejecuta `prisma db seed`. Al contrario de lo que se anotó en M0.3a,
    // `prisma migrate reset` de Prisma 7.10 **no** siembra (tampoco tiene ya `--skip-seed`),
    // así que el script `db:reset` encadena los dos comandos a mano.
    seed: 'node --conditions=development --import ./prisma/seed/ts-resolve.mjs prisma/seed/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? SIN_CONFIGURAR,
  },
});

# Hato — Sistema de Gestión y Control de Ganado

Plataforma para registrar y controlar el ganado bovino de una finca en Colombia: animales, identificación (chapeta, DIN, RFID ISO 11784, QR), reproducción, nacimientos, sanidad, pesos, contabilidad básica, jornadas de manejo y reportes. Proyecto real y académico a la vez: la calidad de la documentación importa tanto como el código.

## Documentación (leer antes de implementar)
- `docs/01-srs.md` — requisitos con IDs (ANI-01, REP-04…), criterios de aceptación, reglas de negocio RN-xx, glosario español↔código.
- `docs/03-modelo-datos.md` + `docs/referencia/schema.prisma` + `docs/referencia/migracion-manual.sql`
- `docs/04-arquitectura.md` — stack, ADRs, estructura del monorepo, seguridad, pruebas.
- `docs/05-api.md` — contrato REST.
- `docs/06-ux-ui.md` — personas, principios, tokens, componentes, wireframes, redacción.
- `docs/07-plan-desarrollo.md` — hitos en orden y definición de terminado. Trabaja un hito por sesión.
- `docs/08-dominio-y-finca-referencia.md` — **decisiones de dominio** (categorías, destete, gestación por raza, plan oficial de vacunación, DIN) y la **finca de referencia ficticia** que reproduce el seed. Léelo antes de tocar reglas de negocio.

Si algo del código contradice la documentación, detente y pregunta; no "corrijas" la especificación en silencio.

## Stack
TypeScript estricto · pnpm + Turborepo · API NestJS (Fastify) + Prisma + PostgreSQL 16 · Web React + Vite + TanStack Router/Query + Tailwind + Radix · zod compartido en `packages/shared` · Móvil (F2) Expo · Escritorio (F3) Tauri.

## Comandos
Requisitos: Node 24 LTS (ver `.nvmrc`), pnpm 12 (`corepack enable pnpm`), Docker y `jq` (para los hooks).

Desde la raíz del monorepo:

| Comando | Qué hace |
|---|---|
| `pnpm install` | Instala todo el workspace. En CI se usa `--frozen-lockfile --strict-peer-dependencies`. |
| `pnpm dev` | Levanta la API en `http://localhost:3000/api/v1` con recarga, y `shared` compilando en vigilancia. Necesita `.env` y la base arriba. |
| `pnpm build` | `turbo run build`. Compila `shared` con `tsc` y la API con el CLI de Nest y SWC. |
| `pnpm lint` | `eslint .` con una sola flat config raíz, con información de tipos. No necesita build (ADR-003). |
| `pnpm lint:fix` | Igual, con `--fix`. |
| `pnpm typecheck` | `tsc` por paquete, sin emitir. |
| `pnpm test` | Vitest. En `shared`, con cobertura y umbral de 90 % en `src/domain`; en `api`, unitarias e integración contra PostgreSQL real. |
| `pnpm test:tz` | La suite de `shared` con `TZ=America/Bogota` y `TZ=Asia/Tokyo` (ADR-002). |
| `pnpm format` / `pnpm format:check` | Prettier sobre el repositorio. `docs/*.md` y `CLAUDE.md` están excluidos. |
| `docker compose up -d db` | PostgreSQL 16 para desarrollo (servicio `db`, volumen `hato-db-data`, healthcheck). |
| `docker compose down` | Detiene la base de datos. Con `-v` borra el volumen. |
| `pnpm db:generate` | Genera el cliente de Prisma desde el esquema. No se versiona; `build`, `typecheck` y `test` dependen de él. |
| `pnpm db:migrate` | `prisma migrate dev`: crea y aplica una migración nueva. |
| `pnpm db:reset` | **Borra y recrea la base**, aplica las migraciones y corre el seed. Solo en desarrollo. |
| `pnpm db:seed` | Carga la finca de referencia. **Pendiente del hito M0.3b**: hoy solo avisa. |

Por paquete: `pnpm --filter @hato/shared test:watch`, `pnpm --filter @hato/api typecheck`.

La base de datos de las pruebas de integración (`hato_test`) la crea y migra la propia suite;
su URL sale de `TEST_DATABASE_URL`, nunca de un puerto fijo en el código.

Mientras no exista el inicio de sesión (hito M1), la API usa `DEV_FAKE_AUTH=true` y toma la
finca y el rol de las cabeceras `x-dev-farm-id`, `x-dev-role` y `x-dev-user-id`. Con
`NODE_ENV=production` la API **no arranca** si esa variable está activa.

## Decisiones registradas (docs/adr/)
- **ADR-001** TypeScript 6.0.3, no 7: `typescript-eslint` aún no soporta TS 7 y se perdería el lint con tipos.
- **ADR-002** Fechas de negocio como `IsoDate` (`YYYY-MM-DD` con tipo marcado) y meses cumplidos con recorte a fin de mes. Nada de `Date` en el dominio.
- **ADR-003** `@hato/shared` expone su código fuente con la condición `development`: lint y typecheck no compilan antes. Consecuencia: **shared no puede usar APIs de Node** (también corre en web y en Expo).
- **ADR-004** Elegibilidad en ciclos oficiales: un animal que nació o ingresó a la finca después del cierre del ciclo no queda vencido (RN-13).
- **ADR-005** `apps/api` es **ESM** porque NestJS 12 se publica solo como módulos ES; Prisma genera el cliente en ESM. El compilador es **SWC** (no esbuild) porque hace falta `emitDecoratorMetadata` para la inyección de dependencias, y por eso las pruebas de la API van con Vitest + `unplugin-swc`.

## Dominio en una línea por tema (detalle en 08)
- Categoría de manejo exclusiva: Ternero, Ternera, Novilla, Vaca, Levante, Toro. Etiquetas combinables: Servida, Preñada, Parida (n), Horra, En retiro. Manuales: Cotero, Disponible para venta.
- Destete 7 meses; gestación según la raza de la madre (cebuinos 293, europeos 283, cruces 288; finca 285).
- Vacunas con cuatro tipos de programación: ciclo oficial (aftosa, rabia), ventana de edad (brucelosis: hembras 3–9 meses, prohibida en machos), intervalo, ninguna.
- Login por nombre de usuario (el correo es opcional). Códigos de crías `{YY}-{NNN}`.
- Datos de la finca **ficticios** pero coherentes; el seed es determinista con `SEED_TODAY=2026-09-25`.
- Alcance núcleo para el piloto: M0–M6 y M8.

## Reglas no negociables
1. **Multi-finca:** todo acceso a datos de negocio filtra por `farmId`, que viene del token (FarmScope), nunca del cuerpo de la petición.
2. **Autorización en el servidor:** roles ADMIN, OPERATOR, VET. Datos económicos solo ADMIN (RN-20), también en campos anidados de otros recursos.
3. **Sin borrado físico:** entidades se archivan (`deletedAt` + motivo); eventos se anulan (`voidedAt` + motivo) (RN-11).
4. **Derivados calculados, no almacenados:** edad, categorías, número de partos, inversión (RN-16). Única excepción: `expectedCalvingDate`.
5. **Reglas puras en `packages/shared/src/domain`**, con pruebas. No duplicar lógica en API o web.
6. **Fechas de negocio con tipo `date`**; "hoy" solo desde el servicio `Clock` (America/Bogota). Nada de `new Date()` en lógica de negocio.
7. **Dinero** `Decimal(14,2)` serializado como string; nunca `number` de punto flotante para montos.
8. **IDs UUIDv7** generados en la aplicación (`packages/shared/src/id.ts`).
9. **Casos de uso compuestos en transacción** (parto, vacunación masiva, gasto compartido, venta, entrada de jornada).
10. **Errores** en `application/problem+json` con `code` estable y `detail` en español listo para mostrar.

## Convenciones
- Código, nombres de archivos, tablas y commits en inglés; interfaz y mensajes al usuario en español de Colombia (ver glosario del SRS).
- Tablas y columnas snake_case vía `@@map`/`@map`; modelos PascalCase.
- Conventional Commits. Commits pequeños por unidad lógica.
- Cada endpoint nuevo: prueba de integración con rol autorizado, rol no autorizado y usuario de otra finca.
- Formularios web: react-hook-form + esquema zod de `shared`. Textos según `06-ux-ui.md` §7.
- Nuevas decisiones de arquitectura → `docs/adr/NNN-titulo.md`.

## Flujo de trabajo esperado
1. Leer el hito en `docs/07-plan-desarrollo.md` y los documentos que indica.
2. Proponer un plan (archivos, pruebas) y esperar aprobación.
3. Implementar con pruebas; ejecutar lint, typecheck y test.
4. Resumir lo hecho, lo pendiente y cualquier desviación de la especificación.

## Herramientas del repositorio
- `.claude/settings.json`: permisos y hooks. El hook `protect.sh` bloquea editar `.env*`, `docs/referencia/` y migraciones existentes; `format.sh` aplica Prettier y ESLint al archivo editado y te devuelve los errores. Requieren `jq` instalado.
- Si un hook te bloquea, no intentes rodearlo: explica al usuario qué necesitas cambiar y por qué.

## No hacer
- No agregar dependencias pesadas sin justificarlo en el plan.
- No inventar requisitos: si falta información, consulta `08-dominio-y-finca-referencia.md`; si tampoco está ahí, pregunta al usuario.
- No desactivar reglas de lint ni pruebas para "hacer pasar" CI.
- No guardar secretos ni contraseñas reales en el repositorio; usar `.env` (ignorado) y `.env.example`.

# Hato — Sistema de Gestión y Control de Ganado

Responde siempre al usuario en español de Colombia, tuteando.

Plataforma para registrar y controlar el ganado bovino de una finca en Colombia: animales, identificación (chapeta, DIN, RFID ISO 11784, QR), reproducción, nacimientos, sanidad, pesos, contabilidad básica, jornadas de manejo y reportes. Proyecto real y académico a la vez: la calidad de la documentación importa tanto como el código.

## Documentación (leer antes de implementar)
- `docs/01-srs.md` — requisitos con IDs (ANI-01, REP-04…), criterios de aceptación, reglas de negocio RN-xx, glosario español↔código.
- `docs/03-modelo-datos.md` + `docs/referencia/schema.prisma` + `docs/referencia/migracion-manual.sql`
- `docs/04-arquitectura.md` — stack, ADRs, estructura del monorepo, seguridad, pruebas.
- `docs/05-api.md` — contrato REST.
- `docs/06-ux-ui.md` — personas, principios, tokens, componentes, wireframes, redacción.
- `docs/07-plan-desarrollo.md` — hitos en orden y definición de terminado. Trabaja un hito por sesión.
- `docs/08-dominio-y-finca-referencia.md` — **decisiones de dominio** (categorías, destete, gestación por raza, plan oficial de vacunación, DIN) y la **finca de referencia ficticia** que reproduce el seed. Léelo antes de tocar reglas de negocio.
- `docs/09-ampliacion-validacion-ganaderos.md` — hallazgos de la validación con ganaderos (numeración reutilizable, báscula, sistema productivo y leche, cuentas y correo) y en qué hito entra cada uno. Ya está integrado en 01 a 08; se conserva como registro del porqué.

Si algo del código contradice la documentación, detente y pregunta; no "corrijas" la especificación en silencio.

## Stack
TypeScript estricto · pnpm + Turborepo · API NestJS (Fastify) + Prisma + PostgreSQL 16 · Web React + Vite + TanStack Router/Query + Tailwind + Radix · zod compartido en `packages/shared` · Móvil (F2) Expo o Capacitor, pendiente del ADR-014 · Escritorio (F3) Tauri.

## Comandos
Requisitos: Node 24 LTS (ver `.nvmrc`), pnpm 12 (`corepack enable pnpm`), Docker y `jq` (para los hooks).

Desde la raíz del monorepo:

| Comando | Qué hace |
|---|---|
| `pnpm install` | Instala todo el workspace. En CI se usa `--frozen-lockfile --strict-peer-dependencies`. |
| `pnpm dev` | Levanta la API en `http://localhost:3000/api/v1` con recarga, la web en `http://localhost:5173` (Vite reenvía `/api` a `API_PROXY_TARGET`, ADR-008) y `shared` compilando en vigilancia. Necesita `.env` y la base arriba. |
| `pnpm build` | `turbo run build`. Compila `shared` con `tsc` y la API con el CLI de Nest y SWC. |
| `pnpm lint` | `eslint .` con una sola flat config raíz, con información de tipos. No necesita build (ADR-003). |
| `pnpm lint:fix` | Igual, con `--fix`. |
| `pnpm typecheck` | `tsc` por paquete, sin emitir. |
| `pnpm test` | Vitest. En `shared`, con cobertura y umbral de 90 % en `src/domain`; en `api`, unitarias e integración contra PostgreSQL real; en `web`, componentes y cliente de la API con jsdom. |
| `pnpm --filter @hato/web test:e2e:seed` | Aplica las migraciones y carga la finca de referencia en la base de **pruebas** (`TEST_DATABASE_URL`, `hato_test`), no en la de desarrollo. Repítelo después de `pnpm test`, que vacía esa base. |
| `pnpm --filter @hato/web test:e2e` | Playwright (Chromium, móvil y escritorio) con axe-core: web compilada con `vite preview` + API compilada contra `hato_test`, y `/dev/ui` contra el servidor de desarrollo de Vite. La API de las pruebas corre en el puerto 3100 con `DATABASE_URL=$TEST_DATABASE_URL` y `RATE_LIMIT_PER_IP=1000`; nunca reutiliza un servidor ya levantado, y se niega a arrancar si la base no termina en `_test`. Orden: `pnpm build` → `test:e2e:seed` → `test:e2e`, con `SEED_PASSWORD` definida. Deja capturas en `apps/web/e2e/capturas/` (ignorado por git). |
| `http://localhost:5173/dev/ui` | Muestra de los componentes del sistema de diseño en todos sus estados. Solo en `pnpm dev`: el build la excluye y lo verifica (`apps/web/scripts/check-dev-ui-excluded.mjs`). |
| `pnpm --filter @hato/web size` | Después de `pnpm build`: suma el gzip de lo que pide `dist/index.html` (JS + CSS de la carga inicial) y falla si pasa de `hato.initialLoadBudgetKb` en `apps/web/package.json` (165 KB). Corre en la CI después del build. Subir el tope se justifica en el mensaje del commit. |
| `pnpm test:tz` | La suite de `shared` con `TZ=America/Bogota` y `TZ=Asia/Tokyo` (ADR-002). |
| `pnpm format` / `pnpm format:check` | Prettier sobre el repositorio. `docs/*.md` y `CLAUDE.md` están excluidos. |
| `docker compose up -d db` | PostgreSQL 16 para desarrollo (servicio `db`, volumen `hato-db-data`, healthcheck). |
| `docker compose down` | Detiene la base de datos. Con `-v` borra el volumen. |
| `pnpm db:generate` | Genera el cliente de Prisma desde el esquema. No se versiona; `build`, `typecheck` y `test` dependen de él. |
| `pnpm db:migrate` | `prisma migrate dev`: crea y aplica una migración nueva. |
| `pnpm db:reset` | **Borra y recrea la base**, aplica las migraciones y corre el seed. Solo en desarrollo. |
| `pnpm db:seed` | Carga la finca de referencia (08 §3): 297 animales, 284 activos, historial 2024–2026; y las fincas de pruebas El Retiro (numeración reutilizable) y La Nueva (vacía, para importar la plantilla). Necesita `SEED_PASSWORD`. Se puede repetir: borra sus fincas antes de sembrarlas. |
| `pnpm db:seed:load` | Carga 5.000 animales y 50.000 eventos (más identificadores y nombres) en una finca aparte, para las pruebas de rendimiento (RNF-01). Muestra el tiempo por etapa. |
| `pnpm --filter @hato/api test:perf` | Pruebas de rendimiento (RNF-01): p95 de búsqueda < 1 s y de listado filtrado < 2 s sobre la finca de carga en `hato_test`. Antes: `DATABASE_URL=$TEST_DATABASE_URL pnpm db:seed:load` (repetirlo después de `pnpm test`, que vacía esa base). En local aplica los umbrales; en CI solo reporta los tiempos en el resumen del job. |

Por paquete: `pnpm --filter @hato/shared test:watch`, `pnpm --filter @hato/api typecheck`.

La base de datos de las pruebas de integración (`hato_test`) la crea y migra la propia suite;
su URL sale de `TEST_DATABASE_URL`, nunca de un puerto fijo en el código.

Los dos seeds se niegan a ejecutarse con `NODE_ENV=production` o contra una base que no sea
local (`localhost`, `127.0.0.1`, `db` o `postgres`): borran y reescriben los datos de su finca.
El seed de referencia es **determinista** —generador con semilla fija, «hoy» en `SEED_TODAY`,
identificadores y marcas de tiempo incluidos—, así que dos ejecuciones seguidas dejan la base
idéntica. Sus cifras están en `apps/api/prisma/seed/expected.ts` y las comprueba
`test/seed.e2e-spec.ts` con SQL directo. Si cambias el generador y alguna cifra se mueve,
actualiza ese archivo en el mismo commit y explica por qué.

La autenticación es real desde M1 (ADR-007): `Authorization: Bearer <accessToken>` en todo
salvo `/auth/login`, `/auth/refresh` y `/health`. El token dura 15 minutos y prueba que hubo
un inicio de sesión, pero **el rol y el estado de la cuenta se leen de la base en cada
petición**, así que desactivar a alguien o cambiarle el rol aplica de inmediato. El token de
refresco es opaco, se guarda solo como hash y viaja en una cookie `HttpOnly` limitada a
`/api/v1/auth`. El mecanismo temporal `DEV_FAKE_AUTH` se retiró: ya no hay variable de
entorno capaz de dejar la API abierta.

Las pruebas de integración se autentican de verdad: `login` contra la API, o `signTestToken`
para casos que necesitan un token concreto (de otra finca, vencido, de un usuario que luego
se desactiva). No existe forma de fabricarse un ámbito con una cabecera.

## Decisiones registradas (docs/adr/)
- **ADR-001** TypeScript 6.0.3, no 7: `typescript-eslint` aún no soporta TS 7 y se perdería el lint con tipos.
- **ADR-002** Fechas de negocio como `IsoDate` (`YYYY-MM-DD` con tipo marcado) y meses cumplidos con recorte a fin de mes. Nada de `Date` en el dominio.
- **ADR-003** `@hato/shared` expone su código fuente con la condición `development`: lint y typecheck no compilan antes. Consecuencia: **shared no puede usar APIs de Node** (también corre en web y en la app móvil).
- **ADR-004** Elegibilidad en ciclos oficiales: un animal que nació o ingresó a la finca después del cierre del ciclo no queda vencido (RN-13).
- **ADR-005** `apps/api` es **ESM** porque NestJS 12 se publica solo como módulos ES; Prisma genera el cliente en ESM. El compilador es **SWC** (no esbuild) porque hace falta `emitDecoratorMetadata` para la inyección de dependencias, y por eso las pruebas de la API van con Vitest + `unplugin-swc`.
- **ADR-006** Los comandos del seed cargan un gancho de resolución `.js` → `.ts` (`prisma/seed/ts-resolve.mjs`), porque el cliente generado por Prisma son archivos `.ts` que se importan con extensión `.js` y el borrado de tipos de Node no reescribe extensiones. Solo afecta al proceso del seed.
- **ADR-007** Autenticación: JWT de 15 min + refresh opaco rotado con revocación de familia; el bloqueo por intentos se **deduce** de `login_attempts` y dura 15 minutos completos desde el último fallo; el rol y el estado de la cuenta se leen de la base en cada petición, no del token; la finca activa va en el token y la sesión la recuerda. Retira `DEV_FAKE_AUTH`. El bloqueo es **solo por cuenta**, nunca por IP (en la finca todos comparten la IP); por IP solo aplica el límite de peticiones.
- **ADR-008** Web y API en el mismo origen: proxy de `/api` en Vite (desarrollo y `preview`) y Caddy en producción. La cookie del refresco (`SameSite=Strict`) funciona sin CORS. El access token vive solo en memoria; los refrescos se serializan entre pestañas con Web Locks.
- **ADR-009** Clasificación en SQL: la CTE `classificationCtes` filtra y cuenta categorías, etiquetas y alertas con todos los valores como parámetros y los parámetros de la finca leídos de `settings`; lo que se muestra sale de shared. RN-27 se garantiza con una prueba de equivalencia animal por animal sobre el seed. Desde M6 (decisión 8) también el estado de vacunas (`vaccine-status.sql.ts`) y la ganancia de peso (`weight-gain.sql.ts`), con la misma prueba.
- **ADR-010** «Hoy» de la API: el `Clock` usa la fecha real de America/Bogota; `SEED_TODAY` es solo del seed. `CLOCK_FIXED_TODAY` fija la fecha solo en pruebas y con `NODE_ENV=production` la API no arranca si está definida.
- **ADR-011** Importación: `.xlsx`/`.csv`, 5 MB, 5.000 filas; tipo real por contenido; lector propio del ZIP que descomprime con límite y reempaqueta sin compresión para `exceljs`; fórmulas por su valor guardado; idempotencia por clave del archivo elegido (única por finca) y candado por finca. Nunca el paquete `xlsx` de npm. La sesión de la báscula (M6) usa el mismo camino (`import_batches.kind = WEIGHTS`).
- **ADR-012** Escrituras listas para trabajar sin conexión (desde M5): `id` del cliente en toda creación (mismo contenido → 200; otro → `CLIENT_ID_CONFLICT`), `Idempotency-Key` en las acciones (tabla `idempotency_keys`, 7 días, nunca `/auth`; otra petición con la misma clave → `IDEMPOTENCY_KEY_REUSED`), `version` en lo editable con `VERSION_CONFLICT`, anular dos veces responde 200, y `updated_at` por trigger `set_updated_at()`, no `@updatedAt`. SYN-01 no puede usar `updated_at` solo como cursor.
- **ADR-013** Límites por plan en un solo punto: `EntitlementsService.can` y `checkLimit`, plan PILOT sin límites y sin columna; `PLAN_LIMIT_REACHED` reservado. Nada de cobro en F1.
- **ADR-015** Ganancia diaria de peso: regresión lineal de los pesajes de los últimos 90 días más el anterior como ancla (a lo sumo `weightGainAnchorMaxDays`, 180), al menos un pesaje en la ventana, dos puntos y 30 días; aritmética entera y redondeo a milésimas de kg/día antes de comparar con los umbrales, igual en shared y en SQL.
- **ADR-016** Finanzas (M7): `allocateExpense` ordena los animales por id y da el residuo al primero; corregir un gasto anula las asignaciones vigentes y crea las nuevas solo si el reparto cambió (corregir la descripción no toca nada); anularlo anula las suyas; todo por `apps/api/src/finance/expense-writes.ts`, también la compra y el costo del tratamiento. Gasto general (`GENERAL`) sin asignaciones. `GET /audit` trae montos (solo ADMIN); el reparto se ve como la parte del animal (`share`) en su ficha. RN-20 lo vigila `rn20-sweep.e2e-spec.ts`.
- **ADR-017** Tablero (M8a): `GET /dashboard` trae las cifras comunes y solo las secciones del sistema productivo (`systemQuestions`), todo de una pasada de `classificationCtes`, y cada cifra coincide con su listado. Peso de venta medido y estimado por separado (`saleWeightProjection`, «posiblemente en el peso» si la fecha estimada ya pasó); aplica a Levante y Toro, y los reproductores se excluyen con la etiqueta del sistema `REPRODUCTOR`. Rendimiento: edad una vez por animal (`LATERAL` con `OFFSET 0`) y `cycle_applied` por el índice de `vaccination_records`. Inicio en 3G se confirma en M10b con HTTP/2.
- **ADR-014** (propuesta) Tecnología móvil: Expo o Capacitor, con una prueba de cada una antes de la fase 2.

## Dominio en una línea por tema (detalle en 08)
- Categoría de manejo exclusiva: Ternero, Ternera, Novilla, Vaca, Levante, Toro. Etiquetas combinables: Servida, Preñada, Parida (n), Horra, En retiro; con leche (M9b), En ordeño y Seca. Ojo: `DRY` es **Horra**, no «seca»; «Seca» es `DRIED_OFF`. Manuales: Cotero, Disponible para venta.
- Destete 7 meses; gestación según la raza de la madre (cebuinos 293, europeos 283, cruces 288; finca 285).
- Vacunas con cuatro tipos de programación: ciclo oficial (aftosa, rabia), ventana de edad (brucelosis: hembras 3–9 meses, prohibida en machos), intervalo, ninguna.
- Login por nombre de usuario (el correo es opcional). Códigos de crías `{YY}-{NNN}`.
- Datos de la finca **ficticios** pero coherentes; el seed es determinista con `SEED_TODAY=2026-09-25`.
- **Núcleo** (debe estar para el piloto): M0–M6 (M4 en cuatro partes, M4a a M4d), M8 y M10a. **Completo:** M7 (finanzas), M9 (jornadas web), M9b (control de leche) y M10b (endurecimiento y despliegue). M10b es obligatorio antes de cargar datos reales.

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
- Nunca usar `git add -A` ni `git add .`: agregar los archivos por nombre y revisar `git status` antes de cada commit.
- Cada endpoint nuevo: prueba de integración con rol autorizado, rol no autorizado y usuario de otra finca.
- Formularios web: react-hook-form + esquema zod de `shared`. Textos según `06-ux-ui.md` §7.
- Nuevas decisiones de arquitectura → `docs/adr/NNN-titulo.md`.

## Flujo de trabajo esperado
1. Leer el hito en `docs/07-plan-desarrollo.md` y los documentos que indica.
2. Proponer un plan (archivos, pruebas) y esperar aprobación.
3. Implementar con pruebas; ejecutar lint, typecheck y test.
4. Resumir lo hecho, lo pendiente y cualquier desviación de la especificación.

## Herramientas del repositorio
- `.claude/settings.json`: permisos y hooks. El hook `protect.sh` bloquea editar `.env*`, `docs/referencia/` y las migraciones ya versionadas en git (una recién generada, sin commit, sí se puede ajustar); `format.sh` aplica Prettier y ESLint al archivo editado y te devuelve los errores. Requieren `jq` instalado: sin él, `protect.sh` **falla cerrado** (bloquea toda edición con «Instala jq para activar la protección: winget install jqlang.jq») y `format.sh` solo avisa.
- Si un hook te bloquea, no intentes rodearlo: explica al usuario qué necesitas cambiar y por qué.

## No hacer
- No agregar dependencias pesadas sin justificarlo en el plan.
- No inventar requisitos: si falta información, consulta `08-dominio-y-finca-referencia.md`; si tampoco está ahí, pregunta al usuario.
- No desactivar reglas de lint ni pruebas para "hacer pasar" CI.
- No guardar secretos ni contraseñas reales en el repositorio; usar `.env` (ignorado) y `.env.example`.

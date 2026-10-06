# Arquitectura

Estilo: API central + clientes por plataforma (opción A aprobada). Backend como monolito modular: un solo despliegue, módulos con fronteras claras. No se usan microservicios: el tamaño del problema y del equipo no los justifica, y un monolito modular puede dividirse después si fuera necesario.

## 1. Vista de contexto

```
 Administrador ─┐                         ┌─ Almacenamiento S3-compatible
 Operario ──────┼─► Web (F1) ─┐           │  (respaldos cifrados, fotos)
 Veterinario ───┤   Móvil (F2)├─► API ────┤
                └─► Escritorio│   REST    └─ PostgreSQL 16
                    (F3) ─────┘
 Lector RFID (modo teclado en F1, Bluetooth en F2) ─► cliente
```

## 2. Stack y decisiones (ADR resumidos)

Versiones: usar la última estable de cada herramienta al iniciar el proyecto y fijarlas en `package.json`. No inventar APIs: si hay duda sobre una librería, consultar su documentación oficial.

| # | Decisión | Alternativas descartadas | Motivo |
|---|---|---|---|
| ADR-01 | TypeScript estricto en todo el sistema | Python (Django) para la API | Un solo lenguaje permite compartir esquemas de validación, tipos y reglas (edad, clasificación) entre API, web y móvil. |
| ADR-02 | Monorepo con pnpm workspaces + Turborepo | Repos separados | Cambios atómicos entre API y clientes; paquete `shared` sin publicar en npm. |
| ADR-03 | API con NestJS | Express simple, Fastify simple | Módulos, inyección de dependencias y guards encajan con el monolito modular y con la autorización por rol. Adaptador Fastify para rendimiento. |
| ADR-04 | PostgreSQL + Prisma | MongoDB; TypeORM; Drizzle | Datos altamente relacionales con integridad fuerte. Prisma da migraciones y tipos; lo que no expresa (índices parciales, CHECK, pg_trgm) va en SQL manual. Prisma 7: conexión en `prisma.config.ts` y cliente con `@prisma/adapter-pg`. |
| ADR-05 | Validación con zod en `packages/shared` | class-validator | Un mismo esquema valida el formulario en web/móvil y la petición en la API (vía `nestjs-zod`). |
| ADR-06 | Web: React + Vite (SPA) + TanStack Router + TanStack Query | Next.js | Aplicación detrás de login sin necesidad de SEO ni SSR; una SPA es más simple, se empaqueta igual en Tauri (F3) y comparte patrones con React Native (F2). |
| ADR-07 | Estilos: Tailwind CSS + componentes accesibles propios sobre Radix UI (estilo shadcn/ui, código copiado al repo) | Material UI, Bootstrap | Control total sobre la identidad visual de `06-ux-ui.md` sin pelear con un tema ajeno. |
| ADR-08 | Móvil (F2): app nativa con SQLite local; **Expo (React Native) o Capacitor, pendiente del ADR-014** | Flutter; PWA | Reutiliza TypeScript, `shared` y el cliente de API. Bluetooth y cámara nativos fiables en Android (una PWA no tiene Web Bluetooth en iOS). La elección entre Expo y Capacitor se hace con una prueba de cada una antes de la fase 2 (`docs/adr/014-tecnologia-de-la-app-movil.md`). |
| ADR-09 | Escritorio (F3): Tauri empaquetando la web | Electron | Binarios mucho más livianos; la web ya es una SPA. |
| ADR-10 | Autenticación propia con JWT de acceso (15 min) + refresh token rotado, deslizante (30 días desde el último uso) con tope por familia (180 días); Google como método de acceso adicional por OpenID Connect con PKCE (M10a) | Proveedor externo (Auth0, Clerk) | Sin costo por usuario, funciona sin correo electrónico y es un contenido evaluable del proyecto académico. Detalle en `docs/adr/007-autenticacion.md`. |
| ADR-11 | IDs UUIDv7 generados en la aplicación | Autoincrementales | Permiten crear registros sin conexión en el móvil (F2) sin colisiones; ordenables por tiempo. |
| ADR-12 | Clasificaciones y alertas calculadas en consulta | Almacenadas y actualizadas por disparadores o tareas | Siempre consistentes; con índices adecuados el costo es bajo para miles de animales. Se revisa si RNF-01 no se cumple. |
| ADR-13 | Despliegue con Docker Compose en un VPS (API + PostgreSQL + Caddy con HTTPS automático) | PaaS administrado | Costo bajo y predecible; migrable a PaaS después. |
| ADR-14 | Borrado lógico y anulación de eventos | Borrado físico | Trazabilidad (RNF-14) y sincronización (F2). |

Cada ADR nuevo o cambio de decisión se documenta en `docs/adr/NNN-titulo.md` (contexto, decisión, consecuencias).

## 3. Estructura del monorepo

```
hato/
├── CLAUDE.md
├── docs/                       # esta documentación
├── apps/
│   ├── api/                    # NestJS
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed/           # seed.ts (demo), seed-load.ts (rendimiento)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/         # FarmScope, guards, filtros de error, interceptor de auditoría, paginación
│   │   │   ├── infra/          # prisma.service, storage, clock (fecha "hoy" inyectable)
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── users/
│   │   │       ├── farms/      # configuración y catálogos
│   │   │       ├── animals/    # animales, identificadores, etiquetas, salidas, búsqueda
│   │   │       ├── reproduction/
│   │   │       ├── health/     # vacunas, vacunaciones, tratamientos
│   │   │       ├── weights/
│   │   │       ├── lots/
│   │   │       ├── finance/    # gastos, asignaciones, ventas, avalúos (solo ADMIN)
│   │   │       ├── work-sessions/
│   │   │       ├── dashboard/
│   │   │       ├── reports/    # consultas + exportación Excel/PDF
│   │   │       ├── audit/
│   │   │       └── sync/       # F2
│   │   └── test/               # integración y e2e de API
│   ├── web/                    # React + Vite
│   │   └── src/
│   │       ├── routes/         # TanStack Router (basado en archivos)
│   │       ├── features/       # animals, reproduction, health, ... (componentes + hooks por dominio)
│   │       ├── components/     # sistema de diseño (ui/) y componentes compartidos
│   │       ├── lib/            # api client, auth, formato
│   │       └── styles/
│   ├── mobile/                 # F2 (Expo o Capacitor, ADR-014)
│   └── desktop/                # F3 (Tauri)
├── packages/
│   ├── shared/                 # zod schemas, tipos DTO, enums, reglas puras de dominio
│   │   └── src/
│   │       ├── schemas/        # un archivo por recurso (animal.ts, pregnancy.ts, ...)
│   │       ├── domain/         # age.ts, classification.ts, pregnancy.ts, allocation.ts, identifiers.ts
│   │       ├── format/         # fechas, moneda, peso, edad (es-CO)
│   │       └── id.ts           # uuidv7
│   ├── api-client/             # cliente tipado sobre fetch (en F1 vive en apps/web/src/lib/api; se extrae aquí al llegar el móvil, F2)
│   └── config/                 # tsconfig, eslint, prettier compartidos
├── docker-compose.yml          # postgres para desarrollo
├── docker-compose.prod.yml
├── turbo.json
└── pnpm-workspace.yaml
```

Regla: las reglas de negocio puras (cálculo de edad, clasificación, fecha estimada de parto, reparto de gastos, validación RFID) viven en `packages/shared/src/domain` como funciones sin dependencias ni acceso a base de datos, con pruebas unitarias exhaustivas. La API y los clientes las importan; nunca se duplican.

## 4. Arquitectura interna de la API

Capas por módulo:
```
Controller  → valida entrada (zod), aplica guards de rol, traduce HTTP
Service     → casos de uso; transacciones; invoca reglas de dominio de shared
Repository  → acceso a Prisma, siempre filtrado por farmId
```

Transversales (`common/`):
- **FarmScope**: el `farmId` sale del token (membresía activa), nunca del cuerpo de la petición. Todo repositorio lo recibe obligatoriamente. Una prueba de integración verifica que ningún endpoint devuelve datos de otra finca.
- **RolesGuard** con decorador `@Roles('ADMIN')`. Los endpoints económicos se declaran en el módulo `finance`, protegido completo con ADMIN. Los campos económicos que aparecen en otros recursos (por ejemplo, valor de compra en la ficha) se omiten en el serializador para roles distintos de ADMIN.
- **AuditInterceptor**: registra en `audit_logs` cada operación de escritura exitosa con el diff.
- **Clock**: servicio inyectable que da "hoy" en `America/Bogota`. Prohibido usar `new Date()` directamente en la lógica de negocio (permite probar alertas con fechas fijas).
- **Errores**: formato `application/problem+json` (RFC 9457) con `type`, `title`, `status`, `detail`, `code` estable (por ejemplo `ANIMAL_CODE_TAKEN`) y `errors` por campo para validaciones. Los mensajes `detail` están en español y listos para mostrar.
- **Transacciones**: los casos de uso compuestos (registrar parto, vacunación masiva, gasto compartido, venta) usan `prisma.$transaction`.
- **Concurrencia**: las actualizaciones de entidades editables envían `version`; si no coincide, respuesta 409 `VERSION_CONFLICT`.

## 5. Autenticación y seguridad

- Login → `accessToken` (JWT, 15 min, en memoria del cliente) + `refreshToken` (opaco, aleatorio, guardado como hash). Web: refresh token en cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Móvil: en almacenamiento seguro del sistema.
- Rotación: cada refresh emite uno nuevo y revoca el anterior; si se reutiliza uno revocado, se revoca toda la familia (posible robo).
- Sesión deslizante (M4d, ADR-007 decisión 6): cada rotación extiende el vencimiento a `REFRESH_TTL_DAYS` desde ese momento, hasta un tope de `REFRESH_MAX_AGE_DAYS` desde el inicio de la familia. Cada familia es una sesión que el usuario ve y puede cerrar en Mi cuenta; el ADMIN puede cerrar las de un usuario de su finca (todas, en todas sus fincas). La rotación revoca y emite en una transacción, y el token de acceso lleva la sesión (`sid`): `AccessGuard` comprueba en cada petición, en paralelo con la membresía, que siga abierta, así que cerrar una sesión corta su acceso de inmediato.
- Archivos subidos (M4d, ADR-011): solo la importación del inventario recibe archivos, por `@fastify/multipart` con un archivo de hasta 5 MB y pocos campos cortos, en memoria (nada va a disco). El tipo se comprueba por el contenido; un lector propio del ZIP descomprime cada entrada con un límite real antes de que `exceljs` vea nada, y las fórmulas nunca se evalúan. Todo archivo que genera la API escapa el texto que una hoja de cálculo ejecutaría como fórmula.
- Correo (M10a, ADR-007 decisión 7): interfaz `Mailer` con SMTP en producción, Mailpit en desarrollo y un `Mailer` en memoria en pruebas. Los enlaces de invitación, verificación y recuperación llevan el token en el fragmento de la URL, nunca en la query string; la página lo borra con `history.replaceState` y lo envía en el cuerpo. Esas páginas van con `Referrer-Policy: no-referrer`.
- Google (M10a, ADR-007 decisión 8): OpenID Connect con código de autorización y PKCE del lado del servidor; `state`, `nonce` y `code_verifier` guardados en el servidor con vencimiento corto; no crea cuentas ni fincas.
- Contraseñas: Argon2id. Política mínima: 8 caracteres.
- Límite de intentos: login 5 fallos en 15 min **por cuenta** (nunca por IP: en la finca todos comparten la IP pública; ADR-007, revisión de M2a); límite de peticiones por IP sin autenticar (60/min) y por usuario (300/min); envío de correos de recuperación, 3 por correo por hora.
- Cabeceras seguras (helmet), CORS restringido a los orígenes de los clientes.
- Variables de entorno validadas con zod al arrancar; la API no inicia si falta alguna.

## 6. Clientes

### Web (F1)
- TanStack Query para datos del servidor (caché, reintentos, invalidación tras mutaciones). Sin estado global adicional salvo sesión.
- Formularios con react-hook-form + resolvers de zod usando los esquemas de `shared`.
- Rutas protegidas por rol; el servidor sigue siendo la autoridad.
- Búsqueda global siempre accesible (atajo `/` en escritorio). Un lector RFID en modo teclado escribe en el campo con foco; además, un listener global (`useRfidReader`) detecta ráfagas de exactamente 15 dígitos + Enter en las que **ningún intervalo entre teclas consecutivas supera 50 ms** (configurable con `maxKeyIntervalMs`), y ejecuta la búsqueda aunque no haya foco en el campo. Se mide el intervalo entre teclas y no la duración total: un lector Bluetooth en modo teclado envía un carácter cada 10–30 ms (una lectura completa tarda 150–450 ms), mientras que una persona deja más de 100 ms entre teclas. El umbral se ajusta al probar con el lector real. Dentro de un campo marcado con `data-rfid-field` (p. ej. «Identificador» al crear un animal) la lectura queda escrita en el campo, el Enter se absorbe para no enviar el formulario y el foco pasa al siguiente campo; en cualquier otro campo editable el listener no interviene.
- Borradores de formularios largos guardados en `sessionStorage` para no perder datos si se cae la conexión (RNF-16).

### Móvil (F2) — diseño anticipado
La tecnología (Expo o Capacitor) la decide el ADR-014. Lo que sigue vale para las dos. Las escrituras de la API ya se hacen listas para trabajar sin conexión desde M5 (ADR-012): `id` del cliente en toda creación, `Idempotency-Key` en las acciones, `version` en lo editable y `updated_at` mantenido por un trigger. Los límites por plan pasan por un solo servicio (ADR-013).
- Base local SQLite con las mismas entidades (subconjunto de columnas).
- Cola de salida: cada mutación local se guarda como operación con UUID propio (idempotencia) y se envía en lote.
- Endpoints de sincronización: `GET /sync/pull?since=<cursor>` devuelve cambios por entidad desde el cursor (basado en `updated_at`/`created_at` y tombstones); `POST /sync/push` recibe operaciones y responde por operación: aplicada, rechazada (con motivo) o en conflicto.
- Resolución (RN-24): eventos de solo adición sin conflicto; entidades editables con última escritura por registro y versión perdida en auditoría.
- Por qué se diseña ya: IDs UUIDv7 del cliente, `version`, `updated_at`, anulación en lugar de borrado y eventos de solo adición son prerrequisitos que en F1 no cuestan casi nada y evitan migraciones dolorosas después.
- Báscula (PES-03, M15; 09 v1.4): los indicadores de pesaje usan protocolos propios y, a menudo, Bluetooth clásico, que un navegador no alcanza; por eso la conexión directa es de la app móvil. La primera marca es **Tru-Test (Datamars)**: XR5000, ID5000 y JR5000, y S3 y EziWeigh7i si la documentación del fabricante los cubre. Mientras tanto, y siempre como respaldo, la web importa el archivo que exporta el indicador (PES-04).
  - **`ScaleAdapter`**: la interfaz de cualquier indicador. `connect()`, `status` (desconectado, conectando, conectado, error), un flujo de lecturas `{ weightKg, stable, eid?, at }` y `disconnect()`. `stable` es lo que diga el indicador; `eid` llega solo si el lector está conectado a él (modo A).
  - **`TruTestAdapter`**: implementa la interfaz para los indicadores Tru-Test por Bluetooth, según la documentación de integración que se pida a Datamars (09 §3, prerrequisitos). En iPhone exige firmware 4.7.8 o superior en XR5000, ID5000 y JR5000.
  - **Adaptador simulado**: reproduce sesiones grabadas de una báscula real, con sus tiempos; con él se prueban la jornada y las condiciones de guardado sin hardware.
  - **Lógica común en `packages/shared/src/domain`**, independiente de la marca y con pruebas: las condiciones de guardado de PES-03 (animal identificado, peso estable por el indicador o por `scaleStableToleranceKg` durante `scaleStableSeconds`, mayor que `scaleMinWeightKg`, y vuelta por debajo de `scaleZeroThresholdKg` antes del siguiente), el aviso de duplicado y el de peso atípico. El modo A (el indicador asocia chip y peso) las usa como protección adicional; el modo B (lector en el celular) las necesita.
  - Cada pesaje se guarda primero en la base local del celular, con método `SCALE` y `scale_serial`, y se envía con la sincronización (SYN-01): una desconexión no pierde lo pesado; la app avisa e intenta reconectar.
  - Otras marcas (PES-08: Gallagher, indicadores genéricos por puerto serie) son otras implementaciones de la misma interfaz, sin tocar la lógica común.
  - Qué tecnología móvil implementa esto (Expo o Capacitor) lo decide el ADR-014, que evalúa entre otras cosas el Bluetooth clásico en Android y el BLE en iPhone.
- Google (AUT-15): inicio de sesión nativo de Google en la app y refresco en el almacenamiento seguro del sistema, no en cookie.

### Escritorio (F3)
- Tauri envolviendo el build de la web. Sin lógica propia salvo la conexión al indicador Tru-Test por USB o Bluetooth (PES-07, M18), con el mismo `TruTestAdapter` y la lógica común de `packages/shared` de la app móvil.

## 7. Reportes y exportación
- Consultas agregadas en SQL (vistas o `$queryRaw` tipado) dentro del módulo `reports`.
- Excel con `exceljs` (M4d): la exportación del listado arma el libro en memoria, hasta 50.000 filas, con fechas y números reales y el texto escapado contra la inyección de fórmulas; si un reporte llega a pasar ese tamaño, se cambia a su escritor en streaming. La importación usa el mismo paquete para leer (ADR-011). PDF de ficha individual (S) con plantilla HTML renderizada en el servidor (evaluar `@react-pdf/renderer` o Playwright; decidir con ADR).
- Los números del tablero y los reportes salen de las mismas funciones de consulta.
- M8b (ADR-018): los reportes estándar (`apps/api/src/reports`) agregan en SQL sobre `classificationCtes` y arman su Excel en memoria (son pequeños). La exportación completa (`apps/api/src/export`) sí va en streaming: un `.xlsx` por entidad con el escritor en streaming de `exceljs`, dentro de un ZIP que escribe un módulo propio (`zip-writer.ts`, DEFLATE con descriptor de datos, sin dependencias), leyendo por bloques de 2.000 filas en una transacción `REPEATABLE READ READ ONLY` con un candado global. El PDF de la ficha pasa a M19.

## 8. Copias de seguridad (BAK-01)
- Contenedor de respaldo con `pg_dump` en formato custom, diario a las 02:00 (hora Colombia), cifrado con `age` o GPG, subido a almacenamiento S3-compatible externo (Backblaze B2, Cloudflare R2 o similar).
- Retención 7/4/6 (diarios/semanales/mensuales).
- Script `scripts/restore.sh` documentado en `docs/operacion.md`; restauración probada antes de producción y cada trimestre.

## 9. Entornos y configuración

| Entorno | Base de datos | Notas |
|---|---|---|
| local | Postgres en Docker (`docker compose up -d db`) | Seed demo. |
| test | Base efímera por ejecución de pruebas | Migraciones aplicadas al iniciar. |
| producción | Postgres en el VPS (volumen persistente) o administrado | HTTPS con Caddy; respaldos activos. |

Variables (`.env.example`): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `CORS_ORIGINS`, `APP_TIMEZONE=America/Bogota`, `SEED_TODAY` (solo el seed; la API la ignora), `CLOCK_FIXED_TODAY` (fecha fija del `Clock` de la API, solo para pruebas; con `NODE_ENV=production` la API no arranca si está definida, ADR-010), `S3_*` (respaldos, fotos), `PUBLIC_WEB_URL` (para URLs de QR y, desde M10a, enlaces de los correos y retorno de Google).

Variables nuevas por la validación con ganaderos (09 §5):

| Variable | Hito | Por defecto | Uso |
|---|---|---|---|
| `REFRESH_TTL_DAYS` | M4d | 30 | Días que dura la sesión desde el último uso (AUT-10). |
| `REFRESH_MAX_AGE_DAYS` | M4d | 180 [Validar] | Tope absoluto por familia de sesión (AUT-10). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | M10a | — | Servidor de correo saliente (AUT-12). En desarrollo, Mailpit de `docker-compose.yml`. Sin ellos, la API usa el `Mailer` en memoria y la web no ofrece «¿Olvidaste tu contraseña?». |
| `MAIL_FROM` | M10a | — | Remitente de los correos, del dominio propio con SPF, DKIM y DMARC. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | M10a | — | Acceso con Google (AUT-15). Sin ellos, el botón no aparece y los endpoints de Google responden 404. El URI de retorno registrado en Google es `${PUBLIC_WEB_URL}/api/v1/auth/google/callback`. |

## 10. Calidad y pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitarias de dominio | Vitest en `packages/shared` | Edad, clasificación, fecha de parto, reparto de gastos, validación RFID, formato. Cobertura ≥ 80 %. |
| Integración de API | Jest (por defecto en NestJS) + Supertest contra Postgres real de prueba | Casos de uso, transacciones, reglas RN, autorización por rol y aislamiento por finca. |
| Componentes web | Vitest + Testing Library | Formularios críticos (parto, vacunación masiva). |
| E2E web | Playwright + axe-core | Flujos CU-01 a CU-04 y accesibilidad. |
| Rendimiento | Seed de carga + medición de endpoints | RNF-01. |

CI (GitHub Actions): instalar → lint → typecheck → pruebas unitarias → pruebas de integración con servicio Postgres → build. Ningún merge a `main` con CI en rojo.

## 11. Observabilidad
- Logs estructurados JSON (pino) con `requestId`, `userId`, `farmId`; sin datos sensibles (contraseñas, tokens).
- Endpoint `GET /health` (API + base de datos).
- Registro de errores no controlados (Sentry u otro, opcional).

## 12. Configuración de Claude Code en el repositorio
- `CLAUDE.md` en la raíz: contexto y reglas permanentes.
- `.claude/settings.json` (compartido en git): permisos que permiten sin preguntar los comandos habituales (`pnpm lint`, `pnpm test …`, `pnpm typecheck`, `pnpm db:*`, `git status/diff/log`) y **niegan** leer `.env` y ejecutar comandos destructivos (`git push --force`, `rm -rf`, `prisma migrate reset` fuera de desarrollo).
- Hooks:
  - `PostToolUse` sobre `Edit|Write`: `.claude/hooks/format.sh` formatea con Prettier el archivo editado y ejecuta ESLint sobre él; si ESLint falla, devuelve el error a Claude para que lo corrija.
  - `PreToolUse` sobre `Edit|Write`: `.claude/hooks/protect.sh` bloquea (exit 2) escrituras en `.env*`, en migraciones ya versionadas en git (una recién generada, sin commit, sí se puede ajustar) y en `docs/referencia/` salvo que el hito lo indique. Falla cerrado: si `jq` no está instalado, bloquea toda edición y pide instalarlo.
  - `format.sh` termina sin error si todavía no existe `node_modules` (antes de M0.1) y, sin `jq`, solo avisa.
- `.claude/settings.local.json` (ignorado en git) para preferencias personales.
- Referencia oficial: https://code.claude.com/docs/en/hooks y https://code.claude.com/docs/en/settings

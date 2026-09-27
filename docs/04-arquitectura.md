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
| ADR-08 | Móvil (F2): React Native con Expo + SQLite local | Flutter; PWA | Reutiliza TypeScript, `shared` y el cliente de API. Bluetooth y cámara nativos fiables en Android (una PWA no tiene Web Bluetooth en iOS). |
| ADR-09 | Escritorio (F3): Tauri empaquetando la web | Electron | Binarios mucho más livianos; la web ya es una SPA. |
| ADR-10 | Autenticación propia con JWT de acceso (15 min) + refresh token rotado (30 días) | Proveedor externo (Auth0, Clerk) | Sin costo por usuario, funciona sin correo electrónico y es un contenido evaluable del proyecto académico. |
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
│   ├── mobile/                 # F2 (Expo)
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
- Contraseñas: Argon2id. Política mínima: 8 caracteres.
- Límite de intentos: login 5 por 15 min por cuenta e IP; API general 300 peticiones/min por usuario.
- Cabeceras seguras (helmet), CORS restringido a los orígenes de los clientes.
- Variables de entorno validadas con zod al arrancar; la API no inicia si falta alguna.

## 6. Clientes

### Web (F1)
- TanStack Query para datos del servidor (caché, reintentos, invalidación tras mutaciones). Sin estado global adicional salvo sesión.
- Formularios con react-hook-form + resolvers de zod usando los esquemas de `shared`.
- Rutas protegidas por rol; el servidor sigue siendo la autoridad.
- Búsqueda global siempre accesible (atajo `/` en escritorio). Un lector RFID en modo teclado escribe en el campo con foco; además, un listener global detecta ráfagas de 15 dígitos + Enter escritas en menos de 100 ms y ejecuta la búsqueda aunque no haya foco en el campo.
- Borradores de formularios largos guardados en `sessionStorage` para no perder datos si se cae la conexión (RNF-16).

### Móvil (F2) — diseño anticipado
- Base local SQLite con las mismas entidades (subconjunto de columnas).
- Cola de salida: cada mutación local se guarda como operación con UUID propio (idempotencia) y se envía en lote.
- Endpoints de sincronización: `GET /sync/pull?since=<cursor>` devuelve cambios por entidad desde el cursor (basado en `updated_at`/`created_at` y tombstones); `POST /sync/push` recibe operaciones y responde por operación: aplicada, rechazada (con motivo) o en conflicto.
- Resolución (RN-24): eventos de solo adición sin conflicto; entidades editables con última escritura por registro y versión perdida en auditoría.
- Por qué se diseña ya: IDs UUIDv7 del cliente, `version`, `updated_at`, anulación en lugar de borrado y eventos de solo adición son prerrequisitos que en F1 no cuestan casi nada y evitan migraciones dolorosas después.

### Escritorio (F3)
- Tauri envolviendo el build de la web. Sin lógica propia salvo, si se requiere, acceso a puertos serie/USB para básculas.

## 7. Reportes y exportación
- Consultas agregadas en SQL (vistas o `$queryRaw` tipado) dentro del módulo `reports`.
- Excel con `exceljs` en streaming para listados grandes. PDF de ficha individual (S) con plantilla HTML renderizada en el servidor (evaluar `@react-pdf/renderer` o Playwright; decidir con ADR).
- Los números del tablero y los reportes salen de las mismas funciones de consulta.

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

Variables (`.env.example`): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `CORS_ORIGINS`, `APP_TIMEZONE=America/Bogota`, `SEED_TODAY` (solo desarrollo y pruebas), `S3_*` (respaldos, fotos), `PUBLIC_WEB_URL` (para URLs de QR).

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
  - `PreToolUse` sobre `Edit|Write`: `.claude/hooks/protect.sh` bloquea (exit 2) escrituras en `.env*`, en migraciones ya aplicadas (`apps/api/prisma/migrations/*` existentes) y en `docs/referencia/` salvo que el hito lo indique.
  - Los scripts terminan sin error si todavía no existe `node_modules` (antes de M0.1).
- `.claude/settings.local.json` (ignorado en git) para preferencias personales.
- Referencia oficial: https://code.claude.com/docs/en/hooks y https://code.claude.com/docs/en/settings

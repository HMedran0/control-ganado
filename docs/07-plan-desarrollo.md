# Plan de desarrollo con Claude Code

## 1. Cómo usar este plan
Cada hito es una o varias sesiones de Claude Code. Una sesión = un hito o una parte de él, nunca varios hitos a la vez. Al iniciar cada sesión:
1. Claude Code lee `CLAUDE.md` (automático) y los documentos que el hito indica.
2. Se pide un **plan** antes de tocar archivos (modo plan) y se revisa.
3. Se implementa con pruebas, se ejecuta la verificación del hito y se hace commit.
4. Si una decisión cambia, se actualiza el documento correspondiente o se crea un ADR en el mismo commit.

Plantilla de solicitud por sesión:
```
Vamos a implementar el hito M<N>: <nombre>.
Lee docs/07-plan-desarrollo.md (hito M<N>) y los documentos que indica.
Primero dame un plan con los archivos que vas a crear o cambiar y las pruebas que vas a escribir.
No avances al siguiente hito. Al terminar, ejecuta la verificación del hito y resume qué quedó pendiente.
```

## 2. Definición de terminado (aplica a todo hito)
- [ ] Cumple los criterios de aceptación (CA) de los requisitos listados.
- [ ] Reglas de negocio implementadas en `packages/shared/src/domain` cuando son lógica pura, con pruebas unitarias.
- [ ] Pruebas de integración de API para cada endpoint nuevo, incluidas autorización por rol y aislamiento por finca.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` en verde.
- [ ] Textos de interfaz en español según `06-ux-ui.md` §7.
- [ ] Sin `any` injustificado, sin `console.log`, sin secretos.
- [ ] Documentación actualizada si algo cambió respecto a lo especificado.
- [ ] Commits pequeños con Conventional Commits (`feat(animals): ...`).

## 2.1 Núcleo y datos de referencia
- **Núcleo** (debe estar para el piloto): M0–M6 (M4 en cuatro partes, M4a a M4d), M8 y M10a. **Completo:** M7 (finanzas), M9 (jornadas web), M9b (control de leche) y M10b (endurecimiento y despliegue). M10b es obligatorio antes de cargar datos reales.
- M9b se hace solo si el cronograma lo permite antes del piloto; si no, pasa a la fase 2. Si hay que recortar M10a, lo primero que pasa a la fase 2 es AUT-15 (Google); AUT-12 a AUT-14 no se recortan (09 §6).
- Toda regla de dominio sale del SRS, de `08-dominio-y-finca-referencia.md` o de `09-ampliacion-validacion-ganaderos.md`. Los datos de prueba y el seed reproducen la finca de referencia ficticia (08 §3), con `SEED_TODAY` fijo para que las pruebas afirmen cifras exactas.

## 3. Fase 0 — Cimientos

**M0.1 Monorepo y herramientas**
Leer: `04-arquitectura.md` §2–3, §9–10.
- pnpm workspaces, Turborepo, `packages/config` (tsconfig estricto, ESLint, Prettier).
- `docker-compose.yml` con PostgreSQL 16.
- Scripts raíz: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`, `db:reset`.
- CI en GitHub Actions (lint, typecheck, test con servicio Postgres, build).
Verificación: `pnpm install && pnpm lint && pnpm typecheck` en limpio; CI verde con un test de ejemplo.

**M0.2 Paquete shared: base**
Leer: `03-modelo-datos.md` §1, `04-arquitectura.md` §3, `08-dominio-y-finca-referencia.md` §1–2.
- `id.ts` (UUIDv7), enums del dominio, formato es-CO (fecha, moneda, peso, edad), catálogo de códigos de error.
- Funciones de dominio con pruebas: `ageInMonths`, `formatAge`, `managementCategory`, `derivedTags` (incluye Horra), `expectedCalvingDate` (gestación por raza), `vaccineStatus` (los cuatro tipos de programación), `nextCalfCode` (patrón `{YY}-{NNN}`), `icaAgeGroup`, `allocateExpense` (reparto exacto con residuo), `isValidRfid`, `normalizeIdentifier`.
Verificación: cobertura ≥ 90 % en `domain/`; casos borde (29 de febrero, cambio de mes, residuo de centavos, 1 animal, 0 animales → error).

**M0.3 API base y base de datos**
Leer: `03-modelo-datos.md` completo, `docs/referencia/*`, `04-arquitectura.md` §4, `08-dominio-y-finca-referencia.md` §3 (datos del seed).
- NestJS con Fastify, módulo Prisma, esquema desde `referencia/schema.prisma` y `referencia/prisma.config.ts` (validado con Prisma 7), migración manual SQL.
- `common/`: FarmScope, RolesGuard, filtro de errores problem+json, AuditInterceptor, Clock, paginación por cursor, validación zod.
- Seed demo (`03-modelo-datos.md` §6). Endpoint `/health`.
Verificación: `pnpm db:reset` crea todo y carga el seed; prueba de integración de `/health`.

## 4. Fase 1 — MVP web

**M1 Autenticación y usuarios** — AUT-01 a AUT-04. Leer `04-arquitectura.md` §5, `05-api.md` (Autenticación, Usuarios).
Verificación: pruebas de login, bloqueo por intentos, rotación y reutilización de refresh token, último ADMIN no desactivable.

**M2 Web base y sistema de diseño** — Leer `06-ux-ui.md` completo.
- Vite + React + TanStack Router/Query, cliente de API, sesión, rutas protegidas, layout responsive (barra inferior / lateral).
- Tokens, fuentes, componentes de §6 (Chapeta, SearchBar, QuestionRow, Tag, SegmentedChoice, DateQuickPick, NumberField, UndoToast, ConnectionBanner, EmptyState).
- Página de muestra de componentes (`/dev/ui`, solo en desarrollo).
Verificación: axe sin violaciones en la página de componentes; login funcional contra la API.

**M3 Catálogos y configuración** — CFG-01, CFG-02, SAN-01.

**M4 Animales e identificadores** — ANI-01 a ANI-11, IDN-01 a IDN-03, IDN-06, CLS-01 a CLS-03, AUD-01 (consulta por animal), AUT-10 y AUT-11. Se hace en cuatro partes:

- **M4a API de animales** (hecho): listado con filtros, búsqueda (pg_trgm + coincidencia exacta), ficha, alta, edición, operaciones en lote, identificadores y clasificación en SQL (ADR-009). Verificación: equivalencia SQL ↔ shared sobre el seed; rendimiento de búsqueda y listado con el seed de carga (RNF-01).
- **M4b Pantallas web de animales** (hecho): búsqueda en el layout y con el lector, listado con filtros en la URL, ficha con pestañas, formulario e identificadores. Verificación: E2E "crear animal, buscarlo por chip, ver ficha" en móvil y escritorio, con axe.
- **M4c Numeración reutilizable, salidas y archivo** — ANI-10, ANI-11, IDN-06 y RN-30 a RN-33 (09 §2); ANI-03 (archivar y restaurar), ANI-04 (salida y reversión), CLS-03 y `GET /audit` (AUD-01 CA2). Segunda finca de pruebas con numeración reutilizable ("Finca El Retiro", 08 §3.5). Verificación: en El Retiro un número reutilizado no mezcla historiales (ANI-11 CA4); DIN y RFID nunca se liberan (RN-32); revertir una salida cuyo código ya tiene otro animal responde `CODE_REASSIGNED`.
- **M4d Importación, exportación, QR y sesiones** — ANI-09 (**importación desde Excel con `exceljs`, simulación primero**), exportación del listado a Excel (ANI-06 CA4), IDN-03 (QR y hoja de etiquetas), AUT-10 (sesión deslizante) y AUT-11 (sesiones activas). Leer ADR-007 decisión 6. La importación verifica cada código con `assertCodeAvailable` (`apps/api/src/animals/code-availability.ts`, M4c), el mismo candado y la misma regla de unicidad normalizada (RN-30, RN-31) que el registro, la edición, la reversión y la restauración: no se escribe otra verificación. Verificación: importar la plantilla de referencia produce 11 animales creados y 1 fila con error esperado (fila 13: madre macho); una sesión renovada a diario no vence a los 30 días y sí al cumplir `REFRESH_MAX_AGE_DAYS`; cerrar una sesión desde Mi cuenta revoca solo esa familia.

**M5 Reproducción y nacimientos** — REP-01 a REP-05, NAC-01. Leer RN-02 a RN-08, RN-14, RN-15, RN-23 y CU-01.
Verificación: E2E de CU-01 (incluye mellizos y cría muerta al nacer); prueba de que la transacción de parto es atómica (forzar fallo en la segunda cría → nada se guarda).

**M6 Sanidad y pesos** — SAN-01 a SAN-06, PES-01, PES-02, PES-04 (importar la sesión de la báscula) y PES-05 (ganancia de peso y alertas en la ficha y el listado). Leer RN-12, RN-13, RN-22, RN-26, 08 §1.5 y 09 §3.
Verificación: pruebas de alertas con Clock fijado para los cuatro tipos de programación (ciclo en curso y cerrado, ventana de edad de brucelosis y fuera de edad, intervalo vencido y próximo, anulada no cuenta); brucelosis en macho rechazada; el seed reporta 14 terneras pendientes de brucelosis; importar un archivo de báscula de ejemplo asocia las filas por RFID y por chapeta, avisa duplicados y pesos atípicos, y deja los chips desconocidos para asociar o descartar.

**M7 Finanzas** — ECO-01 a ECO-06. Leer RN-17, RN-18, RN-20.
Verificación: pruebas de que OPERATOR y VET reciben 403 en `/expenses` y no ven campos económicos en `/animals/:id`; suma exacta de asignaciones.

**M8 Tablero y reportes** — RPT-01 a RPT-03, BAK-02, reporte de grupos de edad ICA, CFG-03 (sistema productivo) con el tablero por sistema, PES-05 en el tablero y PES-06 (peso objetivo de venta). Leer §5.1 de UX, 08 §2.2 y 09 §4.1.
Verificación: los números del tablero coinciden con los listados filtrados (prueba que compara ambos); tablero < 2 s con seed de carga; cambiar el sistema productivo cambia las preguntas destacadas, no los datos (CFG-03 CA1).

**M9 Jornadas de manejo (web)** — JOR-01 a JOR-03, CU-02. Soporte de lector en modo teclado. Incluye la jornada de pesaje con lector y peso digitado, que reutiliza las alertas de PES-05.
Verificación: E2E de una jornada de 5 animales con vacuna y peso; lectura simulada de ráfaga de 15 dígitos.

**M9b Control de leche** (nuevo) — LEC-01 a LEC-05, RN-34 a RN-37, etiquetas `LACTATING` y `DRIED_OFF` con su equivalente SQL en la prueba de ADR-009, seed de leche (08 §3.6). Leer 09 §4.2. Se hace si el cronograma lo permite antes del piloto; si no, pasa a la fase 2. La decisión se toma al terminar M9.
Verificación: jornada de ordeño de un lote; `NOT_LACTATING` en una novilla; leche en retiro marcada como no apta para la venta; un nuevo parto cierra la lactancia anterior (RN-37); las cifras de leche del seed coinciden con `expected.ts`.

**M10a Correo, invitación y acceso con Google** (nuevo) — AUT-12 a AUT-15, política de privacidad y términos. Leer ADR-007 decisiones 7 y 8, 05 («Autenticación» y «Usuarios y finca») y 06 §5.9 a §5.11. La decisión de dejar AUT-15 (Google) para la fase 2 se toma al empezar M10a.
- `Mailer` con SMTP; en desarrollo y pruebas, en memoria o Mailpit. Nunca se envía correo real desde las pruebas.
- Invitación, verificación de correo y recuperación de contraseña con enlaces de un solo uso cuyo token viaja en el fragmento de la URL, nunca en la query string.
- Google con OpenID Connect, código de autorización y PKCE del lado del servidor.
Verificación: una invitación se acepta una sola vez y vence a los 7 días; la recuperación responde igual exista o no la cuenta y revoca las sesiones; ningún token aparece en la query string ni en los logs; Google no crea cuentas ni fincas (`GOOGLE_NO_ACCESS`); sin `GOOGLE_*` el botón no aparece; el login con contraseña de una cuenta sin `password_hash` (solo Google) responde el mismo error y en un tiempo comparable al de una contraseña equivocada (prueba que compara los tiempos de los dos casos, ADR-007 decisión 8).

**M10b Endurecimiento y despliegue** — BAK-01, RNF-06 a RNF-10.
- Docker Compose de producción con Caddy, respaldos cifrados, script de restauración, `docs/operacion.md`.
- Revisión de seguridad (checklist ASVS L1), límites de peticiones, cabeceras, dominio de correo con SPF, DKIM y DMARC.
Verificación: simulacro de restauración documentado; Lighthouse ≥ 90 en rendimiento y accesibilidad.

**M11 Validación con usuarios** — RNF-03. Prueba con al menos 3 usuarios de la finca; ajustes registrados en `docs/ux-hallazgos.md`.

## 5. Fase 2 — App móvil sin conexión
M12 Endpoints de sincronización (SYN-01) · M13 App Expo: autenticación (con el inicio nativo de Google, AUT-15), base local, pull/push · M14 Ficha, búsqueda y registros sin conexión · M15 Jornada móvil + lector RFID Bluetooth (IDN-04) + báscula Bluetooth (PES-03; requiere conocer el modelo del indicador de la finca piloto) · M16 Ordeño sin conexión (LEC-06) · M17 OCR de chapeta (IDN-05, opcional).

## 6. Fase 3 — Escritorio y extras
M18 Empaquetado Tauri y báscula por puerto serie (PES-07) · M19 PDF de ficha individual y reportes avanzados.

## 7. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Supuestos del dominio distintos en la finca real | Decisiones documentadas en 08 con su origen; todo lo [Ficticio] vive en configuración y seed, y se valida con la finca antes del piloto. |
| La finca no adopta el sistema | Prototipo y prueba temprana (M2 + M11); cargar inventario inicial por importación desde Excel (agregar como mejora si la finca tiene hojas de cálculo). |
| Deriva del código respecto a la especificación en sesiones largas de IA | Una sesión por hito, plan previo, pruebas como contrato, revisión de diffs, documentos actualizados en el mismo commit. |
| Errores de fecha por zona horaria | Tipo `date` para fechas de negocio y servicio Clock. |
| Pérdida de datos | Respaldos probados, borrado lógico, auditoría. |
| La báscula de la finca no exporta archivos o usa un protocolo cerrado | PES-04 importa desde la web el CSV o Excel del indicador; la conexión directa (PES-03) espera a conocer marca y modelo (09 §6, preguntas pendientes). |
| Los correos de invitación o recuperación caen en spam | Dominio propio con SPF, DKIM y DMARC (M10b); quien no tiene correo sigue con usuario y contraseña temporal (AUT-04 CA2). |

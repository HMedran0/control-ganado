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
- **Núcleo** (debe estar para el piloto): M0–M6 y M8. **Completo:** M7 (finanzas), M9 (jornadas web), M10. M10 es obligatorio antes de cargar datos reales.
- Toda regla de dominio sale del SRS o de `08-dominio-y-finca-referencia.md`. Los datos de prueba y el seed reproducen la finca de referencia ficticia (08 §3), con `SEED_TODAY` fijo para que las pruebas afirmen cifras exactas.

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

**M4 Animales e identificadores** — ANI-01 a ANI-09, IDN-01 a IDN-03, CLS-01 a CLS-03, AUD-01 (consulta por animal).
Orden sugerido: API de animales → búsqueda (pg_trgm + coincidencia exacta) → listado y filtros → ficha (Resumen, Genealogía, Historial) → formulario → identificadores y reemplazo → **importación desde Excel (con `exceljs`, simulación primero)** → QR → salida y archivo.
Verificación adicional: importar la plantilla de referencia produce 11 animales creados y 1 fila con error esperado (fila 13: madre macho).
Verificación: E2E "crear animal, buscarlo por chip, ver ficha"; prueba de rendimiento de búsqueda con seed de carga.

**M5 Reproducción y nacimientos** — REP-01 a REP-05, NAC-01. Leer RN-02 a RN-08, RN-14, RN-15, RN-23 y CU-01.
Verificación: E2E de CU-01 (incluye mellizos y cría muerta al nacer); prueba de que la transacción de parto es atómica (forzar fallo en la segunda cría → nada se guarda).

**M6 Sanidad y pesos** — SAN-01 a SAN-06, PES-01, PES-02. Leer RN-12, RN-13, RN-22, RN-26 y 08 §1.5.
Verificación: pruebas de alertas con Clock fijado para los cuatro tipos de programación (ciclo en curso y cerrado, ventana de edad de brucelosis y fuera de edad, intervalo vencido y próximo, anulada no cuenta); brucelosis en macho rechazada; el seed reporta 14 terneras pendientes de brucelosis.

**M7 Finanzas** — ECO-01 a ECO-06. Leer RN-17, RN-18, RN-20.
Verificación: pruebas de que OPERATOR y VET reciben 403 en `/expenses` y no ven campos económicos en `/animals/:id`; suma exacta de asignaciones.

**M8 Tablero y reportes** — RPT-01 a RPT-03, BAK-02, reporte de grupos de edad ICA. Leer §5.1 de UX y 08 §2.2.
Verificación: los números del tablero coinciden con los listados filtrados (prueba que compara ambos); tablero < 2 s con seed de carga.

**M9 Jornadas de manejo (web)** — JOR-01 a JOR-03, CU-02. Soporte de lector en modo teclado.
Verificación: E2E de una jornada de 5 animales con vacuna y peso; lectura simulada de ráfaga de 15 dígitos.

**M10 Endurecimiento y despliegue** — BAK-01, RNF-06 a RNF-10.
- Docker Compose de producción con Caddy, respaldos cifrados, script de restauración, `docs/operacion.md`.
- Revisión de seguridad (checklist ASVS L1), límites de peticiones, cabeceras.
Verificación: simulacro de restauración documentado; Lighthouse ≥ 90 en rendimiento y accesibilidad.

**M11 Validación con usuarios** — RNF-03. Prueba con al menos 3 usuarios de la finca; ajustes registrados en `docs/ux-hallazgos.md`.

## 5. Fase 2 — App móvil sin conexión
M12 Endpoints de sincronización (SYN-01) · M13 App Expo: autenticación, base local, pull/push · M14 Ficha, búsqueda y registros sin conexión · M15 Jornada móvil + lector RFID Bluetooth (IDN-04) · M16 OCR de chapeta (IDN-05, opcional).

## 6. Fase 3 — Escritorio y extras
M17 Empaquetado Tauri · M18 Báscula Bluetooth/serial (PES-03) · M19 PDF de ficha individual y reportes avanzados.

## 7. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Supuestos del dominio distintos en la finca real | Decisiones documentadas en 08 con su origen; todo lo [Ficticio] vive en configuración y seed, y se valida con la finca antes del piloto. |
| La finca no adopta el sistema | Prototipo y prueba temprana (M2 + M11); cargar inventario inicial por importación desde Excel (agregar como mejora si la finca tiene hojas de cálculo). |
| Deriva del código respecto a la especificación en sesiones largas de IA | Una sesión por hito, plan previo, pruebas como contrato, revisión de diffs, documentos actualizados en el mismo commit. |
| Errores de fecha por zona horaria | Tipo `date` para fechas de negocio y servicio Clock. |
| Pérdida de datos | Respaldos probados, borrado lógico, auditoría. |

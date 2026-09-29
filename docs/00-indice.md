# Índice de documentación

| Documento | Contenido | Para quién |
|---|---|---|
| `../CLAUDE.md` | Contexto y reglas que Claude Code carga en cada sesión | Claude Code |
| `01-srs.md` | Requisitos funcionales y no funcionales, reglas de negocio, casos de uso, glosario | Cliente, equipo, evaluación académica |
| `03-modelo-datos.md` | Entidades, convenciones, índices, consultas derivadas, seed | Desarrollo |
| `referencia/schema.prisma` | Esquema Prisma **inicial**: punto de partida de M0.3, no se actualiza. El esquema vigente es `apps/api/prisma/schema.prisma` y sus migraciones | Desarrollo |
| `referencia/prisma.config.ts` | Configuración de Prisma 7 (conexión, migraciones, seed) | Desarrollo |
| `referencia/migracion-manual.sql` | Índices parciales, pg_trgm y restricciones CHECK **iniciales**. Las vigentes están en las migraciones de `apps/api/prisma/migrations/` | Desarrollo |
| `04-arquitectura.md` | Contexto, ADRs, monorepo, capas, seguridad, sincronización, respaldos, pruebas | Desarrollo, evaluación académica |
| `05-api.md` | Contrato REST | Desarrollo |
| `06-ux-ui.md` | Personas, principios, identidad visual, navegación, wireframes, componentes, redacción | Diseño, desarrollo |
| `07-plan-desarrollo.md` | Hitos, definición de terminado, riesgos, alcance núcleo | Desarrollo con Claude Code |
| `08-dominio-y-finca-referencia.md` | Decisiones de dominio sustentadas en fuentes reales y finca de referencia ficticia | Todos |
| `09-ampliacion-validacion-ganaderos.md` | Hallazgos de la validación con ganaderos (H1 a H4) y en qué hito entra cada uno. Integrado en 01 a 08; se conserva como registro del porqué de cada cambio | Todos, evaluación académica |
| `referencia/plantilla-importacion.xlsx` | Plantilla de importación **original**, con datos de ejemplo (la fila 13 tiene un error a propósito). Las pruebas la usan tal cual; la que descarga cada finca la genera la API con su catálogo (ANI-09, M4d) | Desarrollo, finca |
| `adr/` | Decisiones de arquitectura (ADR-001 a ADR-014): contexto, decisión y consecuencias | Desarrollo, evaluación académica |
| `adr/012-escrituras-listas-para-trabajar-sin-conexion.md` | ADR-012 (aceptada, desde M5): `id` del cliente, `Idempotency-Key`, `version`, anulación idempotente y `updated_at` por trigger, para la sincronización de la fase 2 | Desarrollo |
| `adr/013-limites-por-plan-en-un-solo-punto.md` | ADR-013 (aceptada, M5): `EntitlementsService` con el plan PILOT sin límites; `PLAN_LIMIT_REACHED` reservado | Desarrollo |
| `adr/014-tecnologia-de-la-app-movil.md` | ADR-014 (propuesta): Expo o Capacitor, decidido con una prueba de cada una antes de la fase 2 | Desarrollo |
| `../.claude/` | Permisos y hooks de Claude Code | Claude Code |

**Referencia original y esquema vigente.** Todo `docs/referencia/` (esquema, configuración de Prisma, migración manual, plantilla y prototipo) es la especificación de partida tal como se escribió: no se actualiza y el hook `protect.sh` impide editarla. El modelo de datos vigente está en `apps/api/prisma/schema.prisma` (y `apps/api/prisma/migrations/`); `03-modelo-datos.md` se mantiene al día con él.

Numeración: el `02` queda reservado para `02-investigacion.md` (resumen del proyecto de investigación y su relación con el software).

Cómo empezar:
1. Crear el repositorio vacío y copiar `CLAUDE.md`, `.claude/` y `docs/` en la raíz.
2. Revisar `08-dominio-y-finca-referencia.md`: lo marcado [Ficticio] se reemplaza al validar con la finca real (solo configuración y seed). Instalar `jq` para los hooks.
3. Abrir Claude Code en el repositorio y pedir el hito M0.1 con la plantilla de `07-plan-desarrollo.md` §1.

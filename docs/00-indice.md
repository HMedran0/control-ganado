# Índice de documentación

| Documento | Contenido | Para quién |
|---|---|---|
| `../CLAUDE.md` | Contexto y reglas que Claude Code carga en cada sesión | Claude Code |
| `01-srs.md` | Requisitos funcionales y no funcionales, reglas de negocio, casos de uso, glosario | Cliente, equipo, evaluación académica |
| `03-modelo-datos.md` | Entidades, convenciones, índices, consultas derivadas, seed | Desarrollo |
| `referencia/schema.prisma` | Esquema Prisma **inicial**: punto de partida de M0.3, no se actualiza. El esquema vigente es `apps/api/prisma/schema.prisma` y sus migraciones | Desarrollo |
| `referencia/prisma.config.ts` | Configuración de Prisma 7 (conexión, migraciones, seed) | Desarrollo |
| `referencia/migracion-manual.sql` | Índices parciales, pg_trgm y restricciones CHECK | Desarrollo |
| `04-arquitectura.md` | Contexto, ADRs, monorepo, capas, seguridad, sincronización, respaldos, pruebas | Desarrollo, evaluación académica |
| `05-api.md` | Contrato REST | Desarrollo |
| `06-ux-ui.md` | Personas, principios, identidad visual, navegación, wireframes, componentes, redacción | Diseño, desarrollo |
| `07-plan-desarrollo.md` | Hitos, definición de terminado, riesgos, alcance núcleo | Desarrollo con Claude Code |
| `08-dominio-y-finca-referencia.md` | Decisiones de dominio sustentadas en fuentes reales y finca de referencia ficticia | Todos |
| `referencia/plantilla-importacion.xlsx` | Plantilla de importación del inventario con datos de ejemplo | Desarrollo, finca |
| `../.claude/` | Permisos y hooks de Claude Code | Claude Code |

**Esquema vigente.** `docs/referencia/` guarda la especificación de partida tal como se escribió y el hook `protect.sh` impide editarla. El modelo de datos vigente está en `apps/api/prisma/schema.prisma` (y `apps/api/prisma/migrations/`); `03-modelo-datos.md` se mantiene al día con él.

Numeración: el `02` queda reservado para `02-investigacion.md` (resumen del proyecto de investigación y su relación con el software).

Cómo empezar:
1. Crear el repositorio vacío y copiar `CLAUDE.md`, `.claude/` y `docs/` en la raíz.
2. Revisar `08-dominio-y-finca-referencia.md`: lo marcado [Ficticio] se reemplaza al validar con la finca real (solo configuración y seed). Instalar `jq` para los hooks.
3. Abrir Claude Code en el repositorio y pedir el hito M0.1 con la plantilla de `07-plan-desarrollo.md` §1.

/**
 * Las sesiones de la aplicación (API y seed) trabajan en UTC. El adaptador de Prisma envía y lee
 * las columnas `timestamptz` sin desfase: con la sesión en otra zona (el contenedor usa
 * `PGTZ=America/Bogota`), PostgreSQL las interpretaba en la hora de Bogotá y guardaba cinco horas
 * de más, y lo que genera la base (`now()` en el trigger `set_updated_at()`, ADR-012) se leía
 * cinco horas antes. Las fechas de negocio son `date` y no dependen de esto (ADR-002).
 *
 * Archivo aparte, sin NestJS, porque el seed lo importa con el borrado de tipos de Node, que no
 * admite decoradores (ADR-006).
 */
export const SESSION_OPTIONS = '-c TimeZone=UTC';

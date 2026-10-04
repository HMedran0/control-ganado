/**
 * Paquete compartido entre la API, la web (F1), el móvil (F2) y el escritorio (F3).
 *
 * Contiene solo lógica pura: fechas de negocio, enums del dominio, formato es-CO, catálogo de
 * errores y las reglas de negocio de `domain/`. Sin acceso a base de datos, sin frameworks y
 * sin APIs exclusivas de Node (ADR-003).
 */

export * from './date.js';
export * from './domain/index.js';
export * from './enums.js';
export * from './errors.js';
export * from './format/index.js';
export * from './id.js';
export * from './money.js';
export * from './schemas/alerts.js';
export * from './schemas/animals.js';
export * from './schemas/audit.js';
export * from './schemas/auth.js';
export * from './schemas/catalogs.js';
export * from './schemas/farm-settings.js';
export * from './schemas/health.js';
export * from './schemas/imports.js';
export * from './schemas/offline.js';
export * from './schemas/reproduction.js';
export * from './schemas/weights.js';

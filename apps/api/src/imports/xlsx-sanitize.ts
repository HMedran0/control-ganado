import { posix } from 'node:path';

import type { ZipEntry } from './zip-guard.js';

/**
 * Prepara las partes de un `.xlsx` para `exceljs` 4.4, que solo abre bien los libros tal como
 * los escribe Excel (ADR-011). Se aplica sobre las entradas que `zip-guard` ya descomprimió y
 * midió, antes de volver a empaquetarlas.
 *
 * - **Rutas absolutas en las relaciones.** El estándar OPC permite `Target="/xl/…"` además de la
 *   ruta relativa a la carpeta de la parte; openpyxl (con el que se armó la plantilla de
 *   referencia) y otras herramientas usan la absoluta, y `exceljs` solo entiende la relativa.
 * - **Comentarios de celda.** `exceljs` solo los reconoce en `xl/commentsN.xml` y se cae con
 *   cualquier otra ubicación (openpyxl los guarda en `xl/comments/`). La importación solo lee
 *   valores, así que los comentarios, sus dibujos VML y sus relaciones se quitan.
 */
export function sanitizeForExcelJs(entries: readonly ZipEntry[]): ZipEntry[] {
  return relativizeRelationships(stripComments(entries));
}

const COMMENT_PART = /^xl\/(comments[^/]*\.xml|comments\/.*|threadedComments\/.*|persons\/.*)$/i;
const COMMENT_RELATIONSHIP = /Type\s*=\s*"[^"]*\/(comments|vmlDrawing|threadedComment|person)"/i;

/** Quita los comentarios de celda, sus dibujos VML y todo lo que los enlaza. */
export function stripComments(entries: readonly ZipEntry[]): ZipEntry[] {
  return entries
    .filter((entry) => !COMMENT_PART.test(entry.name) && !entry.name.toLowerCase().endsWith('.vml'))
    .map((entry) => {
      if (entry.name.endsWith('.rels')) {
        return replaceText(entry, (xml) =>
          xml.replace(/<Relationship\b[^>]*\/>/g, (tag) =>
            COMMENT_RELATIONSHIP.test(tag) ? '' : tag,
          ),
        );
      }
      if (/^xl\/worksheets\/[^/]+\.xml$/.test(entry.name)) {
        return replaceText(entry, (xml) => xml.replace(/<legacyDrawing\b[^>]*\/>/g, ''));
      }
      return entry;
    });
}

/**
 * Reescribe los `Target` absolutos como relativos a la carpeta de la parte dueña de la relación.
 * Los externos (`TargetMode="External"`, hipervínculos) no se tocan.
 */
export function relativizeRelationships(entries: readonly ZipEntry[]): ZipEntry[] {
  return entries.map((entry) => {
    if (!entry.name.endsWith('.rels')) return entry;
    // La carpeta de la parte dueña: «xl/worksheets/_rels/sheet2.xml.rels» → «xl/worksheets».
    const owner = posix.dirname(posix.dirname(entry.name));
    const base = owner === '.' ? '' : owner;
    return replaceText(entry, (xml) =>
      xml.replace(/<Relationship\b[^>]*>/g, (tag) => {
        if (/TargetMode\s*=\s*"External"/i.test(tag)) return tag;
        return tag.replace(/Target\s*=\s*"\/([^"]*)"/, (_match, absolute: string) => {
          const relative = posix.relative(base, absolute);
          return `Target="${relative === '' ? absolute : relative}"`;
        });
      }),
    );
  });
}

function replaceText(entry: ZipEntry, change: (xml: string) => string): ZipEntry {
  const xml = entry.data.toString('utf8');
  const next = change(xml);
  return next === xml ? entry : { name: entry.name, data: Buffer.from(next, 'utf8') };
}

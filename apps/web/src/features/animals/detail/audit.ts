import {
  formatDate,
  isIsoDate,
  isoDateFromInstant,
  type AuditAction,
  type AuditChangeView,
  type AuditEntryView,
  type AuditValue,
  type IdentifierType,
} from '@hato/shared';

import {
  IDENTIFIER_TYPE_LABEL,
  identifierText,
  ORIGIN_LABEL,
  RETIRE_REASON_LABEL,
  SEX_LABEL,
} from '../labels';
import { EXIT_TYPE_LABEL, FIELD_LABEL } from './history';

/**
 * Redacción de la pestaña «Cambios» (AUD-01 CA2) en lenguaje de finca: qué pasó, quién y
 * cuándo, sin nombres de campos ni valores internos. La API ya cambió los ids por nombres y
 * nunca manda montos.
 */

const ACTION_LABEL: Readonly<Record<AuditAction, string>> = {
  CREATE: 'Registro',
  UPDATE: 'Cambio',
  ARCHIVE: 'Archivado',
  RESTORE: 'Restaurado',
  VOID: 'Anulación',
  EXIT: 'Salida',
  REVERT_EXIT: 'Salida revertida',
  LOGIN: 'Inicio de sesión',
  IMPORT: 'Importación',
  REVOKE_SESSIONS: 'Sesiones cerradas',
};

/** Campos que no son del formulario del animal: salida, archivo e identificadores. */
const EXTRA_FIELD_LABEL: Readonly<Record<string, string>> = {
  exitType: 'tipo de salida',
  exitDate: 'fecha de salida',
  exitReason: 'motivo de salida',
  reason: 'motivo',
  sale: 'venta registrada',
  withdrawalConfirmed: 'salida en retiro confirmada',
  releasedIdentifiers: 'chapetas liberadas',
  retiredIdentifiers: 'identificadores retirados',
  restoredIdentifiers: 'identificadores reactivados',
  notRestored: 'identificadores que siguen retirados',
  identifiers: 'identificadores',
  initialWeightKg: 'peso inicial (kg)',
  importFile: 'importado desde',
  importRow: 'fila del archivo',
  type: 'tipo',
  value: 'número',
  assignedAt: 'fecha de asignación',
  retiredAt: 'fecha de retiro',
  retireReason: 'motivo del retiro',
  password: 'contraseña',
};

const ENUM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sex: SEX_LABEL,
  origin: ORIGIN_LABEL,
  exitType: EXIT_TYPE_LABEL,
  type: IDENTIFIER_TYPE_LABEL,
  retireReason: RETIRE_REASON_LABEL,
};

const IDENTIFIER_LIST_FIELDS = new Set([
  'identifiers',
  'releasedIdentifiers',
  'retiredIdentifiers',
  'restoredIdentifiers',
  'notRestored',
]);

export function fieldLabel(field: string): string {
  const label = FIELD_LABEL[field] ?? EXTRA_FIELD_LABEL[field] ?? field;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** «VISUAL_TAG:5» → «Chapeta 5». */
function identifierLabel(text: string): string {
  const [type, ...rest] = text.split(':');
  const value = rest.join(':');
  if (type !== undefined && type in IDENTIFIER_TYPE_LABEL && value !== '') {
    return identifierText(type as IdentifierType, value);
  }
  return text;
}

/** Valor legible: «—» si no hay, «Sí»/«No», fechas en dd/mm/aaaa, enumeraciones en español. */
export function valueText(field: string, value: AuditValue): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return value.toLocaleString('es-CO');
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    const items: readonly string[] = value;
    return items
      .map((item) => (IDENTIFIER_LIST_FIELDS.has(field) ? identifierLabel(item) : item))
      .join(', ');
  }
  const text = value as string;
  const labels = ENUM_LABELS[field];
  if (labels !== undefined && text in labels) return labels[text] ?? text;
  if (isIsoDate(text)) return formatDate(text);
  return text;
}

/** Una línea por cambio: «Lote: — → Levante», o solo el valor nuevo en un registro. */
export function changeText(change: AuditChangeView): string {
  const label = fieldLabel(change.field);
  if (change.field === 'password') return 'Cambió la contraseña';
  if (change.field === 'tagIds') {
    const tags = tagChanges(change);
    if (tags !== null) return tags;
  }
  const after = valueText(change.field, change.after);
  if (change.before === null) return `${label}: ${after}`;
  return `${label}: ${valueText(change.field, change.before)} → ${after}`;
}

/**
 * Etiquetas manuales: «Agregó la etiqueta Cotero · Quitó la etiqueta Descarte». La API ya cambió
 * los ids por los nombres. Quitar una etiqueta no borra nada (ADR-012): queda aquí.
 */
function tagChanges(change: AuditChangeView): string | null {
  const list = (value: AuditValue): readonly string[] | null =>
    value === null ? [] : Array.isArray(value) ? (value as readonly string[]) : null;
  const before = list(change.before);
  const after = list(change.after);
  if (before === null || after === null) return null;
  const parts = [
    ...after.filter((tag) => !before.includes(tag)).map((tag) => `Agregó la etiqueta ${tag}`),
    ...before.filter((tag) => !after.includes(tag)).map((tag) => `Quitó la etiqueta ${tag}`),
  ];
  return parts.length === 0 ? null : parts.join(' · ');
}

/** «Salida · animal 5», «Cambio · chapeta 5». */
export function entryTitle(entry: AuditEntryView): string {
  const action = ACTION_LABEL[entry.action];
  const what =
    entry.entity === 'Identifier'
      ? `identificador ${entry.entityLabel ?? ''}`.trim()
      : `animal ${entry.entityLabel ?? ''}`.trim();
  return `${action} · ${what}`;
}

/** «25/09/2026, 7:00 a. m. · Álvaro Pérez» en la hora de la finca. */
export function entryMeta(entry: AuditEntryView, timeZone: string): string {
  const instant = new Date(entry.at);
  const date = formatDate(isoDateFromInstant(instant, timeZone));
  const time = new Intl.DateTimeFormat('es-CO', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
  return `${date}, ${time} · ${entry.user?.name ?? 'Sistema'}`;
}

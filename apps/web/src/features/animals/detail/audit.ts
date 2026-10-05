import {
  formatDate,
  formatDecimalEsCo,
  formatWeight,
  isIsoDate,
  isoDateFromInstant,
  type AuditAction,
  type AuditChangeView,
  type AuditEntity,
  type AuditEntryView,
  type AuditValue,
  type IdentifierType,
} from '@hato/shared';

import { CALVING_TYPE_LABEL, OUTCOME_LABEL, SERVICE_METHOD_LABEL } from '../../reproduction/labels';
import { IDENTIFIED_BY_LABEL, WEIGHT_METHOD_LABEL } from '../../weights/labels';
import {
  IDENTIFIER_TYPE_LABEL,
  identifierText,
  ORIGIN_LABEL,
  RETIRE_REASON_LABEL,
  SEX_LABEL,
} from '../labels';
import { EXIT_TYPE_LABEL, FIELD_LABEL } from './history';

/**
 * Redacción de la pestaña «Cambios» (AUD-01 CA2) en lenguaje de finca: cada entrada es una
 * frase con quién, qué hizo y sobre qué («Wilmer anuló la vacuna Aftosa del 12/05/2026»), y
 * debajo los campos que cambiaron, sin nombres de campos ni valores internos. La API ya cambió
 * los ids por nombres y nunca manda montos.
 */

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
  // Eventos de M5 y M6 (desde M7).
  vaccineId: 'vacuna',
  appliedOn: 'fecha de aplicación',
  cycleId: 'ciclo oficial',
  nextDueOn: 'próxima dosis',
  bulk: 'vacunación por lote',
  startedOn: 'inicio',
  medication: 'medicamento',
  withdrawalUntil: 'retiro hasta',
  meatWithdrawalUntil: 'retiro de carne hasta',
  milkWithdrawalUntil: 'retiro de leche hasta',
  weighedOn: 'fecha del pesaje',
  weightKg: 'peso (kg)',
  method: 'método',
  identifiedBy: 'identificado por',
  outlier: 'peso atípico',
  serviceDate: 'fecha de servicio',
  serviceDateEstimated: 'servicio estimado',
  confirmedAt: 'confirmada el',
  diagnosisResponsible: 'quién palpó',
  diagnosisNotes: 'observaciones de la palpación',
  expectedCalvingDate: 'parto estimado',
  expectedCalvingManual: 'parto estimado corregido a mano',
  outcome: 'desenlace',
  outcomeDate: 'fecha del desenlace',
  calvingType: 'tipo de parto',
  stillbornCount: 'crías muertas al nacer',
  responsible: 'responsable',
  fileFormat: 'formato del archivo',
  columnMapping: 'columnas',
  sourceTemplateKey: 'plantilla',
  fileName: 'archivo',
  created: 'registros creados',
};

/** El mismo campo con otro sentido según la entidad: `method` de la preñez o del pesaje. */
const FIELD_LABEL_BY_ENTITY: Partial<Record<AuditEntity, Readonly<Record<string, string>>>> = {
  Pregnancy: { method: 'tipo de servicio' },
};

const ENUM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sex: SEX_LABEL,
  origin: ORIGIN_LABEL,
  exitType: EXIT_TYPE_LABEL,
  type: IDENTIFIER_TYPE_LABEL,
  retireReason: RETIRE_REASON_LABEL,
  outcome: OUTCOME_LABEL,
  calvingType: CALVING_TYPE_LABEL,
  identifiedBy: IDENTIFIED_BY_LABEL,
};

const ENUM_LABELS_BY_ENTITY: Partial<
  Record<AuditEntity, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = {
  Pregnancy: { method: SERVICE_METHOD_LABEL },
  WeightRecord: { method: WEIGHT_METHOD_LABEL },
};

const IDENTIFIER_LIST_FIELDS = new Set([
  'identifiers',
  'releasedIdentifiers',
  'retiredIdentifiers',
  'restoredIdentifiers',
  'notRestored',
]);

export function fieldLabel(field: string, entity?: AuditEntity): string {
  const byEntity = entity === undefined ? undefined : FIELD_LABEL_BY_ENTITY[entity]?.[field];
  const label = byEntity ?? FIELD_LABEL[field] ?? EXTRA_FIELD_LABEL[field] ?? field;
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
export function valueText(field: string, value: AuditValue, entity?: AuditEntity): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return formatDecimalEsCo(String(value), 2, true);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    const items: readonly string[] = value;
    return items
      .map((item) => (IDENTIFIER_LIST_FIELDS.has(field) ? identifierLabel(item) : item))
      .join(', ');
  }
  const text = value as string;
  const labels =
    (entity === undefined ? undefined : ENUM_LABELS_BY_ENTITY[entity]?.[field]) ??
    ENUM_LABELS[field];
  if (labels !== undefined && text in labels) return labels[text] ?? text;
  if (isIsoDate(text)) return formatDate(text);
  return text;
}

/** Una línea por cambio: «Lote: — → Levante», o solo el valor nuevo en un registro. */
export function changeText(change: AuditChangeView, entity?: AuditEntity): string {
  const label = fieldLabel(change.field, entity);
  if (change.field === 'password') return 'Cambió la contraseña';
  if (change.field === 'tagIds') {
    const tags = tagChanges(change);
    if (tags !== null) return tags;
  }
  const after = valueText(change.field, change.after, entity);
  if (change.before === null) return `${label}: ${after}`;
  return `${label}: ${valueText(change.field, change.before, entity)} → ${after}`;
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

/** Qué hizo, en pasado y en tercera persona. */
const ACTION_VERB: Readonly<Record<AuditAction, string>> = {
  CREATE: 'registró',
  UPDATE: 'cambió',
  ARCHIVE: 'archivó',
  RESTORE: 'restauró',
  VOID: 'anuló',
  EXIT: 'registró la salida de',
  REVERT_EXIT: 'revirtió la salida de',
  LOGIN: 'inició sesión en',
  IMPORT: 'importó',
  REVOKE_SESSIONS: 'cerró las sesiones de',
};

/** Una preñez que cambia de desenlace es un parto, un aborto o una palpación vacía. */
const OUTCOME_VERB: Readonly<Record<string, string>> = {
  CALVED: 'registró el parto de',
  ABORTED: 'registró el aborto de',
  FAILED: 'registró la palpación vacía de',
};

/** « del 12/05/2026», o nada si el registro no tiene fecha de negocio. */
function onDate(entry: AuditEntryView): string {
  return entry.entityDate === null ? '' : ` del ${formatDate(entry.entityDate)}`;
}

/** Sobre qué: «el animal 5», «la vacuna Aftosa del 12/05/2026», «el pesaje de 320,5 kg…». */
export function entrySubject(entry: AuditEntryView): string {
  const label = entry.entityLabel ?? '';
  switch (entry.entity) {
    case 'Animal':
      return `el animal ${label}`.trim();
    case 'Identifier':
      return `el identificador ${label}`.trim();
    case 'VaccinationRecord':
      return `la vacuna ${label}${onDate(entry)}`;
    case 'TreatmentRecord':
      return `el tratamiento con ${label}${onDate(entry)}`;
    case 'WeightRecord':
      return `el pesaje${label === '' ? '' : ` de ${formatWeight(label)}`}${onDate(entry)}`;
    case 'Pregnancy':
      return `la preñez${entry.entityDate === null ? '' : ` con servicio del ${formatDate(entry.entityDate)}`}`;
    case 'ScaleProfile':
      return `el perfil de báscula ${label}`.trim();
    case 'ImportBatch':
      return `el archivo ${label}`.trim();
    case 'Breed':
      return `la raza ${label}`.trim();
    case 'Lot':
      return `el lote ${label}`.trim();
    case 'Tag':
      return `la etiqueta ${label}`.trim();
    case 'Vaccine':
      return `la vacuna ${label}`.trim();
    case 'VaccinationCycle':
      return `el ciclo ${label}`.trim();
    case 'Farm':
      return `la finca ${label}`.trim();
    case 'User':
      return `el usuario ${label}`.trim();
  }
}

/** El verbo: en una preñez, el desenlace nuevo dice si fue un parto, un aborto o vacía. */
function entryVerb(entry: AuditEntryView): string {
  if (entry.entity === 'Pregnancy' && entry.action === 'UPDATE') {
    const outcome = entry.changes.find((change) => change.field === 'outcome')?.after;
    if (typeof outcome === 'string' && outcome in OUTCOME_VERB) return OUTCOME_VERB[outcome] ?? '';
  }
  return ACTION_VERB[entry.action];
}

/** Motivo de una anulación, que va en la frase y no en la lista de cambios. */
function voidReason(entry: AuditEntryView): string | null {
  if (entry.action !== 'VOID') return null;
  const reason = entry.changes.find((change) => change.field === 'reason')?.after;
  return typeof reason === 'string' && reason !== '' ? reason : null;
}

/**
 * La entrada como una frase: «Wilmer anuló la vacuna Aftosa del 12/05/2026 · motivo: Era otra
 * vaca», «Álvaro registró la salida del animal 5».
 */
export function entryTitle(entry: AuditEntryView): string {
  const who = entry.user?.name ?? 'El sistema';
  const sentence = `${who} ${entryVerb(entry)} ${entrySubject(entry)}`.replace(/ de el /g, ' del ');
  const reason = voidReason(entry);
  return reason === null ? sentence : `${sentence} · motivo: ${reason}`;
}

/** Los cambios que se listan debajo de la frase: el motivo de una anulación ya va en ella. */
export function entryChanges(entry: AuditEntryView): readonly AuditChangeView[] {
  return voidReason(entry) === null
    ? entry.changes
    : entry.changes.filter((change) => change.field !== 'reason');
}

/** «25/09/2026, 7:00 a. m.» en la hora de la finca. */
export function entryMeta(entry: AuditEntryView, timeZone: string): string {
  const instant = new Date(entry.at);
  const date = formatDate(isoDateFromInstant(instant, timeZone));
  const time = new Intl.DateTimeFormat('es-CO', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
  return `${date}, ${time}`;
}

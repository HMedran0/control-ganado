/**
 * Importación de la sesión de pesaje de la báscula (PES-04, M6; 09 §3).
 *
 * Reglas puras, en dos pasos con la base en medio, como la importación del inventario (ADR-011):
 *
 * 1. leer el archivo con un **mapeo de columnas** (perfil de la finca o plantilla del sistema) y
 *    convertir cada fila: chip, número visual, peso en kilos (las libras se convierten), fecha;
 * 2. con lo que la API averiguó (animales activos por chip, chapeta y código, y sus pesajes),
 *    **asociar** cada fila a un animal y armar el plan: asociadas, chips desconocidos, repetidos
 *    del mismo día (se conserva el último) y pesos atípicos (PES-01).
 *
 * La simulación y la confirmación corren las mismas funciones; la confirmación, dentro de la
 * transacción que escribe.
 */

import { daysBetween, type IsoDate } from '../date.js';
import { SCALE_FILE_FORMAT, SCALE_UNIT, type ScaleFileFormat, type ScaleUnit } from '../enums.js';
import { WARNING_CATALOG, warning, type Warning } from '../errors.js';
import { formatDate } from '../format/date.js';
import {
  cellText,
  isEmptyCell,
  parseEsCoDate,
  parseEsCoDecimal,
  type ParseResult,
  type SheetCell,
} from '../format/parse.js';
import { formatWeight } from '../format/weight.js';
import { normalizeAnimalCode } from './codes.js';
import { isValidRfid, normalizeIdentifier, rfidPrefixIsCommon } from './identifiers.js';
import { isWeightOutlier, previousWeightFor, type WeightRecordLike } from './weights.js';

// ---------------------------------------------------------------------------------------------
// Mapeo de columnas y plantillas
// ---------------------------------------------------------------------------------------------

/** Orden de la fecha cuando viene como texto con barras. */
export const SCALE_DATE_FORMAT = {
  /** 15/09/2026 */
  DMY: 'DMY',
  /** 09/15/2026 */
  MDY: 'MDY',
  /** 2026-09-15 o 2026/09/15 */
  YMD: 'YMD',
} as const;
export type ScaleDateFormat = (typeof SCALE_DATE_FORMAT)[keyof typeof SCALE_DATE_FORMAT];

/**
 * Cómo leer el archivo de una báscula (`ScaleProfile.column_mapping`). Cada campo es la lista de
 * encabezados aceptados para esa columna, comparados sin mayúsculas, tildes ni signos: el primero
 * que aparezca en el archivo es el que se usa.
 */
export type ScaleColumnMapping = {
  /** Chip (EID, RFID). */
  readonly eid: readonly string[];
  /** Número visual (VID, chapeta). */
  readonly visualId: readonly string[];
  /** Peso. Obligatorio. */
  readonly weight: readonly string[];
  /** Fecha (puede traer la hora pegada). Sin columna, la fecha la elige la persona. */
  readonly date: readonly string[];
  /** Hora, si viene aparte. Solo se muestra. */
  readonly time: readonly string[];
  readonly dateFormat: ScaleDateFormat;
  /** Unidad del peso: las libras se convierten a kilos al importar (redondeo a 0,1 kg). */
  readonly unit: ScaleUnit;
};

/** Plantilla del sistema: igual para todas las fincas y versionada (03 §2.5). */
export type ScaleTemplate = {
  readonly key: string;
  readonly name: string;
  readonly version: number;
  /** Provisional hasta confirmar sus columnas con un archivo real de la finca piloto. */
  readonly provisional: boolean;
  readonly fileFormat: ScaleFileFormat;
  readonly columnMapping: ScaleColumnMapping;
};

/**
 * **Tru-Test (Datamars)**, XR5000, ID5000 y S3, archivo exportado por USB o por la app del
 * fabricante. **Provisional** (09 v1.4): los encabezados son los que documentan los manuales en
 * inglés y sus traducciones habituales; se confirman con un archivo real de la finca piloto. Lo que
 * falta confirmar está en 05-api.md («Pesos y lotes», PES-04).
 */
export const TRU_TEST_TEMPLATE: ScaleTemplate = {
  key: 'tru-test',
  name: 'Tru-Test (XR5000, ID5000, S3)',
  version: 1,
  provisional: true,
  fileFormat: SCALE_FILE_FORMAT.CSV,
  columnMapping: {
    eid: ['EID', 'Electronic ID', 'Electronic Id', 'RFID', 'Chip', 'ID electrónico'],
    visualId: ['VID', 'Visual ID', 'Visual Id', 'ID visual', 'Número visual'],
    weight: ['Weight', 'Weight (kg)', 'Peso', 'Peso (kg)'],
    date: ['Date', 'Fecha'],
    time: ['Time', 'Hora'],
    dateFormat: SCALE_DATE_FORMAT.DMY,
    unit: SCALE_UNIT.KG,
  },
};

/** Plantillas del sistema (`GET /scale-profiles` las lista con `system: true`). */
export const SCALE_TEMPLATES: readonly ScaleTemplate[] = [TRU_TEST_TEMPLATE];

/** Plantilla del sistema por su clave; `null` si no existe. */
export function scaleTemplate(key: string): ScaleTemplate | null {
  return SCALE_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** Encabezado comparable: sin tildes, mayúsculas, signos ni espacios. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Encabezados que se reconocen sin perfil, para proponer el mapeo la primera vez (PES-04 CA1). */
const PROPOSAL_ALIASES = {
  eid: ['eid', 'electronicid', 'rfid', 'chip', 'tagid', 'idelectronico', 'chipid'],
  visualId: ['vid', 'visualid', 'idvisual', 'numerovisual', 'chapeta', 'arete', 'numero', 'codigo'],
  weight: ['weight', 'weightkg', 'peso', 'pesokg', 'kg', 'weightlb', 'weightlbs', 'pesolb', 'lb'],
  date: ['date', 'fecha', 'datetime', 'fechayhora', 'fechahora'],
  time: ['time', 'hora'],
} as const;

/** Columnas resueltas: índice de cada una en el archivo. */
export type ScaleColumns = {
  readonly eid: number | null;
  readonly visualId: number | null;
  readonly weight: number;
  readonly date: number | null;
  readonly time: number | null;
  /** Encabezado que se usó para cada columna, para mostrarlo en la simulación. */
  readonly headers: {
    readonly eid: string | null;
    readonly visualId: string | null;
    readonly weight: string;
    readonly date: string | null;
    readonly time: string | null;
  };
};

function findColumn(
  headers: readonly string[],
  accepted: readonly string[],
): { index: number; header: string } | null {
  const wanted = new Set(accepted.map(normalizeHeader));
  const index = headers.findIndex((header) => wanted.has(normalizeHeader(header)));
  const header = headers[index];
  return index === -1 || header === undefined ? null : { index, header };
}

/**
 * Columnas del archivo según el mapeo. Falla si no hay columna de peso, o si no hay ni chip ni
 * número visual (sin ellos no se puede asociar ninguna fila).
 */
export function resolveScaleColumns(
  headers: readonly string[],
  mapping: ScaleColumnMapping,
): ParseResult<ScaleColumns> {
  const weight = findColumn(headers, mapping.weight);
  const eid = findColumn(headers, mapping.eid);
  const visualId = findColumn(headers, mapping.visualId);
  const date = findColumn(headers, mapping.date);
  const time = findColumn(headers, mapping.time);
  const missing: string[] = [];
  if (weight === null) missing.push(`el peso (${mapping.weight.join(', ')})`);
  if (eid === null && visualId === null) {
    missing.push(
      `el chip o el número visual (${[...mapping.eid, ...mapping.visualId].join(', ')})`,
    );
  }
  if (weight === null || missing.length > 0) {
    return {
      ok: false,
      message: `No encontramos en el archivo la columna de ${missing.join(' ni la de ')}. Revisa el perfil de báscula.`,
    };
  }
  return {
    ok: true,
    value: {
      eid: eid?.index ?? null,
      visualId: visualId?.index ?? null,
      weight: weight.index,
      date: date?.index ?? null,
      time: time?.index ?? null,
      headers: {
        eid: eid?.header ?? null,
        visualId: visualId?.header ?? null,
        weight: weight.header,
        date: date?.header ?? null,
        time: time?.header ?? null,
      },
    },
  };
}

/**
 * Mapeo propuesto a partir de los encabezados (PES-04 CA1): la primera columna que se reconoce
 * para cada campo. Un encabezado de peso con «lb» propone libras. `null` si no hay peso o no hay
 * ni chip ni número visual.
 */
export function proposeScaleMapping(headers: readonly string[]): ScaleColumnMapping | null {
  const pick = (aliases: readonly string[]): string[] => {
    const set = new Set<string>(aliases);
    const found = headers.find((header) => set.has(normalizeHeader(header)));
    return found === undefined ? [] : [found];
  };
  const weight = pick(PROPOSAL_ALIASES.weight);
  const eid = pick(PROPOSAL_ALIASES.eid);
  const visualId = pick(PROPOSAL_ALIASES.visualId);
  if (weight.length === 0 || (eid.length === 0 && visualId.length === 0)) return null;
  const weightHeader = normalizeHeader(weight[0] ?? '');
  return {
    eid,
    visualId,
    weight,
    date: pick(PROPOSAL_ALIASES.date),
    time: pick(PROPOSAL_ALIASES.time),
    dateFormat: SCALE_DATE_FORMAT.DMY,
    unit: weightHeader.includes('lb') ? SCALE_UNIT.LB : SCALE_UNIT.KG,
  };
}

// ---------------------------------------------------------------------------------------------
// Lectura de filas
// ---------------------------------------------------------------------------------------------

/** Libras por kilo, exacto por definición (0,45359237 kg por libra). */
const KG_PER_LB_NUMERATOR = 45_359_237n;
const KG_PER_LB_DENOMINATOR = 100_000_000n;

/**
 * Libras a kilos redondeados a 0,1 kg (mitad hacia arriba), con enteros: el peso en centésimas
 * de libra por 0,45359237, llevado a décimas de kilo.
 */
export function lbToKg(pounds: number): number {
  const hundredthsLb = BigInt(Math.round(pounds * 100));
  // décimas de kg = libras/100 · 0,45359237 · 10
  const numerator = hundredthsLb * KG_PER_LB_NUMERATOR * 10n;
  const denominator = 100n * KG_PER_LB_DENOMINATOR;
  const tenths = (2n * numerator + denominator) / (2n * denominator);
  return Number(tenths) / 10;
}

const MDY_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const YMD_SLASH = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;

/** Fecha de la báscula: quita la hora pegada («15/09/2026 08:31:22») y aplica el orden. */
export function parseScaleDate(
  cell: SheetCell | undefined,
  format: ScaleDateFormat,
): ParseResult<IsoDate> {
  if (typeof cell === 'object' && cell !== null) return parseEsCoDate(cell);
  if (typeof cell === 'number') return parseEsCoDate(cell);
  const text = cellText(cell).replace(/[T\s].*$/, '');
  if (format === SCALE_DATE_FORMAT.MDY) {
    const match = MDY_PATTERN.exec(text);
    if (match !== null) return parseEsCoDate(`${match[2]}/${match[1]}/${match[3]}`);
  }
  if (format === SCALE_DATE_FORMAT.YMD) {
    const match = YMD_SLASH.exec(text);
    if (match !== null) {
      return parseEsCoDate(`${match[3]}/${match[2]}/${match[1]}`);
    }
  }
  return parseEsCoDate(text);
}

/** Fila del archivo ya leída. */
export type ScaleFileRow = {
  /** Número de fila como lo ve la persona (la de encabezados es la 1). */
  readonly row: number;
  /** Chip normalizado (15 dígitos), o `null` si la fila no trae. */
  readonly eid: string | null;
  /** Número visual tal como viene, o `null`. */
  readonly visualId: string | null;
  /** Peso en kilos, ya convertido si el archivo viene en libras. */
  readonly weightKg: number;
  /** Peso tal como viene en el archivo, en su unidad. */
  readonly originalWeight: number;
  /** Fecha de la fila, o la de la sesión si el archivo no la trae. */
  readonly date: IsoDate;
  readonly time: string | null;
};

/** Resultado de leer una fila. */
export type ScaleRowParse =
  | { readonly ok: true; readonly value: ScaleFileRow }
  | { readonly ok: false; readonly row: number; readonly message: string };

/** ¿La fila está vacía del todo? Las filas vacías se ignoran. */
export function isBlankScaleRow(cells: readonly (SheetCell | undefined)[]): boolean {
  return cells.every((cell) => isEmptyCell(cell));
}

/** Lee una fila con las columnas resueltas. `sessionDate` es la fecha si el archivo no la trae. */
export function parseScaleRow(input: {
  readonly cells: readonly (SheetCell | undefined)[];
  readonly row: number;
  readonly columns: ScaleColumns;
  readonly mapping: ScaleColumnMapping;
  readonly sessionDate: IsoDate;
}): ScaleRowParse {
  const { cells, row, columns, mapping } = input;
  const at = (index: number | null): SheetCell | undefined =>
    index === null ? undefined : cells[index];
  const fail = (message: string): ScaleRowParse => ({ ok: false, row, message });

  const rawEid = at(columns.eid);
  let eid: string | null = null;
  if (!isEmptyCell(rawEid)) {
    const normalized = normalizeIdentifier('RFID', cellText(rawEid)).replace(/\./g, '');
    if (!isValidRfid(normalized)) {
      return fail(`El chip «${cellText(rawEid)}» no tiene 15 dígitos.`);
    }
    eid = normalized;
  }
  const rawVisual = at(columns.visualId);
  const visualId = isEmptyCell(rawVisual) ? null : cellText(rawVisual);
  if (eid === null && visualId === null) return fail('La fila no trae chip ni número visual.');

  const weight = parseEsCoDecimal(at(columns.weight));
  if (!weight.ok) return fail(`Peso: ${weight.message}`);
  if (weight.value <= 0) return fail('El peso debe ser mayor que cero.');
  const weightKg =
    mapping.unit === SCALE_UNIT.LB ? lbToKg(weight.value) : Math.round(weight.value * 100) / 100;
  if (weightKg >= 2000) return fail('El peso debe ser menor de 2.000 kg.');

  let date = input.sessionDate;
  if (columns.date !== null) {
    const parsed = parseScaleDate(at(columns.date), mapping.dateFormat);
    if (!parsed.ok) return fail(`Fecha: ${parsed.message}`);
    date = parsed.value;
  }
  const rawTime = at(columns.time);
  const time = isEmptyCell(rawTime) ? null : cellText(rawTime);

  return {
    ok: true,
    value: { row, eid, visualId, weightKg, originalWeight: weight.value, date, time },
  };
}

// ---------------------------------------------------------------------------------------------
// Asociación y plan
// ---------------------------------------------------------------------------------------------

/** Cómo se asoció una fila a su animal (la simulación lo dice por fila). */
export const SCALE_MATCH_VIA = {
  /** Por el chip activo del animal. */
  RFID: 'RFID',
  /** Por una chapeta visual activa con el número visual de la fila. */
  VISUAL_TAG: 'VISUAL_TAG',
  /** Por el código interno (normalizado, RN-30) de un animal activo. */
  CODE: 'CODE',
  /** Chip desconocido que la persona asoció a mano (PES-04 CA3). */
  ASSOCIATED: 'ASSOCIATED',
} as const;
export type ScaleMatchVia = (typeof SCALE_MATCH_VIA)[keyof typeof SCALE_MATCH_VIA];

/** Animal activo de la finca, con lo que necesita la importación. */
export type ScaleAnimal = {
  readonly id: string;
  readonly code: string;
  readonly name: string | null;
  readonly birthDate: IsoDate;
  /** Chip activo del animal; `null` si no tiene. */
  readonly rfid: string | null;
  /** Pesajes del animal, anulados incluidos, para el aviso de atípico. */
  readonly weights: readonly WeightRecordLike[];
};

/** Lo que la API averiguó de la finca para asociar las filas. */
export type ScaleLookup = {
  /** Animales activos por chip activo. */
  readonly byRfid: ReadonlyMap<string, ScaleAnimal>;
  /** Animales activos por chapeta visual activa (valor normalizado). */
  readonly byVisualTag: ReadonlyMap<string, ScaleAnimal>;
  /** Animales activos por código normalizado (RN-30). */
  readonly byCode: ReadonlyMap<string, ScaleAnimal>;
  /** Animales que la persona eligió para chips desconocidos, por id. */
  readonly byId: ReadonlyMap<string, ScaleAnimal>;
};

/** Un chip desconocido asociado a mano (PES-04 CA3). */
export type ScaleAssociation = {
  readonly chip: string;
  readonly animalId: string;
  /** Guardar el chip como RFID del animal; pasa por `checkIdentifier` en la API. */
  readonly saveChip: boolean;
};

/** Estado de cada fila en el plan. */
export const SCALE_ROW_STATUS = {
  /** Se guarda. */
  MATCHED: 'MATCHED',
  /** Repetido del mismo animal el mismo día: no se guarda, se conserva el último. */
  DUPLICATE: 'DUPLICATE',
  /** Chip que no es de ningún animal activo, sin asociar todavía. */
  UNKNOWN_CHIP: 'UNKNOWN_CHIP',
  /** Chip desconocido que la persona decidió no importar. */
  SKIPPED: 'SKIPPED',
  /** La fila no se puede importar. */
  ERROR: 'ERROR',
} as const;
export type ScaleRowStatus = (typeof SCALE_ROW_STATUS)[keyof typeof SCALE_ROW_STATUS];

/** Una fila del plan, como la muestra la simulación. */
export type ScalePlanRow = {
  readonly row: number;
  readonly status: ScaleRowStatus;
  readonly eid: string | null;
  readonly visualId: string | null;
  readonly weightKg: number | null;
  readonly originalWeight: number | null;
  readonly date: IsoDate | null;
  readonly time: string | null;
  readonly animal: {
    readonly id: string;
    readonly code: string;
    readonly name: string | null;
  } | null;
  readonly via: ScaleMatchVia | null;
  /** Peso anterior con el que se comparó (PES-01 CA2). */
  readonly previousKg: number | null;
  readonly outlier: boolean;
  readonly message: string | null;
};

/** Pesaje que se va a crear. */
export type ScalePlanWeight = {
  readonly row: number;
  readonly animalId: string;
  readonly date: IsoDate;
  readonly weightKg: number;
  readonly outlier: boolean;
};

/** Chip desconocido: las filas que lo traen. */
export type UnknownChip = {
  readonly chip: string;
  readonly rows: readonly number[];
  readonly weightKg: number;
  readonly date: IsoDate;
  readonly visualId: string | null;
  /** Prefijo que no es 170 ni de fabricante (900 a 998): se advierte, no se bloquea (08 §1.6). */
  readonly uncommonPrefix: boolean;
};

/** Resultado de `planScaleImport`. */
export type ScaleImportPlan = {
  readonly rows: readonly ScalePlanRow[];
  readonly weights: readonly ScalePlanWeight[];
  readonly unknownChips: readonly UnknownChip[];
  /** Advertencias por animal repetido el mismo día (`SCALE_DUPLICATE_READING`). */
  readonly duplicateWarnings: readonly Warning[];
  readonly counts: {
    readonly matched: number;
    readonly unknownChips: number;
    readonly duplicates: number;
    readonly outliers: number;
    readonly errors: number;
    readonly skipped: number;
  };
};

/** Entrada de `planScaleImport`. */
export type ScaleImportPlanInput = {
  readonly rows: readonly ScaleRowParse[];
  readonly lookup: ScaleLookup;
  readonly associations: readonly ScaleAssociation[];
  /** Chips desconocidos que la persona decidió no importar (PES-04 CA3). */
  readonly skip: readonly string[];
  readonly today: IsoDate;
};

/** Número visual comparable con una chapeta guardada. */
export function normalizeVisualId(value: string): string {
  return normalizeIdentifier('VISUAL_TAG', value);
}

/** Código comparable (RN-30). */
export function normalizeScaleCode(value: string): string {
  return normalizeAnimalCode(value);
}

type Matched = {
  readonly parsed: ScaleFileRow;
  readonly animal: ScaleAnimal;
  readonly via: ScaleMatchVia;
};

function findAnimal(
  parsed: ScaleFileRow,
  input: ScaleImportPlanInput,
): { animal: ScaleAnimal; via: ScaleMatchVia } | null {
  const { lookup } = input;
  if (parsed.eid !== null) {
    const byChip = lookup.byRfid.get(parsed.eid);
    if (byChip !== undefined) return { animal: byChip, via: SCALE_MATCH_VIA.RFID };
    const association = input.associations.find((item) => item.chip === parsed.eid);
    const associated =
      association === undefined ? undefined : lookup.byId.get(association.animalId);
    if (associated !== undefined) return { animal: associated, via: SCALE_MATCH_VIA.ASSOCIATED };
  }
  if (parsed.visualId !== null) {
    const byTag = lookup.byVisualTag.get(normalizeVisualId(parsed.visualId));
    if (byTag !== undefined) return { animal: byTag, via: SCALE_MATCH_VIA.VISUAL_TAG };
    const byCode = lookup.byCode.get(normalizeScaleCode(parsed.visualId));
    if (byCode !== undefined) return { animal: byCode, via: SCALE_MATCH_VIA.CODE };
  }
  return null;
}

const ref = (animal: ScaleAnimal) => ({ id: animal.id, code: animal.code, name: animal.name });

function emptyRow(row: number): Omit<ScalePlanRow, 'status' | 'message'> {
  return {
    row,
    eid: null,
    visualId: null,
    weightKg: null,
    originalWeight: null,
    date: null,
    time: null,
    animal: null,
    via: null,
    previousKg: null,
    outlier: false,
  };
}

/**
 * Plan de la importación (PES-04 CA2 y CA3): asocia cada fila por chip y, si no, por chapeta y por
 * código; deja los chips desconocidos para asociar o descartar; conserva el último peso de un
 * animal repetido el mismo día y avisa; marca los atípicos frente al pesaje anterior (los de la
 * base y los del mismo archivo de días anteriores).
 */
export function planScaleImport(input: ScaleImportPlanInput): ScaleImportPlan {
  const skip = new Set(input.skip);
  const planRows = new Map<number, ScalePlanRow>();
  const matched: Matched[] = [];
  const unknown = new Map<string, UnknownChip>();

  for (const parse of input.rows) {
    if (!parse.ok) {
      planRows.set(parse.row, {
        ...emptyRow(parse.row),
        status: SCALE_ROW_STATUS.ERROR,
        message: parse.message,
      });
      continue;
    }
    const parsed = parse.value;
    const base = {
      ...emptyRow(parsed.row),
      eid: parsed.eid,
      visualId: parsed.visualId,
      weightKg: parsed.weightKg,
      originalWeight: parsed.originalWeight,
      date: parsed.date,
      time: parsed.time,
    };
    if (parsed.date > input.today) {
      planRows.set(parsed.row, {
        ...base,
        status: SCALE_ROW_STATUS.ERROR,
        message: 'La fecha no puede ser posterior a hoy.',
      });
      continue;
    }

    const found = findAnimal(parsed, input);
    if (found === null) {
      if (parsed.eid !== null && skip.has(parsed.eid)) {
        planRows.set(parsed.row, {
          ...base,
          status: SCALE_ROW_STATUS.SKIPPED,
          message: 'Chip desconocido: no se importa.',
        });
      } else if (parsed.eid !== null) {
        const current = unknown.get(parsed.eid);
        unknown.set(parsed.eid, {
          chip: parsed.eid,
          rows: [...(current?.rows ?? []), parsed.row],
          weightKg: parsed.weightKg,
          date: parsed.date,
          visualId: parsed.visualId,
          uncommonPrefix: !rfidPrefixIsCommon(parsed.eid),
        });
        planRows.set(parsed.row, {
          ...base,
          status: SCALE_ROW_STATUS.UNKNOWN_CHIP,
          message: rfidPrefixIsCommon(parsed.eid)
            ? 'Ningún animal activo tiene este chip. Asócialo a un animal o no lo importes.'
            : `Ningún animal activo tiene este chip. Asócialo a un animal o no lo importes. ${WARNING_CATALOG.RFID_UNCOMMON_PREFIX}`,
        });
      } else {
        planRows.set(parsed.row, {
          ...base,
          status: SCALE_ROW_STATUS.ERROR,
          message: `No encontramos un animal activo con el número ${parsed.visualId ?? ''}.`,
        });
      }
      continue;
    }

    if (parsed.date < found.animal.birthDate) {
      planRows.set(parsed.row, {
        ...base,
        animal: ref(found.animal),
        via: found.via,
        status: SCALE_ROW_STATUS.ERROR,
        message: 'La fecha es anterior al nacimiento del animal.',
      });
      continue;
    }
    matched.push({ parsed, animal: found.animal, via: found.via });
  }

  // Repetidos: el mismo animal el mismo día. Se conserva la última fila del archivo.
  const lastRowByKey = new Map<string, Matched>();
  const countByKey = new Map<string, number>();
  for (const item of matched) {
    const key = `${item.animal.id}:${item.parsed.date}`;
    lastRowByKey.set(key, item);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  const duplicateWarnings: Warning[] = [];
  for (const [key, kept] of lastRowByKey) {
    const count = countByKey.get(key) ?? 1;
    if (count > 1) {
      duplicateWarnings.push(
        warning('SCALE_DUPLICATE_READING', {
          code: kept.animal.code,
          count,
          date: formatDate(kept.parsed.date),
          weight: formatWeight(kept.parsed.weightKg, { unit: false }),
        }),
      );
    }
  }

  // Atípicos, en orden de fecha: frente al pesaje anterior de la base o del mismo archivo.
  const kept = [...lastRowByKey.values()].sort((a, b) =>
    a.parsed.date === b.parsed.date
      ? a.parsed.row - b.parsed.row
      : a.parsed.date < b.parsed.date
        ? -1
        : 1,
  );
  const fileWeights = new Map<string, WeightRecordLike[]>();
  const weights: ScalePlanWeight[] = [];
  for (const item of kept) {
    const own = fileWeights.get(item.animal.id) ?? [];
    const previous = previousWeightFor([...item.animal.weights, ...own], item.parsed.date);
    const outlier = previous !== null && isWeightOutlier(previous.weightKg, item.parsed.weightKg);
    weights.push({
      row: item.parsed.row,
      animalId: item.animal.id,
      date: item.parsed.date,
      weightKg: item.parsed.weightKg,
      outlier,
    });
    // Orden dentro del mismo día: el del archivo va después de los de la base.
    own.push({
      id: `ffffffff-ffff-7fff-bfff-${String(item.parsed.row).padStart(12, '0')}`,
      weighedOn: item.parsed.date,
      weightKg: item.parsed.weightKg,
      isBirthWeight: false,
      voided: false,
    });
    fileWeights.set(item.animal.id, own);
    planRows.set(item.parsed.row, {
      ...emptyRow(item.parsed.row),
      eid: item.parsed.eid,
      visualId: item.parsed.visualId,
      weightKg: item.parsed.weightKg,
      originalWeight: item.parsed.originalWeight,
      date: item.parsed.date,
      time: item.parsed.time,
      animal: ref(item.animal),
      via: item.via,
      previousKg: previous?.weightKg ?? null,
      outlier,
      status: SCALE_ROW_STATUS.MATCHED,
      message: outlier
        ? `El peso se aleja más del 30 % del anterior (${previous === null ? '' : formatWeight(previous.weightKg)}). Verifícalo.`
        : null,
    });
  }

  for (const item of matched) {
    if (planRows.has(item.parsed.row)) continue;
    const key = `${item.animal.id}:${item.parsed.date}`;
    const keptRow = lastRowByKey.get(key)?.parsed.row;
    planRows.set(item.parsed.row, {
      ...emptyRow(item.parsed.row),
      eid: item.parsed.eid,
      visualId: item.parsed.visualId,
      weightKg: item.parsed.weightKg,
      originalWeight: item.parsed.originalWeight,
      date: item.parsed.date,
      time: item.parsed.time,
      animal: ref(item.animal),
      via: item.via,
      status: SCALE_ROW_STATUS.DUPLICATE,
      message: `Repetido el mismo día: se conserva la fila ${keptRow ?? ''}.`,
    });
  }

  const rows = [...planRows.values()].sort((a, b) => a.row - b.row);
  const count = (status: ScaleRowStatus) => rows.filter((row) => row.status === status).length;
  return {
    rows,
    weights: weights.sort((a, b) => a.row - b.row),
    unknownChips: [...unknown.values()],
    duplicateWarnings,
    counts: {
      matched: count(SCALE_ROW_STATUS.MATCHED),
      unknownChips: unknown.size,
      duplicates: count(SCALE_ROW_STATUS.DUPLICATE),
      outliers: weights.filter((item) => item.outlier).length,
      errors: count(SCALE_ROW_STATUS.ERROR),
      skipped: count(SCALE_ROW_STATUS.SKIPPED),
    },
  };
}

/** Días entre la fecha más antigua y la más reciente del plan, para el resumen. */
export function planDateRange(
  plan: ScaleImportPlan,
): { readonly from: IsoDate; readonly to: IsoDate; readonly days: number } | null {
  const dates = plan.weights.map((item) => item.date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  if (from === undefined || to === undefined) return null;
  return { from, to, days: daysBetween(from, to) };
}

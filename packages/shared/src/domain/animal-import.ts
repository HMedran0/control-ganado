/**
 * Importación del inventario desde Excel o CSV (ANI-09, RN-29): reglas puras.
 *
 * La validación va en dos pasos, con las consultas a la base en medio (las hace la API):
 *
 * 1. `parseAnimalImportRows`: formato de cada celda, obligatorios, catálogos por nombre, reglas
 *    de la fila y duplicados **dentro del archivo** (código normalizado según RN-30,
 *    identificadores normalizados según IDN-01).
 * 2. La API agrega lo que solo sabe la base: si el código ya lo tiene otro animal (con la misma
 *    verificación que el registro, `assertCodeAvailable`) y si un identificador está ocupado.
 *    Lo entrega como `extraIssues`, junto con los animales de la finca por código.
 * 3. `resolveAnimalImport`: madre y padre por código, en el archivo o en la finca (dos pasadas,
 *    CA4), propagación de errores de la madre a la cría y el plan de escritura, con las madres
 *    antes que las crías.
 *
 * Nada de esto lanza: cada problema es un `ImportIssue` con su fila, su columna y un mensaje en
 * español listo para mostrar («Fila 13 · Código madre: la madre 012 es macho.»).
 */

import { addDays, compareIsoDates, isAfter, isBefore, type IsoDate } from '../date.js';
import {
  RFID_CARRIER,
  BREED_GROUP,
  IDENTIFIER_TYPE,
  ORIGIN,
  SEX,
  type BreedGroup,
  type IdentifierType,
  type RfidCarrier,
  type Origin,
  type Sex,
} from '../enums.js';
import { WARNING_CATALOG } from '../errors.js';
import { formatDate } from '../format/date.js';
import {
  cellText,
  isEmptyCell,
  parseEsCoDate,
  parseEsCoDecimal,
  parseNonNegativeInteger,
  parseYesNo,
  type SheetCell,
} from '../format/parse.js';
import { catalogNameKey, normalizeCatalogName } from '../schemas/catalogs.js';
import { monthsBetween } from './age.js';
import { cleanAnimalCode, normalizeAnimalCode } from './codes.js';
import { isValidRfid, normalizeIdentifier, rfidPrefixIsCommon } from './identifiers.js';
import { DEFAULT_GESTATION_DAYS_BY_GROUP, gestationDaysFor } from './pregnancy.js';

// ---------------------------------------------------------------------------------------------
// Límites y columnas
// ---------------------------------------------------------------------------------------------

/** Filas de datos por archivo (ANI-09 CA7). */
export const IMPORT_MAX_ROWS = 5000;
/** Tamaño máximo del archivo, en bytes. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** Columnas de la plantilla, en su orden. `required` = obligatoria (ANI-09 CA2). */
export const IMPORT_COLUMNS = [
  { key: 'code', label: 'Código', required: true },
  { key: 'name', label: 'Nombre', required: false },
  { key: 'sex', label: 'Sexo', required: true },
  { key: 'breed', label: 'Raza', required: true },
  { key: 'birthDate', label: 'Fecha de nacimiento', required: true },
  { key: 'birthDateEstimated', label: 'Fecha aproximada', required: false },
  { key: 'origin', label: 'Procedencia', required: false },
  { key: 'entryDate', label: 'Fecha de ingreso', required: false },
  { key: 'dam', label: 'Código madre', required: false },
  { key: 'sire', label: 'Padre (código o referencia)', required: false },
  { key: 'lot', label: 'Lote', required: false },
  { key: 'visualTag', label: 'Chapeta visual', required: false },
  { key: 'din', label: 'DIN', required: false },
  { key: 'rfid', label: 'RFID (15 dígitos)', required: false },
  { key: 'rfidCarrier', label: 'Dónde va el chip', required: false },
  { key: 'priorCalvings', label: 'Partos previos', required: false },
  { key: 'lastCalvingDate', label: 'Fecha último parto', required: false },
  { key: 'pregnant', label: 'Preñada', required: false },
  { key: 'serviceDate', label: 'Fecha de servicio', required: false },
  { key: 'lastWeightKg', label: 'Último peso (kg)', required: false },
  { key: 'lastWeightDate', label: 'Fecha último peso', required: false },
  { key: 'notes', label: 'Observaciones', required: false },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]['key'];

/** Nombre de la columna para los mensajes. */
export function importColumnLabel(key: ImportColumnKey): string {
  return IMPORT_COLUMNS.find((column) => column.key === key)?.label ?? key;
}

/**
 * Clave para reconocer un encabezado: sin tildes, sin asterisco, sin lo que va entre paréntesis
 * y en minúsculas. «Código*», «codigo» y «CÓDIGO» son la misma columna; «RFID (15 dígitos)» y
 * «RFID» también.
 */
export function importHeaderKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const HEADER_KEYS = new Map<string, ImportColumnKey>(
  IMPORT_COLUMNS.map((column) => [importHeaderKey(column.label), column.key]),
);

/** Resultado de reconocer la fila de encabezados. */
export type ImportHeaderMap = {
  /** Columna de la hoja (desde 0) → campo. Las columnas que no se reconocen se ignoran. */
  readonly columns: ReadonlyMap<number, ImportColumnKey>;
  /** Columnas obligatorias que faltan, con su nombre. */
  readonly missing: readonly string[];
  /** Columnas que aparecen dos veces. */
  readonly duplicated: readonly string[];
};

/** Reconoce los encabezados de la hoja, en cualquier orden (ANI-09 CA2). */
export function mapImportHeaders(headers: readonly SheetCell[]): ImportHeaderMap {
  const columns = new Map<number, ImportColumnKey>();
  const seen = new Set<ImportColumnKey>();
  const duplicated: string[] = [];
  headers.forEach((header, index) => {
    const key = HEADER_KEYS.get(importHeaderKey(cellText(header)));
    if (key === undefined) return;
    if (seen.has(key)) {
      duplicated.push(importColumnLabel(key));
      return;
    }
    seen.add(key);
    columns.set(index, key);
  });
  const missing = IMPORT_COLUMNS.filter((column) => column.required && !seen.has(column.key)).map(
    (column) => column.label,
  );
  return { columns, missing, duplicated };
}

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

/** Fila de datos del archivo: su número (como lo ve la persona en Excel) y sus celdas. */
export type ImportSourceRow = {
  readonly row: number;
  readonly cells: Partial<Record<ImportColumnKey, SheetCell>>;
};

export type ImportIssueSeverity = 'error' | 'warning';

/** Un problema de una fila. `column` es `null` si es de la fila entera. */
export type ImportIssue = {
  readonly row: number;
  readonly column: ImportColumnKey | null;
  readonly severity: ImportIssueSeverity;
  readonly message: string;
};

/** Catálogo y parámetros de la finca que necesita la validación. */
export type AnimalImportContext = {
  readonly today: IsoDate;
  readonly breeds: readonly {
    readonly id: string;
    readonly name: string;
    readonly gestationDays: number | null;
  }[];
  readonly lots: readonly { readonly id: string; readonly name: string }[];
  /** `settings.gestationDays`, para las razas sin gestación propia (RN-04). */
  readonly farmGestationDays: number;
  /** `settings.minBreedingAgeMonths`, para la advertencia `DAM_AGE_LOW` (RN-23). */
  readonly minBreedingAgeMonths: number;
  /** «Crear las razas que no existen» (ANI-09 CA2). */
  readonly createMissingBreeds: boolean;
};

/** Raza de una fila: una del catálogo o una que se creará al confirmar. */
export type ImportBreedRef =
  | { readonly kind: 'existing'; readonly id: string }
  | { readonly kind: 'new'; readonly name: string };

/** Grupo y gestación de las razas que crea la importación (Cruce, 08 §1.4). */
export const IMPORT_NEW_BREED_GROUP: BreedGroup = BREED_GROUP.CROSS;
export const IMPORT_NEW_BREED_GESTATION_DAYS = DEFAULT_GESTATION_DAYS_BY_GROUP[BREED_GROUP.CROSS];

/** Fila leída y validada por sí sola (paso 1). */
export type ParsedImportRow = {
  readonly row: number;
  /** Código limpio (sin espacios de borde) y normalizado; `null` si faltaba o no sirve. */
  readonly code: string | null;
  readonly codeKey: string | null;
  readonly name: string | null;
  readonly sex: Sex | null;
  readonly breed: ImportBreedRef | null;
  readonly birthDate: IsoDate | null;
  readonly birthDateEstimated: boolean;
  readonly origin: Origin;
  readonly entryDate: IsoDate | null;
  readonly entryDateEstimated: boolean;
  /** Código de la madre como se escribió, y normalizado. */
  readonly damCode: string | null;
  readonly sireText: string | null;
  readonly lotId: string | null;
  readonly identifiers: readonly {
    readonly type: IdentifierType;
    readonly value: string;
    /** Solo en el RFID: dónde va el chip (columna «Dónde va el chip»), o `null`. */
    readonly carrier?: RfidCarrier | null;
  }[];
  readonly importedPriorCalvings: number;
  readonly lastCalving: { readonly date: IsoDate; readonly serviceDate: IsoDate } | null;
  readonly pregnancy: {
    readonly serviceDate: IsoDate;
    readonly expectedCalvingDate: IsoDate;
  } | null;
  readonly lastWeight: {
    readonly weightKg: number;
    readonly weighedOn: IsoDate;
    readonly isBirthWeight: boolean;
  } | null;
  readonly notes: string | null;
  readonly issues: readonly ImportIssue[];
};

/** Resultado del paso 1. */
export type ParsedAnimalImport = {
  readonly rows: readonly ParsedImportRow[];
  /** Razas que no existen y que se crearían (con `createMissingBreeds`). */
  readonly newBreeds: readonly string[];
};

/** Animal de la finca, para resolver madre y padre por código. */
export type ImportFarmAnimal = {
  readonly id: string;
  readonly code: string;
  readonly sex: Sex;
  readonly birthDate: IsoDate;
};

/** Madre o padre: una fila del archivo o un animal de la finca. */
export type ImportParentRef =
  { readonly kind: 'file'; readonly row: number } | { readonly kind: 'farm'; readonly id: string };

/** Fila lista para escribir. */
export type ImportPlanRow = Omit<
  ParsedImportRow,
  | 'code'
  | 'codeKey'
  | 'sex'
  | 'breed'
  | 'birthDate'
  | 'entryDate'
  | 'issues'
  | 'damCode'
  | 'sireText'
> & {
  readonly code: string;
  readonly sex: Sex;
  readonly breed: ImportBreedRef;
  readonly birthDate: IsoDate;
  readonly entryDate: IsoDate;
  readonly dam: ImportParentRef | null;
  readonly sire: ImportParentRef | null;
  readonly sireExternalRef: string | null;
};

/** Resultado de la validación completa: la simulación y, al confirmar, lo que se escribe. */
export type AnimalImportResult = {
  readonly totalRows: number;
  /** Filas sin errores ni advertencias. */
  readonly validRows: number;
  /** Filas sin errores, con alguna advertencia (también se importan). */
  readonly warningRows: number;
  readonly errorRows: number;
  /** Todos los problemas, por fila y en orden de columna. */
  readonly issues: readonly ImportIssue[];
  /** Filas sin errores, en orden de escritura: toda madre del archivo antes que sus crías. */
  readonly plan: readonly ImportPlanRow[];
  readonly newBreeds: readonly string[];
};

// ---------------------------------------------------------------------------------------------
// Paso 1: cada fila por sí sola y los duplicados del archivo
// ---------------------------------------------------------------------------------------------

const SEX_WORDS: ReadonlyMap<string, Sex> = new Map([
  ['hembra', SEX.FEMALE],
  ['h', SEX.FEMALE],
  ['f', SEX.FEMALE],
  ['macho', SEX.MALE],
  ['m', SEX.MALE],
]);

const ORIGIN_WORDS: ReadonlyMap<string, Origin> = new Map([
  ['nacido en la finca', ORIGIN.BORN_ON_FARM],
  ['nacida en la finca', ORIGIN.BORN_ON_FARM],
  ['nacio en la finca', ORIGIN.BORN_ON_FARM],
  ['nacido', ORIGIN.BORN_ON_FARM],
  ['finca', ORIGIN.BORN_ON_FARM],
  ['comprado', ORIGIN.PURCHASED],
  ['comprada', ORIGIN.PURCHASED],
  ['compra', ORIGIN.PURCHASED],
]);

/** Límite razonable del peso de un bovino, en kg. */
const MAX_WEIGHT_KG = 2000;
/** Partos previos que tiene sentido declarar. */
const MAX_PRIOR_CALVINGS = 30;

/** Mensaje de la fecha de ingreso tomada del nacimiento (ajuste 5 del plan de M4d). */
export const ENTRY_DATE_FROM_BIRTH_WARNING =
  'Se tomó la fecha de nacimiento como fecha de ingreso; corrígela en la ficha si la conoces.';

/** Paso 1: lee y valida cada fila por sí sola, y marca los repetidos dentro del archivo. */
export function parseAnimalImportRows(
  rows: readonly ImportSourceRow[],
  context: AnimalImportContext,
): ParsedAnimalImport {
  const breedsByKey = new Map(context.breeds.map((breed) => [catalogNameKey(breed.name), breed]));
  const lotsByKey = new Map(context.lots.map((lot) => [catalogNameKey(lot.name), lot]));
  const newBreeds = new Map<string, string>();

  const parsed = rows.map((source) => parseRow(source, context, breedsByKey, lotsByKey, newBreeds));
  return { rows: markDuplicates(parsed), newBreeds: [...newBreeds.values()] };
}

function parseRow(
  source: ImportSourceRow,
  context: AnimalImportContext,
  breedsByKey: ReadonlyMap<string, AnimalImportContext['breeds'][number]>,
  lotsByKey: ReadonlyMap<string, AnimalImportContext['lots'][number]>,
  newBreeds: Map<string, string>,
): ParsedImportRow {
  const { row, cells } = source;
  const issues: ImportIssue[] = [];
  const error = (column: ImportColumnKey | null, message: string): void => {
    issues.push({ row, column, severity: 'error', message });
  };
  const warn = (column: ImportColumnKey | null, message: string): void => {
    issues.push({ row, column, severity: 'warning', message });
  };
  const text = (key: ImportColumnKey): string => cellText(cells[key]);
  const optionalText = (key: ImportColumnKey, max: number): string | null => {
    const value = text(key);
    if (value === '') return null;
    if (value.length > max) {
      error(key, `Es demasiado largo (máximo ${max} caracteres).`);
      return null;
    }
    return value;
  };
  /** Fecha opcional: `null` si está vacía o no sirve (con su error). */
  const optionalDate = (key: ImportColumnKey): IsoDate | null => {
    if (isEmptyCell(cells[key])) return null;
    const parsed = parseEsCoDate(cells[key]);
    if (!parsed.ok) {
      error(key, parsed.message);
      return null;
    }
    if (isAfter(parsed.value, context.today)) {
      error(key, 'La fecha no puede ser posterior a hoy.');
      return null;
    }
    return parsed.value;
  };

  // Código (RN-30: se compara normalizado).
  let code: string | null = null;
  let codeKey: string | null = null;
  const rawCode = cleanAnimalCode(text('code'));
  if (rawCode === '') error('code', 'Escribe el código del animal.');
  else if (rawCode.length > 30)
    error('code', 'El código es demasiado largo (máximo 30 caracteres).');
  else {
    code = rawCode;
    codeKey = normalizeAnimalCode(rawCode);
  }

  const name = optionalText('name', 80);

  // Sexo.
  let sex: Sex | null = null;
  const sexText = text('sex');
  if (sexText === '') error('sex', 'Indica el sexo: Hembra o Macho.');
  else {
    sex = SEX_WORDS.get(sexText.toLocaleLowerCase('es-CO')) ?? null;
    if (sex === null) error('sex', `«${sexText}» no es un sexo válido: escribe Hembra o Macho.`);
  }

  // Raza: por nombre, sin distinguir mayúsculas ni espacios sobrantes.
  let breed: ImportBreedRef | null = null;
  let breedGestationDays: number | null = null;
  const breedText = normalizeCatalogName(text('breed'));
  if (breedText === '') error('breed', 'Indica la raza.');
  else if (breedText.length > 80) error('breed', 'El nombre de la raza es demasiado largo.');
  else {
    const found = breedsByKey.get(catalogNameKey(breedText));
    if (found !== undefined) {
      breed = { kind: 'existing', id: found.id };
      breedGestationDays = found.gestationDays;
    } else if (context.createMissingBreeds) {
      const key = catalogNameKey(breedText);
      if (!newBreeds.has(key)) newBreeds.set(key, breedText);
      breed = { kind: 'new', name: newBreeds.get(key) ?? breedText };
      breedGestationDays = IMPORT_NEW_BREED_GESTATION_DAYS;
      warn('breed', `Se creará la raza «${breedText}» (grupo Cruce).`);
    } else {
      error(
        'breed',
        `La raza «${breedText}» no existe en el catálogo. Créala en Configuración → Razas o marca «Crear las razas que no existen».`,
      );
    }
  }

  // Nacimiento.
  let birthDate: IsoDate | null = null;
  if (isEmptyCell(cells.birthDate))
    error('birthDate', 'Escribe la fecha de nacimiento (dd/mm/aaaa).');
  else birthDate = optionalDate('birthDate');
  const estimated = parseYesNo(cells.birthDateEstimated);
  if (!estimated.ok) error('birthDateEstimated', estimated.message);
  const birthDateEstimated = estimated.ok && estimated.value;

  /** La fecha no puede ser anterior al nacimiento. */
  const notBeforeBirth = (key: ImportColumnKey, date: IsoDate | null, what: string): boolean => {
    if (date === null || birthDate === null) return date !== null;
    if (isBefore(date, birthDate)) {
      error(key, `${what} no puede ser anterior al nacimiento (${formatDate(birthDate)}).`);
      return false;
    }
    return true;
  };

  // Procedencia y fecha de ingreso (ADR-004: sin fecha, la de nacimiento, marcada como estimada).
  let origin: Origin = ORIGIN.BORN_ON_FARM;
  const originText = text('origin');
  if (originText !== '') {
    const key = originText.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const found = ORIGIN_WORDS.get(key);
    if (found === undefined) {
      error(
        'origin',
        `«${originText}» no es una procedencia válida: escribe Nacido en la finca o Comprado.`,
      );
    } else origin = found;
  }
  let entryDate: IsoDate | null = birthDate;
  let entryDateEstimated = false;
  const entryCell = optionalDate('entryDate');
  if (origin === ORIGIN.PURCHASED) {
    if (entryCell !== null) {
      entryDate = notBeforeBirth('entryDate', entryCell, 'La fecha de ingreso') ? entryCell : null;
    } else if (isEmptyCell(cells.entryDate) && birthDate !== null) {
      entryDateEstimated = true;
      warn('entryDate', ENTRY_DATE_FROM_BIRTH_WARNING);
    }
  } else if (entryCell !== null && birthDate !== null && entryCell !== birthDate) {
    warn(
      'entryDate',
      'Nació en la finca: su fecha de ingreso es la de nacimiento y se ignora la de esta columna.',
    );
  }

  // Madre y padre: se resuelven en el paso 3.
  const damText = cleanAnimalCode(text('dam'));
  const damCode = damText === '' ? null : damText;
  if (damCode !== null && codeKey !== null && normalizeAnimalCode(damCode) === codeKey) {
    error('dam', 'Un animal no puede ser su propia madre.');
  }
  const sireText = optionalText('sire', 80);

  // Lote: por nombre, entre los activos.
  let lotId: string | null = null;
  const lotText = normalizeCatalogName(text('lot'));
  if (lotText !== '') {
    const lot = lotsByKey.get(catalogNameKey(lotText));
    if (lot === undefined) {
      error('lot', `El lote «${lotText}» no existe. Créalo en Configuración → Lotes.`);
    } else lotId = lot.id;
  }

  // Identificadores (IDN-01).
  const identifiers: { type: IdentifierType; value: string; carrier?: RfidCarrier | null }[] = [];
  const visualTag = text('visualTag');
  if (visualTag !== '') {
    identifiers.push({
      type: IDENTIFIER_TYPE.VISUAL_TAG,
      value: normalizeIdentifier(IDENTIFIER_TYPE.VISUAL_TAG, visualTag),
    });
  }
  const din = text('din');
  if (din !== '')
    identifiers.push({
      type: IDENTIFIER_TYPE.DIN,
      value: normalizeIdentifier(IDENTIFIER_TYPE.DIN, din),
    });
  const rfidCell = cells.rfid;
  const rfid = normalizeIdentifier(IDENTIFIER_TYPE.RFID, text('rfid'));
  // Dónde va el chip: Arete, Inyectable, Bolo o vacío. Sin RFID en la fila, se avisa y se ignora.
  const carrierText = text('rfidCarrier');
  const carrier = carrierText === '' ? null : parseRfidCarrier(carrierText);
  if (carrierText !== '' && carrier === undefined) {
    error('rfidCarrier', 'Escribe Arete, Inyectable o Bolo, o deja la columna vacía.');
  } else if (carrierText !== '' && rfid === '') {
    warn('rfidCarrier', 'La fila no trae RFID: se ignora «Dónde va el chip».');
  }
  if (rfid !== '') {
    if (!isValidRfid(rfid)) {
      error(
        'rfid',
        typeof rfidCell === 'number' && rfid.length < 15
          ? `El RFID ${rfid} tiene menos de 15 dígitos: Excel le quitó los ceros iniciales. Escríbelo como texto.`
          : 'El código RFID debe tener exactamente 15 dígitos.',
      );
    } else {
      identifiers.push({ type: IDENTIFIER_TYPE.RFID, value: rfid, carrier: carrier ?? null });
      if (!rfidPrefixIsCommon(rfid)) {
        warn('rfid', WARNING_CATALOG.RFID_UNCOMMON_PREFIX);
      }
    }
  }

  // Partos previos (RN-29): el último con fecha se importa; los anteriores quedan como número.
  const gestation =
    breed === null
      ? null
      : gestationDaysFor({
          breedGestationDays: breedGestationDays,
          farmGestationDays: context.farmGestationDays,
        });
  let priorCalvings = 0;
  if (!isEmptyCell(cells.priorCalvings)) {
    const parsed = parseNonNegativeInteger(cells.priorCalvings);
    if (!parsed.ok) error('priorCalvings', parsed.message);
    else if (parsed.value > MAX_PRIOR_CALVINGS) {
      error('priorCalvings', `${parsed.value} partos no es un número posible.`);
    } else priorCalvings = parsed.value;
  }
  const lastCalvingDate = optionalDate('lastCalvingDate');
  if (lastCalvingDate !== null && isEmptyCell(cells.priorCalvings)) priorCalvings = 1;
  if (sex === SEX.MALE && priorCalvings > 0) {
    error('priorCalvings', 'Un macho no puede tener partos.');
  }
  let lastCalving: ParsedImportRow['lastCalving'] = null;
  if (lastCalvingDate !== null) {
    if (priorCalvings === 0) {
      error('priorCalvings', 'Con fecha de último parto, los partos previos deben ser al menos 1.');
    } else if (
      sex === SEX.FEMALE &&
      gestation !== null &&
      notBeforeBirth('lastCalvingDate', lastCalvingDate, 'El último parto')
    ) {
      const serviceDate = addDays(lastCalvingDate, -gestation);
      if (birthDate !== null && isBefore(serviceDate, birthDate)) {
        error(
          'lastCalvingDate',
          'La fecha del último parto no es posible para la edad del animal.',
        );
      } else lastCalving = { date: lastCalvingDate, serviceDate };
    }
  }
  const importedPriorCalvings =
    sex === SEX.FEMALE ? Math.max(0, priorCalvings - (lastCalving === null ? 0 : 1)) : 0;

  // Preñez abierta (CA6): confirmada, con la fecha de servicio indicada.
  let pregnancy: ParsedImportRow['pregnancy'] = null;
  const pregnant = parseYesNo(cells.pregnant);
  const serviceDate = optionalDate('serviceDate');
  if (!pregnant.ok) error('pregnant', pregnant.message);
  else if (pregnant.value) {
    if (sex === SEX.MALE) error('pregnant', 'Solo una hembra puede estar preñada.');
    else if (isEmptyCell(cells.serviceDate)) error('serviceDate', 'Indica la fecha de servicio.');
    else if (serviceDate !== null && gestation !== null && sex === SEX.FEMALE) {
      if (!notBeforeBirth('serviceDate', serviceDate, 'La fecha de servicio')) {
        // El error ya quedó registrado.
      } else if (lastCalving !== null && !isAfter(serviceDate, lastCalving.date)) {
        error('serviceDate', 'La fecha de servicio debe ser posterior al último parto.');
      } else {
        const expected = addDays(serviceDate, gestation);
        pregnancy = { serviceDate, expectedCalvingDate: expected };
        if (isBefore(expected, context.today)) {
          warn(
            'serviceDate',
            `El parto estimado (${formatDate(expected)}) ya pasó: revisa la fecha de servicio.`,
          );
        }
      }
    }
  } else if (serviceDate !== null) {
    warn('serviceDate', 'No está marcada como preñada: la fecha de servicio no se importa.');
  }

  // Último peso.
  let lastWeight: ParsedImportRow['lastWeight'] = null;
  const weighedOn = optionalDate('lastWeightDate');
  if (!isEmptyCell(cells.lastWeightKg)) {
    const kg = parseEsCoDecimal(cells.lastWeightKg);
    if (!kg.ok) error('lastWeightKg', kg.message);
    else if (kg.value <= 0 || kg.value > MAX_WEIGHT_KG) {
      error('lastWeightKg', `${cellText(cells.lastWeightKg)} kg no es un peso posible.`);
    } else if (isEmptyCell(cells.lastWeightDate)) {
      error('lastWeightDate', 'Indica la fecha del último peso.');
    } else if (
      weighedOn !== null &&
      notBeforeBirth('lastWeightDate', weighedOn, 'La fecha del peso')
    ) {
      lastWeight = {
        weightKg: Math.round(kg.value * 100) / 100,
        weighedOn,
        isBirthWeight: birthDate !== null && weighedOn === birthDate,
      };
    }
  } else if (weighedOn !== null) {
    warn('lastWeightDate', 'Sin peso: la fecha del último peso no se importa.');
  }

  const notes = optionalText('notes', 2000);

  return {
    row,
    code,
    codeKey,
    name,
    sex,
    breed,
    birthDate,
    birthDateEstimated,
    origin,
    entryDate,
    entryDateEstimated,
    damCode,
    sireText,
    lotId,
    identifiers,
    importedPriorCalvings,
    lastCalving,
    pregnancy,
    lastWeight,
    notes,
    issues,
  };
}

/** Códigos e identificadores repetidos dentro del archivo: error en todas las filas que chocan. */
function markDuplicates(rows: readonly ParsedImportRow[]): ParsedImportRow[] {
  const byCode = new Map<string, number[]>();
  const byIdentifier = new Map<
    string,
    { rows: number[]; column: ImportColumnKey; value: string }
  >();
  const columnOf: Record<IdentifierType, ImportColumnKey> = {
    VISUAL_TAG: 'visualTag',
    DIN: 'din',
    RFID: 'rfid',
    QR: 'visualTag',
    BRAND: 'visualTag',
    OTHER: 'visualTag',
  };
  for (const row of rows) {
    if (row.codeKey !== null)
      byCode.set(row.codeKey, [...(byCode.get(row.codeKey) ?? []), row.row]);
    for (const identifier of row.identifiers) {
      const key = `${identifier.type}:${identifier.value}`;
      const entry = byIdentifier.get(key) ?? {
        rows: [],
        column: columnOf[identifier.type],
        value: identifier.value,
      };
      entry.rows.push(row.row);
      byIdentifier.set(key, entry);
    }
  }

  const extra = new Map<number, ImportIssue[]>();
  const add = (row: number, issue: ImportIssue): void => {
    extra.set(row, [...(extra.get(row) ?? []), issue]);
  };
  for (const [, repeated] of byCode) {
    if (repeated.length < 2) continue;
    for (const row of repeated) {
      const others = repeated.filter((other) => other !== row);
      const code = rows.find((item) => item.row === row)?.code ?? '';
      add(row, {
        row,
        column: 'code',
        severity: 'error',
        message: `El código ${code} está repetido en ${others.length === 1 ? 'la fila' : 'las filas'} ${others.join(', ')} de este archivo.`,
      });
    }
  }
  for (const [, entry] of byIdentifier) {
    if (entry.rows.length < 2) continue;
    for (const row of entry.rows) {
      const others = entry.rows.filter((other) => other !== row);
      add(row, {
        row,
        column: entry.column,
        severity: 'error',
        message: `El identificador ${entry.value} está repetido en ${others.length === 1 ? 'la fila' : 'las filas'} ${others.join(', ')} de este archivo.`,
      });
    }
  }
  return rows.map((row) => {
    const more = extra.get(row.row);
    return more === undefined ? row : { ...row, issues: [...row.issues, ...more] };
  });
}

// ---------------------------------------------------------------------------------------------
// Paso 3: madre y padre, propagación de errores y plan
// ---------------------------------------------------------------------------------------------

/** Lo que la API averiguó en la base entre el paso 1 y el 3. */
export type AnimalImportLookups = {
  /** Animales no archivados de la finca por código normalizado (el activo, si hay varios). */
  readonly farmAnimals: ReadonlyMap<string, ImportFarmAnimal>;
  /** Problemas que solo sabe la base: código ocupado, identificador ocupado o ya usado. */
  readonly extraIssues: readonly ImportIssue[];
};

const hasError = (issues: readonly ImportIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'error');

const COLUMN_ORDER = new Map<ImportColumnKey | null, number>([
  [null, -1],
  ...IMPORT_COLUMNS.map((column, index) => [column.key, index] as const),
]);

/** Paso 3: resuelve madre y padre y arma el resultado de la simulación y el plan. */
export function resolveAnimalImport(
  parsed: ParsedAnimalImport,
  context: AnimalImportContext,
  lookups: AnimalImportLookups,
): AnimalImportResult {
  const issuesByRow = new Map<number, ImportIssue[]>();
  for (const row of parsed.rows) issuesByRow.set(row.row, [...row.issues]);
  for (const issue of lookups.extraIssues) {
    issuesByRow.set(issue.row, [...(issuesByRow.get(issue.row) ?? []), issue]);
  }
  const error = (row: number, column: ImportColumnKey, message: string): void => {
    issuesByRow.get(row)?.push({ row, column, severity: 'error', message });
  };
  const warn = (row: number, column: ImportColumnKey, message: string): void => {
    issuesByRow.get(row)?.push({ row, column, severity: 'warning', message });
  };

  const fileByCode = new Map<string, ParsedImportRow>();
  for (const row of parsed.rows) {
    // Con códigos repetidos cada fila ya tiene su error; el mapa solo guarda la primera.
    if (row.codeKey !== null && !fileByCode.has(row.codeKey)) fileByCode.set(row.codeKey, row);
  }

  // Las madres nacen antes que sus crías, así que en orden de nacimiento el error de una madre
  // ya se conoce cuando llega su cría: una sola pasada basta (CA4, «se resuelve en dos pasadas»:
  // la primera leyó todas las filas, esta las enlaza).
  const ordered = [...parsed.rows].sort(
    (left, right) =>
      (left.birthDate === null || right.birthDate === null
        ? 0
        : compareIsoDates(left.birthDate, right.birthDate)) || left.row - right.row,
  );

  const parents = new Map<
    number,
    { dam: ImportParentRef | null; sire: ImportParentRef | null; sireExternalRef: string | null }
  >();

  for (const row of ordered) {
    let dam: ImportParentRef | null = null;
    let sire: ImportParentRef | null = null;
    let sireExternalRef: string | null = null;

    if (row.damCode !== null) {
      const key = normalizeAnimalCode(row.damCode);
      const inFile = fileByCode.get(key);
      const inFarm = lookups.farmAnimals.get(key);
      const fileOk =
        inFile !== undefined &&
        inFile.row !== row.row &&
        !hasError(issuesByRow.get(inFile.row) ?? []);
      if (fileOk && inFile.sex !== null && inFile.birthDate !== null) {
        dam = checkParent(
          row,
          { sex: inFile.sex, birthDate: inFile.birthDate, code: inFile.code ?? row.damCode },
          'dam',
          { kind: 'file', row: inFile.row },
        );
      } else if (inFarm !== undefined) {
        dam = checkParent(row, inFarm, 'dam', { kind: 'farm', id: inFarm.id });
      } else if (inFile !== undefined && inFile.row !== row.row) {
        error(
          row.row,
          'dam',
          `La madre ${row.damCode} tiene errores en la fila ${inFile.row}; corrígela primero.`,
        );
      } else if (inFile === undefined) {
        error(row.row, 'dam', `La madre ${row.damCode} no está en este archivo ni en la finca.`);
      }
    }

    if (row.sireText !== null) {
      const key = normalizeAnimalCode(row.sireText);
      const inFile = fileByCode.get(key);
      const inFarm = lookups.farmAnimals.get(key);
      const fileOk =
        inFile !== undefined &&
        inFile.row !== row.row &&
        !hasError(issuesByRow.get(inFile.row) ?? []);
      const candidate =
        fileOk && inFile.sex !== null && inFile.birthDate !== null
          ? {
              parent: {
                sex: inFile.sex,
                birthDate: inFile.birthDate,
                code: inFile.code ?? row.sireText,
              },
              ref: { kind: 'file', row: inFile.row } as const,
            }
          : inFarm === undefined
            ? null
            : { parent: inFarm, ref: { kind: 'farm', id: inFarm.id } as const };
      if (
        candidate !== null &&
        row.birthDate !== null &&
        !isBefore(candidate.parent.birthDate, row.birthDate)
      ) {
        // Un toro más joven que la cría no puede ser su padre: el número es de otro animal
        // (con numeración reutilizable, uno anterior con el mismo número). Se conserva lo
        // escrito como referencia externa. La madre, en cambio, sí se exige (CA4).
        sireExternalRef = row.sireText;
        warn(
          row.row,
          'sire',
          `El padre ${candidate.parent.code} de la finca nació después que esta cría: se guarda «${row.sireText}» como referencia externa, no como ese animal.`,
        );
      } else if (candidate !== null) {
        sire = checkParent(row, candidate.parent, 'sire', candidate.ref);
      } else if (inFile !== undefined && inFile.row !== row.row) {
        error(
          row.row,
          'sire',
          `El padre ${row.sireText} tiene errores en la fila ${inFile.row}; corrígelo primero.`,
        );
      } else {
        sireExternalRef = row.sireText;
        if (!/\s/.test(row.sireText) && row.sireText.length <= 10) {
          warn(
            row.row,
            'sire',
            `El padre «${row.sireText}» no está en este archivo ni en la finca: se guarda como referencia externa.`,
          );
        }
      }
    }
    parents.set(row.row, { dam, sire, sireExternalRef });
  }

  /** Sexo, nacimiento anterior y edad de la madre (RN-02, RN-23), como en el registro. */
  function checkParent(
    child: ParsedImportRow,
    parent: { readonly sex: Sex; readonly birthDate: IsoDate; readonly code: string },
    column: 'dam' | 'sire',
    ref: ImportParentRef,
  ): ImportParentRef | null {
    const isDam = column === 'dam';
    if (isDam && parent.sex !== SEX.FEMALE) {
      error(child.row, column, `La madre ${parent.code} es macho.`);
      return null;
    }
    if (!isDam && parent.sex !== SEX.MALE) {
      error(child.row, column, `El padre ${parent.code} es hembra.`);
      return null;
    }
    if (child.birthDate !== null && !isBefore(parent.birthDate, child.birthDate)) {
      // Solo llega aquí la madre: un padre más joven ya se guardó como referencia externa.
      error(child.row, column, `La madre ${parent.code} debe haber nacido antes que la cría.`);
      return null;
    }
    if (
      isDam &&
      child.birthDate !== null &&
      monthsBetween(parent.birthDate, child.birthDate) < context.minBreedingAgeMonths
    ) {
      warn(
        child.row,
        column,
        `La madre ${parent.code} tenía menos de ${context.minBreedingAgeMonths} meses al nacer esta cría.`,
      );
    }
    return ref;
  }

  const issues = [...issuesByRow.values()]
    .flat()
    .sort(
      (left, right) =>
        left.row - right.row ||
        (COLUMN_ORDER.get(left.column) ?? 0) - (COLUMN_ORDER.get(right.column) ?? 0),
    );

  let validRows = 0;
  let warningRows = 0;
  let errorRows = 0;
  const plan: ImportPlanRow[] = [];
  for (const row of ordered) {
    const rowIssues = issuesByRow.get(row.row) ?? [];
    if (
      hasError(rowIssues) ||
      row.code === null ||
      row.sex === null ||
      row.breed === null ||
      row.birthDate === null ||
      row.entryDate === null
    ) {
      errorRows += 1;
      continue;
    }
    if (rowIssues.length > 0) warningRows += 1;
    else validRows += 1;
    const links = parents.get(row.row) ?? { dam: null, sire: null, sireExternalRef: null };
    plan.push({
      row: row.row,
      code: row.code,
      name: row.name,
      sex: row.sex,
      breed: row.breed,
      birthDate: row.birthDate,
      birthDateEstimated: row.birthDateEstimated,
      origin: row.origin,
      entryDate: row.entryDate,
      entryDateEstimated: row.entryDateEstimated,
      dam: links.dam,
      sire: links.sire,
      sireExternalRef: links.sireExternalRef,
      lotId: row.lotId,
      identifiers: row.identifiers,
      importedPriorCalvings: row.importedPriorCalvings,
      lastCalving: row.lastCalving,
      pregnancy: row.pregnancy,
      lastWeight: row.lastWeight,
      notes: row.notes,
    });
  }

  // Solo se crean las razas que usa alguna fila que entra.
  const newBreeds = parsed.newBreeds.filter((name) =>
    plan.some(
      (row) => row.breed.kind === 'new' && catalogNameKey(row.breed.name) === catalogNameKey(name),
    ),
  );

  return {
    totalRows: parsed.rows.length,
    validRows,
    warningRows,
    errorRows,
    issues,
    plan,
    newBreeds,
  };
}

/** «Fila 13 · Código madre: La madre 012 es macho.» */
export function formatImportIssue(issue: ImportIssue): string {
  const where = issue.column === null ? '' : ` · ${importColumnLabel(issue.column)}`;
  return `Fila ${issue.row}${where}: ${issue.message}`;
}

/**
 * «Dónde va el chip» de la plantilla: Arete, Inyectable o Bolo (también «Chip en arete», «Chip
 * inyectable» y «Bolo ruminal», sin importar tildes ni mayúsculas). `undefined` si no es ninguno.
 */
export function parseRfidCarrier(text: string): RfidCarrier | undefined {
  const key = importHeaderKey(text);
  const choices: readonly (readonly [RfidCarrier, readonly string[]])[] = [
    [RFID_CARRIER.EAR_TAG, ['arete', 'chip en arete']],
    [RFID_CARRIER.INJECTABLE, ['inyectable', 'chip inyectable']],
    [RFID_CARRIER.BOLUS, ['bolo', 'bolo ruminal']],
  ];
  return choices.find(([, words]) => words.includes(key))?.[0];
}

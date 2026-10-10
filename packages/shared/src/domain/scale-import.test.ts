import { describe, expect, it } from 'vitest';

import { toIsoDate, type IsoDate } from '../date.js';
import type { SheetCell } from '../format/parse.js';
import {
  TRU_TEST_TEMPLATE,
  lbToKg,
  normalizeHeader,
  normalizeScaleCode,
  normalizeVisualId,
  parseScaleDate,
  parseScaleRow,
  planScaleImport,
  proposeScaleMapping,
  resolveScaleColumns,
  scaleTemplate,
  type ScaleAnimal,
  type ScaleColumnMapping,
  type ScaleColumns,
  type ScaleLookup,
  type ScaleRowParse,
} from './scale-import.js';

const d = (value: string): IsoDate => toIsoDate(value);
const HOY = d('2026-09-25');
const CHIP_A = '982000000000001';
const CHIP_B = '982000000000002';
const CHIP_X = '982000000000999';

function columns(headers: string[], mapping: ScaleColumnMapping = TRU_TEST_TEMPLATE.columnMapping) {
  const resolved = resolveScaleColumns(headers, mapping);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.value;
}

function parse(
  cells: SheetCell[],
  cols: ScaleColumns,
  mapping: ScaleColumnMapping = TRU_TEST_TEMPLATE.columnMapping,
  row = 2,
): ScaleRowParse {
  return parseScaleRow({ cells, row, columns: cols, mapping, sessionDate: HOY });
}

describe('plantillas y mapeo de columnas (PES-04 CA1)', () => {
  it('la plantilla Tru-Test es del sistema, provisional y en kilos', () => {
    expect(scaleTemplate('tru-test')).toBe(TRU_TEST_TEMPLATE);
    expect(TRU_TEST_TEMPLATE.provisional).toBe(true);
    expect(TRU_TEST_TEMPLATE.columnMapping.unit).toBe('KG');
    expect(scaleTemplate('gallagher')).toBeNull();
  });

  it('reconoce los encabezados sin mayúsculas, tildes ni signos', () => {
    expect(normalizeHeader(' Peso (kg) ')).toBe('pesokg');
    expect(normalizeHeader('Número Visual')).toBe('numerovisual');
    const cols = columns(['Session', 'EID', 'Visual ID', 'Weight (kg)', 'Date', 'Time']);
    expect(cols).toMatchObject({ eid: 1, visualId: 2, weight: 3, date: 4, time: 5 });
    expect(cols.headers.weight).toBe('Weight (kg)');
  });

  it('sin columna de peso o sin chip ni número visual, el archivo no se puede leer', () => {
    const noWeight = resolveScaleColumns(['EID', 'Date'], TRU_TEST_TEMPLATE.columnMapping);
    expect(noWeight.ok).toBe(false);
    const noId = resolveScaleColumns(['Weight', 'Date'], TRU_TEST_TEMPLATE.columnMapping);
    expect(noId.ok).toBe(false);
  });

  it('propone el mapeo la primera vez, con libras si el encabezado lo dice', () => {
    expect(proposeScaleMapping(['Chip', 'Chapeta', 'Peso', 'Fecha'])).toMatchObject({
      eid: ['Chip'],
      visualId: ['Chapeta'],
      weight: ['Peso'],
      date: ['Fecha'],
      unit: 'KG',
    });
    expect(proposeScaleMapping(['EID', 'Weight (lb)'])?.unit).toBe('LB');
    expect(proposeScaleMapping(['Nombre', 'Observaciones'])).toBeNull();
  });
});

describe('lectura de filas', () => {
  const cols = columns(['EID', 'VID', 'Weight', 'Date', 'Time']);

  it('lee chip, número visual, peso es-CO, fecha con hora pegada y hora', () => {
    const result = parse(['982 000000000001', '045', '452,5', '15/09/2026 08:31', '08:31'], cols);
    expect(result).toEqual({
      ok: true,
      value: {
        row: 2,
        eid: CHIP_A,
        visualId: '045',
        weightKg: 452.5,
        originalWeight: 452.5,
        date: '2026-09-15',
        time: '08:31',
      },
    });
  });

  it('un chip que no tiene 15 dígitos, un peso no numérico o una fila sin identificación fallan', () => {
    expect(parse(['98200000001', '', '300', '15/09/2026', ''], cols)).toMatchObject({ ok: false });
    expect(parse([CHIP_A, '', '300 kg', '15/09/2026', ''], cols)).toMatchObject({ ok: false });
    expect(parse(['', '', '300', '15/09/2026', ''], cols)).toMatchObject({
      ok: false,
      message: 'La fila no trae chip ni número visual.',
    });
    expect(parse([CHIP_A, '', '0', '15/09/2026', ''], cols)).toMatchObject({ ok: false });
  });

  it('en libras convierte a kilos con redondeo a 0,1 kg', () => {
    expect(lbToKg(1000)).toBe(453.6);
    expect(lbToKg(220.46)).toBe(100);
    const mapping = { ...TRU_TEST_TEMPLATE.columnMapping, unit: 'LB' as const };
    const result = parse([CHIP_A, '', '1000', '15/09/2026', ''], cols, mapping);
    expect(result).toMatchObject({ ok: true, value: { weightKg: 453.6, originalWeight: 1000 } });
  });

  it('sin columna de fecha usa la de la sesión', () => {
    const noDate = columns(['EID', 'Weight']);
    expect(parse([CHIP_A, '300'], noDate)).toMatchObject({ ok: true, value: { date: HOY } });
  });

  it('respeta el orden de la fecha del perfil', () => {
    expect(parseScaleDate('09/15/2026', 'MDY')).toEqual({ ok: true, value: '2026-09-15' });
    expect(parseScaleDate('2026/09/15', 'YMD')).toEqual({ ok: true, value: '2026-09-15' });
    expect(parseScaleDate('2026-09-15T08:00:00', 'DMY')).toEqual({ ok: true, value: '2026-09-15' });
    expect(parseScaleDate({ date: d('2026-09-15') }, 'DMY')).toEqual({
      ok: true,
      value: '2026-09-15',
    });
  });
});

describe('planScaleImport (PES-04 CA2 y CA3)', () => {
  const animal = (
    id: string,
    code: string,
    rfid: string | null,
    weights: ScaleAnimal['weights'] = [],
  ): ScaleAnimal => ({ id, code, name: null, birthDate: d('2025-01-01'), rfid, weights });

  const A = animal('a', '045', CHIP_A, [
    { id: '1', weighedOn: d('2026-06-15'), weightKg: 300, isBirthWeight: false, voided: false },
  ]);
  const B = animal('b', '046', CHIP_B);
  const C = animal('c', '26-010', null);
  const D = animal('d', '7', null);

  const lookup: ScaleLookup = {
    byRfid: new Map([
      [CHIP_A, A],
      [CHIP_B, B],
    ]),
    byVisualTag: new Map([[normalizeVisualId('26-010'), C]]),
    byCode: new Map([
      [normalizeScaleCode('045'), A],
      [normalizeScaleCode('046'), B],
      [normalizeScaleCode('26-010'), C],
      [normalizeScaleCode('7'), D],
    ]),
    byId: new Map([['d', D]]),
  };

  const cols = columns(['EID', 'VID', 'Weight', 'Date']);
  const rows = (...cells: SheetCell[][]): ScaleRowParse[] =>
    cells.map((row, index) => parse(row, cols, TRU_TEST_TEMPLATE.columnMapping, index + 2));

  it('asocia por chip, luego por chapeta y luego por código, y dice cómo', () => {
    const plan = planScaleImport({
      rows: rows(
        [CHIP_A, '', '340', '15/09/2026'],
        ['', '26-010', '120', '15/09/2026'],
        ['', '007', '200', '15/09/2026'],
      ),
      lookup,
      associations: [],
      skip: [],
      today: HOY,
    });
    expect(plan.rows.map((row) => [row.row, row.status, row.via, row.animal?.code])).toEqual([
      [2, 'MATCHED', 'RFID', '045'],
      [3, 'MATCHED', 'VISUAL_TAG', '26-010'],
      [4, 'MATCHED', 'CODE', '7'],
    ]);
    expect(plan.counts.matched).toBe(3);
  });

  it('deja los chips desconocidos para asociar o descartar', () => {
    const input = {
      rows: rows([CHIP_X, '', '250', '15/09/2026'], [CHIP_X, '', '251', '16/09/2026']),
      lookup,
      skip: [] as string[],
      today: HOY,
    };
    const pending = planScaleImport({ ...input, associations: [] });
    expect(pending.unknownChips).toEqual([
      {
        chip: CHIP_X,
        rows: [2, 3],
        weightKg: 251,
        date: '2026-09-16',
        visualId: null,
        uncommonPrefix: false,
      },
    ]);
    expect(pending.weights).toHaveLength(0);

    const associated = planScaleImport({
      ...input,
      associations: [{ chip: CHIP_X, animalId: 'd', saveChip: true }],
    });
    expect(associated.rows.every((row) => row.via === 'ASSOCIATED')).toBe(true);
    expect(associated.weights).toHaveLength(2);

    const skipped = planScaleImport({ ...input, associations: [], skip: [CHIP_X] });
    expect(skipped.counts).toMatchObject({ skipped: 2, unknownChips: 0, matched: 0 });
  });

  it('chip desconocido con prefijo poco común: lo advierte, sin bloquear (08 §1.6)', () => {
    const plan = planScaleImport({
      rows: rows(
        ['076000000000123', '', '250', '15/09/2026'],
        ['982000000000123', '', '260', '15/09/2026'],
      ),
      lookup,
      associations: [],
      skip: [],
      today: HOY,
    });
    expect(plan.unknownChips.map((chip) => [chip.chip, chip.uncommonPrefix])).toEqual([
      ['076000000000123', true],
      ['982000000000123', false],
    ]);
    expect(plan.rows[0]?.message).toContain('Prefijo poco común: verifica el número.');
    expect(plan.rows[1]?.message).not.toContain('Prefijo');
    expect(plan.rows.every((row) => row.status === 'UNKNOWN_CHIP')).toBe(true);
  });

  it('el mismo animal el mismo día: conserva la última fila y avisa', () => {
    const plan = planScaleImport({
      rows: rows([CHIP_B, '', '300', '15/09/2026'], [CHIP_B, '', '302', '15/09/2026']),
      lookup,
      associations: [],
      skip: [],
      today: HOY,
    });
    expect(plan.weights).toEqual([
      { row: 3, animalId: 'b', date: '2026-09-15', weightKg: 302, outlier: false },
    ]);
    expect(plan.rows[0]).toMatchObject({ status: 'DUPLICATE' });
    expect(plan.duplicateWarnings[0]?.message).toBe(
      'El animal 046 aparece 2 veces el 15/09/2026: se guarda el último peso (302 kg).',
    );
  });

  it('marca los atípicos frente al pesaje anterior, también del mismo archivo', () => {
    const plan = planScaleImport({
      rows: rows(
        [CHIP_A, '', '420', '15/09/2026'],
        [CHIP_B, '', '300', '01/09/2026'],
        [CHIP_B, '', '150', '20/09/2026'],
      ),
      lookup,
      associations: [],
      skip: [],
      today: HOY,
    });
    expect(plan.weights.map((item) => [item.row, item.outlier])).toEqual([
      [2, true],
      [3, false],
      [4, true],
    ]);
    expect(plan.rows[0]?.previousKg).toBe(300);
    expect(plan.counts.outliers).toBe(2);
  });

  it('fecha futura, anterior al nacimiento o número que no existe: error en la fila', () => {
    const plan = planScaleImport({
      rows: rows(
        [CHIP_A, '', '300', '26/09/2026'],
        [CHIP_A, '', '300', '15/09/2024'],
        ['', '999', '300', '15/09/2026'],
        ['123', '', '300', '15/09/2026'],
      ),
      lookup,
      associations: [],
      skip: [],
      today: HOY,
    });
    expect(plan.rows.map((row) => row.status)).toEqual(['ERROR', 'ERROR', 'ERROR', 'ERROR']);
    expect(plan.counts.errors).toBe(4);
  });
});

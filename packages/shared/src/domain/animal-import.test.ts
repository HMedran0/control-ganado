import { describe, expect, it } from 'vitest';

import { toIsoDate, type IsoDate } from '../date.js';
import type { SheetCell } from '../format/parse.js';
import {
  ENTRY_DATE_FROM_BIRTH_WARNING,
  IMPORT_COLUMNS,
  formatImportIssue,
  importHeaderKey,
  mapImportHeaders,
  parseAnimalImportRows,
  resolveAnimalImport,
  type AnimalImportContext,
  type AnimalImportLookups,
  type ImportColumnKey,
  type ImportFarmAnimal,
  type ImportSourceRow,
} from './animal-import.js';

const TODAY = toIsoDate('2026-09-25');

const CONTEXT: AnimalImportContext = {
  today: TODAY,
  breeds: [
    { id: 'b-brahman', name: 'Brahman', gestationDays: 293 },
    { id: 'b-cebu', name: 'Cebú comercial', gestationDays: 293 },
    { id: 'b-romo', name: 'Romosinuano', gestationDays: 283 },
    { id: 'b-cruce', name: 'Cruce', gestationDays: 288 },
    { id: 'b-giro', name: 'Girolando', gestationDays: 288 },
    { id: 'b-bxp', name: 'Brahman × Pardo', gestationDays: null },
  ],
  lots: [
    { id: 'l-paridas', name: 'Paridas' },
    { id: 'l-horras', name: 'Horras y novillas' },
    { id: 'l-levante', name: 'Levante' },
    { id: 'l-toros', name: 'Toros' },
  ],
  farmGestationDays: 285,
  minBreedingAgeMonths: 15,
  createMissingBreeds: false,
};

const NO_LOOKUPS: AnimalImportLookups = { farmAnimals: new Map(), extraIssues: [] };

/**
 * `docs/referencia/plantilla-importacion.xlsx`, hoja «Animales», celda por celda: las fechas son
 * los seriales de Excel que trae el archivo. La fila 13 tiene el error a propósito.
 */
const TEMPLATE_KEYS: readonly ImportColumnKey[] = [
  'code',
  'name',
  'sex',
  'breed',
  'birthDate',
  'birthDateEstimated',
  'origin',
  'dam',
  'sire',
  'lot',
  'visualTag',
  'din',
  'rfid',
  'priorCalvings',
  'lastCalvingDate',
  'pregnant',
  'serviceDate',
  'lastWeightKg',
  'lastWeightDate',
  'notes',
];
const TEMPLATE: readonly (readonly SheetCell[])[] = [
  [
    '087',
    'Canela',
    'Hembra',
    'Brahman',
    43536,
    'No',
    'Nacido en la finca',
    null,
    '012',
    'Paridas',
    '087',
    null,
    null,
    4,
    46233,
    'No',
    null,
    452,
    46268,
    null,
  ],
  [
    '26-031',
    null,
    'Macho',
    'Brahman × Pardo',
    46233,
    'No',
    'Nacido en la finca',
    '087',
    '012',
    'Paridas',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    34,
    46233,
    'Cría de Canela',
  ],
  [
    '112',
    'Lucero',
    'Hembra',
    'Girolando',
    44566,
    'Sí',
    'Comprado',
    null,
    'IA pajilla Gyr',
    'Paridas',
    '112',
    null,
    null,
    1,
    46127,
    'Sí',
    46208,
    430,
    46188,
    'Comprada a finca vecina',
  ],
  [
    '012',
    null,
    'Macho',
    'Brahman',
    43953,
    'Sí',
    'Comprado',
    null,
    null,
    'Toros',
    '012',
    null,
    null,
    null,
    null,
    null,
    null,
    690,
    46188,
    'Toro reproductor',
  ],
  [
    '140',
    null,
    'Hembra',
    'Romosinuano',
    45523,
    'No',
    'Nacido en la finca',
    '087',
    '012',
    'Horras y novillas',
    '140',
    null,
    null,
    0,
    null,
    'No',
    null,
    318,
    46188,
    null,
  ],
  [
    '26-012',
    null,
    'Hembra',
    'Brahman × Pardo',
    46127,
    'No',
    'Nacido en la finca',
    '112',
    '012',
    'Paridas',
    null,
    'CO0100000234567',
    '170000123456789',
    null,
    null,
    null,
    null,
    null,
    null,
    'DIN oficial 2026',
  ],
  [
    '25-044',
    null,
    'Macho',
    'Brahman',
    45818,
    'No',
    'Nacido en la finca',
    '055',
    '012',
    'Levante',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    236,
    46266,
    'Disponible para venta',
  ],
  [
    '055',
    'Mariposa',
    'Hembra',
    'Cebú comercial',
    43424,
    'Sí',
    'Nacido en la finca',
    null,
    null,
    'Horras y novillas',
    '055',
    null,
    null,
    5,
    45818,
    'Sí',
    46050,
    470,
    46188,
    null,
  ],
  [
    '300',
    'Buey Pinto',
    'Macho',
    'Cruce',
    42430,
    'Sí',
    'Comprado',
    null,
    null,
    'Toros',
    '300',
    null,
    null,
    null,
    null,
    null,
    null,
    610,
    46188,
    'Cotero: buey de carga',
  ],
  [
    '201',
    'Estrella',
    'Hembra',
    'Brahman',
    42987,
    'Sí',
    'Nacido en la finca',
    null,
    null,
    'Horras y novillas',
    '201',
    null,
    null,
    6,
    45963,
    'No',
    null,
    441,
    46188,
    'Horra',
  ],
  [
    '25-050',
    null,
    'Hembra',
    'Girolando',
    45963,
    'No',
    'Nacido en la finca',
    '201',
    'IA pajilla Holstein',
    'Horras y novillas',
    null,
    null,
    null,
    0,
    null,
    'No',
    null,
    188,
    46266,
    null,
  ],
  [
    '26-040',
    null,
    'Hembra',
    'Brahman',
    46254,
    'No',
    'Nacido en la finca',
    '012',
    null,
    'Paridas',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    31,
    46254,
    'ERROR INTENCIONAL: la madre 012 es macho',
  ],
];

function templateRows(): ImportSourceRow[] {
  return TEMPLATE.map((values, index) => ({
    row: index + 2,
    cells: Object.fromEntries(TEMPLATE_KEYS.map((key, column) => [key, values[column] ?? null])),
  }));
}

/** Una fila mínima válida, con lo que se quiera cambiar. */
function row(number: number, cells: Partial<Record<ImportColumnKey, SheetCell>>): ImportSourceRow {
  return {
    row: number,
    cells: {
      code: `A-${number}`,
      sex: 'Hembra',
      breed: 'Brahman',
      birthDate: '10/01/2022',
      ...cells,
    },
  };
}

function run(
  rows: readonly ImportSourceRow[],
  options: { context?: Partial<AnimalImportContext>; lookups?: Partial<AnimalImportLookups> } = {},
) {
  const context = { ...CONTEXT, ...options.context };
  return resolveAnimalImport(parseAnimalImportRows(rows, context), context, {
    ...NO_LOOKUPS,
    ...options.lookups,
  });
}

function messagesOf(result: ReturnType<typeof run>, rowNumber: number): string[] {
  return result.issues.filter((issue) => issue.row === rowNumber).map((issue) => issue.message);
}

describe('encabezados', () => {
  it('reconoce los de la plantilla sin importar tildes, asteriscos, paréntesis ni orden', () => {
    expect(importHeaderKey(' Código* ')).toBe('codigo');
    expect(importHeaderKey('RFID (15 dígitos)')).toBe('rfid');
    const headers = ['Raza*', 'CODIGO', 'sexo', 'Fecha de nacimiento*', 'Columna extra', 'Lote'];
    const map = mapImportHeaders(headers);
    expect([...map.columns.entries()]).toEqual([
      [0, 'breed'],
      [1, 'code'],
      [2, 'sex'],
      [3, 'birthDate'],
      [5, 'lot'],
    ]);
    expect(map.missing).toEqual([]);
  });

  it('dice qué obligatorias faltan y cuáles se repiten', () => {
    const map = mapImportHeaders(['Código', 'Código', 'Nombre']);
    expect(map.missing).toEqual(['Sexo', 'Raza', 'Fecha de nacimiento']);
    expect(map.duplicated).toEqual(['Código']);
  });

  it('todas las columnas de la plantilla tienen una clave distinta', () => {
    const keys = IMPORT_COLUMNS.map((column) => importHeaderKey(column.label));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('plantilla de referencia (ANI-09, 07 M4d)', () => {
  const result = run(templateRows());

  it('11 filas entran y la 13 tiene el error de la madre macho', () => {
    expect(result.totalRows).toBe(12);
    expect(result.plan).toHaveLength(11);
    expect(result.errorRows).toBe(1);
    expect(result.validRows + result.warningRows).toBe(11);
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([
      { row: 13, column: 'dam', severity: 'error', message: 'La madre 012 es macho.' },
    ]);
    expect(formatImportIssue(errors[0]!)).toBe('Fila 13 · Código madre: La madre 012 es macho.');
  });

  it('el padre 012 de Canela nació después que ella: queda como referencia externa', () => {
    expect(messagesOf(result, 2)).toEqual([
      'El padre 012 de la finca nació después que esta cría: se guarda «012» como referencia externa, no como ese animal.',
    ]);
    expect(result.plan.find((item) => item.code === '087')).toMatchObject({
      sire: null,
      sireExternalRef: '012',
    });
  });

  it('los comprados sin fecha de ingreso toman la de nacimiento, con advertencia', () => {
    expect(result.warningRows).toBe(4);
    for (const rowNumber of [4, 5, 10]) {
      expect(messagesOf(result, rowNumber)).toEqual([ENTRY_DATE_FROM_BIRTH_WARNING]);
    }
    const lucero = result.plan.find((item) => item.code === '112');
    expect(lucero).toMatchObject({
      origin: 'PURCHASED',
      entryDate: lucero?.birthDate,
      entryDateEstimated: true,
      birthDateEstimated: true,
    });
  });

  it('madres antes que sus crías, aunque la madre esté más abajo en el archivo', () => {
    const order = result.plan.map((item) => item.code);
    for (const [dam, calf] of [
      ['087', '26-031'],
      ['087', '140'],
      ['055', '25-044'],
      ['112', '26-012'],
      ['201', '25-050'],
    ] as const) {
      expect(order.indexOf(dam), `${dam} antes que ${calf}`).toBeLessThan(order.indexOf(calf));
    }
    const calf = result.plan.find((item) => item.code === '25-044');
    expect(calf?.dam).toEqual({ kind: 'file', row: 9 });
    expect(calf?.sire).toEqual({ kind: 'file', row: 5 });
  });

  it('un padre que no es un código queda como referencia externa', () => {
    const lucero = result.plan.find((item) => item.code === '112');
    expect(lucero).toMatchObject({ sire: null, sireExternalRef: 'IA pajilla Gyr' });
  });

  it('partos previos: el último con su fecha, los anteriores como número (RN-29)', () => {
    const canela = result.plan.find((item) => item.code === '087');
    expect(canela).toMatchObject({
      importedPriorCalvings: 3,
      lastCalving: { date: '2026-07-30', serviceDate: '2025-10-10' },
      pregnancy: null,
    });
    // 140: partos 0 → nada.
    expect(result.plan.find((item) => item.code === '140')).toMatchObject({
      importedPriorCalvings: 0,
      lastCalving: null,
    });
  });

  it('preñada: preñez confirmada con parto estimado por la gestación de su raza', () => {
    const mariposa = result.plan.find((item) => item.code === '055');
    // Cebú comercial: 293 días desde el 28/01/2026 (serial 46050).
    expect(mariposa?.pregnancy).toEqual({
      serviceDate: '2026-01-28',
      expectedCalvingDate: '2026-11-17',
    });
  });

  it('identificadores normalizados, y el peso al nacer marcado como tal', () => {
    const calf = result.plan.find((item) => item.code === '26-012');
    expect(calf?.identifiers).toEqual([
      { type: 'DIN', value: 'CO0100000234567' },
      { type: 'RFID', value: '170000123456789' },
    ]);
    expect(result.plan.find((item) => item.code === '26-031')?.lastWeight).toEqual({
      weightKg: 34,
      weighedOn: '2026-07-30',
      isBirthWeight: true,
    });
  });
});

describe('reglas por fila', () => {
  it('obligatorios y valores de lista', () => {
    const result = run([
      row(2, { code: '  ', sex: null, breed: null, birthDate: null }),
      row(3, { sex: 'Vaca', breed: 'Holstein', lot: 'Potrero 9', origin: 'Regalado' }),
    ]);
    expect(messagesOf(result, 2)).toEqual([
      'Escribe el código del animal.',
      'Indica el sexo: Hembra o Macho.',
      'Indica la raza.',
      'Escribe la fecha de nacimiento (dd/mm/aaaa).',
    ]);
    expect(messagesOf(result, 3)).toEqual([
      '«Vaca» no es un sexo válido: escribe Hembra o Macho.',
      'La raza «Holstein» no existe en el catálogo. Créala en Configuración → Razas o marca «Crear las razas que no existen».',
      '«Regalado» no es una procedencia válida: escribe Nacido en la finca o Comprado.',
      'El lote «Potrero 9» no existe. Créalo en Configuración → Lotes.',
    ]);
    expect(result.plan).toEqual([]);
  });

  it('catálogo sin distinguir mayúsculas ni espacios; sexo abreviado', () => {
    const result = run([row(2, { breed: '  brahman ', lot: 'PARIDAS', sex: 'M' })]);
    expect(result.plan[0]).toMatchObject({
      breed: { kind: 'existing', id: 'b-brahman' },
      lotId: 'l-paridas',
      sex: 'MALE',
    });
  });

  it('con «Crear las razas que no existen», la raza nueva es Cruce y se avisa', () => {
    const result = run(
      [
        row(2, { breed: 'Holstein', pregnant: 'Sí', serviceDate: '01/06/2026' }),
        row(3, { breed: 'HOLSTEIN' }),
      ],
      { context: { createMissingBreeds: true } },
    );
    expect(result.newBreeds).toEqual(['Holstein']);
    expect(messagesOf(result, 2)).toEqual(['Se creará la raza «Holstein» (grupo Cruce).']);
    expect(result.plan[0]?.breed).toEqual({ kind: 'new', name: 'Holstein' });
    // Gestación de Cruce: 288 días.
    expect(result.plan[0]?.pregnancy?.expectedCalvingDate).toBe('2027-03-16');
  });

  it('textos demasiado largos', () => {
    const result = run([
      row(2, { code: 'X'.repeat(31), name: 'N'.repeat(81), notes: 'o'.repeat(2001) }),
    ]);
    expect(messagesOf(result, 2)).toEqual([
      'El código es demasiado largo (máximo 30 caracteres).',
      'Es demasiado largo (máximo 80 caracteres).',
      'Es demasiado largo (máximo 2000 caracteres).',
    ]);
  });

  it('fechas: no futuras, con formato y no anteriores al nacimiento', () => {
    const result = run([
      row(2, { birthDate: '26/09/2026' }),
      row(3, { birthDate: 'ayer', birthDateEstimated: 'quizá' }),
      row(4, { origin: 'Comprado', entryDate: '01/01/2020' }),
    ]);
    expect(messagesOf(result, 2)).toEqual(['La fecha no puede ser posterior a hoy.']);
    expect(messagesOf(result, 3)).toEqual([
      '«ayer» no es una fecha válida. Usa el formato dd/mm/aaaa, por ejemplo 15/03/2024.',
      '«quizá» no es Sí ni No.',
    ]);
    expect(messagesOf(result, 4)).toEqual([
      'La fecha de ingreso no puede ser anterior al nacimiento (10/01/2022).',
    ]);
  });

  it('fecha de ingreso: la del comprado se usa; la del nacido en la finca se ignora con aviso', () => {
    const result = run([
      row(2, { origin: 'Comprada', entryDate: '15/03/2024' }),
      row(3, { entryDate: '15/03/2024' }),
    ]);
    expect(result.plan.find((item) => item.row === 2)).toMatchObject({
      entryDate: '2024-03-15',
      entryDateEstimated: false,
    });
    expect(result.plan.find((item) => item.row === 3)).toMatchObject({ entryDate: '2022-01-10' });
    expect(messagesOf(result, 3)).toEqual([
      'Nació en la finca: su fecha de ingreso es la de nacimiento y se ignora la de esta columna.',
    ]);
  });

  it('RFID: 15 dígitos, ceros perdidos por Excel y aviso si no es de Colombia', () => {
    const result = run([
      row(2, { rfid: '17000012345' }),
      row(3, { rfid: 32_000_012_345_678 }),
      row(4, { rfid: '032 000012345678' }),
    ]);
    expect(messagesOf(result, 2)).toEqual(['El código RFID debe tener exactamente 15 dígitos.']);
    expect(messagesOf(result, 3)).toEqual([
      'El RFID 32000012345678 tiene menos de 15 dígitos: Excel le quitó los ceros iniciales. Escríbelo como texto.',
    ]);
    expect(messagesOf(result, 4)).toEqual(['Prefijo poco común: verifica el número.']);
  });

  it('partos: solo hembras, enteros, y con fecha al menos uno', () => {
    const result = run([
      row(2, { sex: 'Macho', priorCalvings: 2 }),
      row(3, { priorCalvings: '2,5' }),
      row(4, { priorCalvings: 0, lastCalvingDate: '01/05/2026' }),
      row(5, { priorCalvings: 40 }),
      row(6, { lastCalvingDate: '01/05/2026' }),
      row(7, { birthDate: '01/01/2025', priorCalvings: 1, lastCalvingDate: '01/05/2025' }),
      row(8, { priorCalvings: 2 }),
    ]);
    expect(messagesOf(result, 2)).toEqual(['Un macho no puede tener partos.']);
    expect(messagesOf(result, 3)).toEqual(['«2,5» debe ser un número entero, sin decimales.']);
    expect(messagesOf(result, 4)).toEqual([
      'Con fecha de último parto, los partos previos deben ser al menos 1.',
    ]);
    expect(messagesOf(result, 5)).toEqual(['40 partos no es un número posible.']);
    // Sin el número, la fecha cuenta como un parto.
    expect(result.plan.find((item) => item.row === 6)).toMatchObject({
      importedPriorCalvings: 0,
      lastCalving: { date: '2026-05-01' },
    });
    expect(messagesOf(result, 7)).toEqual([
      'La fecha del último parto no es posible para la edad del animal.',
    ]);
    // Sin fecha, todos los partos quedan como anteriores al sistema.
    expect(result.plan.find((item) => item.row === 8)).toMatchObject({
      importedPriorCalvings: 2,
      lastCalving: null,
    });
  });

  it('preñada: solo hembras, con fecha de servicio posterior al último parto', () => {
    const result = run([
      row(2, { sex: 'Macho', pregnant: 'Sí', serviceDate: '01/06/2026' }),
      row(3, { pregnant: 'Sí' }),
      row(4, {
        pregnant: 'Sí',
        serviceDate: '01/03/2026',
        priorCalvings: 1,
        lastCalvingDate: '01/05/2026',
      }),
      row(5, { pregnant: 'Sí', serviceDate: '01/01/2025' }),
      row(6, { pregnant: 'No', serviceDate: '01/06/2026' }),
      row(7, { pregnant: 'tal vez' }),
      row(8, { pregnant: 'Sí', serviceDate: '01/01/2020' }),
    ]);
    expect(messagesOf(result, 2)).toEqual(['Solo una hembra puede estar preñada.']);
    expect(messagesOf(result, 3)).toEqual(['Indica la fecha de servicio.']);
    expect(messagesOf(result, 4)).toEqual([
      'La fecha de servicio debe ser posterior al último parto.',
    ]);
    expect(messagesOf(result, 5)).toEqual([
      'El parto estimado (21/10/2025) ya pasó: revisa la fecha de servicio.',
    ]);
    expect(messagesOf(result, 6)).toEqual([
      'No está marcada como preñada: la fecha de servicio no se importa.',
    ]);
    expect(messagesOf(result, 7)).toEqual(['«tal vez» no es Sí ni No.']);
    expect(messagesOf(result, 8)).toEqual([
      'La fecha de servicio no puede ser anterior al nacimiento (10/01/2022).',
    ]);
  });

  it('último peso: número posible, con fecha, desde el nacimiento', () => {
    const result = run([
      row(2, { lastWeightKg: '452 kg', lastWeightDate: '01/09/2026' }),
      row(3, { lastWeightKg: 0, lastWeightDate: '01/09/2026' }),
      row(4, { lastWeightKg: '452,5' }),
      row(5, { lastWeightDate: '01/09/2026' }),
      row(6, { lastWeightKg: '452,456', lastWeightDate: '01/09/2026' }),
      row(7, { lastWeightKg: 300, lastWeightDate: '01/01/2021' }),
    ]);
    expect(messagesOf(result, 2)).toEqual([
      '«452 kg» no es un número. Escribe solo el número, sin letras ni unidades.',
    ]);
    expect(messagesOf(result, 3)).toEqual(['0 kg no es un peso posible.']);
    expect(messagesOf(result, 4)).toEqual(['Indica la fecha del último peso.']);
    expect(messagesOf(result, 5)).toEqual(['Sin peso: la fecha del último peso no se importa.']);
    expect(result.plan.find((item) => item.row === 6)?.lastWeight).toEqual({
      weightKg: 452.46,
      weighedOn: '2026-09-01',
      isBirthWeight: false,
    });
    expect(messagesOf(result, 7)).toEqual([
      'La fecha del peso no puede ser anterior al nacimiento (10/01/2022).',
    ]);
  });
});

describe('repetidos dentro del archivo', () => {
  it('el mismo código normalizado (RN-30) es error en todas las filas que chocan', () => {
    const result = run([row(2, { code: '5' }), row(3, { code: ' 05 ' }), row(4, { code: '005' })]);
    expect(messagesOf(result, 2)).toEqual([
      'El código 5 está repetido en las filas 3, 4 de este archivo.',
    ]);
    expect(messagesOf(result, 3)).toEqual([
      'El código 05 está repetido en las filas 2, 4 de este archivo.',
    ]);
    expect(result.plan).toEqual([]);
  });

  it('el mismo identificador normalizado también', () => {
    const result = run([
      row(2, { din: 'co-01 234' }),
      row(3, { din: 'CO01234' }),
      row(4, { visualTag: '77' }),
      row(5, { visualTag: ' 77' }),
    ]);
    expect(messagesOf(result, 2)).toEqual([
      'El identificador CO01234 está repetido en la fila 3 de este archivo.',
    ]);
    expect(result.issues.find((issue) => issue.row === 5)?.column).toBe('visualTag');
    expect(result.plan).toEqual([]);
  });
});

describe('madre y padre', () => {
  const FARM: ImportFarmAnimal[] = [
    { id: 'f-vaca', code: '900', sex: 'FEMALE', birthDate: toIsoDate('2018-01-01') },
    { id: 'f-toro', code: '901', sex: 'MALE', birthDate: toIsoDate('2017-01-01') },
    { id: 'f-joven', code: '902', sex: 'FEMALE', birthDate: toIsoDate('2021-06-01') },
  ];
  const farmAnimals = new Map(FARM.map((animal) => [animal.code, animal]));

  it('los busca en la finca si no están en el archivo', () => {
    const result = run([row(2, { dam: '900', sire: '901' })], { lookups: { farmAnimals } });
    expect(result.plan[0]).toMatchObject({
      dam: { kind: 'farm', id: 'f-vaca' },
      sire: { kind: 'farm', id: 'f-toro' },
      sireExternalRef: null,
    });
  });

  it('madre inexistente, madre propia, padre hembra, madre más joven y padre más joven', () => {
    const result = run(
      [
        row(2, { dam: '999' }),
        row(3, { code: '77', dam: '077' }),
        row(4, { sire: '900' }),
        row(5, { birthDate: '01/01/2017', dam: '900' }),
        row(6, { birthDate: '01/01/2016', sire: '901' }),
        row(7, { birthDate: '01/01/2016', sire: '901', dam: '900' }),
      ],
      { lookups: { farmAnimals } },
    );
    expect(messagesOf(result, 2)).toEqual(['La madre 999 no está en este archivo ni en la finca.']);
    expect(messagesOf(result, 3)).toContain('Un animal no puede ser su propia madre.');
    expect(messagesOf(result, 4)).toEqual(['El padre 900 es hembra.']);
    expect(messagesOf(result, 5)).toEqual(['La madre 900 debe haber nacido antes que la cría.']);
    expect(messagesOf(result, 6)).toEqual([
      'El padre 901 de la finca nació después que esta cría: se guarda «901» como referencia externa, no como ese animal.',
    ]);
    expect(result.plan.find((item) => item.row === 6)).toMatchObject({
      sire: null,
      sireExternalRef: '901',
    });
    expect(messagesOf(result, 7)).toContain('La madre 900 debe haber nacido antes que la cría.');
  });

  it('madre demasiado joven: advertencia, no error (RN-23)', () => {
    const result = run([row(2, { birthDate: '01/05/2022', dam: '902' })], {
      lookups: { farmAnimals },
    });
    expect(result.plan).toHaveLength(1);
    expect(messagesOf(result, 2)).toEqual([
      'La madre 902 tenía menos de 15 meses al nacer esta cría.',
    ]);
  });

  it('si la madre del archivo tiene errores, la cría tampoco entra (y en cadena)', () => {
    const result = run([
      row(2, { code: 'M1', birthDate: '01/01/2015', lot: 'No existe' }),
      row(3, { code: 'M2', birthDate: '01/01/2019', dam: 'M1' }),
      row(4, { code: 'M3', birthDate: '01/01/2023', dam: 'M2' }),
    ]);
    expect(messagesOf(result, 3)).toEqual([
      'La madre M1 tiene errores en la fila 2; corrígela primero.',
    ]);
    expect(messagesOf(result, 4)).toEqual([
      'La madre M2 tiene errores en la fila 3; corrígela primero.',
    ]);
    expect(result.errorRows).toBe(3);
  });

  it('una madre del archivo cuyo código ya existe en la finca: la cría se enlaza a la de la finca', () => {
    const result = run([row(2, { code: '900' }), row(3, { dam: '900' })], {
      lookups: {
        farmAnimals,
        extraIssues: [
          {
            row: 2,
            column: 'code',
            severity: 'error',
            message: 'Ya existe un animal con el código 900.',
          },
        ],
      },
    });
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]).toMatchObject({ row: 3, dam: { kind: 'farm', id: 'f-vaca' } });
  });

  it('un padre que parece un código y no aparece: referencia externa con aviso', () => {
    const result = run([row(2, { sire: '013' }), row(3, { sire: 'Toro Z-3 del vecino' })]);
    expect(result.plan.map((item) => item.sireExternalRef)).toEqual(['013', 'Toro Z-3 del vecino']);
    expect(messagesOf(result, 2)).toEqual([
      'El padre «013» no está en este archivo ni en la finca: se guarda como referencia externa.',
    ]);
    expect(messagesOf(result, 3)).toEqual([]);
  });

  it('padre del archivo con errores', () => {
    const result = run([
      row(2, { code: 'T1', sex: 'Macho', birthDate: '01/01/2015', lot: 'No existe' }),
      row(3, { sire: 'T1' }),
    ]);
    expect(messagesOf(result, 3)).toEqual([
      'El padre T1 tiene errores en la fila 2; corrígelo primero.',
    ]);
  });
});

describe('resultado', () => {
  it('ordena los problemas por fila y columna, y no crea razas que ninguna fila válida usa', () => {
    const result = run([row(3, { breed: 'Nueva', lot: 'X' }), row(2, { sex: 'Z' })], {
      context: { createMissingBreeds: true },
    });
    expect(result.issues.map((issue) => [issue.row, issue.column])).toEqual([
      [2, 'sex'],
      [3, 'breed'],
      [3, 'lot'],
    ]);
    expect(result.newBreeds).toEqual([]);
  });

  it('un problema de la fila entera se muestra sin columna', () => {
    expect(
      formatImportIssue({ row: 7, column: null, severity: 'error', message: 'Fila vacía.' }),
    ).toBe('Fila 7: Fila vacía.');
  });

  it('usa la gestación de la finca cuando la raza no tiene propia', () => {
    const result = run([
      row(2, { breed: 'Brahman × Pardo', pregnant: 'Sí', serviceDate: '01/06/2026' }),
    ]);
    const expected: IsoDate = toIsoDate('2027-03-13'); // 285 días
    expect(result.plan[0]?.pregnancy?.expectedCalvingDate).toBe(expected);
  });
});

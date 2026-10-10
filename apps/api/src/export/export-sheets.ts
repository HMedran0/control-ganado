import {
  ALLOCATION_METHOD_LABEL,
  AUDIT_ACTION_LABEL,
  BIRTH_CONDITION_LABEL,
  BREED_GROUP_LABEL,
  CALVING_TYPE_LABEL,
  EXIT_TYPE_LABEL,
  EXPENSE_TYPE_LABEL,
  IDENTIFIED_BY_LABEL,
  IDENTIFIER_TYPE_LABEL,
  IMPORT_KIND_LABEL,
  ORIGIN_LABEL,
  PREGNANCY_OUTCOME_LABEL,
  RETIRE_REASON_LABEL,
  RFID_CARRIER_LABEL,
  ROLE_LABEL,
  SCALE_FILE_FORMAT_LABEL,
  SERVICE_METHOD_LABEL,
  SEX_LABEL,
  VACCINE_SCHEDULE_LABEL,
  VALUATION_METHOD_LABEL,
  WEIGHT_METHOD_LABEL,
  WEIGHT_SOURCE_LABEL,
  WORK_SESSION_STATUS_LABEL,
} from '@hato/shared';

import type { Tx } from '../common/persistence.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Los archivos de la exportación completa (BAK-02, ADR-018): uno por entidad, con sus columnas.
 * Es la única fuente de los encabezados del Excel **y** del `LEEME.txt`, así que lo que el
 * LEEME describe es exactamente lo que trae cada archivo.
 *
 * - Nombres de archivo solo en ASCII, sin tildes ni ñ (`prenez-y-partos.xlsx`): el explorador de
 *   Windows muestra mal los nombres que no son ASCII en muchos ZIP. El contenido va en español.
 * - Cada archivo trae el `Id` de cada fila y las referencias legibles (el código del animal, el
 *   nombre de la raza) además de los `Id` a los que apunta, para reconstruir la historia sin la
 *   app.
 * - Incluye lo archivado y lo anulado, marcado como tal (RN-11).
 * - Usuarios sin contraseña, sin tokens y sin intentos de inicio de sesión.
 * - Se leen por bloques ordenados por `Id` (el cursor es el último `Id` del bloque anterior), así
 *   que en memoria solo hay un bloque a la vez más los catálogos de `ExportLookups`.
 */

/** Cómo se escribe cada valor en el Excel. */
export type ColumnKind =
  'text' | 'date' | 'datetime' | 'int' | 'decimal' | 'money' | 'bool' | 'json';

/** Nombres que el LEEME y las celdas resuelven a partir de un `Id`. */
export type ExportLookups = {
  readonly users: ReadonlyMap<string, string>;
  readonly animals: ReadonlyMap<string, string>;
  readonly breeds: ReadonlyMap<string, string>;
  readonly lots: ReadonlyMap<string, string>;
  readonly vaccines: ReadonlyMap<string, string>;
  readonly tags: ReadonlyMap<string, string>;
  readonly cycles: ReadonlyMap<string, string>;
  readonly expenses: ReadonlyMap<string, string>;
};

export type ExportColumn<Row> = {
  readonly header: string;
  /** Qué significa la columna, para el LEEME. */
  readonly description: string;
  readonly kind: ColumnKind;
  readonly value: (row: Row, lookups: ExportLookups) => unknown;
};

export type ExportSheet<Row> = {
  /** Nombre del archivo dentro del ZIP: ASCII, sin tildes ni ñ. */
  readonly file: string;
  /** Nombre de la hoja y del archivo en el LEEME, en español. */
  readonly title: string;
  readonly description: string;
  readonly columns: readonly ExportColumn<Row>[];
  /** El siguiente bloque de filas después de `after` (el cursor de la fila anterior). */
  readonly fetch: (
    tx: Tx,
    farmId: string,
    after: string | null,
    take: number,
  ) => Promise<readonly Row[]>;
  /** El cursor de una fila: su `Id` (o el número de la auditoría). */
  readonly cursor: (row: Row) => string;
};

function sheet<Row>(spec: ExportSheet<Row>): ExportSheet<unknown> {
  return spec as ExportSheet<unknown>;
}

const byId = { orderBy: { id: 'asc' as const } };
const afterId = (after: string | null) => (after === null ? {} : { id: { gt: after } });
const name = (map: ReadonlyMap<string, string>, id: string | null | undefined) =>
  id === null || id === undefined ? null : (map.get(id) ?? null);
const label = <K extends string>(labels: Readonly<Record<K, string>>, value: K | null) =>
  value === null ? null : labels[value];

const ID: ExportColumn<{ id: string }> = {
  header: 'Id',
  description:
    'Identificador único de la fila (UUID). Otros archivos lo usan para referirse a ella.',
  kind: 'text',
  value: (row) => row.id,
};

function voided<Row extends { voidedAt: Date | null; voidReason?: string | null }>(
  what: string,
  withReason = true,
): ExportColumn<Row>[] {
  return [
    {
      header: 'Anulado',
      description: `«Sí» si ${what} se anuló: ya no cuenta, pero se conserva (RN-11).`,
      kind: 'bool',
      value: (row) => row.voidedAt !== null,
    },
    {
      header: 'Fecha de anulación',
      description: 'Cuándo se anuló, en hora de Colombia.',
      kind: 'datetime',
      value: (row) => row.voidedAt,
    },
    ...(withReason
      ? [
          {
            header: 'Motivo de anulación',
            description: 'Por qué se anuló.',
            kind: 'text' as const,
            value: (row: Row) => row.voidReason ?? null,
          },
        ]
      : []),
  ];
}

function createdBy<Row extends { createdById: string; createdAt: Date }>(): ExportColumn<Row>[] {
  return [
    {
      header: 'Registrado por',
      description: 'Usuario que lo registró.',
      kind: 'text',
      value: (row, lookups) => name(lookups.users, row.createdById),
    },
    {
      header: 'Registrado el',
      description: 'Cuándo se registró en Arreo, en hora de Colombia.',
      kind: 'datetime',
      value: (row) => row.createdAt,
    },
  ];
}

function animalRef<Row extends { animalId: string }>(): ExportColumn<Row>[] {
  return [
    {
      header: 'Animal',
      description: 'Código del animal (el de animales.xlsx).',
      kind: 'text',
      value: (row, lookups) => name(lookups.animals, row.animalId),
    },
    {
      header: 'Id del animal',
      description: 'Id del animal en animales.xlsx.',
      kind: 'text',
      value: (row) => row.animalId,
    },
  ];
}

// --- Finca y usuarios -------------------------------------------------------------------------

type FarmRow = { id: string; field: string; value: unknown };

const FARM = sheet<FarmRow>({
  file: 'finca.xlsx',
  title: 'Finca',
  description:
    'Los datos de la finca y su configuración (parámetros de manejo, sistema productivo, umbrales), un parámetro por fila.',
  columns: [
    {
      header: 'Parámetro',
      description: 'Nombre del dato o del parámetro de configuración.',
      kind: 'text',
      value: (row) => row.field,
    },
    {
      header: 'Valor',
      description: 'Su valor; las listas y los grupos de valores van en formato JSON.',
      kind: 'json',
      value: (row) => row.value,
    },
  ],
  fetch: async (tx, farmId, after) => {
    if (after !== null) return [];
    const farm = await tx.farm.findUniqueOrThrow({ where: { id: farmId } });
    const settings = (farm.settings ?? {}) as Record<string, unknown>;
    return [
      { id: '1', field: 'Id', value: farm.id },
      { id: '2', field: 'Nombre', value: farm.name },
      { id: '3', field: 'Municipio', value: farm.municipality },
      { id: '4', field: 'Departamento', value: farm.department },
      { id: '5', field: 'Código de predio ICA', value: farm.icaPremiseCode },
      ...Object.keys(settings)
        .sort()
        .map((key, index) => ({ id: String(6 + index), field: key, value: settings[key] })),
    ];
  },
  cursor: (row) => row.id,
});

type UserRow = Prisma.MembershipGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        name: true;
        username: true;
        email: true;
        isActive: true;
        mustChangePassword: true;
        lastLoginAt: true;
        createdAt: true;
      };
    };
  };
}>;

const USERS = sheet<UserRow>({
  file: 'usuarios.xlsx',
  title: 'Usuarios',
  description:
    'Las personas con acceso a la finca y su rol. No trae contraseñas, ni sesiones, ni intentos de inicio de sesión.',
  columns: [
    {
      header: 'Id',
      description: 'Id del usuario; otros archivos lo nombran en «Registrado por».',
      kind: 'text',
      value: (row) => row.user.id,
    },
    {
      header: 'Usuario',
      description: 'Nombre de usuario para entrar.',
      kind: 'text',
      value: (row) => row.user.username,
    },
    {
      header: 'Nombre',
      description: 'Nombre de la persona.',
      kind: 'text',
      value: (row) => row.user.name,
    },
    {
      header: 'Correo',
      description: 'Correo electrónico, si lo tiene.',
      kind: 'text',
      value: (row) => row.user.email,
    },
    {
      header: 'Rol',
      description: 'Administrador, Operario o Veterinario.',
      kind: 'text',
      value: (row) => ROLE_LABEL[row.role],
    },
    {
      header: 'Acceso a la finca activo',
      description: '«No» si se le quitó el acceso a esta finca.',
      kind: 'bool',
      value: (row) => row.isActive,
    },
    {
      header: 'Cuenta activa',
      description: '«No» si la cuenta está desactivada.',
      kind: 'bool',
      value: (row) => row.user.isActive,
    },
    {
      header: 'Debe cambiar la contraseña',
      description: '«Sí» si tiene una contraseña temporal.',
      kind: 'bool',
      value: (row) => row.user.mustChangePassword,
    },
    {
      header: 'Último ingreso',
      description: 'Último inicio de sesión, en hora de Colombia.',
      kind: 'datetime',
      value: (row) => row.user.lastLoginAt,
    },
    {
      header: 'Creado el',
      description: 'Cuándo se creó la cuenta.',
      kind: 'datetime',
      value: (row) => row.user.createdAt,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.membership.findMany({
      where: { farmId, ...afterId(after) },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true,
            mustChangePassword: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
      ...byId,
      take,
    }),
  cursor: (row) => row.id,
});

// --- Catálogos --------------------------------------------------------------------------------

type BreedRow = Prisma.BreedGetPayload<object>;
const BREEDS = sheet<BreedRow>({
  file: 'razas.xlsx',
  title: 'Razas',
  description: 'El catálogo de razas, con su grupo racial y sus días de gestación.',
  columns: [
    ID,
    { header: 'Nombre', description: 'Nombre de la raza.', kind: 'text', value: (row) => row.name },
    {
      header: 'Grupo racial',
      description: 'Cebuino, Europeo o Cruce.',
      kind: 'text',
      value: (row) => BREED_GROUP_LABEL[row.group],
    },
    {
      header: 'Días de gestación',
      description: 'Gestación propia de la raza; vacío si usa la de la finca.',
      kind: 'int',
      value: (row) => row.gestationDays,
    },
    {
      header: 'Activa',
      description: '«No» si se desactivó.',
      kind: 'bool',
      value: (row) => row.isActive,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.breed.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type VaccineRow = Prisma.VaccineGetPayload<object>;
const VACCINES = sheet<VaccineRow>({
  file: 'vacunas.xlsx',
  title: 'Vacunas',
  description: 'El catálogo de vacunas y cómo se programa cada una.',
  columns: [
    ID,
    {
      header: 'Nombre',
      description: 'Nombre de la vacuna.',
      kind: 'text',
      value: (row) => row.name,
    },
    {
      header: 'Enfermedad',
      description: 'Enfermedad que previene.',
      kind: 'text',
      value: (row) => row.disease,
    },
    {
      header: 'Dosis',
      description: 'Dosis habitual.',
      kind: 'text',
      value: (row) => row.defaultDose,
    },
    { header: 'Vía', description: 'Vía de aplicación.', kind: 'text', value: (row) => row.route },
    {
      header: 'Programación',
      description: 'Ciclo oficial, Por edad, Por intervalo o Sin alerta.',
      kind: 'text',
      value: (row) => VACCINE_SCHEDULE_LABEL[row.scheduleType],
    },
    {
      header: 'Refuerzo cada (días)',
      description: 'Días entre aplicaciones, en las vacunas por intervalo.',
      kind: 'int',
      value: (row) => row.boosterIntervalDays,
    },
    {
      header: 'Sexo',
      description: 'Sexo al que se aplica; vacío si a ambos.',
      kind: 'text',
      value: (row) => label(SEX_LABEL, row.eligibleSex),
    },
    {
      header: 'Edad mínima (días)',
      description: 'Edad mínima.',
      kind: 'int',
      value: (row) => row.minAgeDays,
    },
    {
      header: 'Edad máxima (días)',
      description: 'Edad máxima.',
      kind: 'int',
      value: (row) => row.maxAgeDays,
    },
    {
      header: 'Bloquea el otro sexo',
      description: '«Sí» si no se puede registrar en el otro sexo (brucelosis en machos).',
      kind: 'bool',
      value: (row) => row.blockIneligibleSex,
    },
    {
      header: 'Activa',
      description: '«No» si se desactivó.',
      kind: 'bool',
      value: (row) => row.isActive,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.vaccine.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type CycleRow = Prisma.VaccinationCycleGetPayload<object>;
const CYCLES = sheet<CycleRow>({
  file: 'ciclos-de-vacunacion.xlsx',
  title: 'Ciclos de vacunación',
  description: 'Los ciclos de vacunación (los oficiales del ICA y los de la finca).',
  columns: [
    ID,
    { header: 'Nombre', description: 'Nombre del ciclo.', kind: 'text', value: (row) => row.name },
    {
      header: 'Desde',
      description: 'Primer día del ciclo.',
      kind: 'date',
      value: (row) => row.startsOn,
    },
    {
      header: 'Hasta',
      description: 'Último día del ciclo.',
      kind: 'date',
      value: (row) => row.endsOn,
    },
    {
      header: 'Oficial',
      description: '«Sí» si es un ciclo oficial del ICA.',
      kind: 'bool',
      value: (row) => row.isOfficial,
    },
    {
      header: 'Activo',
      description: '«No» si se desactivó.',
      kind: 'bool',
      value: (row) => row.isActive,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.vaccinationCycle.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type CycleVaccineRow = Prisma.VaccinationCycleVaccineGetPayload<object>;
const CYCLE_VACCINES = sheet<CycleVaccineRow>({
  file: 'vacunas-de-ciclos.xlsx',
  title: 'Vacunas de cada ciclo',
  description:
    'Qué vacunas incluye cada ciclo. Las que se quitaron siguen, con la fecha en que se quitaron.',
  columns: [
    ID,
    {
      header: 'Ciclo',
      description: 'Nombre del ciclo.',
      kind: 'text',
      value: (row, l) => name(l.cycles, row.cycleId),
    },
    {
      header: 'Id del ciclo',
      description: 'Id en ciclos-de-vacunacion.xlsx.',
      kind: 'text',
      value: (row) => row.cycleId,
    },
    {
      header: 'Vacuna',
      description: 'Nombre de la vacuna.',
      kind: 'text',
      value: (row, l) => name(l.vaccines, row.vaccineId),
    },
    {
      header: 'Id de la vacuna',
      description: 'Id en vacunas.xlsx.',
      kind: 'text',
      value: (row) => row.vaccineId,
    },
    {
      header: 'Agregada el',
      description: 'Cuándo se agregó al ciclo.',
      kind: 'datetime',
      value: (row) => row.createdAt,
    },
    {
      header: 'Quitada el',
      description: 'Cuándo se quitó del ciclo, si se quitó.',
      kind: 'datetime',
      value: (row) => row.removedAt,
    },
    {
      header: 'Quitada por',
      description: 'Usuario que la quitó.',
      kind: 'text',
      value: (row, l) => name(l.users, row.removedById),
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.vaccinationCycleVaccine.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type LotRow = Prisma.LotGetPayload<object>;
const LOTS = sheet<LotRow>({
  file: 'lotes.xlsx',
  title: 'Lotes',
  description: 'Los lotes o potreros de la finca.',
  columns: [
    ID,
    { header: 'Nombre', description: 'Nombre del lote.', kind: 'text', value: (row) => row.name },
    {
      header: 'Descripción',
      description: 'Descripción.',
      kind: 'text',
      value: (row) => row.description,
    },
    {
      header: 'Activo',
      description: '«No» si se desactivó.',
      kind: 'bool',
      value: (row) => row.isActive,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.lot.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type TagRow = Prisma.TagGetPayload<object>;
const TAGS = sheet<TagRow>({
  file: 'etiquetas.xlsx',
  title: 'Etiquetas',
  description:
    'Las etiquetas manuales (Cotero, Disponible para venta, Reproductor y las de la finca).',
  columns: [
    ID,
    {
      header: 'Clave',
      description: 'Clave interna de la etiqueta.',
      kind: 'text',
      value: (row) => row.key,
    },
    {
      header: 'Nombre',
      description: 'Nombre que se muestra.',
      kind: 'text',
      value: (row) => row.label,
    },
    {
      header: 'Descripción',
      description: 'Descripción.',
      kind: 'text',
      value: (row) => row.description,
    },
    {
      header: 'Del sistema',
      description: '«Sí» si la trae Arreo y no se puede borrar.',
      kind: 'bool',
      value: (row) => row.isSystem,
    },
    {
      header: 'Activa',
      description: '«No» si se desactivó.',
      kind: 'bool',
      value: (row) => row.isActive,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.tag.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type ScaleProfileRow = Prisma.ScaleProfileGetPayload<object>;
const SCALE_PROFILES = sheet<ScaleProfileRow>({
  file: 'perfiles-de-bascula.xlsx',
  title: 'Perfiles de báscula',
  description: 'Cómo se leen los archivos de la báscula de la finca (PES-04).',
  columns: [
    ID,
    { header: 'Nombre', description: 'Nombre del perfil.', kind: 'text', value: (row) => row.name },
    {
      header: 'Formato',
      description: 'CSV o Excel.',
      kind: 'text',
      value: (row) => SCALE_FILE_FORMAT_LABEL[row.fileFormat],
    },
    {
      header: 'Columnas',
      description: 'Qué columna del archivo es cada dato, en formato JSON.',
      kind: 'json',
      value: (row) => row.columnMapping,
    },
    {
      header: 'Plantilla de origen',
      description: 'Plantilla del sistema de la que se copió, si alguna.',
      kind: 'text',
      value: (row) => row.sourceTemplateKey,
    },
    ...createdBy<ScaleProfileRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.scaleProfile.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

// --- Animales ---------------------------------------------------------------------------------

type AnimalRow = Prisma.AnimalGetPayload<object>;
const ANIMALS = sheet<AnimalRow>({
  file: 'animales.xlsx',
  title: 'Animales',
  description:
    'Todos los animales que han pasado por la finca: activos, los que salieron y los archivados. La edad, la categoría y el número de partos no se guardan: se calculan con las fechas y los eventos de los demás archivos.',
  columns: [
    ID,
    {
      header: 'Código',
      description: 'Código interno del animal en la finca.',
      kind: 'text',
      value: (row) => row.code,
    },
    {
      header: 'Nombre',
      description: 'Nombre, si lo tiene.',
      kind: 'text',
      value: (row) => row.name,
    },
    {
      header: 'Sexo',
      description: 'Hembra o Macho.',
      kind: 'text',
      value: (row) => SEX_LABEL[row.sex],
    },
    {
      header: 'Raza',
      description: 'Nombre de la raza.',
      kind: 'text',
      value: (row, l) => name(l.breeds, row.breedId),
    },
    {
      header: 'Id de la raza',
      description: 'Id en razas.xlsx.',
      kind: 'text',
      value: (row) => row.breedId,
    },
    {
      header: 'Fecha de nacimiento',
      description: 'Fecha de nacimiento.',
      kind: 'date',
      value: (row) => row.birthDate,
    },
    {
      header: 'Nacimiento aproximado',
      description: '«Sí» si la fecha de nacimiento es aproximada.',
      kind: 'bool',
      value: (row) => row.birthDateEstimated,
    },
    {
      header: 'Procedencia',
      description: 'Nació en la finca o Comprado.',
      kind: 'text',
      value: (row) => ORIGIN_LABEL[row.origin],
    },
    {
      header: 'Vendedor u origen',
      description: 'De dónde vino, si se compró.',
      kind: 'text',
      value: (row) => row.originDetail,
    },
    {
      header: 'Fecha de ingreso',
      description: 'Cuándo entró a la finca.',
      kind: 'date',
      value: (row) => row.entryDate,
    },
    {
      header: 'Ingreso aproximado',
      description: '«Sí» si la fecha de ingreso es aproximada.',
      kind: 'bool',
      value: (row) => row.entryDateEstimated,
    },
    {
      header: 'Partos anteriores importados',
      description: 'Partos que traía de antes, cargados con la importación del inventario.',
      kind: 'int',
      value: (row) => row.importedPriorCalvings,
    },
    {
      header: 'Madre',
      description: 'Código de la madre.',
      kind: 'text',
      value: (row, l) => name(l.animals, row.damId),
    },
    {
      header: 'Id de la madre',
      description: 'Id de la madre en este archivo.',
      kind: 'text',
      value: (row) => row.damId,
    },
    {
      header: 'Padre',
      description: 'Código del padre, si es de la finca.',
      kind: 'text',
      value: (row, l) => name(l.animals, row.sireId),
    },
    {
      header: 'Id del padre',
      description: 'Id del padre en este archivo.',
      kind: 'text',
      value: (row) => row.sireId,
    },
    {
      header: 'Padre externo',
      description: 'Toro o pajilla de fuera de la finca.',
      kind: 'text',
      value: (row) => row.sireExternalRef,
    },
    {
      header: 'Id de la preñez en que nació',
      description: 'Id en prenez-y-partos.xlsx, si nació en la finca con el parto registrado.',
      kind: 'text',
      value: (row) => row.birthPregnancyId,
    },
    {
      header: 'Estado al nacer',
      description: 'Sana o Débil.',
      kind: 'text',
      value: (row) => label(BIRTH_CONDITION_LABEL, row.birthCondition),
    },
    {
      header: 'Lote',
      description: 'Lote actual.',
      kind: 'text',
      value: (row, l) => name(l.lots, row.lotId),
    },
    {
      header: 'Id del lote',
      description: 'Id en lotes.xlsx.',
      kind: 'text',
      value: (row) => row.lotId,
    },
    {
      header: 'Disponible para venta',
      description: '«Sí» si está marcado para la venta.',
      kind: 'bool',
      value: (row) => row.forSale,
    },
    {
      header: 'Tipo de salida',
      description:
        'Venta, Muerte, Sacrificio, Robo, Traslado a otra finca u Otra salida; vacío si sigue en la finca.',
      kind: 'text',
      value: (row) => label(EXIT_TYPE_LABEL, row.exitType),
    },
    {
      header: 'Fecha de salida',
      description: 'Cuándo salió.',
      kind: 'date',
      value: (row) => row.exitDate,
    },
    {
      header: 'Motivo de salida',
      description: 'Detalle de la salida.',
      kind: 'text',
      value: (row) => row.exitReason,
    },
    {
      header: 'Observaciones',
      description: 'Observaciones.',
      kind: 'text',
      value: (row) => row.notes,
    },
    {
      header: 'Archivado',
      description:
        '«Sí» si se archivó (se registró por error o está repetido): no cuenta, pero se conserva.',
      kind: 'bool',
      value: (row) => row.deletedAt !== null,
    },
    {
      header: 'Fecha de archivo',
      description: 'Cuándo se archivó.',
      kind: 'datetime',
      value: (row) => row.deletedAt,
    },
    {
      header: 'Motivo de archivo',
      description: 'Por qué se archivó.',
      kind: 'text',
      value: (row) => row.deletedReason,
    },
    ...createdBy<AnimalRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.animal.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type IdentifierRow = Prisma.IdentifierGetPayload<object>;
const IDENTIFIERS = sheet<IdentifierRow>({
  file: 'identificadores.xlsx',
  title: 'Identificadores',
  description:
    'Chapetas, DIN, chips (RFID), QR y hierros de cada animal, con los que se retiraron. El DIN y el chip son de por vida (RN-32).',
  columns: [
    ID,
    ...animalRef<IdentifierRow>(),
    {
      header: 'Tipo',
      description: 'Chapeta, DIN, Chip, QR, Hierro u Otro.',
      kind: 'text',
      value: (row) => IDENTIFIER_TYPE_LABEL[row.type],
    },
    {
      header: 'Valor',
      description: 'Número o código del identificador.',
      kind: 'text',
      value: (row) => row.value,
    },
    {
      header: 'Dónde va el chip',
      description:
        'Solo en los chips: Chip en arete, Chip inyectable o Bolo ruminal; vacío si no se indicó.',
      kind: 'text',
      value: (row) => label(RFID_CARRIER_LABEL, row.carrier),
    },
    {
      header: 'Asignado el',
      description: 'Desde cuándo lo tiene.',
      kind: 'date',
      value: (row) => row.assignedAt,
    },
    {
      header: 'Retirado el',
      description: 'Cuándo se retiró; vacío si sigue vigente.',
      kind: 'date',
      value: (row) => row.retiredAt,
    },
    {
      header: 'Motivo de retiro',
      description:
        'Pérdida, Daño, Reasignación oficial, Liberada al salir de la finca, Retirado al archivar el animal u Otro motivo.',
      kind: 'text',
      value: (row) => label(RETIRE_REASON_LABEL, row.retireReason),
    },
    {
      header: 'Reemplazado por',
      description: 'Id del identificador que lo reemplazó, si alguno.',
      kind: 'text',
      value: (row) => row.replacedById,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.identifier.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type AnimalTagRow = Prisma.AnimalTagGetPayload<object>;
const ANIMAL_TAGS = sheet<AnimalTagRow>({
  file: 'etiquetas-de-animales.xlsx',
  title: 'Etiquetas de los animales',
  description:
    'Qué etiqueta manual tuvo cada animal y desde cuándo; las quitadas siguen con su fecha.',
  columns: [
    ID,
    ...animalRef<AnimalTagRow>(),
    {
      header: 'Etiqueta',
      description: 'Nombre de la etiqueta.',
      kind: 'text',
      value: (row, l) => name(l.tags, row.tagId),
    },
    {
      header: 'Id de la etiqueta',
      description: 'Id en etiquetas.xlsx.',
      kind: 'text',
      value: (row) => row.tagId,
    },
    {
      header: 'Quitada el',
      description: 'Cuándo se quitó, si se quitó.',
      kind: 'datetime',
      value: (row) => row.removedAt,
    },
    {
      header: 'Quitada por',
      description: 'Usuario que la quitó.',
      kind: 'text',
      value: (row, l) => name(l.users, row.removedById),
    },
    ...createdBy<AnimalTagRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.animalTag.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type LotMovementRow = Prisma.LotMovementGetPayload<object>;
const LOT_MOVEMENTS = sheet<LotMovementRow>({
  file: 'movimientos-de-lote.xlsx',
  title: 'Movimientos de lote',
  description: 'Cada cambio de lote de un animal.',
  columns: [
    ID,
    ...animalRef<LotMovementRow>(),
    {
      header: 'Desde el lote',
      description: 'Lote anterior.',
      kind: 'text',
      value: (row, l) => name(l.lots, row.fromLotId),
    },
    {
      header: 'Al lote',
      description: 'Lote nuevo.',
      kind: 'text',
      value: (row, l) => name(l.lots, row.toLotId),
    },
    {
      header: 'Fecha',
      description: 'Día del movimiento.',
      kind: 'date',
      value: (row) => row.movedOn,
    },
    {
      header: 'Id de la jornada',
      description: 'Id en jornadas.xlsx, si fue en una jornada.',
      kind: 'text',
      value: (row) => row.workSessionId,
    },
    ...createdBy<LotMovementRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.lotMovement.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

// --- Reproducción, sanidad y pesos -------------------------------------------------------------

type PregnancyRow = Prisma.PregnancyGetPayload<object>;
const PREGNANCIES = sheet<PregnancyRow>({
  file: 'prenez-y-partos.xlsx',
  title: 'Preñez y partos',
  description:
    'Cada servicio con su diagnóstico y su desenlace (parto, aborto o vacía). Las crías de cada parto están en animales.xlsx con «Id de la preñez en que nació».',
  columns: [
    ID,
    {
      header: 'Madre',
      description: 'Código de la hembra.',
      kind: 'text',
      value: (row, l) => name(l.animals, row.damId),
    },
    {
      header: 'Id de la madre',
      description: 'Id en animales.xlsx.',
      kind: 'text',
      value: (row) => row.damId,
    },
    {
      header: 'Fecha de servicio',
      description: 'Día del servicio.',
      kind: 'date',
      value: (row) => row.serviceDate,
    },
    {
      header: 'Servicio aproximado',
      description:
        '«Sí» si la fecha de servicio se estimó (por ejemplo, desde el parto importado).',
      kind: 'bool',
      value: (row) => row.serviceDateEstimated,
    },
    {
      header: 'Tipo de servicio',
      description: 'Monta natural, Inseminación o Sin servicio conocido.',
      kind: 'text',
      value: (row) => SERVICE_METHOD_LABEL[row.method],
    },
    {
      header: 'Padre',
      description: 'Código del toro, si es de la finca.',
      kind: 'text',
      value: (row, l) => name(l.animals, row.sireId),
    },
    {
      header: 'Padre externo',
      description: 'Toro o pajilla de fuera.',
      kind: 'text',
      value: (row) => row.sireExternalRef,
    },
    {
      header: 'Preñez confirmada el',
      description: 'Día del diagnóstico positivo.',
      kind: 'date',
      value: (row) => row.confirmedAt,
    },
    {
      header: 'Diagnosticó',
      description: 'Quién hizo el diagnóstico.',
      kind: 'text',
      value: (row) => row.diagnosisResponsible,
    },
    {
      header: 'Notas del diagnóstico',
      description: 'Notas de la palpación.',
      kind: 'text',
      value: (row) => row.diagnosisNotes,
    },
    {
      header: 'Parto estimado',
      description: 'Fecha estimada de parto.',
      kind: 'date',
      value: (row) => row.expectedCalvingDate,
    },
    {
      header: 'Parto estimado a mano',
      description: '«Sí» si alguien corrigió la fecha estimada a mano.',
      kind: 'bool',
      value: (row) => row.expectedCalvingManual,
    },
    {
      header: 'Desenlace',
      description: 'Abierta, Parto, Aborto o Vacía en la palpación.',
      kind: 'text',
      value: (row) => PREGNANCY_OUTCOME_LABEL[row.outcome],
    },
    {
      header: 'Fecha del desenlace',
      description: 'Día del parto, del aborto o de la palpación vacía.',
      kind: 'date',
      value: (row) => row.outcomeDate,
    },
    {
      header: 'Tipo de parto',
      description: 'Normal, Asistido o Cesárea.',
      kind: 'text',
      value: (row) => label(CALVING_TYPE_LABEL, row.calvingType),
    },
    {
      header: 'Muertos al nacer',
      description: 'Crías muertas al nacer.',
      kind: 'int',
      value: (row) => row.stillbornCount,
    },
    {
      header: 'Importada',
      description: '«Sí» si vino de la importación del inventario (último parto).',
      kind: 'bool',
      value: (row) => row.isImported,
    },
    {
      header: 'Responsable',
      description: 'Quién atendió.',
      kind: 'text',
      value: (row) => row.responsible,
    },
    {
      header: 'Observaciones',
      description: 'Observaciones.',
      kind: 'text',
      value: (row) => row.notes,
    },
    ...voided<PregnancyRow>('la preñez'),
    ...createdBy<PregnancyRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.pregnancy.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type VaccinationRow = Prisma.VaccinationRecordGetPayload<object>;
const VACCINATIONS = sheet<VaccinationRow>({
  file: 'vacunaciones.xlsx',
  title: 'Vacunaciones',
  description: 'Cada vacuna aplicada a cada animal.',
  columns: [
    ID,
    ...animalRef<VaccinationRow>(),
    {
      header: 'Vacuna',
      description: 'Nombre de la vacuna.',
      kind: 'text',
      value: (row, l) => name(l.vaccines, row.vaccineId),
    },
    {
      header: 'Id de la vacuna',
      description: 'Id en vacunas.xlsx.',
      kind: 'text',
      value: (row) => row.vaccineId,
    },
    {
      header: 'Fecha',
      description: 'Día de aplicación.',
      kind: 'date',
      value: (row) => row.appliedOn,
    },
    { header: 'Dosis', description: 'Dosis aplicada.', kind: 'text', value: (row) => row.dose },
    {
      header: 'Lote del biológico',
      description: 'Lote del frasco.',
      kind: 'text',
      value: (row) => row.batchNumber,
    },
    {
      header: 'RUV',
      description: 'Número del Registro Único de Vacunación.',
      kind: 'text',
      value: (row) => row.ruvNumber,
    },
    {
      header: 'Ciclo',
      description: 'Ciclo de vacunación, si fue en uno.',
      kind: 'text',
      value: (row, l) => name(l.cycles, row.cycleId),
    },
    {
      header: 'Responsable',
      description: 'Quién vacunó.',
      kind: 'text',
      value: (row) => row.responsible,
    },
    {
      header: 'Próxima dosis',
      description: 'Fecha de la siguiente, si aplica.',
      kind: 'date',
      value: (row) => row.nextDueOn,
    },
    {
      header: 'Id de la jornada',
      description: 'Id en jornadas.xlsx, si fue en una jornada.',
      kind: 'text',
      value: (row) => row.workSessionId,
    },
    {
      header: 'Observaciones',
      description: 'Observaciones.',
      kind: 'text',
      value: (row) => row.notes,
    },
    ...voided<VaccinationRow>('la vacunación'),
    ...createdBy<VaccinationRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.vaccinationRecord.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type TreatmentRow = Prisma.TreatmentRecordGetPayload<object>;
const TREATMENTS = sheet<TreatmentRow>({
  file: 'tratamientos.xlsx',
  title: 'Tratamientos',
  description:
    'Cada tratamiento, con los días de retiro de carne y de leche. Su costo, si lo tiene, está en gastos.xlsx.',
  columns: [
    ID,
    ...animalRef<TreatmentRow>(),
    {
      header: 'Inicio',
      description: 'Día en que empezó.',
      kind: 'date',
      value: (row) => row.startedOn,
    },
    {
      header: 'Motivo',
      description: 'Por qué se trató.',
      kind: 'text',
      value: (row) => row.reason,
    },
    {
      header: 'Medicamento',
      description: 'Medicamento.',
      kind: 'text',
      value: (row) => row.medication,
    },
    { header: 'Dosis', description: 'Dosis.', kind: 'text', value: (row) => row.dose },
    {
      header: 'Duración (días)',
      description: 'Días de tratamiento.',
      kind: 'int',
      value: (row) => row.durationDays,
    },
    {
      header: 'Retiro de carne (días)',
      description: 'Días de retiro para la carne.',
      kind: 'int',
      value: (row) => row.withdrawalMeatDays,
    },
    {
      header: 'Retiro de leche (días)',
      description: 'Días de retiro para la leche.',
      kind: 'int',
      value: (row) => row.withdrawalMilkDays,
    },
    {
      header: 'En retiro hasta',
      description: 'Último día de retiro de carne.',
      kind: 'date',
      value: (row) => row.withdrawalUntil,
    },
    {
      header: 'Responsable',
      description: 'Quién trató.',
      kind: 'text',
      value: (row) => row.responsible,
    },
    {
      header: 'Id del gasto',
      description: 'Id en gastos.xlsx, si se registró el costo.',
      kind: 'text',
      value: (row) => row.expenseId,
    },
    {
      header: 'Id de la jornada',
      description: 'Id en jornadas.xlsx, si fue en una jornada.',
      kind: 'text',
      value: (row) => row.workSessionId,
    },
    {
      header: 'Observaciones',
      description: 'Observaciones.',
      kind: 'text',
      value: (row) => row.notes,
    },
    ...voided<TreatmentRow>('el tratamiento'),
    ...createdBy<TreatmentRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.treatmentRecord.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type WeightRow = Prisma.WeightRecordGetPayload<object>;
const WEIGHTS = sheet<WeightRow>({
  file: 'pesajes.xlsx',
  title: 'Pesajes',
  description: 'Cada pesaje de cada animal, en kilos.',
  columns: [
    ID,
    ...animalRef<WeightRow>(),
    {
      header: 'Fecha',
      description: 'Día del pesaje.',
      kind: 'date',
      value: (row) => row.weighedOn,
    },
    {
      header: 'Peso (kg)',
      description: 'Peso en kilos, con dos decimales.',
      kind: 'decimal',
      value: (row) => row.weightKg,
    },
    {
      header: 'Método',
      description: 'Báscula, Cinta o Estimado.',
      kind: 'text',
      value: (row) => WEIGHT_METHOD_LABEL[row.method],
    },
    {
      header: 'Peso al nacer',
      description: '«Sí» si es el peso al nacer.',
      kind: 'bool',
      value: (row) => row.isBirthWeight,
    },
    {
      header: 'Identificado con',
      description: 'Búsqueda, Lector de chip, QR o Archivo de la báscula.',
      kind: 'text',
      value: (row) => label(IDENTIFIED_BY_LABEL, row.identifiedBy),
    },
    {
      header: 'Origen del peso',
      description: 'Digitado, Archivo de la báscula o Báscula en vivo.',
      kind: 'text',
      value: (row) => WEIGHT_SOURCE_LABEL[row.weightSource],
    },
    {
      header: 'Serie de la báscula',
      description: 'Número de serie del indicador.',
      kind: 'text',
      value: (row) => row.scaleSerial,
    },
    {
      header: 'Id de la jornada',
      description: 'Id en jornadas.xlsx, si fue en una jornada.',
      kind: 'text',
      value: (row) => row.workSessionId,
    },
    {
      header: 'Observaciones',
      description: 'Observaciones.',
      kind: 'text',
      value: (row) => row.notes,
    },
    ...voided<WeightRow>('el pesaje'),
    ...createdBy<WeightRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.weightRecord.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

// --- Finanzas ---------------------------------------------------------------------------------

type ExpenseRow = Prisma.ExpenseGetPayload<object>;
const EXPENSES = sheet<ExpenseRow>({
  file: 'gastos.xlsx',
  title: 'Gastos',
  description:
    'Cada gasto, con cómo se repartió. Lo que le tocó a cada animal está en reparto-de-gastos.xlsx.',
  columns: [
    ID,
    {
      header: 'Tipo',
      description: 'Compra, Alimentación, Medicamentos, Vacunas, Veterinario, Transporte u Otro.',
      kind: 'text',
      value: (row) => EXPENSE_TYPE_LABEL[row.type],
    },
    {
      header: 'Fecha',
      description: 'Día del gasto.',
      kind: 'date',
      value: (row) => row.occurredOn,
    },
    {
      header: 'Valor',
      description: 'Valor en pesos colombianos.',
      kind: 'money',
      value: (row) => row.amount,
    },
    {
      header: 'Descripción',
      description: 'Descripción.',
      kind: 'text',
      value: (row) => row.description,
    },
    {
      header: 'Reparto',
      description: 'Un animal, Partes iguales, Según el peso o Gasto general.',
      kind: 'text',
      value: (row) => ALLOCATION_METHOD_LABEL[row.allocationMethod],
    },
    {
      header: 'Lote',
      description: 'Lote al que se cargó, si fue por lote.',
      kind: 'text',
      value: (row, l) => name(l.lots, row.lotId),
    },
    ...voided<ExpenseRow>('el gasto'),
    ...createdBy<ExpenseRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.expense.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type AllocationRow = Prisma.ExpenseAllocationGetPayload<object>;
const ALLOCATIONS = sheet<AllocationRow>({
  file: 'reparto-de-gastos.xlsx',
  title: 'Reparto de gastos',
  description:
    'La parte de cada gasto que le tocó a cada animal. Al corregir un gasto, el reparto anterior queda anulado y el nuevo vigente.',
  columns: [
    ID,
    {
      header: 'Gasto',
      description: 'Descripción del gasto.',
      kind: 'text',
      value: (row, l) => name(l.expenses, row.expenseId),
    },
    {
      header: 'Id del gasto',
      description: 'Id en gastos.xlsx.',
      kind: 'text',
      value: (row) => row.expenseId,
    },
    ...animalRef<AllocationRow>(),
    {
      header: 'Valor',
      description: 'Parte del gasto, en pesos.',
      kind: 'money',
      value: (row) => row.amount,
    },
    ...voided<AllocationRow>('la parte', false),
    {
      header: 'Registrado el',
      description: 'Cuándo se registró, en hora de Colombia.',
      kind: 'datetime',
      value: (row) => row.createdAt,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.expenseAllocation.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type SaleRow = Prisma.SaleGetPayload<object>;
const SALES = sheet<SaleRow>({
  file: 'ventas.xlsx',
  title: 'Ventas',
  description: 'Cada venta de un animal.',
  columns: [
    ID,
    ...animalRef<SaleRow>(),
    { header: 'Fecha', description: 'Día de la venta.', kind: 'date', value: (row) => row.soldOn },
    {
      header: 'Valor',
      description: 'Precio de venta, en pesos.',
      kind: 'money',
      value: (row) => row.amount,
    },
    { header: 'Comprador', description: 'Comprador.', kind: 'text', value: (row) => row.buyer },
    {
      header: 'Observaciones',
      description: 'Observaciones.',
      kind: 'text',
      value: (row) => row.notes,
    },
    ...voided<SaleRow>('la venta'),
    ...createdBy<SaleRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.sale.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type ValuationRow = Prisma.ValuationGetPayload<object>;
const VALUATIONS = sheet<ValuationRow>({
  file: 'avaluos.xlsx',
  title: 'Avalúos',
  description: 'Lo que vale cada animal en una fecha, a mano o por peso y precio por kilo.',
  columns: [
    ID,
    ...animalRef<ValuationRow>(),
    { header: 'Fecha', description: 'Día del avalúo.', kind: 'date', value: (row) => row.valuedOn },
    { header: 'Valor', description: 'Valor, en pesos.', kind: 'money', value: (row) => row.amount },
    {
      header: 'Método',
      description: 'A mano o Peso × precio por kilo.',
      kind: 'text',
      value: (row) => VALUATION_METHOD_LABEL[row.method],
    },
    ...voided<ValuationRow>('el avalúo'),
    ...createdBy<ValuationRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.valuation.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

// --- Jornadas, importaciones y auditoría ------------------------------------------------------

type WorkSessionRow = Prisma.WorkSessionGetPayload<object>;
const WORK_SESSIONS = sheet<WorkSessionRow>({
  file: 'jornadas.xlsx',
  title: 'Jornadas',
  description: 'Las jornadas de manejo (vacunación, pesaje y demás).',
  columns: [
    ID,
    {
      header: 'Nombre',
      description: 'Nombre de la jornada.',
      kind: 'text',
      value: (row) => row.name,
    },
    {
      header: 'Fecha',
      description: 'Día de la jornada.',
      kind: 'date',
      value: (row) => row.sessionDate,
    },
    {
      header: 'Actividades',
      description: 'Qué se hizo, en formato JSON.',
      kind: 'json',
      value: (row) => row.activities,
    },
    {
      header: 'Lote esperado',
      description: 'Lote que se iba a trabajar.',
      kind: 'text',
      value: (row, l) => name(l.lots, row.expectedLotId),
    },
    {
      header: 'Estado',
      description: 'Abierta o Cerrada.',
      kind: 'text',
      value: (row) => WORK_SESSION_STATUS_LABEL[row.status],
    },
    {
      header: 'Cerrada el',
      description: 'Cuándo se cerró.',
      kind: 'datetime',
      value: (row) => row.closedAt,
    },
    ...createdBy<WorkSessionRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.workSession.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type WorkSessionEntryRow = Prisma.WorkSessionEntryGetPayload<object>;
const WORK_SESSION_ENTRIES = sheet<WorkSessionEntryRow>({
  file: 'entradas-de-jornada.xlsx',
  title: 'Animales de cada jornada',
  description:
    'Qué animales se trabajaron en cada jornada. Los eventos de cada uno están en sus archivos con el «Id de la jornada».',
  columns: [
    ID,
    {
      header: 'Id de la jornada',
      description: 'Id en jornadas.xlsx.',
      kind: 'text',
      value: (row) => row.workSessionId,
    },
    ...animalRef<WorkSessionEntryRow>(),
    {
      header: 'Trabajado el',
      description: 'Cuándo se registró el animal en la jornada.',
      kind: 'datetime',
      value: (row) => row.processedAt,
    },
    {
      header: 'Registrado por',
      description: 'Usuario que lo registró.',
      kind: 'text',
      value: (row, l) => name(l.users, row.createdById),
    },
  ],
  // Las entradas no tienen `farm_id` (M9 lo agrega): se filtran por la jornada.
  fetch: (tx, farmId, after, take) =>
    tx.workSessionEntry.findMany({
      where: { workSession: { farmId }, ...afterId(after) },
      ...byId,
      take,
    }),
  cursor: (row) => row.id,
});

type ImportBatchRow = Prisma.ImportBatchGetPayload<object>;
const IMPORTS = sheet<ImportBatchRow>({
  file: 'importaciones.xlsx',
  title: 'Importaciones',
  description: 'Cada archivo importado (inventario o pesaje de la báscula) y su resultado.',
  columns: [
    ID,
    {
      header: 'Tipo',
      description: 'Inventario o Pesaje de la báscula.',
      kind: 'text',
      value: (row) => IMPORT_KIND_LABEL[row.kind],
    },
    {
      header: 'Archivo',
      description: 'Nombre del archivo.',
      kind: 'text',
      value: (row) => row.fileName,
    },
    {
      header: 'Huella SHA-256',
      description: 'Huella del archivo, para reconocerlo.',
      kind: 'text',
      value: (row) => row.fileSha256,
    },
    {
      header: 'Filas',
      description: 'Filas del archivo.',
      kind: 'int',
      value: (row) => row.totalRows,
    },
    {
      header: 'Filas creadas',
      description: 'Filas que entraron.',
      kind: 'int',
      value: (row) => row.createdRows,
    },
    {
      header: 'Filas con error',
      description: 'Filas que no entraron.',
      kind: 'int',
      value: (row) => row.errorRows,
    },
    {
      header: 'Resumen',
      description: 'Detalle del resultado, en formato JSON.',
      kind: 'json',
      value: (row) => row.summary,
    },
    {
      header: 'Id de la jornada',
      description: 'Id en jornadas.xlsx, si es un pesaje.',
      kind: 'text',
      value: (row) => row.workSessionId,
    },
    ...createdBy<ImportBatchRow>(),
  ],
  fetch: (tx, farmId, after, take) =>
    tx.importBatch.findMany({ where: { farmId, ...afterId(after) }, ...byId, take }),
  cursor: (row) => row.id,
});

type AuditRow = Prisma.AuditLogGetPayload<object>;
/** Filas por archivo de auditoría: Excel admite 1.048.576 por hoja. */
export const AUDIT_ROWS_PER_FILE = 1_000_000;

const AUDIT = sheet<AuditRow>({
  file: 'auditoria.xlsx',
  title: 'Auditoría',
  description:
    'Quién hizo qué y cuándo: cada registro, cambio, archivo, salida, anulación, importación e inicio de sesión. Si pasa de un millón de filas, sigue en auditoria-2.xlsx, auditoria-3.xlsx…',
  columns: [
    {
      header: 'Número',
      description: 'Número consecutivo del registro.',
      kind: 'int',
      value: (row) => row.id,
    },
    {
      header: 'Fecha y hora',
      description: 'Cuándo, en hora de Colombia.',
      kind: 'datetime',
      value: (row) => row.createdAt,
    },
    {
      header: 'Usuario',
      description: 'Quién lo hizo.',
      kind: 'text',
      value: (row, l) => name(l.users, row.userId),
    },
    {
      header: 'Acción',
      description:
        'Registro, Cambio, Archivo, Restauración, Anulación, Salida, Reversión de salida, Inicio de sesión, Importación, Cierre de sesiones o Exportación completa.',
      kind: 'text',
      value: (row) => AUDIT_ACTION_LABEL[row.action],
    },
    {
      header: 'Entidad',
      description: 'Sobre qué (Animal, Pesaje, Gasto…), con el nombre interno.',
      kind: 'text',
      value: (row) => row.entity,
    },
    {
      header: 'Id de la entidad',
      description: 'Id de la fila en su archivo.',
      kind: 'text',
      value: (row) => row.entityId,
    },
    {
      header: 'Cambios',
      description: 'Qué cambió (antes y después), en formato JSON.',
      kind: 'json',
      value: (row) => row.diff,
    },
  ],
  fetch: (tx, farmId, after, take) =>
    tx.auditLog.findMany({
      where: { farmId, ...(after === null ? {} : { id: { gt: BigInt(after) } }) },
      ...byId,
      take,
    }),
  cursor: (row) => row.id.toString(),
});

/** En el orden en que van en el ZIP y en el LEEME. */
export const EXPORT_SHEETS: readonly ExportSheet<unknown>[] = [
  FARM,
  USERS,
  ANIMALS,
  IDENTIFIERS,
  ANIMAL_TAGS,
  LOT_MOVEMENTS,
  PREGNANCIES,
  VACCINATIONS,
  TREATMENTS,
  WEIGHTS,
  EXPENSES,
  ALLOCATIONS,
  SALES,
  VALUATIONS,
  WORK_SESSIONS,
  WORK_SESSION_ENTRIES,
  BREEDS,
  VACCINES,
  CYCLES,
  CYCLE_VACCINES,
  LOTS,
  TAGS,
  SCALE_PROFILES,
  IMPORTS,
  AUDIT,
];

/** El archivo de auditoría número `part` (1, 2, …). */
export function auditFileName(part: number): string {
  return part === 1 ? 'auditoria.xlsx' : `auditoria-${part}.xlsx`;
}

/** Los catálogos y códigos que las celdas resuelven por `Id`. */
export async function loadLookups(tx: Tx, farmId: string): Promise<ExportLookups> {
  const [users, animals, breeds, lots, vaccines, tags, cycles, expenses] = await Promise.all([
    tx.membership.findMany({
      where: { farmId },
      select: { user: { select: { id: true, username: true } } },
    }),
    tx.animal.findMany({ where: { farmId }, select: { id: true, code: true } }),
    tx.breed.findMany({ where: { farmId }, select: { id: true, name: true } }),
    tx.lot.findMany({ where: { farmId }, select: { id: true, name: true } }),
    tx.vaccine.findMany({ where: { farmId }, select: { id: true, name: true } }),
    tx.tag.findMany({ where: { farmId }, select: { id: true, label: true } }),
    tx.vaccinationCycle.findMany({ where: { farmId }, select: { id: true, name: true } }),
    tx.expense.findMany({ where: { farmId }, select: { id: true, description: true } }),
  ]);
  return {
    users: new Map(users.map((row) => [row.user.id, row.user.username])),
    animals: new Map(animals.map((row) => [row.id, row.code])),
    breeds: new Map(breeds.map((row) => [row.id, row.name])),
    lots: new Map(lots.map((row) => [row.id, row.name])),
    vaccines: new Map(vaccines.map((row) => [row.id, row.name])),
    tags: new Map(tags.map((row) => [row.id, row.label])),
    cycles: new Map(cycles.map((row) => [row.id, row.name])),
    expenses: new Map(expenses.map((row) => [row.id, row.description])),
  };
}

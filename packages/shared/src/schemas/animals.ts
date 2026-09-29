/**
 * Esquemas de animales e identificadores (ANI-01 a ANI-08, IDN-01, IDN-02, CLS-02; 05-api.md
 * «Animales» e «Identificadores»).
 *
 * La API valida con ellos y la web (M4b) los usa en los formularios. Los textos van en español
 * de Colombia (06 §7).
 */

import { z } from 'zod';

import type { IsoDate } from '../date.js';
import { cleanAnimalCode } from '../domain/codes.js';
import type { VaccineStatusKind, VaccineStatusReason } from '../domain/vaccination.js';
import {
  ANIMAL_ALERT,
  DERIVED_TAG,
  EXIT_TYPE,
  IDENTIFIER_TYPE,
  MANUAL_RETIRE_REASONS,
  MANAGEMENT_CATEGORY,
  ORIGIN,
  SEX,
  WEIGHT_METHOD,
  type AnimalAlert,
  type AnimalStatus,
  type DerivedTag,
  type ExitType,
  type IdentifierRetireReason,
  type IdentifierType,
  type ManagementCategory,
  type ManualRetireReason,
  type Origin,
  type PregnancyOutcome,
  type Sex,
  type WeightMethod,
} from '../enums.js';
import type { Warning } from '../errors.js';
import type { MoneyString } from '../money.js';
import { isoDateSchema, versionSchema } from './catalogs.js';
import { clientIdSchema } from './offline.js';

// ---------------------------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------------------------

const sexSchema = z.enum([SEX.FEMALE, SEX.MALE], { message: 'Elige el sexo.' });
const originSchema = z.enum([ORIGIN.BORN_ON_FARM, ORIGIN.PURCHASED], {
  message: 'Elige la procedencia.',
});
export const identifierTypeSchema = z.enum(
  Object.values(IDENTIFIER_TYPE) as [IdentifierType, ...IdentifierType[]],
  { message: 'Elige el tipo de identificador.' },
);
/**
 * Motivo que una persona elige al retirar o reemplazar un identificador. `EXITED` y `ARCHIVED`
 * los pone solo el sistema (IDN-06, ANI-03).
 */
export const identifierRetireReasonSchema = z.enum(
  MANUAL_RETIRE_REASONS as unknown as [ManualRetireReason, ...ManualRetireReason[]],
  { message: 'Elige el motivo.' },
);

/** Texto libre opcional: vacío o solo espacios cuenta como «sin valor» (`null`). */
function optionalText(max: number) {
  return z
    .string()
    .max(max, { message: `Máximo ${max} caracteres.` })
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    });
}

/**
 * Código interno: obligatorio, en forma NFC y sin espacios al inicio ni al final (RN-01, RN-30).
 * Se guarda como lo escribió la persona; la unicidad compara el código normalizado.
 */
export const animalCodeSchema = z
  .string({ message: 'Escribe el código del animal.' })
  .transform(cleanAnimalCode)
  .pipe(
    z
      .string()
      .min(1, { message: 'Escribe el código del animal.' })
      .max(30, { message: 'El código es demasiado largo (máximo 30 caracteres).' }),
  );

const uuidSchema = z.uuid({ message: 'El identificador no es válido.' });

/** Monto positivo con hasta dos decimales, como texto (CLAUDE.md, regla 7). */
export const positiveMoneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, { message: 'Escribe un valor en pesos, sin puntos de miles.' })
  .refine((value) => Number(value) > 0, { message: 'El valor debe ser mayor que cero.' });

/** Peso en kg: positivo, menor de 2.000 y con hasta dos decimales (03 §1). */
export const weightKgSchema = z
  .number({ message: 'Escribe el peso en kilos.' })
  .positive({ message: 'El peso debe ser mayor que cero.' })
  .lt(2000, { message: 'El peso debe ser menor de 2.000 kg.' })
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'El peso admite máximo dos decimales.',
  });

// ---------------------------------------------------------------------------------------------
// Identificadores (IDN-01, IDN-02)
// ---------------------------------------------------------------------------------------------

const identifierValueSchema = z
  .string({ message: 'Escribe el identificador.' })
  .max(64, { message: 'El identificador es demasiado largo (máximo 64 caracteres).' });

export const addIdentifierSchema = z.object({
  /** `id` del cliente (ADR-012 §1): repetir la creación con el mismo `id` no duplica. */
  id: clientIdSchema.optional(),
  type: identifierTypeSchema,
  value: identifierValueSchema,
  /** Sin valor, hoy. */
  assignedAt: isoDateSchema.optional(),
  /**
   * Reasignar un valor que ya perteneció a otro animal (RN-19). Solo lo acepta la API si quien
   * lo pide es ADMIN.
   */
  confirmReuse: z.boolean().optional(),
});
export type AddIdentifierInput = z.infer<typeof addIdentifierSchema>;

export const replaceIdentifierSchema = z.object({
  reason: identifierRetireReasonSchema,
  newValue: identifierValueSchema,
  date: isoDateSchema,
  confirmReuse: z.boolean().optional(),
});
export type ReplaceIdentifierInput = z.infer<typeof replaceIdentifierSchema>;

export const retireIdentifierSchema = z.object({
  reason: identifierRetireReasonSchema,
  date: isoDateSchema,
});
export type RetireIdentifierInput = z.infer<typeof retireIdentifierSchema>;

export type IdentifierView = {
  readonly id: string;
  readonly animalId: string;
  readonly type: IdentifierType;
  readonly value: string;
  readonly assignedAt: IsoDate;
  /** `null` = activo. */
  readonly retiredAt: IsoDate | null;
  readonly retireReason: IdentifierRetireReason | null;
  /** Identificador que lo reemplazó (IDN-02). */
  readonly replacedById: string | null;
};

/** Respuesta de reemplazar un identificador: el anterior (ya retirado) y el nuevo. */
export type ReplaceIdentifierResult = {
  readonly id: string;
  readonly previous: IdentifierView;
  readonly current: IdentifierView;
  readonly warnings: readonly Warning[];
};

// ---------------------------------------------------------------------------------------------
// Registro y edición (ANI-01, ANI-02)
// ---------------------------------------------------------------------------------------------

export const initialWeightSchema = z.object({
  weightKg: weightKgSchema,
  /** Sin valor, báscula. La finca de referencia pesa con cinta (08 §1.7). */
  method: z.enum(Object.values(WEIGHT_METHOD) as [WeightMethod, ...WeightMethod[]]).optional(),
  /** Sin valor, hoy. */
  weighedOn: isoDateSchema.optional(),
});

export const createAnimalSchema = z
  .object({
    /**
     * `id` del cliente (ADR-012 §1): con el mismo contenido, 200 con el animal ya creado; con
     * otro, `CLIENT_ID_CONFLICT`.
     */
    id: clientIdSchema.optional(),
    code: animalCodeSchema,
    name: optionalText(80),
    sex: sexSchema,
    breedId: uuidSchema,
    birthDate: isoDateSchema,
    birthDateEstimated: z.boolean().optional(),
    origin: originSchema,
    originDetail: optionalText(200),
    /** Obligatoria si es comprado; si nació en la finca es la fecha de nacimiento. */
    entryDate: isoDateSchema.optional(),
    damId: uuidSchema.nullable().optional(),
    sireId: uuidSchema.nullable().optional(),
    sireExternalRef: optionalText(80),
    lotId: uuidSchema.nullable().optional(),
    notes: optionalText(2000),
    /** Solo ADMIN (CLS-02 CA1). */
    forSale: z.boolean().optional(),
    tagIds: z.array(uuidSchema).max(20).optional(),
    identifiers: z
      .array(addIdentifierSchema.omit({ assignedAt: true, id: true }))
      .max(10, { message: 'Máximo 10 identificadores.' })
      .optional(),
    initialWeight: initialWeightSchema.optional(),
    /** Valor de compra: solo ADMIN y solo si es comprado (ANI-01 CA2, RN-20). */
    purchasePrice: positiveMoneySchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.origin === ORIGIN.PURCHASED && value.entryDate === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['entryDate'],
        message: 'Indica la fecha de ingreso del animal comprado.',
      });
    }
    if (value.origin !== ORIGIN.PURCHASED && value.purchasePrice !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['purchasePrice'],
        message: 'El valor de compra solo aplica a animales comprados.',
      });
    }
    if (value.sireId != null && value.sireExternalRef != null) {
      context.addIssue({
        code: 'custom',
        path: ['sireExternalRef'],
        message: 'Indica el padre de la finca o la referencia externa, no ambos.',
      });
    }
  });
export type CreateAnimalInput = z.infer<typeof createAnimalSchema>;

/** Campos que se pueden editar aunque el animal ya haya salido (RN-09). */
export const FIELDS_EDITABLE_AFTER_EXIT = ['notes', 'photoUrl'] as const;

export const updateAnimalSchema = z
  .object({
    version: versionSchema,
    code: animalCodeSchema.optional(),
    name: optionalText(80),
    sex: sexSchema.optional(),
    breedId: uuidSchema.optional(),
    birthDate: isoDateSchema.optional(),
    birthDateEstimated: z.boolean().optional(),
    origin: originSchema.optional(),
    originDetail: optionalText(200),
    entryDate: isoDateSchema.optional(),
    damId: uuidSchema.nullable().optional(),
    sireId: uuidSchema.nullable().optional(),
    sireExternalRef: optionalText(80),
    lotId: uuidSchema.nullable().optional(),
    notes: optionalText(2000),
    photoUrl: optionalText(500),
    forSale: z.boolean().optional(),
    /** `null` quita el valor de compra. Solo ADMIN. */
    purchasePrice: positiveMoneySchema.nullable().optional(),
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== 'version' && field !== undefined),
    { message: 'No hay nada que cambiar.' },
  );
export type UpdateAnimalInput = z.infer<typeof updateAnimalSchema>;

// ---------------------------------------------------------------------------------------------
// Listado y búsqueda (ANI-05, ANI-06)
// ---------------------------------------------------------------------------------------------

/** Valores separados por coma → lista sin vacíos ni repetidos (05, «Convenciones»). */
function csv<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      ),
    ])
    .pipe(z.array(item))
    .optional();
}

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');
const monthsQuery = z.coerce
  .number()
  .int({ message: 'Escribe la edad en meses enteros.' })
  .min(0)
  .max(600);

export const ANIMAL_LIST_STATUS = {
  ACTIVE: 'active',
  EXITED: 'exited',
  ARCHIVED: 'archived',
} as const;
export type AnimalListStatus = (typeof ANIMAL_LIST_STATUS)[keyof typeof ANIMAL_LIST_STATUS];

/** Orden del listado. Con `-` delante, descendente (ANI-06 CA3). */
export const ANIMAL_SORT = ['code', '-code', 'age', '-age', 'lastWeight', '-lastWeight'] as const;
export type AnimalSort = (typeof ANIMAL_SORT)[number];

/**
 * Etiqueta del filtro `tags`: una derivada (`PREGNANT`…) o la `key` de una etiqueta manual
 * (`COTERO`…). Las claves manuales se generan en mayúsculas a partir del nombre (M3).
 */
const tagKeySchema = z
  .string()
  .max(60)
  .regex(/^[A-Z0-9_]+$/, { message: 'Etiqueta no válida.' });

export const listAnimalsQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    sex: sexSchema.optional(),
    breedId: csv(uuidSchema),
    lotId: csv(uuidSchema),
    category: csv(
      z.enum(Object.values(MANAGEMENT_CATEGORY) as [ManagementCategory, ...ManagementCategory[]], {
        message: 'Categoría no válida.',
      }),
    ),
    tags: csv(tagKeySchema),
    status: z
      .enum([ANIMAL_LIST_STATUS.ACTIVE, ANIMAL_LIST_STATUS.EXITED, ANIMAL_LIST_STATUS.ARCHIVED])
      .default(ANIMAL_LIST_STATUS.ACTIVE),
    ageMinMonths: monthsQuery.optional(),
    ageMaxMonths: monthsQuery.optional(),
    alerts: csv(
      z.enum(Object.values(ANIMAL_ALERT) as [AnimalAlert, ...AnimalAlert[]], {
        message: 'Alerta no válida.',
      }),
    ),
    forSale: booleanQuery.optional(),
    sort: z.enum(ANIMAL_SORT, { message: 'Orden no válido.' }).default('code'),
    limit: z.string().optional(),
    cursor: z.string().optional(),
  })
  .refine(
    (value) =>
      value.ageMinMonths === undefined ||
      value.ageMaxMonths === undefined ||
      value.ageMinMonths <= value.ageMaxMonths,
    { path: ['ageMaxMonths'], message: 'La edad máxima debe ser mayor o igual que la mínima.' },
  );
export type ListAnimalsQuery = z.infer<typeof listAnimalsQuerySchema>;

/** Etiquetas por hoja como máximo (unas 50 hojas carta de 21). */
export const LABELS_MAX = 1000;

/**
 * Hoja de etiquetas (IDN-03 CA2): una selección (`ids`, hasta 200: lo que cabe en una URL) o
 * todo lo que muestra el listado con sus filtros.
 */
export const animalLabelsQuerySchema = listAnimalsQuerySchema.and(
  z.object({
    ids: csv(uuidSchema).refine((value) => value === undefined || value.length <= 200, {
      message: 'Elige hasta 200 animales.',
    }),
  }),
);
export type AnimalLabelsQuery = z.infer<typeof animalLabelsQuerySchema>;

/** Un animal en la hoja de etiquetas. */
export type AnimalLabelView = {
  readonly id: string;
  readonly code: string;
  readonly name: string | null;
  readonly sex: Sex;
  readonly visualTag: string | null;
  readonly din: string | null;
  readonly rfid: string | null;
  readonly qrUrl: string;
};

export type AnimalLabels = {
  readonly items: readonly AnimalLabelView[];
  /** Había más de `LABELS_MAX`: la hoja trae las primeras. */
  readonly truncated: boolean;
};

/** ¿La clave del filtro `tags` es una etiqueta derivada? Si no, es una manual. */
export function isDerivedTagKey(key: string): key is DerivedTag {
  return (Object.values(DERIVED_TAG) as string[]).includes(key);
}

export const searchAnimalsQuerySchema = z.object({
  q: z
    .string({ message: 'Escribe qué buscar.' })
    .trim()
    .min(1, { message: 'Escribe qué buscar.' })
    .max(100),
});
export type SearchAnimalsQuery = z.infer<typeof searchAnimalsQuerySchema>;

/** Con menos caracteres que estos solo hay búsqueda exacta, sin difusa. */
export const FUZZY_SEARCH_MIN_LENGTH = 2;

export const nextCodeQuerySchema = z.object({ birthDate: isoDateSchema.optional() });

// ---------------------------------------------------------------------------------------------
// Operaciones en lote (CLS-02 CA2)
// ---------------------------------------------------------------------------------------------

/** Máximo de animales por operación en lote. */
export const BULK_MAX_ANIMALS = 500;

const animalIdsSchema = z
  .array(uuidSchema)
  .min(1, { message: 'Selecciona al menos un animal.' })
  .max(BULK_MAX_ANIMALS, { message: `Máximo ${BULK_MAX_ANIMALS} animales por operación.` })
  .transform((ids) => [...new Set(ids)]);

export const bulkTagsSchema = z
  .object({
    animalIds: animalIdsSchema,
    add: z.array(uuidSchema).max(20).optional(),
    remove: z.array(uuidSchema).max(20).optional(),
    /** Solo ADMIN (CLS-02 CA1). */
    forSale: z.boolean().optional(),
  })
  .refine(
    (value) =>
      (value.add?.length ?? 0) > 0 ||
      (value.remove?.length ?? 0) > 0 ||
      value.forSale !== undefined,
    { message: 'No hay nada que cambiar.' },
  )
  .refine((value) => !(value.add ?? []).some((id) => (value.remove ?? []).includes(id)), {
    path: ['remove'],
    message: 'Una etiqueta no se puede agregar y quitar a la vez.',
  });
export type BulkTagsInput = z.infer<typeof bulkTagsSchema>;

export const bulkLotSchema = z.object({
  animalIds: animalIdsSchema,
  /** `null` saca a los animales de todo lote. */
  lotId: uuidSchema.nullable(),
  date: isoDateSchema,
});
export type BulkLotInput = z.infer<typeof bulkLotSchema>;

export type BulkTagsResult = { readonly updated: number };
export type BulkLotResult = { readonly moved: number; readonly unchanged: number };

// ---------------------------------------------------------------------------------------------
// Salida, archivo y restauración (ANI-03, ANI-04, IDN-06)
// ---------------------------------------------------------------------------------------------

export const exitTypeSchema = z.enum(Object.values(EXIT_TYPE) as [ExitType, ...ExitType[]], {
  message: 'Elige el tipo de salida.',
});

/**
 * Registrar la salida (ANI-04). Si es venta, `sale.amount` es obligatorio; la API responde
 * `SALE_AMOUNT_REQUIRED` si falta, con el campo marcado.
 */
export const exitAnimalSchema = z
  .object({
    type: exitTypeSchema,
    date: isoDateSchema,
    reason: optionalText(500),
    sale: z
      .object({
        amount: positiveMoneySchema.optional(),
        buyer: optionalText(120),
      })
      .optional(),
    /** Confirmación explícita de vender o sacrificar un animal en retiro (RN-22). */
    confirmWithdrawal: z.boolean().optional(),
  })
  .refine((value) => value.type === EXIT_TYPE.SALE || value.sale === undefined, {
    path: ['sale'],
    message: 'El precio y el comprador solo aplican a una venta.',
  });
export type ExitAnimalInput = z.infer<typeof exitAnimalSchema>;

/**
 * Revertir una salida (ANI-04 CA5). `newCode` solo hace falta si el código o la chapeta ya los
 * tiene otro animal activo (`CODE_REASSIGNED`, IDN-06 CA3).
 */
export const revertExitSchema = z.object({ newCode: animalCodeSchema.optional() });
export type RevertExitInput = z.infer<typeof revertExitSchema>;

/** Archivar (ANI-03): el motivo es obligatorio y queda en la auditoría. */
export const archiveAnimalSchema = z.object({
  reason: z
    .string({ message: 'Escribe el motivo.' })
    .trim()
    .min(3, { message: 'Escribe el motivo (mínimo 3 caracteres).' })
    .max(500, { message: 'Máximo 500 caracteres.' }),
});
export type ArchiveAnimalInput = z.infer<typeof archiveAnimalSchema>;

/** Restaurar un archivado (ANI-03 CA2). `newCode` si su código ya lo tiene otro animal. */
export const restoreAnimalSchema = z.object({ newCode: animalCodeSchema.optional() });
export type RestoreAnimalInput = z.infer<typeof restoreAnimalSchema>;

// ---------------------------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------------------------

export type AnimalRef = {
  readonly id: string;
  readonly code: string;
  readonly name: string | null;
};

export type ManualTagView = { readonly id: string; readonly key: string; readonly label: string };

export type LastWeightView = {
  readonly weightKg: number;
  readonly weighedOn: IsoDate;
  readonly method: WeightMethod;
};

/** Fila del listado (ANI-06 CA2). La edad legible se arma en el cliente con `formatAge`. */
export type AnimalListItem = AnimalRef & {
  readonly sex: Sex;
  readonly breed: { readonly id: string; readonly name: string };
  readonly birthDate: IsoDate;
  readonly birthDateEstimated: boolean;
  readonly ageMonths: number;
  readonly category: ManagementCategory;
  readonly derivedTags: readonly DerivedTag[];
  readonly calvingCount: number;
  /** Parto estimado de la preñez abierta **confirmada**; `null` si no está preñada. */
  readonly expectedCalvingDate: IsoDate | null;
  readonly manualTags: readonly ManualTagView[];
  readonly forSale: boolean;
  readonly lot: { readonly id: string; readonly name: string } | null;
  readonly lastWeight: LastWeightView | null;
  readonly status: AnimalStatus;
  readonly alerts: readonly AnimalAlert[];
};

export type AnimalList = {
  readonly items: readonly AnimalListItem[];
  readonly nextCursor: string | null;
  /** Total con los filtros aplicados, sin paginar. */
  readonly total: number;
};

export type VaccineStatusView = {
  readonly vaccineId: string;
  readonly name: string;
  readonly status: VaccineStatusKind;
  readonly reason: VaccineStatusReason;
  readonly dueOn: IsoDate | null;
  readonly lastAppliedOn: IsoDate | null;
};

export type OpenPregnancyView = {
  readonly id: string;
  readonly serviceDate: IsoDate;
  readonly confirmedAt: IsoDate | null;
  readonly expectedCalvingDate: IsoDate;
};

/** Resumen reproductivo; solo en hembras. */
export type ReproductiveSummary = {
  readonly calvingCount: number;
  /** Cuántos de esos partos llegaron por importación sin fecha (RN-29). */
  readonly importedPriorCalvings: number;
  readonly lastCalvingDate: IsoDate | null;
  readonly openPregnancy: OpenPregnancyView | null;
};

/** Ficha del animal (ANI-07). `economics` solo existe si quien consulta es ADMIN (RN-20). */
export type AnimalDetail = AnimalListItem & {
  readonly origin: Origin;
  readonly originDetail: string | null;
  readonly entryDate: IsoDate;
  /** Se tomó la fecha de nacimiento porque no se conocía (importación, ANI-09). */
  readonly entryDateEstimated: boolean;
  readonly ageDays: number;
  readonly dam: AnimalRef | null;
  readonly sire: AnimalRef | null;
  readonly sireExternalRef: string | null;
  readonly notes: string | null;
  readonly photoUrl: string | null;
  readonly exit: {
    readonly type: ExitType;
    readonly date: IsoDate;
    readonly reason: string | null;
  } | null;
  readonly identifiers: readonly IdentifierView[];
  readonly reproduction: ReproductiveSummary | null;
  readonly vaccines: readonly VaccineStatusView[];
  readonly withdrawalUntil: IsoDate | null;
  /** Número anterior (ANI-11). */
  readonly codeHistory: CodeHistory;
  /** Archivo (ANI-03): instante y motivo; `null` si no está archivado. */
  readonly archive: { readonly archivedAt: string; readonly reason: string | null } | null;
  /** Lo que codifica su QR: `${PUBLIC_WEB_URL}/a/<id>`, sin datos del animal (IDN-03). */
  readonly qrUrl: string;
  readonly version: number;
  readonly economics?: { readonly purchasePrice: MoneyString | null };
};

export type AnimalDetailWithWarnings = AnimalDetail & { readonly warnings: readonly Warning[] };

/** Otro animal que tuvo o tiene el mismo número (ANI-11), para enlazar su ficha. */
export type CodeHolderView = {
  readonly animalId: string;
  readonly code: string;
  readonly status: AnimalStatus;
  readonly exitDate: IsoDate | null;
};

/**
 * Número anterior (ANI-11). En un animal activo, `previousHolder` es el último que tuvo su número
 * y salió. En un animal que salió, `currentHolder` es el activo que lo tiene hoy.
 */
export type CodeHistory = {
  readonly previousHolder: CodeHolderView | null;
  readonly currentHolder: CodeHolderView | null;
};

/** Por qué coincidió un resultado de la búsqueda. */
export type SearchMatch =
  | { readonly kind: 'CODE'; readonly value: string }
  | { readonly kind: 'NAME'; readonly value: string }
  /** El texto era el contenido de un QR del sistema (IDN-03, ANI-05); `value` es el id. */
  | { readonly kind: 'QR'; readonly value: string }
  | {
      readonly kind: 'IDENTIFIER';
      readonly identifierType: IdentifierType;
      readonly value: string;
      /** Identificador retirado: la interfaz lo muestra como «identificador anterior» (IDN-02). */
      readonly previous: boolean;
    };

export type SearchResultItem = AnimalRef & {
  readonly sex: Sex;
  readonly status: AnimalStatus;
  /** `true` si la coincidencia es exacta y no difusa. */
  readonly exact: boolean;
  readonly matches: readonly SearchMatch[];
};

/**
 * Resultado de `GET /animals/search`. `exactMatch` existe cuando todas las coincidencias
 * exactas apuntan al mismo animal: la interfaz abre su ficha directamente (ANI-05 CA1).
 */
export type SearchResult = {
  readonly exactMatch: {
    readonly animalId: string;
    /** La coincidencia de mayor prioridad: identificador activo, código, identificador anterior. */
    readonly via: SearchMatch;
    readonly matches: readonly SearchMatch[];
  } | null;
  readonly items: readonly SearchResultItem[];
};

export type NextCodeResult = { readonly code: string };

export type GenealogyNode = AnimalRef & {
  readonly sex: Sex;
  readonly birthDate: IsoDate;
  readonly status: AnimalStatus;
};

export type GenealogyParent = GenealogyNode & {
  readonly dam: GenealogyNode | null;
  readonly sire: GenealogyNode | null;
  readonly sireExternalRef: string | null;
};

export type GenealogyChild = GenealogyNode & { readonly offspring: readonly GenealogyNode[] };

/** Genealogía a dos niveles (05: madre, padre, crías). */
export type Genealogy = {
  readonly animal: GenealogyNode;
  readonly dam: GenealogyParent | null;
  readonly sire: GenealogyParent | null;
  readonly sireExternalRef: string | null;
  readonly offspring: readonly GenealogyChild[];
};

// ---------------------------------------------------------------------------------------------
// Línea de tiempo (ANI-07 CA3)
// ---------------------------------------------------------------------------------------------

export const TIMELINE_KIND = {
  BIRTH: 'BIRTH',
  ENTRY: 'ENTRY',
  SERVICE: 'SERVICE',
  DIAGNOSIS: 'DIAGNOSIS',
  PREGNANCY_OUTCOME: 'PREGNANCY_OUTCOME',
  VACCINATION: 'VACCINATION',
  TREATMENT: 'TREATMENT',
  WEIGHT: 'WEIGHT',
  LOT_MOVEMENT: 'LOT_MOVEMENT',
  IDENTIFIER_ASSIGNED: 'IDENTIFIER_ASSIGNED',
  IDENTIFIER_RETIRED: 'IDENTIFIER_RETIRED',
  EXIT: 'EXIT',
  EDIT: 'EDIT',
} as const;
export type TimelineKind = (typeof TIMELINE_KIND)[keyof typeof TIMELINE_KIND];

/** Cambio de un campo en una edición. */
export type FieldChange = {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
};

type TimelineBase<K extends TimelineKind, D> = {
  /** Único dentro de la línea de tiempo: `<tipo>:<id del registro>`. */
  readonly key: string;
  readonly kind: K;
  readonly date: IsoDate;
  /** Evento anulado (RN-11): se muestra tachado, no desaparece. */
  readonly voided: boolean;
  readonly data: D;
};

export type TimelineItem =
  | TimelineBase<'BIRTH', { readonly birthDateEstimated: boolean; readonly dam: AnimalRef | null }>
  | TimelineBase<'ENTRY', { readonly originDetail: string | null }>
  | TimelineBase<
      'SERVICE',
      {
        readonly pregnancyId: string;
        readonly estimated: boolean;
        readonly sire: AnimalRef | null;
        readonly sireExternalRef: string | null;
      }
    >
  | TimelineBase<'DIAGNOSIS', { readonly pregnancyId: string; readonly result: 'POSITIVE' }>
  | TimelineBase<
      'PREGNANCY_OUTCOME',
      {
        readonly pregnancyId: string;
        readonly outcome: Exclude<PregnancyOutcome, 'PENDING'>;
        readonly stillbornCount: number;
      }
    >
  | TimelineBase<
      'VACCINATION',
      { readonly vaccineId: string; readonly vaccine: string; readonly dose: string | null }
    >
  | TimelineBase<
      'TREATMENT',
      {
        readonly medication: string;
        readonly reason: string;
        readonly withdrawalUntil: IsoDate | null;
      }
    >
  | TimelineBase<'WEIGHT', { readonly weightKg: number; readonly method: WeightMethod }>
  | TimelineBase<'LOT_MOVEMENT', { readonly fromLot: string | null; readonly toLot: string | null }>
  | TimelineBase<
      'IDENTIFIER_ASSIGNED' | 'IDENTIFIER_RETIRED',
      {
        readonly identifierId: string;
        readonly type: IdentifierType;
        readonly value: string;
        readonly reason: IdentifierRetireReason | null;
      }
    >
  | TimelineBase<'EXIT', { readonly type: ExitType; readonly reason: string | null }>
  | TimelineBase<
      'EDIT',
      { readonly userName: string | null; readonly changes: readonly FieldChange[] }
    >;

export type Timeline = {
  readonly items: readonly TimelineItem[];
  readonly nextCursor: string | null;
};

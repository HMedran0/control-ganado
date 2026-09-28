import {
  IDENTIFIER_TYPE,
  createAnimalSchema,
  updateAnimalSchema,
  type AnimalDetail,
  type AnimalRef,
  type CreateAnimalInput,
  type IdentifierType,
  type Origin,
  type Sex,
  type UpdateAnimalInput,
  type WeightMethod,
} from '@hato/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * Formulario de animal (ANI-01, ANI-02) ↔ cuerpo de la API.
 *
 * El formulario tiene campos cómodos para la pantalla (chapeta, chip y DIN por separado; madre
 * y padre como animal elegido; montos y pesos como texto del `NumberField`), y la validación es
 * la de `createAnimalSchema` y `updateAnimalSchema` de shared, sin copiar sus reglas: el
 * resolver arma el cuerpo, lo valida con el esquema y devuelve cada error a su campo.
 */

export type AnimalFormValues = {
  code: string;
  name: string;
  sex: Sex | null;
  breedId: string;
  birthDate: string;
  birthDateEstimated: boolean;
  origin: Origin;
  originDetail: string;
  entryDate: string;
  dam: AnimalRef | null;
  sire: AnimalRef | null;
  sireExternalRef: string;
  lotId: string;
  tagIds: string[];
  forSale: boolean;
  notes: string;
  /** Solo al crear: los identificadores se gestionan después desde la ficha. */
  visualTag: string;
  rfid: string;
  din: string;
  /** Solo al crear: peso inicial. */
  weightKg: string | null;
  weighedOn: string;
  weightMethod: WeightMethod;
  /** Solo ADMIN (RN-20). */
  purchasePrice: string | null;
};

export type FormField = keyof AnimalFormValues;

/** Identificadores del formulario de alta, en el orden en que se envían. */
const IDENTIFIER_FIELDS: readonly (readonly [FormField, IdentifierType])[] = [
  ['visualTag', IDENTIFIER_TYPE.VISUAL_TAG],
  ['rfid', IDENTIFIER_TYPE.RFID],
  ['din', IDENTIFIER_TYPE.DIN],
];

export function emptyValues(today: string): AnimalFormValues {
  return {
    code: '',
    name: '',
    sex: null,
    breedId: '',
    birthDate: '',
    birthDateEstimated: false,
    origin: 'BORN_ON_FARM',
    originDetail: '',
    entryDate: '',
    dam: null,
    sire: null,
    sireExternalRef: '',
    lotId: '',
    tagIds: [],
    forSale: false,
    notes: '',
    visualTag: '',
    rfid: '',
    din: '',
    weightKg: null,
    weighedOn: today,
    weightMethod: 'SCALE',
    purchasePrice: null,
  };
}

/** Valores de un animal existente, para editarlo. */
export function valuesFromAnimal(animal: AnimalDetail, today: string): AnimalFormValues {
  return {
    ...emptyValues(today),
    code: animal.code,
    name: animal.name ?? '',
    sex: animal.sex,
    breedId: animal.breed.id,
    birthDate: animal.birthDate,
    birthDateEstimated: animal.birthDateEstimated,
    origin: animal.origin,
    originDetail: animal.originDetail ?? '',
    entryDate: animal.origin === 'PURCHASED' ? animal.entryDate : '',
    dam: animal.dam,
    sire: animal.sire,
    sireExternalRef: animal.sireExternalRef ?? '',
    lotId: animal.lot?.id ?? '',
    tagIds: animal.manualTags.map((tag) => tag.id),
    forSale: animal.forSale,
    notes: animal.notes ?? '',
    purchasePrice: animal.economics?.purchasePrice ?? null,
  };
}

const blankToUndefined = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;

/** Cuerpo de `POST /animals` tal como lo espera `createAnimalSchema` (antes de validar). */
export function createBody(values: AnimalFormValues, isAdmin: boolean): Record<string, unknown> {
  const purchased = values.origin === 'PURCHASED';
  const identifiers = IDENTIFIER_FIELDS.flatMap(([field, type]) => {
    const value = values[field];
    return typeof value === 'string' && value.trim() !== '' ? [{ type, value }] : [];
  });
  return {
    code: values.code,
    name: values.name,
    sex: values.sex ?? undefined,
    breedId: blankToUndefined(values.breedId),
    birthDate: blankToUndefined(values.birthDate),
    birthDateEstimated: values.birthDateEstimated,
    origin: values.origin,
    ...(purchased
      ? {
          originDetail: values.originDetail,
          entryDate: blankToUndefined(values.entryDate),
          ...(isAdmin && values.purchasePrice !== null
            ? { purchasePrice: values.purchasePrice }
            : {}),
        }
      : {}),
    damId: values.dam?.id ?? null,
    sireId: values.sire?.id ?? null,
    sireExternalRef: values.sire === null ? values.sireExternalRef : '',
    lotId: blankToUndefined(values.lotId) ?? null,
    tagIds: values.tagIds,
    ...(isAdmin && values.forSale ? { forSale: true } : {}),
    notes: values.notes,
    ...(identifiers.length === 0 ? {} : { identifiers }),
    ...(values.weightKg === null
      ? {}
      : {
          initialWeight: {
            weightKg: Number(values.weightKg),
            weighedOn: values.weighedOn,
            method: values.weightMethod,
          },
        }),
  };
}

/**
 * Cuerpo de `PATCH /animals/:id`: solo lo que cambió, más la versión. Con salida registrada,
 * solo las observaciones (RN-09).
 */
export function updateBody(
  values: AnimalFormValues,
  initial: AnimalFormValues,
  options: { version: number; isAdmin: boolean; exited: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = { version: options.version };
  const changed = (field: FormField): boolean =>
    JSON.stringify(values[field]) !== JSON.stringify(initial[field]);

  if (changed('notes')) body.notes = values.notes;
  if (options.exited) return body;

  const simple: FormField[] = [
    'code',
    'name',
    'breedId',
    'birthDate',
    'birthDateEstimated',
    'origin',
    'originDetail',
  ];
  for (const field of simple) if (changed(field)) body[field] = values[field];
  if (changed('sex')) body.sex = values.sex ?? undefined;
  if (changed('origin') || changed('entryDate')) {
    if (values.origin === 'PURCHASED') body.entryDate = blankToUndefined(values.entryDate);
  }
  if (changed('dam')) body.damId = values.dam?.id ?? null;
  if (changed('sire') || changed('sireExternalRef')) {
    body.sireId = values.sire?.id ?? null;
    body.sireExternalRef = values.sire === null ? values.sireExternalRef : null;
  }
  if (changed('lotId')) body.lotId = blankToUndefined(values.lotId) ?? null;
  if (options.isAdmin && changed('forSale')) body.forSale = values.forSale;
  if (options.isAdmin && changed('purchasePrice')) body.purchasePrice = values.purchasePrice;
  return body;
}

/** Campo del formulario al que corresponde un error del cuerpo (`initialWeight.weightKg`…). */
export function fieldForPath(path: string, body: Record<string, unknown>): FormField | null {
  const identifiers = (body.identifiers as { type: IdentifierType }[] | undefined) ?? [];
  const match = /^identifiers\.(\d+)/.exec(path);
  if (match !== null) {
    const type = identifiers[Number(match[1])]?.type;
    return IDENTIFIER_FIELDS.find(([, candidate]) => candidate === type)?.[0] ?? null;
  }
  if (path.startsWith('initialWeight.weighedOn')) return 'weighedOn';
  if (path.startsWith('initialWeight')) return 'weightKg';
  if (path === 'damId') return 'dam';
  if (path === 'sireId') return 'sire';
  const field = path.split('.')[0] as FormField;
  return field in emptyValues('') ? field : null;
}

/**
 * Mensajes para lo que falta, más claros que el genérico del tipo. La fecha de ingreso solo
 * está en el cuerpo si el animal es comprado; va aquí porque zod no corre el `superRefine` del
 * esquema mientras haya otros errores, y la persona debe ver todos los faltantes de una vez.
 */
const REQUIRED: Partial<Record<FormField, string>> = {
  breedId: 'Elige la raza.',
  birthDate: 'Escribe la fecha de nacimiento.',
  entryDate: 'Indica la fecha de ingreso del animal comprado.',
};

function resolverFor<T>(
  schema: z.ZodType<T>,
  build: (values: AnimalFormValues) => Record<string, unknown>,
): Resolver<AnimalFormValues, unknown, T> {
  return (values) => {
    const body = build(values);
    const errors: FieldErrors<AnimalFormValues> = {};
    const setError = (field: FormField | null, message: string): void => {
      const key = field ?? 'root';
      if (errors[key] === undefined) {
        (errors as Record<string, unknown>)[key] = { type: 'validation', message };
      }
    };
    for (const [field, message] of Object.entries(REQUIRED) as [FormField, string][]) {
      if (field in body && body[field] === undefined) setError(field, message);
    }
    const result = schema.safeParse(body);
    if (result.success && Object.keys(errors).length === 0) {
      return { values: result.data, errors: {} };
    }
    if (!result.success) {
      for (const issue of result.error.issues) {
        setError(fieldForPath(issue.path.join('.'), body), issue.message);
      }
    }
    return { values: {}, errors };
  };
}

export function createResolver(
  isAdmin: boolean,
): Resolver<AnimalFormValues, unknown, CreateAnimalInput> {
  return resolverFor(createAnimalSchema, (values) => createBody(values, isAdmin));
}

export function updateResolver(
  initial: AnimalFormValues,
  options: { version: number; isAdmin: boolean; exited: boolean },
): Resolver<AnimalFormValues, unknown, UpdateAnimalInput> {
  return resolverFor(updateAnimalSchema, (values) => updateBody(values, initial, options));
}

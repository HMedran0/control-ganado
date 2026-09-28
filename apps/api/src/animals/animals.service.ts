import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  FIELDS_EDITABLE_AFTER_EXIT,
  ORIGIN,
  SEX,
  WEIGHT_METHOD,
  formatAge,
  monthsBetween,
  uuidv7,
  warning,
  type AnimalDetailWithWarnings,
  type BulkLotInput,
  type BulkLotResult,
  type BulkTagsInput,
  type BulkTagsResult,
  type CreateAnimalInput,
  type IsoDate,
  type UpdateAnimalInput,
  type Warning,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  assertVersion,
  audit,
  changesBetween,
  isUniqueViolation,
  type Tx,
} from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AnimalDetailService } from './animal-detail.service.js';
import {
  assertNotBeforeBirth,
  assertNotFuture,
  fieldError,
  requireAdmin,
  userOf,
} from './animal-rules.js';
import { assertCodeAvailable } from './code-availability.js';
import { FarmContextService, type FarmContext } from './farm-context.service.js';
import { checkIdentifier, type CheckedIdentifier } from './identifier-rules.js';

/** Campos del animal que registra la auditoría. Ninguno es económico (RN-20). */
const AUDITED_FIELDS = [
  'code',
  'name',
  'sex',
  'breedId',
  'birthDate',
  'birthDateEstimated',
  'origin',
  'originDetail',
  'entryDate',
  'damId',
  'sireId',
  'sireExternalRef',
  'lotId',
  'notes',
  'photoUrl',
  'forSale',
] as const;
type AuditedField = (typeof AUDITED_FIELDS)[number];
type AnimalSnapshot = Record<AuditedField, string | boolean | null>;

type AnimalRow = Prisma.AnimalGetPayload<object>;

function snapshot(animal: AnimalRow): AnimalSnapshot {
  return {
    code: animal.code,
    name: animal.name,
    sex: animal.sex,
    breedId: animal.breedId,
    birthDate: fromPrismaDate(animal.birthDate),
    birthDateEstimated: animal.birthDateEstimated,
    origin: animal.origin,
    originDetail: animal.originDetail,
    entryDate: fromPrismaDate(animal.entryDate),
    damId: animal.damId,
    sireId: animal.sireId,
    sireExternalRef: animal.sireExternalRef,
    lotId: animal.lotId,
    notes: animal.notes,
    photoUrl: animal.photoUrl,
    forSale: animal.forSale,
  };
}

/** Traduce los choques de índice único de un animal o sus identificadores. */
function translateUniqueViolation(error: unknown, code: string): never {
  if (isUniqueViolation(error)) {
    const meta = JSON.stringify((error as Prisma.PrismaClientKnownRequestError).meta ?? {});
    if (meta.includes('value')) {
      throw new DomainError('IDENTIFIER_TAKEN', {
        detail: 'Uno de los identificadores ya está asignado a otro animal.',
        cause: error,
      });
    }
    throw new DomainError('ANIMAL_CODE_TAKEN', { params: { code }, cause: error });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    throw new DomainError('VERSION_CONFLICT', { cause: error });
  }
  throw error;
}

/**
 * Registro, edición y operaciones en lote de animales (ANI-01, ANI-02, CLS-02).
 *
 * Cada caso de uso corre en una transacción y deja su auditoría dentro de ella (AUD-01): si algo
 * falla, no queda ni el cambio ni su rastro.
 */
@Injectable()
export class AnimalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly farmContext: FarmContextService,
    private readonly details: AnimalDetailService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Registro (ANI-01)
  // -------------------------------------------------------------------------------------------

  async create(scope: FarmScope, input: CreateAnimalInput): Promise<AnimalDetailWithWarnings> {
    const context = await this.farmContext.load(scope);

    // Idempotencia (05): el mismo `id` otra vez devuelve el animal ya creado.
    if (input.id !== undefined) {
      const existing = await this.prisma.animal.findUnique({
        where: { id: input.id },
        select: { farmId: true },
      });
      if (existing !== null) {
        if (existing.farmId !== scope.farmId) {
          throw fieldError('VALIDATION_FAILED', 'id', 'Ese identificador ya está en uso.');
        }
        return { ...(await this.details.detail(scope, input.id, context)), warnings: [] };
      }
    }

    if (input.purchasePrice !== undefined) {
      requireAdmin(scope, 'Solo un administrador puede registrar el valor de compra.');
    }
    if (input.forSale === true) {
      requireAdmin(scope, 'Solo un administrador puede marcar un animal disponible para venta.');
    }

    const { today } = context;
    const birthDate = input.birthDate;
    const entryDate = (input.origin === ORIGIN.PURCHASED ? input.entryDate : birthDate) as IsoDate;
    assertNotFuture(birthDate, today, 'birthDate');
    assertNotFuture(entryDate, today, 'entryDate');
    assertNotBeforeBirth(entryDate, birthDate, 'entryDate');
    const weighedOn = input.initialWeight?.weighedOn ?? today;
    if (input.initialWeight !== undefined) {
      assertNotFuture(weighedOn, today, 'initialWeight.weighedOn');
      assertNotBeforeBirth(weighedOn, birthDate, 'initialWeight.weighedOn');
    }

    const id = input.id ?? uuidv7();
    const userId = userOf(scope);
    const at = this.clock.now();

    const warnings = await this.prisma
      .$transaction(async (tx) => {
        await this.assertCatalogRefs(tx, scope, {
          breedId: input.breedId,
          lotId: input.lotId ?? null,
          tagIds: input.tagIds ?? [],
        });
        const found: Warning[] = await this.checkParents(tx, scope, context, {
          animalId: null,
          birthDate,
          damId: input.damId ?? null,
          sireId: input.sireId ?? null,
        });
        await assertCodeAvailable(tx, scope, {
          code: input.code,
          excludeAnimalId: null,
          codeReuse: context.settings.codeReuse,
          willBeActive: true,
        });

        const identifiers: CheckedIdentifier[] = [];
        for (const [index, identifier] of (input.identifiers ?? []).entries()) {
          const checked = await checkIdentifier(tx, scope, {
            type: identifier.type,
            value: identifier.value,
            animalId: null,
            confirmReuse: identifier.confirmReuse,
          }).catch((error: unknown) => {
            if (error instanceof DomainError && error.fieldErrors !== undefined) {
              throw new DomainError(error.code, {
                detail: error.detail,
                fieldErrors: { [`identifiers.${index}.value`]: [error.detail] },
              });
            }
            throw error;
          });
          if (
            identifiers.some(
              (other) => other.type === checked.type && other.value === checked.value,
            )
          ) {
            throw fieldError(
              'VALIDATION_FAILED',
              `identifiers.${index}.value`,
              'Ese identificador está repetido.',
            );
          }
          identifiers.push(checked);
          found.push(...checked.warnings);
        }

        const animal = await tx.animal.create({
          data: {
            id,
            farmId: scope.farmId,
            code: input.code,
            name: input.name ?? null,
            sex: input.sex,
            breedId: input.breedId,
            birthDate: toPrismaDate(birthDate),
            birthDateEstimated: input.birthDateEstimated ?? false,
            origin: input.origin,
            originDetail: input.originDetail ?? null,
            entryDate: toPrismaDate(entryDate),
            damId: input.damId ?? null,
            sireId: input.sireId ?? null,
            sireExternalRef: input.sireExternalRef ?? null,
            lotId: input.lotId ?? null,
            forSale: input.forSale ?? false,
            notes: input.notes ?? null,
            createdById: userId,
            updatedById: userId,
            createdAt: at,
          },
        });

        for (const identifier of identifiers) {
          await tx.identifier.create({
            data: {
              id: uuidv7(),
              farmId: scope.farmId,
              animalId: id,
              type: identifier.type,
              value: identifier.value,
              assignedAt: toPrismaDate(entryDate),
              createdAt: at,
            },
          });
        }
        if ((input.tagIds ?? []).length > 0) {
          await tx.animalTag.createMany({
            data: [...new Set(input.tagIds)].map((tagId) => ({
              animalId: id,
              tagId,
              createdById: userId,
              createdAt: at,
            })),
          });
        }
        if (input.initialWeight !== undefined) {
          await tx.weightRecord.create({
            data: {
              id: uuidv7(),
              farmId: scope.farmId,
              animalId: id,
              weighedOn: toPrismaDate(weighedOn),
              weightKg: new Prisma.Decimal(input.initialWeight.weightKg),
              method: input.initialWeight.method ?? WEIGHT_METHOD.SCALE,
              isBirthWeight: weighedOn === birthDate,
              createdById: userId,
              createdAt: at,
            },
          });
        }
        if (input.purchasePrice !== undefined) {
          await this.createPurchaseExpense(tx, scope, {
            animalId: id,
            code: input.code,
            amount: input.purchasePrice,
            occurredOn: entryDate,
            at,
          });
        }

        await audit(tx, {
          scope,
          entity: 'Animal',
          entityId: id,
          action: AUDIT_ACTION.CREATE,
          at,
          diff: {
            after: {
              ...snapshot(animal),
              identifiers: identifiers.map(
                (identifier) => `${identifier.type}:${identifier.value}`,
              ),
              tagIds: input.tagIds ?? [],
              initialWeightKg: input.initialWeight?.weightKg ?? null,
            },
          },
        });
        return found;
      })
      .catch((error: unknown) => translateUniqueViolation(error, input.code));

    return { ...(await this.details.detail(scope, id, context)), warnings };
  }

  // -------------------------------------------------------------------------------------------
  // Edición (ANI-02)
  // -------------------------------------------------------------------------------------------

  async update(
    scope: FarmScope,
    id: string,
    input: UpdateAnimalInput,
  ): Promise<AnimalDetailWithWarnings> {
    const context = await this.farmContext.load(scope);
    const { today } = context;
    const at = this.clock.now();
    const userId = userOf(scope);

    if (input.purchasePrice !== undefined) {
      requireAdmin(scope, 'Solo un administrador puede cambiar el valor de compra.');
    }
    if (input.forSale !== undefined) {
      requireAdmin(scope, 'Solo un administrador puede cambiar «Disponible para venta».');
    }

    const warnings = await this.prisma
      .$transaction(async (tx) => {
        const current = assertVersion(
          await tx.animal.findFirst({ where: { id, farmId: scope.farmId } }),
          input.version,
        );
        if (current.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');

        const requested = Object.entries(input)
          .filter(([key, value]) => key !== 'version' && value !== undefined)
          .map(([key]) => key);
        if (
          current.exitType !== null &&
          requested.some(
            (field) => !(FIELDS_EDITABLE_AFTER_EXIT as readonly string[]).includes(field),
          )
        ) {
          throw new DomainError('ANIMAL_EXITED');
        }

        const before = snapshot(current);
        const sex = input.sex ?? current.sex;
        const birthDate = (input.birthDate ?? before.birthDate) as IsoDate;
        const origin = input.origin ?? current.origin;
        const entryDate = (
          origin === ORIGIN.PURCHASED ? (input.entryDate ?? before.entryDate) : birthDate
        ) as IsoDate;
        const damId = input.damId === undefined ? current.damId : input.damId;
        const sireId = input.sireId === undefined ? current.sireId : input.sireId;
        const sireExternalRef =
          input.sireExternalRef === undefined ? current.sireExternalRef : input.sireExternalRef;
        if (sireId !== null && sireExternalRef !== null) {
          throw fieldError(
            'VALIDATION_FAILED',
            'sireExternalRef',
            'Indica el padre de la finca o la referencia externa, no ambos.',
          );
        }

        assertNotFuture(birthDate, today, 'birthDate');
        assertNotFuture(entryDate, today, 'entryDate');
        assertNotBeforeBirth(entryDate, birthDate, 'entryDate');

        await this.assertCatalogRefs(tx, scope, {
          breedId: input.breedId ?? null,
          lotId: input.lotId ?? null,
          tagIds: [],
        });
        if (input.code !== undefined && input.code !== current.code) {
          await assertCodeAvailable(tx, scope, {
            code: input.code,
            excludeAnimalId: id,
            codeReuse: context.settings.codeReuse,
            willBeActive: current.exitType === null,
          });
        }
        const found =
          input.damId !== undefined || input.sireId !== undefined || input.birthDate !== undefined
            ? await this.checkParents(tx, scope, context, {
                animalId: id,
                birthDate,
                damId,
                sireId,
              })
            : [];
        if (input.sex !== undefined && input.sex !== current.sex) {
          await this.assertSexChangeAllowed(tx, scope, id, current.sex);
        }
        if (input.birthDate !== undefined) {
          await this.assertNoEventBefore(tx, scope, id, birthDate);
        }
        if (input.purchasePrice != null && origin !== ORIGIN.PURCHASED) {
          throw fieldError(
            'VALIDATION_FAILED',
            'purchasePrice',
            'El valor de compra solo aplica a animales comprados.',
          );
        }

        const updated = await tx.animal.update({
          where: { id, version: input.version },
          data: {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            sex,
            ...(input.breedId === undefined ? {} : { breedId: input.breedId }),
            birthDate: toPrismaDate(birthDate),
            ...(input.birthDateEstimated === undefined
              ? {}
              : { birthDateEstimated: input.birthDateEstimated }),
            origin,
            ...(input.originDetail === undefined ? {} : { originDetail: input.originDetail }),
            entryDate: toPrismaDate(entryDate),
            // Una fecha de ingreso estimada deja de serlo cuando alguien la corrige (ANI-09).
            ...(entryDate === before.entryDate ? {} : { entryDateEstimated: false }),
            damId,
            sireId,
            sireExternalRef,
            ...(input.lotId === undefined ? {} : { lotId: input.lotId }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.photoUrl === undefined ? {} : { photoUrl: input.photoUrl }),
            ...(input.forSale === undefined ? {} : { forSale: input.forSale }),
            version: { increment: 1 },
            updatedById: userId,
            updatedAt: at,
          },
        });

        if (input.lotId !== undefined && input.lotId !== current.lotId) {
          await tx.lotMovement.create({
            data: {
              id: uuidv7(),
              farmId: scope.farmId,
              animalId: id,
              fromLotId: current.lotId,
              toLotId: input.lotId,
              movedOn: toPrismaDate(today),
              createdById: userId,
              createdAt: at,
            },
          });
        }
        if (input.purchasePrice !== undefined) {
          await this.setPurchasePrice(tx, scope, {
            animalId: id,
            code: updated.code,
            amount: input.purchasePrice,
            occurredOn: entryDate,
            at,
          });
        }

        const diff = changesBetween(before, snapshot(updated), AUDITED_FIELDS);
        await audit(tx, {
          scope,
          entity: 'Animal',
          entityId: id,
          action: AUDIT_ACTION.UPDATE,
          at,
          diff,
        });
        return found;
      })
      .catch((error: unknown) => translateUniqueViolation(error, input.code ?? ''));

    return { ...(await this.details.detail(scope, id, context)), warnings };
  }

  // -------------------------------------------------------------------------------------------
  // Operaciones en lote (CLS-02 CA2)
  // -------------------------------------------------------------------------------------------

  /**
   * Agrega o quita etiquetas manuales y cambia «Disponible para venta» a varios animales. Todo o
   * nada: si un animal no existe en la finca, salió o está archivado, no se cambia ninguno.
   */
  async bulkTags(scope: FarmScope, input: BulkTagsInput): Promise<BulkTagsResult> {
    if (input.forSale !== undefined) {
      requireAdmin(scope, 'Solo un administrador puede cambiar «Disponible para venta».');
    }
    const userId = userOf(scope);
    const at = this.clock.now();
    const add = [...new Set(input.add ?? [])];
    const remove = [...new Set(input.remove ?? [])];

    await this.prisma.$transaction(async (tx) => {
      const animals = await this.lockEditable(tx, scope, input.animalIds);
      if (add.length > 0)
        await this.assertCatalogRefs(tx, scope, { breedId: null, lotId: null, tagIds: add });
      if (remove.length > 0) {
        const known = await tx.tag.count({ where: { farmId: scope.farmId, id: { in: remove } } });
        if (known !== remove.length) {
          throw fieldError(
            'VALIDATION_FAILED',
            'remove',
            'Alguna etiqueta no existe en esta finca.',
          );
        }
      }

      const links = await tx.animalTag.findMany({
        where: { animalId: { in: input.animalIds } },
        select: { animalId: true, tagId: true },
      });
      const tagsOf = (animalId: string) =>
        links
          .filter((link) => link.animalId === animalId)
          .map((link) => link.tagId)
          .sort();

      if (add.length > 0) {
        await tx.animalTag.createMany({
          data: input.animalIds.flatMap((animalId) =>
            add.map((tagId) => ({ animalId, tagId, createdById: userId, createdAt: at })),
          ),
          skipDuplicates: true,
        });
      }
      if (remove.length > 0) {
        // Es la relación animal–etiqueta, no un dato de negocio: quitarla es la edición en sí,
        // y queda en la auditoría con el antes y el después.
        await tx.animalTag.deleteMany({
          where: { animalId: { in: input.animalIds }, tagId: { in: remove } },
        });
      }
      if (input.forSale !== undefined) {
        await tx.animal.updateMany({
          where: { id: { in: input.animalIds }, farmId: scope.farmId, forSale: !input.forSale },
          data: {
            forSale: input.forSale,
            version: { increment: 1 },
            updatedById: userId,
            updatedAt: at,
          },
        });
      }

      for (const animal of animals) {
        const beforeTags = tagsOf(animal.id);
        const afterTags = [
          ...new Set([...beforeTags.filter((tag) => !remove.includes(tag)), ...add]),
        ].sort();
        const before = { tagIds: beforeTags, forSale: animal.forSale };
        const after = { tagIds: afterTags, forSale: input.forSale ?? animal.forSale };
        const diff = changesBetween(before, after, ['tagIds', 'forSale']);
        if ((diff.changed as string[]).length === 0) continue;
        await audit(tx, {
          scope,
          entity: 'Animal',
          entityId: animal.id,
          action: AUDIT_ACTION.UPDATE,
          at,
          diff,
        });
      }
    });

    return { updated: input.animalIds.length };
  }

  /** Cambia de lote a varios animales con la fecha indicada y deja un `LotMovement` por cada uno. */
  async bulkLot(scope: FarmScope, input: BulkLotInput): Promise<BulkLotResult> {
    const context = await this.farmContext.load(scope);
    const date = input.date;
    assertNotFuture(date, context.today, 'date');
    const userId = userOf(scope);
    const at = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const animals = await this.lockEditable(tx, scope, input.animalIds);
      await this.assertCatalogRefs(tx, scope, { breedId: null, lotId: input.lotId, tagIds: [] });

      let moved = 0;
      for (const animal of animals) {
        if (animal.lotId === input.lotId) continue;
        assertNotBeforeBirth(date, fromPrismaDate(animal.birthDate), 'date');
        await tx.animal.update({
          where: { id: animal.id },
          data: {
            lotId: input.lotId,
            version: { increment: 1 },
            updatedById: userId,
            updatedAt: at,
          },
        });
        await tx.lotMovement.create({
          data: {
            id: uuidv7(),
            farmId: scope.farmId,
            animalId: animal.id,
            fromLotId: animal.lotId,
            toLotId: input.lotId,
            movedOn: toPrismaDate(date),
            createdById: userId,
            createdAt: at,
          },
        });
        await audit(tx, {
          scope,
          entity: 'Animal',
          entityId: animal.id,
          action: AUDIT_ACTION.UPDATE,
          at,
          diff: changesBetween({ lotId: animal.lotId }, { lotId: input.lotId }, ['lotId']),
        });
        moved += 1;
      }
      return { moved, unchanged: animals.length - moved };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Reglas compartidas
  // -------------------------------------------------------------------------------------------

  /** Animales de la finca que admiten ediciones; si alguno no, falla todo el lote (RN-09). */
  private async lockEditable(tx: Tx, scope: FarmScope, ids: readonly string[]) {
    const animals = await tx.animal.findMany({
      where: { farmId: scope.farmId, id: { in: [...ids] } },
      select: {
        id: true,
        code: true,
        lotId: true,
        forSale: true,
        birthDate: true,
        deletedAt: true,
        exitType: true,
      },
    });
    if (animals.length !== ids.length) throw new DomainError('NOT_FOUND');
    const archived = animals.find((animal) => animal.deletedAt !== null);
    if (archived !== undefined) {
      throw new DomainError('ANIMAL_ARCHIVED', {
        detail: `El animal ${archived.code} está archivado.`,
      });
    }
    const exited = animals.find((animal) => animal.exitType !== null);
    if (exited !== undefined) {
      throw new DomainError('ANIMAL_EXITED', {
        detail: `El animal ${exited.code} ya salió de la finca; revierte la salida para modificarlo.`,
      });
    }
    return animals;
  }

  /** Raza, lote y etiquetas: de esta finca y activos. */
  private async assertCatalogRefs(
    tx: Tx,
    scope: FarmScope,
    refs: { breedId: string | null; lotId: string | null; tagIds: readonly string[] },
  ): Promise<void> {
    if (refs.breedId !== null) {
      const breed = await tx.breed.findFirst({
        where: { id: refs.breedId, farmId: scope.farmId, isActive: true },
        select: { id: true },
      });
      if (breed === null)
        throw fieldError('VALIDATION_FAILED', 'breedId', 'Elige una raza del catálogo.');
    }
    if (refs.lotId !== null) {
      const lot = await tx.lot.findFirst({
        where: { id: refs.lotId, farmId: scope.farmId, isActive: true },
        select: { id: true },
      });
      if (lot === null) throw fieldError('VALIDATION_FAILED', 'lotId', 'Elige un lote activo.');
    }
    if (refs.tagIds.length > 0) {
      const unique = [...new Set(refs.tagIds)];
      const tags = await tx.tag.count({
        where: { id: { in: unique }, farmId: scope.farmId, isActive: true },
      });
      if (tags !== unique.length) {
        throw fieldError(
          'VALIDATION_FAILED',
          'tagIds',
          'Alguna etiqueta no existe o está inactiva.',
        );
      }
    }
  }

  /**
   * RN-02 y RN-23: madre hembra y padre macho, de esta finca y sin archivar; la madre nació antes
   * que la cría; si la madre no tenía la edad mínima reproductiva, advertencia.
   */
  private async checkParents(
    tx: Tx,
    scope: FarmScope,
    context: FarmContext,
    input: {
      animalId: string | null;
      birthDate: IsoDate;
      damId: string | null;
      sireId: string | null;
    },
  ): Promise<Warning[]> {
    const warnings: Warning[] = [];
    for (const [field, parentId] of [
      ['damId', input.damId],
      ['sireId', input.sireId],
    ] as const) {
      if (parentId === null) continue;
      if (parentId === input.animalId) {
        throw fieldError(
          'VALIDATION_FAILED',
          field,
          'Un animal no puede ser su propio padre o madre.',
        );
      }
      const parent = await tx.animal.findFirst({
        where: { id: parentId, farmId: scope.farmId, deletedAt: null },
        select: { code: true, sex: true, birthDate: true },
      });
      if (parent === null) {
        throw fieldError('VALIDATION_FAILED', field, 'Ese animal no existe en esta finca.');
      }
      const isDam = field === 'damId';
      if (isDam && parent.sex !== SEX.FEMALE) {
        throw new DomainError('SEX_NOT_ALLOWED', {
          detail: `La madre debe ser hembra; ${parent.code} es macho.`,
          fieldErrors: { damId: ['La madre debe ser hembra.'] },
        });
      }
      if (!isDam && parent.sex !== SEX.MALE) {
        throw new DomainError('SEX_NOT_ALLOWED', {
          detail: `El padre debe ser macho; ${parent.code} es hembra.`,
          fieldErrors: { sireId: ['El padre debe ser macho.'] },
        });
      }
      const parentBirth = fromPrismaDate(parent.birthDate);
      if (parentBirth >= input.birthDate) {
        throw fieldError(
          'VALIDATION_FAILED',
          field,
          isDam
            ? 'La madre debe haber nacido antes que la cría.'
            : 'El padre debe haber nacido antes que la cría.',
        );
      }
      const minAge = context.settings.minBreedingAgeMonths;
      if (isDam && monthsBetween(parentBirth, input.birthDate) < minAge) {
        warnings.push(
          warning('DAM_AGE_LOW', {
            code: parent.code,
            age: formatAge({ birthDate: parentBirth, today: input.birthDate }),
            minAge: `${minAge} meses`,
          }),
        );
      }
    }
    return warnings;
  }

  /** Cambiar el sexo no puede contradecir preñeces (RN-02) ni crías registradas como padre. */
  private async assertSexChangeAllowed(
    tx: Tx,
    scope: FarmScope,
    id: string,
    current: string,
  ): Promise<void> {
    const conflicts =
      current === SEX.FEMALE
        ? (await tx.pregnancy.count({ where: { farmId: scope.farmId, damId: id } })) +
          (await tx.animal.count({ where: { farmId: scope.farmId, damId: id } }))
        : (await tx.animal.count({ where: { farmId: scope.farmId, sireId: id } })) +
          (await tx.pregnancy.count({ where: { farmId: scope.farmId, sireId: id } }));
    if (conflicts > 0) {
      throw new DomainError('SEX_NOT_ALLOWED', {
        detail:
          current === SEX.FEMALE
            ? 'No se puede cambiar el sexo: la hembra ya tiene servicios, partos o crías registrados.'
            : 'No se puede cambiar el sexo: el macho ya figura como padre.',
        fieldErrors: { sex: ['No se puede cambiar el sexo de este animal.'] },
      });
    }
  }

  /** RN-14 al mover la fecha de nacimiento: ningún evento ni cría puede quedar antes. */
  private async assertNoEventBefore(
    tx: Tx,
    scope: FarmScope,
    id: string,
    birthDate: IsoDate,
  ): Promise<void> {
    const before = toPrismaDate(birthDate);
    const where = { farmId: scope.farmId, animalId: id };
    const counts = await Promise.all([
      tx.pregnancy.count({
        where: { farmId: scope.farmId, damId: id, serviceDate: { lt: before } },
      }),
      tx.vaccinationRecord.count({ where: { ...where, appliedOn: { lt: before } } }),
      tx.treatmentRecord.count({ where: { ...where, startedOn: { lt: before } } }),
      tx.weightRecord.count({ where: { ...where, weighedOn: { lt: before } } }),
      tx.lotMovement.count({ where: { ...where, movedOn: { lt: before } } }),
      tx.identifier.count({ where: { ...where, assignedAt: { lt: before } } }),
      tx.animal.count({
        where: {
          farmId: scope.farmId,
          OR: [{ damId: id }, { sireId: id }],
          birthDate: { lte: before },
        },
      }),
    ]);
    if (counts.some((count) => count > 0)) {
      throw new DomainError('DATE_BEFORE_BIRTH', {
        detail: 'Hay eventos o crías registrados antes de esa fecha de nacimiento.',
        fieldErrors: { birthDate: ['Hay eventos o crías registrados antes de esta fecha.'] },
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Valor de compra (ANI-01 CA2, RN-20)
  // -------------------------------------------------------------------------------------------

  /** Gasto `PURCHASE` asignado 100 % al animal. */
  private async createPurchaseExpense(
    tx: Tx,
    scope: FarmScope,
    input: { animalId: string; code: string; amount: string; occurredOn: IsoDate; at: Date },
  ): Promise<void> {
    const expenseId = uuidv7();
    await tx.expense.create({
      data: {
        id: expenseId,
        farmId: scope.farmId,
        type: 'PURCHASE',
        occurredOn: toPrismaDate(input.occurredOn),
        amount: new Prisma.Decimal(input.amount),
        description: `Compra del animal ${input.code}`,
        allocationMethod: 'DIRECT',
        createdById: userOf(scope),
        createdAt: input.at,
        allocations: {
          create: {
            id: uuidv7(),
            farmId: scope.farmId,
            animalId: input.animalId,
            amount: new Prisma.Decimal(input.amount),
          },
        },
      },
    });
    await audit(tx, {
      scope,
      entity: 'Expense',
      entityId: expenseId,
      action: AUDIT_ACTION.CREATE,
      at: input.at,
      diff: {
        after: {
          type: 'PURCHASE',
          amount: new Prisma.Decimal(input.amount).toFixed(2),
          animalId: input.animalId,
          occurredOn: input.occurredOn,
        },
      },
    });
  }

  /** Cambia, crea o anula (con `null`) el gasto de compra del animal. */
  private async setPurchasePrice(
    tx: Tx,
    scope: FarmScope,
    input: { animalId: string; code: string; amount: string | null; occurredOn: IsoDate; at: Date },
  ): Promise<void> {
    const current = await tx.expense.findFirst({
      where: {
        farmId: scope.farmId,
        type: 'PURCHASE',
        voidedAt: null,
        allocations: { some: { animalId: input.animalId } },
      },
      include: { allocations: true },
    });

    if (current === null) {
      if (input.amount !== null) {
        await this.createPurchaseExpense(tx, scope, { ...input, amount: input.amount });
      }
      return;
    }

    const before = current.amount.toFixed(2);
    if (input.amount === null) {
      await tx.expense.update({
        where: { id: current.id },
        data: {
          voidedAt: input.at,
          voidReason: 'Se quitó el valor de compra de la ficha del animal.',
        },
      });
      await audit(tx, {
        scope,
        entity: 'Expense',
        entityId: current.id,
        action: AUDIT_ACTION.VOID,
        at: input.at,
        diff: { before: { amount: before } },
      });
      return;
    }

    const amount = new Prisma.Decimal(input.amount);
    await tx.expense.update({ where: { id: current.id }, data: { amount } });
    await tx.expenseAllocation.updateMany({
      where: { expenseId: current.id, animalId: input.animalId },
      data: { amount },
    });
    await audit(tx, {
      scope,
      entity: 'Expense',
      entityId: current.id,
      action: AUDIT_ACTION.UPDATE,
      at: input.at,
      diff: changesBetween({ amount: before }, { amount: amount.toFixed(2) }, ['amount']),
    });
  }
}

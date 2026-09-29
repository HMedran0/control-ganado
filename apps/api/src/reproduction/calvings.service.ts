import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  BIRTH_CONDITION,
  CALF_HEALTH,
  DomainError,
  ORIGIN,
  PREGNANCY_OUTCOME,
  SERVICE_METHOD,
  WEIGHT_METHOD,
  estimatedServiceDate,
  formatAge,
  isBreedingAgeLow,
  isDomainError,
  isoDateParts,
  normalizeAnimalCode,
  uuidv7,
  warning,
  type CalfInput,
  type CalvingInput,
  type CalvingResult,
  type IsoDate,
  type Warning,
} from '@hato/shared';

import {
  assertNotBeforeBirth,
  assertNotFuture,
  fieldError,
  userOf,
} from '../animals/animal-rules.js';
import { assertCodeAvailable } from '../animals/code-availability.js';
import { suggestFarmCodes } from '../animals/code-suggestion.js';
import { FarmContextService, type FarmContext } from '../animals/farm-context.service.js';
import { checkIdentifier, type CheckedIdentifier } from '../animals/identifier-rules.js';
import { EntitlementsService, PLAN_LIMIT } from '../common/entitlements/entitlements.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { asReplayed, clientIdConflict } from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { audit, isUniqueViolation, type Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  pregnancyInclude,
  pregnancySnapshot,
  toPregnancyView,
  type PregnancyRow,
} from './pregnancy-views.js';
import {
  assertNotBeforeService,
  assertOpen,
  lockDam,
  lockPregnancy,
  openPregnancyOf,
  type LockedDam,
} from './reproduction-rules.js';

/** Cría viva lista para crear: código definitivo e identificadores ya verificados. */
type PlannedCalf = {
  readonly index: number;
  readonly input: CalfInput;
  readonly id: string;
  readonly code: string;
  readonly breedId: string;
  readonly identifiers: readonly CheckedIdentifier[];
};

/**
 * Registro de parto (REP-04, CU-01, RN-05, RN-23): una sola transacción que
 *
 * 1. cierra la preñez abierta con `CALVED` o, si la hembra no tenía, crea una ya cerrada con la
 *    fecha de servicio estimada (parto menos la gestación de su raza; no entra en los indicadores,
 *    RN-38);
 * 2. crea cada cría viva: madre, padre de la preñez, raza de la madre salvo que se indique otra,
 *    nacida en la finca, lote de la madre, estado al nacer y el peso como primer pesaje;
 * 3. suma las muertas al nacer a `stillborn_count` (no son animales, REP-04 CA4).
 *
 * El código de las crías que llegan sin él lo asigna la API con la sugerencia de la finca
 * (`PATTERN` o `LOWEST_FREE`), bajo un candado por finca; todos pasan por `assertCodeAvailable`.
 * Las crías cuentan para el plan (`EntitlementsService`, ADR-013). Si algo falla —un código
 * tomado, un identificador repetido—, no se guarda nada (REP-04 CA5).
 */
@Injectable()
export class CalvingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly farmContext: FarmContextService,
    private readonly transactions: TransactionsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async calve(scope: FarmScope, input: CalvingInput): Promise<CalvingResult> {
    const context = await this.farmContext.load(scope);
    const { today } = context;
    const date = input.date;
    assertNotFuture(date, today, 'date');

    const replay = await this.replayByClientIds(scope, input);
    if (replay !== null) return asReplayed(replay);

    const at = this.clock.now();
    const userId = userOf(scope);
    const stillborn = input.calves.filter((calf) => calf.health === CALF_HEALTH.STILLBORN).length;
    const live = input.calves
      .map((calf, index) => ({ calf, index }))
      .filter(({ calf }) => calf.health !== CALF_HEALTH.STILLBORN);

    return this.transactions
      .run(async (tx) => {
        const dam = await lockDam(tx, scope, input.damId);
        const damBirth = fromPrismaDate(dam.birthDate);
        assertNotBeforeBirth(date, damBirth, 'date');

        const open = await this.pregnancyToClose(tx, scope, input, dam);
        if (open !== null) {
          assertNotBeforeService(
            date,
            open.serviceDate,
            'date',
            'El parto no puede ser anterior al servicio.',
          );
        }

        const planned = await this.planCalves(tx, scope, context, dam, date, live);
        // ADR-013: las crías vivas son altas de animal.
        await this.entitlements.checkLimit(scope.farmId, PLAN_LIMIT.ANIMALS, planned.length, tx);

        const warnings: Warning[] = [];
        if (
          isBreedingAgeLow({
            birthDate: damBirth,
            serviceDate: date,
            minBreedingAgeMonths: context.settings.minBreedingAgeMonths,
          })
        ) {
          // RN-23: la madre era menor que la edad mínima reproductiva al nacer la cría.
          warnings.push(
            warning('DAM_AGE_LOW', {
              code: dam.code,
              age: formatAge({ birthDate: damBirth, today: date }),
              minAge: `${context.settings.minBreedingAgeMonths} meses`,
            }),
          );
        }

        const pregnancyId =
          open === null
            ? await this.createClosedPregnancy(tx, scope, context, { input, dam, stillborn, at })
            : await this.closePregnancy(tx, scope, { input, open, stillborn, at });

        const sire = await tx.pregnancy.findUniqueOrThrow({
          where: { id: pregnancyId },
          select: { sireId: true, sireExternalRef: true },
        });
        for (const calf of planned) {
          await this.createCalf(tx, scope, { calf, dam, date, pregnancyId, sire, at, userId });
        }

        const pregnancy = await tx.pregnancy.findUniqueOrThrow({
          where: { id: pregnancyId },
          include: pregnancyInclude,
        });
        return {
          pregnancy: toPregnancyView(pregnancy, today),
          calves: planned.map((calf) => ({
            id: calf.id,
            code: calf.code,
            name: null,
            sex: calf.input.sex,
          })),
          warnings,
        };
      })
      .catch(translateCalvingViolation);
  }

  /**
   * La preñez que cierra el parto: la indicada (de esta hembra y abierta) o la abierta de la
   * hembra. `null` si no tiene ninguna: el parto crea una cerrada con servicio estimado.
   */
  private async pregnancyToClose(
    tx: Tx,
    scope: FarmScope,
    input: CalvingInput,
    dam: LockedDam,
  ): Promise<PregnancyRow | null> {
    if (input.pregnancyId === undefined) return openPregnancyOf(tx, scope, dam.id);
    const pregnancy = await lockPregnancy(tx, scope, input.pregnancyId);
    if (pregnancy.damId !== dam.id) {
      throw fieldError('VALIDATION_FAILED', 'pregnancyId', 'Esa preñez no es de esta hembra.');
    }
    assertOpen(pregnancy);
    return pregnancy;
  }

  /** Códigos definitivos, raza e identificadores de cada cría viva, todo verificado. */
  private async planCalves(
    tx: Tx,
    scope: FarmScope,
    context: FarmContext,
    dam: LockedDam,
    date: IsoDate,
    live: readonly { calf: CalfInput; index: number }[],
  ): Promise<PlannedCalf[]> {
    // Candado de la numeración automática: dos partos a la vez no reciben el mismo código.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope.farmId}::text || ':calf-codes', 0))`;
    const written = live.flatMap(({ calf }) => (calf.code === undefined ? [] : [calf.code]));
    const suggested = await suggestFarmCodes(tx, scope, context.settings, {
      year: isoDateParts(date).year,
      count: live.length - written.length,
      alsoTaken: written,
    });

    const planned: PlannedCalf[] = [];
    const seenCodes = new Set<string>();
    const seenIdentifiers = new Set<string>();
    for (const { calf, index } of live) {
      const code = calf.code ?? takeSuggested(suggested);
      const normalized = normalizeAnimalCode(code);
      if (seenCodes.has(normalized)) {
        throw fieldError(
          'VALIDATION_FAILED',
          `calves.${index}.code`,
          'Ese código está repetido en el parto.',
        );
      }
      seenCodes.add(normalized);
      await withField(`calves.${index}.code`, () =>
        assertCodeAvailable(tx, scope, {
          code,
          excludeAnimalId: null,
          codeReuse: context.settings.codeReuse,
          willBeActive: true,
        }),
      );

      const breedId = calf.breedId ?? dam.breedId;
      if (calf.breedId !== undefined) {
        const breed = await tx.breed.findFirst({
          where: { id: calf.breedId, farmId: scope.farmId },
          select: { id: true },
        });
        if (breed === null) {
          throw fieldError(
            'VALIDATION_FAILED',
            `calves.${index}.breedId`,
            'Esa raza no existe en esta finca.',
          );
        }
      }

      const identifiers: CheckedIdentifier[] = [];
      for (const [position, identifier] of (calf.identifiers ?? []).entries()) {
        const field = `calves.${index}.identifiers.${position}.value`;
        const checked = await withField(field, () =>
          checkIdentifier(tx, scope, {
            type: identifier.type,
            value: identifier.value,
            animalId: null,
          }),
        );
        const key = `${checked.type}:${checked.value}`;
        if (seenIdentifiers.has(key)) {
          throw fieldError(
            'VALIDATION_FAILED',
            field,
            'Ese identificador está repetido en el parto.',
          );
        }
        seenIdentifiers.add(key);
        identifiers.push(checked);
      }

      planned.push({ index, input: calf, id: calf.id ?? uuidv7(), code, breedId, identifiers });
    }
    return planned;
  }

  private async closePregnancy(
    tx: Tx,
    scope: FarmScope,
    input: {
      readonly input: CalvingInput;
      readonly open: PregnancyRow;
      readonly stillborn: number;
      readonly at: Date;
    },
  ): Promise<string> {
    const { open } = input;
    const updated = await tx.pregnancy.update({
      where: { id: open.id },
      data: {
        outcome: PREGNANCY_OUTCOME.CALVED,
        outcomeDate: toPrismaDate(input.input.date),
        calvingType: input.input.calvingType,
        stillbornCount: input.stillborn,
        ...(input.input.notes === undefined ? {} : { notes: input.input.notes }),
        version: { increment: 1 },
        updatedById: userOf(scope),
      },
    });
    await audit(tx, {
      scope,
      entity: 'Pregnancy',
      entityId: open.id,
      action: AUDIT_ACTION.UPDATE,
      at: input.at,
      diff: { before: pregnancySnapshot(open), after: pregnancySnapshot(updated) },
    });
    return open.id;
  }

  /** REP-04 CA1: parto sin preñez registrada → preñez cerrada con servicio estimado. */
  private async createClosedPregnancy(
    tx: Tx,
    scope: FarmScope,
    context: FarmContext,
    input: {
      readonly input: CalvingInput;
      readonly dam: LockedDam;
      readonly stillborn: number;
      readonly at: Date;
    },
  ): Promise<string> {
    const date = input.input.date;
    const gestationDays = input.dam.breed.gestationDays ?? context.settings.gestationDays;
    const id = input.input.id ?? uuidv7();
    const userId = userOf(scope);
    const created = await tx.pregnancy.create({
      data: {
        id,
        farmId: scope.farmId,
        damId: input.dam.id,
        serviceDate: toPrismaDate(estimatedServiceDate(date, gestationDays)),
        serviceDateEstimated: true,
        method: SERVICE_METHOD.UNKNOWN,
        expectedCalvingDate: toPrismaDate(date),
        outcome: PREGNANCY_OUTCOME.CALVED,
        outcomeDate: toPrismaDate(date),
        calvingType: input.input.calvingType,
        stillbornCount: input.stillborn,
        notes: input.input.notes ?? null,
        createdById: userId,
        updatedById: userId,
        createdAt: input.at,
      },
    });
    await audit(tx, {
      scope,
      entity: 'Pregnancy',
      entityId: id,
      action: AUDIT_ACTION.CREATE,
      at: input.at,
      diff: { after: { damId: input.dam.id, ...pregnancySnapshot(created) } },
    });
    return id;
  }

  /** RN-05: la cría viva, sus identificadores y su peso al nacer como primer pesaje. */
  private async createCalf(
    tx: Tx,
    scope: FarmScope,
    input: {
      readonly calf: PlannedCalf;
      readonly dam: LockedDam;
      readonly date: IsoDate;
      readonly pregnancyId: string;
      readonly sire: { sireId: string | null; sireExternalRef: string | null };
      readonly at: Date;
      readonly userId: string;
    },
  ): Promise<void> {
    const { calf, dam, date, at, userId } = input;
    const birthCondition =
      calf.input.health === CALF_HEALTH.WEAK ? BIRTH_CONDITION.WEAK : BIRTH_CONDITION.HEALTHY;
    await tx.animal.create({
      data: {
        id: calf.id,
        farmId: scope.farmId,
        code: calf.code,
        sex: calf.input.sex,
        breedId: calf.breedId,
        birthDate: toPrismaDate(date),
        origin: ORIGIN.BORN_ON_FARM,
        entryDate: toPrismaDate(date),
        damId: dam.id,
        sireId: input.sire.sireId,
        sireExternalRef: input.sire.sireExternalRef,
        birthPregnancyId: input.pregnancyId,
        birthCondition,
        lotId: dam.lotId,
        createdById: userId,
        updatedById: userId,
        createdAt: at,
      },
    });
    for (const identifier of calf.identifiers) {
      await tx.identifier.create({
        data: {
          id: uuidv7(),
          farmId: scope.farmId,
          animalId: calf.id,
          type: identifier.type,
          value: identifier.value,
          assignedAt: toPrismaDate(date),
          createdAt: at,
        },
      });
    }
    if (calf.input.birthWeightKg !== undefined) {
      await tx.weightRecord.create({
        data: {
          id: uuidv7(),
          farmId: scope.farmId,
          animalId: calf.id,
          weighedOn: toPrismaDate(date),
          weightKg: new Prisma.Decimal(calf.input.birthWeightKg),
          method: WEIGHT_METHOD.SCALE,
          isBirthWeight: true,
          createdById: userId,
          createdAt: at,
        },
      });
    }
    await audit(tx, {
      scope,
      entity: 'Animal',
      entityId: calf.id,
      action: AUDIT_ACTION.CREATE,
      at,
      diff: {
        after: {
          code: calf.code,
          sex: calf.input.sex,
          breedId: calf.breedId,
          birthDate: date,
          origin: ORIGIN.BORN_ON_FARM,
          damId: dam.id,
          sireId: input.sire.sireId,
          sireExternalRef: input.sire.sireExternalRef,
          lotId: dam.lotId,
          birthCondition,
          birthPregnancyId: input.pregnancyId,
          identifiers: calf.identifiers.map(
            (identifier) => `${identifier.type}:${identifier.value}`,
          ),
          initialWeightKg: calf.input.birthWeightKg ?? null,
        },
      },
    });
  }

  /**
   * ADR-012 §1 sin `Idempotency-Key`: si el `id` de la preñez o de alguna cría ya existe, el parto
   * solo puede ser el mismo —la misma hembra, la misma fecha y exactamente esas crías de esa
   * preñez— y responde 200 con él. Cualquier otra cosa es `CLIENT_ID_CONFLICT`.
   */
  private async replayByClientIds(
    scope: FarmScope,
    input: CalvingInput,
  ): Promise<CalvingResult | null> {
    const calfIds = input.calves.flatMap((calf) => (calf.id === undefined ? [] : [calf.id]));
    if (input.id === undefined && calfIds.length === 0) return null;

    const [pregnancy, calves] = await Promise.all([
      input.id === undefined
        ? Promise.resolve(null)
        : this.prisma.pregnancy.findUnique({ where: { id: input.id }, include: pregnancyInclude }),
      this.prisma.animal.findMany({
        where: { id: { in: calfIds } },
        select: { id: true, farmId: true, damId: true, birthPregnancyId: true },
      }),
    ]);
    if (pregnancy === null && calves.length === 0) return null;

    const pregnancyId = pregnancy?.id ?? calves[0]?.birthPregnancyId ?? null;
    if (
      pregnancyId === null ||
      (pregnancy !== null && pregnancy.farmId !== scope.farmId) ||
      calves.length !== calfIds.length ||
      calves.some(
        (calf) =>
          calf.farmId !== scope.farmId ||
          calf.damId !== input.damId ||
          calf.birthPregnancyId !== pregnancyId,
      ) ||
      (input.pregnancyId !== undefined && input.pregnancyId !== pregnancyId)
    ) {
      throw clientIdConflict();
    }

    const stored =
      pregnancy ??
      (await this.prisma.pregnancy.findUnique({
        where: { id: pregnancyId },
        include: pregnancyInclude,
      }));
    if (
      stored === null ||
      stored.damId !== input.damId ||
      stored.outcome !== PREGNANCY_OUTCOME.CALVED ||
      stored.outcomeDate === null ||
      fromPrismaDate(stored.outcomeDate) !== input.date
    ) {
      throw clientIdConflict();
    }
    const born = await this.prisma.animal.findMany({
      where: { birthPregnancyId: stored.id, farmId: scope.farmId },
      select: { id: true, code: true, name: true, sex: true },
      orderBy: { code: 'asc' },
    });
    return { pregnancy: toPregnancyView(stored, this.clock.today()), calves: born, warnings: [] };
  }
}

/** El siguiente código sugerido: se pidieron tantos como crías sin código. */
function takeSuggested(suggested: string[]): string {
  const code = suggested.shift();
  if (code === undefined) throw new Error('Faltan códigos sugeridos para las crías.');
  return code;
}

/** Pone el error de una regla compartida en el campo de la cría que lo causó. */
async function withField<T>(field: string, check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch (error) {
    if (isDomainError(error)) {
      throw new DomainError(error.code, {
        detail: error.detail,
        fieldErrors: { [field]: [error.detail] },
        ...(error.context === undefined ? {} : { context: error.context }),
      });
    }
    throw error;
  }
}

/** Choques de índices únicos que el candado no alcanzó a evitar (RN-19, RN-31). */
function translateCalvingViolation(error: unknown): never {
  if (isUniqueViolation(error)) {
    const meta = JSON.stringify((error as Prisma.PrismaClientKnownRequestError).meta ?? {});
    if (meta.includes('value')) {
      throw new DomainError('IDENTIFIER_TAKEN', {
        detail: 'Uno de los identificadores ya está asignado a otro animal.',
        cause: error,
      });
    }
    if (meta.includes('dam_id')) {
      throw new DomainError('PREGNANCY_ALREADY_OPEN', { cause: error });
    }
    throw new DomainError('ANIMAL_CODE_TAKEN', {
      detail: 'Uno de los códigos de las crías acaba de asignarse a otro animal.',
      cause: error,
    });
  }
  throw error;
}

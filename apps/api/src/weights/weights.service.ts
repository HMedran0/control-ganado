import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  IDENTIFIED_BY,
  ROLE,
  WEIGHT_SOURCE,
  formatWeight,
  isWeightOutlier,
  previousWeightFor,
  uuidv7,
  warning,
  type AnimalWeights,
  type CreateWeightInput,
  type VoidEventInput,
  type WeightView,
  type WeightWithWarnings,
} from '@hato/shared';

import { AnimalDetailService } from '../animals/animal-detail.service.js';
import { userOf } from '../animals/animal-rules.js';
import { WEIGHT_LIKE_SELECT, toWeightLike, weightSummaryOf } from '../animals/animal-views.js';
import { FarmContextService } from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  asReplayed,
  assertSameContent,
  ownRecordOrConflict,
} from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { audit } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { assertEventDate, lockEventAnimal } from '../sanitary/event-rules.js';

/** Un pesaje se puede anular por quien lo registró hasta 24 horas después (05-api.md). */
const OWN_VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

type WeightRow = Prisma.WeightRecordGetPayload<object>;

export function toWeightView(row: WeightRow): WeightView {
  return {
    id: row.id,
    animalId: row.animalId,
    weighedOn: fromPrismaDate(row.weighedOn),
    weightKg: Number(row.weightKg),
    method: row.method,
    isBirthWeight: row.isBirthWeight,
    identifiedBy: row.identifiedBy,
    weightSource: row.weightSource,
    scaleSerial: row.scaleSerial,
    notes: row.notes,
    workSessionId: row.workSessionId,
    voided:
      row.voidedAt === null ? null : { at: row.voidedAt.toISOString(), reason: row.voidReason },
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
  };
}

/**
 * Pesajes (PES-01, PES-02, PES-05). Todos los roles registran; el peso digitado es
 * `weight_source = MANUAL` y guarda cómo se identificó al animal (PIL-05). Se anula por quien lo
 * registró en las 24 horas siguientes, o por un ADMIN.
 */
@Injectable()
export class WeightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly farmContext: FarmContextService,
    private readonly transactions: TransactionsService,
    private readonly details: AnimalDetailService,
  ) {}

  /** Serie del animal y su resumen de ganancia y alertas (PES-02, PES-05). */
  async forAnimal(scope: FarmScope, animalId: string): Promise<AnimalWeights> {
    const context = await this.farmContext.load(scope);
    const detail = await this.details.detail(scope, animalId, context);
    const rows = await this.prisma.weightRecord.findMany({
      where: { farmId: scope.farmId, animalId },
      orderBy: [{ weighedOn: 'asc' }, { id: 'asc' }],
    });
    return {
      items: rows.map(toWeightView),
      summary: weightSummaryOf(rows.map(toWeightLike), detail.category, context),
    };
  }

  async create(scope: FarmScope, input: CreateWeightInput): Promise<WeightWithWarnings> {
    if (input.id !== undefined) {
      const existing = ownRecordOrConflict(
        await this.prisma.weightRecord.findUnique({ where: { id: input.id } }),
        scope.farmId,
      );
      if (existing !== null) {
        assertSameContent(
          {
            animalId: input.animalId,
            weighedOn: input.date,
            weightKg: input.weightKg,
            method: input.method,
            identifiedBy: input.identifiedBy,
            notes: input.notes ?? null,
          },
          {
            animalId: existing.animalId,
            weighedOn: fromPrismaDate(existing.weighedOn),
            weightKg: Number(existing.weightKg),
            method: existing.method,
            identifiedBy: existing.identifiedBy,
            notes: existing.notes,
          },
        );
        return asReplayed({ ...toWeightView(existing), warnings: [] });
      }
    }

    const today = this.clock.today();
    const at = this.clock.now();
    const userId = userOf(scope);
    return this.transactions.run(async (tx) => {
      const animal = await lockEventAnimal(tx, scope, input.animalId);
      assertEventDate(input.date, animal, today);
      const records = (
        await tx.weightRecord.findMany({
          where: { farmId: scope.farmId, animalId: animal.id },
          select: WEIGHT_LIKE_SELECT,
        })
      ).map(toWeightLike);
      const previous = previousWeightFor(records, input.date);
      const warnings =
        previous !== null && isWeightOutlier(previous.weightKg, input.weightKg)
          ? [warning('WEIGHT_OUTLIER', { weight: formatWeight(input.weightKg, { unit: false }) })]
          : [];
      const hasBirthWeight = records.some((record) => record.isBirthWeight && !record.voided);

      const id = input.id ?? uuidv7();
      const created = await tx.weightRecord.create({
        data: {
          id,
          farmId: scope.farmId,
          animalId: animal.id,
          weighedOn: toPrismaDate(input.date),
          weightKg: new Prisma.Decimal(input.weightKg),
          method: input.method,
          isBirthWeight: input.date === animal.birthDate && !hasBirthWeight,
          identifiedBy: input.identifiedBy ?? IDENTIFIED_BY.SEARCH,
          weightSource: WEIGHT_SOURCE.MANUAL,
          notes: input.notes ?? null,
          createdById: userId,
          createdAt: at,
          updatedAt: at,
        },
      });
      await audit(tx, {
        scope,
        entity: 'WeightRecord',
        entityId: id,
        action: AUDIT_ACTION.CREATE,
        at,
        diff: {
          after: {
            animalId: animal.id,
            weighedOn: input.date,
            weightKg: input.weightKg,
            method: input.method,
            identifiedBy: created.identifiedBy,
            outlier: warnings.length > 0,
          },
        },
      });
      return { ...toWeightView(created), warnings };
    });
  }

  async void(scope: FarmScope, id: string, input: VoidEventInput): Promise<WeightView> {
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM weight_records
        WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
      const current = await tx.weightRecord.findFirst({ where: { id, farmId: scope.farmId } });
      if (current === null) throw new DomainError('NOT_FOUND');
      if (current.voidedAt !== null) return asReplayed(toWeightView(current));

      const own =
        current.createdById === scope.userId &&
        at.getTime() - current.createdAt.getTime() <= OWN_VOID_WINDOW_MS;
      if (scope.role !== ROLE.ADMIN && !own) {
        throw new DomainError('FORBIDDEN_ROLE', {
          detail:
            'Solo puedes anular los pesajes que registraste en las últimas 24 horas. Pídeselo al administrador.',
        });
      }
      const updated = await tx.weightRecord.update({
        where: { id },
        data: { voidedAt: at, voidReason: input.reason },
      });
      await audit(tx, {
        scope,
        entity: 'WeightRecord',
        entityId: id,
        action: AUDIT_ACTION.VOID,
        at,
        diff: { after: { reason: input.reason, animalId: current.animalId } },
      });
      return toWeightView(updated);
    });
  }
}

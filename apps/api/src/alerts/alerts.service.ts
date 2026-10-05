import { Injectable } from '@nestjs/common';
import {
  ANIMAL_ALERT,
  VACCINE_STATUS,
  animalWithdrawals,
  type AlertItem,
  type AlertsQuery,
  type AlertsResponse,
  type AnimalAlert,
  type IsoDate,
} from '@hato/shared';

import { ALERT_COLUMN, AnimalListService } from '../animals/animal-list.service.js';
import { classificationCtes } from '../animals/classification.sql.js';
import { FarmContextService, classificationParams } from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { parsePagination } from '../common/pagination/cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, fromPrismaDateOrNull } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';

const ALL_ALERTS = Object.values(ANIMAL_ALERT);

/**
 * Página de Alertas (M6; 06 §4): reproducción, vacunas, retiros y pesos. Filtra y cuenta con las
 * mismas columnas de `classificationCtes` que el listado (ADR-009); cada fila se muestra con las
 * funciones de shared, como el listado, más el detalle de sus alertas.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
    private readonly animalList: AnimalListService,
  ) {}

  async list(scope: FarmScope, query: AlertsQuery): Promise<AlertsResponse> {
    const pagination = parsePagination(query);
    const context = await this.farmContext.load(scope);

    // Solo los activos tienen alertas; el lote filtra también los conteos.
    const base: Prisma.Sql[] = [
      Prisma.sql`a.farm_id = ${scope.farmId}::uuid`,
      Prisma.sql`a.deleted_at IS NULL AND a.exit_type IS NULL`,
    ];
    if (query.lotId !== undefined && query.lotId.length > 0) {
      base.push(Prisma.sql`a.lot_id = ANY(${query.lotId}::uuid[])`);
    }

    const types: AnimalAlert[] =
      query.types === undefined || query.types.length === 0 ? ALL_ALERTS : query.types;
    const anyOf = Prisma.sql`(${Prisma.join(
      types.map((type) => ALERT_COLUMN[type]),
      ' OR ',
    )})`;

    const [counts, page] = await Promise.all([
      this.counts(scope, context, base),
      this.animalList.page(scope, context, [...base, anyOf], 'code', pagination),
    ]);

    const detailed = await this.animalList.toDetailedItems(scope, context, page.rows);
    const withdrawals = await this.withdrawalsOf(
      scope,
      page.rows.map((row) => row.id),
    );
    const items: AlertItem[] = detailed.map(({ item, vaccines, weight }, index) => {
      const row = page.rows[index];
      return {
        ...item,
        vaccines: vaccines.filter(
          (vaccine) =>
            vaccine.status === VACCINE_STATUS.OVERDUE ||
            vaccine.status === VACCINE_STATUS.PENDING ||
            vaccine.status === VACCINE_STATUS.UPCOMING,
        ),
        withdrawals: withdrawals.get(item.id) ?? { meatUntil: null, milkUntil: null },
        pregnancy:
          row === undefined ||
          row.open_service_date === null ||
          row.open_expected_calving_date === null
            ? null
            : {
                serviceDate: fromPrismaDate(row.open_service_date),
                confirmedAt: fromPrismaDateOrNull(row.open_confirmed_at),
                expectedCalvingDate: fromPrismaDate(row.open_expected_calving_date),
              },
        weight,
      };
    });

    return { counts, items, nextCursor: page.nextCursor, total: page.total };
  }

  /** Animales activos con cada alerta (con el filtro de lote, sin el de tipo). */
  private async counts(
    scope: FarmScope,
    context: Awaited<ReturnType<FarmContextService['load']>>,
    base: Prisma.Sql[],
  ): Promise<Record<AnimalAlert, number>> {
    const columns = ALL_ALERTS.map(
      (alert) => Prisma.sql`count(*) FILTER (WHERE ${ALERT_COLUMN[alert]})::int`,
    );
    const rows = await this.prisma.$queryRaw<{ counts: number[] }[]>(Prisma.sql`
      WITH ${classificationCtes(classificationParams(scope, context))}
      SELECT ARRAY[${Prisma.join(columns, ', ')}] AS counts
      FROM classified c JOIN animals a ON a.id = c.animal_id
      WHERE ${Prisma.join(base, ' AND ')}`);
    const values = rows[0]?.counts ?? [];
    return Object.fromEntries(
      ALL_ALERTS.map((alert, index) => [alert, values[index] ?? 0]),
    ) as Record<AnimalAlert, number>;
  }

  /** Retiros de carne y de leche vigentes o no, por animal de la página. */
  private async withdrawalsOf(
    scope: FarmScope,
    ids: readonly string[],
  ): Promise<Map<string, { meatUntil: IsoDate | null; milkUntil: IsoDate | null }>> {
    const result = new Map<string, { meatUntil: IsoDate | null; milkUntil: IsoDate | null }>();
    if (ids.length === 0) return result;
    const treatments = await this.prisma.treatmentRecord.findMany({
      where: { farmId: scope.farmId, animalId: { in: [...ids] } },
      select: {
        animalId: true,
        startedOn: true,
        durationDays: true,
        withdrawalMeatDays: true,
        withdrawalMilkDays: true,
        voidedAt: true,
      },
    });
    for (const id of ids) {
      const own = treatments.filter((treatment) => treatment.animalId === id);
      const { meatUntil, milkUntil } = animalWithdrawals(
        own.map((treatment) => ({
          startedOn: fromPrismaDate(treatment.startedOn),
          durationDays: treatment.durationDays,
          withdrawalMeatDays: treatment.withdrawalMeatDays,
          withdrawalMilkDays: treatment.withdrawalMilkDays,
          voided: treatment.voidedAt !== null,
        })),
      );
      result.set(id, { meatUntil, milkUntil });
    }
    return result;
  }
}

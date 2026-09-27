import { Injectable } from '@nestjs/common';
import {
  VACCINE_SCHEDULE_TYPE,
  cyclesAt,
  vaccineStatus,
  type VaccinationCycleLike,
  type VaccinationRecordLike,
  type VaccineSchedule,
  type VaccineStatusView,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { fromPrismaDate, fromPrismaDateOrNull } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { FarmContext } from './farm-context.service.js';

type CatalogVaccine = VaccineSchedule & { readonly id: string; readonly name: string };

/**
 * Estado de las vacunas por animal, calculado con `vaccineStatus` de `@hato/shared` (RN-13,
 * RN-27). No hay versión SQL: los cuatro tipos de programación viven solo en shared, y el
 * filtro de alertas de vacuna del listado recibe aquí la lista de animales que cumplen.
 *
 * Solo tiene sentido para animales activos: uno que salió o está archivado no tiene alertas.
 */
@Injectable()
export class VaccineStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estados de cada vacuna activa con programación para los animales pedidos. Si `animalIds`
   * es `'ALL_ACTIVE'`, para todos los activos de la finca.
   */
  async statusesFor(
    scope: FarmScope,
    context: FarmContext,
    animalIds: readonly string[] | 'ALL_ACTIVE',
  ): Promise<Map<string, VaccineStatusView[]>> {
    const result = new Map<string, VaccineStatusView[]>();
    if (animalIds !== 'ALL_ACTIVE' && animalIds.length === 0) return result;

    const [vaccines, cycles] = await Promise.all([this.vaccines(scope), this.cycles(scope)]);
    if (vaccines.length === 0) return result;

    const animalWhere =
      animalIds === 'ALL_ACTIVE'
        ? { farmId: scope.farmId, deletedAt: null, exitType: null }
        : { farmId: scope.farmId, id: { in: [...animalIds] }, deletedAt: null, exitType: null };

    const [animals, records] = await Promise.all([
      this.prisma.animal.findMany({
        where: animalWhere,
        select: { id: true, sex: true, birthDate: true, entryDate: true },
      }),
      this.prisma.vaccinationRecord.findMany({
        where: {
          farmId: scope.farmId,
          vaccineId: { in: vaccines.map((vaccine) => vaccine.id) },
          animal: animalWhere,
        },
        select: {
          animalId: true,
          vaccineId: true,
          appliedOn: true,
          nextDueOn: true,
          voidedAt: true,
        },
      }),
    ]);

    const recordsByKey = new Map<string, VaccinationRecordLike[]>();
    for (const record of records) {
      const key = `${record.animalId}:${record.vaccineId}`;
      const list = recordsByKey.get(key) ?? [];
      list.push({
        appliedOn: fromPrismaDate(record.appliedOn),
        nextDueOn: fromPrismaDateOrNull(record.nextDueOn),
        voided: record.voidedAt !== null,
      });
      recordsByKey.set(key, list);
    }

    const cyclesByVaccine = new Map(
      vaccines.map((vaccine) => {
        const own = cycles.filter((cycle) => cycle.vaccineIds.has(vaccine.id));
        return [vaccine.id, cyclesAt(own, context.today)] as const;
      }),
    );

    for (const animal of animals) {
      const statuses = vaccines.map((vaccine): VaccineStatusView => {
        const { current, lastClosed } = cyclesByVaccine.get(vaccine.id) ?? {
          current: null,
          lastClosed: null,
        };
        const status = vaccineStatus({
          vaccine,
          animal: {
            sex: animal.sex,
            birthDate: fromPrismaDate(animal.birthDate),
            entryDate: fromPrismaDate(animal.entryDate),
          },
          records: recordsByKey.get(`${animal.id}:${vaccine.id}`) ?? [],
          currentCycle: current,
          lastClosedCycle: lastClosed,
          alertDays: context.settings.vaccineAlertDays,
          today: context.today,
        });
        return {
          vaccineId: vaccine.id,
          name: vaccine.name,
          status: status.kind,
          reason: status.reason,
          dueOn: status.dueOn,
          lastAppliedOn: status.lastAppliedOn,
        };
      });
      result.set(animal.id, statuses);
    }
    return result;
  }

  /** Vacunas activas que generan alertas, en orden alfabético. */
  private async vaccines(scope: FarmScope): Promise<CatalogVaccine[]> {
    const rows = await this.prisma.vaccine.findMany({
      where: {
        farmId: scope.farmId,
        isActive: true,
        scheduleType: { not: VACCINE_SCHEDULE_TYPE.NONE },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scheduleType: row.scheduleType,
      boosterIntervalDays: row.boosterIntervalDays,
      eligibleSex: row.eligibleSex,
      minAgeDays: row.minAgeDays,
      maxAgeDays: row.maxAgeDays,
      blockIneligibleSex: row.blockIneligibleSex,
    }));
  }

  /** Ciclos oficiales activos con las vacunas que incluyen (SAN-06). */
  private async cycles(
    scope: FarmScope,
  ): Promise<(VaccinationCycleLike & { readonly vaccineIds: ReadonlySet<string> })[]> {
    const rows = await this.prisma.vaccinationCycle.findMany({
      where: { farmId: scope.farmId, isActive: true, isOfficial: true },
      include: { vaccines: { select: { vaccineId: true } } },
    });
    return rows.map((row) => ({
      name: row.name,
      startsOn: fromPrismaDate(row.startsOn),
      endsOn: fromPrismaDate(row.endsOn),
      vaccineIds: new Set(row.vaccines.map((link) => link.vaccineId)),
    }));
  }
}

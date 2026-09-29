import { Injectable } from '@nestjs/common';
import {
  BIRTH_CONDITION,
  ORIGIN,
  PREGNANCY_OUTCOME,
  SEX,
  isoDateFromParts,
  isoDateParts,
  type BirthsReport,
  type BirthsReportQuery,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';

/**
 * Reporte de nacimientos por período (NAC-01): totales por sexo, vivos, débiles y muertos al
 * nacer (CA1) y el listado de crías con madre, padre, raza, peso al nacer y estado (CA2).
 *
 * Cuenta los animales **nacidos en la finca** en el período aunque después hayan salido: el
 * filtro es la fecha de nacimiento, no el estado actual. Los archivados (registros duplicados)
 * no cuentan. Las muertas al nacer no son animales: salen de `pregnancies.stillborn_count` de los
 * partos del período.
 */
@Injectable()
export class BirthsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async report(scope: FarmScope, query: BirthsReportQuery): Promise<BirthsReport> {
    const today = this.clock.today();
    const from = query.from ?? isoDateFromParts(isoDateParts(today).year, 1, 1);
    const to = query.to ?? today;
    const range = { gte: toPrismaDate(from), lte: toPrismaDate(to) };
    const ref = { select: { id: true, code: true, name: true } } as const;

    const [calves, stillbirths] = await Promise.all([
      this.prisma.animal.findMany({
        where: {
          farmId: scope.farmId,
          deletedAt: null,
          origin: ORIGIN.BORN_ON_FARM,
          birthDate: range,
        },
        select: {
          id: true,
          code: true,
          name: true,
          sex: true,
          birthDate: true,
          birthCondition: true,
          sireExternalRef: true,
          dam: ref,
          sire: ref,
          breed: { select: { name: true } },
          weights: {
            where: { isBirthWeight: true, voidedAt: null },
            select: { weightKg: true },
            take: 1,
          },
        },
        orderBy: [{ birthDate: 'desc' }, { code: 'asc' }],
      }),
      this.prisma.pregnancy.findMany({
        where: {
          farmId: scope.farmId,
          voidedAt: null,
          outcome: PREGNANCY_OUTCOME.CALVED,
          stillbornCount: { gt: 0 },
          outcomeDate: range,
        },
        select: { id: true, outcomeDate: true, stillbornCount: true, dam: ref },
        orderBy: { outcomeDate: 'desc' },
      }),
    ]);

    return {
      from,
      to,
      totals: {
        live: calves.length,
        males: calves.filter((calf) => calf.sex === SEX.MALE).length,
        females: calves.filter((calf) => calf.sex === SEX.FEMALE).length,
        weak: calves.filter((calf) => calf.birthCondition === BIRTH_CONDITION.WEAK).length,
        stillborn: stillbirths.reduce((sum, row) => sum + row.stillbornCount, 0),
      },
      items: calves.map((calf) => ({
        calf: { id: calf.id, code: calf.code, name: calf.name, sex: calf.sex },
        birthDate: fromPrismaDate(calf.birthDate),
        dam: calf.dam,
        sire: calf.sire,
        sireExternalRef: calf.sireExternalRef,
        breed: calf.breed.name,
        birthWeightKg: calf.weights[0] === undefined ? null : Number(calf.weights[0].weightKg),
        birthCondition: calf.birthCondition,
      })),
      stillbirths: stillbirths.map((row) => ({
        pregnancyId: row.id,
        date: fromPrismaDate(row.outcomeDate as Date),
        dam: row.dam,
        count: row.stillbornCount,
      })),
    };
  }
}

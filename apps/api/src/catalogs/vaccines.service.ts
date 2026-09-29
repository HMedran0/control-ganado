import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  formatDate,
  uuidv7,
  vaccineRuleErrors,
  warning,
  type CatalogList,
  type CreateVaccineInput,
  type DeactivationWarnings,
  type UpdateVaccineInput,
  type VaccineRules,
  type VaccineView,
  type Warning,
  type WithWarnings,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { scopedWhere } from '../common/scoped-prisma.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  assertVersion,
  audit,
  catalogReplay,
  catalogWrite,
  changesBetween,
  type Tx,
} from './catalog-support.js';

const FIELDS = [
  'name',
  'disease',
  'defaultDose',
  'route',
  'scheduleType',
  'boosterIntervalDays',
  'eligibleSex',
  'minAgeDays',
  'maxAgeDays',
  'blockIneligibleSex',
  'isActive',
] as const;

/** Catálogo de vacunas (SAN-01, 08 §1.5). ADMIN y VET escriben. */
@Injectable()
export class VaccinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(scope: FarmScope, includeInactive: boolean): Promise<CatalogList<VaccineView>> {
    const rows = await this.prisma.vaccine.findMany({
      where: scopedWhere(scope, includeInactive ? {} : { isActive: true }),
      orderBy: { name: 'asc' },
    });
    return { items: rows.map(toView), nextCursor: null };
  }

  async create(scope: FarmScope, input: CreateVaccineInput): Promise<VaccineView> {
    const fields = {
      name: input.name,
      disease: input.disease,
      defaultDose: input.defaultDose ?? null,
      route: input.route ?? null,
      scheduleType: input.scheduleType,
      boosterIntervalDays: input.boosterIntervalDays ?? null,
      eligibleSex: input.eligibleSex ?? null,
      minAgeDays: input.minAgeDays ?? null,
      maxAgeDays: input.maxAgeDays ?? null,
      blockIneligibleSex: input.blockIneligibleSex ?? false,
    };
    if (input.id !== undefined) {
      const replay = catalogReplay(
        await this.prisma.vaccine.findUnique({ where: { id: input.id } }),
        scope.farmId,
        fields,
        toView,
      );
      if (replay !== null) return replay;
    }
    return catalogWrite('Vaccine', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const vaccine = await tx.vaccine.create({
          data: { id: input.id ?? uuidv7(), farmId: scope.farmId, ...fields },
        });
        await audit(tx, {
          scope,
          entity: 'Vaccine',
          entityId: vaccine.id,
          action: AUDIT_ACTION.CREATE,
          at: this.clock.now(),
          diff: { after: toView(vaccine) },
        });
        return toView(vaccine);
      }),
    );
  }

  /**
   * Edita o desactiva una vacuna. La coherencia del tipo de programación se revisa sobre la
   * vacuna completa (lo guardado + lo que cambia), no sobre los campos sueltos del `PATCH`.
   * Desactivar una vacuna de un ciclo en curso o futuro se advierte, no se bloquea.
   */
  async update(
    scope: FarmScope,
    id: string,
    input: UpdateVaccineInput,
  ): Promise<WithWarnings<VaccineView>> {
    return catalogWrite('Vaccine', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const current = assertVersion(
          await tx.vaccine.findFirst({ where: scopedWhere(scope, { id }) }),
          input.version,
        );
        const next = { ...toView(current), ...definedOnly(input) } as VaccineView;
        const errors = vaccineRuleErrors(next satisfies VaccineRules);
        if (Object.keys(errors).length > 0) {
          throw new DomainError('VALIDATION_FAILED', {
            fieldErrors: Object.fromEntries(
              Object.entries(errors).map(([field, message]) => [field, [message]]),
            ),
          });
        }

        const updated = await tx.vaccine.update({
          where: { id, version: input.version },
          data: {
            name: next.name,
            disease: next.disease,
            defaultDose: next.defaultDose,
            route: next.route,
            scheduleType: next.scheduleType,
            boosterIntervalDays: next.boosterIntervalDays,
            eligibleSex: next.eligibleSex,
            minAgeDays: next.minAgeDays,
            maxAgeDays: next.maxAgeDays,
            blockIneligibleSex: next.blockIneligibleSex,
            isActive: next.isActive,
            version: { increment: 1 },
          },
        });
        await audit(tx, {
          scope,
          entity: 'Vaccine',
          entityId: id,
          action: AUDIT_ACTION.UPDATE,
          at: this.clock.now(),
          diff: changesBetween(toView(current), toView(updated), FIELDS),
        });
        const warnings =
          current.isActive && input.isActive === false ? await this.warningsFor(tx, scope, id) : [];
        return { ...toView(updated), warnings };
      }),
    );
  }

  /** Lo que advertiría desactivar la vacuna, para mostrarlo antes de confirmar. */
  async deactivationWarnings(scope: FarmScope, id: string): Promise<DeactivationWarnings> {
    const vaccine = await this.prisma.vaccine.findFirst({
      where: scopedWhere(scope, { id }),
      select: { id: true },
    });
    if (vaccine === null) throw new DomainError('NOT_FOUND');
    return { warnings: await this.warningsFor(this.prisma, scope, id) };
  }

  /** Ciclos activos, en curso o por empezar, que incluyen la vacuna. */
  private async warningsFor(tx: Tx, scope: FarmScope, vaccineId: string): Promise<Warning[]> {
    const cycles = await tx.vaccinationCycle.findMany({
      where: scopedWhere(scope, {
        isActive: true,
        endsOn: { gte: toPrismaDate(this.clock.today()) },
        vaccines: { some: { vaccineId } },
      }),
      orderBy: { startsOn: 'asc' },
    });
    return cycles.map((cycle) =>
      warning('VACCINE_IN_ACTIVE_CYCLE', {
        name: cycle.name,
        from: formatDate(fromPrismaDate(cycle.startsOn)),
        to: formatDate(fromPrismaDate(cycle.endsOn)),
      }),
    );
  }
}

/** Solo los campos que vinieron en el `PATCH` (sin `version`). */
function definedOnly(input: UpdateVaccineInput): Partial<VaccineView> {
  const { version: _version, ...fields } = input;
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** La fila de Prisma trae más columnas (`farmId`); la vista solo expone estas. */
function toView(vaccine: VaccineView): VaccineView {
  return {
    id: vaccine.id,
    name: vaccine.name,
    disease: vaccine.disease,
    defaultDose: vaccine.defaultDose,
    route: vaccine.route,
    scheduleType: vaccine.scheduleType,
    boosterIntervalDays: vaccine.boosterIntervalDays,
    eligibleSex: vaccine.eligibleSex,
    minAgeDays: vaccine.minAgeDays,
    maxAgeDays: vaccine.maxAgeDays,
    blockIneligibleSex: vaccine.blockIneligibleSex,
    isActive: vaccine.isActive,
    version: vaccine.version,
  };
}

import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  farmSettingsFor,
  parseFarmSettings,
  type FarmSettings,
  type FarmView,
  type UpdateFarmInput,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { assertVersion, audit, catalogWrite, changesBetween } from './catalog-support.js';

type FarmRow = {
  id: string;
  name: string;
  municipality: string | null;
  department: string | null;
  icaPremiseCode: string | null;
  settings: unknown;
  version: number;
};

/** Datos y parámetros de la finca (CFG-01). */
@Injectable()
export class FarmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** La finca del token, con los parámetros que el rol puede ver (RN-20). */
  async get(scope: FarmScope): Promise<FarmView> {
    const farm = await this.prisma.farm.findUnique({ where: { id: scope.farmId } });
    if (farm === null) throw new DomainError('NOT_FOUND');
    return toView(farm, scope);
  }

  /**
   * Edita datos y parámetros. Los `settings` llegan parciales y se mezclan con los guardados;
   * el resultado se valida completo. Cambiar el destete o la gestación de la finca cambia de
   * inmediato las categorías calculadas (CFG-01 CA1): no hay nada almacenado que recalcular.
   */
  async update(scope: FarmScope, input: UpdateFarmInput): Promise<FarmView> {
    return catalogWrite('Farm', undefined, () => this.transactUpdate(scope, input));
  }

  private transactUpdate(scope: FarmScope, input: UpdateFarmInput): Promise<FarmView> {
    return this.prisma.$transaction(async (tx) => {
      const current = assertVersion(
        await tx.farm.findUnique({ where: { id: scope.farmId } }),
        input.version,
      );
      const before = parseFarmSettings(current.settings);
      const settings: FarmSettings = parseFarmSettings({ ...before, ...input.settings });

      const updated = await tx.farm.update({
        where: { id: scope.farmId, version: input.version },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.municipality === undefined ? {} : { municipality: input.municipality }),
          ...(input.department === undefined ? {} : { department: input.department }),
          ...(input.icaPremiseCode === undefined ? {} : { icaPremiseCode: input.icaPremiseCode }),
          settings,
          version: { increment: 1 },
        },
      });

      await audit(tx, {
        scope,
        entity: 'Farm',
        entityId: scope.farmId,
        action: AUDIT_ACTION.UPDATE,
        at: this.clock.now(),
        diff: changesBetween<Record<string, unknown>>(
          { ...flatten(current), ...before },
          { ...flatten(updated), ...settings },
          [
            'name',
            'municipality',
            'department',
            'icaPremiseCode',
            ...(Object.keys(settings) as (keyof FarmSettings)[]),
          ],
        ),
      });

      return toView(updated, scope);
    });
  }
}

function flatten(farm: FarmRow): Record<string, unknown> {
  return {
    name: farm.name,
    municipality: farm.municipality,
    department: farm.department,
    icaPremiseCode: farm.icaPremiseCode,
  };
}

function toView(farm: FarmRow, scope: FarmScope): FarmView {
  return {
    id: farm.id,
    name: farm.name,
    municipality: farm.municipality,
    department: farm.department,
    icaPremiseCode: farm.icaPremiseCode,
    settings: farmSettingsFor(scope.role, parseFarmSettings(farm.settings)),
    version: farm.version,
  };
}

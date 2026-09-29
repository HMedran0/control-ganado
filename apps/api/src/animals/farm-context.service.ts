import { Injectable } from '@nestjs/common';
import { DomainError, parseFarmSettings, type FarmSettings, type IsoDate } from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { ClassificationParams } from './classification.sql.js';

/** «Hoy» y los parámetros de la finca con los que se clasifica y se alerta. */
export type FarmContext = {
  readonly today: IsoDate;
  readonly settings: FarmSettings;
};

/**
 * Lee los parámetros de la finca (`farms.settings`, CFG-01) en cada petición. Nada de destete,
 * ventanas de alerta ni patrón de código queda fijo en el código ni en el SQL.
 */
@Injectable()
export class FarmContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async load(scope: FarmScope): Promise<FarmContext> {
    const farm = await this.prisma.farm.findUnique({
      where: { id: scope.farmId },
      select: { settings: true },
    });
    if (farm === null) throw new DomainError('NOT_FOUND');
    return { today: this.clock.today(), settings: parseFarmSettings(farm.settings) };
  }
}

/** Parámetros de `classificationCtes` a partir del contexto. */
export function classificationParams(scope: FarmScope, context: FarmContext): ClassificationParams {
  return {
    farmId: scope.farmId,
    today: context.today,
    weaningAgeMonths: context.settings.weaningAgeMonths,
    calvingAlertDays: context.settings.calvingAlertDays,
    unconfirmedServiceAlertDays: context.settings.unconfirmedServiceAlertDays,
    overdueCalvingAlertDays: context.settings.overdueCalvingAlertDays,
  };
}

import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  farmSettingsFor,
  parseFarmSettings,
  type FarmSettings,
  type FarmView,
  type UpdateFarmInput,
  type WithWarnings,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  recalculateOpenPregnancies,
  recalculationWarnings,
} from '../reproduction/gestation-recalc.js';
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
  /**
   * Si cambia la gestación de la finca, se recalcula el parto estimado de las preñeces abiertas de
   * las hembras cuya raza no tiene gestación propia (RN-04, M5), y la respuesta lo avisa.
   */
  async update(scope: FarmScope, input: UpdateFarmInput): Promise<WithWarnings<FarmView>> {
    return catalogWrite('Farm', undefined, () => this.transactUpdate(scope, input));
  }

  private transactUpdate(
    scope: FarmScope,
    input: UpdateFarmInput,
  ): Promise<WithWarnings<FarmView>> {
    return this.prisma.$transaction(async (tx) => {
      const current = assertVersion(
        await tx.farm.findUnique({ where: { id: scope.farmId } }),
        input.version,
      );
      const before = parseFarmSettings(current.settings);
      const settings: FarmSettings = parseFarmSettings({ ...before, ...input.settings });
      if (before.codeReuse && !settings.codeReuse) await assertNoRepeatedCodes(tx, scope);

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

      if (settings.gestationDays === before.gestationDays) {
        return { ...toView(updated, scope), warnings: [] };
      }
      const result = await recalculateOpenPregnancies(tx, scope, {
        target: { kind: 'FARM_DEFAULT' },
        farmGestationDays: settings.gestationDays,
        at: this.clock.now(),
      });
      return { ...toView(updated, scope), warnings: recalculationWarnings(result) };
    });
  }
}

/** Números repetidos que se muestran como máximo en el mensaje. */
const MAX_CONFLICTS_SHOWN = 10;

/**
 * ANI-10 CA3: dejar de reutilizar números exige que ningún código normalizado (RN-30) se repita
 * entre los animales no archivados, que es la unicidad de las fincas sin reutilización. Si se
 * repite, `CODE_REUSE_CONFLICT` con los códigos en el mensaje y los animales en `context`.
 */
async function assertNoRepeatedCodes(tx: Tx, scope: FarmScope): Promise<void> {
  const repeated = await tx.$queryRaw<{ codes: string; ids: string }[]>`
    SELECT string_agg(a.code, ' y ' ORDER BY a.exit_type IS NULL DESC, a.code) AS codes,
           string_agg(a.id::text, ',' ORDER BY a.exit_type IS NULL DESC, a.code) AS ids
      FROM animals a
     WHERE a.farm_id = ${scope.farmId}::uuid AND a.deleted_at IS NULL
     GROUP BY hato_normalize_code(a.code)
    HAVING count(*) > 1
     ORDER BY hato_normalize_code(a.code)
     LIMIT ${MAX_CONFLICTS_SHOWN}::int`;
  if (repeated.length === 0) return;
  throw new DomainError('CODE_REUSE_CONFLICT', {
    params: { codes: repeated.map((row) => row.codes).join('; ') },
    context: { animalIds: repeated.map((row) => row.ids).join(',') },
  });
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

import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  lotHasActiveAnimalsWarning,
  uuidv7,
  type CatalogList,
  type CreateLotInput,
  type DeactivationWarnings,
  type LotView,
  type UpdateLotInput,
  type Warning,
  type WithWarnings,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { scopedWhere } from '../common/scoped-prisma.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  assertVersion,
  audit,
  catalogReplay,
  catalogWrite,
  changesBetween,
  type Tx,
} from './catalog-support.js';

const FIELDS = ['name', 'description', 'isActive'] as const;

/** Lotes (CFG-02, 08 §1.10). */
@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(scope: FarmScope, includeInactive: boolean): Promise<CatalogList<LotView>> {
    const rows = await this.prisma.lot.findMany({
      where: scopedWhere(scope, includeInactive ? {} : { isActive: true }),
      orderBy: { name: 'asc' },
    });
    return { items: rows.map(toView), nextCursor: null };
  }

  async create(scope: FarmScope, input: CreateLotInput): Promise<LotView> {
    if (input.id !== undefined) {
      const replay = catalogReplay(
        await this.prisma.lot.findUnique({ where: { id: input.id } }),
        scope.farmId,
        { name: input.name, description: input.description ?? null },
        toView,
      );
      if (replay !== null) return replay;
    }
    return catalogWrite('Lot', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const lot = await tx.lot.create({
          data: {
            id: input.id ?? uuidv7(),
            farmId: scope.farmId,
            name: input.name,
            description: input.description ?? null,
          },
        });
        await audit(tx, {
          scope,
          entity: 'Lot',
          entityId: lot.id,
          action: AUDIT_ACTION.CREATE,
          at: this.clock.now(),
          diff: { after: toView(lot) },
        });
        return toView(lot);
      }),
    );
  }

  /**
   * Edita o desactiva un lote. Desactivar un lote con animales activos no se bloquea: los
   * animales siguen en él y la respuesta lo advierte («12 animales siguen en este lote»).
   */
  async update(
    scope: FarmScope,
    id: string,
    input: UpdateLotInput,
  ): Promise<WithWarnings<LotView>> {
    return catalogWrite('Lot', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const current = assertVersion(
          await tx.lot.findFirst({ where: scopedWhere(scope, { id }) }),
          input.version,
        );
        const updated = await tx.lot.update({
          where: { id, version: input.version },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            version: { increment: 1 },
          },
        });
        await audit(tx, {
          scope,
          entity: 'Lot',
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

  /** Lo que advertiría desactivar el lote, para mostrarlo antes de confirmar. */
  async deactivationWarnings(scope: FarmScope, id: string): Promise<DeactivationWarnings> {
    const lot = await this.prisma.lot.findFirst({
      where: scopedWhere(scope, { id }),
      select: { id: true },
    });
    if (lot === null) throw new DomainError('NOT_FOUND');
    return { warnings: await this.warningsFor(this.prisma, scope, id) };
  }

  private async warningsFor(tx: Tx, scope: FarmScope, lotId: string): Promise<Warning[]> {
    // Activos: ni archivados ni con salida registrada (RN-11).
    const count = await tx.animal.count({
      where: scopedWhere(scope, { lotId, deletedAt: null, exitType: null }),
    });
    return count === 0 ? [] : [lotHasActiveAnimalsWarning(count)];
  }
}

function toView(lot: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
}): LotView {
  return {
    id: lot.id,
    name: lot.name,
    description: lot.description,
    isActive: lot.isActive,
    version: lot.version,
  };
}

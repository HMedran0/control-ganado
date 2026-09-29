import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  parseFarmSettings,
  proposedGestationDays,
  uuidv7,
  type BreedView,
  type CatalogList,
  type CreateBreedInput,
  type UpdateBreedInput,
  type WithWarnings,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { scopedWhere } from '../common/scoped-prisma.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  recalculateOpenPregnancies,
  recalculationWarnings,
} from '../reproduction/gestation-recalc.js';
import {
  assertVersion,
  audit,
  catalogReplay,
  catalogWrite,
  changesBetween,
} from './catalog-support.js';

const FIELDS = ['name', 'group', 'gestationDays', 'isActive'] as const;

/** Razas (CFG-02, 08 §1.4). */
@Injectable()
export class BreedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(scope: FarmScope, includeInactive: boolean): Promise<CatalogList<BreedView>> {
    const rows = await this.prisma.breed.findMany({
      where: scopedWhere(scope, includeInactive ? {} : { isActive: true }),
      orderBy: { name: 'asc' },
    });
    return { items: rows.map(toView), nextCursor: null };
  }

  /** Crea una raza. Sin gestación, se propone la del grupo (293, 283 o 288 días). */
  async create(scope: FarmScope, input: CreateBreedInput): Promise<BreedView> {
    const gestationDays = input.gestationDays ?? proposedGestationDays(input.group);
    if (input.id !== undefined) {
      const replay = catalogReplay(
        await this.prisma.breed.findUnique({ where: { id: input.id } }),
        scope.farmId,
        { name: input.name, group: input.group, gestationDays },
        toView,
      );
      if (replay !== null) return replay;
    }
    return catalogWrite('Breed', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const breed = await tx.breed.create({
          data: {
            id: input.id ?? uuidv7(),
            farmId: scope.farmId,
            name: input.name,
            group: input.group,
            gestationDays,
          },
        });
        await audit(tx, {
          scope,
          entity: 'Breed',
          entityId: breed.id,
          action: AUDIT_ACTION.CREATE,
          at: this.clock.now(),
          diff: { after: toView(breed) },
        });
        return toView(breed);
      }),
    );
  }

  /**
   * Edita una raza. Si cambia su gestación, se recalcula el parto estimado de las preñeces
   * abiertas de sus hembras, salvo las corregidas a mano (RN-04, M5), y la respuesta lo avisa.
   */
  async update(
    scope: FarmScope,
    id: string,
    input: UpdateBreedInput,
  ): Promise<WithWarnings<BreedView>> {
    return catalogWrite('Breed', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const current = assertVersion(
          await tx.breed.findFirst({ where: scopedWhere(scope, { id }) }),
          input.version,
        );
        const updated = await tx.breed.update({
          where: { id, version: input.version },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.group === undefined ? {} : { group: input.group }),
            ...(input.gestationDays === undefined ? {} : { gestationDays: input.gestationDays }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            version: { increment: 1 },
          },
        });
        await audit(tx, {
          scope,
          entity: 'Breed',
          entityId: id,
          action: AUDIT_ACTION.UPDATE,
          at: this.clock.now(),
          diff: changesBetween(toView(current), toView(updated), FIELDS),
        });
        if (updated.gestationDays === current.gestationDays) {
          return { ...toView(updated), warnings: [] };
        }
        const farm = await tx.farm.findUniqueOrThrow({
          where: { id: scope.farmId },
          select: { settings: true },
        });
        const result = await recalculateOpenPregnancies(tx, scope, {
          target: { kind: 'BREED', breedId: id },
          farmGestationDays: parseFarmSettings(farm.settings).gestationDays,
          at: this.clock.now(),
        });
        return { ...toView(updated), warnings: recalculationWarnings(result) };
      }),
    );
  }
}

function toView(breed: {
  id: string;
  name: string;
  group: BreedView['group'];
  gestationDays: number | null;
  isActive: boolean;
  version: number;
}): BreedView {
  return {
    id: breed.id,
    name: breed.name,
    group: breed.group,
    gestationDays: breed.gestationDays,
    isActive: breed.isActive,
    version: breed.version,
  };
}

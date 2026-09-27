import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  catalogNameKey,
  DERIVED_TAG,
  DomainError,
  tagKeyFromLabel,
  uuidv7,
  type CatalogList,
  type CreateTagInput,
  type TagView,
  type UpdateTagInput,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { scopedWhere } from '../common/scoped-prisma.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { assertVersion, audit, catalogWrite, changesBetween, type Tx } from './catalog-support.js';

const FIELDS = ['label', 'description', 'isActive'] as const;

/** Etiquetas manuales (CLS-02, 08 §1.1). La etiqueta de sistema es COTERO. */
@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(scope: FarmScope, includeInactive: boolean): Promise<CatalogList<TagView>> {
    const rows = await this.prisma.tag.findMany({
      where: scopedWhere(scope, includeInactive ? {} : { isActive: true }),
      orderBy: { label: 'asc' },
    });
    return { items: rows.map(toView), nextCursor: null };
  }

  /**
   * Crea una etiqueta. Su `key` se genera del nombre y **no cambia** si luego se renombra:
   * es la referencia estable (filtros, exportaciones), el nombre es solo lo que se ve.
   */
  async create(scope: FarmScope, input: CreateTagInput): Promise<TagView> {
    return catalogWrite('Tag', input.label, () =>
      this.prisma.$transaction(async (tx) => {
        const tag = await tx.tag.create({
          data: {
            id: uuidv7(),
            farmId: scope.farmId,
            key: await freeKey(tx, scope, tagKeyFromLabel(input.label)),
            label: input.label,
            description: input.description ?? null,
          },
        });
        await audit(tx, {
          scope,
          entity: 'Tag',
          entityId: tag.id,
          action: AUDIT_ACTION.CREATE,
          at: this.clock.now(),
          diff: { after: toView(tag) },
        });
        return toView(tag);
      }),
    );
  }

  /**
   * Edita una etiqueta. La de sistema (COTERO) no se desactiva ni se renombra: solo se edita
   * su descripción, que la finca puede ajustar (08 §1.1).
   *
   * @throws {DomainError} `SYSTEM_TAG_PROTECTED`.
   */
  async update(scope: FarmScope, id: string, input: UpdateTagInput): Promise<TagView> {
    return catalogWrite('Tag', input.label, () =>
      this.prisma.$transaction(async (tx) => {
        const current = assertVersion(
          await tx.tag.findFirst({ where: scopedWhere(scope, { id }) }),
          input.version,
        );
        const renames =
          input.label !== undefined &&
          catalogNameKey(input.label) !== catalogNameKey(current.label);
        if (current.isSystem && (renames || input.isActive === false)) {
          throw new DomainError('SYSTEM_TAG_PROTECTED', { params: { label: current.label } });
        }

        const updated = await tx.tag.update({
          where: { id, version: input.version },
          data: {
            // En la de sistema, un cambio solo de mayúsculas o espacios tampoco se aplica.
            ...(input.label === undefined || current.isSystem ? {} : { label: input.label }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            version: { increment: 1 },
          },
        });
        await audit(tx, {
          scope,
          entity: 'Tag',
          entityId: id,
          action: AUDIT_ACTION.UPDATE,
          at: this.clock.now(),
          diff: changesBetween(toView(current), toView(updated), FIELDS),
        });
        return toView(updated);
      }),
    );
  }
}

/**
 * Primera clave libre: `DESCARTE`, y si ya existe, `DESCARTE_2`, `DESCARTE_3`… Las claves de
 * las etiquetas derivadas (`SERVED`, `PREGNANT`…) cuentan como ocupadas: el filtro `tags` de
 * `GET /animals` recibe las dos clases de etiqueta en la misma lista y no debe haber ambigüedad.
 */
async function freeKey(tx: Tx, scope: FarmScope, base: string): Promise<string> {
  const taken = new Set<string>([
    ...Object.values(DERIVED_TAG),
    ...(
      await tx.tag.findMany({
        where: scopedWhere(scope, { key: { startsWith: base } }),
        select: { key: true },
      })
    ).map((tag) => tag.key),
  ]);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function toView(tag: {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  version: number;
}): TagView {
  return {
    id: tag.id,
    key: tag.key,
    label: tag.label,
    description: tag.description,
    isSystem: tag.isSystem,
    isActive: tag.isActive,
    version: tag.version,
  };
}

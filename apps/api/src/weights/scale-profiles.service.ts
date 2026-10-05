import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  SCALE_TEMPLATES,
  isUuid,
  scaleTemplate,
  uuidv7,
  type CreateScaleProfileInput,
  type DuplicateScaleTemplateInput,
  type ScaleColumnMapping,
  type ScaleProfileList,
  type ScaleProfileView,
  type ScaleTemplate,
  type UpdateScaleProfileInput,
} from '@hato/shared';

import { userOf } from '../animals/animal-rules.js';
import {
  assertVersion,
  audit,
  catalogReplay,
  catalogWrite,
  changesBetween,
} from '../catalogs/catalog-support.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';

type ProfileRow = Prisma.ScaleProfileGetPayload<object>;

function templateView(template: ScaleTemplate): ScaleProfileView {
  return {
    id: template.key,
    name: template.name,
    system: true,
    templateKey: template.key,
    version: template.version,
    provisional: template.provisional,
    fileFormat: template.fileFormat,
    unit: template.columnMapping.unit,
    columnMapping: template.columnMapping,
    sourceTemplateKey: null,
    sourceTemplateVersion: null,
  };
}

export function profileView(row: ProfileRow): ScaleProfileView {
  const columnMapping = row.columnMapping as unknown as ScaleColumnMapping;
  return {
    id: row.id,
    name: row.name,
    system: false,
    templateKey: null,
    version: row.version,
    provisional: false,
    fileFormat: row.fileFormat,
    unit: columnMapping.unit,
    columnMapping,
    sourceTemplateKey: row.sourceTemplateKey,
    sourceTemplateVersion: row.sourceTemplateVersion,
  };
}

/** Nombre normalizado como los catálogos: sin espacios sobrantes. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Perfiles de báscula (PES-04 CA1, 03 §2.5): las plantillas del sistema (en `packages/shared`,
 * iguales para todas las fincas, no editables) y los perfiles de la finca (solo ADMIN escribe).
 */
@Injectable()
export class ScaleProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(scope: FarmScope): Promise<ScaleProfileList> {
    const rows = await this.prisma.scaleProfile.findMany({
      where: { farmId: scope.farmId },
      orderBy: { name: 'asc' },
    });
    return {
      items: [...SCALE_TEMPLATES.map(templateView), ...rows.map(profileView)],
      nextCursor: null,
    };
  }

  /**
   * Perfil por id o plantilla por clave, para la importación. `null` si no existe en la finca (un
   * perfil de otra finca no existe para quien pregunta).
   */
  async resolve(scope: FarmScope, idOrKey: string): Promise<ScaleProfileView | null> {
    const template = scaleTemplate(idOrKey);
    if (template !== null) return templateView(template);
    if (!isUuid(idOrKey)) return null;
    const row = await this.prisma.scaleProfile.findFirst({
      where: { id: idOrKey, farmId: scope.farmId },
    });
    return row === null ? null : profileView(row);
  }

  async create(scope: FarmScope, input: CreateScaleProfileInput): Promise<ScaleProfileView> {
    const name = cleanName(input.name);
    if (input.id !== undefined) {
      const replay = catalogReplay(
        await this.prisma.scaleProfile.findUnique({ where: { id: input.id } }),
        scope.farmId,
        { name, fileFormat: input.fileFormat, columnMapping: input.columnMapping },
        profileView,
      );
      if (replay !== null) return replay;
    }
    return this.write(scope, {
      id: input.id ?? uuidv7(),
      name,
      fileFormat: input.fileFormat,
      columnMapping: input.columnMapping,
      source: null,
    });
  }

  /** Duplica una plantilla del sistema como perfil propio, editable (03 §2.5). */
  async duplicate(
    scope: FarmScope,
    templateKey: string,
    input: DuplicateScaleTemplateInput,
  ): Promise<ScaleProfileView> {
    const template = scaleTemplate(templateKey);
    if (template === null) throw new DomainError('NOT_FOUND');
    const name = cleanName(input.name ?? `${template.name} (copia)`);
    if (input.id !== undefined) {
      const replay = catalogReplay(
        await this.prisma.scaleProfile.findUnique({ where: { id: input.id } }),
        scope.farmId,
        { name, sourceTemplateKey: template.key },
        profileView,
      );
      if (replay !== null) return replay;
    }
    return this.write(scope, {
      id: input.id ?? uuidv7(),
      name,
      fileFormat: template.fileFormat,
      columnMapping: template.columnMapping,
      source: template,
    });
  }

  private async write(
    scope: FarmScope,
    data: {
      id: string;
      name: string;
      fileFormat: ScaleProfileView['fileFormat'];
      columnMapping: ScaleColumnMapping;
      source: ScaleTemplate | null;
    },
  ): Promise<ScaleProfileView> {
    const at = this.clock.now();
    const userId = userOf(scope);
    return catalogWrite('ScaleProfile', data.name, () =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.scaleProfile.create({
          data: {
            id: data.id,
            farmId: scope.farmId,
            name: data.name,
            fileFormat: data.fileFormat,
            columnMapping: data.columnMapping,
            sourceTemplateKey: data.source?.key ?? null,
            sourceTemplateVersion: data.source?.version ?? null,
            createdById: userId,
            updatedById: userId,
            createdAt: at,
            updatedAt: at,
          },
        });
        await audit(tx, {
          scope,
          entity: 'ScaleProfile',
          entityId: row.id,
          action: AUDIT_ACTION.CREATE,
          at,
          diff: {
            after: {
              name: row.name,
              fileFormat: row.fileFormat,
              sourceTemplateKey: row.sourceTemplateKey,
            },
          },
        });
        return profileView(row);
      }),
    );
  }

  async update(
    scope: FarmScope,
    idOrKey: string,
    input: UpdateScaleProfileInput,
  ): Promise<ScaleProfileView> {
    if (scaleTemplate(idOrKey) !== null) throw new DomainError('SYSTEM_TEMPLATE_READONLY');
    if (!isUuid(idOrKey)) throw new DomainError('NOT_FOUND');
    const name = input.name === undefined ? undefined : cleanName(input.name);
    return catalogWrite('ScaleProfile', name, () =>
      this.prisma.$transaction(async (tx) => {
        const before = assertVersion(
          await tx.scaleProfile.findFirst({ where: { id: idOrKey, farmId: scope.farmId } }),
          input.version,
        );
        const row = await tx.scaleProfile.update({
          where: { id: idOrKey, version: input.version },
          data: {
            ...(name === undefined ? {} : { name }),
            ...(input.fileFormat === undefined ? {} : { fileFormat: input.fileFormat }),
            ...(input.columnMapping === undefined ? {} : { columnMapping: input.columnMapping }),
            version: { increment: 1 },
            updatedById: userOf(scope),
          },
        });
        const auditable = (view: ScaleProfileView) => ({
          name: view.name,
          fileFormat: view.fileFormat,
          columnMapping: JSON.stringify(view.columnMapping),
        });
        await audit(tx, {
          scope,
          entity: 'ScaleProfile',
          entityId: row.id,
          action: AUDIT_ACTION.UPDATE,
          at: this.clock.now(),
          diff: changesBetween(auditable(profileView(before)), auditable(profileView(row)), [
            'name',
            'fileFormat',
            'columnMapping',
          ]),
        });
        return profileView(row);
      }),
    );
  }
}

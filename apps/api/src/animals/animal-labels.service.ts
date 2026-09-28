import { Inject, Injectable } from '@nestjs/common';
import { LABELS_MAX, systemQrUrl, type AnimalLabels, type AnimalLabelsQuery } from '@hato/shared';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AnimalListService } from './animal-list.service.js';

/**
 * Datos de la hoja de etiquetas (IDN-03 CA2): código, nombre, identificadores principales y la
 * URL del QR, que el navegador dibuja e imprime. No hay PDF (eso es M19).
 *
 * Con `ids`, esos animales de la finca en el orden de la selección; sin ellos, lo que muestra el
 * listado con los mismos filtros y el mismo orden. Los archivados no llevan etiqueta.
 */
@Injectable()
export class AnimalLabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listService: AnimalListService,
    @Inject(ENV) private readonly env: Pick<Env, 'PUBLIC_WEB_URL'>,
  ) {}

  async labels(scope: FarmScope, query: AnimalLabelsQuery): Promise<AnimalLabels> {
    const ids =
      query.ids !== undefined && query.ids.length > 0
        ? query.ids
        : (await this.listService.list(scope, query, { unpaginated: true })).items.map(
            (item) => item.id,
          );
    const chosen = ids.slice(0, LABELS_MAX);

    const animals = await this.prisma.animal.findMany({
      where: { farmId: scope.farmId, id: { in: chosen }, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        sex: true,
        identifiers: {
          where: { retiredAt: null, type: { in: ['VISUAL_TAG', 'DIN', 'RFID'] } },
          select: { type: true, value: true },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });
    const byId = new Map(animals.map((animal) => [animal.id, animal]));
    const items = chosen.flatMap((id) => {
      const animal = byId.get(id);
      if (animal === undefined) return [];
      const first = (type: string): string | null =>
        animal.identifiers.find((identifier) => identifier.type === type)?.value ?? null;
      return [
        {
          id: animal.id,
          code: animal.code,
          name: animal.name,
          sex: animal.sex,
          visualTag: first('VISUAL_TAG'),
          din: first('DIN'),
          rfid: first('RFID'),
          qrUrl: systemQrUrl(this.env.PUBLIC_WEB_URL, animal.id),
        },
      ];
    });
    return { items, truncated: ids.length > LABELS_MAX };
  }
}

/**
 * Tercera finca de pruebas: **Finca La Nueva** [Ficticio] (08 §3.7, M4d).
 *
 * Finca recién creada, sin animales, para probar la importación del inventario (ANI-09) con la
 * plantilla de referencia (`docs/referencia/plantilla-importacion.xlsx`): sus códigos (087, 012,
 * 26-031…) chocarían con los de La Esperanza. Tiene el mismo catálogo de razas y lotes que La
 * Esperanza, que es el que usa la plantilla, y un ADMIN propio, `nueva.admin`.
 *
 * No toca ninguna cifra de las otras dos fincas. Es determinista como ellas: semilla propia e
 * identificadores con reloj desplazado.
 */

import {
  defaultGestationDaysForGroup,
  DEFAULT_FARM_SETTINGS,
  ROLE,
  type IsoDate,
} from '@hato/shared';

import { BREEDS, LOTS } from './catalog.js';
import type { SeedClient } from './client.js';
import { createIdFactory, instantOf } from './ids.js';
import { hashSeedPassword } from './password.js';
import { createRandom } from './random.js';
import { resetFarmData } from './write.js';

/** Semilla de La Nueva. */
export const NUEVA_FARM_SEED = 0x4e55_4556; // "NUEV".

/** Tres días después del reloj de referencia: rangos de UUIDv7 distintos a los de las otras. */
const ID_EPOCH_OFFSET_MS = 3 * 86_400_000;

export const NUEVA = {
  name: 'Finca La Nueva',
  admin: {
    username: 'nueva.admin',
    name: 'Administración La Nueva',
    email: 'nueva.admin@demo.co',
  },
} as const;

export type NuevaSeed = {
  readonly farmId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly breeds: readonly {
    readonly id: string;
    readonly name: string;
    readonly group: (typeof BREEDS)[number]['group'];
  }[];
  readonly lots: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }[];
};

export function buildNuevaSeed(): NuevaSeed {
  const ids = createIdFactory(createRandom(NUEVA_FARM_SEED), ID_EPOCH_OFFSET_MS);
  return {
    farmId: ids.next(),
    userId: ids.next(),
    membershipId: ids.next(),
    breeds: BREEDS.map((breed) => ({ id: ids.next(), name: breed.name, group: breed.group })),
    lots: LOTS.map((lot) => ({ id: ids.next(), name: lot.name, description: lot.description })),
  };
}

/** Escribe La Nueva, borrando antes lo que hubiera de ella (también lo importado). */
export async function writeNuevaSeed(
  prisma: SeedClient,
  seed: NuevaSeed,
  password: string,
  today: IsoDate,
): Promise<Record<string, number>> {
  await resetFarmData(prisma, seed.farmId, [NUEVA.admin.username]);
  const createdAt = instantOf(today);
  const passwordHash = await hashSeedPassword(password, createRandom(NUEVA_FARM_SEED));

  await prisma.farm.create({
    data: {
      id: seed.farmId,
      name: NUEVA.name,
      settings: DEFAULT_FARM_SETTINGS,
      createdAt,
      updatedAt: createdAt,
    },
  });
  await prisma.user.create({
    data: {
      id: seed.userId,
      name: NUEVA.admin.name,
      username: NUEVA.admin.username,
      email: NUEVA.admin.email,
      passwordHash,
      createdAt,
      updatedAt: createdAt,
      memberships: {
        create: { id: seed.membershipId, farmId: seed.farmId, role: ROLE.ADMIN },
      },
    },
  });
  await prisma.breed.createMany({
    data: seed.breeds.map((breed) => ({
      id: breed.id,
      farmId: seed.farmId,
      name: breed.name,
      group: breed.group,
      gestationDays: defaultGestationDaysForGroup(breed.group),
    })),
  });
  await prisma.lot.createMany({
    data: seed.lots.map((lot) => ({
      id: lot.id,
      farmId: seed.farmId,
      name: lot.name,
      description: lot.description,
    })),
  });

  return {
    'La Nueva: razas': seed.breeds.length,
    'La Nueva: lotes': seed.lots.length,
  };
}

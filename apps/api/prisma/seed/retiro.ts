/**
 * Segunda finca de pruebas: **Finca El Retiro** [Ficticio] (08 §3.5, M4c).
 *
 * Finca pequeña para probar la numeración reutilizable (ANI-10, ANI-11, IDN-06):
 *
 * - `codeReuse = true` y `codeSuggestion = LOWEST_FREE`, con numeración del 1 al 40;
 * - dos números reutilizados, el 5 y el 12: un animal que salió y otro activo con el mismo
 *   número, cada uno con su propio historial (RN-33);
 * - el 5 anterior se vendió con la chapeta liberada (`EXITED`) y conserva su DIN y su RFID
 *   (RN-32);
 * - un ADMIN propio con correo, `retiro.admin`, para las pruebas de aislamiento por finca;
 * - desde M8a, finca de **levante y ceba** que vende machos (CFG-03), con los casos de ceba de
 *   `retiro-ceba.ts` (peso de venta y lotes con ganancia baja).
 *
 * No toca ninguna cifra de La Esperanza. Es determinista como el seed de referencia: semilla
 * propia, identificadores con reloj desplazado y marcas de tiempo derivadas de las fechas.
 */

import {
  addDays,
  BREED_GROUP,
  DEFAULT_FARM_SETTINGS,
  defaultGestationDaysForGroup,
  EXIT_TYPE,
  IDENTIFIER_RETIRE_REASON,
  IDENTIFIER_TYPE,
  ORIGIN,
  PRODUCTION_SYSTEM,
  ROLE,
  SALES_FOCUS,
  SEX,
  toIsoDate,
  WEIGHT_METHOD,
  type ExitType,
  type IdentifierRetireReason,
  type IdentifierType,
  type IsoDate,
  type Sex,
} from '@hato/shared';

import type { SeedClient } from './client.js';
import { createIdFactory, instantOf } from './ids.js';
import { hashSeedPassword } from './password.js';
import { createRandom } from './random.js';
import { CEBA_ENTRY, buildRetiroCeba, type RetiroCeba } from './retiro-ceba.js';
import { resetFarmData } from './write.js';
import { Prisma } from '../../src/generated/prisma/client.js';

/** Semilla de El Retiro. */
export const RETIRO_FARM_SEED = 0x5245_5449; // "RETI".

/**
 * Desplazamiento del reloj de los identificadores: dos días después del de referencia, para que
 * los UUIDv7 de las tres fincas del seed ocupen rangos distintos.
 */
const ID_EPOCH_OFFSET_MS = 2 * 86_400_000;

export const RETIRO = {
  name: 'Finca El Retiro',
  admin: {
    username: 'retiro.admin',
    name: 'Administración El Retiro',
    email: 'retiro.admin@demo.co',
  },
  breed: { name: 'Brahman', group: BREED_GROUP.INDICUS },
} as const;

type RetiroIdentifier = {
  readonly id: string;
  readonly type: IdentifierType;
  readonly value: string;
  readonly assignedAt: IsoDate;
  readonly retiredAt: IsoDate | null;
  readonly retireReason: IdentifierRetireReason | null;
};

type RetiroAnimal = {
  readonly id: string;
  readonly code: string;
  readonly sex: Sex;
  readonly birthDate: IsoDate;
  readonly exit: { readonly type: ExitType; readonly date: IsoDate } | null;
  readonly identifiers: readonly RetiroIdentifier[];
  readonly weights: readonly { readonly id: string; readonly on: IsoDate; readonly kg: number }[];
  readonly sale: { readonly id: string; readonly amount: string; readonly buyer: string } | null;
};

export type RetiroSeed = {
  readonly farmId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly breedId: string;
  readonly animals: readonly RetiroAnimal[];
  /** Casos de ceba de M8a, con su propio generador. */
  readonly ceba: RetiroCeba;
};

/** Números libres hoy: nadie activo los tiene (el 17 lo tuvo un animal vendido). */
const FREE_NUMBERS = new Set([17, 33]);

/** Animales que salieron: el número que tenían, cómo y cuándo. */
const EXITED = [
  // Vendido con chapeta liberada, DIN y RFID que siguen con él (08 §3.5). Su número lo tiene
  // hoy una ternera nacida después (ANI-11 CA2: «Este número lo tuvo antes 5 · vendido…»).
  { code: '5', type: EXIT_TYPE.SALE, date: '2026-03-12', birth: '2021-02-10', sex: SEX.FEMALE },
  // Murió; su número lo tiene hoy otro animal.
  { code: '12', type: EXIT_TYPE.DEATH, date: '2025-11-20', birth: '2020-08-03', sex: SEX.MALE },
  // Vendido y su número sigue libre: por eso el menor número libre es el 17.
  { code: '17', type: EXIT_TYPE.SALE, date: '2026-08-01', birth: '2022-06-15', sex: SEX.MALE },
] as const;

/** Nacimiento de los activos que heredaron un número: después de la salida del anterior. */
const REUSED_BIRTHS: Readonly<Record<string, IsoDate>> = {
  '5': toIsoDate('2026-04-02'),
  '12': toIsoDate('2026-01-10'),
};

/** Construye la finca en memoria. No toca la base de datos. */
export function buildRetiroSeed(today: IsoDate): RetiroSeed {
  const random = createRandom(RETIRO_FARM_SEED);
  const ids = createIdFactory(random, ID_EPOCH_OFFSET_MS);
  const farmId = ids.next();
  const userId = ids.next();
  const membershipId = ids.next();
  const breedId = ids.next();

  const tag = (value: string, assignedAt: IsoDate, retired: IsoDate | null): RetiroIdentifier => ({
    id: ids.next(),
    type: IDENTIFIER_TYPE.VISUAL_TAG,
    value,
    assignedAt,
    retiredAt: retired,
    retireReason: retired === null ? null : IDENTIFIER_RETIRE_REASON.EXITED,
  });
  const weightsFor = (birthDate: IsoDate, until: IsoDate, base: number) => {
    const weights: { id: string; on: IsoDate; kg: number }[] = [];
    for (let on = addDays(birthDate, 30); on <= until; on = addDays(on, 120)) {
      weights.push({ id: ids.next(), on, kg: base + weights.length * random.int(25, 45) });
    }
    return weights;
  };

  const animals: RetiroAnimal[] = [];

  for (const exited of EXITED) {
    const birthDate = toIsoDate(exited.birth);
    const exitDate = toIsoDate(exited.date);
    const identifiers: RetiroIdentifier[] = [tag(exited.code, birthDate, exitDate)];
    if (exited.code === '5') {
      // DIN y RFID de por vida: no se liberan al vender (RN-32).
      for (const [type, value] of [
        [IDENTIFIER_TYPE.DIN, '2301000005'],
        [IDENTIFIER_TYPE.RFID, '170000000200005'],
      ] as const) {
        identifiers.push({
          id: ids.next(),
          type,
          value,
          assignedAt: birthDate,
          retiredAt: null,
          retireReason: null,
        });
      }
    }
    animals.push({
      id: ids.next(),
      code: exited.code,
      sex: exited.sex,
      birthDate,
      exit: { type: exited.type, date: exitDate },
      identifiers,
      weights: weightsFor(birthDate, exitDate, 34),
      sale:
        exited.type === EXIT_TYPE.SALE
          ? {
              id: ids.next(),
              amount: `${random.int(28, 42) * 100000}.00`,
              buyer: 'Comprador [Ficticio]',
            }
          : null,
    });
  }

  for (let number = 1; number <= 40; number += 1) {
    if (FREE_NUMBERS.has(number)) continue;
    const code = String(number);
    const birthDate =
      REUSED_BIRTHS[code] ?? addDays(toIsoDate('2020-03-01'), random.int(0, 5 * 365));
    animals.push({
      id: ids.next(),
      code,
      sex: random.chance(0.7) ? SEX.FEMALE : SEX.MALE,
      birthDate,
      exit: null,
      identifiers: [tag(code, birthDate, null)],
      weights: weightsFor(birthDate, today, 32),
      sale: null,
    });
  }

  // Al final y con su propia fábrica: no mueve ningún identificador de M4c.
  return { farmId, userId, membershipId, breedId, animals, ceba: buildRetiroCeba() };
}

/** Escribe El Retiro, borrando antes lo que hubiera de ella. Devuelve filas por tabla. */
export async function writeRetiroSeed(
  prisma: SeedClient,
  seed: RetiroSeed,
  password: string,
  today: IsoDate,
): Promise<Record<string, number>> {
  await resetFarmData(prisma, seed.farmId, [RETIRO.admin.username]);
  const createdAt = instantOf(today);
  const passwordHash = await hashSeedPassword(password, createRandom(RETIRO_FARM_SEED));

  await prisma.farm.create({
    data: {
      id: seed.farmId,
      name: RETIRO.name,
      settings: {
        ...DEFAULT_FARM_SETTINGS,
        codeReuse: true,
        codeSuggestion: 'LOWEST_FREE',
        // M8a: finca de ceba que vende machos (CFG-03).
        productionSystem: PRODUCTION_SYSTEM.LEVANTE_CEBA,
        salesFocus: SALES_FOCUS.MALES,
      },
      createdAt,
      updatedAt: createdAt,
    },
  });
  await prisma.user.create({
    data: {
      id: seed.userId,
      name: RETIRO.admin.name,
      username: RETIRO.admin.username,
      email: RETIRO.admin.email,
      passwordHash,
      createdAt,
      updatedAt: createdAt,
      memberships: {
        create: { id: seed.membershipId, farmId: seed.farmId, role: ROLE.ADMIN },
      },
    },
  });
  await prisma.breed.create({
    data: {
      id: seed.breedId,
      farmId: seed.farmId,
      name: RETIRO.breed.name,
      group: RETIRO.breed.group,
      gestationDays: defaultGestationDaysForGroup(RETIRO.breed.group),
      updatedAt: createdAt,
    },
  });

  const day = (date: IsoDate) => new Date(`${date}T00:00:00.000Z`);
  await prisma.animal.createMany({
    data: seed.animals.map((animal) => ({
      id: animal.id,
      farmId: seed.farmId,
      code: animal.code,
      sex: animal.sex,
      breedId: seed.breedId,
      birthDate: day(animal.birthDate),
      origin: ORIGIN.BORN_ON_FARM,
      entryDate: day(animal.birthDate),
      exitType: animal.exit?.type ?? null,
      exitDate: animal.exit === null ? null : day(animal.exit.date),
      createdById: seed.userId,
      updatedById: seed.userId,
      createdAt: instantOf(animal.birthDate),
      updatedAt: instantOf(animal.exit?.date ?? animal.birthDate),
    })),
  });
  const identifiers = seed.animals.flatMap((animal) =>
    animal.identifiers.map((identifier) => ({
      id: identifier.id,
      farmId: seed.farmId,
      animalId: animal.id,
      type: identifier.type,
      value: identifier.value,
      assignedAt: day(identifier.assignedAt),
      retiredAt: identifier.retiredAt === null ? null : day(identifier.retiredAt),
      retireReason: identifier.retireReason,
      createdAt: instantOf(identifier.assignedAt),
      updatedAt: instantOf(identifier.retiredAt ?? identifier.assignedAt),
    })),
  );
  await prisma.identifier.createMany({ data: identifiers });
  const weights = seed.animals.flatMap((animal) =>
    animal.weights.map((weight) => ({
      id: weight.id,
      farmId: seed.farmId,
      animalId: animal.id,
      weighedOn: day(weight.on),
      weightKg: new Prisma.Decimal(weight.kg),
      method: WEIGHT_METHOD.TAPE,
      isBirthWeight: false,
      createdById: seed.userId,
      createdAt: instantOf(weight.on),
      updatedAt: instantOf(weight.on),
    })),
  );
  await prisma.weightRecord.createMany({ data: weights });
  const sales = seed.animals.flatMap((animal) =>
    animal.sale === null || animal.exit === null
      ? []
      : [
          {
            id: animal.sale.id,
            farmId: seed.farmId,
            animalId: animal.id,
            soldOn: day(animal.exit.date),
            amount: new Prisma.Decimal(animal.sale.amount),
            buyer: animal.sale.buyer,
            createdById: seed.userId,
            updatedById: seed.userId,
            createdAt: instantOf(animal.exit.date),
            updatedAt: instantOf(animal.exit.date),
          },
        ],
  );
  await prisma.sale.createMany({ data: sales });
  const ceba = await writeCeba(prisma, seed, today);

  return {
    ...ceba,
    'animales de El Retiro': seed.animals.length,
    'identificadores de El Retiro': identifiers.length,
    'pesajes de El Retiro': weights.length,
    'ventas de El Retiro': sales.length,
  };
}

/** Escribe los casos de ceba de M8a (`retiro-ceba.ts`). */
async function writeCeba(
  prisma: SeedClient,
  seed: RetiroSeed,
  today: IsoDate,
): Promise<Record<string, number>> {
  const { ceba } = seed;
  const createdAt = instantOf(today);
  const day = (date: IsoDate) => new Date(`${date}T00:00:00.000Z`);
  await prisma.lot.createMany({
    data: ceba.lots.map((lot) => ({
      id: lot.id,
      farmId: seed.farmId,
      name: lot.name,
      description: lot.description,
      updatedAt: createdAt,
    })),
  });
  await prisma.tag.create({
    data: {
      id: ceba.breederTag.id,
      farmId: seed.farmId,
      key: ceba.breederTag.key,
      label: ceba.breederTag.label,
      description: 'Macho que la finca conserva para servir: no tiene peso objetivo de venta',
      isSystem: true,
      updatedAt: createdAt,
    },
  });
  await prisma.animal.createMany({
    data: ceba.animals.map((animal) => ({
      id: animal.id,
      farmId: seed.farmId,
      code: animal.code,
      sex: animal.sex,
      breedId: seed.breedId,
      birthDate: day(animal.birthDate),
      origin: ORIGIN.PURCHASED,
      originDetail: 'Feria de ganado [Ficticio]',
      entryDate: day(CEBA_ENTRY),
      lotId: animal.lotId,
      createdById: seed.userId,
      updatedById: seed.userId,
      createdAt: instantOf(CEBA_ENTRY),
      updatedAt: instantOf(CEBA_ENTRY),
    })),
  });
  await prisma.identifier.createMany({
    data: ceba.animals.map((animal) => ({
      id: animal.visualTagId,
      farmId: seed.farmId,
      animalId: animal.id,
      type: IDENTIFIER_TYPE.VISUAL_TAG,
      value: animal.code,
      assignedAt: day(CEBA_ENTRY),
      createdAt: instantOf(CEBA_ENTRY),
      updatedAt: instantOf(CEBA_ENTRY),
    })),
  });
  const weights = ceba.animals.flatMap((animal) =>
    animal.weights.map((weight) => ({
      id: weight.id,
      farmId: seed.farmId,
      animalId: animal.id,
      weighedOn: day(weight.on),
      weightKg: new Prisma.Decimal(weight.kg),
      method: WEIGHT_METHOD.SCALE,
      isBirthWeight: false,
      createdById: seed.userId,
      createdAt: instantOf(weight.on),
      updatedAt: instantOf(weight.on),
    })),
  );
  await prisma.weightRecord.createMany({ data: weights });
  await prisma.animalTag.createMany({
    data: ceba.breederLinks.map((link) => ({
      id: link.id,
      farmId: seed.farmId,
      animalId: link.animalId,
      tagId: ceba.breederTag.id,
      createdById: seed.userId,
      createdAt: instantOf(CEBA_ENTRY),
      updatedAt: instantOf(CEBA_ENTRY),
    })),
  });
  return {
    'machos de ceba de El Retiro': ceba.animals.length,
    'pesajes de ceba de El Retiro': weights.length,
  };
}

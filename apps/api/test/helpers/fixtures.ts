import {
  BREED_GROUP,
  DEFAULT_FARM_SETTINGS,
  ORIGIN,
  ROLE,
  SEX,
  toIsoDate,
  uuidv7,
  type IsoDate,
  type Role,
  type Sex,
} from '@hato/shared';

import { PasswordService } from '../../src/auth/password.service.js';
import { toPrismaDate } from '../../src/infra/date-mapper.js';
import type { PrismaService } from '../../src/infra/prisma.service.js';

/**
 * Datos mínimos para las pruebas de integración. No reproducen la finca de referencia —eso es
 * el seed de M0.3b—, solo lo justo para probar la infraestructura: dos fincas distintas con
 * animales propios, que es lo que permite verificar el aislamiento por finca.
 */

/** Finca de prueba con su usuario y su raza. */
export type TestFarm = {
  readonly farmId: string;
  readonly userId: string;
  readonly breedId: string;
};

/** Crea una finca con un usuario ADMIN y una raza. */
export async function createFarm(prisma: PrismaService, name: string): Promise<TestFarm> {
  const farmId = uuidv7();
  const userId = uuidv7();
  const breedId = uuidv7();
  // La parte final del UUIDv7 es la aleatoria; el principio es la marca de tiempo y dos
  // fincas creadas en el mismo milisegundo compartirían prefijo.
  const suffix = userId.slice(-12);

  await prisma.farm.create({
    data: { id: farmId, name, settings: DEFAULT_FARM_SETTINGS },
  });

  await prisma.user.create({
    data: {
      id: userId,
      name: `Usuario de ${name}`,
      username: `user.${suffix}`,
      passwordHash: 'hash-de-prueba',
      memberships: { create: { id: uuidv7(), farmId, role: ROLE.ADMIN } },
    },
  });

  await prisma.breed.create({
    data: { id: breedId, farmId, name: 'Brahman', group: BREED_GROUP.INDICUS, gestationDays: 293 },
  });

  return { farmId, userId, breedId };
}

/** Crea un animal en una finca. Devuelve su id. */
export async function createAnimal(
  prisma: PrismaService,
  farm: TestFarm,
  options: {
    code: string;
    sex?: Sex;
    birthDate?: IsoDate;
    entryDate?: IsoDate;
  },
): Promise<string> {
  const id = uuidv7();
  const birthDate = options.birthDate ?? toIsoDate('2024-05-10');
  await prisma.animal.create({
    data: {
      id,
      farmId: farm.farmId,
      code: options.code,
      sex: options.sex ?? SEX.FEMALE,
      breedId: farm.breedId,
      birthDate: toPrismaDate(birthDate),
      origin: ORIGIN.BORN_ON_FARM,
      entryDate: toPrismaDate(options.entryDate ?? birthDate),
      createdById: farm.userId,
      updatedById: farm.userId,
    },
  });
  return id;
}

/**
 * Vacía la base de datos de pruebas, en orden de dependencia.
 *
 * Borra **todas** las tablas de negocio, no solo las que crea `createFarm`: la base de
 * pruebas puede traer la finca de referencia (el paso `pnpm db:seed` de la integración
 * continua la carga ahí), y entonces un borrado parcial falla por clave foránea al intentar
 * eliminar animales que todavía tienen preñeces, identificadores o pesajes.
 */
export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.workSessionEntry.deleteMany();
  await prisma.expenseAllocation.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.valuation.deleteMany();
  await prisma.lotMovement.deleteMany();
  await prisma.weightRecord.deleteMany();
  await prisma.treatmentRecord.deleteMany();
  await prisma.vaccinationRecord.deleteMany();
  await prisma.identifier.deleteMany();
  await prisma.animalTag.deleteMany();
  await prisma.workSession.deleteMany();
  // Las referencias cruzadas entre animales y preñeces se sueltan antes de borrar.
  await prisma.animal.updateMany({ data: { birthPregnancyId: null, damId: null, sireId: null } });
  await prisma.pregnancy.deleteMany();
  await prisma.animal.deleteMany();
  await prisma.vaccinationCycleVaccine.deleteMany();
  await prisma.vaccinationCycle.deleteMany();
  await prisma.vaccine.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.breed.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.farm.deleteMany();
}

/**
 * Agrega un usuario con un rol concreto a una finca ya creada.
 *
 * Desde M1 el rol efectivo lo lee `AccessGuard` de la membresía en la base, no del token, así
 * que una prueba de autorización necesita una membresía de verdad con ese rol.
 */
export async function createMember(
  prisma: PrismaService,
  farm: TestFarm,
  role: Role,
  options: { isActive?: boolean; password?: string; mustChangePassword?: boolean } = {},
): Promise<{ userId: string; username: string }> {
  const userId = uuidv7();
  const username = `user.${userId.slice(-12)}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Usuario ${role}`,
      username,
      passwordHash:
        options.password === undefined
          ? 'sin-contraseña-usable'
          : await new PasswordService().hash(options.password),
      isActive: options.isActive ?? true,
      mustChangePassword: options.mustChangePassword ?? false,
      memberships: { create: { id: uuidv7(), farmId: farm.farmId, role } },
    },
  });
  return { userId, username };
}

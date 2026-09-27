import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  BREED_GROUP,
  DEFAULT_FARM_SETTINGS,
  DERIVED_TAG,
  ORIGIN,
  PREGNANCY_OUTCOME,
  ROLE,
  SERVICE_METHOD,
  SEX,
  derivedTags,
  isCalvingSoon,
  isServiceUnconfirmedOverdue,
  managementCategory,
  monthsBetween,
  parseFarmSettings,
  summarizePregnancies,
  toIsoDate,
  uuidv7,
  withdrawalUntilOf,
  ageInMonths,
  type IsoDate,
  type Sex,
} from '@hato/shared';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { SECOND_EVALUATION } from '../prisma/seed/expected.js';
import { classificationCtes, type ClassifiedRow } from '../src/animals/classification.sql.js';
import { FarmContextService, classificationParams } from '../src/animals/farm-context.service.js';
import type { FarmScope } from '../src/common/farm-scope/farm-scope.types.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { fromPrismaDate, fromPrismaDateOrNull, toPrismaDate } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { createTestAppWithClock, type FakeClock } from './helpers/app.js';
import { cleanDatabase } from './helpers/fixtures.js';

/**
 * RN-27: la clasificación en SQL (`classification.sql.ts`) da **exactamente** lo mismo que
 * `managementCategory`, `derivedTags`, `isCalvingSoon` e `isServiceUnconfirmedOverdue` de
 * `@hato/shared`, animal por animal.
 *
 * - La regla de meses (`hato_months_between`) contra `monthsBetween` en cientos de miles de
 *   pares de fechas.
 * - Todos los animales de la finca de referencia, en tres escenarios: hoy (25/09/2026), el
 *   15/11/2026 y con otros parámetros guardados en la finca (destete a 8 meses y otras ventanas
 *   de alerta). Los parámetros se leen de la finca con `FarmContextService`, como en la API.
 * - Una finca con casos borde que el seed no tiene: preñeces y tratamientos anulados, partos
 *   un 31 de enero, nacimientos un 29 de febrero, retiro que vence hoy.
 */

const PASSWORD = 'contraseña-de-prueba-del-seed';

type Expected = {
  category: string;
  ageMonths: number;
  calvingCount: number;
  lastCalvingDate: IsoDate | null;
  served: boolean;
  pregnant: boolean;
  calved: boolean;
  dry: boolean;
  withdrawal: boolean;
  calvingSoon: boolean;
  unconfirmedService: boolean;
};

describe('clasificación: SQL ↔ @hato/shared (RN-27)', () => {
  let app: NestFastifyApplication;
  let clock: FakeClock;
  let prisma: PrismaService;
  let farmId: string;
  let adminId: string;

  beforeAll(async () => {
    ({ app, clock } = await createTestAppWithClock());
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const { seed } = await runReferenceSeed(prisma, { password: PASSWORD, today: SEED_TODAY });
    farmId = seed.catalog.farmId;
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'alvaro' } });
    adminId = admin.id;
  }, 180_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  /** Pone el reloj falso en el mediodía de Bogotá de esa fecha. */
  function setToday(date: IsoDate): void {
    const target = new Date(`${date}T17:00:00.000Z`).getTime();
    clock.advanceMinutes((target - clock.now().getTime()) / 60_000);
  }

  /** Lo que dice shared para cada animal de la finca, con los parámetros guardados en ella. */
  async function expectedByShared(
    scopeFarmId: string,
    today: IsoDate,
  ): Promise<Map<string, Expected>> {
    const farm = await prisma.farm.findUniqueOrThrow({ where: { id: scopeFarmId } });
    const settings = parseFarmSettings(farm.settings);
    const animals = await prisma.animal.findMany({
      where: { farmId: scopeFarmId },
      include: {
        pregnancies: true,
        treatments: { select: { withdrawalUntil: true, voidedAt: true } },
      },
    });

    const result = new Map<string, Expected>();
    for (const animal of animals) {
      const facts = summarizePregnancies(
        animal.pregnancies.map((pregnancy) => ({
          outcome: pregnancy.outcome,
          outcomeDate: fromPrismaDateOrNull(pregnancy.outcomeDate),
          serviceDate: fromPrismaDate(pregnancy.serviceDate),
          confirmedAt: fromPrismaDateOrNull(pregnancy.confirmedAt),
          expectedCalvingDate: fromPrismaDate(pregnancy.expectedCalvingDate),
          voided: pregnancy.voidedAt !== null,
        })),
      );
      const withdrawalUntil = withdrawalUntilOf(
        animal.treatments.map((treatment) => ({
          withdrawalUntil: fromPrismaDateOrNull(treatment.withdrawalUntil),
          voided: treatment.voidedAt !== null,
        })),
      );
      const birthDate = fromPrismaDate(animal.birthDate);
      const category = managementCategory({
        sex: animal.sex,
        birthDate,
        calvingCount: facts.calvingCount,
        weaningAgeMonths: settings.weaningAgeMonths,
        today,
      });
      const open = facts.openPregnancy;
      const tags = derivedTags({
        category,
        hasOpenConfirmedPregnancy: open !== null && open.confirmedAt !== null,
        hasOpenUnconfirmedPregnancy: open !== null && open.confirmedAt === null,
        calvingCount: facts.calvingCount,
        lastCalvingDate: facts.lastCalvingDate,
        withdrawalUntil,
        weaningAgeMonths: settings.weaningAgeMonths,
        today,
      });
      result.set(animal.id, {
        category,
        ageMonths: ageInMonths(birthDate, today),
        calvingCount: facts.calvingCount,
        lastCalvingDate: facts.lastCalvingDate,
        served: tags.includes(DERIVED_TAG.SERVED),
        pregnant: tags.includes(DERIVED_TAG.PREGNANT),
        calved: tags.includes(DERIVED_TAG.CALVED),
        dry: tags.includes(DERIVED_TAG.DRY),
        withdrawal: tags.includes(DERIVED_TAG.WITHDRAWAL),
        calvingSoon:
          open !== null &&
          open.confirmedAt !== null &&
          isCalvingSoon({
            expectedCalvingDate: open.expectedCalvingDate,
            calvingAlertDays: settings.calvingAlertDays,
            today,
          }),
        unconfirmedService:
          open !== null &&
          open.confirmedAt === null &&
          isServiceUnconfirmedOverdue({
            serviceDate: open.serviceDate,
            alertDays: settings.unconfirmedServiceAlertDays,
            today,
          }),
      });
    }
    return result;
  }

  /** Lo que dice el SQL, con los parámetros leídos de la finca como lo hace la API. */
  async function actualBySql(scopeFarmId: string): Promise<Map<string, Expected>> {
    const scope: FarmScope = { farmId: scopeFarmId, userId: adminId, role: ROLE.ADMIN };
    const context = await app.get(FarmContextService).load(scope);
    const rows = await prisma.$queryRaw<ClassifiedRow[]>(
      Prisma.sql`WITH ${classificationCtes(classificationParams(scope, context))} SELECT * FROM classified`,
    );
    return new Map(
      rows.map((row) => [
        row.animal_id,
        {
          category: row.category,
          ageMonths: row.age_months,
          calvingCount: row.calving_count,
          lastCalvingDate: fromPrismaDateOrNull(row.last_calving_date),
          served: row.served,
          pregnant: row.pregnant,
          calved: row.calved,
          dry: row.dry,
          withdrawal: row.withdrawal,
          calvingSoon: row.calving_soon,
          unconfirmedService: row.unconfirmed_service,
        },
      ]),
    );
  }

  /** Diferencias legibles: «animal 045: dry SQL=true shared=false». */
  async function differences(scopeFarmId: string, today: IsoDate): Promise<string[]> {
    const [expected, actual] = await Promise.all([
      expectedByShared(scopeFarmId, today),
      actualBySql(scopeFarmId),
    ]);
    const codes = new Map(
      (
        await prisma.animal.findMany({
          where: { farmId: scopeFarmId },
          select: { id: true, code: true },
        })
      ).map((animal) => [animal.id, animal.code]),
    );
    const problems: string[] = [];
    expect(actual.size).toBe(expected.size);
    for (const [id, wanted] of expected) {
      const got = actual.get(id);
      if (got === undefined) {
        problems.push(`animal ${codes.get(id)}: no está en el SQL`);
        continue;
      }
      for (const key of Object.keys(wanted) as (keyof Expected)[]) {
        if (got[key] !== wanted[key]) {
          problems.push(
            `animal ${codes.get(id)}: ${key} SQL=${String(got[key])} shared=${String(wanted[key])}`,
          );
        }
      }
    }
    return problems;
  }

  it('hato_months_between = monthsBetween en todos los pares de fechas (ADR-002)', async () => {
    const rows = await prisma.$queryRaw<{ f: string; t: string; months: number }[]>(Prisma.sql`
      SELECT to_char(f, 'YYYY-MM-DD') AS f, to_char(t, 'YYYY-MM-DD') AS t,
        hato_months_between(f::date, t::date) AS months
      FROM generate_series(${'2023-06-01'}::date, ${'2025-06-30'}::date, interval '1 day') f,
        generate_series(${'2023-11-25'}::date, ${'2025-06-30'}::date, interval '1 day') t
      WHERE extract(day FROM t) IN (1, 15, 27, 28, 29, 30, 31)
         OR (extract(month FROM t) IN (2, 3) AND extract(year FROM t) = 2024)`);

    expect(rows.length).toBeGreaterThan(100_000);
    const wrong = rows.filter(
      (row) => row.months !== monthsBetween(toIsoDate(row.f), toIsoDate(row.t)),
    );
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it('la finca de referencia hoy (25/09/2026): 297 animales, sin diferencias', async () => {
    setToday(SEED_TODAY);
    expect(await differences(farmId, SEED_TODAY)).toEqual([]);
  });

  it('la finca de referencia el 15/11/2026: sin diferencias', async () => {
    setToday(SECOND_EVALUATION);
    expect(await differences(farmId, SECOND_EVALUATION)).toEqual([]);
    setToday(SEED_TODAY);
  });

  it('con otros parámetros guardados en la finca, el SQL los usa y sigue coincidiendo', async () => {
    const farm = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
    const original = farm.settings as Prisma.InputJsonObject;
    const changed = {
      ...parseFarmSettings(original),
      weaningAgeMonths: 8,
      calvingAlertDays: 45,
      unconfirmedServiceAlertDays: 60,
    };
    await prisma.farm.update({ where: { id: farmId }, data: { settings: changed } });
    try {
      setToday(SEED_TODAY);
      const sql = await actualBySql(farmId);
      const categories = [...sql.values()].map((row) => row.category);
      // Con el destete a 8 meses hay más crías que con 7: el SQL leyó el parámetro de la finca.
      const withDefault = await prisma.$queryRaw<{ calves: number }[]>(Prisma.sql`
        WITH ${classificationCtes({ farmId, today: SEED_TODAY, weaningAgeMonths: 7, calvingAlertDays: 30, unconfirmedServiceAlertDays: 90 })}
        SELECT count(*) FILTER (WHERE category IN ('CALF_MALE', 'CALF_FEMALE'))::int AS calves FROM classified`);
      const calvesAt8 = categories.filter((category) => category.startsWith('CALF')).length;
      expect(calvesAt8).toBeGreaterThan(withDefault[0]?.calves ?? Infinity);

      expect(await differences(farmId, SEED_TODAY)).toEqual([]);
    } finally {
      await prisma.farm.update({ where: { id: farmId }, data: { settings: original } });
    }
  });

  it('casos borde que el seed no tiene: anulados, fines de mes, 29 de febrero, retiro que vence hoy', async () => {
    const edge = uuidv7();
    const breedId = uuidv7();
    await prisma.farm.create({
      data: { id: edge, name: 'Finca de bordes', settings: DEFAULT_FARM_SETTINGS },
    });
    await prisma.breed.create({
      data: {
        id: breedId,
        farmId: edge,
        name: 'Brahman',
        group: BREED_GROUP.INDICUS,
        gestationDays: 293,
      },
    });

    const animal = async (code: string, sex: Sex, birth: string): Promise<string> => {
      const id = uuidv7();
      await prisma.animal.create({
        data: {
          id,
          farmId: edge,
          code,
          sex,
          breedId,
          birthDate: toPrismaDate(toIsoDate(birth)),
          origin: ORIGIN.BORN_ON_FARM,
          entryDate: toPrismaDate(toIsoDate(birth)),
          createdById: adminId,
          updatedById: adminId,
        },
      });
      return id;
    };
    const pregnancy = async (
      damId: string,
      data: {
        outcome: 'PENDING' | 'CALVED' | 'ABORTED' | 'FAILED';
        service: string;
        outcomeDate?: string;
        confirmedAt?: string;
        expected?: string;
        voided?: boolean;
      },
    ): Promise<void> => {
      await prisma.pregnancy.create({
        data: {
          id: uuidv7(),
          farmId: edge,
          damId,
          serviceDate: toPrismaDate(toIsoDate(data.service)),
          method: SERVICE_METHOD.NATURAL,
          confirmedAt:
            data.confirmedAt === undefined ? null : toPrismaDate(toIsoDate(data.confirmedAt)),
          expectedCalvingDate: toPrismaDate(toIsoDate(data.expected ?? '2026-12-01')),
          outcome: data.outcome,
          outcomeDate:
            data.outcomeDate === undefined ? null : toPrismaDate(toIsoDate(data.outcomeDate)),
          voidedAt: data.voided === true ? new Date('2026-09-01T12:00:00Z') : null,
          voidReason: data.voided === true ? 'Registro duplicado' : null,
          createdById: adminId,
          updatedById: adminId,
        },
      });
    };
    const treatment = async (animalId: string, until: string, voided = false): Promise<void> => {
      await prisma.treatmentRecord.create({
        data: {
          id: uuidv7(),
          farmId: edge,
          animalId,
          startedOn: toPrismaDate(toIsoDate('2026-09-01')),
          reason: 'Prueba',
          medication: 'Oxitetraciclina',
          withdrawalUntil: toPrismaDate(toIsoDate(until)),
          voidedAt: voided ? new Date('2026-09-02T12:00:00Z') : null,
          createdById: adminId,
        },
      });
    };

    // Destete justo hoy y justo mañana, contando con el recorte a fin de mes.
    await animal('B-01', SEX.FEMALE, '2026-02-25');
    await animal('B-02', SEX.MALE, '2026-02-26');
    await animal('B-03', SEX.FEMALE, '2024-02-29');
    await animal('B-04', SEX.MALE, '2024-09-25'); // 24 meses hoy: toro
    await animal('B-05', SEX.MALE, '2024-09-26'); // 23 meses: levante
    // Único parto anulado: sigue siendo novilla.
    const b6 = await animal('B-06', SEX.FEMALE, '2022-01-10');
    await pregnancy(b6, {
      outcome: PREGNANCY_OUTCOME.CALVED,
      service: '2024-01-01',
      outcomeDate: '2024-10-15',
      voided: true,
    });
    // Parto un 31 de enero: horra desde el 31 de agosto (recorte a fin de mes con destete 7).
    const b7 = await animal('B-07', SEX.FEMALE, '2020-03-01');
    await pregnancy(b7, {
      outcome: PREGNANCY_OUTCOME.CALVED,
      service: '2025-04-20',
      outcomeDate: '2026-01-31',
    });
    // Parto hace 6 meses con cría al pie: vaca, no horra.
    const b8 = await animal('B-08', SEX.FEMALE, '2020-03-01');
    await pregnancy(b8, {
      outcome: PREGNANCY_OUTCOME.CALVED,
      service: '2025-06-01',
      outcomeDate: '2026-03-26',
    });
    // Servida con 90 y con 91 días, y una preñez abierta anulada que no cuenta.
    const b9 = await animal('B-09', SEX.FEMALE, '2023-01-01');
    await pregnancy(b9, { outcome: PREGNANCY_OUTCOME.PENDING, service: '2026-06-27' });
    const b10 = await animal('B-10', SEX.FEMALE, '2023-01-01');
    await pregnancy(b10, { outcome: PREGNANCY_OUTCOME.PENDING, service: '2026-06-26' });
    const b11 = await animal('B-11', SEX.FEMALE, '2023-01-01');
    await pregnancy(b11, {
      outcome: PREGNANCY_OUTCOME.PENDING,
      service: '2026-01-01',
      confirmedAt: '2026-03-01',
      voided: true,
    });
    // Parto previsto en el último día de la ventana y el día siguiente.
    const b12 = await animal('B-12', SEX.FEMALE, '2021-01-01');
    await pregnancy(b12, {
      outcome: PREGNANCY_OUTCOME.CALVED,
      service: '2023-01-01',
      outcomeDate: '2023-10-10',
    });
    await pregnancy(b12, {
      outcome: PREGNANCY_OUTCOME.PENDING,
      service: '2026-01-05',
      confirmedAt: '2026-03-01',
      expected: '2026-10-25',
    });
    const b13 = await animal('B-13', SEX.FEMALE, '2021-01-01');
    await pregnancy(b13, {
      outcome: PREGNANCY_OUTCOME.PENDING,
      service: '2026-01-06',
      confirmedAt: '2026-03-01',
      expected: '2026-10-26',
    });
    // Retiro que vence hoy, que venció ayer y uno anulado.
    const b14 = await animal('B-14', SEX.MALE, '2025-01-01');
    await treatment(b14, '2026-09-25');
    const b15 = await animal('B-15', SEX.MALE, '2025-01-01');
    await treatment(b15, '2026-09-24');
    const b16 = await animal('B-16', SEX.MALE, '2025-01-01');
    await treatment(b16, '2026-12-01', true);
    // Aborto y diagnóstico negativo: no cuentan como partos.
    const b17 = await animal('B-17', SEX.FEMALE, '2022-01-01');
    await pregnancy(b17, {
      outcome: PREGNANCY_OUTCOME.ABORTED,
      service: '2025-01-01',
      outcomeDate: '2025-04-01',
    });
    await pregnancy(b17, {
      outcome: PREGNANCY_OUTCOME.FAILED,
      service: '2025-06-01',
      outcomeDate: '2025-08-01',
    });

    setToday(SEED_TODAY);
    expect(await differences(edge, SEED_TODAY)).toEqual([]);
    // Y en un fin de mes corto, donde el recorte decide.
    setToday(toIsoDate('2027-02-28'));
    expect(await differences(edge, toIsoDate('2027-02-28'))).toEqual([]);
    setToday(SEED_TODAY);
  });
});

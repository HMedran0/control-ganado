import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  BREEDER_TAG_KEY,
  BREED_GROUP,
  DEFAULT_FARM_SETTINGS,
  DERIVED_TAG,
  ORIGIN,
  PREGNANCY_OUTCOME,
  ROLE,
  SERVICE_METHOD,
  SEX,
  animalWithdrawals,
  derivedTags,
  isCalvingOverdue,
  isCalvingSoon,
  isServiceUnconfirmedOverdue,
  isWithdrawalActive,
  lastTwoWeights,
  managementCategory,
  monthsBetween,
  parseFarmSettings,
  saleWeightProjection,
  summarizePregnancies,
  toIsoDate,
  uuidv7,
  weightAlerts,
  weightGains,
  withdrawalUntilOf,
  ageInMonths,
  type IsoDate,
  type Sex,
} from '@hato/shared';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { SECOND_EVALUATION } from '../prisma/seed/expected.js';
import { toWeightLike } from '../src/animals/animal-views.js';
import { classificationCtes, type ClassifiedRow } from '../src/animals/classification.sql.js';
import { VaccineStatusService } from '../src/animals/vaccine-status.service.js';
import type { VaccineStatusRow } from '../src/animals/vaccine-status.sql.js';
import { FarmContextService, classificationParams } from '../src/animals/farm-context.service.js';
import type { FarmScope } from '../src/common/farm-scope/farm-scope.types.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { fromPrismaDate, fromPrismaDateOrNull, toPrismaDate } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import request from 'supertest';

import { bearer, createTestAppWithClock, signTestToken, type FakeClock } from './helpers/app.js';
import { cleanDatabase, createAnimal, createFarm } from './helpers/fixtures.js';

/**
 * RN-27: la clasificación en SQL (`classification.sql.ts`) da **exactamente** lo mismo que
 * `managementCategory`, `derivedTags`, `isCalvingSoon` e `isServiceUnconfirmedOverdue` de
 * `@hato/shared`, animal por animal. Desde M6 también `vaccineStatus` (estado, motivo y fecha
 * límite por animal y vacuna, y las alertas de vacunas) y las ganancias de peso ya redondeadas y
 * sus alertas (ADR-009 decisión 8, ADR-015).
 *
 * - La regla de meses (`hato_months_between`) contra `monthsBetween` en cientos de miles de
 *   pares de fechas.
 * - Todos los animales de la finca de referencia, en tres escenarios: hoy (25/09/2026), el
 *   15/11/2026 y con otros parámetros guardados en la finca (destete a 8 meses y otras ventanas
 *   de alerta). Los parámetros se leen de la finca con `FarmContextService`, como en la API.
 * - Una finca con casos borde que el seed no tiene: preñeces y tratamientos anulados, partos
 *   un 31 de enero, nacimientos un 29 de febrero, retiro que vence hoy.
 * - Desde M8a: el peso de venta de `saleWeightProjection` (situación y fecha estimada), el
 *   retiro de leche y la etiqueta «Reproductor», con una finca de casos borde propia.
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
  calvingOverdue: boolean;
  vaccineOverdue: boolean;
  vaccineDue: boolean;
  gainLastTwoMilli: number | null;
  gain90Milli: number | null;
  gainBirthMilli: number | null;
  lowGain: boolean;
  weightLoss: boolean;
  isBreeder: boolean;
  milkWithdrawal: boolean;
  saleWeightStatus: string | null;
  saleWeightOn: IsoDate | null;
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
        treatments: {
          select: {
            withdrawalUntil: true,
            voidedAt: true,
            startedOn: true,
            durationDays: true,
            withdrawalMeatDays: true,
            withdrawalMilkDays: true,
          },
        },
        weights: true,
        tags: { where: { removedAt: null }, include: { tag: { select: { key: true } } } },
      },
    });
    const scope: FarmScope = { farmId: scopeFarmId, userId: adminId, role: ROLE.ADMIN };
    const vaccineStatuses = await app
      .get(VaccineStatusService)
      .statusesFor(scope, { today, settings }, 'ALL_ACTIVE');

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
        animal.importedPriorCalvings,
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
      const active = animal.deletedAt === null && animal.exitType === null;
      const weights = animal.weights.map(toWeightLike);
      const gains = weightGains({
        records: weights,
        anchorMaxDays: settings.weightGainAnchorMaxDays,
        today,
      });
      const weightResult = weightAlerts({ records: weights, category, settings, today });
      const statuses = (vaccineStatuses.get(animal.id) ?? []).map((status) => status.status);
      const isBreeder = animal.tags.some((link) => link.tag.key === BREEDER_TAG_KEY);
      const milkUntil = animalWithdrawals(
        animal.treatments.map((treatment) => ({
          startedOn: fromPrismaDate(treatment.startedOn),
          durationDays: treatment.durationDays,
          withdrawalMeatDays: treatment.withdrawalMeatDays,
          withdrawalMilkDays: treatment.withdrawalMilkDays,
          voided: treatment.voidedAt !== null,
        })),
      ).milkUntil;
      const sale = active
        ? saleWeightProjection({
            targetKg: settings.targetSaleWeightKg[category],
            isBreeder,
            last: lastTwoWeights(weights)?.last ?? null,
            gain90Milli: gains.last90DaysMilli,
            today,
          })
        : null;
      result.set(animal.id, {
        isBreeder,
        milkWithdrawal: active && isWithdrawalActive(milkUntil, today),
        saleWeightStatus: sale?.status ?? null,
        saleWeightOn: sale?.estimatedOn ?? null,
        vaccineOverdue: active && statuses.includes('OVERDUE'),
        vaccineDue: active && statuses.some((kind) => kind === 'PENDING' || kind === 'UPCOMING'),
        gainLastTwoMilli: gains.lastTwoMilli,
        gain90Milli: gains.last90DaysMilli,
        gainBirthMilli: gains.sinceBirthMilli,
        lowGain: active && weightResult.lowGain,
        weightLoss: active && weightResult.weightLoss,
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
        calvingOverdue:
          open !== null &&
          isCalvingOverdue({
            expectedCalvingDate: open.expectedCalvingDate,
            overdueCalvingAlertDays: settings.overdueCalvingAlertDays,
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
          calvingOverdue: row.calving_overdue,
          vaccineOverdue: row.vaccine_overdue,
          vaccineDue: row.vaccine_due,
          gainLastTwoMilli: row.gain_last_two_milli,
          gain90Milli: row.gain_90_milli,
          gainBirthMilli: row.gain_birth_milli,
          lowGain: row.low_gain,
          weightLoss: row.weight_loss,
          isBreeder: row.is_breeder,
          milkWithdrawal: row.milk_withdrawal,
          saleWeightStatus: row.sale_weight_status,
          saleWeightOn: fromPrismaDateOrNull(row.sale_weight_on),
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
      overdueCalvingAlertDays: 5,
      vaccineAlertDays: 30,
      // Umbral más alto en levante y uno nuevo en novillas; pérdida y ancla más estrictas.
      weightGainAlertKgPerDay: { YOUNG_MALE: 0.42, HEIFER: 0.35 },
      weightLossAlertPercent: 2,
      weightGainAnchorMaxDays: 5,
      // Otro peso de venta, también para novillas.
      targetSaleWeightKg: { YOUNG_MALE: 320, HEIFER: 300 },
    };
    await prisma.farm.update({ where: { id: farmId }, data: { settings: changed } });
    try {
      setToday(SEED_TODAY);
      const sql = await actualBySql(farmId);
      const categories = [...sql.values()].map((row) => row.category);
      // Con el destete a 8 meses hay más crías que con 7: el SQL leyó el parámetro de la finca.
      const withDefault = await prisma.$queryRaw<{ calves: number }[]>(Prisma.sql`
        WITH ${classificationCtes({ ...classificationParams({ farmId, userId: adminId, role: ROLE.ADMIN }, { today: SEED_TODAY, settings: DEFAULT_FARM_SETTINGS }), weaningAgeMonths: 7 })}
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

    const animal = async (
      code: string,
      sex: Sex,
      birth: string,
      importedPriorCalvings = 0,
    ): Promise<string> => {
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
          importedPriorCalvings,
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

    // Partos anteriores importados sin fecha (RN-29): vaca y parida, pero no horra sin fecha.
    const b20 = await animal('B-20', SEX.FEMALE, '2018-05-01', 3);
    // Tres anteriores más el último importado con fecha: 4 partos, horra por la fecha.
    const b21 = await animal('B-21', SEX.FEMALE, '2017-05-01', 3);
    await pregnancy(b21, {
      outcome: PREGNANCY_OUTCOME.CALVED,
      service: '2025-01-15',
      outcomeDate: '2025-11-01',
    });
    // Uno importado y preñada: vaca preñada con parto previsto.
    const b22 = await animal('B-22', SEX.FEMALE, '2019-05-01', 1);
    await pregnancy(b22, {
      outcome: PREGNANCY_OUTCOME.PENDING,
      service: '2026-05-01',
      confirmedAt: '2026-07-01',
      expected: '2027-02-18',
    });

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
    // Los partos importados cuentan en los dos lados (no es una coincidencia en cero).
    const shared = await expectedByShared(edge, SEED_TODAY);
    expect(shared.get(b20)).toMatchObject({
      category: 'COW',
      calvingCount: 3,
      calved: true,
      dry: false,
    });
    expect(shared.get(b21)).toMatchObject({ calvingCount: 4, dry: true });
    expect(shared.get(b22)).toMatchObject({ category: 'COW', calvingCount: 1, pregnant: true });
    // Y en un fin de mes corto, donde el recorte decide.
    setToday(toIsoDate('2027-02-28'));
    expect(await differences(edge, toIsoDate('2027-02-28'))).toEqual([]);
    setToday(SEED_TODAY);
  });

  it('M8a: peso de venta en los límites del mes, reproductor, sin ganancia y retiro de leche', async () => {
    const edge = uuidv7();
    const breedId = uuidv7();
    const breederTag = uuidv7();
    await prisma.farm.create({
      data: { id: edge, name: 'Finca de bordes de M8a', settings: DEFAULT_FARM_SETTINGS },
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
    await prisma.tag.create({
      data: {
        id: breederTag,
        farmId: edge,
        key: BREEDER_TAG_KEY,
        label: 'Reproductor',
        isSystem: true,
      },
    });
    const animal = async (
      code: string,
      sex: Sex,
      birth: string,
      exited = false,
    ): Promise<string> => {
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
          exitType: exited ? 'SALE' : null,
          exitDate: exited ? toPrismaDate(toIsoDate('2026-09-20')) : null,
          createdById: adminId,
          updatedById: adminId,
        },
      });
      return id;
    };
    const weigh = async (animalId: string, on: string, kg: number): Promise<void> => {
      await prisma.weightRecord.create({
        data: {
          id: uuidv7(),
          farmId: edge,
          animalId,
          weighedOn: toPrismaDate(toIsoDate(on)),
          weightKg: new Prisma.Decimal(kg),
          method: 'SCALE',
          createdById: adminId,
        },
      });
    };
    const milkTreatment = async (animalId: string, started: string, milkDays: number) => {
      await prisma.treatmentRecord.create({
        data: {
          id: uuidv7(),
          farmId: edge,
          animalId,
          startedOn: toPrismaDate(toIsoDate(started)),
          durationDays: 1,
          withdrawalMeatDays: 0,
          withdrawalMilkDays: milkDays,
          withdrawalUntil: toPrismaDate(toIsoDate(started)),
          reason: 'Mastitis',
          medication: 'Cefalosporina',
          createdById: adminId,
        },
      });
    };
    // Ganancia de 0,8 kg/día entre el 15/07 y el 14/09 (61 días, 48,8 kg).
    const steer = async (code: string, lastKg: number, birth = '2025-01-10'): Promise<string> => {
      const id = await animal(code, SEX.MALE, birth);
      await weigh(id, '2026-07-15', lastKg - 48.8);
      await weigh(id, '2026-09-14', lastKg);
      return id;
    };
    const s1 = await steer('S-01', 438.8); // 11,2 kg / 0,8 = 14 → 28/09: este mes
    const s2 = await steer('S-02', 437.6); // 12,4 / 0,8 = 15,5 → 16 días → 30/09: este mes
    const s3 = await steer('S-03', 436.8); // 13,2 / 0,8 = 16,5 → 17 → 01/10: después
    await steer('S-04', 450); // justo en el objetivo: medido
    // Fecha estimada ya pasada con el último pesaje por debajo: posiblemente en el peso.
    const s5 = await animal('S-05', SEX.MALE, '2025-01-10');
    await weigh(s5, '2026-06-01', 400);
    await weigh(s5, '2026-07-20', 445);
    // Toro de más de 24 meses: también tiene peso de venta… salvo que sea reproductor.
    const s6 = await steer('S-06', 438.8, '2023-05-01');
    const s7 = await steer('S-07', 438.8, '2023-05-01');
    await prisma.animalTag.create({
      data: { id: uuidv7(), farmId: edge, animalId: s7, tagId: breederTag, createdById: adminId },
    });
    // Sin ganancia (perdió peso) y uno solo pesaje: sin situación.
    const s8 = await animal('S-08', SEX.MALE, '2025-01-10');
    await weigh(s8, '2026-07-15', 420);
    await weigh(s8, '2026-09-14', 410);
    const s9 = await animal('S-09', SEX.MALE, '2025-01-10');
    await weigh(s9, '2026-09-14', 300);
    // Vendido: no tiene situación aunque su peso dé.
    const s10 = await animal('S-10', SEX.MALE, '2025-01-10', true);
    await weigh(s10, '2026-07-15', 400);
    await weigh(s10, '2026-09-14', 448);
    // Retiro de leche que vence hoy (1 + 24 días desde el 31/08), que venció ayer y de 0 días.
    const c1 = await animal('C-01', SEX.FEMALE, '2020-01-01');
    await milkTreatment(c1, '2026-08-31', 24);
    const c2 = await animal('C-02', SEX.FEMALE, '2020-01-01');
    await milkTreatment(c2, '2026-08-31', 23);
    const c3 = await animal('C-03', SEX.FEMALE, '2020-01-01');
    await milkTreatment(c3, '2026-09-20', 0);

    setToday(SEED_TODAY);
    expect(await differences(edge, SEED_TODAY)).toEqual([]);
    // No es una coincidencia en null: cada caso da lo que dice su comentario.
    const sql = await actualBySql(edge);
    const pick = (id: string) => {
      const row = sql.get(id);
      return [row?.saleWeightStatus, row?.saleWeightOn];
    };
    expect(pick(s1)).toEqual(['this_month', '2026-09-28']);
    expect(pick(s2)).toEqual(['this_month', '2026-09-30']);
    expect(pick(s3)).toEqual(['later', '2026-10-01']);
    expect(pick(s5)[0]).toBe('likely_reached');
    expect(pick(s6)).toEqual(['this_month', '2026-09-28']);
    expect(pick(s7)).toEqual([null, null]);
    expect(pick(s8)).toEqual([null, null]);
    expect(pick(s9)).toEqual([null, null]);
    expect(pick(s10)).toEqual([null, null]);
    expect([c1, c2, c3].map((id) => sql.get(id)?.milkWithdrawal)).toEqual([true, false, false]);
    expect(sql.get(s7)?.isBreeder).toBe(true);
    // El 01/10, el mes cambió: lo de octubre ya es «este mes» y lo de septiembre ya pasó.
    setToday(toIsoDate('2026-10-01'));
    expect(await differences(edge, toIsoDate('2026-10-01'))).toEqual([]);
    setToday(SEED_TODAY);
  });

  it('casos de M5 creados por la API: mellizos, aborto, servicio estimado, anulados, horra que vuelve a servicio', async () => {
    setToday(SEED_TODAY);
    const farm = await createFarm(prisma, 'Finca de M5');
    const admin = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
    const http = () => request(app.getHttpServer());
    const post = async (path: string, body: object): Promise<{ id: string }> =>
      (await http().post(`/api/v1${path}`).set(admin).send(body).expect(201)).body as {
        id: string;
      };
    const cow = (code: string) =>
      createAnimal(prisma, farm, { code, birthDate: toIsoDate('2020-01-01') });

    // Mellizos con una muerta al nacer, sobre una preñez confirmada.
    const twins = await cow('M-1');
    const service = await post('/pregnancies', {
      damId: twins,
      serviceDate: '2025-11-01',
      method: 'AI',
    });
    await post(`/pregnancies/${service.id}/diagnosis`, { date: '2026-01-10', result: 'POSITIVE' });
    await post('/calvings', {
      damId: twins,
      date: '2026-08-15',
      calvingType: 'ASSISTED',
      calves: [
        { sex: 'MALE', health: 'ALIVE' },
        { sex: 'FEMALE', health: 'WEAK' },
        { sex: 'FEMALE', health: 'STILLBORN' },
      ],
    });

    // Aborto y otra preñez confirmada después.
    const aborted = await cow('M-2');
    const lost = await post('/pregnancies', {
      damId: aborted,
      serviceDate: '2025-10-01',
      method: 'NATURAL',
    });
    await post(`/pregnancies/${lost.id}/abortion`, { date: '2026-01-20' });

    // Parto sin preñez registrada (servicio estimado) y hoy horra: vuelve a servicio.
    const dry = await cow('M-3');
    await post('/calvings', {
      damId: dry,
      date: '2025-12-01',
      calvingType: 'NORMAL',
      calves: [{ sex: 'MALE', health: 'ALIVE' }],
    });
    const before = (await expectedByShared(farm.farmId, SEED_TODAY)).get(dry);
    expect(before).toMatchObject({ dry: true, calvingCount: 1 });
    await post('/pregnancies', { damId: dry, serviceDate: '2026-09-01', method: 'NATURAL' });

    // Preñez confirmada sin servicio (estimado) y una anulada.
    const estimated = await cow('M-4');
    await post('/pregnancies', {
      damId: estimated,
      gestationMonths: 9,
      diagnosisDate: '2026-09-20',
    });
    const voided = await cow('M-5');
    const wrong = await post('/pregnancies', {
      damId: voided,
      serviceDate: '2026-02-01',
      method: 'AI',
    });
    await post(`/pregnancies/${wrong.id}/void`, { reason: 'Hembra equivocada' });

    expect(await differences(farm.farmId, SEED_TODAY)).toEqual([]);
    const shared = await expectedByShared(farm.farmId, SEED_TODAY);
    expect(shared.get(twins)).toMatchObject({ category: 'COW', calvingCount: 1, calved: true });
    expect(shared.get(aborted)).toMatchObject({ category: 'HEIFER', calvingCount: 0 });
    expect(shared.get(dry)).toMatchObject({ served: true, dry: false });
    expect(shared.get(estimated)).toMatchObject({ pregnant: true, calvingSoon: true });
    expect(shared.get(voided)).toMatchObject({ served: false, pregnant: false });
  });

  // -------------------------------------------------------------------------------------------
  // Vacunas (ADR-009 decisión 8) y pesos (ADR-015), M6
  // -------------------------------------------------------------------------------------------

  /** Estado, motivo y fecha límite por animal y vacuna: SQL contra `vaccineStatus` de shared. */
  async function vaccineDifferences(scopeFarmId: string, today: IsoDate): Promise<string[]> {
    const scope: FarmScope = { farmId: scopeFarmId, userId: adminId, role: ROLE.ADMIN };
    const context = await app.get(FarmContextService).load(scope);
    expect(context.today).toBe(today);
    const shared = await app.get(VaccineStatusService).statusesFor(scope, context, 'ALL_ACTIVE');
    const rows = await prisma.$queryRaw<VaccineStatusRow[]>(
      Prisma.sql`WITH ${classificationCtes(classificationParams(scope, context))}
        SELECT animal_id, vaccine_id, kind, reason, due_on FROM vaccine_status`,
    );
    const sql = new Map(rows.map((row) => [`${row.animal_id}:${row.vaccine_id}`, row]));
    const problems: string[] = [];
    let pairs = 0;
    for (const [animalId, statuses] of shared) {
      for (const status of statuses) {
        pairs += 1;
        const row = sql.get(`${animalId}:${status.vaccineId}`);
        const got =
          row === undefined
            ? 'sin fila'
            : `${row.kind}/${row.reason}/${fromPrismaDateOrNull(row.due_on) ?? '-'}`;
        const wanted = `${status.status}/${status.reason}/${status.dueOn ?? '-'}`;
        if (got !== wanted) {
          problems.push(`${animalId} ${status.name}: SQL=${got} shared=${wanted}`);
        }
      }
    }
    expect(rows.length).toBe(pairs);
    return problems;
  }

  it('vacunas de la finca de referencia hoy y con el ciclo 2026-2 abierto: sin diferencias', async () => {
    setToday(SEED_TODAY);
    expect(await vaccineDifferences(farmId, SEED_TODAY)).toEqual([]);
    setToday(SECOND_EVALUATION);
    expect(await vaccineDifferences(farmId, SECOND_EVALUATION)).toEqual([]);
    setToday(SEED_TODAY);
  });

  it('casos borde de vacunas y pesos: ciclos, ventanas, intervalos, anulados y umbrales exactos', async () => {
    const edge = uuidv7();
    const breedId = uuidv7();
    await prisma.farm.create({
      data: { id: edge, name: 'Finca de bordes M6', settings: DEFAULT_FARM_SETTINGS },
    });
    await prisma.breed.create({
      data: { id: breedId, farmId: edge, name: 'Brahman', group: BREED_GROUP.INDICUS },
    });
    const day = (value: string) => toPrismaDate(toIsoDate(value));
    const vaccine = async (
      name: string,
      data: {
        scheduleType: 'OFFICIAL_CYCLE' | 'AGE_WINDOW' | 'INTERVAL' | 'NONE';
        boosterIntervalDays?: number;
        eligibleSex?: Sex;
        minAgeDays?: number;
        maxAgeDays?: number;
      },
    ): Promise<string> => {
      const id = uuidv7();
      await prisma.vaccine.create({
        data: { id, farmId: edge, name, disease: name, blockIneligibleSex: true, ...data },
      });
      return id;
    };
    const aftosa = await vaccine('Aftosa', { scheduleType: 'OFFICIAL_CYCLE' });
    const rabia = await vaccine('Rabia', { scheduleType: 'OFFICIAL_CYCLE' });
    const bruce = await vaccine('Brucelosis', {
      scheduleType: 'AGE_WINDOW',
      eligibleSex: SEX.FEMALE,
      minAgeDays: 90,
      maxAgeDays: 270,
    });
    const clostri = await vaccine('Clostridial', {
      scheduleType: 'INTERVAL',
      boosterIntervalDays: 365,
      minAgeDays: 90,
    });
    await vaccine('Desparasitante', { scheduleType: 'NONE' });
    const cycle = async (
      name: string,
      from: string,
      to: string,
      vaccineIds: string[],
    ): Promise<string> => {
      const id = uuidv7();
      await prisma.vaccinationCycle.create({
        data: { id, farmId: edge, name, startsOn: day(from), endsOn: day(to) },
      });
      for (const vaccineId of vaccineIds) {
        await prisma.vaccinationCycleVaccine.create({
          data: { id: uuidv7(), farmId: edge, cycleId: id, vaccineId },
        });
      }
      return id;
    };
    // 2026-1 cerrado (aftosa y rabia) y uno en curso solo de aftosa: rabia se quitó del en curso.
    await cycle('2026-1', '2026-05-04', '2026-06-23', [aftosa, rabia]);
    const current = await cycle('2026-X', '2026-09-01', '2026-10-31', [aftosa]);
    await prisma.vaccinationCycleVaccine.create({
      data: {
        id: uuidv7(),
        farmId: edge,
        cycleId: current,
        vaccineId: rabia,
        removedAt: new Date('2026-09-02T12:00:00Z'),
        removedById: adminId,
      },
    });

    const animal = async (
      code: string,
      sex: Sex,
      birth: string,
      entry = birth,
      entryEstimated = false,
    ): Promise<string> => {
      const id = uuidv7();
      await prisma.animal.create({
        data: {
          id,
          farmId: edge,
          code,
          sex,
          breedId,
          birthDate: day(birth),
          origin: entry === birth ? ORIGIN.BORN_ON_FARM : ORIGIN.PURCHASED,
          entryDate: day(entry),
          entryDateEstimated: entryEstimated,
          createdById: adminId,
          updatedById: adminId,
        },
      });
      return id;
    };
    const applied = async (
      animalId: string,
      vaccineId: string,
      on: string,
      extra: { nextDueOn?: string | null; voided?: boolean } = {},
    ): Promise<void> => {
      await prisma.vaccinationRecord.create({
        data: {
          id: uuidv7(),
          farmId: edge,
          animalId,
          vaccineId,
          appliedOn: day(on),
          nextDueOn: extra.nextDueOn == null ? null : day(extra.nextDueOn),
          voidedAt: extra.voided === true ? new Date('2026-09-03T12:00:00Z') : null,
          createdById: adminId,
        },
      });
    };
    const weighed = async (
      animalId: string,
      on: string,
      kg: string,
      extra: { birth?: boolean; voided?: boolean } = {},
    ): Promise<void> => {
      await prisma.weightRecord.create({
        data: {
          id: uuidv7(),
          farmId: edge,
          animalId,
          weighedOn: day(on),
          weightKg: kg,
          isBirthWeight: extra.birth === true,
          voidedAt: extra.voided === true ? new Date('2026-09-03T12:00:00Z') : null,
          createdById: adminId,
        },
      });
    };

    // Ciclos: vacunada en el ciclo cerrado, en el en curso, nunca; ingreso el día del cierre y el
    // día siguiente; ingreso estimado; nacido después del cierre.
    const v1 = await animal('V-01', SEX.FEMALE, '2022-01-01');
    await applied(v1, aftosa, '2026-05-10');
    await applied(v1, rabia, '2026-05-10');
    const v2 = await animal('V-02', SEX.MALE, '2022-01-01');
    await applied(v2, aftosa, '2026-09-10');
    await animal('V-03', SEX.MALE, '2022-01-01', '2026-06-23');
    await animal('V-04', SEX.MALE, '2022-01-01', '2026-06-24');
    await animal('V-05', SEX.FEMALE, '2022-01-01', '2026-08-01', true);
    await animal('V-06', SEX.MALE, '2026-07-01');
    // Brucelosis: los extremos exactos de la ventana, antes y después, vacunada y anulada.
    await animal('V-10', SEX.FEMALE, '2026-06-27'); // 90 días hoy
    await animal('V-11', SEX.FEMALE, '2026-06-28'); // 89 días
    await animal('V-12', SEX.FEMALE, '2025-12-29'); // 270 días
    await animal('V-13', SEX.FEMALE, '2025-12-28'); // 271 días
    const v14 = await animal('V-14', SEX.FEMALE, '2026-03-01');
    await applied(v14, bruce, '2026-07-01');
    const v15 = await animal('V-15', SEX.FEMALE, '2026-03-01');
    await applied(v15, bruce, '2026-07-01', { voided: true });
    // Intervalo: vencida, próxima en el último día de la ventana, fuera de la ventana, fecha
    // editada y tres el mismo día.
    const i1 = await animal('I-01', SEX.MALE, '2020-01-01');
    await applied(i1, clostri, '2025-09-24');
    const i2 = await animal('I-02', SEX.MALE, '2020-01-01');
    await applied(i2, clostri, '2025-10-10'); // vence el 10/10/2026
    const i3 = await animal('I-03', SEX.MALE, '2020-01-01');
    await applied(i3, clostri, '2025-10-11');
    const i4 = await animal('I-04', SEX.MALE, '2020-01-01');
    await applied(i4, clostri, '2026-01-01', { nextDueOn: '2026-09-20' });
    const i5 = await animal('I-05', SEX.MALE, '2020-01-01');
    await applied(i5, clostri, '2026-01-10', { nextDueOn: '2026-09-01' });
    await applied(i5, clostri, '2026-01-10', { nextDueOn: '2027-01-10' });
    await applied(i5, clostri, '2026-01-10', { nextDueOn: null });

    // Pesos: justo en el umbral (0,2995 → 0,300) y por debajo (0,2994 → 0,299), levante.
    const w1 = await animal('W-01', SEX.MALE, '2025-08-01');
    await weighed(w1, '2026-03-09', '200.00');
    await weighed(w1, '2026-09-25', '259.90');
    const w2 = await animal('W-02', SEX.MALE, '2025-08-01');
    await weighed(w2, '2026-03-09', '200.00');
    await weighed(w2, '2026-09-25', '259.88');
    // Ancla a 180 días del inicio de la ventana (sirve) y a 181 (no sirve).
    const w3 = await animal('W-03', SEX.MALE, '2025-06-01');
    await weighed(w3, '2025-12-29', '150.00');
    await weighed(w3, '2026-09-15', '220.00');
    const w4 = await animal('W-04', SEX.MALE, '2025-06-01');
    await weighed(w4, '2025-12-28', '150.00');
    await weighed(w4, '2026-09-15', '220.00');
    // Regresión con varios puntos, peso al nacer, un anulado y dos el mismo día.
    const w5 = await animal('W-05', SEX.MALE, '2025-05-01');
    await weighed(w5, '2025-05-01', '33.50', { birth: true });
    await weighed(w5, '2026-06-01', '250.00');
    await weighed(w5, '2026-07-01', '262.50');
    await weighed(w5, '2026-08-01', '999.00', { voided: true });
    await weighed(w5, '2026-09-01', '270.00');
    await weighed(w5, '2026-09-01', '268.40');
    // Perdió exactamente el 5 % (sin alerta) y un poco más (con alerta).
    const w6 = await animal('W-06', SEX.FEMALE, '2021-01-01');
    await weighed(w6, '2026-06-15', '400.00');
    await weighed(w6, '2026-09-15', '380.00');
    const w7 = await animal('W-07', SEX.FEMALE, '2021-01-01');
    await weighed(w7, '2026-06-15', '400.00');
    await weighed(w7, '2026-09-15', '379.99');
    // Menos de 30 días entre los pesajes: sin ganancia de 90 días.
    const w8 = await animal('W-08', SEX.MALE, '2025-08-01');
    await weighed(w8, '2026-09-01', '250.00');
    await weighed(w8, '2026-09-25', '260.00');

    setToday(SEED_TODAY);
    expect(await vaccineDifferences(edge, SEED_TODAY)).toEqual([]);
    expect(await differences(edge, SEED_TODAY)).toEqual([]);

    // No es una coincidencia en cero: los casos dan lo que se esperaba.
    const shared = await expectedByShared(edge, SEED_TODAY);
    expect(shared.get(w1)).toMatchObject({ gain90Milli: 300, lowGain: false });
    expect(shared.get(w2)).toMatchObject({ gain90Milli: 299, lowGain: true });
    expect(shared.get(w3)?.gain90Milli).not.toBeNull();
    expect(shared.get(w4)?.gain90Milli).toBeNull();
    expect(shared.get(w5)?.gainBirthMilli).not.toBeNull();
    expect(shared.get(w6)).toMatchObject({ weightLoss: false });
    expect(shared.get(w7)).toMatchObject({ weightLoss: true });
    expect(shared.get(w8)?.gain90Milli).toBeNull();
    const statuses = await app
      .get(VaccineStatusService)
      .statusesFor(
        { farmId: edge, userId: adminId, role: ROLE.ADMIN },
        { today: SEED_TODAY, settings: DEFAULT_FARM_SETTINGS },
        [i1, i2, i3, i5],
      );
    const clostridial = (id: string) =>
      statuses.get(id)?.find((status) => status.vaccineId === clostri);
    expect(clostridial(i1)).toMatchObject({ status: 'OVERDUE' });
    expect(clostridial(i2)).toMatchObject({ status: 'UPCOMING', dueOn: '2026-10-10' });
    expect(clostridial(i3)).toMatchObject({ status: 'UP_TO_DATE' });
    expect(clostridial(i5)).toMatchObject({ status: 'UP_TO_DATE', dueOn: '2027-01-10' });

    // Con el ciclo en curso cerrado, otra vez.
    setToday(toIsoDate('2026-11-15'));
    expect(await vaccineDifferences(edge, toIsoDate('2026-11-15'))).toEqual([]);
    expect(await differences(edge, toIsoDate('2026-11-15'))).toEqual([]);
    setToday(SEED_TODAY);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import { createSeedClient, type SeedClient } from '../prisma/seed/client.js';
import { databaseChecksum } from '../prisma/seed/checksum.js';
import {
  EXPECTED_BIRTHS_2026,
  EXPECTED_CATALOG,
  EXPECTED_EXITS,
  EXPECTED_INVENTORY,
  EXPECTED_LOTS,
  EXPECTED_REPRODUCTION,
  EXPECTED_VACCINES_AT_SECOND_DATE,
  EXPECTED_VACCINES_TODAY,
  SECOND_EVALUATION,
  type VaccineTally,
} from '../prisma/seed/expected.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { resetFarmData } from '../prisma/seed/write.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { testDatabaseUrl } from './test-env.js';

/**
 * El seed contra PostgreSQL de verdad.
 *
 * Las cifras se comprueban con **SQL directo**, no con las funciones de dominio: el seed ya
 * se verifica a sí mismo con `@hato/shared` antes de escribir (`verify.ts`), así que
 * repetir ese cálculo aquí no probaría nada. Reimplementar las reglas en SQL es justamente
 * lo que detecta una diferencia entre lo que el dominio calcula y lo que la base contiene.
 *
 * La regla de meses cumplidos es la de ADR-002 (con recorte a fin de mes), no la de
 * `age()` de PostgreSQL, que trata distinto el paso de un 31 a un mes de 30 días.
 */

const PASSWORD = 'contraseña-de-prueba-del-seed';

/** Meses cumplidos entre dos columnas `date`, con la convención de ADR-002. */
function monthsBetween(from: string, to: string): Prisma.Sql {
  return Prisma.raw(`
    ((EXTRACT(YEAR FROM ${to})::int * 12 + EXTRACT(MONTH FROM ${to})::int)
      - (EXTRACT(YEAR FROM ${from})::int * 12 + EXTRACT(MONTH FROM ${from})::int)
      - CASE WHEN EXTRACT(DAY FROM ${to})::int >= LEAST(
            EXTRACT(DAY FROM ${from})::int,
            EXTRACT(DAY FROM (date_trunc('month', ${to}) + interval '1 month - 1 day'))::int)
          THEN 0 ELSE 1 END)`);
}

describe('seed de la finca de referencia', () => {
  let prisma: SeedClient;
  let farmId: string;

  const count = async (where: Prisma.Sql): Promise<number> => {
    const rows = await prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS total FROM animals a WHERE a.farm_id = ${farmId}::uuid AND ${where}`,
    );
    return Number(rows[0]?.total ?? -1n);
  };

  const active = Prisma.sql`a.deleted_at IS NULL AND a.exit_type IS NULL`;

  beforeAll(async () => {
    prisma = createSeedClient(testDatabaseUrl());
    const { seed } = await runReferenceSeed(prisma, { password: PASSWORD, today: SEED_TODAY });
    farmId = seed.catalog.farmId;
  }, 120_000);

  afterAll(async () => {
    if (farmId !== undefined) await resetFarmData(prisma, farmId);
    await prisma.$disconnect();
  });

  describe('catálogos', () => {
    it('siembra la finca con sus parámetros', async () => {
      const farm = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
      expect(farm.name).toBe('Finca La Esperanza');
      expect(farm.municipality).toBe('San Juan Nepomuceno');
      expect(farm.settings).toMatchObject({
        weaningAgeMonths: 7,
        gestationDays: 285,
        minBreedingAgeMonths: 15,
        rabiesRiskZone: true,
        calfCodePattern: '{YY}-{NNN}',
      });
    });

    it('siembra usuarios, razas, vacunas, ciclos, lotes y etiquetas', async () => {
      expect(await prisma.membership.count({ where: { farmId } })).toBe(EXPECTED_CATALOG.users);
      expect(await prisma.breed.count({ where: { farmId } })).toBe(EXPECTED_CATALOG.breeds);
      expect(await prisma.vaccine.count({ where: { farmId } })).toBe(EXPECTED_CATALOG.vaccines);
      expect(await prisma.vaccinationCycle.count({ where: { farmId } })).toBe(
        EXPECTED_CATALOG.cycles,
      );
      expect(await prisma.lot.count({ where: { farmId } })).toBe(EXPECTED_CATALOG.lots);
      expect(await prisma.tag.count({ where: { farmId } })).toBe(EXPECTED_CATALOG.tags);
    });

    it('guarda la gestación de cada raza según su grupo (08 §1.4)', async () => {
      const breeds = await prisma.breed.findMany({
        where: { farmId, name: { in: ['Brahman', 'Romosinuano', 'Girolando'] } },
        orderBy: { name: 'asc' },
      });
      expect(breeds.map((breed) => [breed.name, breed.group, breed.gestationDays])).toEqual([
        ['Brahman', 'INDICUS', 293],
        ['Girolando', 'CROSS', 288],
        ['Romosinuano', 'TAURUS', 283],
      ]);
    });

    it('no guarda la contraseña en claro y usa Argon2id (RNF-06)', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'alvaro' } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(user.email).toBe('alvaro@demo.co');

      const operator = await prisma.user.findUniqueOrThrow({ where: { username: 'wilmer' } });
      expect(operator.email).toBeNull();
    });
  });

  describe('inventario', () => {
    it('cuenta los animales y los activos', async () => {
      expect(await count(Prisma.sql`true`)).toBe(EXPECTED_INVENTORY.total);
      expect(await count(active)).toBe(EXPECTED_INVENTORY.active);
    });

    it('cuenta machos y hembras activos', async () => {
      expect(await count(Prisma.sql`${active} AND a.sex = 'MALE'`)).toBe(EXPECTED_INVENTORY.males);
      expect(await count(Prisma.sql`${active} AND a.sex = 'FEMALE'`)).toBe(
        EXPECTED_INVENTORY.females,
      );
    });

    it('deriva la categoría de manejo de cada animal activo (RN-06)', async () => {
      const rows = await prisma.$queryRaw<{ category: string; total: bigint }[]>(Prisma.sql`
        WITH calvings AS (
          SELECT dam_id, count(*) AS n
          FROM pregnancies
          WHERE farm_id = ${farmId}::uuid AND outcome = 'CALVED' AND voided_at IS NULL
          GROUP BY dam_id
        ),
        classified AS (
          SELECT a.sex,
                 coalesce(c.n, 0) AS calving_count,
                 ${monthsBetween('a.birth_date', `DATE '${SEED_TODAY}'`)} AS months
          FROM animals a
          LEFT JOIN calvings c ON c.dam_id = a.id
          WHERE a.farm_id = ${farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL
        )
        SELECT CASE
                 WHEN months < 7 AND sex = 'MALE' THEN 'CALF_MALE'
                 WHEN months < 7 THEN 'CALF_FEMALE'
                 WHEN sex = 'FEMALE' AND calving_count >= 1 THEN 'COW'
                 WHEN sex = 'FEMALE' THEN 'HEIFER'
                 WHEN months < 24 THEN 'YOUNG_MALE'
                 ELSE 'ADULT_MALE'
               END AS category,
               count(*)::bigint AS total
        FROM classified GROUP BY 1`);

      const actual = Object.fromEntries(rows.map((row) => [row.category, Number(row.total)]));
      expect(actual).toEqual(EXPECTED_INVENTORY.category);
    });

    it('reparte los animales activos entre los cuatro lotes', async () => {
      const rows = await prisma.$queryRaw<{ name: string; total: bigint }[]>(Prisma.sql`
        SELECT l.name, count(*)::bigint AS total
        FROM animals a JOIN lots l ON l.id = a.lot_id
        WHERE a.farm_id = ${farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL
        GROUP BY l.name`);
      expect(Object.fromEntries(rows.map((row) => [row.name, Number(row.total)]))).toEqual(
        EXPECTED_LOTS,
      );
    });

    it('da a cada animal un código único y el patrón {YY}-{NNN} a los nacidos en 2026', async () => {
      const [row] = await prisma.$queryRaw<{ total: bigint; distinct: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS total, count(DISTINCT code)::bigint AS distinct
        FROM animals WHERE farm_id = ${farmId}::uuid`);
      expect(Number(row?.distinct)).toBe(Number(row?.total));

      const born2026 = await prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
        SELECT code FROM animals
        WHERE farm_id = ${farmId}::uuid AND EXTRACT(YEAR FROM birth_date) = 2026
        ORDER BY code LIMIT 1`);
      expect(born2026[0]?.code).toMatch(/^26-\d{3}$/);
    });
  });

  describe('reproducción', () => {
    const openPregnancy = (confirmed: boolean): Prisma.Sql => Prisma.sql`
      EXISTS (SELECT 1 FROM pregnancies p
              WHERE p.dam_id = a.id AND p.outcome = 'PENDING' AND p.voided_at IS NULL
                AND p.confirmed_at IS ${confirmed ? Prisma.raw('NOT NULL') : Prisma.raw('NULL')})`;

    it('cuenta preñadas y servidas sin diagnóstico (RN-08)', async () => {
      expect(await count(Prisma.sql`${active} AND ${openPregnancy(true)}`)).toBe(
        EXPECTED_REPRODUCTION.pregnant,
      );
      expect(await count(Prisma.sql`${active} AND ${openPregnancy(false)}`)).toBe(
        EXPECTED_REPRODUCTION.served,
      );
    });

    it('cuenta las servidas con más de 90 días sin palpar', async () => {
      const total = await count(Prisma.sql`
        ${active} AND EXISTS (
          SELECT 1 FROM pregnancies p
          WHERE p.dam_id = a.id AND p.outcome = 'PENDING' AND p.voided_at IS NULL
            AND p.confirmed_at IS NULL
            AND (DATE '${Prisma.raw(SEED_TODAY)}' - p.service_date) > 90)`);
      expect(total).toBe(EXPECTED_REPRODUCTION.servedOver90Days);
    });

    it('cuenta las horras (RN-25)', async () => {
      const total = await count(Prisma.sql`
        ${active}
        AND a.sex = 'FEMALE'
        AND NOT EXISTS (SELECT 1 FROM pregnancies p
                        WHERE p.dam_id = a.id AND p.outcome = 'PENDING' AND p.voided_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM pregnancies p
          WHERE p.dam_id = a.id AND p.outcome = 'CALVED' AND p.voided_at IS NULL
          HAVING ${monthsBetween('max(p.outcome_date)', `DATE '${SEED_TODAY}'`)} >= 7)`);
      expect(total).toBe(EXPECTED_REPRODUCTION.dry);
    });

    it('cuenta las paridas y las que tienen cría al pie (RN-07)', async () => {
      expect(
        await count(Prisma.sql`
          ${active} AND EXISTS (SELECT 1 FROM pregnancies p
                                WHERE p.dam_id = a.id AND p.outcome = 'CALVED'
                                  AND p.voided_at IS NULL)`),
      ).toBe(EXPECTED_REPRODUCTION.calved);

      expect(
        await count(Prisma.sql`
          ${active} AND EXISTS (
            SELECT 1 FROM animals c
            WHERE c.dam_id = a.id AND c.deleted_at IS NULL AND c.exit_type IS NULL
              AND ${monthsBetween('c.birth_date', `DATE '${SEED_TODAY}'`)} < 7)`),
      ).toBe(EXPECTED_REPRODUCTION.withCalfAtFoot);
    });

    it('cuenta los partos previstos dentro de la ventana de alerta', async () => {
      const [row] = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS total FROM pregnancies p
        WHERE p.farm_id = ${farmId}::uuid AND p.outcome = 'PENDING' AND p.voided_at IS NULL
          AND p.confirmed_at IS NOT NULL
          AND p.expected_calving_date <= DATE '${Prisma.raw(SEED_TODAY)}' + 30`);
      expect(Number(row?.total)).toBe(EXPECTED_REPRODUCTION.calvingsDueSoon);
    });

    it('no deja ninguna hembra con dos preñeces abiertas (RN-03)', async () => {
      const rows = await prisma.$queryRaw<{ dam_id: string }[]>(Prisma.sql`
        SELECT dam_id FROM pregnancies
        WHERE farm_id = ${farmId}::uuid AND outcome = 'PENDING' AND voided_at IS NULL
        GROUP BY dam_id HAVING count(*) > 1`);
      expect(rows).toEqual([]);
    });

    it('calcula la fecha estimada de parto con la gestación de la raza de la madre (RN-04)', async () => {
      const rows = await prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
        SELECT a.code FROM pregnancies p
        JOIN animals a ON a.id = p.dam_id
        JOIN breeds b ON b.id = a.breed_id
        WHERE p.farm_id = ${farmId}::uuid
          AND (p.expected_calving_date - p.service_date) <> b.gestation_days
        LIMIT 5`);
      expect(rows).toEqual([]);
    });

    it('enlaza las crías con la preñez de la que nacieron y registra los mellizos (RN-05)', async () => {
      const [row] = await prisma.$queryRaw<{ twins: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS twins FROM (
          SELECT birth_pregnancy_id FROM animals
          WHERE farm_id = ${farmId}::uuid AND birth_pregnancy_id IS NOT NULL
          GROUP BY birth_pregnancy_id HAVING count(*) = 2) AS t`);
      expect(Number(row?.twins)).toBe(2);
    });

    it('guarda los partos anteriores a 2024 como preñeces importadas sin crías (RN-29)', async () => {
      const [row] = await prisma.$queryRaw<{ total: bigint; withCalves: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS total,
               count(*) FILTER (
                 WHERE EXISTS (SELECT 1 FROM animals c WHERE c.birth_pregnancy_id = p.id)
               )::bigint AS "withCalves"
        FROM pregnancies p
        WHERE p.farm_id = ${farmId}::uuid AND p.is_imported`);
      expect(Number(row?.total)).toBeGreaterThan(0);
      expect(Number(row?.withCalves)).toBe(0);
    });
  });

  describe('nacimientos y salidas', () => {
    it('cuenta los nacidos vivos de 2026 sin importar si ya salieron (NAC-01)', async () => {
      const born = Prisma.sql`EXTRACT(YEAR FROM a.birth_date) = 2026`;
      expect(await count(born)).toBe(EXPECTED_BIRTHS_2026.live);
      expect(await count(Prisma.sql`${born} AND a.sex = 'MALE'`)).toBe(
        EXPECTED_BIRTHS_2026.liveMales,
      );
      expect(await count(Prisma.sql`${born} AND a.sex = 'FEMALE'`)).toBe(
        EXPECTED_BIRTHS_2026.liveFemales,
      );
    });

    it('cuenta las crías muertas al nacer aparte, sin ficha ni sexo', async () => {
      const [row] = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT coalesce(sum(stillborn_count), 0)::bigint AS total FROM pregnancies
        WHERE farm_id = ${farmId}::uuid AND voided_at IS NULL
          AND EXTRACT(YEAR FROM outcome_date) = 2026`);
      expect(Number(row?.total)).toBe(EXPECTED_BIRTHS_2026.stillborn);
    });

    it('cuenta vendidos, muertos y disponibles para venta', async () => {
      expect(await count(Prisma.sql`a.exit_type = 'SALE'`)).toBe(EXPECTED_EXITS.sold);
      expect(await count(Prisma.sql`a.exit_type = 'DEATH'`)).toBe(EXPECTED_EXITS.dead);
      expect(await count(Prisma.sql`${active} AND a.for_sale`)).toBe(EXPECTED_EXITS.forSale);
    });

    it('registra una venta por cada animal vendido, con su monto', async () => {
      const [row] = await prisma.$queryRaw<{ sales: bigint; orphan: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS sales,
               count(*) FILTER (WHERE a.exit_type <> 'SALE')::bigint AS orphan
        FROM sales s JOIN animals a ON a.id = s.animal_id
        WHERE s.farm_id = ${farmId}::uuid AND s.voided_at IS NULL`);
      expect(Number(row?.sales)).toBe(EXPECTED_EXITS.sold);
      expect(Number(row?.orphan)).toBe(0);
    });
  });

  describe('vacunación', () => {
    /** Ciclo vigente y último cerrado en una fecha, como los calcula RN-13. */
    const cycleFor = (date: string): Prisma.Sql => Prisma.sql`
      SELECT * FROM (
        SELECT c.*, 1 AS rank FROM vaccination_cycles c
        WHERE c.farm_id = ${farmId}::uuid
          AND DATE '${Prisma.raw(date)}' BETWEEN c.starts_on AND c.ends_on
        UNION ALL
        SELECT c.*, 2 AS rank FROM vaccination_cycles c
        WHERE c.farm_id = ${farmId}::uuid AND c.ends_on < DATE '${Prisma.raw(date)}'
        ORDER BY rank, ends_on DESC LIMIT 1) AS cycle`;

    const officialTally = async (vaccine: string, date: string): Promise<VaccineTally> => {
      const rows = await prisma.$queryRaw<{ status: string; total: bigint }[]>(Prisma.sql`
        WITH cycle AS (${cycleFor(date)}),
        v AS (SELECT id FROM vaccines WHERE farm_id = ${farmId}::uuid AND name = ${vaccine})
        SELECT CASE
                 WHEN GREATEST(a.birth_date, a.entry_date) > cycle.ends_on THEN 'notApplicable'
                 WHEN EXISTS (
                   SELECT 1 FROM vaccination_records r
                   WHERE r.animal_id = a.id AND r.vaccine_id = (SELECT id FROM v)
                     AND r.voided_at IS NULL
                     AND r.applied_on BETWEEN cycle.starts_on AND cycle.ends_on
                 ) THEN 'upToDate'
                 WHEN DATE '${Prisma.raw(date)}' BETWEEN cycle.starts_on AND cycle.ends_on
                   THEN 'pending'
                 ELSE 'overdue'
               END AS status,
               count(*)::bigint AS total
        FROM animals a CROSS JOIN cycle
        WHERE a.farm_id = ${farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL
        GROUP BY 1`);
      return toTally(rows);
    };

    const ageWindowTally = async (vaccine: string, date: string): Promise<VaccineTally> => {
      const rows = await prisma.$queryRaw<{ status: string; total: bigint }[]>(Prisma.sql`
        WITH v AS (SELECT * FROM vaccines WHERE farm_id = ${farmId}::uuid AND name = ${vaccine})
        SELECT CASE
                 WHEN v.eligible_sex IS NOT NULL AND a.sex <> v.eligible_sex THEN 'notApplicable'
                 WHEN EXISTS (
                   SELECT 1 FROM vaccination_records r
                   WHERE r.animal_id = a.id AND r.vaccine_id = v.id AND r.voided_at IS NULL
                 ) THEN 'upToDate'
                 WHEN (DATE '${Prisma.raw(date)}' - a.birth_date) < v.min_age_days
                   THEN 'notApplicable'
                 WHEN (DATE '${Prisma.raw(date)}' - a.birth_date) > v.max_age_days
                   THEN 'overdue'
                 ELSE 'pending'
               END AS status,
               count(*)::bigint AS total
        FROM animals a CROSS JOIN v
        WHERE a.farm_id = ${farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL
        GROUP BY 1`);
      return toTally(rows);
    };

    const intervalTally = async (
      vaccine: string,
      date: string,
      alertDays: number,
    ): Promise<VaccineTally> => {
      const rows = await prisma.$queryRaw<{ status: string; total: bigint }[]>(Prisma.sql`
        WITH v AS (SELECT * FROM vaccines WHERE farm_id = ${farmId}::uuid AND name = ${vaccine}),
        last AS (
          SELECT DISTINCT ON (r.animal_id) r.animal_id, r.applied_on, r.next_due_on
          FROM vaccination_records r CROSS JOIN v
          WHERE r.vaccine_id = v.id AND r.voided_at IS NULL
          ORDER BY r.animal_id, r.applied_on DESC
        )
        SELECT CASE
                 WHEN last.animal_id IS NULL
                   AND (DATE '${Prisma.raw(date)}' - a.birth_date) < v.min_age_days
                   THEN 'notApplicable'
                 WHEN last.animal_id IS NULL THEN 'pending'
                 WHEN coalesce(last.next_due_on, last.applied_on + v.booster_interval_days)
                      < DATE '${Prisma.raw(date)}' THEN 'overdue'
                 WHEN coalesce(last.next_due_on, last.applied_on + v.booster_interval_days)
                      <= DATE '${Prisma.raw(date)}' + ${alertDays}::int THEN 'upcoming'
                 ELSE 'upToDate'
               END AS status,
               count(*)::bigint AS total
        FROM animals a CROSS JOIN v LEFT JOIN last ON last.animal_id = a.id
        WHERE a.farm_id = ${farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL
        GROUP BY 1`);
      return toTally(rows);
    };

    function toTally(rows: readonly { status: string; total: bigint }[]): VaccineTally {
      const tally = { upToDate: 0, pending: 0, overdue: 0, upcoming: 0, notApplicable: 0 };
      for (const row of rows) {
        tally[row.status as keyof VaccineTally] = Number(row.total);
      }
      return tally;
    }

    const cases = [
      { date: SEED_TODAY, expected: EXPECTED_VACCINES_TODAY, label: 'sin ciclo abierto' },
      {
        date: SECOND_EVALUATION,
        expected: EXPECTED_VACCINES_AT_SECOND_DATE,
        label: 'con el ciclo 2026-2 abierto',
      },
    ] as const;

    for (const { date, expected, label } of cases) {
      it(`resuelve el estado de aftosa y rabia el ${date} (${label}, RN-13 y ADR-004)`, async () => {
        for (const vaccine of ['Aftosa', 'Rabia silvestre']) {
          expect({ vaccine, ...(await officialTally(vaccine, date)) }).toEqual({
            vaccine,
            ...expected[vaccine],
          });
        }
      });

      it(`resuelve el estado de la brucelosis el ${date} (ventana de edad)`, async () => {
        const vaccine = 'Brucelosis RB51';
        expect(await ageWindowTally(vaccine, date)).toEqual(expected[vaccine]);
      });

      it(`resuelve el estado de la clostridial el ${date} (intervalo)`, async () => {
        const vaccine = 'Clostridial polivalente';
        expect(await intervalTally(vaccine, date, 15)).toEqual(expected[vaccine]);
      });
    }

    it('no registra brucelosis en ningún macho (RN-26)', async () => {
      const [row] = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS total
        FROM vaccination_records r
        JOIN animals a ON a.id = r.animal_id
        JOIN vaccines v ON v.id = r.vaccine_id
        WHERE r.farm_id = ${farmId}::uuid AND v.name = 'Brucelosis RB51' AND a.sex = 'MALE'`);
      expect(Number(row?.total)).toBe(0);
    });

    it('guarda el número de RUV de las vacunas de ciclo oficial', async () => {
      const [row] = await prisma.$queryRaw<{ withRuv: bigint; total: bigint }[]>(Prisma.sql`
        SELECT count(*) FILTER (WHERE r.ruv_number IS NOT NULL)::bigint AS "withRuv",
               count(*)::bigint AS total
        FROM vaccination_records r
        WHERE r.farm_id = ${farmId}::uuid AND r.cycle_id IS NOT NULL`);
      expect(Number(row?.total)).toBeGreaterThan(0);
      expect(Number(row?.withRuv)).toBe(Number(row?.total));
    });
  });

  describe('pesos, gastos y auditoría de las reglas', () => {
    it('pesa con cinta, nunca con báscula (08 §1.7)', async () => {
      const rows = await prisma.$queryRaw<{ method: string }[]>(Prisma.sql`
        SELECT DISTINCT method::text FROM weight_records WHERE farm_id = ${farmId}::uuid`);
      expect(rows.map((row) => row.method)).toEqual(['TAPE']);
    });

    it('reparte cada gasto compartido exactamente por su monto (RN-17)', async () => {
      const rows = await prisma.$queryRaw<{ description: string }[]>(Prisma.sql`
        SELECT e.description
        FROM expenses e
        JOIN expense_allocations al ON al.expense_id = e.id
        WHERE e.farm_id = ${farmId}::uuid
        GROUP BY e.id, e.description, e.amount
        HAVING sum(al.amount) <> e.amount`);
      expect(rows).toEqual([]);
    });

    it('no deja ningún evento anterior al nacimiento ni posterior a hoy (RN-14)', async () => {
      const [row] = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        WITH events AS (
          SELECT animal_id, applied_on AS on_date FROM vaccination_records
            WHERE farm_id = ${farmId}::uuid
          UNION ALL
          SELECT animal_id, weighed_on FROM weight_records WHERE farm_id = ${farmId}::uuid
          UNION ALL
          SELECT animal_id, started_on FROM treatment_records WHERE farm_id = ${farmId}::uuid
          UNION ALL
          SELECT animal_id, assigned_at FROM identifiers WHERE farm_id = ${farmId}::uuid
        )
        SELECT count(*)::bigint AS total
        FROM events e JOIN animals a ON a.id = e.animal_id
        WHERE e.on_date < a.birth_date OR e.on_date > DATE '${Prisma.raw(SEED_TODAY)}'`);
      expect(Number(row?.total)).toBe(0);
    });

    it('no deja ninguna cría nacida antes de la edad reproductiva de su madre (RN-23)', async () => {
      const rows = await prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
        SELECT c.code FROM animals c JOIN animals m ON m.id = c.dam_id
        WHERE c.farm_id = ${farmId}::uuid
          AND ${monthsBetween('m.birth_date', 'c.birth_date')} < 15
        LIMIT 5`);
      expect(rows).toEqual([]);
    });

    it('solo tiene madres hembras y padres machos (RN-02)', async () => {
      const rows = await prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
        SELECT a.code FROM animals a
        LEFT JOIN animals m ON m.id = a.dam_id
        LEFT JOIN animals s ON s.id = a.sire_id
        WHERE a.farm_id = ${farmId}::uuid
          AND (m.sex = 'MALE' OR s.sex = 'FEMALE')
        LIMIT 5`);
      expect(rows).toEqual([]);
    });
  });

  describe('determinismo', () => {
    it('deja la base idéntica al volver a sembrar, identificadores incluidos', async () => {
      const before = await databaseChecksum(prisma);
      await runReferenceSeed(prisma, { password: PASSWORD, today: SEED_TODAY });
      const after = await databaseChecksum(prisma);

      // Se comparan tabla por tabla para que el fallo diga cuál cambió.
      expect(Object.fromEntries(after.perTable)).toEqual(Object.fromEntries(before.perTable));
      expect(after.overall).toBe(before.overall);
    }, 120_000);

    it('se puede repetir aunque los usuarios de demostración hayan iniciado sesión', async () => {
      // Una sesión abierta y un intento fallido, como los que dejan las pruebas de la web.
      const alvaro = await prisma.user.findUniqueOrThrow({ where: { username: 'alvaro' } });
      await prisma.refreshToken.create({
        data: {
          id: '0190a000-0000-7000-8000-00000000abcd',
          userId: alvaro.id,
          farmId,
          familyId: '0190a000-0000-7000-8000-00000000abce',
          tokenHash: 'hash-de-prueba-del-seed',
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        },
      });
      await prisma.loginAttempt.create({
        data: { login: 'alvaro', ip: '127.0.0.1', succeeded: false },
      });

      await runReferenceSeed(prisma, { password: PASSWORD, today: SEED_TODAY });

      expect(await prisma.refreshToken.count({ where: { userId: alvaro.id } })).toBe(0);
      expect(await prisma.loginAttempt.count({ where: { login: 'alvaro' } })).toBe(0);
    }, 120_000);
  });
});

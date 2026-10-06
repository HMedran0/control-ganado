import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ANIMAL_ALERT,
  PRODUCTION_SYSTEM,
  addDays,
  daysBetween,
  herdCalvingIntervals,
  systemQuestions,
  toIsoDate,
  type AlertsResponse,
  type AnimalList,
  type AnimalListItem,
  type AnimalWeights,
  type DashboardResponse,
  type ProductionSystem,
} from '@hato/shared';
import request from 'supertest';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import {
  EXPECTED_BIRTHS_2026,
  EXPECTED_DASHBOARD,
  EXPECTED_EXITS,
  EXPECTED_FINANCE,
  EXPECTED_INVENTORY,
  EXPECTED_REPRODUCTION,
  EXPECTED_RETIRO,
  EXPECTED_WEIGHT_ALERTS,
} from '../prisma/seed/expected.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { fromPrismaDateOrNull } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken, type FakeClock } from './helpers/app.js';
import { cleanDatabase } from './helpers/fixtures.js';

/**
 * Tablero de Inicio (RPT-01, CFG-03, PES-05, PES-06, RN-38; M8a) sobre la finca de referencia,
 * doble propósito, y El Retiro, levante y ceba:
 *
 * - las cifras de `expected.ts`;
 * - cada cifra es el total del listado filtrado (o del conteo de Alertas) al que enlaza la web
 *   (verificación de M8 en el 07);
 * - el intervalo entre partos, el peso de destete, los lotes y los días para la venta coinciden con
 *   lo que calcula shared (ADR-009);
 * - cambiar el sistema productivo cambia las preguntas, no las cifras (CFG-03 CA1);
 * - roles: la inversión solo para el ADMIN (RN-20); otra finca solo ve lo suyo.
 */

const PASSWORD = 'contraseña-de-prueba-del-seed';

describe('GET /dashboard (M8a)', () => {
  let app: NestFastifyApplication;
  let clock: FakeClock;
  let prisma: PrismaService;
  let farmId: string;
  let retiroId: string;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let retiroAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());

  const dashboard = async (headers: Record<string, string>): Promise<DashboardResponse> =>
    (await http().get('/api/v1/dashboard').set(headers).expect(200)).body as DashboardResponse;

  const total = async (query: string, headers: Record<string, string>): Promise<number> =>
    (
      (await http().get(`/api/v1/animals?limit=1&${query}`).set(headers).expect(200))
        .body as AnimalList
    ).total;

  const all = async (query: string, headers: Record<string, string>): Promise<AnimalListItem[]> => {
    const items: AnimalListItem[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/v1/animals?limit=100&${query}${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = (await http().get(url).set(headers).expect(200)).body as AnimalList;
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
  };

  const alertCount = async (query: string, headers: Record<string, string>): Promise<number> =>
    (
      (await http().get(`/api/v1/alerts?limit=1&${query}`).set(headers).expect(200))
        .body as AlertsResponse
    ).total;

  const setSystem = async (
    target: string,
    headers: Record<string, string>,
    productionSystem: ProductionSystem,
  ): Promise<void> => {
    const farm = await prisma.farm.findUniqueOrThrow({ where: { id: target } });
    await http()
      .patch('/api/v1/farm')
      .set(headers)
      .send({ version: farm.version, settings: { productionSystem } })
      .expect(200);
  };

  beforeAll(async () => {
    ({ app, clock } = await createTestAppWithClock());
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const { seed, retiro } = await runReferenceSeed(prisma, {
      password: PASSWORD,
      today: SEED_TODAY,
    });
    farmId = seed.catalog.farmId;
    retiroId = retiro.farmId;
    const token = async (username: string, farm: string) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username } });
      return bearer(await signTestToken(app, { userId: user.id, farmId: farm }));
    };
    admin = await token('alvaro', farmId);
    operator = await token('wilmer', farmId);
    vet = await token('paola.vet', farmId);
    retiroAdmin = await token('retiro.admin', retiroId);
  }, 180_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('La Esperanza, doble propósito', () => {
    it('las cifras comunes de expected.ts', async () => {
      const body = await dashboard(admin);
      expect(body.today).toBe(SEED_TODAY);
      expect(body.productionSystem).toBe('DOBLE_PROPOSITO');
      expect(body.salesFocus).toBeNull();
      expect(body.herd).toEqual({
        total: EXPECTED_INVENTORY.active,
        males: EXPECTED_INVENTORY.males,
        females: EXPECTED_INVENTORY.females,
        calvesMale: EXPECTED_INVENTORY.category.CALF_MALE,
        calvesFemale: EXPECTED_INVENTORY.category.CALF_FEMALE,
      });
      expect(body.reproduction).toMatchObject({
        pregnant: EXPECTED_REPRODUCTION.pregnant,
        served: EXPECTED_REPRODUCTION.served,
        calvingSoon: EXPECTED_REPRODUCTION.calvingsDueSoon,
        calvingOverdue: EXPECTED_REPRODUCTION.calvingsOverdue,
      });
      expect(body.births).toEqual({
        from: '2026-01-01',
        to: SEED_TODAY,
        live: EXPECTED_BIRTHS_2026.live,
        males: EXPECTED_BIRTHS_2026.liveMales,
        females: EXPECTED_BIRTHS_2026.liveFemales,
      });
      expect(body.forSale).toEqual({ count: EXPECTED_EXITS.forSale, sex: null });
      expect(body.alerts[ANIMAL_ALERT.LOW_GAIN]).toBe(EXPECTED_WEIGHT_ALERTS.lowGain);
      expect(body.alerts[ANIMAL_ALERT.WEIGHT_LOSS]).toBe(EXPECTED_WEIGHT_ALERTS.weightLoss);
      // Ningún ciclo oficial está en curso el 25/09/2026 (el 2026-2 empieza el 01/11).
      expect(body.vaccines.currentCycle).toBeNull();
      expect(body.investment).toBe(EXPECTED_FINANCE.herdInvestment);
    });

    it('las preguntas de cría y el retiro de leche, con sus cifras', async () => {
      const body = await dashboard(admin);
      expect(body.questions).toEqual(systemQuestions(PRODUCTION_SYSTEM.DOBLE_PROPOSITO));
      expect(body.weaning).toEqual(EXPECTED_DASHBOARD.esperanza.weaning);
      expect(body.dryCows).toEqual({ count: EXPECTED_REPRODUCTION.dry });
      expect(body.milkWithdrawal).toEqual({ count: EXPECTED_DASHBOARD.esperanza.milkWithdrawal });
      expect(body.calvingInterval).toEqual(EXPECTED_DASHBOARD.esperanza.calvingInterval);
      // Las de ceba no se calculan en doble propósito.
      expect(body).not.toHaveProperty('saleWeight');
      expect(body).not.toHaveProperty('lotGains');
      expect(body).not.toHaveProperty('daysToSale');
    });

    it('cada cifra es el total del listado o de Alertas al que enlaza', async () => {
      const body = await dashboard(operator);
      const h = operator;
      expect(await total('', h)).toBe(body.herd.total);
      expect(await total('sex=MALE', h)).toBe(body.herd.males);
      expect(await total('sex=FEMALE', h)).toBe(body.herd.females);
      expect(await total('category=CALF_MALE', h)).toBe(body.herd.calvesMale);
      expect(await total('category=CALF_FEMALE', h)).toBe(body.herd.calvesFemale);
      expect(await total('tags=PREGNANT', h)).toBe(body.reproduction.pregnant);
      expect(await total('tags=SERVED', h)).toBe(body.reproduction.served);
      expect(await total('alerts=calving_soon&sort=calving', h)).toBe(
        body.reproduction.calvingSoon,
      );
      expect(await total('forSale=true', h)).toBe(body.forSale.count);
      expect(await total('tags=DRY', h)).toBe(body.dryCows?.count);
      expect(await total('milkWithdrawal=true', h)).toBe(body.milkWithdrawal?.count);
      const weaning = body.weaning;
      expect(weaning).toBeDefined();
      expect(await total(`bornFrom=${weaning?.bornFrom}&bornTo=${weaning?.bornTo}`, h)).toBe(
        weaning?.count,
      );
      for (const alert of Object.values(ANIMAL_ALERT)) {
        expect(await alertCount(`types=${alert}`, h), alert).toBe(body.alerts[alert]);
      }
      expect(body.vaccines.overdue).toBe(body.alerts[ANIMAL_ALERT.VACCINE_OVERDUE]);
      expect(body.vaccines.due).toBe(body.alerts[ANIMAL_ALERT.VACCINE_DUE]);
      // Nacidos del año: el reporte de nacimientos con su período por defecto.
      const births = await http().get('/api/v1/reports/births').set(h).expect(200);
      expect(births.body.totals).toMatchObject({
        live: body.births.live,
        males: body.births.males,
        females: body.births.females,
      });
    });

    it('la próxima en parir es la primera del listado ordenado por parto estimado', async () => {
      const body = await dashboard(vet);
      const soon = await all('alerts=calving_soon&sort=calving', vet);
      expect(body.reproduction.nextCalving).toEqual({
        animalId: soon[0]?.id,
        code: soon[0]?.code,
        expectedCalvingDate: soon[0]?.expectedCalvingDate,
      });
    });

    it('el peso de destete es el promedio del último pesaje de los que se destetan este mes', async () => {
      const body = await dashboard(admin);
      const calves = await all(
        `bornFrom=${body.weaning?.bornFrom}&bornTo=${body.weaning?.bornTo}`,
        admin,
      );
      const weighed = calves.flatMap((item) =>
        item.lastWeight === null ? [] : [item.lastWeight.weightKg],
      );
      expect(body.weaning?.weighed).toBe(weighed.length);
      const average =
        weighed.length === 0
          ? null
          : Math.round((weighed.reduce((sum, kg) => sum + kg, 0) / weighed.length) * 10) / 10;
      expect(body.weaning?.averageWeightKg).toBe(average);
    });

    it('RN-38: el intervalo entre partos coincide con herdCalvingIntervals de shared', async () => {
      const body = await dashboard(admin);
      const females = await prisma.animal.findMany({
        where: { farmId, sex: 'FEMALE', deletedAt: null, exitType: null },
        include: { pregnancies: true },
      });
      const expected = herdCalvingIntervals(
        females.map((female) =>
          female.pregnancies.map((pregnancy) => ({
            outcome: pregnancy.outcome,
            outcomeDate: fromPrismaDateOrNull(pregnancy.outcomeDate),
            serviceDateEstimated: pregnancy.serviceDateEstimated,
            voided: pregnancy.voidedAt !== null,
          })),
        ),
      );
      expect(body.calvingInterval).toEqual(expected);
      // No es una coincidencia en cero.
      expect(expected.count).toBeGreaterThan(50);
    });
  });

  describe('roles y fincas', () => {
    it('OPERATOR y VET ven las mismas cifras, sin la inversión (RN-20)', async () => {
      const full = await dashboard(admin);
      const { investment: _investment, ...rest } = full;
      for (const headers of [operator, vet]) {
        const body = await dashboard(headers);
        expect(body).not.toHaveProperty('investment');
        expect(body).toEqual(rest);
      }
    });

    it('El Retiro solo ve lo suyo, y La Esperanza no ve nada de El Retiro', async () => {
      const retiro = await dashboard(retiroAdmin);
      expect(retiro.herd.total).toBe(EXPECTED_RETIRO.active);
      expect(retiro.productionSystem).toBe('LEVANTE_CEBA');
      const esperanza = await dashboard(admin);
      expect(esperanza.herd.total).toBe(EXPECTED_INVENTORY.active);
      // El Retiro no tiene gastos: su inversión es cero, no la de La Esperanza.
      expect(retiro.investment).toBe('0.00');
    });

    it('sin sesión: 401', async () => {
      await http().get('/api/v1/dashboard').expect(401);
    });
  });

  describe('El Retiro, levante y ceba (PES-05, PES-06)', () => {
    it('las preguntas de ceba con sus cifras, centradas en los machos', async () => {
      const body = await dashboard(retiroAdmin);
      expect(body.questions).toEqual(systemQuestions(PRODUCTION_SYSTEM.LEVANTE_CEBA));
      expect(body.salesFocus).toBe('MALES');
      expect(body.forSale.sex).toBe('MALE');
      expect(body.saleWeight).toEqual(EXPECTED_DASHBOARD.retiro.saleWeight);
      expect(body.daysToSale).toEqual(EXPECTED_DASHBOARD.retiro.daysToSale);
      const withoutId = (lots: readonly { lotId: string }[] | undefined) =>
        (lots ?? []).map(({ lotId: _lotId, ...lot }) => lot);
      expect({
        belowThreshold: withoutId(body.lotGains?.belowThreshold),
        others: withoutId(body.lotGains?.others),
      }).toEqual(EXPECTED_DASHBOARD.retiro.lotGains);
      expect(body).not.toHaveProperty('weaning');
      expect(body).not.toHaveProperty('calvingInterval');
    });

    it('cada situación de peso de venta es el total de su filtro', async () => {
      const body = await dashboard(retiroAdmin);
      const sale = body.saleWeight;
      expect(sale?.monthEnd).toBe('2026-09-30');
      expect(await total('saleWeight=reached', retiroAdmin)).toBe(sale?.reached);
      expect(await total('saleWeight=this_month', retiroAdmin)).toBe(sale?.thisMonth);
      expect(await total('saleWeight=likely_reached', retiroAdmin)).toBe(sale?.likelyReached);
      expect(await total('saleWeight=later', retiroAdmin)).toBe(sale?.later);
      expect(await total('forSale=true&sex=MALE', retiroAdmin)).toBe(body.forSale.count);
      // Los casos sembrados: 41, 42 y 44 (mayor de 24 meses) este mes; el 48, reproductor, no.
      const month = await all('saleWeight=this_month', retiroAdmin);
      expect(month.map((item) => item.code)).toEqual(expect.arrayContaining(['41', '42', '44']));
      const reached = await all('saleWeight=reached', retiroAdmin);
      expect(reached.map((item) => item.code)).toContain('43');
      expect(reached.map((item) => item.code)).not.toContain('48');
      const likely = await all('saleWeight=likely_reached', retiroAdmin);
      expect(likely.map((item) => item.code)).toContain('45');
    });

    it('días para la venta y lotes: lo mismo que la ficha de cada animal (shared)', async () => {
      const body = await dashboard(retiroAdmin);
      const weightsOf = async (id: string) =>
        (await http().get(`/api/v1/animals/${id}/weights`).set(retiroAdmin).expect(200))
          .body as AnimalWeights;

      const upcoming = [
        ...(await all('saleWeight=this_month', retiroAdmin)),
        ...(await all('saleWeight=later', retiroAdmin)),
      ];
      const days: number[] = [];
      for (const item of upcoming) {
        const estimated = (await weightsOf(item.id)).summary.saleWeight?.estimatedOn;
        expect(estimated, item.code).toBeTruthy();
        days.push(daysBetween(SEED_TODAY, toIsoDate(estimated ?? SEED_TODAY)));
      }
      expect(body.daysToSale).toEqual({
        animals: days.length,
        averageDays:
          days.length === 0
            ? null
            : Math.round(days.reduce((sum, value) => sum + value, 0) / days.length),
      });

      const lots = [...(body.lotGains?.belowThreshold ?? []), ...(body.lotGains?.others ?? [])];
      expect(lots.length).toBeGreaterThan(0);
      for (const lot of lots) {
        expect(await alertCount(`types=low_gain&lotId=${lot.lotId}`, retiroAdmin), lot.name).toBe(
          lot.lowGain,
        );
        const members = await all(`lotId=${lot.lotId}`, retiroAdmin);
        const gains: number[] = [];
        const thresholds: number[] = [];
        for (const member of members) {
          const summary = (await weightsOf(member.id)).summary;
          if (summary.gains.last90Days === null || summary.gainThreshold === null) continue;
          gains.push(Math.round(summary.gains.last90Days * 1000));
          thresholds.push(Math.round(summary.gainThreshold * 1000));
        }
        expect(lot.animals, lot.name).toBe(gains.length);
        const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
        expect(lot.averageGain).toBe(Math.round(sum(gains) / gains.length) / 1000);
        expect(lot.averageThreshold).toBe(Math.round(sum(thresholds) / thresholds.length) / 1000);
        const below = (body.lotGains?.belowThreshold ?? []).some(
          (item) => item.lotId === lot.lotId,
        );
        expect(below, lot.name).toBe(sum(gains) < sum(thresholds));
      }
      expect(body.lotGains?.belowThreshold.map((lot) => lot.name)).toEqual(['Ceba B']);
    });
  });

  describe('cambiar el sistema productivo (CFG-03 CA1)', () => {
    it('cambia las preguntas, no las cifras comunes', async () => {
      const before = await dashboard(admin);
      try {
        await setSystem(farmId, admin, PRODUCTION_SYSTEM.LEVANTE_CEBA);
        const after = await dashboard(admin);
        expect(after.productionSystem).toBe('LEVANTE_CEBA');
        expect(after.questions).toEqual(systemQuestions(PRODUCTION_SYSTEM.LEVANTE_CEBA));
        expect(after).toHaveProperty('saleWeight');
        expect(after).not.toHaveProperty('weaning');
        for (const key of [
          'herd',
          'reproduction',
          'births',
          'vaccines',
          'alerts',
          'forSale',
        ] as const) {
          expect(after[key], key).toEqual(before[key]);
        }
        expect(after.investment).toBe(before.investment);

        await setSystem(farmId, admin, PRODUCTION_SYSTEM.CICLO_COMPLETO);
        const both = await dashboard(admin);
        expect(both).toHaveProperty('weaning');
        expect(both).toHaveProperty('saleWeight');
        expect(both).not.toHaveProperty('milkWithdrawal');
      } finally {
        await setSystem(farmId, admin, PRODUCTION_SYSTEM.DOBLE_PROPOSITO);
      }
    });

    it('solo el ADMIN cambia el sistema productivo', async () => {
      const farm = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
      for (const headers of [operator, vet]) {
        await http()
          .patch('/api/v1/farm')
          .set(headers)
          .send({ version: farm.version, settings: { productionSystem: 'CRIA' } })
          .expect(403);
      }
      const response = await http()
        .patch('/api/v1/farm')
        .set(admin)
        .send({ version: farm.version, settings: { productionSystem: 'CEBA' } })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  it('dentro de un ciclo oficial, el tablero trae el ciclo en curso para su avance (SAN-02 CA2)', async () => {
    // El 2026-2 va del 01/11 al 15/12 (08 §3.3). Adelanta el reloj de la API 40 días y vuelve.
    const days = daysBetween(SEED_TODAY, addDays(toIsoDate('2026-11-01'), 3));
    clock.advanceMinutes(days * 24 * 60);
    try {
      // Un token firmado con el reloj adelantado: el de antes ya venció (15 minutos).
      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'wilmer' } });
      const body = await dashboard(bearer(await signTestToken(app, { userId: user.id, farmId })));
      const cycle = await prisma.vaccinationCycle.findFirstOrThrow({
        where: { farmId, name: '2026-2' },
      });
      expect(body.today).toBe('2026-11-04');
      expect(body.vaccines.currentCycle).toEqual({ id: cycle.id, name: '2026-2' });
    } finally {
      clock.advanceMinutes(-days * 24 * 60);
    }
  });
});

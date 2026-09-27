import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ROLE,
  VACCINE_STATUS,
  type AnimalDetail,
  type AnimalList,
  type AnimalListItem,
  type Genealogy,
  type SearchResult,
  type Timeline,
} from '@hato/shared';
import request from 'supertest';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import {
  EXPECTED_EXITS,
  EXPECTED_INVENTORY,
  EXPECTED_LOTS,
  EXPECTED_REPRODUCTION,
  EXPECTED_VACCINES_TODAY,
  type VaccineTally,
} from '../prisma/seed/expected.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { FarmContextService } from '../src/animals/farm-context.service.js';
import { VaccineStatusService } from '../src/animals/vaccine-status.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase } from './helpers/fixtures.js';

/**
 * Listado, búsqueda, ficha y código sugerido contra la finca de referencia sembrada
 * (08 §3). Los filtros del listado reproducen las cifras de `expected.ts`: el mismo contrato
 * que cumple el seed y que tendrá que mostrar el tablero (M8).
 */

const PASSWORD = 'contraseña-de-prueba-del-seed';

describe('animales sobre la finca de referencia', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farmId: string;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;

  const http = () => request(app.getHttpServer());

  /** Total de un filtro del listado, con el rol que se indique. */
  const total = async (query: string, headers = operator): Promise<number> => {
    const response = await http().get(`/api/v1/animals?limit=1&${query}`).set(headers).expect(200);
    return (response.body as AnimalList).total;
  };

  /** Todos los animales de un filtro, recorriendo las páginas. */
  const all = async (query: string, limit = 50): Promise<AnimalListItem[]> => {
    const items: AnimalListItem[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/v1/animals?limit=${limit}&${query}${cursor === null ? '' : `&cursor=${cursor}`}`;
      const response = await http().get(url).set(admin).expect(200);
      const page = response.body as AnimalList;
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
  };

  const animalId = async (code: string): Promise<string> =>
    (await prisma.animal.findFirstOrThrow({ where: { farmId, code }, select: { id: true } })).id;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const { seed } = await runReferenceSeed(prisma, { password: PASSWORD, today: SEED_TODAY });
    farmId = seed.catalog.farmId;

    const token = async (username: string) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username } });
      return bearer(await signTestToken(app, { userId: user.id, farmId }));
    };
    admin = await token('alvaro');
    operator = await token('wilmer');
    vet = await token('paola.vet');
  }, 180_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('GET /animals reproduce expected.ts (ANI-06)', () => {
    it('inventario activo, por sexo y por estado', async () => {
      expect(await total('')).toBe(EXPECTED_INVENTORY.active);
      expect(await total('sex=MALE')).toBe(EXPECTED_INVENTORY.males);
      expect(await total('sex=FEMALE')).toBe(EXPECTED_INVENTORY.females);
      expect(await total('status=exited')).toBe(EXPECTED_EXITS.sold + EXPECTED_EXITS.dead);
    });

    it('cada categoría de manejo', async () => {
      for (const [category, expected] of Object.entries(EXPECTED_INVENTORY.category)) {
        expect(await total(`category=${category}`), category).toBe(expected);
      }
      expect(await total('category=CALF_MALE,CALF_FEMALE')).toBe(38 + 36);
    });

    it('etiquetas derivadas: preñadas, servidas, horras, paridas, en retiro', async () => {
      expect(await total('tags=PREGNANT')).toBe(EXPECTED_REPRODUCTION.pregnant);
      expect(await total('tags=SERVED')).toBe(EXPECTED_REPRODUCTION.served);
      expect(await total('tags=DRY')).toBe(EXPECTED_REPRODUCTION.dry);
      expect(await total('tags=CALVED')).toBe(EXPECTED_REPRODUCTION.calved);
      expect(await total('tags=WITHDRAWAL')).toBe(EXPECTED_REPRODUCTION.withdrawal);
    });

    it('combinaciones: vacas preñadas, novillas preñadas, novillas servidas', async () => {
      expect(await total('category=COW&tags=PREGNANT')).toBe(64);
      expect(await total('category=HEIFER&tags=PREGNANT')).toBe(7);
      expect(await total('category=HEIFER&tags=SERVED')).toBe(5);
      // Varias etiquetas se combinan con «y»: ninguna vaca está preñada y horra a la vez.
      expect(await total('tags=PREGNANT,DRY')).toBe(0);
    });

    it('etiqueta manual, disponibles para venta y lotes', async () => {
      expect(await total('tags=COTERO')).toBe(2);
      expect(await total('forSale=true')).toBe(EXPECTED_EXITS.forSale);
      const lots = await prisma.lot.findMany({ where: { farmId } });
      for (const lot of lots) {
        expect(await total(`lotId=${lot.id}`), lot.name).toBe(
          EXPECTED_LOTS[lot.name as keyof typeof EXPECTED_LOTS],
        );
      }
    });

    it('alertas: partos próximos, servidas sin diagnóstico, en retiro', async () => {
      expect(await total('alerts=calving_soon')).toBe(EXPECTED_REPRODUCTION.calvingsDueSoon);
      expect(await total('alerts=unconfirmed_service')).toBe(
        EXPECTED_REPRODUCTION.servedOver90Days,
      );
      expect(await total('alerts=withdrawal')).toBe(EXPECTED_REPRODUCTION.withdrawal);
    });

    it('las vacunas cuadran con expected.ts y el filtro de alertas con ellas', async () => {
      const scope = { farmId, userId: null, role: ROLE.ADMIN };
      const context = await app.get(FarmContextService).load(scope);
      const statuses = await app
        .get(VaccineStatusService)
        .statusesFor(scope, context, 'ALL_ACTIVE');
      expect(statuses.size).toBe(EXPECTED_INVENTORY.active);

      const tallies: Record<string, { -readonly [K in keyof VaccineTally]: number }> = {};
      for (const list of statuses.values()) {
        for (const vaccine of list) {
          const tally = (tallies[vaccine.name] ??= {
            upToDate: 0,
            pending: 0,
            overdue: 0,
            upcoming: 0,
            notApplicable: 0,
          });
          if (vaccine.status === VACCINE_STATUS.UP_TO_DATE) tally.upToDate += 1;
          else if (vaccine.status === VACCINE_STATUS.PENDING) tally.pending += 1;
          else if (vaccine.status === VACCINE_STATUS.OVERDUE) tally.overdue += 1;
          else if (vaccine.status === VACCINE_STATUS.UPCOMING) tally.upcoming += 1;
          else tally.notApplicable += 1;
        }
      }
      expect(tallies).toEqual(EXPECTED_VACCINES_TODAY);

      const withOverdue = [...statuses.values()].filter((list) =>
        list.some((vaccine) => vaccine.status === VACCINE_STATUS.OVERDUE),
      ).length;
      const withDue = [...statuses.values()].filter((list) =>
        list.some(
          (vaccine) =>
            vaccine.status === VACCINE_STATUS.PENDING || vaccine.status === VACCINE_STATUS.UPCOMING,
        ),
      ).length;
      expect(await total('alerts=vaccine_overdue')).toBe(withOverdue);
      expect(await total('alerts=vaccine_due')).toBe(withDue);
      expect(withOverdue).toBeGreaterThanOrEqual(6);
    });

    it('rango de edad: las terneras son las hembras de 0 a 6 meses con destete a 7', async () => {
      expect(await total('sex=FEMALE&ageMaxMonths=6')).toBe(
        EXPECTED_INVENTORY.category.CALF_FEMALE,
      );
      expect(await total('ageMinMonths=24&sex=MALE')).toBe(EXPECTED_INVENTORY.category.ADULT_MALE);
    });

    it('cada fila muestra lo mismo que dice el filtro (RN-27)', async () => {
      const pregnant = await all('tags=PREGNANT', 200);
      expect(pregnant).toHaveLength(EXPECTED_REPRODUCTION.pregnant);
      expect(pregnant.every((item) => item.derivedTags.includes('PREGNANT'))).toBe(true);

      const cows = await all('category=COW', 200);
      expect(cows.every((item) => item.category === 'COW' && item.calvingCount >= 1)).toBe(true);
      const soon = await all('alerts=calving_soon');
      expect(soon.every((item) => item.alerts.includes('calving_soon'))).toBe(true);
    });

    it('la paginación por cursor recorre todo sin repetir, en cada orden', async () => {
      for (const sort of ['code', '-code', 'age', '-age', 'lastWeight', '-lastWeight']) {
        const items = await all(`sort=${sort}`, 37);
        const ids = new Set(items.map((item) => item.id));
        expect(items, sort).toHaveLength(EXPECTED_INVENTORY.active);
        expect(ids.size, sort).toBe(EXPECTED_INVENTORY.active);
      }
      const byCode = await all('sort=code', 50);
      const codes = byCode.map((item) => item.code);
      expect(codes).toEqual(
        [...codes].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      );

      const byAge = await all('sort=age', 100);
      const births = byAge.map((item) => item.birthDate);
      expect(births).toEqual([...births].sort().reverse());

      const byWeight = await all('sort=-lastWeight', 100);
      const weights = byWeight.flatMap((item) =>
        item.lastWeight === null ? [] : [item.lastWeight.weightKg],
      );
      expect(weights).toEqual([...weights].sort((left, right) => right - left));
      // Los que no tienen peso van al final.
      const firstWithout = byWeight.findIndex((item) => item.lastWeight === null);
      if (firstWithout >= 0) {
        expect(byWeight.slice(firstWithout).every((item) => item.lastWeight === null)).toBe(true);
      }
    });

    it('los archivados solo los lista ADMIN', async () => {
      await http().get('/api/v1/animals?status=archived').set(operator).expect(403);
      await http().get('/api/v1/animals?status=archived').set(vet).expect(403);
      expect(await total('status=archived', admin)).toBe(0);
    });

    it('rechaza filtros fuera de las listas cerradas', async () => {
      for (const query of ['sort=name', 'category=VACA', 'alerts=todo', "tags=X'--", 'limit=500']) {
        const response = await http().get(`/api/v1/animals?${query}`).set(admin).expect(422);
        expect(response.body.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('GET /animals/search (ANI-05)', () => {
    const search = async (q: string): Promise<SearchResult> =>
      (await http().get('/api/v1/animals/search').query({ q }).set(operator).expect(200))
        .body as SearchResult;

    it('código y chapeta iguales son del mismo animal: coincidencia exacta', async () => {
      const result = await search('045');
      expect(result.exactMatch?.animalId).toBe(await animalId('045'));
      // Prioridad: identificador activo antes que código.
      expect(result.exactMatch?.via).toEqual({
        kind: 'IDENTIFIER',
        identifierType: 'VISUAL_TAG',
        value: '045',
        previous: false,
      });
      expect(result.exactMatch?.matches).toHaveLength(2);
    });

    it('por DIN, aunque se escriba con minúsculas, espacios y guiones', async () => {
      const din = await prisma.identifier.findFirstOrThrow({
        where: { farmId, type: 'DIN' },
        include: { animal: { select: { code: true } } },
      });
      const scrambled = `${din.value.slice(0, 2).toLowerCase()}-${din.value.slice(2, 7)} ${din.value.slice(7)}`;
      const result = await search(scrambled);
      expect(result.exactMatch?.animalId).toBe(din.animalId);
      expect(result.exactMatch?.via).toMatchObject({ kind: 'IDENTIFIER', identifierType: 'DIN' });
    });

    it('por RFID de 15 dígitos, como lo escribe el lector (ANI-05 CA3)', async () => {
      const id = await animalId('101');
      await http()
        .post(`/api/v1/animals/${id}/identifiers`)
        .set(operator)
        .send({ type: 'RFID', value: '170000000000101' })
        .expect(201);
      const result = await search('170000000000101');
      expect(result.exactMatch).toMatchObject({
        animalId: id,
        via: { kind: 'IDENTIFIER', identifierType: 'RFID', previous: false },
      });
    });

    it('por un identificador retirado: indica que es anterior (IDN-02 CA2)', async () => {
      const din = await prisma.identifier.findFirstOrThrow({
        where: { farmId, type: 'DIN', retiredAt: null },
        orderBy: { value: 'desc' },
      });
      await http()
        .post(`/api/v1/identifiers/${din.id}/replace`)
        .set(operator)
        .send({ reason: 'LOST', newValue: 'CO13657REPUESTO', date: '2026-09-20' })
        .expect(201);

      const old = await search(din.value);
      expect(old.exactMatch).toMatchObject({
        animalId: din.animalId,
        via: { kind: 'IDENTIFIER', identifierType: 'DIN', value: din.value, previous: true },
      });
      const current = await search('CO13657REPUESTO');
      expect(current.exactMatch?.via).toMatchObject({ previous: false });
    });

    it('si las coincidencias exactas son de animales distintos, no abre ninguno: los lista con el porqué', async () => {
      const other = await animalId('057');
      await http()
        .post(`/api/v1/animals/${other}/identifiers`)
        .set(admin)
        .send({ type: 'OTHER', value: '066' })
        .expect(201);

      const result = await search('066');
      expect(result.exactMatch).toBeNull();
      const exact = result.items.filter((item) => item.exact);
      expect(exact.map((item) => item.code).sort()).toEqual(['057', '066']);
      expect(exact.find((item) => item.code === '057')?.matches).toEqual([
        { kind: 'IDENTIFIER', identifierType: 'OTHER', value: '066', previous: false },
      ]);
      // Con coincidencias exactas no se agrega la difusa.
      expect(result.items.every((item) => item.exact)).toBe(true);
      expect(exact.find((item) => item.code === '066')?.matches.map((match) => match.kind)).toEqual(
        ['IDENTIFIER', 'CODE'],
      );
    });

    it('difusa por nombre y por parte del código', async () => {
      const byName = await search('lucer');
      expect(byName.exactMatch).toBeNull();
      expect(byName.items[0]).toMatchObject({ code: '045', name: 'Lucero', exact: false });
      expect(byName.items[0]?.matches).toContainEqual({ kind: 'NAME', value: 'Lucero' });

      const partial = await search('26-08');
      expect(partial.items.length).toBeGreaterThan(0);
      expect(partial.items.every((item) => item.matches.length > 0)).toBe(true);
      expect(partial.items.some((item) => item.code.startsWith('26-08'))).toBe(true);
    });

    it('con menos de dos caracteres solo hay búsqueda exacta', async () => {
      const result = await search('4');
      expect(result.items.every((item) => item.exact)).toBe(true);
    });

    it('incluye los que salieron, con su estado, y nunca los de otra finca', async () => {
      const sold = await prisma.animal.findFirstOrThrow({
        where: { farmId, exitType: 'SALE' },
        select: { code: true, id: true },
      });
      const result = await search(sold.code);
      expect(result.items.find((item) => item.id === sold.id)?.status).toBe('SOLD');
    });
  });

  describe('ficha, línea de tiempo y genealogía (ANI-07)', () => {
    it('la ficha coincide con la fila del listado y oculta la compra a quien no es ADMIN', async () => {
      const id = await animalId('066');
      const asAdmin = (await http().get(`/api/v1/animals/${id}`).set(admin).expect(200))
        .body as AnimalDetail;
      expect(asAdmin.economics?.purchasePrice).toBe('6100000.00');
      for (const headers of [operator, vet]) {
        const body = (await http().get(`/api/v1/animals/${id}`).set(headers).expect(200))
          .body as Record<string, unknown>;
        expect(body).not.toHaveProperty('economics');
        expect(JSON.stringify(body)).not.toContain('6100000');
      }

      const cows = await all('category=COW', 200);
      const cow = cows.find((item) => item.derivedTags.includes('PREGNANT'));
      expect(cow).toBeDefined();
      const detail = (await http().get(`/api/v1/animals/${cow?.id}`).set(operator).expect(200))
        .body as AnimalDetail;
      expect(detail.category).toBe(cow?.category);
      expect(detail.derivedTags).toEqual(cow?.derivedTags);
      expect(detail.alerts).toEqual(cow?.alerts);
      expect(detail.reproduction?.openPregnancy?.confirmedAt).not.toBeNull();
      expect(detail.vaccines.length).toBeGreaterThan(0);
    });

    it('la línea de tiempo de una vaca: eventos del más reciente al más antiguo, paginada', async () => {
      const [cow] = await all('category=COW&tags=CALVED', 200);
      const pages: Timeline['items'][number][] = [];
      let cursor: string | null = null;
      do {
        const url: string = `/api/v1/animals/${cow?.id}/timeline?limit=5${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = (await http().get(url).set(vet).expect(200)).body as Timeline;
        pages.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== null);

      const kinds = new Set(pages.map((item) => item.kind));
      expect(kinds).toContain('BIRTH');
      expect(kinds).toContain('SERVICE');
      expect(kinds).toContain('PREGNANCY_OUTCOME');
      const dates = pages.map((item) => item.date);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(new Set(pages.map((item) => item.key)).size).toBe(pages.length);
    });

    it('genealogía: la cría conoce a su madre y la madre a sus crías', async () => {
      const calf = await prisma.animal.findFirstOrThrow({
        where: { farmId, damId: { not: null }, deletedAt: null },
        select: { id: true, damId: true },
      });
      const genealogy = (
        await http().get(`/api/v1/animals/${calf.id}/genealogy`).set(operator).expect(200)
      ).body as Genealogy;
      expect(genealogy.dam?.id).toBe(calf.damId);

      const ofDam = (
        await http().get(`/api/v1/animals/${calf.damId}/genealogy`).set(operator).expect(200)
      ).body as Genealogy;
      expect(ofDam.offspring.map((child) => child.id)).toContain(calf.id);
    });
  });

  describe('GET /animals/next-code (RN-28)', () => {
    it('sigue el patrón {YY}-{NNN} y el año de la fecha de nacimiento', async () => {
      const next = await http().get('/api/v1/animals/next-code').set(operator).expect(200);
      expect(next.body).toEqual({ code: '26-091' });
      const other = await http()
        .get('/api/v1/animals/next-code?birthDate=2027-01-05')
        .set(operator)
        .expect(200);
      expect(other.body).toEqual({ code: '27-001' });
    });

    it('no reutiliza el código de un animal archivado', async () => {
      const calf = await prisma.animal.findFirstOrThrow({ where: { farmId, code: '26-090' } });
      await prisma.animal.create({
        data: {
          ...calf,
          id: '01999999-0000-7000-8000-000000000091',
          code: '26-091',
          deletedAt: new Date('2026-09-20T12:00:00Z'),
          deletedReason: 'Registro duplicado por error',
          birthPregnancyId: null,
        },
      });
      const next = await http().get('/api/v1/animals/next-code').set(operator).expect(200);
      expect(next.body).toEqual({ code: '26-092' });
    });
  });
});

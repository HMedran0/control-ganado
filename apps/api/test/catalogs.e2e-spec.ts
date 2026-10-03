import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DEFAULT_FARM_SETTINGS, ROLE, toIsoDate, uuidv7, type Role } from '@hato/shared';
import request from 'supertest';

import { toPrismaDate } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import {
  cleanDatabase,
  createAnimal,
  createFarm,
  createMember,
  type TestFarm,
} from './helpers/fixtures.js';

/**
 * Finca y catálogos (M3: CFG-01, CFG-02, SAN-01, SAN-06) contra PostgreSQL real.
 *
 * Cada recurso se prueba con el rol autorizado, los no autorizados y un usuario de otra finca
 * (CLAUDE.md, «Convenciones»). «Hoy» es el 25/09/2026 (FakeClock).
 */
describe('Finca y catálogos', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    esperanza = await createFarm(prisma, 'La Esperanza');
    palmar = await createFarm(prisma, 'El Palmar');
    admin = bearer(
      await signTestToken(app, { userId: esperanza.userId, farmId: esperanza.farmId }),
    );
    otherAdmin = bearer(await signTestToken(app, { userId: palmar.userId, farmId: palmar.farmId }));
    operator = await as(esperanza, ROLE.OPERATOR);
    vet = await as(esperanza, ROLE.VET);
  });

  const auditCount = (entity: string, entityId: string) =>
    prisma.auditLog.count({ where: { entity, entityId } });

  describe('GET y PATCH /farm (CFG-01)', () => {
    beforeEach(async () => {
      await prisma.farm.update({
        where: { id: esperanza.farmId },
        data: {
          settings: { ...DEFAULT_FARM_SETTINGS, pricePerKgByCategory: { VACA: '9500.00' } },
        },
      });
    });

    it('el precio por kilo solo lo ve ADMIN (RN-20)', async () => {
      const asAdmin = await http().get('/api/v1/farm').set(admin).expect(200);
      expect(asAdmin.body.settings.pricePerKgByCategory).toEqual({ VACA: '9500.00' });

      for (const headers of [operator, vet]) {
        const response = await http().get('/api/v1/farm').set(headers).expect(200);
        expect(response.body.name).toBe('La Esperanza');
        expect(response.body.settings.weaningAgeMonths).toBe(7);
        expect(response.body.settings).not.toHaveProperty('pricePerKgByCategory');
      }
    });

    it('un cambio parcial de parámetros conserva el resto y sube la versión', async () => {
      const response = await http()
        .patch('/api/v1/farm')
        .set(admin)
        .send({ version: 1, settings: { weaningAgeMonths: 8 } })
        .expect(200);

      expect(response.body.version).toBe(2);
      expect(response.body.settings).toMatchObject({
        weaningAgeMonths: 8,
        gestationDays: 285,
        calfCodePattern: '{YY}-{NNN}',
        pricePerKgByCategory: { VACA: '9500.00' },
      });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Farm' } });
      expect(log.diff).toMatchObject({
        changed: ['weaningAgeMonths'],
        before: { weaningAgeMonths: 7 },
        after: { weaningAgeMonths: 8 },
      });
    });

    it('una versión vieja responde VERSION_CONFLICT', async () => {
      await http().patch('/api/v1/farm').set(admin).send({ version: 1, name: 'La Nueva' });
      const response = await http()
        .patch('/api/v1/farm')
        .set(admin)
        .send({ version: 1, name: 'Otra' })
        .expect(409);
      expect(response.body.code).toBe('VERSION_CONFLICT');
    });

    it('OPERATOR y VET no editan la finca', async () => {
      for (const headers of [operator, vet]) {
        await http().patch('/api/v1/farm').set(headers).send({ version: 1, name: 'X' }).expect(403);
      }
    });

    it('cada ADMIN edita solo su finca: la del token', async () => {
      await http().patch('/api/v1/farm').set(otherAdmin).send({ version: 1, name: 'Palmar 2' });
      const esperanzaFarm = await prisma.farm.findUniqueOrThrow({
        where: { id: esperanza.farmId },
      });
      expect(esperanzaFarm.name).toBe('La Esperanza');
    });
  });

  describe('razas (CFG-02, 08 §1.4)', () => {
    it('todos leen; solo ADMIN escribe (VET tampoco)', async () => {
      for (const headers of [admin, operator, vet]) {
        const response = await http().get('/api/v1/breeds').set(headers).expect(200);
        expect(response.body.items.map((breed: { name: string }) => breed.name)).toEqual([
          'Brahman',
        ]);
        expect(response.body.nextCursor).toBeNull();
      }
      for (const headers of [operator, vet]) {
        await http()
          .post('/api/v1/breeds')
          .set(headers)
          .send({ name: 'Gyr', group: 'INDICUS' })
          .expect(403);
        await http()
          .patch(`/api/v1/breeds/${esperanza.breedId}`)
          .set(headers)
          .send({ version: 1, gestationDays: 290 })
          .expect(403);
      }
    });

    it.each([
      ['INDICUS', 293],
      ['TAURUS', 283],
      ['CROSS', 288],
    ])('sin gestación, una raza %s se crea con %i días', async (group, days) => {
      const response = await http()
        .post('/api/v1/breeds')
        .set(admin)
        .send({ name: `Raza ${group}`, group })
        .expect(201);
      expect(response.body).toMatchObject({
        group,
        gestationDays: days,
        isActive: true,
        version: 1,
      });
      expect(await auditCount('Breed', response.body.id)).toBe(1);
    });

    it('respeta la gestación enviada y guarda el nombre normalizado', async () => {
      const response = await http()
        .post('/api/v1/breeds')
        .set(admin)
        .send({ name: '  Gyr   lechero ', group: 'INDICUS', gestationDays: 290 })
        .expect(201);
      expect(response.body).toMatchObject({ name: 'Gyr lechero', gestationDays: 290 });
    });

    it.each(['brahman', 'Brahman ', '  BRAHMAN', 'BrAhMaN'])(
      '«%s» choca con «Brahman»: nombres sin distinguir mayúsculas ni espacios',
      async (name) => {
        const response = await http()
          .post('/api/v1/breeds')
          .set(admin)
          .send({ name, group: 'INDICUS' })
          .expect(409);
        expect(response.body.code).toBe('CATALOG_NAME_TAKEN');
        expect(response.body.detail).toBe(
          `Ya existe una raza con el nombre «${name.trim().replace(/\s+/g, ' ')}».`,
        );
      },
    );

    it('los espacios dobles no hacen distinto un nombre: «brahman   rojo» = «Brahman rojo»', async () => {
      await http()
        .post('/api/v1/breeds')
        .set(admin)
        .send({ name: 'Brahman rojo', group: 'INDICUS' })
        .expect(201);
      const response = await http()
        .post('/api/v1/breeds')
        .set(admin)
        .send({ name: 'brahman   rojo', group: 'INDICUS' })
        .expect(409);
      expect(response.body.code).toBe('CATALOG_NAME_TAKEN');
    });

    it('renombrar a un nombre ya usado (con otras mayúsculas) también choca', async () => {
      const gyr = await http()
        .post('/api/v1/breeds')
        .set(admin)
        .send({ name: 'Gyr', group: 'INDICUS' });
      const response = await http()
        .patch(`/api/v1/breeds/${gyr.body.id}`)
        .set(admin)
        .send({ version: 1, name: 'BRAHMAN' })
        .expect(409);
      expect(response.body.code).toBe('CATALOG_NAME_TAKEN');
    });

    it('otra finca sí puede tener su «Brahman», y no ve ni toca las razas ajenas', async () => {
      await http()
        .post('/api/v1/breeds')
        .set(otherAdmin)
        .send({ name: 'Gyr', group: 'INDICUS' })
        .expect(201);
      const own = await http().get('/api/v1/breeds').set(otherAdmin).expect(200);
      expect(own.body.items.map((breed: { name: string }) => breed.name)).toEqual([
        'Brahman',
        'Gyr',
      ]);

      await http()
        .patch(`/api/v1/breeds/${esperanza.breedId}`)
        .set(otherAdmin)
        .send({ version: 1, gestationDays: 280 })
        .expect(404);
    });

    it('cambiar la gestación de la raza recalcula las preñeces abiertas, salvo las corregidas a mano (RN-04, M5)', async () => {
      const pregnancy = async (code: string, manual: boolean, outcome: 'PENDING' | 'CALVED') => {
        const damId = await createAnimal(prisma, esperanza, { code });
        const id = uuidv7();
        await prisma.pregnancy.create({
          data: {
            id,
            farmId: esperanza.farmId,
            damId,
            serviceDate: toPrismaDate(toIsoDate('2026-01-12')),
            method: 'AI',
            expectedCalvingDate: toPrismaDate(toIsoDate('2026-10-31')),
            expectedCalvingManual: manual,
            outcome,
            ...(outcome === 'CALVED' ? { outcomeDate: toPrismaDate(toIsoDate('2026-09-01')) } : {}),
            createdById: esperanza.userId,
            updatedById: esperanza.userId,
          },
        });
        return id;
      };
      const open = await pregnancy('101', false, 'PENDING');
      const manual = await pregnancy('102', true, 'PENDING');
      const closed = await pregnancy('103', false, 'CALVED');

      const response = await http()
        .patch(`/api/v1/breeds/${esperanza.breedId}`)
        .set(admin)
        .send({ version: 1, gestationDays: 283 })
        .expect(200);
      expect(response.body.warnings).toEqual([
        {
          code: 'EXPECTED_CALVING_RECALCULATED',
          message:
            'Se recalculó el parto estimado de 1 preñez abierta. 1 preñez con el parto corregido a mano no se tocó.',
        },
      ]);

      const date = async (id: string) =>
        (await prisma.pregnancy.findUniqueOrThrow({ where: { id } })).expectedCalvingDate
          .toISOString()
          .slice(0, 10);
      // 12/01/2026 + 283 días.
      expect(await date(open)).toBe('2026-10-22');
      expect(await date(manual)).toBe('2026-10-31');
      expect(await date(closed)).toBe('2026-10-31');
      expect(await prisma.auditLog.count({ where: { entity: 'Pregnancy', entityId: open } })).toBe(
        1,
      );
    });

    it('cambiar solo el nombre de la raza no recalcula nada ni avisa', async () => {
      const response = await http()
        .patch(`/api/v1/breeds/${esperanza.breedId}`)
        .set(admin)
        .send({ version: 1, name: 'Brahman rojo' })
        .expect(200);
      expect(response.body.warnings).toEqual([]);
    });

    it('desactivar una raza con animales no rompe los animales', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '102' });

      const response = await http()
        .patch(`/api/v1/breeds/${esperanza.breedId}`)
        .set(admin)
        .send({ version: 1, isActive: false })
        .expect(200);
      expect(response.body.isActive).toBe(false);

      const animal = await prisma.animal.findUniqueOrThrow({ where: { id: animalId } });
      expect(animal.breedId).toBe(esperanza.breedId);
      const active = await http().get('/api/v1/breeds').set(admin).expect(200);
      expect(active.body.items).toHaveLength(0);
      const all = await http().get('/api/v1/breeds?includeInactive=true').set(admin).expect(200);
      expect(all.body.items).toHaveLength(1);
    });
  });

  describe('vacunas (SAN-01)', () => {
    const intervalVaccine = {
      name: 'Clostridial',
      disease: 'Clostridiosis',
      scheduleType: 'INTERVAL',
      boosterIntervalDays: 365,
    };

    it('ADMIN y VET crean y editan; OPERATOR no', async () => {
      const created = await http()
        .post('/api/v1/vaccines')
        .set(vet)
        .send(intervalVaccine)
        .expect(201);
      await http()
        .patch(`/api/v1/vaccines/${created.body.id}`)
        .set(vet)
        .send({ version: 1, defaultDose: '5 ml' })
        .expect(200);
      await http()
        .patch(`/api/v1/vaccines/${created.body.id}`)
        .set(admin)
        .send({ version: 2, route: 'Subcutánea' })
        .expect(200);

      await http().post('/api/v1/vaccines').set(operator).send(intervalVaccine).expect(403);
      await http()
        .patch(`/api/v1/vaccines/${created.body.id}`)
        .set(operator)
        .send({ version: 3, defaultDose: '2 ml' })
        .expect(403);
      await http().get('/api/v1/vaccines').set(operator).expect(200);
    });

    it('rechaza una vacuna incoherente con el error en su campo', async () => {
      const response = await http()
        .post('/api/v1/vaccines')
        .set(admin)
        .send({
          name: 'Brucelosis',
          disease: 'Brucelosis bovina',
          scheduleType: 'AGE_WINDOW',
          blockIneligibleSex: true,
        })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors).toMatchObject({
        minAgeDays: ['Indica la edad mínima, la máxima o ambas.'],
        eligibleSex: ['Para bloquear el otro sexo, indica a qué sexo se aplica la vacuna.'],
      });
    });

    it('revisa la coherencia sobre la vacuna completa en un PATCH parcial', async () => {
      const created = await http().post('/api/v1/vaccines').set(admin).send(intervalVaccine);
      // Pasar a ventana de edad sin quitar el intervalo ni dar edades es incoherente.
      const response = await http()
        .patch(`/api/v1/vaccines/${created.body.id}`)
        .set(admin)
        .send({ version: 1, scheduleType: 'AGE_WINDOW' })
        .expect(422);
      expect(Object.keys(response.body.errors).sort()).toEqual([
        'boosterIntervalDays',
        'minAgeDays',
      ]);
    });

    it('nombres únicos sin distinguir mayúsculas', async () => {
      await http().post('/api/v1/vaccines').set(admin).send(intervalVaccine).expect(201);
      const response = await http()
        .post('/api/v1/vaccines')
        .set(admin)
        .send({ ...intervalVaccine, name: ' clostridial ' })
        .expect(409);
      expect(response.body.detail).toBe('Ya existe una vacuna con el nombre «clostridial».');
    });

    it('desactivar una vacuna de un ciclo en curso o futuro advierte, sin bloquear', async () => {
      const aftosa = await http().post('/api/v1/vaccines').set(admin).send({
        name: 'Aftosa',
        disease: 'Fiebre aftosa',
        scheduleType: 'OFFICIAL_CYCLE',
      });
      await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: '2026-1',
          startsOn: '2026-05-04',
          endsOn: '2026-06-23',
          vaccineIds: [aftosa.body.id],
        })
        .expect(201);
      await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: '2026-2',
          startsOn: '2026-11-01',
          endsOn: '2026-12-15',
          vaccineIds: [aftosa.body.id],
        })
        .expect(201);

      const preview = await http()
        .get(`/api/v1/vaccines/${aftosa.body.id}/deactivation-warnings`)
        .set(admin)
        .expect(200);
      // Solo el ciclo futuro: el 2026-1 ya cerró.
      expect(preview.body.warnings).toEqual([
        {
          code: 'VACCINE_IN_ACTIVE_CYCLE',
          message:
            'La vacuna está en el ciclo 2026-2 (01/11/2026 a 15/12/2026), en curso o por empezar.',
        },
      ]);

      const response = await http()
        .patch(`/api/v1/vaccines/${aftosa.body.id}`)
        .set(admin)
        .send({ version: 1, isActive: false })
        .expect(200);
      expect(response.body.isActive).toBe(false);
      expect(response.body.warnings).toEqual(preview.body.warnings);
    });
  });

  describe('ciclos de vacunación (SAN-06)', () => {
    let aftosaId: string;

    beforeEach(async () => {
      const aftosa = await http().post('/api/v1/vaccines').set(admin).send({
        name: 'Aftosa',
        disease: 'Fiebre aftosa',
        scheduleType: 'OFFICIAL_CYCLE',
      });
      aftosaId = aftosa.body.id as string;
    });

    it('ADMIN crea un ciclo con sus vacunas; VET y OPERATOR no', async () => {
      const cycle = {
        name: '2026-2',
        startsOn: '2026-11-01',
        endsOn: '2026-12-15',
        vaccineIds: [aftosaId],
      };
      for (const headers of [vet, operator]) {
        await http().post('/api/v1/vaccination-cycles').set(headers).send(cycle).expect(403);
      }
      const response = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send(cycle)
        .expect(201);
      expect(response.body).toMatchObject({
        name: '2026-2',
        startsOn: '2026-11-01',
        endsOn: '2026-12-15',
        isOfficial: true,
        vaccines: [{ id: aftosaId, name: 'Aftosa' }],
        warnings: [],
      });
    });

    it('la fecha de fin no puede ser anterior a la de inicio, tampoco en un PATCH', async () => {
      const bad = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({ name: 'X', startsOn: '2026-11-01', endsOn: '2026-10-01', vaccineIds: [aftosaId] })
        .expect(422);
      expect(bad.body.errors.endsOn).toEqual([
        'La fecha de fin no puede ser anterior a la de inicio.',
      ]);

      const cycle = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({ name: 'Y', startsOn: '2026-11-01', endsOn: '2026-12-15', vaccineIds: [aftosaId] });
      await http()
        .patch(`/api/v1/vaccination-cycles/${cycle.body.id}`)
        .set(admin)
        .send({ version: 1, endsOn: '2026-10-31' })
        .expect(422);
    });

    it('un ciclo que se cruza con otro se guarda y advierte', async () => {
      await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: '2026-1',
          startsOn: '2026-05-04',
          endsOn: '2026-06-23',
          vaccineIds: [aftosaId],
        });
      const response = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: 'Refuerzo',
          startsOn: '2026-06-20',
          endsOn: '2026-07-10',
          vaccineIds: [aftosaId],
        })
        .expect(201);
      expect(response.body.warnings).toEqual([
        {
          code: 'CYCLE_OVERLAP',
          message: 'Las fechas se cruzan con el ciclo 2026-1 (04/05/2026 a 23/06/2026).',
        },
      ]);
    });

    it('no acepta vacunas de otra finca', async () => {
      const foreign = await http().post('/api/v1/vaccines').set(otherAdmin).send({
        name: 'Aftosa',
        disease: 'Fiebre aftosa',
        scheduleType: 'OFFICIAL_CYCLE',
      });
      const response = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: '2026-2',
          startsOn: '2026-11-01',
          endsOn: '2026-12-15',
          vaccineIds: [foreign.body.id],
        })
        .expect(422);
      expect(response.body.errors.vaccineIds).toBeDefined();
    });

    it('un PATCH reemplaza las vacunas del ciclo y lo audita', async () => {
      const rabia = await http().post('/api/v1/vaccines').set(admin).send({
        name: 'Rabia',
        disease: 'Rabia silvestre',
        scheduleType: 'OFFICIAL_CYCLE',
      });
      const cycle = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: '2026-2',
          startsOn: '2026-11-01',
          endsOn: '2026-12-15',
          vaccineIds: [aftosaId],
        });

      const response = await http()
        .patch(`/api/v1/vaccination-cycles/${cycle.body.id}`)
        .set(admin)
        .send({ version: 1, vaccineIds: [aftosaId, rabia.body.id] })
        .expect(200);
      expect(response.body.vaccines.map((vaccine: { name: string }) => vaccine.name)).toEqual([
        'Aftosa',
        'Rabia',
      ]);
      expect(await auditCount('VaccinationCycle', cycle.body.id)).toBe(2);
    });

    it('ADR-012 (M6): quitar una vacuna del ciclo no borra la fila y deja de contar en las alertas', async () => {
      const cow = await createAnimal(prisma, esperanza, { code: '301' });
      const aftosaOf = async () => {
        const detail = await http().get(`/api/v1/animals/${cow}`).set(admin).expect(200);
        return (detail.body.vaccines as { name: string; status: string; reason: string }[]).find(
          (vaccine) => vaccine.name === 'Aftosa',
        );
      };
      // Ciclo en curso el 25/09/2026 (reloj de las pruebas): la vaca queda pendiente.
      const cycle = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({
          name: '2026-X',
          startsOn: '2026-09-01',
          endsOn: '2026-10-30',
          vaccineIds: [aftosaId],
        })
        .expect(201);
      expect(await aftosaOf()).toMatchObject({ status: 'PENDING', reason: 'CURRENT_CYCLE' });

      const rabia = await http().post('/api/v1/vaccines').set(admin).send({
        name: 'Rabia',
        disease: 'Rabia silvestre',
        scheduleType: 'OFFICIAL_CYCLE',
      });
      const removed = await http()
        .patch(`/api/v1/vaccination-cycles/${cycle.body.id}`)
        .set(admin)
        .send({ version: 1, vaccineIds: [rabia.body.id] })
        .expect(200);
      expect(removed.body.vaccines.map((vaccine: { name: string }) => vaccine.name)).toEqual([
        'Rabia',
      ]);
      const rows = await prisma.vaccinationCycleVaccine.findMany({
        where: { cycleId: cycle.body.id, vaccineId: aftosaId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ removedById: esperanza.userId, farmId: esperanza.farmId });
      expect(rows[0]?.removedAt).not.toBeNull();
      expect(await aftosaOf()).toMatchObject({ status: 'NOT_APPLICABLE', reason: 'NO_CYCLE' });

      // Volver a ponerla crea otra fila vigente; la quitada queda como historial.
      await http()
        .patch(`/api/v1/vaccination-cycles/${cycle.body.id}`)
        .set(admin)
        .send({ version: 2, vaccineIds: [aftosaId, rabia.body.id] })
        .expect(200);
      const again = await prisma.vaccinationCycleVaccine.findMany({
        where: { cycleId: cycle.body.id, vaccineId: aftosaId },
        orderBy: { createdAt: 'asc' },
      });
      expect(again.map((row) => row.removedAt === null)).toEqual([false, true]);
      expect(await aftosaOf()).toMatchObject({ status: 'PENDING', reason: 'CURRENT_CYCLE' });

      // Un PATCH que no cambia las vacunas no toca las filas.
      await http()
        .patch(`/api/v1/vaccination-cycles/${cycle.body.id}`)
        .set(admin)
        .send({ version: 3, vaccineIds: [rabia.body.id, aftosaId] })
        .expect(200);
      expect(
        await prisma.vaccinationCycleVaccine.count({ where: { cycleId: cycle.body.id } }),
      ).toBe(3);

      // El índice único parcial impide dos filas vigentes de la misma vacuna en el ciclo.
      await expect(
        prisma.vaccinationCycleVaccine.create({
          data: {
            id: uuidv7(),
            farmId: esperanza.farmId,
            cycleId: cycle.body.id,
            vaccineId: aftosaId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('lotes (CFG-02)', () => {
    it('desactivar un lote con animales activos advierte y no los mueve', async () => {
      const lot = await http()
        .post('/api/v1/lots')
        .set(admin)
        .send({ name: 'Paridas', description: 'Vacas con cría al pie' })
        .expect(201);
      const [a, b, sold] = await Promise.all([
        createAnimal(prisma, esperanza, { code: '201' }),
        createAnimal(prisma, esperanza, { code: '202' }),
        createAnimal(prisma, esperanza, { code: '203' }),
      ]);
      await prisma.animal.updateMany({
        where: { id: { in: [a, b, sold] } },
        data: { lotId: lot.body.id },
      });
      await prisma.animal.update({
        where: { id: sold },
        data: { exitType: 'SALE', exitDate: toPrismaDate(toIsoDate('2026-09-01')) },
      });

      const preview = await http()
        .get(`/api/v1/lots/${lot.body.id}/deactivation-warnings`)
        .set(admin)
        .expect(200);
      expect(preview.body.warnings).toEqual([
        { code: 'LOT_HAS_ACTIVE_ANIMALS', message: '2 animales siguen en este lote.' },
      ]);

      const response = await http()
        .patch(`/api/v1/lots/${lot.body.id}`)
        .set(admin)
        .send({ version: 1, isActive: false })
        .expect(200);
      expect(response.body.warnings).toEqual(preview.body.warnings);
      expect(await prisma.animal.count({ where: { lotId: lot.body.id } })).toBe(3);
    });

    it('un lote vacío se desactiva sin advertencias', async () => {
      const lot = await http().post('/api/v1/lots').set(admin).send({ name: 'Toros' });
      const response = await http()
        .patch(`/api/v1/lots/${lot.body.id}`)
        .set(admin)
        .send({ version: 1, isActive: false })
        .expect(200);
      expect(response.body.warnings).toEqual([]);
    });

    it('permisos y aislamiento', async () => {
      const lot = await http().post('/api/v1/lots').set(admin).send({ name: 'Levante' });
      for (const headers of [operator, vet]) {
        await http().post('/api/v1/lots').set(headers).send({ name: 'Otro' }).expect(403);
        await http()
          .get(`/api/v1/lots/${lot.body.id}/deactivation-warnings`)
          .set(headers)
          .expect(403);
      }
      await http()
        .get(`/api/v1/lots/${lot.body.id}/deactivation-warnings`)
        .set(otherAdmin)
        .expect(404);
      await http()
        .patch(`/api/v1/lots/${lot.body.id}`)
        .set(otherAdmin)
        .send({ version: 1, name: 'Robado' })
        .expect(404);
      const duplicate = await http().post('/api/v1/lots').set(admin).send({ name: 'LEVANTE' });
      expect(duplicate.status).toBe(409);
    });
  });

  describe('etiquetas (CLS-02, 08 §1.1)', () => {
    let coteroId: string;

    beforeEach(async () => {
      coteroId = uuidv7();
      await prisma.tag.create({
        data: {
          id: coteroId,
          farmId: esperanza.farmId,
          key: 'COTERO',
          label: 'Cotero',
          description: 'Animal destinado a trabajo',
          isSystem: true,
        },
      });
    });

    it('la key se genera al crear y no cambia al renombrar', async () => {
      const created = await http()
        .post('/api/v1/tags')
        .set(admin)
        .send({ label: 'Disponible para venta' })
        .expect(201);
      expect(created.body.key).toBe('DISPONIBLE_PARA_VENTA');

      const renamed = await http()
        .patch(`/api/v1/tags/${created.body.id}`)
        .set(admin)
        .send({ version: 1, label: 'Para vender' })
        .expect(200);
      expect(renamed.body).toMatchObject({ label: 'Para vender', key: 'DISPONIBLE_PARA_VENTA' });

      // Otra etiqueta que generaría la misma key recibe un sufijo.
      const again = await http()
        .post('/api/v1/tags')
        .set(admin)
        .send({ label: 'Disponible para venta' })
        .expect(201);
      expect(again.body.key).toBe('DISPONIBLE_PARA_VENTA_2');
    });

    it('COTERO no se desactiva ni se renombra, pero su descripción sí se edita', async () => {
      const rename = await http()
        .patch(`/api/v1/tags/${coteroId}`)
        .set(admin)
        .send({ version: 1, label: 'Trabajo' })
        .expect(409);
      expect(rename.body.code).toBe('SYSTEM_TAG_PROTECTED');
      expect(rename.body.detail).toBe(
        'La etiqueta «Cotero» es del sistema: no se puede desactivar ni cambiar su nombre.',
      );
      await http()
        .patch(`/api/v1/tags/${coteroId}`)
        .set(admin)
        .send({ version: 1, isActive: false })
        .expect(409);

      const described = await http()
        .patch(`/api/v1/tags/${coteroId}`)
        .set(admin)
        .send({ version: 1, description: 'Bueyes de carga y tiro' })
        .expect(200);
      expect(described.body).toMatchObject({
        label: 'Cotero',
        description: 'Bueyes de carga y tiro',
        isActive: true,
      });
    });

    it('nombres únicos sin distinguir mayúsculas, y solo ADMIN escribe', async () => {
      const duplicate = await http().post('/api/v1/tags').set(admin).send({ label: ' COTERO' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('CATALOG_NAME_TAKEN');
      for (const headers of [operator, vet]) {
        await http().post('/api/v1/tags').set(headers).send({ label: 'Descarte' }).expect(403);
      }
    });
  });
});

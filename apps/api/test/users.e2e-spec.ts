import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7, type Role } from '@hato/shared';
import request from 'supertest';

import { PasswordService } from '../src/auth/password.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, createMember, type TestFarm } from './helpers/fixtures.js';

/**
 * Gestión de usuarios (AUT-03, AUT-04 CA2) contra PostgreSQL real.
 *
 * Cubre lo que RNF-07 exige comprobar: autorización por rol y aislamiento por finca en cada
 * endpoint, no en la interfaz.
 */
describe('Usuarios', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let adminHeaders: Record<string, string>;

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
    adminHeaders = bearer(
      await signTestToken(app, { userId: esperanza.userId, farmId: esperanza.farmId }),
    );
  });

  describe('autorización (RNF-07)', () => {
    it('OPERATOR y VET reciben 403 en toda la gestión de usuarios', async () => {
      for (const role of [ROLE.OPERATOR, ROLE.VET]) {
        const headers = await as(esperanza, role);

        await request(app.getHttpServer()).get('/api/v1/users').set(headers).expect(403);
        await request(app.getHttpServer())
          .post('/api/v1/users')
          .set(headers)
          .send({ name: 'Nuevo', username: 'nuevo', role: 'OPERATOR' })
          .expect(403);
        await request(app.getHttpServer())
          .patch(`/api/v1/users/${esperanza.userId}`)
          .set(headers)
          .send({ name: 'Otro' })
          .expect(403);
        await request(app.getHttpServer())
          .post(`/api/v1/users/${esperanza.userId}/reset-password`)
          .set(headers)
          .expect(403);
      }
    });

    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    });
  });

  describe('aislamiento por finca (RN-21)', () => {
    it('solo lista los usuarios de la finca del token', async () => {
      await createMember(prisma, palmar, ROLE.OPERATOR);

      const response = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(adminHeaders)
        .expect(200);

      const ids = response.body.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(esperanza.userId);
      expect(ids).not.toContain(palmar.userId);
    });

    it('no puede editar a un usuario de otra finca', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${palmar.userId}`)
        .set(adminHeaders)
        .send({ name: 'Secuestrado' })
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');

      const untouched = await prisma.user.findUniqueOrThrow({ where: { id: palmar.userId } });
      expect(untouched.name).not.toBe('Secuestrado');
    });

    it('no puede restablecer la contraseña de un usuario de otra finca', async () => {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: palmar.userId } });

      await request(app.getHttpServer())
        .post(`/api/v1/users/${palmar.userId}/reset-password`)
        .set(adminHeaders)
        .expect(404);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: palmar.userId } });
      expect(after.passwordHash).toBe(before.passwordHash);
    });
  });

  describe('crear (AUT-03)', () => {
    it('crea con contraseña temporal y obliga a cambiarla', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(adminHeaders)
        .send({ name: 'Wilmer Ortega', username: 'wilmer', role: 'OPERATOR' })
        .expect(201);

      expect(response.body.user).toMatchObject({
        username: 'wilmer',
        email: null,
        role: 'OPERATOR',
        mustChangePassword: true,
        isActive: true,
      });
      expect(response.body.temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      expect(response.body.user.passwordHash).toBeUndefined();

      // La temporal sirve para entrar y el hash guardado no la contiene.
      const created = await prisma.user.findUniqueOrThrow({ where: { username: 'wilmer' } });
      expect(created.passwordHash).not.toContain(response.body.temporaryPassword);
      await expect(
        app.get(PasswordService).verify(created.passwordHash, response.body.temporaryPassword),
      ).resolves.toBe(true);
    });

    it('rechaza un nombre de usuario repetido', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(adminHeaders)
        .send({ name: 'Wilmer', username: 'wilmer', role: 'OPERATOR' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(adminHeaders)
        .send({ name: 'Otro Wilmer', username: 'wilmer', role: 'VET' })
        .expect(409);
      expect(response.body.code).toBe('USERNAME_TAKEN');
    });

    it('valida el formato del nombre de usuario (08 §2.4)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(adminHeaders)
        .send({ name: 'Con Espacios', username: 'con espacios', role: 'OPERATOR' })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors).toHaveProperty('username');
    });

    it('deja constancia en la auditoría, sin la contraseña temporal', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(adminHeaders)
        .send({ name: 'Yeison Mendoza', username: 'yeison', role: 'OPERATOR' })
        .expect(201);

      const logs = await prisma.auditLog.findMany({ where: { entity: 'User' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'CREATE', farmId: esperanza.farmId });

      const serialized = JSON.stringify(logs, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).not.toContain(response.body.temporaryPassword);
    });
  });

  describe('editar y desactivar', () => {
    it('cambia nombre y rol', async () => {
      const { userId } = await createMember(prisma, esperanza, ROLE.OPERATOR);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(adminHeaders)
        .send({ name: 'Nombre Corregido', role: 'VET' })
        .expect(200);

      expect(response.body).toMatchObject({ name: 'Nombre Corregido', role: 'VET' });
      const membership = await prisma.membership.findFirstOrThrow({ where: { userId } });
      expect(membership.role).toBe('VET');
    });

    it('desactivar revoca las sesiones del usuario (AUT-03 CA2)', async () => {
      const { userId } = await createMember(prisma, esperanza, ROLE.OPERATOR);
      await prisma.refreshToken.create({
        data: {
          id: uuidv7(),
          userId,
          farmId: esperanza.farmId,
          tokenHash: `hash-${uuidv7()}`,
          familyId: uuidv7(),
          familyStartedAt: new Date('2026-09-25T12:00:00Z'),
          lastUsedAt: new Date('2026-09-25T12:00:00Z'),
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        },
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(adminHeaders)
        .send({ isActive: false })
        .expect(200);

      const vigentes = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
      expect(vigentes).toBe(0);
    });

    it('rechaza un cambio vacío', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${esperanza.userId}`)
        .set(adminHeaders)
        .send({})
        .expect(422);
    });
  });

  describe('último administrador (AUT-03 CA1)', () => {
    it('no se puede desactivar al único ADMIN activo', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${esperanza.userId}`)
        .set(adminHeaders)
        .send({ isActive: false })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'LAST_ADMIN',
        detail: 'La finca debe tener al menos un administrador activo.',
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: esperanza.userId } });
      expect(user.isActive).toBe(true);
    });

    it('tampoco se le puede degradar de rol', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${esperanza.userId}`)
        .set(adminHeaders)
        .send({ role: 'OPERATOR' })
        .expect(409);
      expect(response.body.code).toBe('LAST_ADMIN');
    });

    it('con otro ADMIN activo sí se puede', async () => {
      await createMember(prisma, esperanza, ROLE.ADMIN);

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${esperanza.userId}`)
        .set(adminHeaders)
        .send({ role: 'OPERATOR' })
        .expect(200);
    });

    it('un ADMIN desactivado no cuenta como administrador activo', async () => {
      const otro = await createMember(prisma, esperanza, ROLE.ADMIN, { isActive: false });
      expect(otro.userId).toBeDefined();

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${esperanza.userId}`)
        .set(adminHeaders)
        .send({ isActive: false })
        .expect(409);
      expect(response.body.code).toBe('LAST_ADMIN');
    });

    it('el ADMIN de otra finca no cuenta para esta', async () => {
      await createMember(prisma, palmar, ROLE.ADMIN);

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${esperanza.userId}`)
        .set(adminHeaders)
        .send({ isActive: false })
        .expect(409);
    });
  });

  describe('restablecer contraseña (AUT-04 CA2)', () => {
    it('genera una temporal nueva, obliga a cambiarla y cierra sus sesiones', async () => {
      const { userId } = await createMember(prisma, esperanza, ROLE.OPERATOR);
      await prisma.refreshToken.create({
        data: {
          id: uuidv7(),
          userId,
          farmId: esperanza.farmId,
          tokenHash: `hash-${uuidv7()}`,
          familyId: uuidv7(),
          familyStartedAt: new Date('2026-09-25T12:00:00Z'),
          lastUsedAt: new Date('2026-09-25T12:00:00Z'),
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        },
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/${userId}/reset-password`)
        .set(adminHeaders)
        .expect(201);

      expect(response.body.temporaryPassword).toMatch(/^[a-z2-9]{4}-/);
      expect(response.body.user.mustChangePassword).toBe(true);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await expect(
        app.get(PasswordService).verify(updated.passwordHash, response.body.temporaryPassword),
      ).resolves.toBe(true);
    });
  });
});

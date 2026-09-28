import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7, type Role, type SessionView } from '@hato/shared';
import request from 'supertest';

import { REFRESH_COOKIE } from '../src/auth/auth.controller.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, type FakeClock } from './helpers/app.js';
import { cleanDatabase, createFarm, type TestFarm } from './helpers/fixtures.js';

/**
 * Sesión deslizante y sesiones activas (AUT-10, AUT-11; ADR-007 decisión 6) contra PostgreSQL
 * real, con el reloj falso para recorrer meses en milisegundos. Los topes son los de
 * `.env.example`: 30 días desde el último uso y 180 desde el inicio de sesión.
 */

const PASSWORD = 'clave-de-prueba-123';
const DAY_MINUTES = 24 * 60;

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0';

/** Una sesión abierta en un «equipo»: su token de acceso y su cookie de refresco. */
type Device = { accessToken: string; cookie: string };

describe('Sesiones (AUT-10, AUT-11)', () => {
  let app: NestFastifyApplication;
  let clock: FakeClock;
  let prisma: PrismaService;
  let farm: TestFarm;
  let otherFarm: TestFarm;

  const http = () => request(app.getHttpServer());

  const addUser = async (username: string, role: Role, farms: TestFarm[]): Promise<string> => {
    const id = uuidv7();
    await prisma.user.create({
      data: {
        id,
        name: `Usuario ${username}`,
        username,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        memberships: {
          create: farms.map((item) => ({ id: uuidv7(), farmId: item.farmId, role })),
        },
      },
    });
    return id;
  };

  const cookieOf = (response: request.Response): string => {
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const found = cookies.find((value) => value?.startsWith(`${REFRESH_COOKIE}=`));
    if (found === undefined) throw new Error('La respuesta no trae la cookie de refresco.');
    return found;
  };

  const device = (response: request.Response): Device => ({
    accessToken: (response.body as { accessToken: string }).accessToken,
    cookie: cookieOf(response).split(';')[0] ?? '',
  });

  const signIn = async (
    login: string,
    userAgent = CHROME_ANDROID,
    farmId?: string,
  ): Promise<Device> =>
    device(
      await http()
        .post('/api/v1/auth/login')
        .set('user-agent', userAgent)
        .send({ login, password: PASSWORD, ...(farmId === undefined ? {} : { farmId }) })
        .expect(201),
    );

  const refresh = (session: Device) =>
    http().post('/api/v1/auth/refresh').set('cookie', session.cookie).send();

  /** Renueva y devuelve el equipo con los tokens nuevos. */
  const renew = async (session: Device): Promise<Device> =>
    device(await refresh(session).expect(201));

  const sessionsOf = async (session: Device): Promise<SessionView[]> =>
    (
      (await http().get('/api/v1/auth/sessions').set(bearer(session.accessToken)).expect(200))
        .body as { items: SessionView[] }
    ).items;

  /** ¿El token de acceso todavía abre algo? */
  const canAccess = async (session: Device): Promise<boolean> => {
    const response = await http().get('/api/v1/me').set(bearer(session.accessToken));
    return response.status === 200;
  };

  beforeAll(async () => {
    ({ app, clock } = await createTestAppWithClock());
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'La Esperanza');
    otherFarm = await createFarm(prisma, 'El Retiro');
    await addUser('alvaro', ROLE.ADMIN, [farm]);
  });

  describe('sesión deslizante (AUT-10)', () => {
    it('renovada a diario no vence a los 30 días', async () => {
      let session = await signIn('alvaro');
      for (let day = 1; day <= 45; day += 1) {
        clock.advanceMinutes(DAY_MINUTES);
        session = await renew(session);
      }
      expect(await canAccess(session)).toBe(true);
    });

    it('sin uso durante más de 30 días vence, con el error genérico y sin datos del usuario', async () => {
      const session = await signIn('alvaro');
      clock.advanceMinutes(30 * DAY_MINUTES + 1);
      const response = await refresh(session).expect(401);
      expect(response.body).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
      expect(response.body.context).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('alvaro');
    });

    it('al cumplir REFRESH_MAX_AGE_DAYS responde AUTH_SESSION_MAX_AGE con el usuario', async () => {
      let session = await signIn('alvaro');
      for (let day = 20; day <= 160; day += 20) {
        clock.advanceMinutes(20 * DAY_MINUTES);
        session = await renew(session);
      }
      // Día 160: la cookie ya no dura 30 días, sino los 20 que faltan para el tope.
      const lastRenewal = await refresh(session).expect(201);
      expect(cookieOf(lastRenewal)).toContain(`Max-Age=${20 * 24 * 60 * 60}`);
      session = device(lastRenewal);

      clock.advanceMinutes(19 * DAY_MINUTES);
      session = await renew(session); // día 179: todavía sirve

      clock.advanceMinutes(DAY_MINUTES); // día 180
      const response = await refresh(session).expect(401);
      expect(response.body).toMatchObject({
        code: 'AUTH_SESSION_MAX_AGE',
        detail: 'Por seguridad, vuelve a escribir tu contraseña.',
        context: { login: 'alvaro' },
      });

      // La contraseña abre una familia nueva, con otros 180 días por delante.
      const fresh = await signIn('alvaro');
      clock.advanceMinutes(29 * DAY_MINUTES);
      await renew(fresh);
    });

    it('un token revocado, reutilizado o desconocido nunca trae el usuario, aunque pase el tope', async () => {
      const first = await signIn('alvaro');
      const rotated = await renew(first);
      clock.advanceMinutes(181 * DAY_MINUTES);

      for (const cookie of [first.cookie, `${REFRESH_COOKIE}=valor-inventado`]) {
        const response = await http()
          .post('/api/v1/auth/refresh')
          .set('cookie', cookie)
          .send()
          .expect(401);
        expect(response.body).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
        expect(response.body.context).toBeUndefined();
      }
      // La reutilización de `first` revocó la familia: `rotated` tampoco da el usuario.
      const response = await refresh(rotated).expect(401);
      expect(response.body).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
      expect(response.body.context).toBeUndefined();
    });

    it('el último uso se escribe como máximo una vez por hora (AUT-11 CA4)', async () => {
      let session = await signIn('alvaro');
      const [started] = await sessionsOf(session);

      clock.advanceMinutes(30);
      session = await renew(session);
      clock.advanceMinutes(29);
      session = await renew(session);
      expect((await sessionsOf(session))[0]?.lastUsedAt).toBe(started?.lastUsedAt);

      clock.advanceMinutes(2); // 61 minutos desde el último registro
      session = await renew(session);
      const [after] = await sessionsOf(session);
      expect(after?.lastUsedAt).toBe(clock.now().toISOString());
      expect(after?.startedAt).toBe(started?.startedAt);
    });
  });

  describe('sesiones activas (AUT-11)', () => {
    it('lista los equipos con su nombre, inicio y último uso, y marca «Este equipo»', async () => {
      await signIn('alvaro', EDGE_WINDOWS);
      clock.advanceMinutes(90);
      const phone = await signIn('alvaro', CHROME_ANDROID);

      const sessions = await sessionsOf(phone);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({ device: 'Chrome · Android', current: true });
      expect(sessions[1]).toMatchObject({ device: 'Edge · Windows', current: false });
      expect(sessions[0]?.startedAt).toBe(clock.now().toISOString());
    });

    it('cerrar una sesión corta su acceso al instante y solo el de esa familia', async () => {
      const laptop = await signIn('alvaro', EDGE_WINDOWS);
      const phone = await signIn('alvaro', CHROME_ANDROID);
      const laptopId = (await sessionsOf(laptop)).find((item) => item.current)?.id;

      await http()
        .post(`/api/v1/auth/sessions/${laptopId}/revoke`)
        .set(bearer(phone.accessToken))
        .expect(201, { ok: true, current: false });

      // Ajuste A: el token de acceso de la sesión cerrada recibe 401 de inmediato.
      const denied = await http().get('/api/v1/me').set(bearer(laptop.accessToken)).expect(401);
      expect(denied.body).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
      await refresh(laptop).expect(401);
      expect(await canAccess(phone)).toBe(true);
      expect(await sessionsOf(phone)).toHaveLength(1);
    });

    it('cerrar la sesión actual equivale a salir: borra la cookie', async () => {
      const phone = await signIn('alvaro');
      const [current] = await sessionsOf(phone);
      const response = await http()
        .post(`/api/v1/auth/sessions/${current?.id}/revoke`)
        .set(bearer(phone.accessToken))
        .expect(201, { ok: true, current: true });
      expect(cookieOf(response)).toMatch(/hato_refresh=;/);
      expect(await canAccess(phone)).toBe(false);
    });

    it('«Cerrar las demás» conserva la actual y corta las otras al instante', async () => {
      const laptop = await signIn('alvaro', EDGE_WINDOWS);
      const tablet = await signIn('alvaro', FIREFOX_WINDOWS);
      const phone = await signIn('alvaro', CHROME_ANDROID);

      await http()
        .post('/api/v1/auth/sessions/revoke-others')
        .set(bearer(phone.accessToken))
        .expect(201, { revoked: 2 });

      expect(await canAccess(laptop)).toBe(false);
      expect(await canAccess(tablet)).toBe(false);
      expect(await canAccess(phone)).toBe(true);
      await renew(phone);
      expect(await sessionsOf(phone)).toHaveLength(1);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { farmId: farm.farmId, action: 'REVOKE_SESSIONS' },
        orderBy: { id: 'desc' },
      });
      expect(audit.diff).toEqual({ revokedSessions: 2, which: 'others' });
    });

    it('no cierra la sesión de otro usuario: 404', async () => {
      await addUser('wilmer', ROLE.OPERATOR, [farm]);
      const wilmer = await signIn('wilmer');
      const wilmerSession = (await sessionsOf(wilmer))[0]?.id;
      const alvaro = await signIn('alvaro');

      await http()
        .post(`/api/v1/auth/sessions/${wilmerSession}/revoke`)
        .set(bearer(alvaro.accessToken))
        .expect(404);
      expect(await canAccess(wilmer)).toBe(true);
    });

    it('sin sesión: 401', async () => {
      await http().get('/api/v1/auth/sessions').expect(401);
      await http().post('/api/v1/auth/sessions/revoke-others').expect(401);
    });
  });

  describe('el ADMIN cierra las sesiones de un usuario (AUT-11 CA3)', () => {
    it('cierra todas sus sesiones, también en otra finca, y queda auditado', async () => {
      const wilmerId = await addUser('wilmer', ROLE.OPERATOR, [farm, otherFarm]);
      const here = await signIn('wilmer', CHROME_ANDROID, farm.farmId);
      const there = await signIn('wilmer', EDGE_WINDOWS, otherFarm.farmId);
      const admin = await signIn('alvaro');

      await http()
        .post(`/api/v1/users/${wilmerId}/sessions/revoke`)
        .set(bearer(admin.accessToken))
        .expect(201, { revoked: 2 });

      expect(await canAccess(here)).toBe(false);
      expect(await canAccess(there)).toBe(false);
      await refresh(here).expect(401);
      expect(await canAccess(admin)).toBe(true);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { farmId: farm.farmId, entity: 'User', entityId: wilmerId },
        orderBy: { id: 'desc' },
      });
      expect(audit).toMatchObject({ action: 'REVOKE_SESSIONS', diff: { revokedSessions: 2 } });
    });

    it('OPERATOR y VET no pueden: 403', async () => {
      const wilmerId = await addUser('wilmer', ROLE.OPERATOR, [farm]);
      await addUser('paola', ROLE.VET, [farm]);
      for (const login of ['wilmer', 'paola']) {
        const session = await signIn(login);
        await http()
          .post(`/api/v1/users/${wilmerId}/sessions/revoke`)
          .set(bearer(session.accessToken))
          .expect(403);
      }
    });

    it('el ADMIN de otra finca no puede: 404, y las sesiones siguen abiertas', async () => {
      const wilmerId = await addUser('wilmer', ROLE.OPERATOR, [farm]);
      const wilmer = await signIn('wilmer');
      await addUser('retiro.admin', ROLE.ADMIN, [otherFarm]);
      const outsider = await signIn('retiro.admin');

      await http()
        .post(`/api/v1/users/${wilmerId}/sessions/revoke`)
        .set(bearer(outsider.accessToken))
        .expect(404);
      expect(await canAccess(wilmer)).toBe(true);
    });
  });

  describe('lo que revoca todas las sesiones (AUT-10 CA3)', () => {
    it('cambiar la contraseña cierra los demás equipos y entrega una sesión nueva', async () => {
      const laptop = await signIn('alvaro', EDGE_WINDOWS);
      const phone = await signIn('alvaro', CHROME_ANDROID);

      const response = await http()
        .post('/api/v1/auth/change-password')
        .set(bearer(phone.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'clave-nueva-456789' })
        .expect(201);

      expect(await canAccess(laptop)).toBe(false);
      expect(await canAccess(phone)).toBe(false);
      const fresh = device(response);
      expect(await canAccess(fresh)).toBe(true);
      expect(await sessionsOf(fresh)).toHaveLength(1);
    });

    it('desactivar al usuario (quitarle la membresía) cierra sus sesiones en la misma operación', async () => {
      const wilmerId = await addUser('wilmer', ROLE.OPERATOR, [farm]);
      const wilmer = await signIn('wilmer');
      const admin = await signIn('alvaro');

      await http()
        .patch(`/api/v1/users/${wilmerId}`)
        .set(bearer(admin.accessToken))
        .send({ isActive: false })
        .expect(200);

      expect(await canAccess(wilmer)).toBe(false);
      await refresh(wilmer).expect(401);
      const open = await prisma.refreshToken.count({
        where: { userId: wilmerId, revokedAt: null },
      });
      expect(open).toBe(0);
    });
  });
});

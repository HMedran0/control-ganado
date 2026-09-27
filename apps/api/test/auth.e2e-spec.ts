import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7 } from '@hato/shared';
import request from 'supertest';

import { PasswordService } from '../src/auth/password.service.js';
import { REFRESH_COOKIE } from '../src/auth/auth.controller.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../src/auth/token.service.js';
import { LOCK_WINDOW_MINUTES, MAX_FAILED_ATTEMPTS } from '../src/auth/login-attempts.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken, type FakeClock } from './helpers/app.js';
import { cleanDatabase, createFarm, type TestFarm } from './helpers/fixtures.js';

/**
 * Autenticación de extremo a extremo contra PostgreSQL real (AUT-01 a AUT-04).
 *
 * El reloj es falso, así que los vencimientos y el bloqueo se comprueban adelantándolo en
 * lugar de esperar quince minutos.
 */

const PASSWORD = 'clave-de-alvaro-123';
const OTHER_PASSWORD = 'clave-de-wilmer-456';

describe('Autenticación', () => {
  let app: NestFastifyApplication;
  let clock: FakeClock;
  let prisma: PrismaService;
  let farm: TestFarm;
  let admin: { id: string; username: string };
  let operator: { id: string; username: string };

  /** Crea un usuario con contraseña utilizable y membresía en la finca. */
  const addUser = async (
    username: string,
    password: string,
    role: (typeof ROLE)[keyof typeof ROLE],
    options: { email?: string; mustChangePassword?: boolean; farm?: TestFarm } = {},
  ): Promise<{ id: string; username: string }> => {
    const id = uuidv7();
    await prisma.user.create({
      data: {
        id,
        name: `Usuario ${username}`,
        username,
        email: options.email ?? null,
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: options.mustChangePassword ?? false,
        memberships: {
          create: { id: uuidv7(), farmId: (options.farm ?? farm).farmId, role },
        },
      },
    });
    return { id, username };
  };

  const login = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send(body);

  /** Extrae la cookie del refresh token de una respuesta. */
  const refreshCookie = (response: request.Response): string => {
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const found = cookies.find((value) => value?.startsWith(`${REFRESH_COOKIE}=`));
    if (found === undefined) throw new Error('La respuesta no trae la cookie de refresco.');
    return found.split(';')[0] ?? '';
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
    admin = await addUser('alvaro', PASSWORD, ROLE.ADMIN, { email: 'alvaro@demo.co' });
    operator = await addUser('wilmer', OTHER_PASSWORD, ROLE.OPERATOR);
  });

  describe('inicio de sesión (AUT-01)', () => {
    it('entra con el nombre de usuario', async () => {
      const response = await login({ login: 'alvaro', password: PASSWORD }).expect(201);

      expect(response.body).toMatchObject({
        user: { username: 'alvaro', mustChangePassword: false },
        farm: { id: farm.farmId, name: 'La Esperanza' },
        role: 'ADMIN',
      });
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user.passwordHash).toBeUndefined();
    });

    it('entra con el correo', async () => {
      const response = await login({ login: 'ALVARO@demo.co', password: PASSWORD }).expect(201);
      expect(response.body.user.username).toBe('alvaro');
    });

    it('deja la cookie del refresco con HttpOnly, Secure, SameSite=Strict y su ruta', async () => {
      const response = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const raw = response.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw : [raw]).find((value) =>
        value?.startsWith(`${REFRESH_COOKIE}=`),
      );

      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);
      // El valor del refresco no puede aparecer en el cuerpo.
      expect(JSON.stringify(response.body)).not.toContain(cookie?.split('=')[1]?.slice(0, 20));
    });

    it('da el mismo mensaje exista o no el usuario (AUT-01 CA2)', async () => {
      const inexistente = await login({ login: 'no-existe', password: 'lo-que-sea' }).expect(401);
      const claveMala = await login({ login: 'alvaro', password: 'equivocada' }).expect(401);

      expect(inexistente.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(inexistente.body.detail).toBe('Usuario o contraseña incorrectos.');
      expect(claveMala.body.code).toBe(inexistente.body.code);
      expect(claveMala.body.detail).toBe(inexistente.body.detail);
    });

    it('tarda lo mismo con un usuario inexistente que con una contraseña mala', async () => {
      const medir = async (body: Record<string, unknown>): Promise<number> => {
        const started = performance.now();
        await login(body).expect(401);
        return performance.now() - started;
      };
      // Se descarta la primera medición: incluye el arranque en frío de Argon2.
      await medir({ login: 'alvaro', password: 'equivocada' });

      const conUsuario = await medir({ login: 'alvaro', password: 'equivocada' });
      const sinUsuario = await medir({ login: 'no-existe', password: 'equivocada' });
      const proporcion = Math.max(conUsuario, sinUsuario) / Math.min(conUsuario, sinUsuario);

      // No se comparan milisegundos exactos, solo que sean del mismo orden: lo que delata
      // la existencia de un usuario es una diferencia de decenas de veces.
      expect(proporcion).toBeLessThan(4);
    });

    it('un usuario desactivado no entra (AUT-03 CA2)', async () => {
      await prisma.user.update({ where: { id: operator.id }, data: { isActive: false } });
      const response = await login({ login: 'wilmer', password: OTHER_PASSWORD }).expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('registra el inicio de sesión en la auditoría, sin contraseñas ni tokens', async () => {
      await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const logs = await prisma.auditLog.findMany({ where: { action: 'LOGIN' } });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ farmId: farm.farmId, userId: admin.id, entity: 'Session' });
      // `audit_logs.id` es BigInt y no es serializable por defecto.
      const serialized = JSON.stringify(logs, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized.toLowerCase()).not.toContain('token');
    });

    it('guarda el intento fallido de un usuario inexistente solo en login_attempts', async () => {
      await login({ login: 'fantasma', password: 'x' }).expect(401);

      const attempts = await prisma.loginAttempt.findMany({ where: { login: 'fantasma' } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.succeeded).toBe(false);
      expect(await prisma.auditLog.count()).toBe(0);
    });
  });

  describe('bloqueo por intentos fallidos (AUT-01 CA3)', () => {
    const fallar = async (): Promise<void> => {
      await login({ login: 'alvaro', password: 'equivocada' }).expect(401);
    };

    it('bloquea al quinto intento', async () => {
      for (let intento = 0; intento < MAX_FAILED_ATTEMPTS - 1; intento += 1) await fallar();

      // El quinto fallo aún responde «credenciales inválidas»; el bloqueo aplica al siguiente.
      await fallar();
      const response = await login({ login: 'alvaro', password: PASSWORD }).expect(423);
      expect(response.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    });

    it('sigue bloqueada 15 minutos desde el último fallo, no desde el primero', async () => {
      // El caso que una ventana deslizante simple resolvería mal: fallos en los minutos
      // 0, 1, 2, 3 y 14. Al minuto 15 los cuatro primeros ya salieron de la ventana.
      for (const minuto of [0, 1, 1, 1, 10]) {
        clock.advanceMinutes(minuto);
        await fallar();
      }

      clock.advanceMinutes(2); // minuto 15 desde el primer fallo
      expect((await login({ login: 'alvaro', password: PASSWORD }).expect(423)).body.code).toBe(
        'AUTH_ACCOUNT_LOCKED',
      );

      clock.advanceMinutes(LOCK_WINDOW_MINUTES); // pasaron 15 min desde el último fallo
      await login({ login: 'alvaro', password: PASSWORD }).expect(201);
    });

    it('un intento durante el bloqueo no lo prolonga', async () => {
      for (let intento = 0; intento < MAX_FAILED_ATTEMPTS; intento += 1) await fallar();

      // A los 10 minutos alguien insiste: se rechaza, pero el bloqueo sigue venciendo
      // a los 15 del último fallo real.
      clock.advanceMinutes(10);
      await login({ login: 'alvaro', password: 'otra-equivocada' }).expect(423);

      clock.advanceMinutes(6);
      await login({ login: 'alvaro', password: PASSWORD }).expect(201);
    });

    it('un inicio de sesión exitoso reinicia el conteo', async () => {
      for (let intento = 0; intento < MAX_FAILED_ATTEMPTS - 1; intento += 1) await fallar();
      await login({ login: 'alvaro', password: PASSWORD }).expect(201);

      // Cuatro fallos más no alcanzan: los anteriores ya no cuentan.
      for (let intento = 0; intento < MAX_FAILED_ATTEMPTS - 1; intento += 1) await fallar();
      await login({ login: 'alvaro', password: PASSWORD }).expect(201);
    });

    it('el bloqueo de una cuenta no afecta a los demás usuarios de la misma IP', async () => {
      // En una finca todos comparten la IP pública. Las pruebas también salen de una sola IP,
      // que es justo ese caso: alvaro queda bloqueado y wilmer sigue entrando.
      for (let intento = 0; intento < MAX_FAILED_ATTEMPTS; intento += 1) await fallar();
      await login({ login: 'alvaro', password: PASSWORD }).expect(423);

      await login({ login: 'wilmer', password: OTHER_PASSWORD }).expect(201);
    });

    it('fallos repartidos entre varias cuentas desde una IP no bloquean a nadie', async () => {
      // Cinco errores en total desde la misma IP, ninguna cuenta con cinco.
      for (const cuenta of ['alvaro', 'alvaro', 'wilmer', 'wilmer', 'fantasma']) {
        await login({ login: cuenta, password: 'equivocada' }).expect(401);
      }

      await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      await login({ login: 'wilmer', password: OTHER_PASSWORD }).expect(201);
    });
  });

  describe('token de acceso y rotación del refresco', () => {
    it('un token vencido responde AUTH_TOKEN_EXPIRED', async () => {
      const token = (await login({ login: 'alvaro', password: PASSWORD }).expect(201)).body
        .accessToken as string;

      await request(app.getHttpServer()).get('/api/v1/me').set(bearer(token)).expect(200);

      clock.advanceMinutes(ACCESS_TOKEN_TTL_SECONDS / 60 + 1);
      const response = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(bearer(token))
        .expect(401);
      expect(response.body.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('el refresco entrega tokens nuevos y revoca el anterior', async () => {
      const first = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const cookie = refreshCookie(first);

      clock.advanceMinutes(1);
      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(201);

      expect(second.body.accessToken).not.toBe(first.body.accessToken);
      expect(refreshCookie(second)).not.toBe(cookie);
      expect(second.body.farm.id).toBe(farm.farmId);

      const stored = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
      expect(stored).toHaveLength(2);
      expect(stored[0]?.revokedAt).not.toBeNull();
      expect(stored[1]?.revokedAt).toBeNull();
      // La familia se conserva entre rotaciones.
      expect(stored[0]?.familyId).toBe(stored[1]?.familyId);
    });

    it('reutilizar un refresco ya rotado revoca toda la familia', async () => {
      const first = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const viejo = refreshCookie(first);

      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', viejo)
        .expect(201);
      const nuevo = refreshCookie(second);

      // Alguien usa el token viejo: se cae la sesión entera.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', viejo)
        .expect(401);

      const vigentes = await prisma.refreshToken.count({ where: { revokedAt: null } });
      expect(vigentes).toBe(0);

      // El que era bueno tampoco sirve ya.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', nuevo)
        .expect(401);
    });

    it('el refresco guarda solo el hash, nunca el valor', async () => {
      const response = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const value = refreshCookie(response).split('=')[1] ?? '';

      const stored = await prisma.refreshToken.findFirstOrThrow();
      expect(stored.tokenHash).not.toContain(value);
      expect(value.length).toBeGreaterThan(20);
    });

    it('cerrar sesión revoca el refresco (AUT-02)', async () => {
      const response = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const cookie = refreshCookie(response);
      const token = response.body.accessToken as string;

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(bearer(token))
        .set('Cookie', cookie)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });
  });

  describe('desactivación inmediata (AUT-03 CA2)', () => {
    it('desactivar a un usuario invalida su token de acceso vigente', async () => {
      const token = (await login({ login: 'wilmer', password: OTHER_PASSWORD }).expect(201)).body
        .accessToken as string;
      await request(app.getHttpServer()).get('/api/v1/me').set(bearer(token)).expect(200);

      await prisma.user.update({ where: { id: operator.id }, data: { isActive: false } });

      const response = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(bearer(token))
        .expect(401);
      expect(response.body.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('desactivar la membresía también corta el acceso, sin tocar la cuenta', async () => {
      const token = (await login({ login: 'wilmer', password: OTHER_PASSWORD }).expect(201)).body
        .accessToken as string;

      await prisma.membership.updateMany({
        where: { userId: operator.id, farmId: farm.farmId },
        data: { isActive: false },
      });

      await request(app.getHttpServer()).get('/api/v1/me').set(bearer(token)).expect(401);
    });

    it('cambiar el rol aplica de inmediato, sin esperar a que venza el token', async () => {
      const token = (await login({ login: 'wilmer', password: OTHER_PASSWORD }).expect(201)).body
        .accessToken as string;

      await request(app.getHttpServer()).get('/api/v1/users').set(bearer(token)).expect(403);

      await prisma.membership.updateMany({
        where: { userId: operator.id, farmId: farm.farmId },
        data: { role: ROLE.ADMIN },
      });

      await request(app.getHttpServer()).get('/api/v1/users').set(bearer(token)).expect(200);
    });
  });

  describe('contraseña temporal (AUT-04)', () => {
    it('bloquea el resto de endpoints hasta cambiarla', async () => {
      await addUser('yeison', 'temporal-1234', ROLE.OPERATOR, { mustChangePassword: true });
      const token = (await login({ login: 'yeison', password: 'temporal-1234' }).expect(201)).body
        .accessToken as string;

      const bloqueado = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(bearer(token))
        .expect(403);
      expect(bloqueado.body.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set(bearer(token))
        .send({ currentPassword: 'temporal-1234', newPassword: 'la-definitiva-99' })
        .expect(201);

      const nuevo = (await login({ login: 'yeison', password: 'la-definitiva-99' }).expect(201))
        .body.accessToken as string;
      await request(app.getHttpServer()).get('/api/v1/me').set(bearer(nuevo)).expect(200);
    });

    it('permite cerrar sesión aunque la contraseña siga siendo temporal', async () => {
      await addUser('yeison', 'temporal-1234', ROLE.OPERATOR, { mustChangePassword: true });
      const response = await login({ login: 'yeison', password: 'temporal-1234' }).expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(bearer(response.body.accessToken as string))
        .set('Cookie', refreshCookie(response))
        .expect(201);
    });

    it('rechaza el cambio si la contraseña actual no es la correcta', async () => {
      const token = (await login({ login: 'alvaro', password: PASSWORD }).expect(201)).body
        .accessToken as string;

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set(bearer(token))
        .send({ currentPassword: 'no-es-esa', newPassword: 'una-nueva-1234' })
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('cambiar la contraseña revoca las demás sesiones', async () => {
      const primera = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      const segunda = await login({ login: 'alvaro', password: PASSWORD }).expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set(bearer(segunda.body.accessToken as string))
        .send({ currentPassword: PASSWORD, newPassword: 'la-nueva-4321' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie(primera))
        .expect(401);
    });
  });

  describe('GET /me', () => {
    it('devuelve el usuario, la finca y el rol vigentes', async () => {
      const token = (await login({ login: 'alvaro', password: PASSWORD }).expect(201)).body
        .accessToken as string;

      const response = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(bearer(token))
        .expect(200);

      expect(response.body).toMatchObject({
        userId: admin.id,
        farm: { id: farm.farmId, name: 'La Esperanza' },
        role: 'ADMIN',
      });
    });

    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    });
  });

  describe('varias fincas', () => {
    it('sin farmId entra a la membresía más antigua y lista las demás', async () => {
      const palmar = await createFarm(prisma, 'El Palmar');
      await prisma.membership.create({
        data: { id: uuidv7(), userId: admin.id, farmId: palmar.farmId, role: ROLE.VET },
      });

      const response = await login({ login: 'alvaro', password: PASSWORD }).expect(201);
      expect(response.body.farm.id).toBe(farm.farmId);
      expect(response.body.memberships).toHaveLength(2);
    });

    it('con farmId entra a esa finca y la rotación la conserva', async () => {
      const palmar = await createFarm(prisma, 'El Palmar');
      await prisma.membership.create({
        data: { id: uuidv7(), userId: admin.id, farmId: palmar.farmId, role: ROLE.VET },
      });

      const response = await login({
        login: 'alvaro',
        password: PASSWORD,
        farmId: palmar.farmId,
      }).expect(201);
      expect(response.body.farm.id).toBe(palmar.farmId);
      expect(response.body.role).toBe('VET');

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie(response))
        .expect(201);
      expect(refreshed.body.farm.id).toBe(palmar.farmId);
    });

    it('pedir una finca ajena no revela que existe', async () => {
      const ajena = await createFarm(prisma, 'Finca ajena');
      const response = await login({
        login: 'alvaro',
        password: PASSWORD,
        farmId: ajena.farmId,
      }).expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  it('el token de otra finca no sirve para esta', async () => {
    const palmar = await createFarm(prisma, 'El Palmar');
    const token = await signTestToken(app, {
      userId: palmar.userId,
      farmId: palmar.farmId,
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(bearer(token))
      .expect(200);
    expect(response.body.farm.id).toBe(palmar.farmId);
    expect(response.body.farm.id).not.toBe(farm.farmId);
  });
});

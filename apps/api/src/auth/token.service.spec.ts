import { ROLE } from '@hato/shared';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { Clock } from '../infra/clock.service.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
  TokenService,
} from './token.service.js';

/** Reloj controlable: los vencimientos se prueban adelantándolo, no esperando. */
class FakeClock extends Clock {
  current = new Date('2026-09-25T12:00:00.000Z');

  constructor() {
    super({ APP_TIMEZONE: 'America/Bogota', CLOCK_FIXED_TODAY: undefined });
  }

  override now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

const SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres-1234';
const PEPPER = 'pimienta-de-prueba-de-al-menos-32-caracteres-12';
const ENV = {
  JWT_ACCESS_SECRET: SECRET,
  REFRESH_TOKEN_PEPPER: PEPPER,
  REFRESH_TTL_DAYS: 30,
  REFRESH_MAX_AGE_DAYS: 180,
};
const DAY = 86_400_000;

describe('TokenService', () => {
  let clock: FakeClock;
  let tokens: TokenService;

  beforeEach(() => {
    clock = new FakeClock();
    tokens = new TokenService(ENV as never, clock);
  });

  describe('token de acceso', () => {
    it('firma y verifica con el usuario, la finca, el rol y la sesión', async () => {
      const token = await tokens.signAccessToken({
        userId: 'u-1',
        farmId: 'f-1',
        role: ROLE.OPERATOR,
        sessionId: 's-1',
      });
      await expect(tokens.verifyAccessToken(token)).resolves.toEqual({
        userId: 'u-1',
        farmId: 'f-1',
        role: 'OPERATOR',
        sessionId: 's-1',
      });
    });

    it('rechaza un token sin sesión (emitido antes de M4d)', async () => {
      const sinSesion = await new SignJWT({ farmId: 'f', role: 'ADMIN' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('u')
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(Math.floor(clock.now().getTime() / 1000))
        .setExpirationTime(Math.floor(clock.now().getTime() / 1000) + 600)
        .sign(new TextEncoder().encode(SECRET));
      await expect(tokens.verifyAccessToken(sinSesion)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });
    });

    it('sigue valiendo justo antes de los 15 minutos', async () => {
      const token = await tokens.signAccessToken({
        userId: 'u',
        farmId: 'f',
        role: ROLE.ADMIN,
        sessionId: 's',
      });
      clock.advanceSeconds(ACCESS_TOKEN_TTL_SECONDS - 5);
      await expect(tokens.verifyAccessToken(token)).resolves.toMatchObject({ userId: 'u' });
    });

    it('vence a los 15 minutos', async () => {
      const token = await tokens.signAccessToken({
        userId: 'u',
        farmId: 'f',
        role: ROLE.ADMIN,
        sessionId: 's',
      });
      clock.advanceSeconds(ACCESS_TOKEN_TTL_SECONDS + 5);
      await expect(tokens.verifyAccessToken(token)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });
    });

    it('rechaza una firma de otro secreto', async () => {
      const otro = new TokenService(
        { ...ENV, JWT_ACCESS_SECRET: `${SECRET}-distinto` } as never,
        clock,
      );
      const token = await otro.signAccessToken({
        userId: 'u',
        farmId: 'f',
        role: ROLE.ADMIN,
        sessionId: 's',
      });
      await expect(tokens.verifyAccessToken(token)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });
    });

    it('rechaza un token con otro emisor o audiencia, aunque la firma sea buena', async () => {
      const secret = new TextEncoder().encode(SECRET);
      const ajeno = await new SignJWT({ farmId: 'f', role: 'ADMIN' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('u')
        .setIssuer('otro-sistema')
        .setAudience(JWT_AUDIENCE)
        .setExpirationTime('1h')
        .sign(secret);
      await expect(tokens.verifyAccessToken(ajeno)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });

      const otraAudiencia = await new SignJWT({ farmId: 'f', role: 'ADMIN' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('u')
        .setIssuer(JWT_ISSUER)
        .setAudience('otra-app')
        .setExpirationTime('1h')
        .sign(secret);
      await expect(tokens.verifyAccessToken(otraAudiencia)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });
    });

    it('rechaza basura', async () => {
      for (const value of ['', 'a.b.c', 'no-es-un-token']) {
        await expect(tokens.verifyAccessToken(value)).rejects.toMatchObject({
          code: 'AUTH_TOKEN_EXPIRED',
        });
      }
    });
  });

  describe('token de refresco', () => {
    it('emite un valor distinto cada vez y vence en 30 días', () => {
      const first = tokens.issueRefreshToken();
      const second = tokens.issueRefreshToken();

      expect(first.value).not.toBe(second.value);
      expect(first.tokenHash).not.toBe(second.tokenHash);
      const days = (first.expiresAt.getTime() - clock.now().getTime()) / DAY;
      expect(days).toBe(30);
      expect(first.familyStartedAt).toEqual(clock.now());
    });

    it('conserva la familia y su inicio al rotar, y crea una nueva si no se le pasa', () => {
      const first = tokens.issueRefreshToken();
      clock.advanceSeconds(3600);
      const rotated = tokens.issueRefreshToken({
        id: first.familyId,
        startedAt: first.familyStartedAt,
      });
      expect(rotated.familyId).toBe(first.familyId);
      expect(rotated.familyStartedAt).toEqual(first.familyStartedAt);
      expect(tokens.issueRefreshToken().familyId).not.toBe(first.familyId);
    });

    it('cada rotación extiende 30 días desde ese momento, sin pasar el tope de 180 (AUT-10)', () => {
      const first = tokens.issueRefreshToken();
      const family = { id: first.familyId, startedAt: first.familyStartedAt };
      clock.advanceSeconds((100 * DAY) / 1000);
      const day100 = tokens.issueRefreshToken(family);
      expect(day100.expiresAt.getTime() - first.familyStartedAt.getTime()).toBe(130 * DAY);

      clock.advanceSeconds((70 * DAY) / 1000);
      const day170 = tokens.issueRefreshToken(family);
      expect(day170.expiresAt).toEqual(tokens.familyCapAt(first.familyStartedAt));
      expect(day170.expiresAt.getTime() - first.familyStartedAt.getTime()).toBe(180 * DAY);
    });

    it('guarda solo el hash: del hash no se puede volver al valor', () => {
      const issued = tokens.issueRefreshToken();
      expect(issued.tokenHash).not.toContain(issued.value);
      expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('el hash depende de la pimienta', () => {
      const otro = new TokenService(
        { ...ENV, REFRESH_TOKEN_PEPPER: `${PEPPER}-x` } as never,
        clock,
      );
      const value = tokens.issueRefreshToken().value;
      expect(otro.hashRefreshToken(value)).not.toBe(tokens.hashRefreshToken(value));
    });

    it('compara hashes en tiempo constante', () => {
      const issued = tokens.issueRefreshToken();
      expect(tokens.matchesHash(issued.tokenHash, issued.value)).toBe(true);
      expect(tokens.matchesHash(issued.tokenHash, 'otro-valor')).toBe(false);
      expect(tokens.matchesHash('corto', issued.value)).toBe(false);
    });
  });
});

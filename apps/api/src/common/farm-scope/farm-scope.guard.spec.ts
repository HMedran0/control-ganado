import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { DomainError, ROLE, uuidv7 } from '@hato/shared';
import type { ExecutionContext } from '@nestjs/common';

import type { Env } from '../../config/env.schema.js';
import { FarmScopeGuard } from './farm-scope.guard.js';
import type { RequestWithScope } from './farm-scope.types.js';

function env(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'development',
    PORT: 3000,
    APP_TIMEZONE: 'America/Bogota',
    DATABASE_URL: 'postgresql://x/y',
    JWT_ACCESS_SECRET: 'x'.repeat(40),
    REFRESH_TOKEN_PEPPER: 'y'.repeat(40),
    CORS_ORIGINS: ['http://localhost:5173'],
    PUBLIC_WEB_URL: 'http://localhost:5173',
    DEV_FAKE_AUTH: true,
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

function contextFor(request: RequestWithScope): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function guardFor(environment: Env, isPublic = false): FarmScopeGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic ? true : undefined);
  return new FarmScopeGuard(environment, reflector);
}

describe('FarmScopeGuard', () => {
  const farmId = uuidv7();

  it('resuelve el ámbito desde las cabeceras cuando DEV_FAKE_AUTH está activo', () => {
    const userId = uuidv7();
    const request: RequestWithScope = {
      headers: { 'x-dev-farm-id': farmId, 'x-dev-role': 'OPERATOR', 'x-dev-user-id': userId },
    };

    expect(guardFor(env()).canActivate(contextFor(request))).toBe(true);
    expect(request.scope).toEqual({ farmId, userId, role: 'OPERATOR' });
  });

  it('sin rol en la cabecera asume ADMIN', () => {
    const request: RequestWithScope = { headers: { 'x-dev-farm-id': farmId } };
    guardFor(env()).canActivate(contextFor(request));
    expect(request.scope?.role).toBe(ROLE.ADMIN);
  });

  it('rechaza una finca que no es un UUID', () => {
    const request: RequestWithScope = { headers: { 'x-dev-farm-id': 'la-esperanza' } };
    expect(() => guardFor(env()).canActivate(contextFor(request))).toThrow(DomainError);
  });

  it('rechaza un rol que no existe', () => {
    const request: RequestWithScope = {
      headers: { 'x-dev-farm-id': farmId, 'x-dev-role': 'DUEÑO' },
    };
    expect(() => guardFor(env()).canActivate(contextFor(request))).toThrow(/x-dev-role/);
  });

  it('un endpoint público no necesita ámbito', () => {
    const request: RequestWithScope = { headers: {} };
    expect(guardFor(env(), true).canActivate(contextFor(request))).toBe(true);
    expect(request.scope).toBeUndefined();
  });

  describe('el mecanismo temporal está cerrado en producción', () => {
    // Doble cierre: el esquema de entorno impide arrancar (env.schema.spec.ts) y, si alguien
    // cambiara el esquema, el guard ignora las cabeceras de todas formas.
    it('en producción ignora las cabeceras y exige autenticación', () => {
      const request: RequestWithScope = {
        headers: { 'x-dev-farm-id': farmId, 'x-dev-role': 'ADMIN' },
      };
      const guard = guardFor(env({ NODE_ENV: 'production', DEV_FAKE_AUTH: true }));

      expect(() => guard.canActivate(contextFor(request))).toThrow(DomainError);
      expect(request.scope).toBeUndefined();
    });

    it('con DEV_FAKE_AUTH desactivado tampoco las lee', () => {
      const request: RequestWithScope = { headers: { 'x-dev-farm-id': farmId } };
      const guard = guardFor(env({ DEV_FAKE_AUTH: false }));

      expect(() => guard.canActivate(contextFor(request))).toThrow(DomainError);
      expect(request.scope).toBeUndefined();
    });

    it('el error pide iniciar sesión, en español', () => {
      const guard = guardFor(env({ DEV_FAKE_AUTH: false }));
      try {
        guard.canActivate(contextFor({ headers: {} }));
      } catch (error) {
        expect((error as DomainError).detail).toBe('Inicia sesión para continuar.');
      }
    });
  });
});

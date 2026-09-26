import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { DomainError, ROLE, uuidv7, type Role } from '@hato/shared';
import type { ExecutionContext } from '@nestjs/common';

import type { RequestWithScope } from '../farm-scope/farm-scope.types.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(request: RequestWithScope): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function guardFor(required: readonly Role[] | undefined): RolesGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  return new RolesGuard(reflector);
}

function requestWith(role: Role): RequestWithScope {
  return { headers: {}, scope: { farmId: uuidv7(), userId: null, role } };
}

describe('RolesGuard', () => {
  it('sin @Roles deja pasar a cualquier rol', () => {
    for (const role of Object.values(ROLE)) {
      expect(guardFor(undefined).canActivate(contextFor(requestWith(role)))).toBe(true);
    }
  });

  it('con una lista vacía deja pasar', () => {
    expect(guardFor([]).canActivate(contextFor(requestWith(ROLE.OPERATOR)))).toBe(true);
  });

  it('deja pasar al rol autorizado', () => {
    expect(guardFor([ROLE.ADMIN]).canActivate(contextFor(requestWith(ROLE.ADMIN)))).toBe(true);
  });

  it('acepta cualquiera de varios roles autorizados', () => {
    const guard = guardFor([ROLE.ADMIN, ROLE.VET]);
    expect(guard.canActivate(contextFor(requestWith(ROLE.VET)))).toBe(true);
    expect(() => guard.canActivate(contextFor(requestWith(ROLE.OPERATOR)))).toThrow(DomainError);
  });

  it('rechaza el rol no autorizado con FORBIDDEN_ROLE', () => {
    try {
      guardFor([ROLE.ADMIN]).canActivate(contextFor(requestWith(ROLE.OPERATOR)));
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('FORBIDDEN_ROLE');
      expect((error as DomainError).status).toBe(403);
    }
  });

  it('sin ámbito resuelto rechaza, en lugar de asumir un rol', () => {
    expect(() => guardFor([ROLE.ADMIN]).canActivate(contextFor({ headers: {} }))).toThrow(
      DomainError,
    );
  });
});

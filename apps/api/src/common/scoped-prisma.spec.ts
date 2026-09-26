import { describe, expect, it } from 'vitest';
import { DomainError, ROLE } from '@hato/shared';

import type { FarmScope } from './farm-scope/farm-scope.types.js';
import { activeWhere, farmFilter, scopedWhere } from './scoped-prisma.js';

const scope: FarmScope = {
  farmId: '0195e0b0-1234-7000-8000-000000000000',
  userId: null,
  role: ROLE.ADMIN,
};

describe('farmFilter', () => {
  it('devuelve el filtro por finca', () => {
    expect(farmFilter(scope)).toEqual({ farmId: scope.farmId });
  });

  it('sin ámbito lanza en lugar de devolver datos sin filtrar', () => {
    expect(() => farmFilter(undefined)).toThrow(DomainError);
    try {
      farmFilter(undefined);
    } catch (error) {
      expect((error as DomainError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('con una finca vacía también lanza', () => {
    expect(() => farmFilter({ ...scope, farmId: '' })).toThrow(DomainError);
  });
});

describe('scopedWhere', () => {
  it('combina el filtro del llamador con la finca', () => {
    expect(scopedWhere(scope, { code: '26-045' })).toEqual({
      code: '26-045',
      farmId: scope.farmId,
    });
  });

  it('el farmId del ámbito gana sobre uno inyectado por el cliente', () => {
    const conFarmIdAjeno = { farmId: 'otra-finca', code: '26-045' };
    expect(scopedWhere(scope, conFarmIdAjeno).farmId).toBe(scope.farmId);
  });

  it('sin ámbito lanza', () => {
    expect(() => scopedWhere(undefined, { code: 'x' })).toThrow(DomainError);
  });
});

describe('activeWhere', () => {
  it('agrega el filtro de no archivados', () => {
    expect(activeWhere(scope)).toEqual({ farmId: scope.farmId, deletedAt: null });
    expect(activeWhere(scope, { sex: 'FEMALE' })).toEqual({
      sex: 'FEMALE',
      farmId: scope.farmId,
      deletedAt: null,
    });
  });
});

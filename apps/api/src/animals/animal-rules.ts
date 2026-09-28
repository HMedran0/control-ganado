import { DomainError, ROLE, type IsoDate } from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';

/** Reglas pequeñas que comparten los casos de uso de animales (registro, edición, salida, archivo). */

export function fieldError(code: 'VALIDATION_FAILED', field: string, message: string): DomainError {
  return new DomainError(code, { fieldErrors: { [field]: [message] } });
}

/** RN-14: ninguna fecha de evento puede ser futura. */
export function assertNotFuture(date: IsoDate, today: IsoDate, field: string): void {
  if (date > today) {
    throw new DomainError('DATE_IN_FUTURE', {
      fieldErrors: { [field]: ['La fecha no puede ser posterior a hoy.'] },
    });
  }
}

/** RN-14: ningún evento puede ser anterior al nacimiento. */
export function assertNotBeforeBirth(date: IsoDate, birthDate: IsoDate, field: string): void {
  if (date < birthDate) {
    throw new DomainError('DATE_BEFORE_BIRTH', {
      fieldErrors: { [field]: ['La fecha es anterior al nacimiento del animal.'] },
    });
  }
}

export function userOf(scope: FarmScope): string {
  if (scope.userId === null) throw new DomainError('FORBIDDEN_ROLE');
  return scope.userId;
}

export function requireAdmin(scope: FarmScope, detail: string): void {
  if (scope.role !== ROLE.ADMIN) throw new DomainError('FORBIDDEN_ROLE', { detail });
}

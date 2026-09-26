import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@hato/shared';

/** Clave de metadatos de auditoría. */
export const AUDIT_KEY = 'hato:audit';

/** Qué registrar en `audit_logs` cuando el endpoint termina bien. */
export type AuditMetadata = {
  /** Entidad afectada, con el nombre del modelo: `Animal`, `Pregnancy`… */
  readonly entity: string;
  readonly action: AuditAction;
};

/**
 * Marca un endpoint de escritura para que se registre en la auditoría (RNF-14, AUD-01):
 * `@Audit({ entity: 'Animal', action: 'CREATE' })`.
 */
export const Audit = (metadata: AuditMetadata): MethodDecorator => SetMetadata(AUDIT_KEY, metadata);

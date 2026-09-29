import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@hato/shared';

import type { Tx } from '../persistence.js';
import { PrismaService } from '../../infra/prisma.service.js';

/**
 * Límites por plan en un solo punto (ADR-013).
 *
 * En la fase 1 toda finca tiene el plan **PILOT**, sin límites ni módulos cerrados, y no hay
 * columna de plan en `farms`: el servicio siempre permite. Lo que sí queda fijo desde ya son los
 * puntos de llamada, uno por caso, para que una etapa comercial solo tenga que cambiar el plan:
 *
 * - alta de animal y crías del parto: `checkLimit(ANIMALS, n)`;
 * - importación del inventario: `checkLimit(ANIMALS, filas que entran)`;
 * - invitación de usuarios (M10a): `checkLimit(USERS, 1)`;
 * - módulos opcionales: `can(MILK)` (M9b) y `can(LIVE_SCALE)` (M15).
 *
 * Nada de cobro, planes ni precios en la fase 1.
 */

/** Límites de cantidad de un plan. */
export const PLAN_LIMIT = { ANIMALS: 'ANIMALS', USERS: 'USERS' } as const;
export type PlanLimit = (typeof PLAN_LIMIT)[keyof typeof PLAN_LIMIT];

/** Módulos opcionales de un plan. */
export const PLAN_FEATURE = { MILK: 'MILK', LIVE_SCALE: 'LIVE_SCALE' } as const;
export type PlanFeature = (typeof PLAN_FEATURE)[keyof typeof PLAN_FEATURE];

/** Lo que permite un plan. Un límite ausente es «sin límite». */
export type Plan = {
  readonly name: string;
  readonly limits: Readonly<Partial<Record<PlanLimit, number>>>;
  /** `'ALL'`: todos los módulos. */
  readonly features: 'ALL' | ReadonlySet<PlanFeature>;
};

/** El único plan de la fase 1: sin límites. */
export const PILOT_PLAN: Plan = { name: 'PILOT', limits: {}, features: 'ALL' };

/**
 * Cómo se sabe el plan de una finca. Hoy devuelve siempre PILOT; las pruebas lo reemplazan por
 * un plan con límite para comprobar que cada punto de llamada responde `PLAN_LIMIT_REACHED`.
 */
export const PLAN_RESOLVER = Symbol('PLAN_RESOLVER');
export type PlanResolver = (farmId: string) => Plan | Promise<Plan>;
export const pilotPlanResolver: PlanResolver = () => PILOT_PLAN;

/** Cómo se nombra cada límite en el mensaje de `PLAN_LIMIT_REACHED`. */
const WHAT: Readonly<Record<PlanLimit, string>> = {
  ANIMALS: 'animales',
  USERS: 'usuarios',
};

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLAN_RESOLVER) private readonly resolvePlan: PlanResolver,
  ) {}

  /** ¿La finca puede usar el módulo opcional? */
  async can(farmId: string, feature: PlanFeature): Promise<boolean> {
    const plan = await this.resolvePlan(farmId);
    return plan.features === 'ALL' || plan.features.has(feature);
  }

  /**
   * ¿Caben `additional` más en el límite? Se llama dentro de la transacción que crea, con `db`,
   * para contar lo que ya hay en ese mismo instante.
   *
   * @throws {DomainError} `PLAN_LIMIT_REACHED` si no caben.
   */
  async checkLimit(
    farmId: string,
    limit: PlanLimit,
    additional: number,
    db: Tx = this.prisma,
  ): Promise<void> {
    const plan = await this.resolvePlan(farmId);
    const max = plan.limits[limit];
    if (max === undefined || additional <= 0) return;
    const current = await this.count(db, farmId, limit);
    if (current + additional > max) {
      throw new DomainError('PLAN_LIMIT_REACHED', { params: { what: WHAT[limit] } });
    }
  }

  /** Lo que ya cuenta para el límite: animales activos, o usuarios activos de la finca. */
  private count(db: Tx, farmId: string, limit: PlanLimit): Promise<number> {
    if (limit === PLAN_LIMIT.ANIMALS) {
      return db.animal.count({ where: { farmId, deletedAt: null, exitType: null } });
    }
    return db.membership.count({ where: { farmId, isActive: true, user: { isActive: true } } });
  }
}

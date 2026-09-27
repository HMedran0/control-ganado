import { Inject, Injectable } from '@nestjs/common';
import { isoDateFromInstant, toIsoDate, type IsoDate } from '@hato/shared';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';

/**
 * Único lugar de la API que consulta el instante actual (CLAUDE.md, regla 6).
 *
 * `today()` devuelve el día en `APP_TIMEZONE` (America/Bogota). Si `SEED_TODAY` está definida
 * —solo en desarrollo y pruebas— devuelve esa fecha fija, que es lo que permite al seed y a
 * las pruebas afirmar cifras exactas (07-plan-desarrollo.md §2.1).
 */
@Injectable()
export class Clock {
  private readonly fixedToday: IsoDate | null;

  constructor(@Inject(ENV) private readonly env: Pick<Env, 'APP_TIMEZONE' | 'SEED_TODAY'>) {
    this.fixedToday = env.SEED_TODAY === undefined ? null : toIsoDate(env.SEED_TODAY);
  }

  /** Fecha de negocio de hoy en la zona de la finca. */
  today(): IsoDate {
    return this.fixedToday ?? isoDateFromInstant(this.now(), this.env.APP_TIMEZONE);
  }

  /**
   * Instante actual, para marcas de tiempo (`timestamptz`), no para fechas de negocio.
   *
   * Este servicio es la única fuente autorizada del instante actual: la regla de lint que
   * prohíbe `new Date()` existe precisamente para que nadie más lo consulte.
   */
  now(): Date {
    // eslint-disable-next-line no-restricted-syntax -- única excepción autorizada del proyecto
    return new Date();
  }

  /** ¿«Hoy» está fijado por `SEED_TODAY`? Lo usan el arranque y las pruebas para avisarlo. */
  isFixed(): boolean {
    return this.fixedToday !== null;
  }
}

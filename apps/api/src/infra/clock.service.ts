import { Inject, Injectable } from '@nestjs/common';
import { isoDateFromInstant, toIsoDate, type IsoDate } from '@hato/shared';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';

/**
 * Único lugar de la API que consulta el instante actual (CLAUDE.md, regla 6).
 *
 * `today()` devuelve el día real en `APP_TIMEZONE` (America/Bogota). Solo si
 * `CLOCK_FIXED_TODAY` está definida —pensada para pruebas y prohibida en producción— devuelve
 * esa fecha fija (ADR-010). `SEED_TODAY` es del seed y aquí no cuenta: el `.env` de desarrollo
 * la trae para sembrar la finca de referencia, y la API no debe quedar congelada por eso.
 */
@Injectable()
export class Clock {
  private readonly fixedToday: IsoDate | null;

  constructor(@Inject(ENV) private readonly env: Pick<Env, 'APP_TIMEZONE' | 'CLOCK_FIXED_TODAY'>) {
    this.fixedToday = env.CLOCK_FIXED_TODAY === undefined ? null : toIsoDate(env.CLOCK_FIXED_TODAY);
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

  /** ¿«Hoy» está fijado por `CLOCK_FIXED_TODAY`? Lo usan el arranque y `/health` para avisarlo. */
  isFixed(): boolean {
    return this.fixedToday !== null;
  }
}

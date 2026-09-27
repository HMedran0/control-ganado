import { Injectable, type OnModuleInit } from '@nestjs/common';

import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/**
 * Bloqueo por intentos fallidos (AUT-01 CA3).
 *
 * La regla, tal como quedó decidida en ADR-007:
 *
 * - si hay **5 fallos dentro de los 15 minutos anteriores al último fallo**, la cuenta queda
 *   bloqueada hasta *último fallo + 15 minutos*;
 * - un inicio de sesión **exitoso** reinicia el conteo;
 * - los intentos hechos **durante** el bloqueo se rechazan sin verificar la contraseña y
 *   **no** lo prolongan.
 *
 * Contar simplemente los fallos de los últimos 15 minutos no servía: con fallos en los
 * minutos 0, 1, 2, 3 y 14, el quinto entra en la ventana y bloquea, pero en el minuto 15 los
 * cuatro primeros ya salieron y la cuenta se desbloquea al minuto y medio de bloqueo, no a
 * los 15 que exige AUT-01.
 *
 * Que los intentos durante el bloqueo no lo extiendan también importa: si lo extendieran,
 * cualquiera podría dejar a un usuario fuera de su cuenta indefinidamente con solo repetir
 * contraseñas equivocadas.
 *
 * El bloqueo es **por cuenta, nunca por IP**. En una finca todos los usuarios comparten la
 * dirección pública del router o del punto de datos móviles: un bloqueo por IP convertiría
 * los cinco errores de un operario en un bloqueo de la finca entera. La IP se sigue
 * guardando para la trazabilidad; el barrido desde una misma IP lo frena el límite de
 * peticiones (60 por minuto sin sesión, `config/security.ts`).
 */

/** Fallos que disparan el bloqueo. */
export const MAX_FAILED_ATTEMPTS = 5;

/** Ventana en la que se cuentan los fallos, y duración del bloqueo. */
export const LOCK_WINDOW_MINUTES = 15;

const MINUTE_MS = 60_000;

/** Días que se conservan los intentos; llevan IP, que es dato personal. */
export const ATTEMPT_RETENTION_DAYS = 30;

/** Resultado de consultar el bloqueo. */
export type LockState = {
  readonly locked: boolean;
  /** Instante en que se libera; `null` si no está bloqueada. */
  readonly until: Date | null;
};

const UNLOCKED: LockState = { locked: false, until: null };

@Injectable()
export class LoginAttemptsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Al arrancar se borran los intentos viejos, para no acumular direcciones IP. */
  async onModuleInit(): Promise<void> {
    await this.purgeOld();
  }

  /** Borra los intentos de más de 30 días. */
  async purgeOld(): Promise<number> {
    const cutoff = new Date(
      this.clock.now().getTime() - ATTEMPT_RETENTION_DAYS * 24 * 60 * MINUTE_MS,
    );
    const { count } = await this.prisma.loginAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }

  /** Registra el intento. `login` se guarda en minúsculas, tal como lo escribieron. */
  async record(login: string, ip: string, succeeded: boolean): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { login: login.trim().toLowerCase(), ip, succeeded, createdAt: this.clock.now() },
    });
  }

  /** ¿Está bloqueada la cuenta con ese nombre de acceso? */
  async lockStateForLogin(login: string): Promise<LockState> {
    return this.lockState({ login: login.trim().toLowerCase() });
  }

  /**
   * Estado del bloqueo de una cuenta.
   *
   * Se miran los últimos intentos en orden inverso: si antes de completar cinco fallos
   * aparece uno exitoso, el conteo se reinicia ahí y no hay bloqueo.
   */
  private async lockState(subject: { login: string }): Promise<LockState> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - LOCK_WINDOW_MINUTES * MINUTE_MS);

    const recent = await this.prisma.loginAttempt.findMany({
      where: { ...subject, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      // Basta con los más recientes: el bloqueo se decide con cinco fallos seguidos.
      take: MAX_FAILED_ATTEMPTS,
      select: { succeeded: true, createdAt: true },
    });

    const failures: Date[] = [];
    for (const attempt of recent) {
      if (attempt.succeeded) break;
      failures.push(attempt.createdAt);
    }
    if (failures.length < MAX_FAILED_ATTEMPTS) return UNLOCKED;

    // `failures` viene del más nuevo al más viejo: el primero es el último fallo.
    const lastFailure = failures[0];
    const fifthFromLast = failures[MAX_FAILED_ATTEMPTS - 1];
    if (lastFailure === undefined || fifthFromLast === undefined) return UNLOCKED;

    // Los cinco fallos tienen que caber en la misma ventana de 15 minutos.
    if (lastFailure.getTime() - fifthFromLast.getTime() > LOCK_WINDOW_MINUTES * MINUTE_MS) {
      return UNLOCKED;
    }

    const until = new Date(lastFailure.getTime() + LOCK_WINDOW_MINUTES * MINUTE_MS);
    return until > now ? { locked: true, until } : UNLOCKED;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { DomainError, uuidv7, type Role } from '@hato/shared';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { Clock } from '../infra/clock.service.js';

/**
 * Tokens de acceso y de refresco (04-arquitectura.md §5).
 *
 * - **Acceso**: JWT HS256 de 15 minutos. Lleva el usuario, la finca activa y el rol, pero el
 *   rol y el estado de la cuenta se vuelven a leer de la base en cada petición
 *   (`AccessGuard`), así que el token no es la autoridad sobre los permisos: es solo prueba
 *   de que alguien inició sesión.
 * - **Refresco**: cadena opaca aleatoria de 32 bytes. En la base solo se guarda su hash
 *   SHA-256 con pimienta, nunca el valor: quien lea la tabla no puede usar las sesiones.
 *
 * El instante viene del `Clock`, no de `Date.now()`, para poder probar vencimientos
 * adelantando el reloj en lugar de esperar quince minutos.
 */

/** Vigencia del token de acceso (RNF-06). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Emisor y audiencia del JWT; se validan al verificar. */
export const JWT_ISSUER = 'hato:api';
export const JWT_AUDIENCE = 'hato:clients';

/** Contenido del token de acceso. */
export type AccessTokenClaims = {
  readonly userId: string;
  readonly farmId: string;
  readonly role: Role;
  /**
   * Sesión (familia de refresco) que emitió el token, en el claim `sid`. `AccessGuard`
   * comprueba en cada petición que siga abierta: cerrar una sesión corta su acceso al instante
   * (AUT-11), sin esperar a que venza el token.
   */
  readonly sessionId: string;
};

/** Token de refresco recién emitido: el valor que viaja y lo que se guarda. */
export type IssuedRefreshToken = {
  readonly id: string;
  /** Valor opaco que va en la cookie. No se guarda en ninguna parte. */
  readonly value: string;
  readonly tokenHash: string;
  readonly familyId: string;
  /** Inicio de sesión que originó la familia; fija el tope absoluto (AUT-10 CA2). */
  readonly familyStartedAt: Date;
  readonly expiresAt: Date;
};

/** Familia a la que pertenece un token que se rota. */
export type RefreshFamily = {
  readonly id: string;
  readonly startedAt: Date;
};

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;
  private readonly pepper: string;
  private readonly ttlMs: number;
  private readonly maxAgeMs: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly clock: Clock,
  ) {
    this.secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    this.pepper = env.REFRESH_TOKEN_PEPPER;
    this.ttlMs = env.REFRESH_TTL_DAYS * DAY_MS;
    this.maxAgeMs = env.REFRESH_MAX_AGE_DAYS * DAY_MS;
  }

  /** Firma un token de acceso que vence a los 15 minutos del instante actual. */
  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ farmId: claims.farmId, role: claims.role, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.secret);
  }

  /**
   * Verifica un token de acceso.
   *
   * Se fija el algoritmo a HS256: sin eso, un token con `alg: none` o firmado con otro
   * algoritmo podría colarse. También se exigen emisor y audiencia, para que un token
   * emitido por otro sistema con el mismo secreto no sirva aquí.
   *
   * @throws {DomainError} `AUTH_TOKEN_EXPIRED` si venció, la firma no cuadra o falta algún dato.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        currentDate: this.clock.now(),
      }));
    } catch {
      throw new DomainError('AUTH_TOKEN_EXPIRED');
    }

    const userId = payload.sub;
    const farmId = payload['farmId'];
    const role = payload['role'];
    const sessionId = payload['sid'];
    if (
      typeof userId !== 'string' ||
      typeof farmId !== 'string' ||
      typeof role !== 'string' ||
      typeof sessionId !== 'string'
    ) {
      throw new DomainError('AUTH_TOKEN_EXPIRED');
    }
    return { userId, farmId, role: role as Role, sessionId };
  }

  /**
   * Emite un token de refresco nuevo.
   *
   * La familia encadena las rotaciones de una misma sesión: al rotar se conserva, y si alguna
   * vez se reutiliza un token ya rotado se revoca la familia entera. Sin familia, empieza una
   * (inicio de sesión).
   *
   * Vencimiento deslizante con tope (AUT-10, ADR-007 decisión 6):
   * `min(ahora + REFRESH_TTL_DAYS, inicio de la familia + REFRESH_MAX_AGE_DAYS)`.
   */
  issueRefreshToken(family?: RefreshFamily): IssuedRefreshToken {
    const value = randomBytes(32).toString('base64url');
    const now = this.clock.now().getTime();
    const familyStartedAt = family?.startedAt ?? new Date(now);
    const expiresAt = new Date(
      Math.min(now + this.ttlMs, familyStartedAt.getTime() + this.maxAgeMs),
    );
    return {
      id: uuidv7(),
      value,
      tokenHash: this.hashRefreshToken(value),
      familyId: family?.id ?? uuidv7(),
      familyStartedAt,
      expiresAt,
    };
  }

  /** Instante en que la familia cumple el tope absoluto (AUT-10 CA2). */
  familyCapAt(familyStartedAt: Date): Date {
    return new Date(familyStartedAt.getTime() + this.maxAgeMs);
  }

  /**
   * Hash del token de refresco, con la pimienta del entorno.
   *
   * SHA-256 y no Argon2id a propósito: el valor tiene 256 bits de entropía real, así que no
   * hay diccionario que probar y el costo de Argon2 solo serviría para hacer lento cada
   * refresco. La pimienta impide usar la tabla robada contra otra instalación.
   */
  hashRefreshToken(value: string): string {
    return createHash('sha256').update(`${this.pepper}:${value}`).digest('hex');
  }

  /** Comparación en tiempo constante de dos hashes en hexadecimal. */
  matchesHash(storedHash: string, candidate: string): boolean {
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(this.hashRefreshToken(candidate), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

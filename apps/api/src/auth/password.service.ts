import { hash as argon2Hash, verify as argon2Verify, type Algorithm } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/**
 * Contraseñas: hash, verificación y generación de temporales.
 *
 * Argon2id con **sal aleatoria por usuario**, que es lo que genera `@node-rs/argon2` cuando
 * no se le pasa `salt` (RNF-06, 04-arquitectura.md §5). El seed de la finca de referencia usa
 * una sal fija para poder repetirse igual; esa función vive en `prisma/seed/password.ts` y
 * **no se reutiliza aquí** a propósito.
 *
 * `@node-rs/argon2` declara `Algorithm` como `const enum` ambiental y `verbatimModuleSyntax`
 * no deja acceder a sus miembros (TS2748), así que el valor va a mano con su tipo.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Hash señuelo contra la enumeración de usuarios.
 *
 * Si el usuario no existe hay que gastar el mismo tiempo que si existiera, o el atacante
 * distingue «usuario inexistente» de «contraseña equivocada» solo midiendo la respuesta. Se
 * calcula una vez al arrancar, sobre una contraseña aleatoria que nadie conoce.
 */
const DECOY_PASSWORD = randomBytes(32).toString('base64url');

/** Alfabeto de las contraseñas temporales: sin caracteres que se confundan al dictarlas. */
const UNAMBIGUOUS = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Longitud de la contraseña temporal que genera el ADMIN (AUT-04 CA2). */
const TEMPORARY_PASSWORD_LENGTH = 12;

@Injectable()
export class PasswordService {
  /** Se calcula al construir el servicio para no pagarlo en la primera petición. */
  private readonly decoyHash: Promise<string>;

  constructor() {
    this.decoyHash = argon2Hash(DECOY_PASSWORD, { algorithm: ARGON2ID });
  }

  /** Hash Argon2id de una contraseña, con sal aleatoria nueva. */
  async hash(password: string): Promise<string> {
    return argon2Hash(password, { algorithm: ARGON2ID });
  }

  /**
   * ¿La contraseña corresponde al hash?
   *
   * Un hash ilegible devuelve `false` en lugar de lanzar: un registro corrupto no debe
   * tumbar el login de toda la finca, y para quien intenta entrar el resultado es el mismo.
   */
  async verify(hashValue: string, password: string): Promise<boolean> {
    try {
      return await argon2Verify(hashValue, password);
    } catch {
      return false;
    }
  }

  /**
   * Gasta el mismo trabajo que una verificación real, y descarta el resultado.
   *
   * Se llama cuando el usuario no existe o está inactivo, para que el tiempo de respuesta no
   * delate cuáles usuarios existen.
   */
  async verifyDecoy(password: string): Promise<void> {
    await this.verify(await this.decoyHash, password);
  }

  /**
   * Contraseña temporal legible por teléfono: sin mayúsculas, sin `l`, `o` ni `1`, en
   * grupos de cuatro. La entropía (32^12 ≈ 2^60) sobra para algo que se cambia al entrar.
   */
  generateTemporaryPassword(): string {
    const bytes = randomBytes(TEMPORARY_PASSWORD_LENGTH);
    let out = '';
    for (const [index, byte] of bytes.entries()) {
      if (index > 0 && index % 4 === 0) out += '-';
      out += UNAMBIGUOUS[byte % UNAMBIGUOUS.length];
    }
    return out;
  }
}

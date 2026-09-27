import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

const passwords = new PasswordService();

describe('PasswordService', () => {
  it('produce un hash Argon2id verificable', async () => {
    const hash = await passwords.hash('una-clave-larga');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(passwords.verify(hash, 'una-clave-larga')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'otra-clave')).resolves.toBe(false);
  });

  it('usa una sal distinta en cada llamada (RNF-06)', async () => {
    const [a, b] = await Promise.all([passwords.hash('la-misma'), passwords.hash('la-misma')]);
    expect(a).not.toBe(b);
    await expect(passwords.verify(a, 'la-misma')).resolves.toBe(true);
    await expect(passwords.verify(b, 'la-misma')).resolves.toBe(true);
  });

  it('nunca guarda la contraseña dentro del hash', async () => {
    const hash = await passwords.hash('clave-reconocible-123');
    expect(hash).not.toContain('clave-reconocible-123');
  });

  it('devuelve false con un hash corrupto en lugar de lanzar', async () => {
    await expect(passwords.verify('no-es-un-hash', 'lo-que-sea')).resolves.toBe(false);
    await expect(passwords.verify('', 'lo-que-sea')).resolves.toBe(false);
  });

  it('la verificación señuelo no lanza y sirve para gastar el mismo tiempo', async () => {
    await expect(passwords.verifyDecoy('cualquier-cosa')).resolves.toBeUndefined();
  });

  describe('contraseñas temporales', () => {
    it('no repite y evita los caracteres que se confunden al dictarlas', () => {
      const generated = new Set<string>();
      for (let index = 0; index < 200; index += 1) {
        const value = passwords.generateTemporaryPassword();
        expect(value).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
        expect(value).not.toMatch(/[lo01]/);
        generated.add(value);
      }
      expect(generated.size).toBe(200);
    });

    it('sirve para entrar: se puede hashear y verificar', async () => {
      const temporary = passwords.generateTemporaryPassword();
      const hash = await passwords.hash(temporary);
      await expect(passwords.verify(hash, temporary)).resolves.toBe(true);
    });
  });
});

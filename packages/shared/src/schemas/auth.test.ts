import { describe, expect, it } from 'vitest';

import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  updateUserSchema,
  usernameSchema,
} from './auth.js';

describe('usernameSchema', () => {
  it('acepta los nombres de usuario de la finca de referencia', () => {
    for (const username of ['alvaro', 'wilmer', 'yeison', 'paola.vet']) {
      expect(usernameSchema.parse(username)).toBe(username);
    }
  });

  it('normaliza espacios y mayúsculas', () => {
    expect(usernameSchema.parse('  Alvaro  ')).toBe('alvaro');
  });

  it('rechaza los que no cumplen el formato de 08 §2.4', () => {
    for (const invalid of ['ab', 'con espacio', 'acentuadó', 'a'.repeat(31), 'con/barra']) {
      expect(usernameSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('loginSchema', () => {
  it('acepta usuario o correo, sin exigir formato', () => {
    expect(loginSchema.parse({ login: 'alvaro', password: 'x' }).login).toBe('alvaro');
    expect(loginSchema.parse({ login: 'alvaro@demo.co', password: 'x' }).login).toBe(
      'alvaro@demo.co',
    );
  });

  it('exige los dos campos', () => {
    expect(loginSchema.safeParse({ login: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ login: 'alvaro', password: '' }).success).toBe(false);
  });

  it('acepta una finca opcional y la exige como UUID', () => {
    expect(loginSchema.safeParse({ login: 'a', password: 'b', farmId: 'no-es-uuid' }).success).toBe(
      false,
    );
  });
});

describe('changePasswordSchema', () => {
  it('exige al menos 8 caracteres en la nueva', () => {
    const result = changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'corta' });
    expect(result.success).toBe(false);
  });

  it('rechaza repetir la contraseña actual', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'la-misma-clave',
      newPassword: 'la-misma-clave',
    });
    expect(result.success).toBe(false);
  });

  it('acepta un cambio válido', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'vieja123', newPassword: 'nueva1234' })
        .success,
    ).toBe(true);
  });
});

describe('createUserSchema', () => {
  it('deja el correo en nulo cuando no viene o viene vacío (08 §1.8)', () => {
    expect(
      createUserSchema.parse({ name: 'Wilmer Ortega', username: 'wilmer', role: 'OPERATOR' }).email,
    ).toBeNull();
    expect(
      createUserSchema.parse({
        name: 'Wilmer Ortega',
        username: 'wilmer',
        email: '',
        role: 'OPERATOR',
      }).email,
    ).toBeNull();
  });

  it('normaliza el correo a minúsculas', () => {
    expect(
      createUserSchema.parse({
        name: 'Álvaro Pérez',
        username: 'alvaro',
        email: 'Alvaro@Demo.CO',
        role: 'ADMIN',
      }).email,
    ).toBe('alvaro@demo.co');
  });

  it('rechaza un rol que no existe', () => {
    expect(
      createUserSchema.safeParse({ name: 'Alguien', username: 'alguien', role: 'DUEÑO' }).success,
    ).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('rechaza un cambio vacío', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });

  it('distingue quitar el correo de no tocarlo', () => {
    expect(updateUserSchema.parse({ email: '' }).email).toBeNull();
    expect(updateUserSchema.parse({ name: 'Otro nombre' }).email).toBeUndefined();
  });
});

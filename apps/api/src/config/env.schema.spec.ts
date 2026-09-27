import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.schema.js';

/** Entorno válido mínimo, del que cada prueba parte. */
function validEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://hato:hato_dev@localhost:5433/hato?schema=public',
    JWT_ACCESS_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres',
    REFRESH_TOKEN_PEPPER: 'un-pepper-de-prueba-de-mas-de-32-caracteres',
    CORS_ORIGINS: 'http://localhost:5173',
    PUBLIC_WEB_URL: 'http://localhost:5173',
  };
}

describe('parseEnv', () => {
  it('acepta un entorno válido y aplica los valores por defecto', () => {
    const env = parseEnv(validEnv());

    expect(env.PORT).toBe(3000);
    expect(env.APP_TIMEZONE).toBe('America/Bogota');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SEED_TODAY).toBeUndefined();
  });

  it('parte CORS_ORIGINS por comas', () => {
    const env = parseEnv({
      ...validEnv(),
      CORS_ORIGINS: 'http://localhost:5173, https://hato.example.com ',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://hato.example.com']);
  });

  it('convierte PORT a número', () => {
    expect(parseEnv({ ...validEnv(), PORT: '8080' }).PORT).toBe(8080);
  });

  describe('no arranca si falta algo', () => {
    it.each([
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'REFRESH_TOKEN_PEPPER',
      'CORS_ORIGINS',
      'PUBLIC_WEB_URL',
    ])('falta %s', (key) => {
      const env = validEnv();
      delete env[key];
      expect(() => parseEnv(env)).toThrow(new RegExp(key));
    });

    it('el mensaje está en español y remite a .env.example', () => {
      const env = validEnv();
      delete env.DATABASE_URL;
      expect(() => parseEnv(env)).toThrow(/no es válida; la API no puede arrancar/);
      expect(() => parseEnv(env)).toThrow(/\.env\.example/);
    });
  });

  describe('rechaza valores inseguros o mal formados', () => {
    it('DATABASE_URL que no es de PostgreSQL', () => {
      expect(() => parseEnv({ ...validEnv(), DATABASE_URL: 'mysql://x/y' })).toThrow(/PostgreSQL/);
    });

    it('secretos demasiado cortos', () => {
      expect(() => parseEnv({ ...validEnv(), JWT_ACCESS_SECRET: 'corto' })).toThrow(/32/);
    });

    it('secretos que siguen con el valor de ejemplo de .env.example', () => {
      expect(() =>
        parseEnv({
          ...validEnv(),
          JWT_ACCESS_SECRET: 'cambiar-por-un-secreto-aleatorio-de-al-menos-32-caracteres',
        }),
      ).toThrow(/valor de ejemplo/);
    });

    it('SEED_TODAY con otro formato', () => {
      expect(() => parseEnv({ ...validEnv(), SEED_TODAY: '25/09/2026' })).toThrow(/AAAA-MM-DD/);
    });

    it('un origen de CORS que no es una URL', () => {
      expect(() => parseEnv({ ...validEnv(), CORS_ORIGINS: 'localhost:5173' })).toThrow();
    });
  });

  // El mecanismo temporal DEV_FAKE_AUTH se retiró en M1, cuando llegó la autenticación
  // de verdad: ya no hay variable de entorno que pueda dejar la API abierta
  // (docs/adr/007-autenticacion.md).
  it('ignora las variables desconocidas, como el DEV_FAKE_AUTH retirado en M1', () => {
    const env = parseEnv({ ...validEnv(), DEV_FAKE_AUTH: 'true' });
    expect(env).not.toHaveProperty('DEV_FAKE_AUTH');
  });
});

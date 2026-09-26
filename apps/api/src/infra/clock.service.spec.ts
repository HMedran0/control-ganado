import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.schema.js';
import { Clock } from './clock.service.js';

function env(overrides: Partial<Env> = {}): Env {
  const base: Env = {
    NODE_ENV: 'test',
    PORT: 3000,
    APP_TIMEZONE: 'America/Bogota',
    DATABASE_URL: 'postgresql://x/y',
    JWT_ACCESS_SECRET: 'x'.repeat(40),
    REFRESH_TOKEN_PEPPER: 'y'.repeat(40),
    CORS_ORIGINS: ['http://localhost:5173'],
    PUBLIC_WEB_URL: 'http://localhost:5173',
    DEV_FAKE_AUTH: false,
    LOG_LEVEL: 'silent',
  };
  return { ...base, ...overrides };
}

describe('Clock', () => {
  it('con SEED_TODAY devuelve esa fecha fija', () => {
    const clock = new Clock(env({ SEED_TODAY: '2026-09-25' }));
    expect(clock.today()).toBe('2026-09-25');
    expect(clock.isFixed()).toBe(true);
  });

  it('sin SEED_TODAY devuelve el día en la zona de la finca', () => {
    const clock = new Clock(env());
    const instant = new Date('2026-09-26T02:00:00.000Z');
    vi.spyOn(clock, 'now').mockReturnValue(instant);

    // 02:00 UTC del 26 son las 21:00 del 25 en Bogotá (UTC−5).
    expect(clock.today()).toBe('2026-09-25');
    expect(clock.isFixed()).toBe(false);
  });

  it('el día cambia a la medianoche de Bogotá, no a la de UTC', () => {
    const clock = new Clock(env());
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-09-26T04:59:00.000Z'));
    expect(clock.today()).toBe('2026-09-25');

    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-09-26T05:00:00.000Z'));
    expect(clock.today()).toBe('2026-09-26');
  });

  it('respeta otra zona horaria configurada', () => {
    const clock = new Clock(env({ APP_TIMEZONE: 'Asia/Tokyo' }));
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-09-25T16:00:00.000Z'));
    // 16:00 UTC son las 01:00 del día siguiente en Tokio (UTC+9).
    expect(clock.today()).toBe('2026-09-26');
  });

  it('rechaza un SEED_TODAY que no es una fecha real', () => {
    expect(() => new Clock(env({ SEED_TODAY: '2026-02-30' }))).toThrow();
  });

  it('now() devuelve un instante', () => {
    expect(new Clock(env()).now()).toBeInstanceOf(Date);
  });
});

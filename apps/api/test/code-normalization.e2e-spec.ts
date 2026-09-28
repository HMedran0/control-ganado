import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { normalizeAnimalCode } from '@hato/shared';

import { PrismaService } from '../src/infra/prisma.service.js';
import { createTestApp } from './helpers/app.js';

/**
 * RN-30: `hato_normalize_code` (SQL, índice único y búsquedas) y `normalizeAnimalCode` (shared,
 * web y API) tienen que dar lo mismo en cada caso, o la base aceptaría como distintos dos códigos
 * que la interfaz muestra como el mismo, o al revés. Mismo espíritu que la equivalencia de la
 * clasificación (ADR-009): casos elegidos a mano más miles generados con semilla fija.
 */
describe('Normalización del código: SQL = shared (RN-30)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function sqlNormalize(codes: readonly string[]): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ normalized: string }[]>`
      SELECT hato_normalize_code(code) AS normalized
        FROM unnest(${[...codes]}::text[]) WITH ORDINALITY AS input(code, position)
       ORDER BY position`;
    return rows.map((row) => row.normalized);
  }

  const handPicked = [
    '5',
    '05',
    '005',
    '000',
    '0',
    ' 12 ',
    '\t7\n',
    ' 8 ',
    ' 5 ',
    '\r5',
    'a-12',
    'niña',
    'NIÑA',
    'ña',
    'ÑA',
    'ü',
    'é',
    'ñandú',
    'pingüino',
    'ç',
    'ß',
    'ı',
    '٠٥',
    '05-A',
    'A 05',
    '26-001',
    '',
    '   ',
    '0 5',
  ];

  it('coinciden en los casos elegidos a mano, NFD incluido', async () => {
    expect(await sqlNormalize(handPicked)).toEqual(handPicked.map(normalizeAnimalCode));
  });

  it('coinciden en 5.000 códigos generados con semilla fija', async () => {
    // Piezas que ejercitan cada paso: espacios de la lista y fuera de ella, ceros, dígitos,
    // letras de la lista en minúscula y mayúscula, formas NFD y letras fuera de la lista.
    const pieces = [
      ' ',
      '\t',
      '\n',
      ' ',
      ' ',
      '\r',
      '0',
      '0',
      '1',
      '5',
      '9',
      'a',
      'z',
      'A',
      'Z',
      'ñ',
      'Ñ',
      'á',
      'é',
      'í',
      'ó',
      'ú',
      'ü',
      'Ü',
      'ñ',
      'ü',
      'é',
      'ç',
      'ß',
      '-',
      '_',
      '/',
      '.',
    ];
    let state = 20260928;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const codes = Array.from({ length: 5000 }, () => {
      const length = 1 + Math.floor(random() * 8);
      let code = '';
      for (let index = 0; index < length; index += 1) {
        code += pieces[Math.floor(random() * pieces.length)] ?? '';
      }
      return code;
    });

    const sql = await sqlNormalize(codes);
    const differences = codes
      .map((code, index) => ({ code, sql: sql[index], shared: normalizeAnimalCode(code) }))
      .filter((row) => row.sql !== row.shared);
    expect(differences).toEqual([]);
  });
});

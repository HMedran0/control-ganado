import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

import { login, seedPassword } from './helpers';
import { unzip } from './zip';

/**
 * Exportación completa de la finca (BAK-02, M8b) en móvil y escritorio, con axe: el ADMIN
 * descarga el ZIP desde Configuración; se abre, trae un Excel por entidad con sus encabezados y
 * el LEEME, y no trae contraseñas ni tokens. Un OPERATOR no ve la sección.
 *
 * Cada corrida exporta una vez por proyecto: con el límite de 3 por hora por finca, el seed de
 * e2e (`test:e2e:seed`) borra la auditoría de la finca antes de cada corrida completa.
 */

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

const EXPECTED_FILES = [
  'LEEME.txt',
  'animales.xlsx',
  'auditoria.xlsx',
  'avaluos.xlsx',
  'ciclos-de-vacunacion.xlsx',
  'entradas-de-jornada.xlsx',
  'etiquetas-de-animales.xlsx',
  'etiquetas.xlsx',
  'finca.xlsx',
  'gastos.xlsx',
  'identificadores.xlsx',
  'importaciones.xlsx',
  'jornadas.xlsx',
  'lotes.xlsx',
  'movimientos-de-lote.xlsx',
  'perfiles-de-bascula.xlsx',
  'pesajes.xlsx',
  'prenez-y-partos.xlsx',
  'razas.xlsx',
  'reparto-de-gastos.xlsx',
  'tratamientos.xlsx',
  'usuarios.xlsx',
  'vacunaciones.xlsx',
  'vacunas-de-ciclos.xlsx',
  'vacunas.xlsx',
  'ventas.xlsx',
];

async function headerOf(file: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as ArrayBuffer);
  return (workbook.worksheets[0]?.getRow(1).values as unknown[])
    .slice(1)
    .map((value) => String(value as string));
}

test.describe('Exportar todos los datos (BAK-02)', () => {
  test('el ADMIN descarga el ZIP completo y se abre', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/settings');
    await page.getByRole('link', { name: /Exportar todos los datos/ }).click();
    await expect(page.getByRole('heading', { name: 'Exportar todos los datos' })).toBeVisible();
    await expectNoViolations(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: 'Descargar todo (ZIP)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^arreo-finca-la-esperanza-\d{4}-\d{2}-\d{2}\.zip$/,
    );
    await expect(page.getByText('Listo: el archivo quedó en tus descargas.')).toBeVisible();
    await expectNoViolations(page);

    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const entries = unzip(await readFile(path));
    expect([...entries.keys()].sort()).toEqual(EXPECTED_FILES);
    for (const name of entries.keys()) expect(name).toMatch(/^[a-z0-9.-]+$/i);

    const readme = entries.get('LEEME.txt') ?? Buffer.alloc(0);
    expect([...readme.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = readme.toString('utf8');
    expect(text).toContain('EXPORTACIÓN COMPLETA DE LA FINCA «Finca La Esperanza»');
    expect(text).toContain('prenez-y-partos.xlsx — Preñez y partos');

    expect(await headerOf(entries.get('animales.xlsx') ?? Buffer.alloc(0))).toEqual(
      expect.arrayContaining(['Id', 'Código', 'Sexo', 'Fecha de nacimiento', 'Archivado']),
    );
    expect(await headerOf(entries.get('pesajes.xlsx') ?? Buffer.alloc(0))).toEqual(
      expect.arrayContaining(['Animal', 'Fecha', 'Peso (kg)', 'Anulado', 'Motivo de anulación']),
    );
    const users = await headerOf(entries.get('usuarios.xlsx') ?? Buffer.alloc(0));
    expect(users).toEqual(expect.arrayContaining(['Usuario', 'Nombre', 'Rol']));
    expect(users.some((header) => /^contraseña$|hash|token/i.test(header))).toBe(false);

    // Ni hashes de contraseña, ni la contraseña del seed, en ninguna parte de ningún archivo.
    const everything = [...entries.values()]
      .flatMap((entry) =>
        entry.subarray(0, 2).toString('latin1') === 'PK'
          ? [...unzip(entry).values()].map((part) => part.toString('utf8'))
          : [entry.toString('utf8')],
      )
      .join('\n');
    expect(everything).not.toContain('$argon2');
    expect(everything).not.toContain(seedPassword());
  });

  test('un OPERATOR no ve la sección ni puede abrirla', async ({ page }) => {
    await login(page, 'wilmer');
    await page.goto('/settings/export');
    await expect(page.getByRole('button', { name: 'Descargar todo (ZIP)' })).toHaveCount(0);
    await expectNoViolations(page);
  });
});

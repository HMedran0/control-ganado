import type { AnimalImportPreview } from '@hato/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../test/app-harness';
import { json, problem } from '../../test/auth-harness';
import { groupIssues, importButtonText, resultText } from './issues';
import { ImportPage } from './ImportPage';

const PREVIEW: AnimalImportPreview = {
  fileName: 'inventario.xlsx',
  totalRows: 12,
  validRows: 8,
  warningRows: 3,
  errorRows: 1,
  importable: 11,
  issues: [
    {
      row: 4,
      column: 'entryDate',
      severity: 'warning',
      message:
        'Se tomó la fecha de nacimiento como fecha de ingreso; corrígela en la ficha si la conoces.',
    },
    { row: 13, column: 'dam', severity: 'error', message: 'La madre 012 es macho.' },
  ],
  newBreeds: [],
  previousImport: null,
};

function formField(init: RequestInit | undefined, name: string): FormDataEntryValue | null {
  return (init?.body as FormData).get(name);
}

async function upload(): Promise<void> {
  const user = userEvent.setup();
  const file = new File(['xlsx'], 'inventario.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await user.upload(screen.getByLabelText('Archivo (.xlsx o .csv, hasta 5 MB)'), file);
}

describe('textos de la importación', () => {
  it('agrupa por fila y arma los textos de 06 §5.6', () => {
    expect(groupIssues(PREVIEW.issues)).toEqual([
      {
        row: 4,
        severity: 'warning',
        messages: [
          'Fecha de ingreso: Se tomó la fecha de nacimiento como fecha de ingreso; corrígela en la ficha si la conoces.',
        ],
      },
      { row: 13, severity: 'error', messages: ['Código madre: La madre 012 es macho.'] },
    ]);
    expect(importButtonText(1)).toBe('Importar 1 animal');
    expect(importButtonText(271)).toBe('Importar 271 animales');
    expect(resultText(271, 13)).toBe('271 animales importados · 13 filas por corregir');
    expect(resultText(1, 0)).toBe('1 animal importado');
    expect(resultText(2, 1)).toBe('2 animales importados · 1 fila por corregir');
  });
});

describe('ImportPage (ANI-09, 06 §5.6)', () => {
  it('simula al elegir el archivo y muestra los contadores y los problemas por fila', async () => {
    const { fetchMock } = await renderApp(<ImportPage />, () => json(PREVIEW));
    await upload();

    expect(
      await screen.findByRole('heading', { name: '3. Revisa la simulación de inventario.xlsx' }),
    ).toBeVisible();
    const [call] = fetchMock.mock.calls;
    expect(call?.[0]).toBe('/api/v1/imports/animals?dryRun=true');
    expect(formField(call?.[1], 'skipRows')).toBe('');
    expect(screen.getByText('Listas para importar').nextSibling).toHaveTextContent('8');
    expect(screen.getByText('Con errores').nextSibling).toHaveTextContent('1');

    const list = screen.getByRole('list', { name: 'Filas con problemas' });
    expect(within(list).getByText('Código madre: La madre 012 es macho.')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Errores (1)' }));
    expect(within(list).queryByText(/Fecha de ingreso/)).toBeNull();
  });

  it('desmarcar una fila con advertencia vuelve a simular sin ella', async () => {
    const { fetchMock } = await renderApp(<ImportPage />, () => json(PREVIEW));
    await upload();
    await userEvent
      .setup()
      .click(await screen.findByRole('checkbox', { name: 'Importar la fila 4' }));
    await screen.findByText('Desmarcaste la fila 4.');
    expect(formField(fetchMock.mock.calls.at(-1)?.[1], 'skipRows')).toBe('4');
  });

  it('confirma con la clave de la importación y los animales que dijo la simulación', async () => {
    const { fetchMock } = await renderApp(<ImportPage />, (url) =>
      url.includes('dryRun')
        ? json(PREVIEW)
        : json({ importBatchId: 'b', created: 11, skipped: 1, replayed: false }, 201),
    );
    await upload();
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Importar 11 animales' }));

    expect(await screen.findByText('11 animales importados · 1 fila por corregir')).toBeVisible();
    const init = fetchMock.mock.calls.at(-1)?.[1];
    expect(formField(init, 'expectedRows')).toBe('11');
    expect(formField(init, 'importKey') as string).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('link', { name: 'Ver los animales' })).toHaveAttribute(
      'href',
      '/animals',
    );
  });

  it('un archivo que no sirve muestra el mensaje de la API', async () => {
    await renderApp(<ImportPage />, () =>
      problem(422, 'IMPORT_FILE_INVALID', 'El archivo tiene macros (.xlsm) y no se acepta.'),
    );
    await upload();
    expect(
      await screen.findByText('El archivo tiene macros (.xlsm) y no se acepta.'),
    ).toBeVisible();
  });
});

import type { SearchResult } from '@hato/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { json } from '../../../test/auth-harness';
import { renderApp } from '../../../test/app-harness';
import { looksLikeRfid, offersRfidAssociation, searchOutcome } from './outcome';
import { SearchResultsPage } from './SearchResultsPage';

const ID = '0199a1b2-0000-7000-8000-000000000001';
const OTHER = '0199a1b2-0000-7000-8000-000000000002';

const item = (id: string, code: string, exact: boolean): SearchResult['items'][number] => ({
  id,
  code,
  name: null,
  sex: 'FEMALE',
  status: 'ACTIVE',
  exact,
  matches: [{ kind: 'CODE', value: code }],
});

describe('flujo de búsqueda (ANI-05)', () => {
  it('coincidencia exacta con un animal: abre su ficha', () => {
    expect(
      searchOutcome({
        exactMatch: {
          animalId: ID,
          via: {
            kind: 'IDENTIFIER',
            identifierType: 'RFID',
            value: '170000000000001',
            previous: false,
          },
          matches: [],
        },
        items: [item(ID, '045', true)],
      }),
    ).toEqual({ kind: 'open', animalId: ID, previous: null });
  });

  it('por un identificador retirado: abre la ficha y dice cuál era (IDN-02 CA2)', () => {
    expect(
      searchOutcome({
        exactMatch: {
          animalId: ID,
          via: { kind: 'IDENTIFIER', identifierType: 'VISUAL_TAG', value: '087', previous: true },
          matches: [],
        },
        items: [],
      }),
    ).toEqual({ kind: 'open', animalId: ID, previous: { type: 'VISUAL_TAG', value: '087' } });
  });

  it('sin coincidencia exacta única: la pantalla de resultados', () => {
    expect(
      searchOutcome({ exactMatch: null, items: [item(ID, '066', true), item(OTHER, '057', true)] }),
    ).toEqual({
      kind: 'results',
    });
  });

  it('un chip de 15 dígitos que nadie tiene ofrece asociarlo; uno conocido o un código, no', () => {
    const none: SearchResult = { exactMatch: null, items: [] };
    expect(looksLikeRfid('170 000000000999')).toBe(true);
    expect(offersRfidAssociation('170000000000999', none)).toBe(true);
    expect(offersRfidAssociation('045', none)).toBe(false);
    expect(
      offersRfidAssociation('170000000000999', {
        exactMatch: null,
        items: [item(ID, '045', true)],
      }),
    ).toBe(false);
  });
});

describe('pantalla de resultados', () => {
  it('un chip desconocido ofrece «Asociar a un animal» y «Registrar animal nuevo» con el chip', async () => {
    await renderApp(<SearchResultsPage q="170000000000999" />, () =>
      json({ exactMatch: null, items: [] }),
    );

    expect(
      await screen.findByText('El chip 170000000000999 no está registrado'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Asociar a un animal' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar animal nuevo' })).toHaveAttribute(
      'href',
      '/animals/new?rfid=%22170000000000999%22',
    );
  });

  it('varias coincidencias exactas de animales distintos: se listan con el porqué', async () => {
    await renderApp(<SearchResultsPage q="066" />, () =>
      json({
        exactMatch: null,
        items: [
          { ...item(ID, '066', true), matches: [{ kind: 'CODE', value: '066' }] },
          {
            ...item(OTHER, '057', true),
            matches: [
              { kind: 'IDENTIFIER', identifierType: 'OTHER', value: '066', previous: false },
            ],
          },
        ],
      }),
    );

    expect(
      await screen.findByText('Varios animales coinciden exactamente con «066». Elige cuál.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Código 066')).toBeInTheDocument();
    expect(screen.getByText('Otro 066')).toBeInTheDocument();
  });
});

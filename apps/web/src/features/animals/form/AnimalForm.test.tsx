import type { AnimalDetail } from '@hato/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { json, problem } from '../../../test/auth-harness';
import { renderApp, sentBody } from '../../../test/app-harness';
import { IdentifierSaveError } from '../detail/Identifiers';
import { ApiError } from '../../../lib/api/errors';
import { AnimalForm } from './AnimalForm';

const BREED = '0199a1b2-0000-7000-8000-00000000000b';
const ANIMAL = '0199a1b2-0000-7000-8000-000000000001';

/** Respuestas de los catálogos y del código sugerido; lo demás lo decide cada prueba. */
function api(extra: (url: string, init: RequestInit) => Response | undefined = () => undefined) {
  return (url: string, init: RequestInit): Response => {
    const custom = extra(url, init);
    if (custom !== undefined) return custom;
    if (url.includes('/breeds')) {
      return json({
        items: [
          {
            id: BREED,
            name: 'Brahman',
            group: 'INDICUS',
            gestationDays: 293,
            isActive: true,
            version: 1,
          },
        ],
        nextCursor: null,
      });
    }
    if (url.includes('/lots') || url.includes('/tags'))
      return json({ items: [], nextCursor: null });
    if (url.includes('/animals/next-code')) return json({ code: '26-091' });
    return json({});
  };
}

function detail(patch: Partial<AnimalDetail> = {}): AnimalDetail {
  return {
    id: ANIMAL,
    code: '045',
    name: 'Canela',
    sex: 'FEMALE',
    breed: { id: BREED, name: 'Brahman' },
    birthDate: '2020-01-01' as AnimalDetail['birthDate'],
    birthDateEstimated: false,
    ageMonths: 80,
    category: 'COW',
    derivedTags: [],
    calvingCount: 1,
    expectedCalvingDate: null,
    manualTags: [],
    forSale: false,
    lot: null,
    lastWeight: null,
    status: 'ACTIVE',
    alerts: [],
    origin: 'BORN_ON_FARM',
    originDetail: null,
    entryDate: '2020-01-01' as AnimalDetail['entryDate'],
    ageDays: 2400,
    dam: null,
    sire: null,
    sireExternalRef: null,
    notes: null,
    photoUrl: null,
    exit: null,
    identifiers: [],
    reproduction: null,
    vaccines: [],
    withdrawalUntil: null,
    codeHistory: { previousHolder: null, currentHolder: null },
    archive: null,
    version: 4,
    ...patch,
  };
}

describe('AnimalForm: alta (ANI-01)', () => {
  it('nacido en la finca: propone el código siguiente mientras no se escriba otro', async () => {
    await renderApp(<AnimalForm />, api());
    await waitFor(() => {
      expect(screen.getByLabelText('Código')).toHaveValue('26-091');
    });
    expect(screen.getByText(/Número sugerido: 26-091/)).toBeInTheDocument();
  });

  it('ADMIN ve el valor de compra al elegir «Comprado»; el operario no (RN-20)', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderApp(<AnimalForm />, api());
    await user.click(screen.getByRole('radio', { name: 'Comprado' }));
    expect(screen.getByLabelText('Valor de compra')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de ingreso')).toBeInTheDocument();
    unmount();

    await renderApp(<AnimalForm />, api(), { session: { role: 'OPERATOR' } });
    await user.click(screen.getByRole('radio', { name: 'Comprado' }));
    expect(screen.getByLabelText('Fecha de ingreso')).toBeInTheDocument();
    expect(screen.queryByLabelText('Valor de compra')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Disponible para venta')).not.toBeInTheDocument();
  });

  it('valida con el esquema de shared antes de enviar: nada viaja con errores', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderApp(<AnimalForm />, api());
    await user.click(screen.getByRole('button', { name: 'Registrar animal' }));

    expect(await screen.findByText('Elige el sexo.')).toBeInTheDocument();
    expect(screen.getByText('Elige la raza.')).toBeInTheDocument();
    expect(screen.getByText('Escribe la fecha de nacimiento.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit).method === 'POST')).toBe(
      false,
    );
  });

  it('código repetido: el mensaje de la API queda junto al campo', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderApp(
      <AnimalForm />,
      api((url, init) =>
        url.endsWith('/animals') && init.method === 'POST'
          ? problem(409, 'ANIMAL_CODE_TAKEN', 'Ya existe un animal con el código 26-091.')
          : undefined,
      ),
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Código')).toHaveValue('26-091');
    });
    await user.click(screen.getByRole('radio', { name: 'Hembra' }));
    await user.selectOptions(screen.getByLabelText('Raza'), 'Brahman');
    await user.type(screen.getByLabelText('Fecha de nacimiento'), '2026-09-01');
    await user.type(screen.getByLabelText('Chip'), '170000000000555');
    await user.click(screen.getByRole('button', { name: 'Registrar animal' }));

    const code = screen.getByLabelText('Código');
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription(/Ya existe un animal con el código 26-091/);
    });
    const post = fetchMock.mock.calls.findIndex(
      ([url, init]) => String(url).endsWith('/animals') && (init as RequestInit).method === 'POST',
    );
    expect(sentBody(fetchMock, post)).toMatchObject({
      code: '26-091',
      sex: 'FEMALE',
      breedId: BREED,
      birthDate: '2026-09-01',
      origin: 'BORN_ON_FARM',
      identifiers: [{ type: 'RFID', value: '170000000000555' }],
    });
  });
});

describe('AnimalForm: edición (ANI-02)', () => {
  it('con salida registrada solo deja editar las observaciones (RN-09)', async () => {
    await renderApp(
      <AnimalForm
        animal={detail({
          status: 'SOLD',
          exit: { type: 'SALE', date: '2026-09-01' as never, reason: null },
        })}
      />,
      api(),
    );
    expect(await screen.findByText('Este animal ya salió de la finca')).toBeInTheDocument();
    expect(screen.getByLabelText('Observaciones')).toBeInTheDocument();
    expect(screen.queryByLabelText('Código')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Raza')).not.toBeInTheDocument();
  });

  it('si otra persona lo cambió, ofrece recargar (VERSION_CONFLICT)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderApp(
      <AnimalForm animal={detail()} />,
      api((_url, init) =>
        init.method === 'PATCH'
          ? problem(
              409,
              'VERSION_CONFLICT',
              'Otra persona modificó este registro. Recarga para ver los cambios.',
            )
          : undefined,
      ),
    );
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Canela II');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('button', { name: 'Recargar los datos' })).toBeInTheDocument();
    const patch = fetchMock.mock.calls.findIndex(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    );
    // Solo lo que cambió, con la versión que se estaba editando.
    expect(sentBody(fetchMock, patch)).toEqual({ version: 4, name: 'Canela II' });
  });
});

describe('errores al guardar un identificador (IDN-01, RN-19)', () => {
  const taken = new ApiError({
    status: 409,
    code: 'IDENTIFIER_TAKEN',
    detail: 'El identificador 87 ya está asignado al animal 26-001.',
    context: { animalId: ANIMAL, animalCode: '26-001' },
  });
  const reused = new ApiError({
    status: 409,
    code: 'IDENTIFIER_PREVIOUSLY_USED',
    detail:
      'El identificador 87 perteneció al animal 26-001. Solo un administrador puede reasignarlo.',
    context: { animalId: ANIMAL, animalCode: '26-001' },
  });

  it('IDENTIFIER_TAKEN enlaza a la ficha del animal que lo tiene', async () => {
    await renderApp(
      <IdentifierSaveError error={taken} isAdmin={false} onConfirmReuse={() => undefined} />,
      api(),
    );
    expect(screen.getByRole('link', { name: 'Abrir la ficha de 26-001' })).toHaveAttribute(
      'href',
      `/animals/${ANIMAL}`,
    );
  });

  it('IDENTIFIER_PREVIOUSLY_USED: el ADMIN confirma; el operario debe pedírselo a un administrador', async () => {
    const user = userEvent.setup();
    let confirmed = false;
    const { unmount } = await renderApp(
      <IdentifierSaveError
        error={reused}
        isAdmin
        onConfirmReuse={() => {
          confirmed = true;
        }}
      />,
      api(),
    );
    await user.click(screen.getByRole('button', { name: 'Sí, reasignarlo a este animal' }));
    expect(confirmed).toBe(true);
    unmount();

    await renderApp(
      <IdentifierSaveError error={reused} isAdmin={false} onConfirmReuse={() => undefined} />,
      api(),
    );
    expect(screen.getByText('Pídele a un administrador que lo reasigne.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reasignarlo/ })).not.toBeInTheDocument();
  });
});

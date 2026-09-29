import { toIsoDate, type AnimalDetail, type PregnancyView } from '@hato/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp, sentBody } from '../../test/app-harness';
import { json, problem } from '../../test/auth-harness';
import { animalDetail, FIXTURE_ANIMAL_ID } from '../../test/animal-fixture';
import { CalvingForm, calvingSavedMessage } from './CalvingForm';
import { ReproductionTab } from './ReproductionTab';
import { ServiceForm } from './ServiceForm';

const HOY = toIsoDate('2026-09-25');

function pregnancy(patch: Partial<PregnancyView> = {}): PregnancyView {
  return {
    id: '0199a1b2-0000-7000-8000-0000000000aa',
    dam: { id: FIXTURE_ANIMAL_ID, code: '5', name: null },
    serviceDate: toIsoDate('2026-01-12'),
    serviceDateEstimated: false,
    method: 'AI',
    sire: null,
    sireExternalRef: 'Pajilla 71',
    responsible: null,
    confirmedAt: toIsoDate('2026-03-20'),
    diagnosisResponsible: 'Dra. Paola',
    expectedCalvingDate: toIsoDate('2026-11-01'),
    expectedCalvingManual: false,
    outcome: 'PENDING',
    outcomeDate: null,
    calvingType: null,
    stillbornCount: 0,
    isImported: false,
    notes: null,
    gestationDays: 256,
    calves: [],
    voided: null,
    version: 1,
    ...patch,
  };
}

function cowWith(open: PregnancyView | null, history: PregnancyView[] = []): AnimalDetail {
  return animalDetail({
    reproduction: {
      calvingCount: 1,
      importedPriorCalvings: 0,
      lastCalvingDate: toIsoDate('2025-06-01'),
      openPregnancy: open,
      calvingInterval: { lastDays: null, averageDays: null },
      history: open === null ? history : [open, ...history],
    },
  });
}

const headerOf = (init: RequestInit | undefined, name: string): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe('calvingSavedMessage (06 §5.4)', () => {
  it('repite el verbo y nombra las crías creadas', () => {
    expect(calvingSavedMessage(['26-045'])).toBe('Parto guardado · 26-045 creado');
    expect(calvingSavedMessage(['26-045', '26-046'])).toBe(
      'Parto guardado · 26-045 y 26-046 creados',
    );
    expect(calvingSavedMessage([])).toBe('Parto guardado.');
  });
});

describe('CalvingForm (REP-04)', () => {
  it('mellizos: sugiere los códigos, una muerta al nacer no lleva código, y envía con clave de reintento', async () => {
    const { fetchMock } = await renderApp(<CalvingForm animal={cowWith(pregnancy())} />, (url) =>
      url.includes('/animals/next-code')
        ? json({
            code: '26-045',
            codes: url.includes('count=2') ? ['26-045', '26-046'] : ['26-045'],
          })
        : json(
            {
              pregnancy: pregnancy({ outcome: 'CALVED' }),
              calves: [{ id: 'c1', code: '26-045', name: null, sex: 'FEMALE' }],
              warnings: [],
            },
            201,
          ),
    );
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByLabelText('Código')).toHaveValue('26-045');
    });

    await user.click(screen.getByRole('button', { name: 'Agregar uno (Crías)' }));
    await waitFor(() => {
      expect(screen.getAllByLabelText('Código')[1]).toHaveValue('26-046');
    });
    const sexes = screen.getAllByRole('radio', { name: 'Hembra' });
    await user.click(sexes[0] as HTMLElement);
    await user.click(screen.getAllByRole('radio', { name: 'Macho' })[1] as HTMLElement);
    await user.click(screen.getAllByRole('radio', { name: 'Muerta' })[1] as HTMLElement);
    expect(screen.getAllByLabelText('Código')).toHaveLength(1);
    expect(screen.getByText(/no se registra como animal/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar parto' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/calvings'))).toBe(true);
    });
    const index = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith('/calvings'));
    expect(sentBody(fetchMock, index)).toMatchObject({
      damId: FIXTURE_ANIMAL_ID,
      pregnancyId: pregnancy().id,
      calvingType: 'NORMAL',
      calves: [
        { code: '26-045', sex: 'FEMALE', health: 'ALIVE' },
        { sex: 'MALE', health: 'STILLBORN' },
      ],
    });
    const init = fetchMock.mock.calls[index]?.[1] as RequestInit;
    expect(headerOf(init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un código tomado se muestra junto al código de esa cría', async () => {
    await renderApp(<CalvingForm animal={cowWith(null)} />, (url) =>
      url.includes('/animals/next-code')
        ? json({ code: '26-045', codes: ['26-045'] })
        : problem(409, 'ANIMAL_CODE_TAKEN', 'Ya existe un animal con el código 26-045.', {
            errors: { 'calves.0.code': ['Ya existe un animal con el código 26-045.'] },
          }),
    );
    const user = userEvent.setup();
    expect(
      screen.getByText('Sin preñez registrada: el parto quedará con fecha de servicio estimada.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Macho' }));
    await user.click(screen.getByRole('button', { name: 'Guardar parto' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Código')).toHaveAccessibleDescription(
        /Ya existe un animal con el código 26-045/,
      );
    });
  });

  it('sin sexo no envía nada y marca el campo', async () => {
    const { fetchMock } = await renderApp(<CalvingForm animal={cowWith(null)} />, () =>
      json({ code: '26-045', codes: ['26-045'] }),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Guardar parto' }));
    expect(await screen.findByText('Elige el sexo.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith('/calvings'))).toBe(true);
  });
});

describe('ServiceForm (REP-01)', () => {
  it('con una preñez abierta, el error ofrece ir a cerrarla (CA3)', async () => {
    await renderApp(<ServiceForm animal={cowWith(pregnancy())} />, (url) =>
      url.endsWith('/pregnancies')
        ? problem(409, 'PREGNANCY_ALREADY_OPEN', 'La hembra ya tiene una preñez abierta.', {
            context: { pregnancyId: pregnancy().id },
          })
        : url.endsWith('/farm')
          ? json({ settings: { gestationDays: 285 } })
          : json({ items: [], nextCursor: null }),
    );
    const user = userEvent.setup();
    expect(screen.getByText(/ya tiene una preñez abierta/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Inseminación' }));
    await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
    expect(await screen.findByRole('link', { name: 'Ver la preñez abierta' })).toBeInTheDocument();
  });

  it('muestra el parto estimado con la gestación de la raza (RN-04)', async () => {
    await renderApp(<ServiceForm animal={cowWith(null)} />, (url) =>
      url.endsWith('/farm')
        ? json({ settings: { gestationDays: 285 } })
        : json({
            items: [
              {
                id: animalDetail().breed.id,
                name: 'Brahman',
                group: 'INDICUS',
                gestationDays: 293,
                isActive: true,
                version: 1,
              },
            ],
            nextCursor: null,
          }),
    );
    expect(await screen.findByText(/Parto estimado:/)).toBeInTheDocument();
  });
});

describe('ReproductionTab (REP-05)', () => {
  it('preñez actual, historial con crías y muertas al nacer, intervalo sin dato y anular para ADMIN', async () => {
    const calved = pregnancy({
      id: '0199a1b2-0000-7000-8000-0000000000bb',
      serviceDate: toIsoDate('2024-08-01'),
      serviceDateEstimated: true,
      method: 'UNKNOWN',
      outcome: 'CALVED',
      outcomeDate: toIsoDate('2025-06-01'),
      calvingType: 'ASSISTED',
      stillbornCount: 1,
      calves: [{ id: 'c1', code: '25-010', name: null }],
    });
    await renderApp(
      <ReproductionTab animal={cowWith(pregnancy(), [calved])} today={HOY} isAdmin />,
      () => json({}),
    );
    expect(screen.getByText('256 días')).toBeInTheDocument();
    expect(
      screen.getByText(/Servicio aprox\. 01\/08\/2024 · sin servicio conocido/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '25-010' })).toBeInTheDocument();
    expect(screen.getByText('1 muerta al nacer')).toBeInTheDocument();
    expect(screen.getByText(/Sin dato: hacen falta dos partos seguidos/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Anular' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Registrar parto' })).toBeInTheDocument();
  });

  it('un operario no ve Anular', async () => {
    await renderApp(
      <ReproductionTab animal={cowWith(pregnancy())} today={HOY} isAdmin={false} />,
      () => json({}),
    );
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
  });
});

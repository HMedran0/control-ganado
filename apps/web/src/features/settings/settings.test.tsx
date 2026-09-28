import { DEFAULT_FARM_SETTINGS, type FarmView, type LotView } from '@hato/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fence } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from '../../components/ui/Checkbox';
import { renderApp, sentBody } from '../../test/app-harness';
import { json, problem } from '../../test/auth-harness';
import { CatalogPage } from './CatalogPage';
import { BreedForm } from './forms/BreedForm';
import { FarmForm } from './forms/FarmForm';
import { TemporaryPassword } from './forms/UserForms';
import { VaccineForm } from './forms/VaccineForm';
import { sectionsFor } from './sections';

describe('Checkbox', () => {
  it('toda la fila marca la casilla y la descripción queda enlazada', async () => {
    const onChange = vi.fn();
    render(
      <Checkbox label="Ciclo oficial del ICA" description="Aftosa y rabia" onChange={onChange} />,
    );

    const box = screen.getByRole('checkbox', { name: 'Ciclo oficial del ICA' });
    expect(box).toHaveAccessibleDescription('Aftosa y rabia');
    await userEvent.setup().click(screen.getByText('Ciclo oficial del ICA'));

    expect(box).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('secciones de Configuración por rol (SRS §2.3)', () => {
  it('ADMIN ve todas; VET solo Vacunas; OPERATOR ninguna', () => {
    expect(sectionsFor('ADMIN').map((s) => s.label)).toEqual([
      'Finca y parámetros',
      'Razas',
      'Vacunas',
      'Ciclos de vacunación',
      'Lotes',
      'Etiquetas',
      'Usuarios',
      'Importar inventario',
      'Archivados',
    ]);
    expect(sectionsFor('VET').map((s) => s.label)).toEqual(['Vacunas']);
    expect(sectionsFor('OPERATOR')).toEqual([]);
  });
});

describe('BreedForm', () => {
  it('propone la gestación del grupo y respeta la que se escribe a mano', async () => {
    const { fetchMock } = await renderApp(<BreedForm onSaved={vi.fn()} />, () =>
      json({ id: 'x', version: 1 }, 201),
    );
    const user = userEvent.setup();
    const gestation = screen.getByLabelText('Gestación (días)');

    await user.click(screen.getByRole('radio', { name: 'Cebuino' }));
    expect(gestation).toHaveValue('293');
    await user.click(screen.getByRole('radio', { name: 'Europeo' }));
    expect(gestation).toHaveValue('283');

    await user.clear(gestation);
    await user.type(gestation, '290');
    await user.click(screen.getByRole('radio', { name: 'Cruce' }));
    expect(gestation).toHaveValue('290');

    await user.type(screen.getByLabelText('Nombre'), '  Gyr   lechero ');
    await user.click(screen.getByRole('button', { name: 'Guardar raza' }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(sentBody(fetchMock, 0)).toEqual({
      name: 'Gyr lechero',
      group: 'CROSS',
      gestationDays: 290,
    });
  });

  it('un nombre repetido se muestra junto al campo del nombre', async () => {
    await renderApp(<BreedForm onSaved={vi.fn()} />, () =>
      problem(409, 'CATALOG_NAME_TAKEN', 'Ya existe una raza con el nombre «brahman».'),
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'brahman');
    await user.click(screen.getByRole('radio', { name: 'Cebuino' }));
    await user.click(screen.getByRole('button', { name: 'Guardar raza' }));

    expect(
      await screen.findByText('Ya existe una raza con el nombre «brahman».'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un conflicto de versión ofrece recargar', async () => {
    const onReload = vi.fn();
    await renderApp(
      <BreedForm
        breed={{
          id: 'b1',
          name: 'Brahman',
          group: 'INDICUS',
          gestationDays: 293,
          isActive: true,
          version: 1,
        }}
        onSaved={vi.fn()}
        onReload={onReload}
      />,
      () =>
        problem(
          409,
          'VERSION_CONFLICT',
          'Otra persona modificó este registro. Recarga para ver los cambios.',
        ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Guardar raza' }));
    await user.click(await screen.findByRole('button', { name: 'Recargar los datos' }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('VaccineForm', () => {
  it('el intervalo solo aparece en las vacunas por intervalo', async () => {
    await renderApp(<VaccineForm onSaved={vi.fn()} />, () => json({}));
    const user = userEvent.setup();

    expect(screen.queryByLabelText('Repetir cada (días)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Por intervalo' }));
    expect(screen.getByLabelText('Repetir cada (días)')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Ciclo oficial' }));
    expect(screen.queryByLabelText('Repetir cada (días)')).not.toBeInTheDocument();
  });

  it('valida la coherencia antes de enviar', async () => {
    const { fetchMock } = await renderApp(<VaccineForm onSaved={vi.fn()} />, () => json({}));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre comercial'), 'Triple');
    await user.type(screen.getByLabelText('Enfermedad o propósito'), 'Clostridiales');
    await user.click(screen.getByRole('radio', { name: 'Por intervalo' }));
    await user.click(screen.getByRole('button', { name: 'Guardar vacuna' }));

    expect(
      await screen.findByText('Indica cada cuántos días se repite la vacuna.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el bloqueo del otro sexo solo se activa al elegir a qué sexo se aplica', async () => {
    await renderApp(<VaccineForm onSaved={vi.fn()} />, () => json({}));
    const user = userEvent.setup();
    const block = screen.getByRole('checkbox', { name: 'No permitir registrarla en el otro sexo' });

    expect(block).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Hembras' }));
    expect(block).toBeEnabled();
  });
});

const FARM: FarmView = {
  id: 'f1',
  name: 'Finca La Esperanza',
  municipality: 'Montería',
  department: 'Córdoba',
  icaPremiseCode: null,
  settings: DEFAULT_FARM_SETTINGS,
  version: 4,
};

describe('FarmForm', () => {
  it('advierte antes de guardar si cambia el destete, y envía la versión', async () => {
    const { fetchMock } = await renderApp(<FarmForm farm={FARM} onReload={vi.fn()} />, () =>
      json({ ...FARM, version: 5 }),
    );
    const user = userEvent.setup();

    expect(screen.queryByText('Esto cambia las cuentas del hato')).not.toBeInTheDocument();
    const weaning = screen.getByLabelText('Edad de destete (meses)');
    await user.clear(weaning);
    await user.type(weaning, '8');
    expect(screen.getByText('Esto cambia las cuentas del hato')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar parámetros' }));
    expect(await screen.findByText('Parámetros guardados.')).toBeInTheDocument();
    expect(sentBody(fetchMock, 0)).toMatchObject({
      version: 4,
      settings: { weaningAgeMonths: 8, gestationDays: 285 },
    });
    // El precio por kilo no viaja: el PATCH es parcial y no lo toca.
    expect(JSON.stringify(sentBody(fetchMock, 0))).not.toContain('pricePerKgByCategory');
  });

  it('numeración: reutilizar números y menor número libre; el patrón solo con «Código de las crías» (ANI-10)', async () => {
    const { fetchMock } = await renderApp(<FarmForm farm={FARM} onReload={vi.fn()} />, () =>
      json({ ...FARM, version: 5 }),
    );
    const user = userEvent.setup();

    expect(screen.getByLabelText('Código de las crías')).toBeInTheDocument();
    const reuse = screen.getByRole('radiogroup', {
      name: '¿Reutilizar números de animales que salen de la finca?',
    });
    await user.click(within(reuse).getByRole('radio', { name: 'Sí' }));
    await user.click(screen.getByRole('radio', { name: 'Menor número libre' }));
    expect(screen.queryByLabelText('Código de las crías')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar parámetros' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(sentBody(fetchMock, 0)).toMatchObject({
      settings: { codeReuse: true, codeSuggestion: 'LOWEST_FREE' },
    });
  });

  it('CODE_REUSE_CONFLICT: muestra qué números están repetidos', async () => {
    const detail =
      'Hay números repetidos entre animales activos y animales que salieron (5 y 5). Cámbialos antes de desactivar la reutilización.';
    await renderApp(
      <FarmForm
        farm={{ ...FARM, settings: { ...FARM.settings, codeReuse: true } }}
        onReload={vi.fn()}
      />,
      () => problem(409, 'CODE_REUSE_CONFLICT', detail),
    );
    const user = userEvent.setup();
    const reuse = screen.getByRole('radiogroup', {
      name: '¿Reutilizar números de animales que salen de la finca?',
    });
    await user.click(within(reuse).getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: 'Guardar parámetros' }));
    expect(await screen.findByText(detail)).toBeInTheDocument();
  });
});

describe('TemporaryPassword', () => {
  it('muestra la contraseña una vez, con opción de copiarla', async () => {
    // user-event instala su propio portapapeles al iniciarse: el falso va después.
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <TemporaryPassword
        result={{
          user: {
            id: 'u1',
            name: 'Yeison Mendoza',
            username: 'yeison',
            email: null,
            role: 'OPERATOR',
            isActive: true,
            mustChangePassword: true,
            lastLoginAt: null,
          },
          temporaryPassword: 'toro-lucero-8421',
        }}
        action={null}
      />,
    );

    expect(screen.getByText('toro-lucero-8421')).toBeInTheDocument();
    expect(screen.getByText('No se volverá a mostrar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copiar contraseña' }));

    expect(writeText).toHaveBeenCalledWith('toro-lucero-8421');
    expect(await screen.findByText('Contraseña copiada.')).toBeInTheDocument();
  });
});

const LOT: LotView = {
  id: 'l1',
  name: 'Paridas',
  description: null,
  isActive: true,
  version: 1,
};

function lotsPage() {
  return (
    <CatalogPage
      catalog="lots"
      title="Lotes"
      description="Grupos de manejo."
      deactivatedMessage="Lote desactivado"
      nameOf={(lot) => lot.name}
      columns={[{ key: 'name', header: 'Lote', cell: (lot) => lot.name }]}
      newLink={null}
      editLink={() => null}
      empty={{ icon: Fence, title: 'Todavía no hay lotes', description: 'Crea el primero.' }}
    />
  );
}

describe('CatalogPage: desactivar', () => {
  it('con animales activos, primero advierte y pide confirmar', async () => {
    await renderApp(lotsPage(), (url, init) => {
      if (url.endsWith('/deactivation-warnings')) {
        return json({
          warnings: [
            { code: 'LOT_HAS_ACTIVE_ANIMALS', message: '12 animales siguen en este lote.' },
          ],
        });
      }
      if (init.method === 'PATCH')
        return json({ ...LOT, isActive: false, version: 2, warnings: [] });
      return json({ items: [LOT], nextCursor: null });
    });
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Lotes' });

    await user.click(within(table).getByRole('button', { name: 'Desactivar Paridas' }));

    expect(
      await screen.findByText(/12 animales siguen en este lote\. Si lo desactivas/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desactivar de todos modos' }));
    expect(await screen.findByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
  });

  it('sin advertencias desactiva de una vez y ofrece deshacer', async () => {
    const patches: unknown[] = [];
    await renderApp(lotsPage(), (url, init) => {
      if (url.endsWith('/deactivation-warnings')) return json({ warnings: [] });
      if (init.method === 'PATCH') {
        patches.push(JSON.parse(typeof init.body === 'string' ? init.body : 'null'));
        return json({ ...LOT, isActive: false, version: 2, warnings: [] });
      }
      return json({ items: [LOT], nextCursor: null });
    });
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Lotes' });

    await user.click(within(table).getByRole('button', { name: 'Desactivar Paridas' }));
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }));

    await vi.waitFor(() => {
      expect(patches).toEqual([
        { version: 1, isActive: false },
        { version: 2, isActive: true },
      ]);
    });
  });
});

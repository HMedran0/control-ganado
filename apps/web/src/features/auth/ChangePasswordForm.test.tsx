import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { fakeSession, json, problem, renderWithAuth } from '../../test/auth-harness';
import { ChangePasswordForm } from './ChangePasswordForm';

async function submit(current: string, next: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Contraseña actual'), current);
  await user.type(screen.getByLabelText('Contraseña nueva'), next);
  await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
}

describe('ChangePasswordForm', () => {
  it('rechaza una contraseña nueva igual a la actual (esquema de @hato/shared)', async () => {
    const { fetchMock } = renderWithAuth(<ChangePasswordForm onSuccess={vi.fn()} />, () =>
      json({}),
    );

    await submit('temporal-123', 'temporal-123');

    expect(
      await screen.findByText('La contraseña nueva debe ser distinta de la actual.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige el largo mínimo', async () => {
    renderWithAuth(<ChangePasswordForm onSuccess={vi.fn()} />, () => json({}));

    await submit('temporal-123', 'corta');

    expect(
      await screen.findByText('La contraseña debe tener al menos 8 caracteres.'),
    ).toBeInTheDocument();
  });

  it('muestra junto al campo que la contraseña actual no es correcta', async () => {
    renderWithAuth(
      <ChangePasswordForm onSuccess={vi.fn()} />,
      () => problem(401, 'AUTH_INVALID_CREDENTIALS', 'La contraseña actual no es correcta.'),
      fakeSession({ user: { ...fakeSession().user, mustChangePassword: true } }),
    );

    await submit('equivocada', 'nueva-clave-segura');

    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña actual')).toHaveAttribute('aria-invalid', 'true');
  });

  it('con éxito reemplaza la sesión por la nueva y avisa', async () => {
    const onSuccess = vi.fn();
    const renewed = fakeSession({ accessToken: 'token-nuevo' });
    const { store } = renderWithAuth(
      <ChangePasswordForm onSuccess={onSuccess} />,
      () => json(renewed, 201),
      fakeSession({ user: { ...fakeSession().user, mustChangePassword: true } }),
    );

    await submit('temporal-123', 'nueva-clave-segura');

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(renewed);
    });
    expect(store.get()?.accessToken).toBe('token-nuevo');
    expect(store.get()?.user.mustChangePassword).toBe(false);
  });
});

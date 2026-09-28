import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NETWORK_ERROR_DETAIL } from '../../lib/api/errors';
import { fakeSession, json, problem, renderWithAuth } from '../../test/auth-harness';
import { LoginForm } from './LoginForm';

async function fillAndSubmit(login = 'alvaro', password = 'clave-secreta'): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Usuario'), login);
  await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginForm', () => {
  it('tiene etiquetas visibles, el botón Entrar y la ayuda para quien olvidó la contraseña', () => {
    renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () => json({}));

    expect(screen.getByLabelText('Usuario')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(
      screen.getByText(
        'Si olvidaste tu contraseña, pídele al administrador de la finca una temporal.',
      ),
    ).toBeInTheDocument();
  });

  it('valida con el esquema de @hato/shared antes de llamar a la API', async () => {
    const { fetchMock } = renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () => json({}));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Escribe tu usuario o correo.')).toBeInTheDocument();
    expect(screen.getByText('Escribe tu contraseña.')).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['AUTH_INVALID_CREDENTIALS', 401, 'Usuario o contraseña incorrectos.'],
    [
      'AUTH_ACCOUNT_LOCKED',
      423,
      'La cuenta está bloqueada por intentos fallidos. Intenta de nuevo en 15 minutos.',
    ],
    ['RATE_LIMITED', 429, 'Demasiadas solicitudes. Espera un momento.'],
    ['INTERNAL_ERROR', 500, 'Ocurrió un error inesperado. Ya quedó registrado.'],
  ])('ante %s (%i) muestra «%s»', async (code, status, message) => {
    // El servidor podría redactar distinto: la pantalla usa el texto del catálogo.
    renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () =>
      problem(status, code, code === 'INTERNAL_ERROR' ? message : 'texto del servidor'),
    );

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('sin conexión muestra el mensaje de conexión', async () => {
    renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () => {
      throw new TypeError('Failed to fetch');
    });

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR_DETAIL);
  });

  it('pone junto al campo los errores por campo de VALIDATION_FAILED', async () => {
    renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () =>
      problem(422, 'VALIDATION_FAILED', 'Revisa los campos marcados.', {
        errors: { login: ['El usuario es demasiado largo.'] },
      }),
    );

    await fillAndSubmit();

    const field = screen.getByLabelText('Usuario');
    expect(await screen.findByText('El usuario es demasiado largo.')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/El usuario es demasiado largo\./);
  });

  it('con credenciales válidas guarda la sesión y avisa', async () => {
    const onSuccess = vi.fn();
    const session = fakeSession();
    const { store, fetchMock } = renderWithAuth(<LoginForm onSuccess={onSuccess} />, () =>
      json(session, 201),
    );

    await fillAndSubmit(' Alvaro ', 'clave-secreta');

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(session);
    });
    expect(store.get()).toEqual(session);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, string>;
    // El esquema compartido recorta los espacios del usuario.
    expect(body).toEqual({ login: 'Alvaro', password: 'clave-secreta' });
  });

  it('deshabilita el botón mientras entra', async () => {
    renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () => new Promise<Response>(() => {}));

    await fillAndSubmit();

    const button = await screen.findByRole('button', { name: 'Entrando…' });
    expect(button).toBeDisabled();
  });

  it('permite mostrar la contraseña', async () => {
    renderWithAuth(<LoginForm onSuccess={vi.fn()} />, () => json({}));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Contraseña');
    const field = input.closest('div')!;
    const toggle = within(field).getByRole('button', { name: 'Mostrar contraseña' });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('con la sesión en su tope, llega con el usuario ya escrito (AUT-10 CA2)', () => {
    renderWithAuth(<LoginForm onSuccess={vi.fn()} defaultLogin="alvaro" />, () => json({}));
    expect(screen.getByLabelText('Usuario')).toHaveValue('alvaro');
    expect(screen.getByLabelText('Contraseña', { exact: true })).toHaveValue('');
  });
});

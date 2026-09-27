import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, MIN_PASSWORD_LENGTH, type SessionResponse } from '@hato/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { PasswordField } from '../../components/ui/PasswordField';
import { isApiError } from '../../lib/api/errors';
import { useAuth } from '../../lib/auth/context';
import { applyFieldErrors, loginErrorMessage } from './messages';

/**
 * Cambio de contraseña (AUT-04). Sirve para el cambio obligatorio de una contraseña temporal
 * y para «Mi cuenta». La API revoca las demás sesiones y devuelve una nueva (AUT-04 CA3).
 */
export function ChangePasswordForm({
  onSuccess,
}: {
  onSuccess: (session: SessionResponse) => void;
}) {
  const { api } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await api.changePassword(values);
      reset();
      onSuccess(session);
    } catch (error) {
      // La API responde AUTH_INVALID_CREDENTIALS con «La contraseña actual no es correcta.»:
      // el mensaje va junto al campo que hay que corregir.
      if (isApiError(error) && error.code === 'AUTH_INVALID_CREDENTIALS') {
        setError('currentPassword', { type: 'server', message: error.detail });
        return;
      }
      if (!applyFieldErrors(error, ['currentPassword', 'newPassword'], setError)) {
        setFormError(loginErrorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
      <FormError message={formError} />
      <PasswordField
        label="Contraseña actual"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register('currentPassword')}
      />
      <PasswordField
        label="Contraseña nueva"
        hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres, distinta de la actual.`}
        autoComplete="new-password"
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <Button type="submit" block disabled={isSubmitting}>
        {isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
      </Button>
    </form>
  );
}

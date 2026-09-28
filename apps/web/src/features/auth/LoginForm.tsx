import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type SessionResponse } from '@hato/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { PasswordField } from '../../components/ui/PasswordField';
import { TextField } from '../../components/ui/TextField';
import { useAuth } from '../../lib/auth/context';
import { applyFieldErrors, loginErrorMessage } from './messages';

/** Inicio de sesión (AUT-01, 06 §5.7). */
export function LoginForm({
  onSuccess,
  defaultLogin = '',
}: {
  onSuccess: (session: SessionResponse) => void;
  /** Usuario ya escrito, cuando la sesión cumplió el tope (AUT-10 CA2). */
  defaultLogin?: string;
}) {
  const { api } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: defaultLogin, password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      onSuccess(await api.login(values));
    } catch (error) {
      if (!applyFieldErrors(error, ['login', 'password'], setError)) {
        setFormError(loginErrorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
      <FormError message={formError} />
      <TextField
        label="Usuario"
        hint="Tu nombre de usuario o tu correo."
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={errors.login?.message}
        {...register('login')}
      />
      <PasswordField
        label="Contraseña"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" block disabled={isSubmitting}>
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </Button>
      <p className="text-aux text-texto-2">
        Si olvidaste tu contraseña, pídele al administrador de la finca una temporal.
      </p>
    </form>
  );
}

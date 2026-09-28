import { zodResolver } from '@hookform/resolvers/zod';
import {
  createUserSchema,
  type Role,
  type UserView,
  type UserWithTemporaryPassword,
} from '@hato/shared';
import { Copy, KeyRound, LogOut } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { AlertBanner } from '../../../components/ui/AlertBanner';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { FormError } from '../../../components/ui/FormError';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { TextField } from '../../../components/ui/TextField';
import { isApiError } from '../../../lib/api/errors';
import { ROLE_LABELS } from '../../../lib/auth/roles';
import { useRevokeUserSessions } from '../../auth/sessions';
import { useUserMutations } from '../api';
import { FormActions } from '../FormActions';
import { saveErrorMessage } from '../form-errors';

const ROLE_OPTIONS = (['ADMIN', 'OPERATOR', 'VET'] as const).map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

/**
 * Contraseña temporal recién generada (AUT-03, AUT-04 CA2). Se muestra **una sola vez**: la
 * API no la guarda en claro y no hay forma de volver a consultarla.
 */
export function TemporaryPassword({
  result,
  action,
}: {
  result: UserWithTemporaryPassword;
  action: ReactNode;
}) {
  const [copied, setCopied] = useState<'si' | 'no' | null>(null);
  return (
    <section
      aria-labelledby="contrasena-temporal"
      className="flex max-w-xl flex-col gap-4 rounded-panel border-2 border-potrero bg-superficie p-5"
    >
      <h2 id="contrasena-temporal" className="flex items-center gap-2 text-lg font-bold">
        <KeyRound aria-hidden="true" className="size-6 text-potrero" />
        Contraseña temporal de {result.user.name}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-texto-2">Usuario</dt>
        <dd className="font-bold">{result.user.username}</dd>
        <dt className="text-texto-2">Contraseña</dt>
        <dd
          className="font-cifras text-xl tracking-wide break-all"
          data-testid="contrasena-temporal"
        >
          {result.temporaryPassword}
        </dd>
      </dl>
      <AlertBanner
        tone="aviso"
        title="No se volverá a mostrar"
        description="Entrégala en persona. Al entrar, tendrá que cambiarla por una propia."
      />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(result.temporaryPassword).then(
              () => setCopied('si'),
              () => setCopied('no'),
            );
          }}
        >
          <Copy aria-hidden="true" className="size-5" />
          Copiar contraseña
        </Button>
        {action}
      </div>
      <p role="status" className="font-bold text-potrero">
        {copied === 'si' ? 'Contraseña copiada.' : ''}
        {copied === 'no' ? 'No se pudo copiar: anótala a mano.' : ''}
      </p>
    </section>
  );
}

/** Crear un usuario con contraseña temporal (AUT-03). */
export function UserCreateForm({ done }: { done: ReactNode }) {
  const { create } = useUserMutations();
  const [result, setResult] = useState<UserWithTemporaryPassword | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', username: '', email: '', role: 'OPERATOR' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      setResult(await create.mutateAsync(values));
    } catch (error) {
      if (isApiError(error) && error.code === 'USERNAME_TAKEN') {
        setError('username', { type: 'server', message: error.detail });
        return;
      }
      setFormError(
        saveErrorMessage(error, { fields: ['name', 'username', 'email', 'role'], setError }),
      );
    }
  });

  if (result !== null) return <TemporaryPassword result={result} action={done} />;

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="flex max-w-xl flex-col gap-5"
    >
      <TextField label="Nombre" error={errors.name?.message} {...register('name')} />
      <TextField
        label="Usuario"
        hint="Con el que entra: minúsculas, sin espacios. Por ejemplo, yeison."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={errors.username?.message}
        {...register('username')}
      />
      <TextField
        label="Correo"
        type="email"
        hint="Opcional: muchos operarios de campo no tienen."
        error={errors.email?.message}
        {...register('email')}
      />
      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <SegmentedChoice<Role>
            label="Rol"
            options={ROLE_OPTIONS}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <FormActions
        submitLabel="Crear usuario"
        submitting={isSubmitting}
        error={formError}
        conflict={false}
        onReload={() => undefined}
      />
    </form>
  );
}

/** Editar nombre, correo y rol; desactivar o activar; generar una contraseña temporal. */
export function UserEditForm({ user, done }: { user: UserView; done: ReactNode }) {
  const { update, resetPassword } = useUserMutations();
  const revokeSessions = useRevokeUserSessions();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [role, setRole] = useState<Role>(user.role);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [temporary, setTemporary] = useState<UserWithTemporaryPassword | null>(null);

  const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setFormError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      // LAST_ADMIN, USERNAME_TAKEN (correo repetido)… con su mensaje del catálogo.
      setFormError(isApiError(error) ? error.detail : 'Ocurrió un error inesperado.');
    }
  };

  if (temporary !== null) return <TemporaryPassword result={temporary} action={done} />;

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => update.mutateAsync({ id: user.id, body: { name, email, role } }),
            'Cambios guardados.',
          );
        }}
      >
        <TextField
          label="Nombre"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField label="Usuario" value={user.username} readOnly hint="No se puede cambiar." />
        <TextField
          label="Correo"
          type="email"
          value={email}
          hint="Opcional."
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <SegmentedChoice<Role> label="Rol" options={ROLE_OPTIONS} value={role} onChange={setRole} />
        <Button type="submit" block className="lg:w-auto lg:self-start" disabled={update.isPending}>
          Guardar cambios
        </Button>
      </form>

      <section aria-labelledby="acceso" className="flex flex-col gap-3">
        <h2 id="acceso" className="text-lg font-bold">
          Acceso
        </h2>
        <p className="text-texto-2">
          {user.isActive
            ? 'Puede entrar a la aplicación.'
            : 'Desactivado: no puede entrar y sus sesiones se cerraron.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={resetPassword.isPending}
            onClick={() => {
              void resetPassword.mutateAsync(user.id).then(setTemporary, (error: unknown) => {
                setFormError(isApiError(error) ? error.detail : 'Ocurrió un error inesperado.');
              });
            }}
          >
            <KeyRound aria-hidden="true" className="size-5" />
            Generar contraseña temporal
          </Button>
          <Button
            variant="secondary"
            disabled={update.isPending}
            onClick={() => {
              void run(
                () => update.mutateAsync({ id: user.id, body: { isActive: !user.isActive } }),
                user.isActive ? 'Usuario desactivado.' : 'Usuario activado.',
              );
            }}
          >
            {user.isActive ? 'Desactivar usuario' : 'Activar usuario'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              revokeSessions.reset();
              setConfirmRevoke(true);
            }}
          >
            <LogOut aria-hidden="true" className="size-5" />
            Cerrar todas sus sesiones
          </Button>
        </div>
      </section>

      <Dialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={`¿Cerrar las sesiones de ${user.name}?`}
        description="Se cerrará su sesión en todos sus equipos. Úsalo si perdió o prestó un celular o un computador: tendrá que volver a entrar con su contraseña."
      >
        <div className="flex flex-col gap-4">
          <FormError
            message={
              revokeSessions.error === null
                ? null
                : isApiError(revokeSessions.error)
                  ? revokeSessions.error.detail
                  : 'Ocurrió un error inesperado.'
            }
          />
          <Button
            block
            disabled={revokeSessions.isPending}
            onClick={() => {
              setMessage(null);
              void revokeSessions.mutateAsync(user.id).then(
                ({ revoked }) => {
                  setConfirmRevoke(false);
                  setMessage(
                    revoked === 0
                      ? `${user.name} no tenía sesiones abiertas.`
                      : revoked === 1
                        ? 'Se cerró 1 sesión.'
                        : `Se cerraron ${revoked} sesiones.`,
                  );
                },
                () => undefined,
              );
            }}
          >
            {revokeSessions.isPending ? 'Cerrando…' : 'Cerrar todas sus sesiones'}
          </Button>
        </div>
      </Dialog>

      <FormError message={formError} />
      <p role="status" className="font-bold text-potrero">
        {message ?? ''}
      </p>
    </div>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import {
  EXIT_TYPE,
  archiveAnimalSchema,
  exitAnimalSchema,
  exitNeedsWithdrawalConfirmation,
  formatDate,
  type AnimalDetail,
  type AnimalDetailWithWarnings,
  type ExitType,
  type IsoDate,
  type Warning,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { DateQuickPick } from '../../../components/ui/DateQuickPick';
import { Dialog } from '../../../components/ui/Dialog';
import { NumberField } from '../../../components/ui/NumberField';
import { SelectField } from '../../../components/ui/SelectField';
import { TextAreaField } from '../../../components/ui/TextAreaField';
import { TextField } from '../../../components/ui/TextField';
import { isApiError } from '../../../lib/api/errors';
import { useToday } from '../../../lib/clock';
import { useAnimalLifecycle, useNextCode } from '../api';
import { EXIT_TYPE_LABEL } from './history';

/** Resultado de una acción: mensaje de confirmación y advertencias de la API. */
/** Lo que pasó y, en una venta (CU-04, M7), la pestaña donde se ve el resultado económico. */
export type LifecycleResult = {
  readonly message: string;
  readonly warnings: readonly Warning[];
  readonly showCosts?: boolean;
};

type DialogKind = 'exit' | 'revert' | 'archive' | 'restore';

/**
 * Acciones del ADMIN sobre el ciclo de vida del animal (ANI-03, ANI-04): registrar la salida,
 * revertirla, archivar y restaurar. Los demás roles no ven los botones; la API además lo exige.
 */
export function LifecycleActions({
  animal,
  onDone,
}: {
  animal: AnimalDetail;
  onDone: (result: LifecycleResult) => void;
}) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const close = () => {
    setDialog(null);
  };
  const done = (result: LifecycleResult) => {
    setDialog(null);
    onDone(result);
  };
  const archived = animal.archive !== null;
  const exited = animal.exit !== null;

  return (
    <div className="flex flex-wrap gap-2">
      {archived ? (
        <Button
          variant="secondary"
          onClick={() => {
            setDialog('restore');
          }}
        >
          Restaurar animal
        </Button>
      ) : (
        <>
          {exited ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog('revert');
              }}
            >
              Revertir salida
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog('exit');
              }}
            >
              Registrar salida
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setDialog('archive');
            }}
          >
            Archivar
          </Button>
        </>
      )}

      {dialog === 'exit' ? <ExitDialog animal={animal} onClose={close} onDone={done} /> : null}
      {dialog === 'revert' ? (
        <CodeRetryDialog animal={animal} kind="revert" onClose={close} onDone={done} />
      ) : null}
      {dialog === 'restore' ? (
        <CodeRetryDialog animal={animal} kind="restore" onClose={close} onDone={done} />
      ) : null}
      {dialog === 'archive' ? (
        <ArchiveDialog animal={animal} onClose={close} onDone={done} />
      ) : null}
    </div>
  );
}

function resultOf(saved: AnimalDetailWithWarnings, message: string): LifecycleResult {
  return { message, warnings: saved.warnings };
}

/** Error de la API con el enlace al animal que tiene el código o la chapeta, si lo manda. */
export function LifecycleError({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  const detail = isApiError(error) ? error.detail : 'Ocurrió un error inesperado.';
  const context = isApiError(error) ? error.context : undefined;
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-control border-2 border-alerta bg-alerta-claro p-3 text-alerta-intenso"
    >
      <p className="flex items-start gap-2 font-bold">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {detail}
      </p>
      {context?.animalId === undefined ? null : (
        <Link
          to="/animals/$id"
          params={{ id: context.animalId }}
          className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
        >
          Abrir la ficha de {context.animalCode ?? 'ese animal'}
        </Link>
      )}
    </div>
  );
}

const EXIT_TYPES = Object.values(EXIT_TYPE);

function ExitDialog({
  animal,
  onClose,
  onDone,
}: {
  animal: AnimalDetail;
  onClose: () => void;
  onDone: (result: LifecycleResult) => void;
}) {
  const today = useToday();
  const { exit } = useAnimalLifecycle(animal.id);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(exitAnimalSchema),
    defaultValues: {
      type: EXIT_TYPE.SALE as ExitType,
      date: today,
      reason: '',
      sale: { amount: undefined, buyer: '' },
      confirmWithdrawal: false,
    },
  });
  const type = useWatch({ control, name: 'type' });
  const date = useWatch({ control, name: 'date' }) as IsoDate;
  const isSale = type === EXIT_TYPE.SALE;
  const needsConfirmation = exitNeedsWithdrawalConfirmation({
    type,
    date,
    meatWithdrawalUntil: animal.withdrawals.meatUntil,
  });
  const name = animal.name ?? animal.code;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Registrar salida de ${name}`}
      description="El animal sale del inventario activo. Si fue un error, se puede revertir."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (values) => {
            try {
              const saved = await exit.mutateAsync({
                ...values,
                ...(isSale ? {} : { sale: undefined }),
                ...(needsConfirmation ? {} : { confirmWithdrawal: undefined }),
              });
              onDone(
                isSale
                  ? {
                      ...resultOf(
                        saved,
                        `Venta de ${name} registrada. Este es su resultado económico.`,
                      ),
                      showCosts: true,
                    }
                  : resultOf(saved, `Salida de ${name} registrada.`),
              );
            } catch (error) {
              if (isApiError(error) && error.code === 'SALE_AMOUNT_REQUIRED') {
                setError('sale.amount', { message: 'Indica el precio de venta.' });
              }
            }
          })(event)
        }
      >
        <SelectField label="Tipo de salida" error={errors.type?.message} {...register('type')}>
          {EXIT_TYPES.map((value) => (
            <option key={value} value={value}>
              {EXIT_TYPE_LABEL[value]}
            </option>
          ))}
        </SelectField>
        <Controller
          control={control}
          name="date"
          render={({ field }) => (
            <DateQuickPick
              label="Fecha de salida"
              value={field.value as IsoDate}
              onChange={field.onChange}
              today={today}
              min={animal.entryDate}
            />
          )}
        />
        {isSale ? (
          <>
            <Controller
              control={control}
              name="sale.amount"
              render={({ field }) => (
                <NumberField
                  label="Precio de venta"
                  currency
                  value={field.value ?? null}
                  onChange={(next) => {
                    field.onChange(next ?? undefined);
                  }}
                  error={errors.sale?.amount?.message}
                />
              )}
            />
            <TextField
              label="Comprador"
              hint="Opcional."
              error={errors.sale?.buyer?.message}
              {...register('sale.buyer')}
            />
          </>
        ) : null}
        <TextAreaField
          label="Motivo u observaciones"
          hint="Opcional."
          error={errors.reason?.message}
          {...register('reason')}
        />
        {needsConfirmation && animal.withdrawals.meatUntil !== null ? (
          <div className="flex flex-col gap-2 rounded-control border-2 border-aviso bg-aviso-claro p-3 text-aviso-intenso">
            <p className="font-bold">
              Está en retiro de carne hasta el {formatDate(animal.withdrawals.meatUntil)}.
            </p>
            <Checkbox
              label="Confirmo la salida aunque esté en retiro"
              description="Queda registrado en los cambios del animal."
              {...register('confirmWithdrawal')}
            />
          </div>
        ) : null}
        <LifecycleError
          error={
            isApiError(exit.error) && exit.error.code === 'SALE_AMOUNT_REQUIRED' ? null : exit.error
          }
        />
        <Button type="submit" block disabled={isSubmitting || exit.isPending}>
          {exit.isPending ? 'Guardando…' : 'Registrar salida'}
        </Button>
      </form>
    </Dialog>
  );
}

function ArchiveDialog({
  animal,
  onClose,
  onDone,
}: {
  animal: AnimalDetail;
  onClose: () => void;
  onDone: (result: LifecycleResult) => void;
}) {
  const { archive } = useAnimalLifecycle(animal.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(archiveAnimalSchema), defaultValues: { reason: '' } });
  const name = animal.name ?? animal.code;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Archivar ${name}`}
      description="Deja de aparecer en listados y conteos, y se retiran todos sus identificadores, también el DIN y el chip. Se puede restaurar desde Configuración → Archivados."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (values) => {
            try {
              const saved = await archive.mutateAsync(values);
              onDone(resultOf(saved, `${name} quedó archivado.`));
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
        <TextAreaField
          label="Motivo"
          hint="Por ejemplo, «registro duplicado por error»."
          error={errors.reason?.message}
          {...register('reason')}
        />
        <LifecycleError error={archive.error} />
        <Button type="submit" block disabled={isSubmitting || archive.isPending}>
          {archive.isPending ? 'Archivando…' : 'Archivar animal'}
        </Button>
      </form>
    </Dialog>
  );
}

/**
 * Revertir una salida o restaurar un archivado. Primero se intenta con su código; si otro
 * animal activo ya lo tiene (`CODE_REASSIGNED` o `ANIMAL_CODE_TAKEN`), se pide un código nuevo,
 * con el menor libre o el patrón de la finca como sugerencia.
 */
function CodeRetryDialog({
  animal,
  kind,
  onClose,
  onDone,
}: {
  animal: AnimalDetail;
  kind: 'revert' | 'restore';
  onClose: () => void;
  onDone: (result: LifecycleResult) => void;
}) {
  const lifecycle = useAnimalLifecycle(animal.id);
  const mutation = kind === 'revert' ? lifecycle.revertExit : lifecycle.restore;
  const [askCode, setAskCode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const suggestion = useNextCode(askCode ? animal.birthDate : null);
  const name = animal.name ?? animal.code;
  const texts =
    kind === 'revert'
      ? {
          title: `Revertir la salida de ${name}`,
          description:
            animal.exit === null
              ? ''
              : `Vuelve al inventario activo. Se anula la ${animal.exit.type === 'SALE' ? 'venta' : 'salida'} del ${formatDate(animal.exit.date)}.`,
          submit: 'Revertir salida',
          done: `${name} volvió al inventario.`,
        }
      : {
          title: `Restaurar ${name}`,
          description:
            'Vuelve a aparecer en listados y conteos, con los identificadores que sigan libres.',
          submit: 'Restaurar animal',
          done: `${name} quedó restaurado.`,
        };

  const submit = async () => {
    const code = newCode.trim();
    if (askCode && code === '') {
      setCodeError('Escribe el código nuevo.');
      return;
    }
    setCodeError(undefined);
    try {
      const saved = await mutation.mutateAsync(askCode ? { newCode: code } : {});
      onDone(resultOf(saved, texts.done));
    } catch (error) {
      if (
        isApiError(error) &&
        (error.code === 'CODE_REASSIGNED' || error.code === 'ANIMAL_CODE_TAKEN')
      ) {
        setAskCode(true);
      }
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={texts.title}
      description={texts.description}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LifecycleError error={mutation.error} />
        {askCode ? (
          <TextField
            label="Código nuevo"
            autoComplete="off"
            hint={
              suggestion.data === undefined
                ? 'Otro animal activo ya tiene su número.'
                : `Otro animal activo ya tiene su número. Sugerido: ${suggestion.data.code}.`
            }
            value={newCode}
            onChange={(event) => {
              setNewCode(event.target.value);
            }}
            error={codeError}
          />
        ) : null}
        {askCode && suggestion.data !== undefined && newCode === '' ? (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => {
              setNewCode(suggestion.data.code);
            }}
          >
            Usar el {suggestion.data.code}
          </Button>
        ) : null}
        <Button type="submit" block disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : texts.submit}
        </Button>
      </form>
    </Dialog>
  );
}

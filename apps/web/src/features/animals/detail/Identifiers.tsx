import { zodResolver } from '@hookform/resolvers/zod';
import {
  IDENTIFIER_RETIRE_REASON,
  IDENTIFIER_TYPE,
  addIdentifierSchema,
  formatDate,
  replaceIdentifierSchema,
  retireIdentifierSchema,
  type AnimalDetail,
  type IdentifierView,
  type IsoDate,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import { DateQuickPick } from '../../../components/ui/DateQuickPick';
import { Dialog } from '../../../components/ui/Dialog';
import { SelectField } from '../../../components/ui/SelectField';
import { Tag } from '../../../components/ui/Tag';
import { TextField } from '../../../components/ui/TextField';
import { isApiError } from '../../../lib/api/errors';
import { useToday } from '../../../lib/clock';
import { RFID_FIELD_ATTRIBUTE } from '../../../lib/rfid/useRfidReader';
import { useIdentifierMutations } from '../api';
import { IDENTIFIER_TYPE_LABEL, identifierText, RETIRE_REASON_LABEL } from '../labels';

type DialogState =
  | { readonly kind: 'add' }
  | { readonly kind: 'replace'; readonly identifier: IdentifierView }
  | { readonly kind: 'retire'; readonly identifier: IdentifierView };

/**
 * Identificadores de la ficha (IDN-01, IDN-02): los activos con sus acciones y los retirados,
 * que siguen visibles («identificador anterior»). Un animal con salida no admite cambios
 * (RN-09): se ven, pero sin acciones.
 */
export function IdentifiersSection({
  animal,
  isAdmin,
  onSaved,
}: {
  animal: AnimalDetail;
  isAdmin: boolean;
  onSaved: (message: string) => void;
}) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const editable = animal.status === 'ACTIVE';
  const active = animal.identifiers.filter((identifier) => identifier.retiredAt === null);
  const retired = animal.identifiers.filter((identifier) => identifier.retiredAt !== null);
  const close = () => {
    setDialog(null);
  };
  const done = (message: string) => {
    setDialog(null);
    onSaved(message);
  };

  return (
    <section aria-labelledby="identificadores" className="flex flex-col gap-3">
      <h2 id="identificadores" className="text-md font-bold">
        Identificadores
      </h2>
      {active.length === 0 ? (
        <p className="text-texto-2">No tiene identificadores activos.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-cerca rounded-panel border border-cerca">
          {active.map((identifier) => (
            <li
              key={identifier.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div>
                <p className="font-bold">{identifierText(identifier.type, identifier.value)}</p>
                <p className="text-aux text-texto-2">
                  Desde el {formatDate(identifier.assignedAt)}
                </p>
              </div>
              {editable ? (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    aria-label={`Reemplazar ${identifierText(identifier.type, identifier.value)}`}
                    onClick={() => {
                      setDialog({ kind: 'replace', identifier });
                    }}
                  >
                    Reemplazar
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Retirar ${identifierText(identifier.type, identifier.value)}`}
                    onClick={() => {
                      setDialog({ kind: 'retire', identifier });
                    }}
                  >
                    Retirar
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {retired.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <h3 className="font-bold text-texto-2">Identificadores anteriores</h3>
          <ul className="flex flex-col gap-1">
            {retired.map((identifier) => (
              <li key={identifier.id} className="flex flex-wrap items-center gap-2 text-texto-2">
                <Tag tone="neutro">Anterior</Tag>
                {identifierText(identifier.type, identifier.value)} · retirado el{' '}
                {formatDate(identifier.retiredAt ?? identifier.assignedAt)}
                {identifier.retireReason === null
                  ? ''
                  : ` · ${RETIRE_REASON_LABEL[identifier.retireReason]}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editable ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setDialog({ kind: 'add' });
          }}
        >
          Agregar identificador
        </Button>
      ) : null}

      {dialog?.kind === 'add' ? (
        <AddIdentifierDialog animal={animal} isAdmin={isAdmin} onClose={close} onDone={done} />
      ) : null}
      {dialog?.kind === 'replace' ? (
        <ReplaceIdentifierDialog
          animal={animal}
          identifier={dialog.identifier}
          isAdmin={isAdmin}
          onClose={close}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'retire' ? (
        <RetireIdentifierDialog
          animal={animal}
          identifier={dialog.identifier}
          onClose={close}
          onDone={done}
        />
      ) : null}
    </section>
  );
}

/**
 * Error al guardar un identificador, con la salida que corresponde (06 §7):
 * - `IDENTIFIER_TAKEN`: dice qué animal lo tiene y enlaza a su ficha;
 * - `IDENTIFIER_PREVIOUSLY_USED`: al ADMIN le pide confirmar la reasignación (RN-19); a los
 *   demás, que se la pidan a un administrador.
 */
export function IdentifierSaveError({
  error,
  isAdmin,
  onConfirmReuse,
}: {
  error: unknown;
  isAdmin: boolean;
  onConfirmReuse: () => void;
}) {
  if (error === null || error === undefined) return null;
  const detail = isApiError(error) ? error.detail : 'Ocurrió un error inesperado.';
  const context = isApiError(error) ? error.context : undefined;
  const holder =
    context?.animalId === undefined ? null : (
      <Link
        to="/animals/$id"
        params={{ id: context.animalId }}
        className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
      >
        Abrir la ficha de {context.animalCode ?? 'ese animal'}
      </Link>
    );
  const reuse = isApiError(error) && error.code === 'IDENTIFIER_PREVIOUSLY_USED';

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-control border-2 border-alerta bg-alerta-claro p-3 text-alerta-intenso"
    >
      <p className="flex items-start gap-2 font-bold">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {detail}
      </p>
      {reuse && !isAdmin ? <p>Pídele a un administrador que lo reasigne.</p> : null}
      {reuse && isAdmin ? (
        <Button variant="secondary" onClick={onConfirmReuse}>
          Sí, reasignarlo a este animal
        </Button>
      ) : null}
      {holder}
    </div>
  );
}

function AddIdentifierDialog({
  animal,
  isAdmin,
  onClose,
  onDone,
}: {
  animal: AnimalDetail;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = useToday();
  const { add } = useIdentifierMutations(animal.id);
  const {
    register,
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(addIdentifierSchema),
    defaultValues: { type: IDENTIFIER_TYPE.RFID, value: '', assignedAt: today },
  });

  const save = async (confirmReuse: boolean) => {
    const values = addIdentifierSchema.parse(getValues());
    const saved = await add.mutateAsync({ ...values, ...(confirmReuse ? { confirmReuse } : {}) });
    onDone(`${identifierText(saved.type, saved.value)} agregado.`);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Agregar identificador"
      description={`A ${animal.name ?? animal.code}.`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async () => {
            await save(false).catch(() => undefined);
          })(event)
        }
      >
        <SelectField label="Tipo" error={errors.type?.message} {...register('type')}>
          {Object.values(IDENTIFIER_TYPE)
            .filter((type) => type !== IDENTIFIER_TYPE.QR)
            .map((type) => (
              <option key={type} value={type}>
                {IDENTIFIER_TYPE_LABEL[type]}
              </option>
            ))}
        </SelectField>
        <TextField
          label="Número"
          hint="Con el lector, acerca el chip: el número queda escrito aquí."
          autoComplete="off"
          error={errors.value?.message}
          {...{ [RFID_FIELD_ATTRIBUTE]: '' }}
          {...register('value')}
        />
        <Controller
          control={control}
          name="assignedAt"
          render={({ field }) => (
            <DateQuickPick
              label="Fecha de asignación"
              value={(field.value ?? today) as IsoDate}
              onChange={field.onChange}
              today={today}
              min={animal.birthDate}
            />
          )}
        />
        <IdentifierSaveError
          error={add.error}
          isAdmin={isAdmin}
          onConfirmReuse={() => {
            void save(true).catch(() => undefined);
          }}
        />
        <Button type="submit" block disabled={isSubmitting || add.isPending}>
          {add.isPending ? 'Guardando…' : 'Agregar identificador'}
        </Button>
      </form>
    </Dialog>
  );
}

const REASONS = Object.values(IDENTIFIER_RETIRE_REASON);

function ReplaceIdentifierDialog({
  animal,
  identifier,
  isAdmin,
  onClose,
  onDone,
}: {
  animal: AnimalDetail;
  identifier: IdentifierView;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = useToday();
  const { replace } = useIdentifierMutations(animal.id);
  const {
    register,
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(replaceIdentifierSchema),
    defaultValues: { reason: IDENTIFIER_RETIRE_REASON.LOST, newValue: '', date: today },
  });
  const current = identifierText(identifier.type, identifier.value);

  const save = async (confirmReuse: boolean) => {
    const values = replaceIdentifierSchema.parse(getValues());
    const result = await replace.mutateAsync({
      id: identifier.id,
      body: { ...values, ...(confirmReuse ? { confirmReuse } : {}) },
    });
    onDone(`${current} reemplazado por ${result.current.value}.`);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Reemplazar ${current}`}
      description="El anterior queda retirado, visible en el historial y se puede seguir buscando."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async () => {
            await save(false).catch(() => undefined);
          })(event)
        }
      >
        <SelectField label="Motivo" error={errors.reason?.message} {...register('reason')}>
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {RETIRE_REASON_LABEL[reason]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Número nuevo"
          autoComplete="off"
          error={errors.newValue?.message}
          {...{ [RFID_FIELD_ATTRIBUTE]: '' }}
          {...register('newValue')}
        />
        <Controller
          control={control}
          name="date"
          render={({ field }) => (
            <DateQuickPick
              label="Fecha del reemplazo"
              value={field.value as IsoDate}
              onChange={field.onChange}
              today={today}
              min={identifier.assignedAt}
            />
          )}
        />
        <IdentifierSaveError
          error={replace.error}
          isAdmin={isAdmin}
          onConfirmReuse={() => {
            void save(true).catch(() => undefined);
          }}
        />
        <Button type="submit" block disabled={isSubmitting || replace.isPending}>
          {replace.isPending ? 'Guardando…' : 'Guardar reemplazo'}
        </Button>
      </form>
    </Dialog>
  );
}

function RetireIdentifierDialog({
  animal,
  identifier,
  onClose,
  onDone,
}: {
  animal: AnimalDetail;
  identifier: IdentifierView;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = useToday();
  const { retire } = useIdentifierMutations(animal.id);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(retireIdentifierSchema),
    defaultValues: { reason: IDENTIFIER_RETIRE_REASON.LOST, date: today },
  });
  const current = identifierText(identifier.type, identifier.value);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Retirar ${current}`}
      description="Queda como identificador anterior: visible en la ficha y en la búsqueda."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (values) => {
            try {
              await retire.mutateAsync({ id: identifier.id, body: values });
              onDone(`${current} retirado.`);
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
        <SelectField label="Motivo" error={errors.reason?.message} {...register('reason')}>
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {RETIRE_REASON_LABEL[reason]}
            </option>
          ))}
        </SelectField>
        <Controller
          control={control}
          name="date"
          render={({ field }) => (
            <DateQuickPick
              label="Fecha del retiro"
              value={field.value as IsoDate}
              onChange={field.onChange}
              today={today}
              min={identifier.assignedAt}
            />
          )}
        />
        <IdentifierSaveError
          error={retire.error}
          isAdmin={false}
          onConfirmReuse={() => undefined}
        />
        <Button type="submit" block disabled={isSubmitting || retire.isPending}>
          {retire.isPending ? 'Guardando…' : 'Retirar identificador'}
        </Button>
      </form>
    </Dialog>
  );
}

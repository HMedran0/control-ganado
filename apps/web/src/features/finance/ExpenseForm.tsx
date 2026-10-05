import {
  EXPENSE_FORM_TYPES,
  EXPENSE_TYPE_LABEL,
  createExpenseSchema,
  formatCop,
  type AnimalRef,
  type CreateExpenseInput,
  type ExpenseAllocationInput,
  type ExpenseDetail,
  type ExpensePreview,
  type ExpenseType,
  type IsoDate,
} from '@hato/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { NumberField } from '../../components/ui/NumberField';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { useToday } from '../../lib/clock';
import { AnimalPicker } from '../animals/form/AnimalPicker';
import { SaveError, schemaResolver } from '../reproduction/form-kit';
import { useCatalog } from '../settings/api';
import { useCreateExpense, useUpdateExpense } from './api';

/** A quién se carga el gasto, como lo elige la persona. */
type Target = 'ANIMAL' | 'LOT' | 'SELECTION' | 'GENERAL';
type SplitMethod = 'EQUAL' | 'BY_WEIGHT';

type ExpenseValues = {
  type: ExpenseType | '';
  date: string;
  amount: string | null;
  description: string;
  target: Target;
  animal: AnimalRef | null;
  lotId: string;
  method: SplitMethod;
};

const SPLIT_OPTIONS = [
  { value: 'EQUAL', label: 'Partes iguales' },
  { value: 'BY_WEIGHT', label: 'Según el peso' },
] as const;

/** El reparto que se pide a la API, según lo que se eligió en el formulario. */
function allocationOf(values: ExpenseValues, selection: readonly string[]): ExpenseAllocationInput {
  switch (values.target) {
    case 'ANIMAL':
      return { method: 'DIRECT', animalId: values.animal?.id ?? '' };
    case 'LOT':
      return { method: values.method, lotId: values.lotId };
    case 'SELECTION':
      return { method: values.method, animalIds: [...selection] };
    case 'GENERAL':
      return { method: 'GENERAL' };
  }
}

/** «54 animales: $ 5.778 cada uno; el primero, $ 5.790 (el residuo, RN-17)». */
export function previewText(preview: ExpensePreview): string {
  const amounts = preview.allocations.map((allocation) => allocation.amount);
  if (amounts.length === 0) return 'Gasto general: no se carga a ningún animal.';
  if (amounts.length === 1) return `Todo a ${preview.allocations[0]?.animal.code ?? 'un animal'}.`;
  const [first, ...rest] = amounts;
  const sameRest = rest.every((amount) => amount === rest[0]);
  if (preview.method === 'EQUAL' && sameRest && first !== undefined && rest[0] !== undefined) {
    return first === rest[0]
      ? `${amounts.length} animales: ${formatCop(first)} cada uno.`
      : `${amounts.length} animales: ${formatCop(rest[0])} cada uno; ${preview.allocations[0]?.animal.code ?? 'el primero'} lleva ${formatCop(first)}, con el residuo para que la suma dé exacta.`;
  }
  return `${amounts.length} animales, según el peso de cada uno. La suma da exactamente ${formatCop(preview.amount)}.`;
}

/**
 * Registrar o corregir un gasto (ECO-01, ECO-02), solo ADMIN. Se carga a un animal, se reparte
 * entre un lote o los animales elegidos en el listado (partes iguales o según el peso) o queda
 * como gasto general de la finca. «Ver el reparto» muestra cuánto le toca a cada uno antes de
 * guardar.
 *
 * Al corregir, el reparto solo se manda si se cambió a quién se carga: corregir la descripción
 * no toca ninguna asignación (ADR-016). El gasto de un tratamiento o de una compra sigue siendo
 * de su animal.
 */
export function ExpenseForm({
  expense,
  initialAnimal,
  initialLotId,
  selection = [],
}: {
  /** El gasto que se corrige; sin él, uno nuevo. */
  expense?: ExpenseDetail;
  initialAnimal?: AnimalRef | null;
  initialLotId?: string;
  /** Animales elegidos en el listado (ECO-02 CA1: selección o «todo lo filtrado»). */
  selection?: readonly string[];
}) {
  const today = useToday();
  const navigate = useNavigate();
  const lots = useCatalog('lots');
  const { preview, create } = useCreateExpense();
  const update = useUpdateExpense(expense?.id ?? '');
  const [shown, setShown] = useState<ExpensePreview | null>(null);
  const editing = expense !== undefined;
  const locked = editing && (expense.type === 'PURCHASE' || expense.treatmentId !== null);

  const initialTarget: Target = editing
    ? expense.method === 'GENERAL'
      ? 'GENERAL'
      : expense.method === 'DIRECT'
        ? 'ANIMAL'
        : expense.lot === null
          ? 'SELECTION'
          : 'LOT'
    : selection.length > 0
      ? 'SELECTION'
      : initialLotId === undefined
        ? 'ANIMAL'
        : 'LOT';
  const editingSelection = editing
    ? expense.allocations.map((allocation) => allocation.animal.id)
    : selection;

  const {
    register,
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ExpenseValues, unknown, CreateExpenseInput>({
    resolver: schemaResolver(
      createExpenseSchema,
      (values) => ({
        type: values.type === '' ? undefined : values.type,
        date: values.date,
        amount: values.amount ?? '',
        description: values.description,
        allocation: allocationOf(values, editingSelection),
      }),
      (path) =>
        path.startsWith('allocation.animalId')
          ? 'animal'
          : path.startsWith('allocation.lotId')
            ? 'lotId'
            : path.startsWith('allocation')
              ? 'target'
              : path,
    ),
    defaultValues: {
      type: expense?.type ?? '',
      date: expense?.date ?? today,
      amount: expense === undefined ? null : String(Number(expense.amount)),
      description: expense?.description ?? '',
      target: initialTarget,
      animal: expense?.animal ?? initialAnimal ?? null,
      lotId: expense?.lot?.id ?? initialLotId ?? '',
      method: expense?.method === 'BY_WEIGHT' ? 'BY_WEIGHT' : 'EQUAL',
    },
  });
  const target = useWatch({ control, name: 'target' });

  const targetOptions = [
    { value: 'ANIMAL' as const, label: 'Un animal' },
    { value: 'LOT' as const, label: 'Un lote' },
    ...(editingSelection.length > 0 && initialTarget === 'SELECTION'
      ? [{ value: 'SELECTION' as const, label: `Los ${editingSelection.length} elegidos` }]
      : []),
    { value: 'GENERAL' as const, label: 'Gasto general' },
  ];

  const pending = create.isPending || update.isPending;
  const error = editing ? update.error : (create.error ?? preview.error);
  const types =
    editing && expense.type === 'PURCHASE' ? (['PURCHASE'] as const) : EXPENSE_FORM_TYPES;

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            if (!editing) {
              const saved = await create.mutateAsync(body);
              await navigate({
                to: '/finance/expenses/$id',
                params: { id: saved.id },
                state: { financeSaved: 'Gasto registrado.' },
              });
              return;
            }
            const allocationChanged =
              dirtyFields.target === true ||
              dirtyFields.animal !== undefined ||
              dirtyFields.lotId === true ||
              dirtyFields.method === true;
            await update.mutateAsync({
              version: expense.version,
              type: body.type,
              date: body.date,
              amount: body.amount,
              description: body.description,
              ...(allocationChanged && !locked ? { allocation: body.allocation } : {}),
            });
            await navigate({
              to: '/finance/expenses/$id',
              params: { id: expense.id },
              state: { financeSaved: 'Gasto corregido.' },
            });
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      <SelectField label="Tipo de gasto" error={errors.type?.message} {...register('type')}>
        <option value="">Elige el tipo</option>
        {types.map((type) => (
          <option key={type} value={type}>
            {EXPENSE_TYPE_LABEL[type]}
          </option>
        ))}
      </SelectField>
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha del gasto"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
          />
        )}
      />
      {errors.date?.message === undefined ? null : (
        <p className="text-alerta-intenso">{errors.date.message}</p>
      )}
      <Controller
        control={control}
        name="amount"
        render={({ field }) => (
          <NumberField
            label="Monto"
            currency
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              setShown(null);
            }}
            error={errors.amount?.message}
          />
        )}
      />
      <TextField
        label="Descripción"
        hint="Por ejemplo: bulto de sal mineralizada para el lote."
        error={errors.description?.message}
        {...register('description')}
      />

      {locked ? (
        <p className="rounded-control bg-neutro-claro p-3">
          {expense.type === 'PURCHASE'
            ? `Es la compra de ${expense.animal?.code ?? 'un animal'}: sigue siendo de ese animal.`
            : `Es el costo de un tratamiento de ${expense.animal?.code ?? 'un animal'}: sigue siendo de ese animal.`}
        </p>
      ) : (
        <>
          <Controller
            control={control}
            name="target"
            render={({ field }) => (
              <SegmentedChoice
                label="¿A quién se carga?"
                options={targetOptions}
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  setShown(null);
                }}
                error={errors.target?.message}
              />
            )}
          />
          {target === 'ANIMAL' ? (
            <Controller
              control={control}
              name="animal"
              render={({ field }) => (
                <AnimalPicker
                  label="Animal"
                  hint="Escribe el código, el nombre o lee el chip."
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.animal?.message}
                />
              )}
            />
          ) : null}
          {target === 'LOT' ? (
            <SelectField
              label="Lote"
              hint="Se reparte entre los animales activos del lote hoy."
              error={errors.lotId?.message}
              {...register('lotId', { onChange: () => setShown(null) })}
            >
              <option value="">Elige el lote</option>
              {(lots.data?.items ?? []).map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {target === 'LOT' || target === 'SELECTION' ? (
            <Controller
              control={control}
              name="method"
              render={({ field }) => (
                <SegmentedChoice
                  label="¿Cómo se reparte?"
                  hint="Según el peso usa el último pesaje de cada animal hasta la fecha del gasto."
                  options={SPLIT_OPTIONS}
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    setShown(null);
                  }}
                />
              )}
            />
          ) : null}
          {target === 'LOT' || target === 'SELECTION' ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="self-start"
                disabled={preview.isPending}
                onClick={() => {
                  const values = getValues();
                  const body = createExpenseSchema.safeParse({
                    type: values.type === '' ? 'OTHER' : values.type,
                    date: values.date,
                    amount: values.amount ?? '',
                    description: values.description.length >= 3 ? values.description : 'Gasto',
                    allocation: allocationOf(values, editingSelection),
                  });
                  if (!body.success) {
                    void handleSubmit(() => undefined)();
                    return;
                  }
                  void preview.mutateAsync(body.data).then(setShown, () => undefined);
                }}
              >
                {preview.isPending ? 'Calculando…' : 'Ver el reparto'}
              </Button>
              {shown === null ? null : (
                <p role="status" className="rounded-control bg-potrero-claro p-3">
                  {previewText(shown)}
                </p>
              )}
            </div>
          ) : null}
        </>
      )}

      <SaveError error={error} damId={expense?.animal?.id ?? ''} />
      <Button type="submit" block disabled={isSubmitting || pending}>
        {pending ? 'Guardando…' : editing ? 'Guardar corrección' : 'Registrar gasto'}
      </Button>
    </form>
  );
}

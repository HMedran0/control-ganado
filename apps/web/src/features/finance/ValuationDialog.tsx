import {
  createValuationSchema,
  type CreateValuationInput,
  type IsoDate,
  type ValuationMethod,
} from '@hato/shared';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { Dialog } from '../../components/ui/Dialog';
import { NumberField } from '../../components/ui/NumberField';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { useToday } from '../../lib/clock';
import { SaveError, schemaResolver } from '../reproduction/form-kit';
import { useCreateValuation } from './api';

type ValuationValues = { date: string; method: ValuationMethod; amount: string | null };

const METHOD_OPTIONS = [
  { value: 'MANUAL', label: 'A mano' },
  { value: 'PRICE_PER_KG', label: 'Peso × precio por kilo' },
] as const;

/**
 * Registrar un avalúo (ECO-03), solo ADMIN: el valor a mano, o el último peso hasta la fecha por el
 * precio por kilo de su categoría (Configuración → Finca). Un avalúo no se corrige: se anula y se
 * registra otro.
 */
export function ValuationDialog({
  animal,
  onClose,
}: {
  animal: { id: string; code: string; birthDate: IsoDate };
  onClose: () => void;
}) {
  const today = useToday();
  const create = useCreateValuation();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ValuationValues, unknown, CreateValuationInput>({
    resolver: schemaResolver(createValuationSchema, (values) => ({
      animalId: animal.id,
      date: values.date,
      method: values.method,
      ...(values.method === 'MANUAL' ? { amount: values.amount ?? '' } : {}),
    })),
    defaultValues: { date: today, method: 'MANUAL', amount: null },
  });
  const method = useWatch({ control, name: 'method' });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Registrar avalúo de ${animal.code}`}
      description="Cuánto vale hoy el animal. Sirve para estimar el resultado mientras no se venda."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (body) => {
            try {
              await create.mutateAsync(body);
              onClose();
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
        <Controller
          control={control}
          name="date"
          render={({ field }) => (
            <DateQuickPick
              label="Fecha del avalúo"
              value={field.value as IsoDate}
              onChange={field.onChange}
              today={today}
              min={animal.birthDate}
            />
          )}
        />
        <Controller
          control={control}
          name="method"
          render={({ field }) => (
            <SegmentedChoice
              label="¿Cómo se calcula?"
              options={METHOD_OPTIONS}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {method === 'MANUAL' ? (
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <NumberField
                label="Valor"
                currency
                value={field.value}
                onChange={field.onChange}
                error={errors.amount?.message}
              />
            )}
          />
        ) : (
          <p className="rounded-control bg-neutro-claro p-3">
            Se calcula con el último pesaje hasta esa fecha y el precio por kilo de su categoría.
          </p>
        )}
        <SaveError error={create.error} damId={animal.id} />
        <Button type="submit" block disabled={isSubmitting || create.isPending}>
          {create.isPending ? 'Guardando…' : 'Registrar avalúo'}
        </Button>
      </form>
    </Dialog>
  );
}

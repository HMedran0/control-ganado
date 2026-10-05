import {
  createTreatmentSchema,
  formatDate,
  isIsoDate,
  treatmentWithdrawal,
  type AnimalDetail,
  type CreateTreatmentInput,
  type IsoDate,
} from '@hato/shared';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { NumberField } from '../../components/ui/NumberField';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { useRequiredSession } from '../../lib/auth/context';
import { useToday } from '../../lib/clock';
import { SaveError, optional, schemaResolver } from '../reproduction/form-kit';
import { useCreateTreatment } from './api';
import { useBackToAnimal } from './event-page';

type TreatmentValues = {
  startedOn: string;
  reason: string;
  medication: string;
  dose: string;
  durationDays: string | null;
  withdrawalMeatDays: string | null;
  withdrawalMilkDays: string | null;
  responsible: string;
  cost: string | null;
  notes: string;
};

const days = (text: string | null, fallback: number): number =>
  text === null || text === '' ? fallback : Number(text);

/**
 * Registrar tratamiento (SAN-05): diagnóstico, medicamento, dosis, días de tratamiento y días de
 * retiro de carne y de leche. Muestra hasta cuándo queda en retiro antes de guardar. El costo, que
 * crea un gasto del animal, solo lo ve y lo escribe el ADMIN (RN-20).
 */
export function TreatmentForm({ animal }: { animal: AnimalDetail }) {
  const today = useToday();
  const session = useRequiredSession();
  const isAdmin = session.role === 'ADMIN';
  const back = useBackToAnimal();
  const create = useCreateTreatment();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TreatmentValues, unknown, CreateTreatmentInput>({
    resolver: schemaResolver(createTreatmentSchema, (values) => ({
      animalId: animal.id,
      startedOn: values.startedOn,
      reason: values.reason,
      medication: values.medication,
      dose: optional(values.dose),
      durationDays: days(values.durationDays, 1),
      withdrawalMeatDays: days(values.withdrawalMeatDays, 0),
      withdrawalMilkDays: days(values.withdrawalMilkDays, 0),
      responsible: optional(values.responsible),
      notes: optional(values.notes),
      ...(isAdmin && values.cost !== null && values.cost !== '' ? { cost: values.cost } : {}),
    })),
    defaultValues: {
      startedOn: today,
      reason: '',
      medication: '',
      dose: '',
      durationDays: '1',
      withdrawalMeatDays: null,
      withdrawalMilkDays: null,
      responsible: '',
      cost: null,
      notes: '',
    },
  });

  const [startedOn, duration, meat, milk] = useWatch({
    control,
    name: ['startedOn', 'durationDays', 'withdrawalMeatDays', 'withdrawalMilkDays'],
  });
  const withdrawal = isIsoDate(startedOn)
    ? treatmentWithdrawal({
        startedOn,
        durationDays: days(duration, 1),
        withdrawalMeatDays: days(meat, 0),
        withdrawalMilkDays: days(milk, 0),
      })
    : null;

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            const saved = await create.mutateAsync(body);
            await back(animal.id, 'sanidad', `Tratamiento registrado: ${saved.medication}.`);
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      <Controller
        control={control}
        name="startedOn"
        render={({ field }) => (
          <DateQuickPick
            label="Inicio del tratamiento"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
            min={animal.birthDate}
          />
        )}
      />
      {errors.startedOn?.message === undefined ? null : (
        <p className="text-alerta-intenso">{errors.startedOn.message}</p>
      )}
      <TextField
        label="Diagnóstico o motivo"
        error={errors.reason?.message}
        {...register('reason')}
      />
      <TextField
        label="Medicamento"
        error={errors.medication?.message}
        {...register('medication')}
      />
      <TextField label="Dosis" hint="Opcional, por ejemplo 10 ml." {...register('dose')} />
      <Controller
        control={control}
        name="durationDays"
        render={({ field }) => (
          <NumberField
            label="Días de tratamiento"
            unit="días"
            maxDecimals={0}
            value={field.value}
            onChange={field.onChange}
            error={errors.durationDays?.message}
          />
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={control}
          name="withdrawalMeatDays"
          render={({ field }) => (
            <NumberField
              label="Retiro de carne"
              hint="Días después del tratamiento."
              unit="días"
              maxDecimals={0}
              value={field.value}
              onChange={field.onChange}
              error={errors.withdrawalMeatDays?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="withdrawalMilkDays"
          render={({ field }) => (
            <NumberField
              label="Retiro de leche"
              hint="Días después del tratamiento."
              unit="días"
              maxDecimals={0}
              value={field.value}
              onChange={field.onChange}
              error={errors.withdrawalMilkDays?.message}
            />
          )}
        />
      </div>
      {withdrawal === null || withdrawal.until === null ? null : (
        <p className="rounded-control bg-aviso-claro p-3 text-aviso-intenso">
          Queda en retiro:{' '}
          {[
            withdrawal.meatUntil === null
              ? null
              : `carne hasta el ${formatDate(withdrawal.meatUntil)}`,
            withdrawal.milkUntil === null
              ? null
              : `leche hasta el ${formatDate(withdrawal.milkUntil)}`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
          .
        </p>
      )}
      <TextField label="Responsable" hint="Quién trató. Opcional." {...register('responsible')} />
      {isAdmin ? (
        <Controller
          control={control}
          name="cost"
          render={({ field }) => (
            <NumberField
              label="Costo del tratamiento"
              hint="Opcional. Queda como gasto del animal."
              currency
              value={field.value}
              onChange={field.onChange}
              error={errors.cost?.message}
            />
          )}
        />
      ) : null}
      <TextAreaField label="Observaciones" hint="Opcional." {...register('notes')} />
      <SaveError error={create.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || create.isPending}>
        {create.isPending ? 'Guardando…' : 'Registrar tratamiento'}
      </Button>
    </form>
  );
}

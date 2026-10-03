import {
  addMonths,
  createPregnancySchema,
  diagnosisSchema,
  formatDate,
  type AnimalDetail,
  type CreatePregnancyInput,
  type DiagnosisInput,
  type IsoDate,
  type PregnancyView,
} from '@hato/shared';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { NumberField } from '../../components/ui/NumberField';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { useToday } from '../../lib/clock';
import { useCreatePregnancy, usePregnancyActions } from './api';
import { SaveError, optional, schemaResolver, useBackToDam } from './form-kit';
import { DIAGNOSIS_RESULT_LABEL, SERVICE_METHOD_LABEL } from './labels';

/**
 * Registrar palpación (REP-02). Con preñez abierta: positiva (Preñada) o negativa (se cierra
 * vacía). Sin preñez abierta: preñez confirmada sin servicio conocido, con los meses de gestación
 * que indica quien palpa; la fecha de servicio queda estimada (CA3).
 */
export function DiagnosisForm({ animal }: { animal: AnimalDetail }) {
  const open = animal.reproduction?.openPregnancy ?? null;
  return open === null ? (
    <ConfirmedWithoutService animal={animal} />
  ) : (
    <DiagnoseOpen animal={animal} pregnancy={open} />
  );
}

type DiagnosisValues = {
  date: string;
  result: 'POSITIVE' | 'NEGATIVE' | null;
  responsible: string;
  notes: string;
};

function DiagnoseOpen({ animal, pregnancy }: { animal: AnimalDetail; pregnancy: PregnancyView }) {
  const today = useToday();
  const back = useBackToDam();
  const { diagnose } = usePregnancyActions(animal.id);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DiagnosisValues, unknown, DiagnosisInput>({
    resolver: schemaResolver(diagnosisSchema, (values) => ({
      date: values.date,
      result: values.result ?? undefined,
      responsible: optional(values.responsible),
      notes: optional(values.notes),
    })),
    defaultValues: { date: today, result: null, responsible: '', notes: '' },
  });

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            await diagnose.mutateAsync({ id: pregnancy.id, body });
            await back(
              animal.id,
              body.result === 'POSITIVE'
                ? 'Palpación guardada: preñada.'
                : 'Palpación guardada: vacía.',
            );
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      <p className="rounded-control bg-superficie-2 p-3">
        Servicio del {formatDate(pregnancy.serviceDate)} · {SERVICE_METHOD_LABEL[pregnancy.method]}
        {pregnancy.confirmedAt === null
          ? ''
          : ` · confirmada el ${formatDate(pregnancy.confirmedAt)}`}
      </p>
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha de la palpación"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
            min={pregnancy.serviceDate}
          />
        )}
      />
      {errors.date?.message === undefined ? null : (
        <p className="text-alerta-intenso">{errors.date.message}</p>
      )}
      <Controller
        control={control}
        name="result"
        render={({ field }) => (
          <SegmentedChoice
            label="Resultado"
            options={[
              { value: 'POSITIVE', label: DIAGNOSIS_RESULT_LABEL.POSITIVE },
              { value: 'NEGATIVE', label: DIAGNOSIS_RESULT_LABEL.NEGATIVE },
            ]}
            value={field.value}
            onChange={field.onChange}
            error={errors.result?.message}
          />
        )}
      />
      <TextField
        label="Quién palpó"
        hint="Opcional, por ejemplo el veterinario."
        error={errors.responsible?.message}
        {...register('responsible')}
      />
      <TextAreaField
        label="Observaciones de la palpación"
        hint="Opcional, por ejemplo el tamaño del feto o el estado del útero."
        error={errors.notes?.message}
        {...register('notes')}
      />
      <SaveError error={diagnose.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || diagnose.isPending}>
        {diagnose.isPending ? 'Guardando…' : 'Guardar palpación'}
      </Button>
    </form>
  );
}

type WithoutServiceValues = {
  diagnosisDate: string;
  gestationMonths: string | null;
  diagnosisResponsible: string;
  diagnosisNotes: string;
};

function ConfirmedWithoutService({ animal }: { animal: AnimalDetail }) {
  const today = useToday();
  const back = useBackToDam();
  const create = useCreatePregnancy();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WithoutServiceValues, unknown, CreatePregnancyInput>({
    resolver: schemaResolver(createPregnancySchema, (values) => ({
      damId: animal.id,
      diagnosisDate: values.diagnosisDate,
      gestationMonths:
        values.gestationMonths === null || values.gestationMonths === ''
          ? undefined
          : Number(values.gestationMonths),
      diagnosisResponsible: optional(values.diagnosisResponsible),
      diagnosisNotes: optional(values.diagnosisNotes),
    })),
    defaultValues: {
      diagnosisDate: today,
      gestationMonths: null,
      diagnosisResponsible: '',
      diagnosisNotes: '',
    },
  });

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            const saved = await create.mutateAsync(body);
            await back(
              animal.id,
              `Preñez confirmada. Servicio estimado el ${formatDate(saved.serviceDate)}.`,
              saved.warnings,
            );
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      <p className="rounded-control bg-superficie-2 p-3">
        {animal.code} no tiene un servicio registrado. Si la palpación sale positiva, indica los
        meses de gestación: el sistema calcula la fecha de servicio aproximada y el parto estimado.
      </p>
      <Controller
        control={control}
        name="diagnosisDate"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha de la palpación"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
            min={addMonths(animal.birthDate, 1)}
          />
        )}
      />
      <Controller
        control={control}
        name="gestationMonths"
        render={({ field }) => (
          <NumberField
            label="Meses de gestación"
            hint="Entre 1 y 9 meses, según la palpación."
            unit="meses"
            maxDecimals={0}
            value={field.value}
            onChange={field.onChange}
            error={errors.gestationMonths?.message}
          />
        )}
      />
      <TextField
        label="Quién palpó"
        hint="Opcional, por ejemplo el veterinario."
        error={errors.diagnosisResponsible?.message}
        {...register('diagnosisResponsible')}
      />
      <TextAreaField
        label="Observaciones de la palpación"
        hint="Opcional, por ejemplo el tamaño del feto o el estado del útero."
        error={errors.diagnosisNotes?.message}
        {...register('diagnosisNotes')}
      />
      <SaveError error={create.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || create.isPending}>
        {create.isPending ? 'Guardando…' : 'Guardar preñez confirmada'}
      </Button>
    </form>
  );
}

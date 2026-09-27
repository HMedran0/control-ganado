import { zodResolver } from '@hookform/resolvers/zod';
import {
  createVaccineSchema,
  type Sex,
  type VaccineScheduleType,
  type VaccineView,
} from '@hato/shared';
import { useState } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import type { z } from 'zod';

import { Checkbox } from '../../../components/ui/Checkbox';
import { NumberField } from '../../../components/ui/NumberField';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { TextField } from '../../../components/ui/TextField';
import { useCatalogMutations, type Saved } from '../api';
import { FormActions } from '../FormActions';
import { isVersionConflict, saveErrorMessage } from '../form-errors';

export const SCHEDULE_OPTIONS = [
  { value: 'OFFICIAL_CYCLE', label: 'Ciclo oficial' },
  { value: 'AGE_WINDOW', label: 'Por edad' },
  { value: 'INTERVAL', label: 'Por intervalo' },
  { value: 'NONE', label: 'Sin alerta' },
] as const;

/** Qué significa cada tipo de programación, en palabras de la finca (08 §1.5). */
const SCHEDULE_HELP: Record<VaccineScheduleType, string> = {
  OFFICIAL_CYCLE: 'Se aplica en cada ciclo oficial del ICA, como aftosa o rabia silvestre.',
  AGE_WINDOW: 'Se aplica una vez a cierta edad, como brucelosis en terneras de 3 a 9 meses.',
  INTERVAL: 'Se repite cada cierto número de días, como una clostridial anual.',
  NONE: 'Aplicaciones esporádicas: no genera alertas.',
};

type SexChoice = Sex | 'ANY';
const SEX_OPTIONS = [
  { value: 'ANY', label: 'Ambos' },
  { value: 'FEMALE', label: 'Hembras' },
  { value: 'MALE', label: 'Machos' },
] as const;

type Values = z.input<typeof createVaccineSchema>;

/** Formulario de vacuna (SAN-01). ADMIN y VET lo usan. */
export function VaccineForm({
  vaccine,
  onSaved,
  onReload,
}: {
  vaccine?: VaccineView;
  onSaved: (saved: Saved<VaccineView>) => void;
  onReload?: () => void;
}) {
  const { create, update } = useCatalogMutations('vaccines');
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createVaccineSchema),
    defaultValues: {
      name: vaccine?.name ?? '',
      disease: vaccine?.disease ?? '',
      defaultDose: vaccine?.defaultDose ?? '',
      route: vaccine?.route ?? '',
      scheduleType: vaccine?.scheduleType,
      boosterIntervalDays: vaccine?.boosterIntervalDays ?? null,
      eligibleSex: vaccine?.eligibleSex ?? null,
      minAgeDays: vaccine?.minAgeDays ?? null,
      maxAgeDays: vaccine?.maxAgeDays ?? null,
      blockIneligibleSex: vaccine?.blockIneligibleSex ?? false,
    },
  });
  const scheduleType = useWatch({ control, name: 'scheduleType' });
  const eligibleSex = useWatch({ control, name: 'eligibleSex' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    try {
      const saved =
        vaccine === undefined
          ? await create.mutateAsync(values)
          : await update.mutateAsync({
              id: vaccine.id,
              body: { ...values, version: vaccine.version },
            });
      onSaved(saved);
    } catch (error) {
      setConflict(isVersionConflict(error));
      setFormError(
        saveErrorMessage(error, {
          fields: [
            'name',
            'disease',
            'defaultDose',
            'route',
            'scheduleType',
            'boosterIntervalDays',
            'eligibleSex',
            'minAgeDays',
            'maxAgeDays',
          ],
          nameField: 'name',
          setError,
        }),
      );
    }
  });

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="flex max-w-xl flex-col gap-5"
    >
      <TextField label="Nombre comercial" error={errors.name?.message} {...register('name')} />
      <TextField
        label="Enfermedad o propósito"
        error={errors.disease?.message}
        {...register('disease')}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Dosis por defecto"
          hint="Opcional. Por ejemplo, 2 ml."
          error={errors.defaultDose?.message}
          {...register('defaultDose')}
        />
        <TextField
          label="Vía de aplicación"
          hint="Opcional. Por ejemplo, subcutánea."
          error={errors.route?.message}
          {...register('route')}
        />
      </div>

      <Controller
        control={control}
        name="scheduleType"
        render={({ field }) => (
          <div className="flex flex-col gap-1">
            <SegmentedChoice<VaccineScheduleType>
              label="Programación"
              options={SCHEDULE_OPTIONS}
              value={field.value ?? null}
              onChange={(next) => {
                field.onChange(next);
                // El intervalo solo existe en las vacunas por intervalo.
                if (next !== 'INTERVAL') setValue('boosterIntervalDays', null);
              }}
              error={errors.scheduleType === undefined ? undefined : 'Elige cómo se programa.'}
            />
            {field.value === undefined ? null : (
              <p className="text-aux text-texto-2">{SCHEDULE_HELP[field.value]}</p>
            )}
          </div>
        )}
      />

      {scheduleType === 'INTERVAL' ? (
        <DaysField
          control={control}
          name="boosterIntervalDays"
          label="Repetir cada (días)"
          error={errors.boosterIntervalDays?.message}
        />
      ) : null}

      <fieldset className="flex flex-col gap-4 rounded-panel border border-cerca p-4">
        <legend className="px-1 font-bold">Elegibilidad</legend>
        <Controller
          control={control}
          name="eligibleSex"
          render={({ field }) => (
            <SegmentedChoice<SexChoice>
              label="Se aplica a"
              options={SEX_OPTIONS}
              value={field.value ?? 'ANY'}
              onChange={(next) => {
                field.onChange(next === 'ANY' ? null : next);
                if (next === 'ANY') setValue('blockIneligibleSex', false);
              }}
              error={errors.eligibleSex?.message}
            />
          )}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <DaysField
            control={control}
            name="minAgeDays"
            label="Edad mínima (días)"
            error={errors.minAgeDays?.message}
            hint={scheduleType === 'AGE_WINDOW' ? 'La mínima, la máxima o ambas.' : 'Opcional.'}
          />
          <DaysField
            control={control}
            name="maxAgeDays"
            label="Edad máxima (días)"
            error={errors.maxAgeDays?.message}
            hint="Opcional. 270 días son unos 9 meses."
          />
        </div>
        <Controller
          control={control}
          name="blockIneligibleSex"
          render={({ field }) => (
            <Checkbox
              label="No permitir registrarla en el otro sexo"
              description="Como la brucelosis, prohibida en machos."
              checked={field.value === true}
              disabled={eligibleSex === null || eligibleSex === undefined}
              onChange={(event) => {
                field.onChange(event.target.checked);
              }}
            />
          )}
        />
      </fieldset>

      <FormActions
        submitLabel="Guardar vacuna"
        submitting={isSubmitting}
        error={formError}
        conflict={conflict}
        onReload={() => onReload?.()}
      />
    </form>
  );
}

/** Número entero de días, con `null` como «sin valor». */
function DaysField({
  control,
  name,
  label,
  error,
  hint,
}: {
  control: Control<Values>;
  name: FieldPath<Values> & ('boosterIntervalDays' | 'minAgeDays' | 'maxAgeDays');
  label: string;
  error: string | undefined;
  hint?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <NumberField
          label={label}
          unit="días"
          value={field.value === null || field.value === undefined ? null : String(field.value)}
          onChange={(next) => {
            field.onChange(next === null ? null : Number(next));
          }}
          onBlur={field.onBlur}
          error={error}
          hint={hint}
        />
      )}
    />
  );
}

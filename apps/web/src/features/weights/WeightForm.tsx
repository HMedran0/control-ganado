import {
  createWeightSchema,
  formatDate,
  formatWeight,
  isWeightOutlier,
  type AnimalDetail,
  type CreateWeightInput,
  type IsoDate,
} from '@hato/shared';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { NumberField } from '../../components/ui/NumberField';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { recalledIdentification } from '../../lib/identification/identification';
import { useToday } from '../../lib/clock';
import { SaveError, optional, schemaResolver, weight } from '../reproduction/form-kit';
import { useBackToAnimal } from '../health/event-page';
import { useCreateWeight } from './api';
import { IDENTIFIED_BY_LABEL, WEIGHT_METHOD_LABEL } from './labels';

type WeightValues = {
  date: string;
  weightKg: string | null;
  method: CreateWeightInput['method'] | null;
  identifiedBy: CreateWeightInput['identifiedBy'] | null;
  notes: string;
};

/**
 * Registrar peso (PES-01): fecha, kilos con teclado numérico, cómo se pesó y cómo se identificó al
 * animal (lo propone según cómo se abrió su ficha: búsqueda, lector o QR; PIL-05). Si el peso se
 * aleja más del 30 % del último, lo avisa antes de guardar, sin bloquear (CA2).
 */
export function WeightForm({ animal }: { animal: AnimalDetail }) {
  const today = useToday();
  const back = useBackToAnimal();
  const create = useCreateWeight();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WeightValues, unknown, CreateWeightInput>({
    resolver: schemaResolver(createWeightSchema, (values) => ({
      animalId: animal.id,
      date: values.date,
      weightKg: weight(values.weightKg),
      method: values.method ?? undefined,
      identifiedBy: values.identifiedBy ?? undefined,
      notes: optional(values.notes),
    })),
    defaultValues: {
      date: today,
      weightKg: null,
      method: animal.lastWeight?.method ?? 'SCALE',
      identifiedBy: recalledIdentification(animal.id),
      notes: '',
    },
  });

  const typed = weight(useWatch({ control, name: 'weightKg' }));
  const last = animal.lastWeight;
  const outlier = typed !== undefined && last !== null && isWeightOutlier(last.weightKg, typed);

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
              'pesos',
              `Peso registrado: ${formatWeight(saved.weightKg)} el ${formatDate(saved.weighedOn)}.`,
              saved.warnings,
            );
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      {last === null ? null : (
        <p className="rounded-control bg-superficie-2 p-3">
          Último peso: {formatWeight(last.weightKg)} el {formatDate(last.weighedOn)}
        </p>
      )}
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha del pesaje"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
            min={animal.birthDate}
          />
        )}
      />
      {errors.date?.message === undefined ? null : (
        <p className="text-alerta-intenso">{errors.date.message}</p>
      )}
      <Controller
        control={control}
        name="weightKg"
        render={({ field }) => (
          <NumberField
            label="Peso"
            unit="kg"
            maxDecimals={2}
            value={field.value}
            onChange={field.onChange}
            error={errors.weightKg?.message}
          />
        )}
      />
      {outlier && last !== null ? (
        <p className="rounded-control bg-aviso-claro p-3 font-bold text-aviso-intenso">
          El peso se aleja más del 30 % del último ({formatWeight(last.weightKg)}). Verifícalo antes
          de guardar.
        </p>
      ) : null}
      <Controller
        control={control}
        name="method"
        render={({ field }) => (
          <SegmentedChoice
            label="Cómo se pesó"
            options={(['SCALE', 'TAPE', 'ESTIMATE'] as const).map((value) => ({
              value,
              label: WEIGHT_METHOD_LABEL[value],
            }))}
            value={field.value}
            onChange={field.onChange}
            error={errors.method?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="identifiedBy"
        render={({ field }) => (
          <SegmentedChoice
            label="Cómo se identificó al animal"
            options={(['SEARCH', 'RFID_READER', 'QR'] as const).map((value) => ({
              value,
              label: IDENTIFIED_BY_LABEL[value],
            }))}
            value={field.value}
            onChange={field.onChange}
            error={errors.identifiedBy?.message}
          />
        )}
      />
      <TextAreaField label="Observaciones" hint="Opcional." {...register('notes')} />
      <SaveError error={create.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || create.isPending}>
        {create.isPending ? 'Guardando…' : 'Guardar peso'}
      </Button>
    </form>
  );
}

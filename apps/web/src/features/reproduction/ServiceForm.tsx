import {
  createPregnancySchema,
  expectedCalvingDate,
  formatDate,
  isIsoDate,
  type AnimalDetail,
  type AnimalRef,
  type CreatePregnancyInput,
  type IsoDate,
} from '@hato/shared';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { useToday } from '../../lib/clock';
import { AnimalPicker } from '../animals/form/AnimalPicker';
import { useCatalog, useFarm } from '../settings/api';
import { useCreatePregnancy } from './api';
import { SaveError, optional, schemaResolver, useBackToDam } from './form-kit';
import { SERVICE_METHOD_LABEL } from './labels';

type ServiceFormValues = {
  serviceDate: string;
  method: 'NATURAL' | 'AI' | null;
  sire: AnimalRef | null;
  sireExternalRef: string;
  responsible: string;
  notes: string;
};

/**
 * Registrar servicio (REP-01): fecha, monta natural o inseminación, toro de la finca o
 * referencia externa (pajilla, toro prestado), responsable y observaciones. Muestra el parto
 * estimado con la gestación de la raza de la madre (RN-04). Una hembra joven se sirve con
 * advertencia (RN-15); una con preñez abierta se rechaza con el enlace para ir a cerrarla (CA3).
 */
export function ServiceForm({ animal }: { animal: AnimalDetail }) {
  const today = useToday();
  const back = useBackToDam();
  const create = useCreatePregnancy();
  const breeds = useCatalog('breeds', true);
  const farm = useFarm();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues, unknown, CreatePregnancyInput>({
    resolver: schemaResolver(
      createPregnancySchema,
      (values) => ({
        damId: animal.id,
        serviceDate: values.serviceDate,
        method: values.method ?? undefined,
        sireId: values.sire?.id ?? undefined,
        sireExternalRef: optional(values.sireExternalRef),
        responsible: optional(values.responsible),
        notes: optional(values.notes),
      }),
      { sireId: 'sire' },
    ),
    defaultValues: {
      serviceDate: today,
      method: null,
      sire: null,
      sireExternalRef: '',
      responsible: '',
      notes: '',
    },
  });

  const serviceDate = useWatch({ control, name: 'serviceDate' });
  const breedGestation =
    breeds.data?.items.find((breed) => breed.id === animal.breed.id)?.gestationDays ?? null;
  const expected =
    isIsoDate(serviceDate) && farm.data !== undefined
      ? expectedCalvingDate({
          serviceDate,
          breedGestationDays: breedGestation,
          farmGestationDays: farm.data.settings.gestationDays,
        })
      : null;
  const open = animal.reproduction?.openPregnancy ?? null;

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            const saved = await create.mutateAsync(body);
            await back(animal.id, 'Servicio registrado.', saved.warnings);
          } catch {
            // El error se muestra abajo, con la salida que ofrezca la API.
          }
        })(event)
      }
    >
      {open === null ? null : (
        <p className="rounded-control border-2 border-aviso bg-aviso-claro p-3 font-bold text-aviso-intenso">
          {animal.code} ya tiene una preñez abierta (servicio del {formatDate(open.serviceDate)}).
          Ciérrala con la palpación, el parto o el aborto antes de registrar otro servicio.
        </p>
      )}
      <Controller
        control={control}
        name="serviceDate"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha del servicio"
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
            label="Método"
            options={[
              { value: 'NATURAL', label: SERVICE_METHOD_LABEL.NATURAL },
              { value: 'AI', label: SERVICE_METHOD_LABEL.AI },
            ]}
            value={field.value}
            onChange={field.onChange}
            error={errors.method?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="sire"
        render={({ field }) => (
          <AnimalPicker
            label="Toro de la finca"
            hint="Opcional. Escribe el código o el nombre."
            sex="MALE"
            value={field.value}
            onChange={field.onChange}
            error={errors.sire?.message}
          />
        )}
      />
      <TextField
        label="Pajilla o toro de fuera"
        hint="Opcional, si no es un toro de la finca."
        error={errors.sireExternalRef?.message}
        {...register('sireExternalRef')}
      />
      <TextField
        label="Responsable"
        hint="Opcional: quién hizo la monta o la inseminación."
        error={errors.responsible?.message}
        {...register('responsible')}
      />
      <TextAreaField
        label="Observaciones"
        hint="Opcional."
        error={errors.notes?.message}
        {...register('notes')}
      />
      {expected === null ? null : (
        <p className="rounded-control bg-info-claro p-3 text-info-intenso" aria-live="polite">
          Parto estimado: <strong>{formatDate(expected)}</strong>
        </p>
      )}
      <SaveError error={create.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || create.isPending}>
        {create.isPending ? 'Guardando…' : 'Guardar servicio'}
      </Button>
    </form>
  );
}

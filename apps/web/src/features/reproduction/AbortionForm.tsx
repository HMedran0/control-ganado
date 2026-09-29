import {
  abortionSchema,
  formatDate,
  type AbortionInput,
  type AnimalDetail,
  type IsoDate,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { useToday } from '../../lib/clock';
import { usePregnancyActions } from './api';
import { SaveError, optional, schemaResolver, useBackToDam } from './form-kit';

type AbortionValues = { date: string; notes: string };

/**
 * Registrar aborto (REP-03): cierra la preñez abierta con desenlace aborto, sin crías ni parto.
 * Sin preñez abierta no hay nada que cerrar: se explica y se ofrece registrar el servicio.
 */
export function AbortionForm({ animal }: { animal: AnimalDetail }) {
  const today = useToday();
  const back = useBackToDam();
  const { abort } = usePregnancyActions(animal.id);
  const open = animal.reproduction?.openPregnancy ?? null;
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AbortionValues, unknown, AbortionInput>({
    resolver: schemaResolver(abortionSchema, (values) => ({
      date: values.date,
      notes: optional(values.notes),
    })),
    defaultValues: { date: today, notes: '' },
  });

  if (open === null) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <p>{animal.code} no tiene una preñez abierta: no hay nada que cerrar con un aborto.</p>
        <Link
          to="/animals/$id/service"
          params={{ id: animal.id }}
          className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
        >
          Registrar servicio
        </Link>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            await abort.mutateAsync({ id: open.id, body });
            await back(animal.id, 'Aborto registrado.');
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      <p className="rounded-control bg-superficie-2 p-3">
        Preñez con servicio del {formatDate(open.serviceDate)}
        {open.confirmedAt === null ? ', sin palpar' : ', confirmada'}.
      </p>
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha del aborto"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
            min={open.serviceDate}
          />
        )}
      />
      {errors.date?.message === undefined ? null : (
        <p className="text-alerta-intenso">{errors.date.message}</p>
      )}
      <TextAreaField
        label="Observaciones"
        hint="Opcional: cómo se encontró, posible causa."
        error={errors.notes?.message}
        {...register('notes')}
      />
      <SaveError error={abort.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || abort.isPending}>
        {abort.isPending ? 'Guardando…' : 'Registrar aborto'}
      </Button>
    </form>
  );
}

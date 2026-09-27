import { zodResolver } from '@hookform/resolvers/zod';
import { createCycleSchema, type CycleView } from '@hato/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Checkbox } from '../../../components/ui/Checkbox';
import { TextField } from '../../../components/ui/TextField';
import { useCatalog, useCatalogMutations, type Saved } from '../api';
import { FormActions } from '../FormActions';
import { isVersionConflict, saveErrorMessage } from '../form-errors';

/**
 * Formulario de ciclo de vacunación (SAN-06). Las fechas usan el selector nativo: los ciclos
 * se programan a futuro, así que los atajos Hoy y Ayer de DateQuickPick no sirven aquí.
 */
export function CycleForm({
  cycle,
  onSaved,
  onReload,
}: {
  cycle?: CycleView;
  onSaved: (saved: Saved<CycleView>) => void;
  onReload?: () => void;
}) {
  const { create, update } = useCatalogMutations('cycles');
  const vaccines = useCatalog('vaccines', true);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createCycleSchema),
    defaultValues: {
      name: cycle?.name ?? '',
      startsOn: cycle?.startsOn ?? '',
      endsOn: cycle?.endsOn ?? '',
      isOfficial: cycle?.isOfficial ?? true,
      vaccineIds: cycle?.vaccines.map((vaccine) => vaccine.id) ?? [],
    },
  });

  // Vacunas activas, más las desactivadas que el ciclo ya tenía (no se pierden al editar).
  const selectedIds = new Set(cycle?.vaccines.map((vaccine) => vaccine.id) ?? []);
  const options = (vaccines.data?.items ?? []).filter(
    (vaccine) => vaccine.isActive || selectedIds.has(vaccine.id),
  );

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    try {
      const saved =
        cycle === undefined
          ? await create.mutateAsync(values)
          : await update.mutateAsync({ id: cycle.id, body: { ...values, version: cycle.version } });
      onSaved(saved);
    } catch (error) {
      setConflict(isVersionConflict(error));
      setFormError(
        saveErrorMessage(error, {
          fields: ['name', 'startsOn', 'endsOn', 'vaccineIds'],
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
      <TextField
        label="Nombre"
        hint="Por ejemplo, 2026-2."
        error={errors.name?.message}
        {...register('name')}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Inicio"
          type="date"
          error={errors.startsOn?.message}
          {...register('startsOn')}
        />
        <TextField label="Fin" type="date" error={errors.endsOn?.message} {...register('endsOn')} />
      </div>
      <Controller
        control={control}
        name="isOfficial"
        render={({ field }) => (
          <Checkbox
            label="Ciclo oficial del ICA"
            description="Vacunación de aftosa, brucelosis o rabia ejecutada por Fedegán."
            checked={field.value === true}
            onChange={(event) => {
              field.onChange(event.target.checked);
            }}
          />
        )}
      />
      <Controller
        control={control}
        name="vaccineIds"
        render={({ field }) => (
          <fieldset
            aria-describedby={errors.vaccineIds === undefined ? undefined : 'vacunas-error'}
            className="flex flex-col gap-1 rounded-panel border border-cerca p-4"
          >
            <legend className="px-1 font-bold">Vacunas del ciclo</legend>
            {vaccines.isPending ? (
              <p role="status" className="text-texto-2">
                Cargando vacunas…
              </p>
            ) : options.length === 0 ? (
              <p className="text-texto-2">Todavía no hay vacunas. Crea primero la del ciclo.</p>
            ) : (
              options.map((vaccine) => (
                <Checkbox
                  key={vaccine.id}
                  label={vaccine.name}
                  description={
                    vaccine.isActive ? vaccine.disease : `${vaccine.disease} · desactivada`
                  }
                  checked={field.value.includes(vaccine.id)}
                  onChange={(event) => {
                    field.onChange(
                      event.target.checked
                        ? [...field.value, vaccine.id]
                        : field.value.filter((id) => id !== vaccine.id),
                    );
                  }}
                />
              ))
            )}
            {errors.vaccineIds === undefined ? null : (
              <p id="vacunas-error" className="text-aux font-bold text-alerta">
                {errors.vaccineIds.message}
              </p>
            )}
          </fieldset>
        )}
      />
      <FormActions
        submitLabel="Guardar ciclo"
        submitting={isSubmitting}
        error={formError}
        conflict={conflict}
        onReload={() => onReload?.()}
      />
    </form>
  );
}

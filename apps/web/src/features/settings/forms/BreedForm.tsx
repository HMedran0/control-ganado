import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBreedSchema,
  DEFAULT_FARM_GESTATION_DAYS,
  proposedGestationDays,
  type BreedGroup,
  type BreedView,
} from '@hato/shared';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { NumberField } from '../../../components/ui/NumberField';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { TextField } from '../../../components/ui/TextField';
import { useCatalogMutations, type Saved } from '../api';
import { FormActions } from '../FormActions';
import { isVersionConflict, saveErrorMessage } from '../form-errors';

export const BREED_GROUP_OPTIONS = [
  { value: 'INDICUS', label: 'Cebuino' },
  { value: 'TAURUS', label: 'Europeo' },
  { value: 'CROSS', label: 'Cruce' },
] as const;

/**
 * Formulario de raza (CFG-02). Al elegir el grupo se propone la gestación (08 §1.4: cebuinos
 * 293, europeos 283, cruces 288), mientras la persona no la haya cambiado a mano.
 */
export function BreedForm({
  breed,
  onSaved,
  onReload,
}: {
  breed?: BreedView;
  onSaved: (saved: Saved<BreedView>) => void;
  onReload?: () => void;
}) {
  const { create, update } = useCatalogMutations('breeds');
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm({
    resolver: zodResolver(createBreedSchema),
    defaultValues: {
      name: breed?.name ?? '',
      group: breed?.group,
      gestationDays: breed?.gestationDays ?? undefined,
    },
  });
  const group = useWatch({ control, name: 'group' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    try {
      const saved =
        breed === undefined
          ? await create.mutateAsync(values)
          : await update.mutateAsync({
              id: breed.id,
              body: {
                version: breed.version,
                name: values.name,
                group: values.group,
                gestationDays: values.gestationDays ?? null,
              },
            });
      onSaved(saved);
    } catch (error) {
      setConflict(isVersionConflict(error));
      setFormError(
        saveErrorMessage(error, {
          fields: ['name', 'group', 'gestationDays'],
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
      <TextField label="Nombre" error={errors.name?.message} {...register('name')} />
      <Controller
        control={control}
        name="group"
        render={({ field }) => (
          <SegmentedChoice<BreedGroup>
            label="Grupo racial"
            options={BREED_GROUP_OPTIONS}
            value={field.value ?? null}
            onChange={(next) => {
              field.onChange(next);
              // Se propone la gestación del grupo salvo que la persona ya la haya escrito.
              if (dirtyFields.gestationDays !== true) {
                setValue('gestationDays', proposedGestationDays(next));
              }
            }}
            error={errors.group === undefined ? undefined : 'Elige el grupo racial.'}
          />
        )}
      />
      <Controller
        control={control}
        name="gestationDays"
        render={({ field }) => (
          <NumberField
            label="Gestación (días)"
            unit="días"
            value={field.value === undefined ? null : String(field.value)}
            onChange={(next) => {
              field.onChange(next === null ? undefined : Number(next));
            }}
            onBlur={field.onBlur}
            error={errors.gestationDays?.message}
            hint={
              group === undefined
                ? `Vacío: se usa la gestación de la finca (${DEFAULT_FARM_GESTATION_DAYS} días).`
                : `Propuesta para el grupo: ${proposedGestationDays(group)} días. Puedes cambiarla. Cambiarla no mueve las fechas de parto ya estimadas.`
            }
          />
        )}
      />
      <FormActions
        submitLabel="Guardar raza"
        submitting={isSubmitting}
        error={formError}
        conflict={conflict}
        onReload={() => onReload?.()}
      />
    </form>
  );
}

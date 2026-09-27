import { zodResolver } from '@hookform/resolvers/zod';
import { createLotSchema, createTagSchema, type LotView, type TagView } from '@hato/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { TextField } from '../../../components/ui/TextField';
import { useCatalogMutations, type Saved } from '../api';
import { FormActions } from '../FormActions';
import { isVersionConflict, saveErrorMessage } from '../form-errors';

/** Formulario de lote (CFG-02, 08 §1.10). */
export function LotForm({
  lot,
  onSaved,
  onReload,
}: {
  lot?: LotView;
  onSaved: (saved: Saved<LotView>) => void;
  onReload?: () => void;
}) {
  const { create, update } = useCatalogMutations('lots');
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createLotSchema),
    defaultValues: { name: lot?.name ?? '', description: lot?.description ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    try {
      onSaved(
        lot === undefined
          ? await create.mutateAsync(values)
          : await update.mutateAsync({ id: lot.id, body: { ...values, version: lot.version } }),
      );
    } catch (error) {
      setConflict(isVersionConflict(error));
      setFormError(
        saveErrorMessage(error, { fields: ['name', 'description'], nameField: 'name', setError }),
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
      <TextField
        label="Descripción"
        hint="Opcional. Por ejemplo, vacas con cría al pie."
        error={errors.description?.message}
        {...register('description')}
      />
      <FormActions
        submitLabel="Guardar lote"
        submitting={isSubmitting}
        error={formError}
        conflict={conflict}
        onReload={() => onReload?.()}
      />
    </form>
  );
}

/**
 * Formulario de etiqueta manual (CLS-02). En la etiqueta de sistema (COTERO) el nombre no se
 * puede cambiar; su descripción sí (08 §1.1).
 */
export function TagForm({
  tag,
  onSaved,
  onReload,
}: {
  tag?: TagView;
  onSaved: (saved: Saved<TagView>) => void;
  onReload?: () => void;
}) {
  const { create, update } = useCatalogMutations('tags');
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const isSystem = tag?.isSystem === true;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createTagSchema),
    defaultValues: { label: tag?.label ?? '', description: tag?.description ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    try {
      onSaved(
        tag === undefined
          ? await create.mutateAsync(values)
          : await update.mutateAsync({
              id: tag.id,
              // En la de sistema solo viaja la descripción.
              body: isSystem
                ? { description: values.description, version: tag.version }
                : { ...values, version: tag.version },
            }),
      );
    } catch (error) {
      setConflict(isVersionConflict(error));
      setFormError(
        saveErrorMessage(error, { fields: ['label', 'description'], nameField: 'label', setError }),
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
        readOnly={isSystem}
        hint={isSystem ? 'Etiqueta del sistema: su nombre no se puede cambiar.' : undefined}
        error={errors.label?.message}
        {...register('label')}
      />
      <TextField
        label="Descripción"
        hint="Opcional. Qué significa en esta finca."
        error={errors.description?.message}
        {...register('description')}
      />
      <FormActions
        submitLabel="Guardar etiqueta"
        submitting={isSubmitting}
        error={formError}
        conflict={conflict}
        onReload={() => onReload?.()}
      />
    </form>
  );
}

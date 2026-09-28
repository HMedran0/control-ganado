import { isIsoDate, type AnimalDetail } from '@hato/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type UseFormSetError } from 'react-hook-form';

import { AlertBanner } from '../../../components/ui/AlertBanner';
import { Checkbox } from '../../../components/ui/Checkbox';
import { DateQuickPick } from '../../../components/ui/DateQuickPick';
import { NumberField } from '../../../components/ui/NumberField';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { SelectField } from '../../../components/ui/SelectField';
import { TextAreaField } from '../../../components/ui/TextAreaField';
import { TextField } from '../../../components/ui/TextField';
import { isApiError } from '../../../lib/api/errors';
import { useRequiredSession } from '../../../lib/auth/context';
import { useToday } from '../../../lib/clock';
import { RFID_FIELD_ATTRIBUTE } from '../../../lib/rfid/useRfidReader';
import { FormActions } from '../../settings/FormActions';
import { useCatalog } from '../../settings/api';
import { useCreateAnimal, useNextCode, useUpdateAnimal } from '../api';
import { IdentifierSaveError } from '../detail/Identifiers';
import '../nav-state';
import { AnimalPicker } from './AnimalPicker';
import {
  createBody,
  createResolver,
  emptyValues,
  fieldForPath,
  updateBody,
  updateResolver,
  valuesFromAnimal,
  type AnimalFormValues,
} from './payload';

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-cerca pt-5 first:border-t-0 first:pt-0">
      <legend className="mb-1 text-md font-bold">{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Lleva un error de la API a donde se entiende (06 §8): cada error por campo a su campo, el
 * código repetido junto al código; el resto como mensaje general.
 */
function placeError(
  error: unknown,
  body: Record<string, unknown>,
  setError: UseFormSetError<AnimalFormValues>,
): boolean {
  if (!isApiError(error)) return false;
  if (error.code === 'ANIMAL_CODE_TAKEN') {
    setError('code', { type: 'server', message: error.detail });
    return true;
  }
  const entries = Object.entries(error.fieldErrors ?? {});
  let placed = false;
  for (const [path, messages] of entries) {
    const field = fieldForPath(path, body);
    const message = messages[0];
    if (field !== null && message !== undefined) {
      setError(field, { type: 'server', message });
      placed = true;
    }
  }
  return placed;
}

/**
 * Formulario de animal (ANI-01 y ANI-02) con react-hook-form y los esquemas de shared.
 *
 * - Nacido en la finca: el código se sugiere con `next-code` según la fecha de nacimiento
 *   mientras la persona no lo cambie (08 §2.3).
 * - Comprado: vendedor, fecha de ingreso y, solo para ADMIN, el valor de compra (RN-20).
 * - Solo razas, lotes y etiquetas activos.
 * - En edición, un animal con salida solo admite observaciones (RN-09).
 */
export function AnimalForm({
  animal,
  initialRfid,
  onReload,
}: {
  /** Sin animal, alta. */
  animal?: AnimalDetail;
  /** Chip leído que no estaba registrado (búsqueda, ANI-05 CA3). */
  initialRfid?: string;
  onReload?: () => void;
}) {
  const session = useRequiredSession();
  const isAdmin = session.role === 'ADMIN';
  const today = useToday();
  const navigate = useNavigate();
  const editing = animal !== undefined;
  const exited = editing && animal.status !== 'ACTIVE';
  const [initial] = useState<AnimalFormValues>(() =>
    animal === undefined
      ? { ...emptyValues(today), rfid: initialRfid ?? '' }
      : valuesFromAnimal(animal, today),
  );
  const breeds = useCatalog('breeds', true);
  const lots = useCatalog('lots', true);
  const tags = useCatalog('tags', true);
  const create = useCreateAnimal();
  const update = useUpdateAnimal(animal?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  const updateOptions = { version: animal?.version ?? 1, isAdmin, exited };
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    getFieldState,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AnimalFormValues, unknown, unknown>({
    resolver: editing ? updateResolver(initial, updateOptions) : createResolver(isAdmin),
    defaultValues: initial,
  });

  const origin = useWatch({ control, name: 'origin' });
  const birthDate = useWatch({ control, name: 'birthDate' });
  const sire = useWatch({ control, name: 'sire' });
  const suggestFor =
    !editing && origin === 'BORN_ON_FARM' ? (isIsoDate(birthDate) ? birthDate : today) : null;
  const nextCode = useNextCode(suggestFor);
  const suggestion = nextCode.data?.code;

  // El código sugerido llena el campo mientras la persona no lo haya escrito ella misma.
  useEffect(() => {
    if (suggestion !== undefined && !getFieldState('code').isDirty) {
      setValue('code', suggestion);
    }
  }, [suggestion, getFieldState, setValue]);

  const submit = async (confirmReuse: boolean): Promise<void> => {
    setFormError(null);
    setSaveError(null);
    setConflict(false);
    const values = getValues();
    const body = editing ? updateBody(values, initial, updateOptions) : createBody(values, isAdmin);
    if (confirmReuse && Array.isArray(body.identifiers)) {
      body.identifiers = (body.identifiers as object[]).map((item) => ({ ...item, confirmReuse }));
    }
    try {
      const saved = editing
        ? await update.mutateAsync(body as never)
        : await create.mutateAsync(body as never);
      await navigate({
        to: '/animals/$id',
        params: { id: saved.id },
        state: {
          animalWarnings: saved.warnings,
          animalSaved: editing ? 'Cambios guardados.' : 'Animal registrado.',
        },
      });
    } catch (error) {
      if (isApiError(error) && error.code === 'VERSION_CONFLICT') {
        setConflict(true);
        setFormError(error.detail);
        return;
      }
      if (
        isApiError(error) &&
        (error.code === 'IDENTIFIER_TAKEN' || error.code === 'IDENTIFIER_PREVIOUSLY_USED')
      ) {
        setSaveError(error);
        return;
      }
      if (!placeError(error, body, setError)) {
        setFormError(isApiError(error) ? error.detail : 'Ocurrió un error inesperado.');
      }
    }
  };

  const activeBreeds = (breeds.data?.items ?? []).filter(
    (breed) => breed.isActive || breed.id === initial.breedId,
  );
  const activeLots = (lots.data?.items ?? []).filter(
    (lot) => lot.isActive || lot.id === initial.lotId,
  );
  const activeTags = (tags.data?.items ?? []).filter(
    (tag) => tag.isActive || initial.tagIds.includes(tag.id),
  );
  const submitLabel = editing ? 'Guardar cambios' : 'Registrar animal';

  return (
    <form
      noValidate
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) =>
        void handleSubmit(
          () => submit(false),
          () => {
            setFormError(errors.root?.message ?? null);
          },
        )(event)
      }
    >
      {exited ? (
        <AlertBanner
          tone="info"
          title="Este animal ya salió de la finca"
          description="Solo puedes editar las observaciones. Para cambiar otros datos hay que revertir la salida."
        />
      ) : (
        <>
          <Fieldset legend="Identificación">
            <TextField
              label="Código"
              autoComplete="off"
              hint={
                suggestion === undefined
                  ? 'El número de manejo de la finca. No se puede repetir.'
                  : `Sugerido para las crías de la finca: ${suggestion}. Puedes cambiarlo.`
              }
              error={errors.code?.message}
              {...register('code')}
            />
            <TextField
              label="Nombre"
              hint="Opcional."
              error={errors.name?.message}
              {...register('name')}
            />
            <Controller
              control={control}
              name="sex"
              render={({ field }) => (
                <SegmentedChoice
                  label="Sexo"
                  options={[
                    { value: 'FEMALE', label: 'Hembra' },
                    { value: 'MALE', label: 'Macho' },
                  ]}
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.sex?.message}
                />
              )}
            />
            <SelectField label="Raza" error={errors.breedId?.message} {...register('breedId')}>
              <option value="">Elige la raza</option>
              {activeBreeds.map((breed) => (
                <option key={breed.id} value={breed.id}>
                  {breed.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Fecha de nacimiento"
              type="date"
              max={today}
              error={errors.birthDate?.message}
              {...register('birthDate')}
            />
            <Checkbox label="La fecha es aproximada" {...register('birthDateEstimated')} />
          </Fieldset>

          <Fieldset legend="Procedencia">
            <Controller
              control={control}
              name="origin"
              render={({ field }) => (
                <SegmentedChoice
                  label="¿De dónde viene?"
                  options={[
                    { value: 'BORN_ON_FARM', label: 'Nació en la finca' },
                    { value: 'PURCHASED', label: 'Comprado' },
                  ]}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {origin === 'PURCHASED' ? (
              <>
                <TextField
                  label="Vendedor u origen"
                  hint="Opcional. Por ejemplo, Finca El Roble."
                  error={errors.originDetail?.message}
                  {...register('originDetail')}
                />
                <TextField
                  label="Fecha de ingreso"
                  type="date"
                  max={today}
                  error={errors.entryDate?.message}
                  {...register('entryDate')}
                />
                {isAdmin ? (
                  <Controller
                    control={control}
                    name="purchasePrice"
                    render={({ field }) => (
                      <NumberField
                        label="Valor de compra"
                        hint="Opcional. Queda como gasto de compra del animal."
                        currency
                        value={field.value}
                        onChange={field.onChange}
                        error={errors.purchasePrice?.message}
                      />
                    )}
                  />
                ) : null}
              </>
            ) : null}
          </Fieldset>

          <Fieldset legend="Padres">
            <Controller
              control={control}
              name="dam"
              render={({ field }) => (
                <AnimalPicker
                  label="Madre"
                  sex="FEMALE"
                  value={field.value}
                  onChange={field.onChange}
                  {...(animal === undefined ? {} : { excludeId: animal.id })}
                  error={errors.dam?.message}
                  hint="Opcional."
                />
              )}
            />
            <Controller
              control={control}
              name="sire"
              render={({ field }) => (
                <AnimalPicker
                  label="Padre"
                  sex="MALE"
                  value={field.value}
                  onChange={field.onChange}
                  {...(animal === undefined ? {} : { excludeId: animal.id })}
                  error={errors.sire?.message}
                  hint="Opcional. Un toro de la finca."
                />
              )}
            />
            {sire === null ? (
              <TextField
                label="Padre externo"
                hint="Opcional. Pajilla de inseminación o toro prestado."
                error={errors.sireExternalRef?.message}
                {...register('sireExternalRef')}
              />
            ) : null}
          </Fieldset>

          <Fieldset legend="Manejo">
            <SelectField label="Lote" error={errors.lotId?.message} {...register('lotId')}>
              <option value="">Sin lote</option>
              {activeLots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name}
                </option>
              ))}
            </SelectField>
            {!editing && activeTags.length > 0 ? (
              <div className="flex flex-col">
                <span className="font-bold">Etiquetas</span>
                {activeTags.map((tag) => (
                  <Checkbox key={tag.id} label={tag.label} value={tag.id} {...register('tagIds')} />
                ))}
              </div>
            ) : null}
            {isAdmin ? <Checkbox label="Disponible para venta" {...register('forSale')} /> : null}
          </Fieldset>

          {editing ? null : (
            <Fieldset legend="Identificadores">
              <TextField
                label="Chapeta"
                hint="Opcional. El número del arete visual."
                autoComplete="off"
                error={errors.visualTag?.message}
                {...register('visualTag')}
              />
              <TextField
                label="Chip"
                hint="Opcional. Con el lector, acerca el chip: el número queda escrito aquí."
                autoComplete="off"
                inputMode="numeric"
                error={errors.rfid?.message}
                {...{ [RFID_FIELD_ATTRIBUTE]: '' }}
                {...register('rfid')}
              />
              <TextField
                label="DIN"
                hint="Opcional. El dispositivo de identificación del ICA."
                autoComplete="off"
                error={errors.din?.message}
                {...register('din')}
              />
            </Fieldset>
          )}

          {editing ? null : (
            <Fieldset legend="Peso inicial">
              <Controller
                control={control}
                name="weightKg"
                render={({ field }) => (
                  <NumberField
                    label="Peso"
                    hint="Opcional."
                    unit="kg"
                    maxDecimals={2}
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.weightKg?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="weightMethod"
                render={({ field }) => (
                  <SegmentedChoice
                    label="¿Cómo se pesó?"
                    options={[
                      { value: 'SCALE', label: 'Báscula' },
                      { value: 'TAPE', label: 'Cinta' },
                      { value: 'ESTIMATE', label: 'Estimado' },
                    ]}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={control}
                name="weighedOn"
                render={({ field }) => (
                  <DateQuickPick
                    label="Fecha del pesaje"
                    value={isIsoDate(field.value) ? field.value : today}
                    onChange={field.onChange}
                    today={today}
                  />
                )}
              />
              {errors.weighedOn?.message === undefined ? null : (
                <p className="text-aux font-bold text-alerta">{errors.weighedOn.message}</p>
              )}
            </Fieldset>
          )}
        </>
      )}

      <TextAreaField
        label="Observaciones"
        hint="Opcional."
        error={errors.notes?.message}
        {...register('notes')}
      />

      <IdentifierSaveError
        error={saveError}
        isAdmin={isAdmin}
        onConfirmReuse={() => {
          void submit(true);
        }}
      />
      <FormActions
        submitLabel={submitLabel}
        submitting={isSubmitting || create.isPending || update.isPending}
        error={formError ?? errors.root?.message ?? null}
        conflict={conflict}
        onReload={() => onReload?.()}
      />
    </form>
  );
}

import {
  calvingSchema,
  formatDate,
  isIsoDate,
  MAX_CALVES_PER_CALVING,
  type AnimalDetail,
  type CalfHealth,
  type CalvingInput,
  type CalvingType,
  type IsoDate,
  type Sex,
} from '@hato/shared';
import { useEffect } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Path } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { NumberField } from '../../components/ui/NumberField';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { Stepper } from '../../components/ui/Stepper';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { isApiError } from '../../lib/api/errors';
import { useToday } from '../../lib/clock';
import { useCalving, useNextCodes } from './api';
import { SaveError, optional, schemaResolver, useBackToDam, weight } from './form-kit';
import { CALF_HEALTH_LABEL, CALVING_TYPE_LABEL, SERVICE_METHOD_LABEL } from './labels';

type CalfValues = {
  code: string;
  sex: Sex | null;
  health: CalfHealth;
  weightKg: string | null;
  visualTag: string;
};

type CalvingValues = {
  date: string;
  calvingType: CalvingType | null;
  notes: string;
  calves: CalfValues[];
};

const EMPTY_CALF: CalfValues = {
  code: '',
  sex: null,
  health: 'ALIVE',
  weightKg: null,
  visualTag: '',
};

/** «26-045», «26-045 y 26-046», «26-045, 26-046 y 26-047». */
function joinCodes(codes: readonly string[]): string {
  if (codes.length <= 1) return codes.join('');
  return `${codes.slice(0, -1).join(', ')} y ${codes.at(-1) ?? ''}`;
}

/** «Parto guardado · 26-045 creado», o sin crías vivas, «Parto guardado.» */
export function calvingSavedMessage(codes: readonly string[]): string {
  if (codes.length === 0) return 'Parto guardado.';
  return `Parto guardado · ${joinCodes(codes)} ${codes.length === 1 ? 'creado' : 'creados'}`;
}

/**
 * Campo del cuerpo → campo del formulario: `calves.1.identifiers.0.value` es la chapeta
 * (`calves.1.visualTag`) y `calves.1.birthWeightKg`, el peso (`calves.1.weightKg`).
 */
function formFieldFor(apiField: string): string {
  return apiField
    .replace(/^calves\.(\d+)\.identifiers\.\d+\.value$/, 'calves.$1.visualTag')
    .replace(/^calves\.(\d+)\.birthWeightKg$/, 'calves.$1.weightKg');
}

/**
 * Registrar parto (REP-04, CU-01, 06 §5.4): una pantalla con la madre y su preñez, la fecha, el
 * tipo de parto, de 1 a 3 crías y, por cada una, código (sugerido con la numeración de la
 * finca), sexo, peso, estado y chapeta. Una cría muerta al nacer no lleva código ni chapeta: no
 * se crea como animal (CA4). Todo se guarda en una transacción (CA5) y se vuelve a la ficha de la
 * madre con las crías enlazadas (CA6).
 */
export function CalvingForm({ animal }: { animal: AnimalDetail }) {
  const today = useToday();
  const back = useBackToDam();
  const calving = useCalving();
  const open = animal.reproduction?.openPregnancy ?? null;
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getFieldState,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CalvingValues, unknown, CalvingInput>({
    resolver: schemaResolver(
      calvingSchema,
      (values) => ({
        damId: animal.id,
        ...(open === null ? {} : { pregnancyId: open.id }),
        date: values.date,
        calvingType: values.calvingType ?? undefined,
        notes: optional(values.notes),
        calves: values.calves.map((calf) => {
          const stillborn = calf.health === 'STILLBORN';
          const tag = optional(calf.visualTag);
          return {
            sex: calf.sex ?? undefined,
            health: calf.health,
            ...(stillborn
              ? {}
              : { code: optional(calf.code), birthWeightKg: weight(calf.weightKg) }),
            ...(stillborn || tag === undefined
              ? {}
              : { identifiers: [{ type: 'VISUAL_TAG', value: tag }] }),
          };
        }),
      }),
      formFieldFor,
    ),
    defaultValues: {
      date: today,
      calvingType: 'NORMAL',
      notes: '',
      calves: [{ ...EMPTY_CALF }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'calves' });
  const calves = useWatch({ control, name: 'calves' });
  const date = useWatch({ control, name: 'date' });
  const liveIndexes = calves.flatMap((calf, index) => (calf.health === 'STILLBORN' ? [] : [index]));
  const suggestions = useNextCodes(isIsoDate(date) ? date : today, liveIndexes.length);
  const codes = suggestions.data?.codes;

  // Los códigos sugeridos llenan los campos que la persona no ha escrito ella misma.
  useEffect(() => {
    if (codes === undefined) return;
    liveIndexes.forEach((index, position) => {
      const field = `calves.${index}.code` as const;
      const suggested = codes[position];
      if (suggested !== undefined && !getFieldState(field).isDirty) {
        setValue(field, suggested);
      }
    });
    // `liveIndexes` se recalcula en cada render; basta con reaccionar a los códigos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, getFieldState, setValue]);

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) =>
        void handleSubmit(async (body) => {
          try {
            const result = await calving.mutateAsync(body);
            await back(
              animal.id,
              calvingSavedMessage(result.calves.map((calf) => calf.code)),
              result.warnings,
            );
          } catch (error) {
            // Un código tomado o un identificador repetido va junto a su campo (06 §8).
            if (isApiError(error) && error.fieldErrors !== undefined) {
              for (const [field, messages] of Object.entries(error.fieldErrors)) {
                const message = messages[0];
                if (message !== undefined && field.startsWith('calves.')) {
                  setError(formFieldFor(field) as Path<CalvingValues>, {
                    type: 'server',
                    message,
                  });
                }
              }
            }
          }
        })(event)
      }
    >
      <section className="rounded-control bg-superficie-2 p-3" aria-label="Madre">
        <p className="font-bold">
          Madre: {animal.code}
          {animal.name === null ? '' : ` · ${animal.name}`}
        </p>
        <p className="text-texto-2">
          {open === null
            ? 'Sin preñez registrada: el parto quedará con fecha de servicio estimada.'
            : `Preñez: servicio del ${formatDate(open.serviceDate)} · ${SERVICE_METHOD_LABEL[open.method]} · parto estimado ${formatDate(open.expectedCalvingDate)}`}
        </p>
      </section>

      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha del parto"
            value={field.value as IsoDate}
            onChange={field.onChange}
            today={today}
            min={open?.serviceDate ?? animal.birthDate}
          />
        )}
      />
      <Controller
        control={control}
        name="calvingType"
        render={({ field }) => (
          <SegmentedChoice
            label="Tipo de parto"
            options={[
              { value: 'NORMAL', label: CALVING_TYPE_LABEL.NORMAL },
              { value: 'ASSISTED', label: CALVING_TYPE_LABEL.ASSISTED },
              { value: 'CESAREAN', label: CALVING_TYPE_LABEL.CESAREAN },
            ]}
            value={field.value}
            onChange={field.onChange}
            error={errors.calvingType?.message}
          />
        )}
      />
      <Stepper
        label="Crías"
        value={fields.length}
        min={1}
        max={MAX_CALVES_PER_CALVING}
        onChange={(next) => {
          if (next > fields.length) append({ ...EMPTY_CALF });
          else remove(fields.length - 1);
        }}
      />

      {fields.map((field, index) => {
        const stillborn = calves[index]?.health === 'STILLBORN';
        const calfErrors = errors.calves?.[index];
        return (
          <fieldset key={field.id} className="flex flex-col gap-4 border-t-2 border-cerca pt-4">
            <legend className="text-md font-bold">Cría {index + 1}</legend>
            <Controller
              control={control}
              name={`calves.${index}.health`}
              render={({ field: health }) => (
                <SegmentedChoice
                  label="Estado"
                  options={[
                    { value: 'ALIVE', label: CALF_HEALTH_LABEL.ALIVE },
                    { value: 'WEAK', label: CALF_HEALTH_LABEL.WEAK },
                    { value: 'STILLBORN', label: CALF_HEALTH_LABEL.STILLBORN },
                  ]}
                  value={health.value}
                  onChange={health.onChange}
                  error={calfErrors?.health?.message}
                />
              )}
            />
            <Controller
              control={control}
              name={`calves.${index}.sex`}
              render={({ field: sex }) => (
                <SegmentedChoice
                  label="Sexo"
                  options={[
                    { value: 'MALE', label: 'Macho' },
                    { value: 'FEMALE', label: 'Hembra' },
                  ]}
                  value={sex.value}
                  onChange={sex.onChange}
                  error={calfErrors?.sex?.message}
                />
              )}
            />
            {stillborn ? (
              <p className="text-texto-2">
                Una cría muerta al nacer queda en el parto, pero no se registra como animal.
              </p>
            ) : (
              <>
                <TextField
                  label="Código"
                  hint="Sugerido con la numeración de la finca. Puedes cambiarlo."
                  error={calfErrors?.code?.message}
                  {...register(`calves.${index}.code`)}
                />
                <Controller
                  control={control}
                  name={`calves.${index}.weightKg`}
                  render={({ field: kg }) => (
                    <NumberField
                      label="Peso al nacer"
                      hint="Opcional."
                      unit="kg"
                      value={kg.value}
                      onChange={kg.onChange}
                      error={calfErrors?.weightKg?.message}
                    />
                  )}
                />
                <TextField
                  label="Chapeta"
                  hint="Opcional."
                  error={calfErrors?.visualTag?.message}
                  {...register(`calves.${index}.visualTag`)}
                />
              </>
            )}
          </fieldset>
        );
      })}
      {errors.calves?.root?.message === undefined && errors.calves?.message === undefined ? null : (
        <p className="text-alerta-intenso">
          {errors.calves.root?.message ?? errors.calves.message}
        </p>
      )}

      <TextAreaField
        label="Observaciones del parto"
        hint="Opcional."
        error={errors.notes?.message}
        {...register('notes')}
      />
      <SaveError error={calving.error} damId={animal.id} />
      <Button type="submit" block disabled={isSubmitting || calving.isPending}>
        {calving.isPending ? 'Guardando…' : 'Guardar parto'}
      </Button>
    </form>
  );
}

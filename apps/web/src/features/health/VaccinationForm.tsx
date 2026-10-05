import {
  canApplyVaccine,
  createVaccinationSchema,
  formatDate,
  isIsoDate,
  nextDueOnFromInterval,
  vaccineSexBlockedParams,
  errorDetail,
  type AnimalDetail,
  type CreateVaccinationInput,
  type IsoDate,
} from '@hato/shared';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { SelectField } from '../../components/ui/SelectField';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { useToday } from '../../lib/clock';
import { SaveError, optional, schemaResolver } from '../reproduction/form-kit';
import { useCatalog } from '../settings/api';
import { useCreateVaccination } from './api';
import { useBackToAnimal } from './event-page';

type VaccinationValues = {
  vaccineId: string;
  date: string;
  dose: string;
  batchNumber: string;
  ruvNumber: string;
  responsible: string;
  /** Próxima fecha de una vacuna de intervalo: vacía es «sin próxima fecha». */
  nextDueOn: string;
  notes: string;
};

/**
 * Registrar vacuna (SAN-02): vacuna activa del catálogo, fecha, dosis (la de la vacuna por
 * defecto), lote o serie, RUV en las de ciclo oficial, responsable y, en las de intervalo, la
 * próxima fecha propuesta (RN-12). Avisa antes de guardar si la vacuna no se aplica a su sexo
 * (RN-26) o si está fuera de la edad recomendada.
 */
export function VaccinationForm({
  animal,
  vaccineId,
}: {
  animal: AnimalDetail;
  vaccineId?: string | undefined;
}) {
  const today = useToday();
  const back = useBackToAnimal();
  const create = useCreateVaccination();
  const vaccines = useCatalog('vaccines');
  const options = vaccines.data?.items ?? [];
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<VaccinationValues, unknown, CreateVaccinationInput>({
    resolver: schemaResolver(createVaccinationSchema, (values) => {
      const vaccine = options.find((item) => item.id === values.vaccineId);
      return {
        animalId: animal.id,
        vaccineId: values.vaccineId === '' ? undefined : values.vaccineId,
        date: values.date,
        dose: optional(values.dose),
        batchNumber: optional(values.batchNumber),
        ruvNumber: optional(values.ruvNumber),
        responsible: optional(values.responsible),
        notes: optional(values.notes),
        ...(vaccine?.scheduleType === 'INTERVAL'
          ? { nextDueOn: values.nextDueOn === '' ? null : values.nextDueOn }
          : {}),
      };
    }),
    defaultValues: {
      vaccineId: vaccineId ?? '',
      date: today,
      dose: '',
      batchNumber: '',
      ruvNumber: '',
      responsible: '',
      nextDueOn: '',
      notes: '',
    },
  });

  const selectedId = useWatch({ control, name: 'vaccineId' });
  const date = useWatch({ control, name: 'date' });
  const vaccine = options.find((item) => item.id === selectedId);
  const check =
    vaccine === undefined || !isIsoDate(date)
      ? null
      : canApplyVaccine({
          vaccine,
          animal: {
            sex: animal.sex,
            birthDate: animal.birthDate,
            entryDate: animal.entryDate,
            entryDateEstimated: animal.entryDateEstimated,
          },
          vaccineName: vaccine.name,
          appliedOn: date,
        });
  const proposedDue =
    vaccine?.scheduleType === 'INTERVAL' && isIsoDate(date)
      ? nextDueOnFromInterval(date, vaccine.boosterIntervalDays)
      : null;

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
              'sanidad',
              `Vacuna registrada: ${saved.vaccine.name} el ${formatDate(saved.appliedOn)}.`,
              saved.warnings,
            );
          } catch {
            // El error se muestra abajo.
          }
        })(event)
      }
    >
      <SelectField
        label="Vacuna"
        error={errors.vaccineId?.message}
        {...register('vaccineId', {
          onChange: (event: { target: { value: string } }) => {
            const next = options.find((item) => item.id === event.target.value);
            setValue('dose', next?.defaultDose ?? '');
            setValue('nextDueOn', '');
          },
        })}
      >
        <option value="">Elige la vacuna</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {item.disease}
          </option>
        ))}
      </SelectField>
      {check?.blocked === true && vaccine !== undefined ? (
        <p
          role="alert"
          className="rounded-control bg-alerta-claro p-3 font-bold text-alerta-intenso"
        >
          {errorDetail('VACCINE_SEX_BLOCKED', vaccineSexBlockedParams(vaccine.name, animal.sex))}
        </p>
      ) : null}
      {check !== null && !check.blocked && check.warnings.length > 0 ? (
        <p className="rounded-control bg-aviso-claro p-3 text-aviso-intenso">
          {check.warnings[0]?.message} Puedes registrarla igual.
        </p>
      ) : null}
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateQuickPick
            label="Fecha de aplicación"
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
      <TextField label="Dosis" hint="Por ejemplo, 2 ml." {...register('dose')} />
      {vaccine?.scheduleType === 'OFFICIAL_CYCLE' ? (
        <TextField
          label="Número de RUV"
          hint="El Registro Único de Vacunación que entrega el vacunador. Opcional."
          {...register('ruvNumber')}
        />
      ) : null}
      <TextField label="Lote o serie del biológico" hint="Opcional." {...register('batchNumber')} />
      {vaccine?.scheduleType === 'INTERVAL' ? (
        <TextField
          type="date"
          label="Próxima aplicación"
          hint={
            proposedDue === null
              ? 'Opcional.'
              : `Si la dejas vacía se propone el ${formatDate(proposedDue)}, según el intervalo de la vacuna.`
          }
          error={errors.nextDueOn?.message}
          {...register('nextDueOn')}
        />
      ) : null}
      <TextField label="Responsable" hint="Quién vacunó. Opcional." {...register('responsible')} />
      <TextAreaField label="Observaciones" hint="Opcional." {...register('notes')} />
      <SaveError error={create.error} damId={animal.id} />
      <Button
        type="submit"
        block
        disabled={isSubmitting || create.isPending || check?.blocked === true}
      >
        {create.isPending ? 'Guardando…' : 'Registrar vacuna'}
      </Button>
    </form>
  );
}

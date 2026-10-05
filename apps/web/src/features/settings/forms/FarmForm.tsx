import { zodResolver } from '@hookform/resolvers/zod';
import {
  MANAGEMENT_CATEGORY,
  updateFarmSchema,
  type CodeSuggestion,
  type FarmView,
  type ManagementCategory,
} from '@hato/shared';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import type { z } from 'zod';

import { AlertBanner } from '../../../components/ui/AlertBanner';
import { NumberField } from '../../../components/ui/NumberField';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { TextField } from '../../../components/ui/TextField';
import { CATEGORY_LABEL } from '../../animals/labels';
import { useUpdateFarm } from '../api';
import { FormActions } from '../FormActions';
import { isVersionConflict, saveErrorMessage } from '../form-errors';

type Values = z.input<typeof updateFarmSchema>;
type NumericSetting =
  | 'gestationDays'
  | 'weaningAgeMonths'
  | 'minBreedingAgeMonths'
  | 'calvingAlertDays'
  | 'vaccineAlertDays'
  | 'unconfirmedServiceAlertDays'
  | 'weightLossAlertPercent'
  | 'weightGainAnchorMaxDays';

/**
 * Datos y parámetros de la finca (CFG-01). Cambiar el destete o la gestación de la finca cambia
 * de inmediato las categorías calculadas: se advierte antes de guardar (CFG-01 CA1).
 *
 * Numeración (ANI-10): reutilizar números y cómo se sugiere el número de un animal nuevo. Dejar
 * de reutilizar con números repetidos lo rechaza la API (`CODE_REUSE_CONFLICT`) con los códigos
 * en el mensaje, que se muestra tal cual.
 *
 * El precio por kilo por categoría no se edita aquí: es un dato económico y llega con Finanzas
 * (M7). Como el `PATCH` es parcial, guardar este formulario no lo toca.
 */
export function FarmForm({ farm, onReload }: { farm: FarmView; onReload: () => void }) {
  const updateFarm = useUpdateFarm();
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const { settings } = farm;
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateFarmSchema),
    defaultValues: {
      version: farm.version,
      name: farm.name,
      municipality: farm.municipality ?? '',
      department: farm.department ?? '',
      icaPremiseCode: farm.icaPremiseCode ?? '',
      settings: {
        gestationDays: settings.gestationDays,
        weaningAgeMonths: settings.weaningAgeMonths,
        minBreedingAgeMonths: settings.minBreedingAgeMonths,
        calvingAlertDays: settings.calvingAlertDays,
        vaccineAlertDays: settings.vaccineAlertDays,
        unconfirmedServiceAlertDays: settings.unconfirmedServiceAlertDays,
        calfCodePattern: settings.calfCodePattern,
        rabiesRiskZone: settings.rabiesRiskZone,
        codeReuse: settings.codeReuse,
        codeSuggestion: settings.codeSuggestion,
        weightGainAlertKgPerDay: settings.weightGainAlertKgPerDay,
        weightLossAlertPercent: settings.weightLossAlertPercent,
        weightGainAnchorMaxDays: settings.weightGainAnchorMaxDays,
      },
    },
  });

  const weaning = useWatch({ control, name: 'settings.weaningAgeMonths' });
  const gestation = useWatch({ control, name: 'settings.gestationDays' });
  const codeSuggestion = useWatch({ control, name: 'settings.codeSuggestion' });
  const recalculates =
    weaning !== settings.weaningAgeMonths || gestation !== settings.gestationDays;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    setSaved(false);
    try {
      const updated = await updateFarm.mutateAsync(values);
      reset({ ...values, version: updated.version });
      setSaved(true);
    } catch (error) {
      setConflict(isVersionConflict(error));
      setFormError(
        saveErrorMessage(error, {
          fields: ['name', 'municipality', 'department', 'icaPremiseCode'],
          setError,
        }),
      );
    }
  });

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="flex max-w-2xl flex-col gap-8"
    >
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-3 text-lg font-bold">Datos de la finca</legend>
        <TextField label="Nombre" error={errors.name?.message} {...register('name')} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Municipio"
            error={errors.municipality?.message}
            {...register('municipality')}
          />
          <TextField
            label="Departamento"
            error={errors.department?.message}
            {...register('department')}
          />
        </div>
        <TextField
          label="Código de predio del ICA"
          hint="Opcional."
          error={errors.icaPremiseCode?.message}
          {...register('icaPremiseCode')}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-3 text-lg font-bold">Parámetros del hato</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <SettingNumber
            control={control}
            name="weaningAgeMonths"
            label="Edad de destete (meses)"
            unit="meses"
            hint="Separa terneros y terneras de levante y novillas."
            error={errors.settings?.weaningAgeMonths?.message}
          />
          <SettingNumber
            control={control}
            name="gestationDays"
            label="Gestación de la finca (días)"
            unit="días"
            hint="Para las razas sin gestación propia."
            error={errors.settings?.gestationDays?.message}
          />
          <SettingNumber
            control={control}
            name="minBreedingAgeMonths"
            label="Edad mínima de servicio (meses)"
            unit="meses"
            error={errors.settings?.minBreedingAgeMonths?.message}
          />
          <SettingNumber
            control={control}
            name="unconfirmedServiceAlertDays"
            label="Servida sin diagnóstico: alertar a los (días)"
            unit="días"
            error={errors.settings?.unconfirmedServiceAlertDays?.message}
          />
          <SettingNumber
            control={control}
            name="calvingAlertDays"
            label="Alerta de parto próximo (días antes)"
            unit="días"
            error={errors.settings?.calvingAlertDays?.message}
          />
          <SettingNumber
            control={control}
            name="vaccineAlertDays"
            label="Alerta de vacuna próxima (días antes)"
            unit="días"
            error={errors.settings?.vaccineAlertDays?.message}
          />
        </div>
        <fieldset className="flex flex-col gap-4 rounded-panel border-2 border-cerca p-4">
          <legend className="px-1 font-bold">Pesos (PES-05)</legend>
          <p className="text-texto-2">
            «Ganancia baja» cuando la ganancia de los últimos 90 días es menor que el umbral de su
            categoría. Deja vacía una categoría para no alertarla.
          </p>
          <Controller
            control={control}
            name="settings.weightGainAlertKgPerDay"
            render={({ field }) => {
              const value = (field.value ?? {}) as Partial<Record<ManagementCategory, number>>;
              return (
                <div className="grid gap-4 sm:grid-cols-3">
                  {Object.values(MANAGEMENT_CATEGORY).map((category) => (
                    <NumberField
                      key={category}
                      label={`${CATEGORY_LABEL[category]}: ganancia mínima`}
                      unit="kg/día"
                      maxDecimals={3}
                      value={value[category] === undefined ? null : String(value[category])}
                      onChange={(next) => {
                        const updated = { ...value };
                        if (next === null || next === '') delete updated[category];
                        else updated[category] = Number(next);
                        field.onChange(updated);
                      }}
                    />
                  ))}
                </div>
              );
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SettingNumber
              control={control}
              name="weightLossAlertPercent"
              label="«Perdió peso» si baja más de"
              unit="%"
              hint="Respecto al pesaje anterior."
              error={errors.settings?.weightLossAlertPercent?.message}
            />
            <SettingNumber
              control={control}
              name="weightGainAnchorMaxDays"
              label="Pesaje anterior a la ventana de 90 días, a lo sumo"
              unit="días"
              hint="Con pesaje trimestral, el anterior completa la ventana."
              error={errors.settings?.weightGainAnchorMaxDays?.message}
            />
          </div>
        </fieldset>
        <Controller
          control={control}
          name="settings.rabiesRiskZone"
          render={({ field }) => (
            <SegmentedChoice<'SI' | 'NO'>
              label="¿Zona de riesgo de rabia silvestre?"
              options={[
                { value: 'SI', label: 'Sí' },
                { value: 'NO', label: 'No' },
              ]}
              value={field.value === undefined ? null : field.value ? 'SI' : 'NO'}
              onChange={(next) => {
                field.onChange(next === 'SI');
              }}
            />
          )}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-3 text-lg font-bold">Numeración de los animales</legend>
        <Controller
          control={control}
          name="settings.codeReuse"
          render={({ field }) => (
            <SegmentedChoice<'SI' | 'NO'>
              label="¿Reutilizar números de animales que salen de la finca?"
              hint="Si vende el 5, el próximo animal puede ser el 5. El historial de cada uno no se mezcla."
              options={[
                { value: 'SI', label: 'Sí' },
                { value: 'NO', label: 'No' },
              ]}
              value={field.value === undefined ? null : field.value ? 'SI' : 'NO'}
              onChange={(next) => {
                field.onChange(next === 'SI');
              }}
            />
          )}
        />
        <Controller
          control={control}
          name="settings.codeSuggestion"
          render={({ field }) => (
            <SegmentedChoice<CodeSuggestion>
              label="Número sugerido para un animal nuevo"
              options={[
                { value: 'PATTERN', label: 'Código de las crías' },
                { value: 'LOWEST_FREE', label: 'Menor número libre' },
              ]}
              value={field.value ?? null}
              onChange={field.onChange}
            />
          )}
        />
        {codeSuggestion === 'PATTERN' ? (
          <TextField
            label="Código de las crías"
            hint="{YY} año con dos cifras, {YYYY} año completo, {NNN} consecutivo con ceros, {N} sin ceros. Por ejemplo, {YY}-{NNN} da 26-045."
            error={errors.settings?.calfCodePattern?.message}
            {...register('settings.calfCodePattern')}
          />
        ) : null}
      </fieldset>

      {recalculates ? (
        <AlertBanner
          tone="aviso"
          title="Esto cambia las cuentas del hato"
          description="Al guardar cambian de inmediato las categorías calculadas (terneros, novillas, levante) y las fechas de parto que se estimen de ahora en adelante. Las fechas ya estimadas no cambian."
        />
      ) : null}

      <div role="status">
        {saved ? (
          <p className="flex items-center gap-2 font-bold text-potrero">
            <CircleCheck aria-hidden="true" className="size-5" />
            Parámetros guardados.
          </p>
        ) : null}
      </div>

      <FormActions
        submitLabel="Guardar parámetros"
        submitting={isSubmitting}
        error={formError}
        conflict={conflict}
        onReload={onReload}
      />
    </form>
  );
}

function SettingNumber({
  control,
  name,
  label,
  unit,
  hint,
  error,
}: {
  control: Control<Values>;
  name: NumericSetting;
  label: string;
  unit: string;
  hint?: string;
  error: string | undefined;
}) {
  return (
    <Controller
      control={control}
      name={`settings.${name}`}
      render={({ field }) => (
        <NumberField
          label={label}
          unit={unit}
          value={field.value === undefined ? null : String(field.value)}
          onChange={(next) => {
            field.onChange(next === null ? undefined : Number(next));
          }}
          onBlur={field.onBlur}
          hint={hint}
          error={error}
        />
      )}
    />
  );
}

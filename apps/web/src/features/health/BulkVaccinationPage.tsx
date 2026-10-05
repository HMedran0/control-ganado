import {
  MANAGEMENT_CATEGORY,
  bulkVaccinationSchema,
  formatDate,
  type BulkVaccinationInput,
  type BulkVaccinationResult,
  type ManagementCategory,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { useToday } from '../../lib/clock';
import { CATEGORY_LABEL } from '../animals/labels';
import { SaveError } from '../reproduction/form-kit';
import { useCatalog } from '../settings/api';
import { useBulkVaccination } from './api';
import { BULK_SKIP_LABEL } from './labels';

type Scope = 'ALL' | 'LOT' | 'CATEGORY';

const optional = (text: string) => (text.trim() === '' ? undefined : text.trim());

/**
 * Vacunación por lote (SAN-03, 06 §5.8). Paso 1: vacuna, fecha, dosis, responsable. Paso 2: a
 * quiénes (todos los activos, un lote o una categoría); se revisa sin guardar y se ven los que se
 * vacunan, que se pueden desmarcar (CA3), y los que se omiten con su motivo. Paso 3: «Registrar N
 * vacunaciones», todo en una transacción y una sola vez aunque se repita el clic (ADR-012).
 */
export function BulkVaccinationPage({ vaccineId }: { vaccineId?: string | undefined }) {
  const today = useToday();
  const vaccines = useCatalog('vaccines');
  const lots = useCatalog('lots');
  const { preview, confirm } = useBulkVaccination();
  const [form, setForm] = useState({
    vaccineId: vaccineId ?? '',
    date: today,
    dose: '',
    responsible: '',
    batchNumber: '',
    ruvNumber: '',
  });
  const [scope, setScope] = useState<Scope>('ALL');
  const [lotId, setLotId] = useState('');
  const [category, setCategory] = useState<ManagementCategory | ''>('');
  const [plan, setPlan] = useState<BulkVaccinationResult | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<BulkVaccinationResult | null>(null);

  const vaccine = vaccines.data?.items.find((item) => item.id === form.vaccineId);

  const body = (): BulkVaccinationInput | null => {
    const filter = scope === 'LOT' ? { lotId } : scope === 'CATEGORY' ? { category } : {};
    const parsed = bulkVaccinationSchema.safeParse({
      vaccineId: form.vaccineId === '' ? undefined : form.vaccineId,
      date: form.date,
      dose: optional(form.dose),
      responsible: optional(form.responsible),
      batchNumber: optional(form.batchNumber),
      ruvNumber: optional(form.ruvNumber),
      filter,
      ...(excluded.size === 0 ? {} : { excludeIds: [...excluded] }),
    });
    const problems: Record<string, string> = {};
    if (scope === 'LOT' && lotId === '') problems.lotId = 'Elige el lote.';
    if (scope === 'CATEGORY' && category === '') problems.category = 'Elige la categoría.';
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        problems[key] ??= key === 'vaccineId' ? 'Elige la vacuna.' : issue.message;
      }
    }
    setErrors(problems);
    return parsed.success && Object.keys(problems).length === 0 ? parsed.data : null;
  };

  const review = async () => {
    setDone(null);
    setExcluded(new Set());
    const request = body();
    if (request === null) return;
    try {
      setPlan(await preview.mutateAsync({ ...request, excludeIds: undefined }));
    } catch {
      setPlan(null);
    }
  };

  const toApply = plan?.toApply.filter((animal) => !excluded.has(animal.id)) ?? [];

  if (done !== null) {
    return (
      <>
        <PageHeader title="Vacunación por lote" />
        <div className="flex max-w-xl flex-col gap-4">
          <p role="status" className="rounded-control bg-potrero-claro p-3 font-bold text-potrero">
            {done.created === 1
              ? '1 vacunación registrada'
              : `${done.created} vacunaciones registradas`}
            {done.skipped.length === 0 ? '.' : ` · ${done.skipped.length} animales omitidos.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setDone(null);
                setPlan(null);
              }}
            >
              Vacunar otro grupo
            </Button>
            <Link
              to="/alerts"
              className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
            >
              Ver las alertas
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Vacunación por lote" />
      <div className="flex max-w-2xl flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h2 className="text-md font-bold">1. Vacuna</h2>
          <SelectField
            label="Vacuna"
            value={form.vaccineId}
            error={errors.vaccineId}
            onChange={(event) => {
              const next = vaccines.data?.items.find((item) => item.id === event.target.value);
              setForm({ ...form, vaccineId: event.target.value, dose: next?.defaultDose ?? '' });
              setPlan(null);
            }}
          >
            <option value="">Elige la vacuna</option>
            {vaccines.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.disease}
              </option>
            ))}
          </SelectField>
          <DateQuickPick
            label="Fecha de aplicación"
            value={form.date}
            today={today}
            onChange={(date) => {
              setForm({ ...form, date });
              setPlan(null);
            }}
          />
          {errors.date === undefined ? null : <p className="text-alerta-intenso">{errors.date}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Dosis"
              value={form.dose}
              onChange={(event) => {
                setForm({ ...form, dose: event.target.value });
              }}
            />
            <TextField
              label="Responsable"
              hint="Opcional."
              value={form.responsible}
              onChange={(event) => {
                setForm({ ...form, responsible: event.target.value });
              }}
            />
            <TextField
              label="Lote o serie del biológico"
              hint="Opcional."
              value={form.batchNumber}
              onChange={(event) => {
                setForm({ ...form, batchNumber: event.target.value });
              }}
            />
            {vaccine?.scheduleType === 'OFFICIAL_CYCLE' ? (
              <TextField
                label="Número de RUV"
                hint="Opcional."
                value={form.ruvNumber}
                onChange={(event) => {
                  setForm({ ...form, ruvNumber: event.target.value });
                }}
              />
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-md font-bold">2. Animales</h2>
          <SegmentedChoice
            label="A quiénes"
            options={[
              { value: 'ALL', label: 'Todos' },
              { value: 'LOT', label: 'Un lote' },
              { value: 'CATEGORY', label: 'Una categoría' },
            ]}
            value={scope}
            onChange={(value) => {
              setScope(value);
              setPlan(null);
            }}
          />
          {scope === 'LOT' ? (
            <SelectField
              label="Lote"
              value={lotId}
              error={errors.lotId}
              onChange={(event) => {
                setLotId(event.target.value);
                setPlan(null);
              }}
            >
              <option value="">Elige el lote</option>
              {lots.data?.items.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {scope === 'CATEGORY' ? (
            <SelectField
              label="Categoría"
              value={category}
              error={errors.category}
              onChange={(event) => {
                setCategory(event.target.value as ManagementCategory);
                setPlan(null);
              }}
            >
              <option value="">Elige la categoría</option>
              {Object.values(MANAGEMENT_CATEGORY).map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABEL[value]}
                </option>
              ))}
            </SelectField>
          ) : null}
          <Button
            variant="secondary"
            disabled={preview.isPending}
            onClick={() => {
              void review();
            }}
          >
            {preview.isPending ? 'Revisando…' : 'Revisar la selección'}
          </Button>
          <SaveError error={preview.error} damId="" />
        </section>

        {plan === null ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="plan-title">
            <h2 id="plan-title" className="text-md font-bold">
              3. Confirmar
            </h2>
            {plan.cycle === null ? null : (
              <p className="text-texto-2">Quedan en el ciclo oficial {plan.cycle.name}.</p>
            )}
            {plan.skipped.length === 0 ? null : (
              <div className="flex flex-col gap-2 rounded-control border-2 border-cerca p-3">
                <p className="font-bold">
                  {plan.skipped.length === 1
                    ? 'Se omite 1 animal'
                    : `Se omiten ${plan.skipped.length} animales`}
                </p>
                <ul className="flex flex-col gap-1">
                  {plan.skipped.map((item) => (
                    <li key={item.animal.id}>
                      <strong>{item.animal.code}</strong>
                      {item.animal.name === null ? '' : ` · ${item.animal.name}`}:{' '}
                      {BULK_SKIP_LABEL[item.reason]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.warnings.length === 0 ? null : (
              <p className="rounded-control bg-aviso-claro p-3 text-aviso-intenso">
                Fuera de la edad recomendada:{' '}
                {plan.warnings.map((item) => item.animal.code).join(', ')}. Puedes desmarcarlos.
              </p>
            )}
            {plan.toApply.length === 0 ? (
              <p className="text-texto-2">Ningún animal de la selección necesita esta vacuna.</p>
            ) : (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-2 font-bold">Se vacunan (desmarca los que no)</legend>
                {plan.toApply.map((animal) => (
                  <Checkbox
                    key={animal.id}
                    label={animal.name === null ? animal.code : `${animal.code} · ${animal.name}`}
                    checked={!excluded.has(animal.id)}
                    onChange={(event) => {
                      const next = new Set(excluded);
                      if (event.target.checked) next.delete(animal.id);
                      else next.add(animal.id);
                      setExcluded(next);
                    }}
                  />
                ))}
              </fieldset>
            )}
            <p className="font-bold">
              Vas a registrar {vaccine?.name ?? 'la vacuna'} a {toApply.length}{' '}
              {toApply.length === 1 ? 'animal' : 'animales'} el {formatDate(form.date)}.
            </p>
            <SaveError error={confirm.error} damId="" />
            <Button
              block
              disabled={toApply.length === 0 || confirm.isPending}
              onClick={() => {
                const request = body();
                if (request === null) return;
                void confirm.mutateAsync(request).then(setDone, () => undefined);
              }}
            >
              {confirm.isPending
                ? 'Guardando…'
                : toApply.length === 1
                  ? 'Registrar 1 vacunación'
                  : `Registrar ${toApply.length} vacunaciones`}
            </Button>
          </section>
        )}
      </div>
    </>
  );
}

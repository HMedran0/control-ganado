import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatDate,
  updatePregnancySchema,
  voidPregnancySchema,
  type AnimalDetail,
  type AnimalRef,
  type IsoDate,
  type PregnancyView,
  type UpdatePregnancyInput,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { DateQuickPick } from '../../components/ui/DateQuickPick';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { calvingText } from '../animals/list/AnimalCells';
import { usePregnancyActions, useUpdatePregnancy } from './api';
import { SaveError, schemaResolver } from './form-kit';
import { CALVING_TYPE_LABEL, OUTCOME_LABEL, SERVICE_METHOD_LABEL, calvesText } from './labels';

const LINK =
  'inline-flex min-h-touch items-center justify-center rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-cerca pb-5 last:border-b-0">
      <h2 className="text-md font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-bold text-texto-2">{label}</dt>
          <dd className="-mt-2 sm:mt-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RefLink({ animal }: { animal: AnimalRef }) {
  return (
    <Link
      to="/animals/$id"
      params={{ id: animal.id }}
      className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
    >
      {animal.name === null ? animal.code : `${animal.code} · ${animal.name}`}
    </Link>
  );
}

/** «Toro T-1», «Pajilla 123», «—». */
function sireOf(pregnancy: PregnancyView): ReactNode {
  if (pregnancy.sire !== null) return <RefLink animal={pregnancy.sire} />;
  return pregnancy.sireExternalRef ?? '—';
}

/** «Servicio 12/01/2026 · Inseminación», con «aprox.» si la fecha es estimada. */
function serviceText(pregnancy: PregnancyView): string {
  const date = `${pregnancy.serviceDateEstimated ? 'aprox. ' : ''}${formatDate(pregnancy.serviceDate)}`;
  return pregnancy.method === 'UNKNOWN'
    ? `${date} · sin servicio conocido`
    : `${date} · ${SERVICE_METHOD_LABEL[pregnancy.method]}`;
}

/**
 * Pestaña Reproducción de la ficha (REP-05): preñez actual con días de gestación y parto
 * estimado, partos (con los anteriores al sistema, RN-29) e intervalo entre partos con servicio
 * real (RN-38), y todas las preñeces con su desenlace. Desde aquí se registran el servicio, la
 * palpación, el parto y el aborto; el ADMIN corrige fechas y anula.
 */
export function ReproductionTab({
  animal,
  today,
  isAdmin,
}: {
  animal: AnimalDetail;
  today: IsoDate;
  isAdmin: boolean;
}) {
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'void'; pregnancy: PregnancyView } | null>(
    null,
  );
  const reproduction = animal.reproduction;
  if (reproduction === null) return null;
  const open = reproduction.openPregnancy;
  const active = animal.status === 'ACTIVE';
  const interval = reproduction.calvingInterval;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Preñez actual">
        {open === null ? (
          <p className="text-texto-2">No tiene una preñez abierta.</p>
        ) : (
          <Facts
            items={[
              ['Servicio', serviceText(open)],
              ['Toro', sireOf(open)],
              [
                'Diagnóstico',
                open.confirmedAt === null
                  ? 'Sin palpar todavía'
                  : `Preñez confirmada el ${formatDate(open.confirmedAt)}${open.diagnosisResponsible === null ? '' : ` · ${open.diagnosisResponsible}`}`,
              ],
              ...(open.diagnosisNotes === null
                ? []
                : [['Observaciones de la palpación', open.diagnosisNotes] as const]),
              ['Gestación', `${open.gestationDays ?? 0} días`],
              [
                'Parto estimado',
                <strong key="parto">
                  {calvingText(open.expectedCalvingDate, today)}
                  {open.expectedCalvingManual ? ' (corregido a mano)' : ''}
                </strong>,
              ],
            ]}
          />
        )}
        {active ? (
          <div className="flex flex-wrap gap-2">
            {open === null ? (
              <Link to="/animals/$id/service" params={{ id: animal.id }} className={LINK}>
                Registrar servicio
              </Link>
            ) : null}
            <Link to="/animals/$id/diagnosis" params={{ id: animal.id }} className={LINK}>
              Registrar palpación
            </Link>
            <Link to="/animals/$id/calving" params={{ id: animal.id }} className={LINK}>
              Registrar parto
            </Link>
            {open === null ? null : (
              <>
                <Link to="/animals/$id/abortion" params={{ id: animal.id }} className={LINK}>
                  Registrar aborto
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDialog({ kind: 'edit', pregnancy: open });
                  }}
                >
                  Corregir fechas
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Section>

      <Section title="Partos">
        <Facts
          items={[
            [
              'Partos',
              reproduction.importedPriorCalvings === 0
                ? String(reproduction.calvingCount)
                : `${reproduction.calvingCount} (${reproduction.importedPriorCalvings} ${reproduction.importedPriorCalvings === 1 ? 'anterior' : 'anteriores'} al sistema, sin fecha)`,
            ],
            [
              'Último parto',
              reproduction.lastCalvingDate === null
                ? '—'
                : formatDate(reproduction.lastCalvingDate),
            ],
            [
              'Intervalo entre partos',
              interval.lastDays === null
                ? 'Sin dato: hacen falta dos partos seguidos con fecha de servicio real.'
                : `${interval.lastDays} días el último${interval.averageDays === interval.lastDays ? '' : ` · promedio ${interval.averageDays ?? 0} días`}`,
            ],
          ]}
        />
      </Section>

      <Section title="Historial reproductivo">
        {reproduction.history.length === 0 ? (
          <p className="text-texto-2">Todavía no tiene servicios, partos ni abortos registrados.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {reproduction.history.map((pregnancy) => (
              <li
                key={pregnancy.id}
                className={`flex flex-col gap-1 rounded-control border-2 p-3 ${pregnancy.voided === null ? 'border-cerca' : 'border-dashed border-cerca text-texto-2'}`}
              >
                <p className="font-bold">
                  {pregnancy.voided === null ? OUTCOME_LABEL[pregnancy.outcome] : 'Anulada'}
                  {pregnancy.outcomeDate === null ? '' : ` · ${formatDate(pregnancy.outcomeDate)}`}
                  {pregnancy.calvingType === null
                    ? ''
                    : ` · ${CALVING_TYPE_LABEL[pregnancy.calvingType]}`}
                </p>
                <p>Servicio {serviceText(pregnancy)}</p>
                {pregnancy.calves.length === 0 && pregnancy.stillbornCount === 0 ? null : (
                  <p className="flex flex-wrap items-center gap-x-2">
                    {pregnancy.calves.length === 0 ? null : (
                      <>
                        <span>{calvesText(pregnancy.calves.length)}:</span>
                        {pregnancy.calves.map((calf) => (
                          <RefLink key={calf.id} animal={calf} />
                        ))}
                      </>
                    )}
                    {pregnancy.stillbornCount === 0 ? null : (
                      <span>
                        {pregnancy.stillbornCount === 1
                          ? '1 muerta al nacer'
                          : `${pregnancy.stillbornCount} muertas al nacer`}
                      </span>
                    )}
                  </p>
                )}
                {pregnancy.voided?.reason == null ? null : (
                  <p>Motivo de la anulación: {pregnancy.voided.reason}</p>
                )}
                {pregnancy.diagnosisNotes === null ? null : (
                  <p className="text-texto-2">Palpación: {pregnancy.diagnosisNotes}</p>
                )}
                {pregnancy.notes === null ? null : (
                  <p className="text-texto-2">{pregnancy.notes}</p>
                )}
                {isAdmin && pregnancy.voided === null ? (
                  <Button
                    variant="ghost"
                    className="self-start"
                    onClick={() => {
                      setDialog({ kind: 'void', pregnancy });
                    }}
                  >
                    Anular
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {dialog?.kind === 'edit' ? (
        <EditDatesDialog
          animal={animal}
          pregnancy={dialog.pregnancy}
          today={today}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'void' ? (
        <VoidDialog
          animal={animal}
          pregnancy={dialog.pregnancy}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

type EditValues = { serviceDate: string; expectedCalvingDate: string };

/**
 * Corrige el servicio o el parto estimado de la preñez abierta. Cambiar el servicio recalcula el
 * parto estimado (RN-04); escribir el parto estimado lo deja «corregido a mano», y los cambios de
 * gestación de la raza o de la finca ya no lo mueven.
 */
function EditDatesDialog({
  animal,
  pregnancy,
  today,
  onClose,
}: {
  animal: AnimalDetail;
  pregnancy: PregnancyView;
  today: IsoDate;
  onClose: () => void;
}) {
  const update = useUpdatePregnancy(animal.id);
  const initial: EditValues = {
    serviceDate: pregnancy.serviceDate,
    expectedCalvingDate: pregnancy.expectedCalvingDate,
  };
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues, unknown, UpdatePregnancyInput>({
    resolver: schemaResolver(updatePregnancySchema, (values) => ({
      version: pregnancy.version,
      ...(values.serviceDate === initial.serviceDate ? {} : { serviceDate: values.serviceDate }),
      ...(values.expectedCalvingDate === initial.expectedCalvingDate
        ? {}
        : { expectedCalvingDate: values.expectedCalvingDate }),
    })),
    defaultValues: initial,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Corregir fechas de la preñez"
      description="Si cambias el servicio, el parto estimado se recalcula con la gestación de la raza. Si escribes el parto estimado, queda corregido a mano."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (body) => {
            try {
              await update.mutateAsync({ id: pregnancy.id, body });
              onClose();
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
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
          name="expectedCalvingDate"
          render={({ field }) => (
            <DateQuickPick
              label="Parto estimado"
              value={field.value as IsoDate}
              onChange={field.onChange}
              today={today}
              min={pregnancy.serviceDate}
              max={'2100-12-31' as IsoDate}
            />
          )}
        />
        {errors.root?.message === undefined ? null : (
          <p className="text-alerta-intenso">{errors.root.message}</p>
        )}
        <SaveError error={update.error} damId={animal.id} />
        <Button type="submit" block disabled={isSubmitting || update.isPending}>
          {update.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </form>
    </Dialog>
  );
}

/**
 * Anula una preñez registrada por error (RN-11, solo ADMIN). Un parto con crías que siguen en la
 * finca no se anula: la API pide archivarlas primero y el mensaje lo dice.
 */
function VoidDialog({
  animal,
  pregnancy,
  onClose,
}: {
  animal: AnimalDetail;
  pregnancy: PregnancyView;
  onClose: () => void;
}) {
  const { void: voidPregnancy } = usePregnancyActions(animal.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(voidPregnancySchema), defaultValues: { reason: '' } });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Anular registro reproductivo"
      description={`${OUTCOME_LABEL[pregnancy.outcome]} con servicio del ${formatDate(pregnancy.serviceDate)}. Deja de contar, pero queda en el historial con el motivo.`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (body) => {
            try {
              await voidPregnancy.mutateAsync({ id: pregnancy.id, body });
              onClose();
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
        <TextAreaField label="Motivo" error={errors.reason?.message} {...register('reason')} />
        <SaveError error={voidPregnancy.error} damId={animal.id} />
        <Button type="submit" block disabled={isSubmitting || voidPregnancy.isPending}>
          {voidPregnancy.isPending ? 'Anulando…' : 'Anular'}
        </Button>
      </form>
    </Dialog>
  );
}

import {
  formatCop,
  formatDate,
  type AnimalDetail,
  type IsoDate,
  type TreatmentView,
  type VaccinationView,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import { Button } from '../../components/ui/Button';
import { Tag, type TagTone } from '../../components/ui/Tag';
import { withdrawalText } from '../animals/detail/banners';
import { useAnimalTreatments, useAnimalVaccinations, useVoidHealthEvent } from './api';
import { VACCINE_STATUS_LABEL } from './labels';
import { VoidEventDialog } from './VoidEventDialog';

const LINK =
  'inline-flex min-h-touch items-center justify-center rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro';

const STATUS_TONE: Readonly<Record<string, TagTone>> = {
  OVERDUE: 'alerta',
  PENDING: 'aviso',
  UPCOMING: 'aviso',
  UP_TO_DATE: 'potrero',
  NOT_APPLICABLE: 'neutro',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-cerca pb-5 last:border-b-0">
      <h2 className="text-md font-bold">{title}</h2>
      {children}
    </section>
  );
}

type Voiding =
  | { readonly kind: 'vaccinations'; readonly item: VaccinationView }
  | { readonly kind: 'treatments'; readonly item: TreatmentView };

/**
 * Pestaña Sanidad de la ficha (ANI-07, SAN-02 a SAN-05): el estado de cada vacuna con la acción
 * que lo resuelve (SAN-04 CA3), el retiro vigente («Carne hasta X · Leche hasta Y»), las
 * vacunaciones y los tratamientos. ADMIN y VET anulan; las anuladas quedan con borde punteado y
 * su motivo.
 */
export function HealthTab({
  animal,
  today,
  canVoid,
  isAdmin,
}: {
  animal: AnimalDetail;
  today: IsoDate;
  canVoid: boolean;
  isAdmin: boolean;
}) {
  const vaccinations = useAnimalVaccinations(animal.id);
  const treatments = useAnimalTreatments(animal.id);
  const voidEvent = useVoidHealthEvent(animal.id);
  const [voiding, setVoiding] = useState<Voiding | null>(null);
  const active = animal.status === 'ACTIVE';
  const inWithdrawal = animal.alerts.includes('withdrawal');

  return (
    <div className="flex flex-col gap-5">
      <Section title="Vacunas">
        {animal.vaccines.length === 0 ? (
          <p className="text-texto-2">
            {active
              ? 'La finca no tiene vacunas con programación en el catálogo.'
              : 'Un animal que salió de la finca no tiene vacunas pendientes.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {animal.vaccines.map((vaccine) => (
              <li
                key={vaccine.vaccineId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border-2 border-cerca p-3"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-bold">{vaccine.name}</p>
                  <p className="text-texto-2">
                    {vaccine.lastAppliedOn === null
                      ? 'Sin aplicación registrada'
                      : `Última: ${formatDate(vaccine.lastAppliedOn)}`}
                    {vaccine.dueOn === null || vaccine.status === 'UP_TO_DATE'
                      ? ''
                      : ` · fecha límite ${formatDate(vaccine.dueOn)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={STATUS_TONE[vaccine.status] ?? 'neutro'}>
                    {VACCINE_STATUS_LABEL[vaccine.status]}
                  </Tag>
                  {active &&
                  (vaccine.status === 'OVERDUE' ||
                    vaccine.status === 'PENDING' ||
                    vaccine.status === 'UPCOMING') ? (
                    <Link
                      to="/animals/$id/vaccination"
                      params={{ id: animal.id }}
                      search={{ vaccineId: vaccine.vaccineId }}
                      className={LINK}
                    >
                      Registrar {vaccine.name}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {active ? (
          <div className="flex flex-wrap gap-2">
            <Link to="/animals/$id/vaccination" params={{ id: animal.id }} className={LINK}>
              Registrar vacuna
            </Link>
            <Link to="/animals/$id/treatment" params={{ id: animal.id }} className={LINK}>
              Registrar tratamiento
            </Link>
          </div>
        ) : null}
      </Section>

      <Section title="Retiro de medicamentos">
        <p className={inWithdrawal ? 'font-bold text-aviso-intenso' : 'text-texto-2'}>
          {inWithdrawal
            ? withdrawalText(animal.withdrawals, today)
            : 'No tiene retiro vigente: se puede vender o sacrificar.'}
        </p>
      </Section>

      <Section title="Vacunaciones">
        {vaccinations.isPending ? (
          <p className="text-texto-2">Cargando…</p>
        ) : (vaccinations.data?.items.length ?? 0) === 0 ? (
          <p className="text-texto-2">Todavía no tiene vacunaciones registradas.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {vaccinations.data?.items.map((item) => (
              <EventCard
                key={item.id}
                voided={item.voided}
                title={`${item.vaccine.name} · ${formatDate(item.appliedOn)}`}
                lines={[
                  [item.dose, item.cycle === null ? null : `Ciclo ${item.cycle.name}`]
                    .filter(Boolean)
                    .join(' · '),
                  item.ruvNumber === null ? '' : `RUV ${item.ruvNumber}`,
                  item.nextDueOn === null ? '' : `Próxima: ${formatDate(item.nextDueOn)}`,
                  item.responsible ?? '',
                ]}
                onVoid={
                  canVoid && item.voided === null
                    ? () => {
                        setVoiding({ kind: 'vaccinations', item });
                      }
                    : undefined
                }
              />
            ))}
          </ol>
        )}
      </Section>

      <Section title="Tratamientos">
        {treatments.isPending ? (
          <p className="text-texto-2">Cargando…</p>
        ) : (treatments.data?.items.length ?? 0) === 0 ? (
          <p className="text-texto-2">Todavía no tiene tratamientos registrados.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {treatments.data?.items.map((item) => (
              <EventCard
                key={item.id}
                voided={item.voided}
                title={`${item.medication} · ${formatDate(item.startedOn)}`}
                lines={[
                  item.reason,
                  [item.dose, `${item.durationDays} ${item.durationDays === 1 ? 'día' : 'días'}`]
                    .filter(Boolean)
                    .join(' · '),
                  [
                    item.meatWithdrawalUntil === null
                      ? null
                      : `Carne hasta ${formatDate(item.meatWithdrawalUntil)}`,
                    item.milkWithdrawalUntil === null
                      ? null
                      : `Leche hasta ${formatDate(item.milkWithdrawalUntil)}`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  isAdmin && item.cost != null ? `Costo ${formatCop(item.cost)}` : '',
                ]}
                onVoid={
                  canVoid && item.voided === null
                    ? () => {
                        setVoiding({ kind: 'treatments', item });
                      }
                    : undefined
                }
              />
            ))}
          </ol>
        )}
      </Section>

      {voiding === null ? null : (
        <VoidEventDialog
          title={voiding.kind === 'vaccinations' ? 'Anular vacunación' : 'Anular tratamiento'}
          description={
            voiding.kind === 'vaccinations'
              ? `${voiding.item.vaccine.name} del ${formatDate(voiding.item.appliedOn)}. Deja de contar para las alertas, pero queda en el historial.`
              : `${voiding.item.medication} del ${formatDate(voiding.item.startedOn)}. Su retiro y su costo dejan de contar.`
          }
          animalId={animal.id}
          error={voidEvent.error}
          pending={voidEvent.isPending}
          onVoid={(body) =>
            voidEvent.mutateAsync({ kind: voiding.kind, id: voiding.item.id, body })
          }
          onClose={() => {
            setVoiding(null);
            voidEvent.reset();
          }}
        />
      )}
    </div>
  );
}

function EventCard({
  title,
  lines,
  voided,
  onVoid,
}: {
  title: string;
  lines: readonly string[];
  voided: { at: string; reason: string | null } | null;
  onVoid: (() => void) | undefined;
}) {
  return (
    <li
      className={`flex flex-col gap-1 rounded-control border-2 p-3 ${voided === null ? 'border-cerca' : 'border-dashed border-cerca text-texto-2'}`}
    >
      <p className="font-bold">
        {voided === null ? '' : 'Anulada · '}
        {title}
      </p>
      {lines
        .filter((line) => line !== '')
        .map((line) => (
          <p key={line}>{line}</p>
        ))}
      {voided?.reason == null ? null : <p>Motivo de la anulación: {voided.reason}</p>}
      {onVoid === undefined ? null : (
        <Button variant="ghost" className="self-start" onClick={onVoid}>
          Anular
        </Button>
      )}
    </li>
  );
}

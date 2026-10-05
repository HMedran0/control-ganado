import {
  ALERT_GROUPS,
  ALERT_LABEL,
  formatDate,
  formatDecimalEsCo,
  type AlertItem,
  type AnimalAlert,
  type IsoDate,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import type { ReactNode } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Chapeta } from '../../components/ui/Chapeta';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { SelectField } from '../../components/ui/SelectField';
import { isApiError } from '../../lib/api/errors';
import { useToday } from '../../lib/clock';
import { gainText, relativeDays, withdrawalText } from '../animals/detail/banners';
import { CATEGORY_LABEL } from '../animals/labels';
import { VACCINE_STATUS_LABEL } from '../health/labels';
import { useCatalog } from '../settings/api';
import { useAlerts } from './api';

const ACTION =
  'inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4';

/** Filtros de la página, como van en la URL. */
export type AlertsSearch = { readonly types?: string; readonly lotId?: string };

/**
 * Alertas (M6; 06 §4): reproducción, vacunas, retiros y pesos de los animales activos, con el
 * conteo de cada tipo, filtros por tipo y por lote en la URL, y en cada fila lo que pasa y la
 * acción que lo resuelve. Los conteos y la lista salen del mismo SQL que el filtro de alertas del
 * listado (ADR-009).
 */
export function AlertsPage({
  search,
  onSearch,
}: {
  search: AlertsSearch;
  onSearch: (next: AlertsSearch) => void;
}) {
  const today = useToday();
  const lots = useCatalog('lots');
  const selected = new Set(
    (search.types ?? '').split(',').filter((value) => value !== ''),
  ) as Set<AnimalAlert>;
  const query = new URLSearchParams({
    ...(search.types === undefined ? {} : { types: search.types }),
    ...(search.lotId === undefined ? {} : { lotId: search.lotId }),
  }).toString();
  const alerts = useAlerts(query);
  const first = alerts.data?.pages[0];
  const items = alerts.data?.pages.flatMap((page) => page.items) ?? [];

  const toggle = (type: AnimalAlert) => {
    const next = new Set(selected);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onSearch({ ...search, types: next.size === 0 ? undefined : [...next].join(',') });
  };

  return (
    <>
      <PageHeader title="Alertas" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          {ALERT_GROUPS.map((group) => (
            <div
              key={group.key}
              role="group"
              aria-label={group.label}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="w-28 font-bold text-texto-2">{group.label}</span>
              {group.types.map((type) => {
                const count = first?.counts[type] ?? 0;
                const pressed = selected.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => {
                      toggle(type);
                    }}
                    className={`inline-flex min-h-touch items-center gap-2 rounded-control border-2 px-3 font-bold ${
                      pressed
                        ? 'border-potrero bg-potrero text-superficie'
                        : 'border-cerca bg-superficie text-monte hover:border-potrero'
                    }`}
                  >
                    {ALERT_LABEL[type]}
                    <span className="font-display text-md">{count}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <SelectField
                label="Lote"
                value={search.lotId ?? ''}
                onChange={(event) => {
                  onSearch({
                    ...search,
                    lotId: event.target.value === '' ? undefined : event.target.value,
                  });
                }}
              >
                <option value="">Todos los lotes</option>
                {lots.data?.items.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.name}
                  </option>
                ))}
              </SelectField>
            </div>
            {selected.size === 0 && search.lotId === undefined ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  onSearch({});
                }}
              >
                Quitar los filtros
              </Button>
            )}
          </div>
        </div>

        <p role="status" className="font-bold">
          {first === undefined
            ? ''
            : first.total === 1
              ? '1 animal con alertas'
              : `${first.total} animales con alertas`}
        </p>
        {alerts.isError ? (
          <FormError
            message={
              isApiError(alerts.error) ? alerts.error.detail : 'No pudimos cargar las alertas.'
            }
          />
        ) : null}
        {alerts.isPending ? <p className="text-texto-2">Cargando…</p> : null}
        {first !== undefined && items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Sin alertas por ahora"
            description="Aquí vas a ver las vacunas vencidas, los partos próximos, las servidas sin diagnóstico, los animales en retiro y los que ganan o pierden peso."
          />
        ) : null}
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <AlertRow key={item.id} item={item} selected={selected} today={today} />
          ))}
        </ul>
        {alerts.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-start"
            disabled={alerts.isFetchingNextPage}
            onClick={() => {
              void alerts.fetchNextPage();
            }}
          >
            {alerts.isFetchingNextPage ? 'Cargando…' : 'Mostrar más'}
          </Button>
        ) : null}
      </div>
    </>
  );
}

function AlertRow({
  item,
  selected,
  today,
}: {
  item: AlertItem;
  selected: ReadonlySet<AnimalAlert>;
  today: IsoDate;
}) {
  const shown = item.alerts.filter((alert) => selected.size === 0 || selected.has(alert));
  return (
    <li className="flex gap-4 rounded-panel border-2 border-cerca bg-superficie p-4">
      <Chapeta code={item.code} size="s" />
      <div className="flex min-w-0 flex-col gap-2">
        <Link
          to="/animals/$id"
          params={{ id: item.id }}
          className="text-md font-bold text-potrero underline underline-offset-4"
        >
          {item.name === null ? item.code : `${item.code} · ${item.name}`}
        </Link>
        <p className="text-texto-2">
          {CATEGORY_LABEL[item.category]}
          {item.lot === null ? '' : ` · Lote ${item.lot.name}`}
        </p>
        <ul className="flex flex-col gap-2">
          {shown.map((alert) => (
            <li key={alert} className="flex flex-col gap-0.5">
              {alertDetail(alert, item, today)}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/** Qué pasa con cada alerta de la fila y la acción que la resuelve (SAN-04 CA3). */
function alertDetail(alert: AnimalAlert, item: AlertItem, today: IsoDate): ReactNode {
  const line = (text: string, action?: ReactNode) => (
    <>
      <span>
        <strong>{ALERT_LABEL[alert]}</strong>
        {text === '' ? '' : `: ${text}`}
      </span>
      {action}
    </>
  );
  switch (alert) {
    case 'vaccine_overdue':
    case 'vaccine_due': {
      const vaccines = item.vaccines.filter((vaccine) =>
        alert === 'vaccine_overdue'
          ? vaccine.status === 'OVERDUE'
          : vaccine.status === 'PENDING' || vaccine.status === 'UPCOMING',
      );
      return (
        <>
          {vaccines.map((vaccine) => (
            <span key={vaccine.vaccineId} className="flex flex-wrap items-center gap-x-3">
              <span>
                <strong>{vaccine.name}</strong> {VACCINE_STATUS_LABEL[vaccine.status].toLowerCase()}
                {vaccine.dueOn === null ? '' : ` (${formatDate(vaccine.dueOn)})`}
              </span>
              <Link
                to="/animals/$id/vaccination"
                params={{ id: item.id }}
                search={{ vaccineId: vaccine.vaccineId }}
                className={ACTION}
              >
                Registrar vacuna
              </Link>
            </span>
          ))}
        </>
      );
    }
    case 'calving_soon':
    case 'calving_overdue':
      return line(
        item.pregnancy === null
          ? ''
          : `parto estimado el ${formatDate(item.pregnancy.expectedCalvingDate)} (${relativeDays(item.pregnancy.expectedCalvingDate, today)})`,
        <Link to="/animals/$id/calving" params={{ id: item.id }} className={ACTION}>
          Registrar parto
        </Link>,
      );
    case 'unconfirmed_service':
      return line(
        item.pregnancy === null
          ? ''
          : `servida el ${formatDate(item.pregnancy.serviceDate)} (${relativeDays(item.pregnancy.serviceDate, today)})`,
        <Link to="/animals/$id/diagnosis" params={{ id: item.id }} className={ACTION}>
          Registrar palpación
        </Link>,
      );
    case 'withdrawal':
      return line(withdrawalText(item.withdrawals, today));
    case 'low_gain':
      return line(
        item.weight?.gains.last90Days == null
          ? ''
          : `${gainText(item.weight.gains.last90Days)} en 90 días${
              item.weight.gainThreshold === null
                ? ''
                : ` (lo esperado: ${gainText(item.weight.gainThreshold)})`
            }`,
        <Link to="/animals/$id/weight" params={{ id: item.id }} className={ACTION}>
          Registrar peso
        </Link>,
      );
    case 'weight_loss':
      return line(
        item.weight?.lossPercent == null
          ? ''
          : `bajó ${formatDecimalEsCo(String(item.weight.lossPercent), 1, true)} % desde el pesaje anterior`,
        <Link to="/animals/$id/weight" params={{ id: item.id }} className={ACTION}>
          Registrar peso
        </Link>,
      );
  }
}

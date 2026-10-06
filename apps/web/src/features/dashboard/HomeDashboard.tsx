import {
  ALERT_GROUPS,
  ALERT_LABEL,
  DASHBOARD_QUESTION,
  SEX,
  daysBetween,
  formatCop,
  formatDate,
  formatDecimalEsCo,
  formatWeight,
  groupThousands,
  sortAlertGroups,
  type DashboardQuestion,
  type DashboardResponse,
  type IsoDate,
  type MoneyString,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { AlertBanner } from '../../components/ui/AlertBanner';
import { QuestionRow } from '../../components/ui/QuestionRow';
import { CALVING_INTERVAL_BUCKET_LABEL, PRODUCTION_SYSTEM_LABEL } from './labels';
import { useDashboard } from './api';

/** Entero con separador de miles es-CO: 1.089. */
const n = (value: number): string => groupThousands(String(value));
const plural = (count: number, one: string, many: string): string =>
  `${n(count)} ${count === 1 ? one : many}`;

/** «$ 36,8 M» para millones; por debajo, el monto completo (06 §5.1: «$812 M»). */
function compactCop(amount: MoneyString): string {
  const pesos = Number(amount);
  if (Math.abs(pesos) < 1_000_000) return formatCop(amount);
  return `$ ${formatDecimalEsCo((pesos / 1_000_000).toFixed(1), 1, true)} M`;
}

/** «21/10/2026, en 3 días» o «21/08/2026, hace 35 días». */
function whenText(date: IsoDate, today: IsoDate): string {
  const days = daysBetween(today, date);
  if (days === 0) return `${formatDate(date)}, hoy`;
  const unit = Math.abs(days) === 1 ? 'día' : 'días';
  return days > 0
    ? `${formatDate(date)}, en ${days} ${unit}`
    : `${formatDate(date)}, hace ${-days} ${unit}`;
}

/**
 * Inicio — «Preguntas del día» (RPT-01, 06 §5.1; M8a). Primero las preguntas propias del sistema
 * productivo de la finca (CFG-03), en su orden; después las comunes; a la derecha en escritorio
 * (debajo en el celular), las alertas por tipo, en el orden del sistema. Cada cifra abre el
 * listado o las Alertas con el filtro que la produce; las que son un promedio no tienen listado.
 * Las referencias de UPRA (2024) son solo texto de contexto: nunca colorean ni alertan.
 */
export function HomeDashboard() {
  const dashboard = useDashboard();
  if (dashboard.isError) {
    return (
      <AlertBanner
        tone="alerta"
        title="No pudimos cargar las preguntas del día"
        description="Revisa la conexión y vuelve a abrir Inicio."
      />
    );
  }
  if (dashboard.data === undefined) {
    return (
      <p role="status" className="text-texto-2">
        Cargando las preguntas del día…
      </p>
    );
  }
  return <Board data={dashboard.data} />;
}

function Board({ data }: { data: DashboardResponse }) {
  const own = data.questions.flatMap((question) => systemQuestion(question, data));
  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="flex flex-col gap-8">
        {own.length === 0 ? null : (
          <section aria-labelledby="preguntas-sistema">
            <h2 id="preguntas-sistema" className="text-lg font-bold">
              Para tu finca de {PRODUCTION_SYSTEM_LABEL[data.productionSystem].toLowerCase()}
            </h2>
            <ul className="divide-y-2 divide-cerca">{own}</ul>
          </section>
        )}
        <section aria-labelledby="preguntas-hato">
          <h2 id="preguntas-hato" className="text-lg font-bold">
            El hato
          </h2>
          <ul className="divide-y-2 divide-cerca lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0">
            {commonQuestions(data)}
          </ul>
        </section>
      </div>
      <AlertsPanel data={data} />
    </div>
  );
}

/** Las preguntas de RPT-01 que salen en todas las fincas. */
function commonQuestions(data: DashboardResponse): ReactNode[] {
  const { herd, reproduction, births, vaccines, forSale } = data;
  const next = reproduction.nextCalving;
  const calvingSummary = [
    next === null
      ? 'Ninguna en los próximos días'
      : `La próxima: ${next.code}, ${whenText(next.expectedCalvingDate, data.today)}`,
    reproduction.calvingOverdue > 0
      ? `${plural(reproduction.calvingOverdue, 'con el parto vencido', 'con el parto vencido')}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const forSaleSex =
    forSale.sex === SEX.MALE
      ? 'Machos, lo que vende la finca'
      : forSale.sex === SEX.FEMALE
        ? 'Hembras, lo que vende la finca'
        : 'Marcados «Disponible para venta»';
  const rows: ReactNode[] = [
    <li key="herd">
      <QuestionRow
        question="¿Cuántos animales hay?"
        summary={`${plural(herd.males, 'macho', 'machos')} · ${plural(herd.females, 'hembra', 'hembras')}`}
        value={n(herd.total)}
        to="/animals"
      />
    </li>,
    <li key="calves">
      <QuestionRow
        question="¿Cuántos terneros y terneras?"
        summary={`${plural(herd.calvesMale, 'ternero', 'terneros')} · ${plural(herd.calvesFemale, 'ternera', 'terneras')}`}
        value={n(herd.calvesMale + herd.calvesFemale)}
        to="/animals"
        search={{ category: 'CALF_MALE,CALF_FEMALE' }}
      />
    </li>,
    <li key="pregnant">
      <QuestionRow
        question="¿Cuántas están preñadas?"
        summary={`+ ${plural(reproduction.served, 'servida sin palpar', 'servidas sin palpar')}`}
        value={n(reproduction.pregnant)}
        to="/animals"
        search={{ tags: 'PREGNANT' }}
      />
    </li>,
    <li key="calving">
      <QuestionRow
        question="¿Cuáles paren pronto?"
        summary={calvingSummary}
        value={n(reproduction.calvingSoon)}
        tone={reproduction.calvingOverdue > 0 ? 'alerta' : 'normal'}
        to="/animals"
        search={{ alerts: 'calving_soon', sort: 'calving' }}
      />
    </li>,
    <li key="vaccines">
      <QuestionRow
        question="¿Qué falta vacunar?"
        summary={[
          `${plural(vaccines.overdue, 'vencida', 'vencidas')} · ${n(vaccines.due)} pendientes o próximas`,
          vaccines.currentCycle === null ? null : `Ciclo ${vaccines.currentCycle.name} en curso`,
        ]
          .filter((part) => part !== null)
          .join(' · ')}
        value={n(vaccines.pending)}
        tone={vaccines.overdue > 0 ? 'alerta' : 'normal'}
        to="/alerts"
        search={{ types: 'vaccine_overdue,vaccine_due' }}
      />
    </li>,
    <li key="births">
      <QuestionRow
        question="¿Cuántos nacieron este año?"
        summary={`${plural(births.males, 'macho', 'machos')} · ${plural(births.females, 'hembra', 'hembras')}`}
        value={n(births.live)}
        to="/reports/births"
      />
    </li>,
    <li key="forSale">
      <QuestionRow
        question="¿Cuáles están para venta?"
        summary={forSaleSex}
        value={n(forSale.count)}
        to="/animals"
        search={forSale.sex === null ? { forSale: true } : { forSale: true, sex: forSale.sex }}
      />
    </li>,
  ];
  if (data.investment !== undefined) {
    rows.push(
      <li key="investment">
        <QuestionRow
          question="¿Cuánto hay invertido?"
          summary="En los animales que están hoy en la finca"
          value={compactCop(data.investment)}
          to="/finance"
          search={{ tab: 'reporte' }}
        />
      </li>,
    );
  }
  return rows;
}

/** Filas de una pregunta propia del sistema; vacío si la sección no llegó. */
function systemQuestion(question: DashboardQuestion, data: DashboardResponse): ReactNode[] {
  switch (question) {
    case DASHBOARD_QUESTION.WEANING: {
      const weaning = data.weaning;
      if (weaning === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Cuántos terneros se destetan este mes?"
            summary={
              weaning.averageWeightKg === null
                ? 'Sin pesajes todavía'
                : `Pesan ${formatWeight(weaning.averageWeightKg, { maxDecimals: 1 })} en promedio (${plural(weaning.weighed, 'pesado', 'pesados')})`
            }
            value={n(weaning.count)}
            to="/animals"
            search={{ bornFrom: weaning.bornFrom, bornTo: weaning.bornTo }}
          />
          <Reference>
            UPRA (2024) reporta el destete hacia los 7 meses en doble propósito.
          </Reference>
        </li>,
      ];
    }
    case DASHBOARD_QUESTION.CALVING_INTERVAL: {
      const interval = data.calvingInterval;
      if (interval === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Cuál es el intervalo entre partos?"
            summary={
              interval.count === 0
                ? 'Todavía no hay dos partos seguidos con servicio conocido'
                : `Promedio de ${plural(interval.count, 'intervalo', 'intervalos')} de ${plural(interval.females, 'vaca', 'vacas')}`
            }
            value={interval.averageDays === null ? '—' : `${n(interval.averageDays)} d`}
          />
          {interval.count === 0 ? null : (
            <dl className="mb-2 grid grid-cols-[1fr_auto] gap-x-4 text-texto-2">
              {interval.distribution.map((item) => (
                <div key={item.bucket} className="contents">
                  <dt>{CALVING_INTERVAL_BUCKET_LABEL[item.bucket]}</dt>
                  <dd className="text-right tabular-nums">{n(item.count)}</dd>
                </div>
              ))}
            </dl>
          )}
          <Reference>
            UPRA (2024) reporta de 387 a 439 días en doble propósito en Colombia. Es contexto, no
            una meta de la finca. No cuentan los partos con fecha de servicio estimada.
          </Reference>
        </li>,
      ];
    }
    case DASHBOARD_QUESTION.DRY_COWS: {
      const dry = data.dryCows;
      if (dry === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Cuántas vacas están horras?"
            summary="Sin preñez ni cría al pie"
            value={n(dry.count)}
            to="/animals"
            search={{ tags: 'DRY' }}
          />
        </li>,
      ];
    }
    case DASHBOARD_QUESTION.MILK_WITHDRAWAL: {
      const milk = data.milkWithdrawal;
      if (milk === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Cuáles están en retiro de leche?"
            summary="Su leche no se puede vender todavía"
            value={n(milk.count)}
            tone={milk.count > 0 ? 'alerta' : 'normal'}
            to="/animals"
            search={{ milkWithdrawal: true }}
          />
        </li>,
      ];
    }
    case DASHBOARD_QUESTION.SALE_WEIGHT: {
      const sale = data.saleWeight;
      if (sale === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Cuáles alcanzan el peso de venta este mes?"
            summary={`Estimado con su ganancia, hasta el ${formatDate(sale.monthEnd)}`}
            value={n(sale.thisMonth)}
            to="/animals"
            search={{ saleWeight: 'this_month' }}
          />
        </li>,
        <li key="sale-reached">
          <QuestionRow
            question="¿Cuáles ya están en el peso de venta?"
            summary="Según su último pesaje"
            value={n(sale.reached)}
            to="/animals"
            search={{ saleWeight: 'reached' }}
          />
        </li>,
        ...(sale.likelyReached === 0
          ? []
          : [
              <li key="sale-likely">
                <QuestionRow
                  question="¿Cuáles posiblemente ya están en el peso?"
                  summary="Según su ganancia ya deberían estar en el peso: pésalos para confirmar"
                  value={n(sale.likelyReached)}
                  to="/animals"
                  search={{ saleWeight: 'likely_reached' }}
                />
              </li>,
            ]),
      ];
    }
    case DASHBOARD_QUESTION.LOW_GAIN_LOTS: {
      const lots = data.lotGains;
      if (lots === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Qué lotes ganan menos peso de lo esperado?"
            summary={
              lots.belowThreshold.length === 0
                ? 'Ninguno por debajo de la ganancia esperada'
                : 'Ganancia de los últimos 90 días frente a la esperada'
            }
            value={n(lots.belowThreshold.length)}
            tone={lots.belowThreshold.length > 0 ? 'alerta' : 'normal'}
            to="/alerts"
            search={{ types: 'low_gain' }}
          />
          {lots.belowThreshold.length === 0 ? null : (
            <ul className="mb-3 flex flex-col gap-1">
              {lots.belowThreshold.map((lot) => (
                <li key={lot.lotId}>
                  <Link
                    to="/alerts"
                    search={{ types: 'low_gain', lotId: lot.lotId }}
                    className="inline-flex min-h-touch items-center gap-1 font-bold text-potrero underline underline-offset-4"
                  >
                    {lot.name}: {kgPerDay(lot.averageGain)} (lo esperado:{' '}
                    {kgPerDay(lot.averageThreshold)}) ·{' '}
                    {plural(lot.lowGain, 'con ganancia baja', 'con ganancia baja')}
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>,
      ];
    }
    case DASHBOARD_QUESTION.DAYS_TO_SALE: {
      const days = data.daysToSale;
      if (days === undefined) return [];
      return [
        <li key={question}>
          <QuestionRow
            question="¿Cuántos días faltan en promedio para la venta?"
            summary={
              days.animals === 0
                ? 'Ningún animal tiene fecha estimada'
                : `Promedio de ${plural(days.animals, 'animal', 'animales')} con fecha estimada`
            }
            value={days.averageDays === null ? '—' : `${n(days.averageDays)} d`}
          />
        </li>,
      ];
    }
  }
}

function kgPerDay(value: number): string {
  return `${formatDecimalEsCo(value.toFixed(3), 3, true)} kg/día`;
}

/** Texto de contexto (UPRA, 2024): gris, pequeño, sin color de alerta. */
function Reference({ children }: { children: ReactNode }) {
  return <p className="pb-3 text-aux text-texto-2">{children}</p>;
}

/** Alertas activas por tipo, en el orden del sistema productivo (CFG-03 CA1). */
function AlertsPanel({ data }: { data: DashboardResponse }) {
  const groups = sortAlertGroups(ALERT_GROUPS, data.productionSystem);
  const total = Object.values(data.alerts).reduce((sum, count) => sum + count, 0);
  return (
    <aside
      aria-labelledby="alertas-inicio"
      className="rounded-panel border-2 border-cerca p-4 lg:sticky lg:top-4"
    >
      <h2 id="alertas-inicio" className="mb-2 text-lg font-bold">
        Alertas
      </h2>
      {total === 0 ? (
        <p className="text-texto-2">Sin alertas activas.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.key}>
              <h3 className="font-bold text-texto-2">{group.label}</h3>
              <ul>
                {group.types.map((type) => (
                  <li key={type}>
                    <Link
                      to="/alerts"
                      search={{ types: type }}
                      className="flex min-h-touch items-center justify-between gap-2 hover:bg-potrero-claro/40"
                    >
                      <span>{ALERT_LABEL[type]}</span>
                      <span
                        className={`font-cifras text-lg font-semibold tabular-nums ${data.alerts[type] > 0 ? 'text-monte' : 'text-texto-2'}`}
                      >
                        {n(data.alerts[type])}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/alerts"
        className="mt-3 inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
      >
        Ver todas las alertas
      </Link>
    </aside>
  );
}

import {
  daysBetween,
  formatDate,
  formatDecimalEsCo,
  type AnimalDetail,
  type IsoDate,
} from '@hato/shared';

import type { AlertTone } from '../../../components/ui/AlertBanner';

/**
 * Avisos de la ficha (ANI-07 CA1, 06 §5.3): qué pasa y cuándo, como `AlertBanner`.
 *
 * Cada aviso trae la acción que lo resuelve: registrar el parto o la palpación (M5), la vacuna o
 * el peso (M6, SAN-04 CA3). Sale de lo que ya calculó la API con las funciones de shared
 * (`vaccineStatus`, `animalAlerts`, `weightAlerts`); aquí solo se redacta.
 */
export type BannerAction =
  | { readonly kind: 'calving' }
  | { readonly kind: 'diagnosis' }
  | { readonly kind: 'vaccine'; readonly vaccineId: string }
  | { readonly kind: 'weight' };

export type Banner = {
  readonly key: string;
  readonly tone: AlertTone;
  readonly title: string;
  readonly description?: string;
  readonly action?: BannerAction;
};

/** «en 3 días», «hoy», «hace 6 días». */
export function relativeDays(date: IsoDate, today: IsoDate): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'hoy';
  const n = Math.abs(days);
  const unit = n === 1 ? 'día' : 'días';
  return days > 0 ? `en ${n} ${unit}` : `hace ${n} ${unit}`;
}

export function animalBanners(animal: AnimalDetail, today: IsoDate): Banner[] {
  if (animal.status !== 'ACTIVE') return [];
  const banners: Banner[] = [];

  for (const vaccine of animal.vaccines) {
    const due = vaccine.dueOn;
    if (vaccine.status === 'OVERDUE') {
      banners.push({
        key: `vaccine:${vaccine.vaccineId}`,
        tone: 'alerta',
        title:
          due === null
            ? `${vaccine.name} vencida`
            : `${vaccine.name} vencida ${relativeDays(due, today)}`,
        description:
          vaccine.reason === 'AFTER_AGE_WINDOW'
            ? 'Pasó la edad de aplicación sin registrarla.'
            : vaccine.reason === 'CLOSED_CYCLE'
              ? 'Faltó en el último ciclo oficial de vacunación.'
              : due === null
                ? 'El refuerzo ya pasó.'
                : `El refuerzo tocaba el ${formatDate(due)}.`,
        action: { kind: 'vaccine', vaccineId: vaccine.vaccineId },
      });
    } else if (vaccine.status === 'PENDING') {
      banners.push({
        key: `vaccine:${vaccine.vaccineId}`,
        tone: 'aviso',
        title: `${vaccine.name} pendiente`,
        description:
          due === null
            ? 'Todavía no tiene ninguna aplicación.'
            : vaccine.reason === 'CURRENT_CYCLE'
              ? `El ciclo oficial cierra el ${formatDate(due)}.`
              : `Aplícala antes del ${formatDate(due)}.`,
        action: { kind: 'vaccine', vaccineId: vaccine.vaccineId },
      });
    } else if (vaccine.status === 'UPCOMING' && due !== null) {
      banners.push({
        key: `vaccine:${vaccine.vaccineId}`,
        tone: 'aviso',
        title: `${vaccine.name}: refuerzo ${relativeDays(due, today)}`,
        description: `Le toca el ${formatDate(due)}.`,
        action: { kind: 'vaccine', vaccineId: vaccine.vaccineId },
      });
    }
  }

  const open = animal.reproduction?.openPregnancy ?? null;
  if (animal.alerts.includes('calving_soon') && animal.expectedCalvingDate !== null) {
    banners.push({
      key: 'calving',
      tone: 'info',
      title: `Parto estimado ${relativeDays(animal.expectedCalvingDate, today)}`,
      description: `Fecha estimada: ${formatDate(animal.expectedCalvingDate)}.`,
      action: { kind: 'calving' },
    });
  }
  if (animal.alerts.includes('calving_overdue') && open !== null) {
    banners.push({
      key: 'calving-overdue',
      tone: 'alerta',
      title: 'Pasó la fecha de parto: registra el parto o el aborto',
      action: { kind: 'calving' },
      description: `El parto estaba estimado para el ${formatDate(open.expectedCalvingDate)} (${relativeDays(open.expectedCalvingDate, today)}).`,
    });
  }
  if (animal.alerts.includes('unconfirmed_service') && open !== null) {
    banners.push({
      key: 'service',
      tone: 'aviso',
      title: `Servida ${relativeDays(open.serviceDate, today)} sin diagnóstico`,
      description: 'Conviene programar la palpación.',
      action: { kind: 'diagnosis' },
    });
  }
  if (animal.alerts.includes('withdrawal') && animal.withdrawalUntil !== null) {
    banners.push({
      key: 'withdrawal',
      tone: 'aviso',
      title: `En retiro hasta el ${formatDate(animal.withdrawalUntil)}`,
      description: withdrawalText(animal.withdrawals, today),
    });
  }
  const weight = animal.weight;
  if (animal.alerts.includes('low_gain') && weight?.gains.last90Days != null) {
    banners.push({
      key: 'low-gain',
      tone: 'aviso',
      title: `Ganancia baja: ${gainText(weight.gains.last90Days)} en los últimos 90 días`,
      description:
        weight.gainThreshold === null
          ? undefined
          : `Lo esperado para su categoría es al menos ${gainText(weight.gainThreshold)}.`,
      action: { kind: 'weight' },
    });
  }
  if (animal.alerts.includes('weight_loss') && weight?.lossPercent != null) {
    banners.push({
      key: 'weight-loss',
      tone: 'alerta',
      title: `Perdió peso: bajó ${formatDecimalEsCo(String(weight.lossPercent), 1, true)} % desde el pesaje anterior`,
      description: 'Revisa su estado y vuelve a pesarlo.',
      action: { kind: 'weight' },
    });
  }
  return banners;
}

/** «0,435 kg/día». */
export function gainText(kgPerDay: number): string {
  return `${formatDecimalEsCo(kgPerDay.toFixed(3), 3, true)} kg/día`;
}

/**
 * «Carne hasta el 21/10/2026 · Leche hasta el 30/09/2026»: solo los retiros vigentes (M6). La carne
 * decide si se puede vender o sacrificar (RN-22); la leche, si se puede vender la leche (M9b).
 */
export function withdrawalText(withdrawals: AnimalDetail['withdrawals'], today: IsoDate): string {
  const parts: string[] = [];
  if (withdrawals.meatUntil !== null && withdrawals.meatUntil >= today) {
    parts.push(`Carne hasta el ${formatDate(withdrawals.meatUntil)}`);
  }
  if (withdrawals.milkUntil !== null && withdrawals.milkUntil >= today) {
    parts.push(`Leche hasta el ${formatDate(withdrawals.milkUntil)}`);
  }
  return parts.length === 0
    ? 'No se debe vender ni sacrificar para consumo mientras dure el retiro.'
    : parts.join(' · ');
}

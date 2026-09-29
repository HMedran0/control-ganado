import { daysBetween, formatDate, type AnimalDetail, type IsoDate } from '@hato/shared';

import type { AlertTone } from '../../../components/ui/AlertBanner';

/**
 * Avisos de la ficha (ANI-07 CA1, 06 §5.3): qué pasa y cuándo, como `AlertBanner`.
 *
 * Los avisos reproductivos traen la acción que los resuelve (M5): registrar el parto o la
 * palpación. Los de vacunas la tendrán con M6; mientras tanto la ficha no muestra botones que no
 * hacen nada. Cada aviso sale de lo que ya calculó la API con las funciones de shared
 * (`vaccineStatus`, `animalAlerts`); aquí solo se redacta.
 */
export type BannerAction = 'calving' | 'diagnosis';

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
      });
    } else if (vaccine.status === 'UPCOMING' && due !== null) {
      banners.push({
        key: `vaccine:${vaccine.vaccineId}`,
        tone: 'aviso',
        title: `${vaccine.name}: refuerzo ${relativeDays(due, today)}`,
        description: `Le toca el ${formatDate(due)}.`,
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
      action: 'calving',
    });
  }
  if (animal.alerts.includes('calving_overdue') && open !== null) {
    banners.push({
      key: 'calving-overdue',
      tone: 'alerta',
      title: 'Pasó la fecha de parto: registra el parto o el aborto',
      action: 'calving',
      description: `El parto estaba estimado para el ${formatDate(open.expectedCalvingDate)} (${relativeDays(open.expectedCalvingDate, today)}).`,
    });
  }
  if (animal.alerts.includes('unconfirmed_service') && open !== null) {
    banners.push({
      key: 'service',
      tone: 'aviso',
      title: `Servida ${relativeDays(open.serviceDate, today)} sin diagnóstico`,
      description: 'Conviene programar la palpación.',
      action: 'diagnosis',
    });
  }
  if (animal.alerts.includes('withdrawal') && animal.withdrawalUntil !== null) {
    banners.push({
      key: 'withdrawal',
      tone: 'aviso',
      title: `En retiro hasta el ${formatDate(animal.withdrawalUntil)}`,
      description: 'No se debe vender ni sacrificar para consumo mientras dure el retiro.',
    });
  }
  return banners;
}

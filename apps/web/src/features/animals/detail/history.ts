import {
  EXIT_TYPE_LABEL,
  formatWeight,
  type TimelineItem as ApiTimelineItem,
} from '@hato/shared';
import {
  ArrowRightLeft,
  Baby,
  HeartHandshake,
  LogIn,
  LogOut,
  Pencil,
  Pill,
  Scale,
  Stethoscope,
  Syringe,
  Tag,
  type LucideIcon,
} from 'lucide-react';

import type { TimelineItem } from '../../../components/ui/Timeline';
import { IDENTIFIER_TYPE_LABEL, RETIRE_REASON_LABEL } from '../labels';

export { EXIT_TYPE_LABEL } from '@hato/shared';

/** Nombre de cada campo editable en la línea de tiempo («Edición: nombre, lote»). */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  code: 'código',
  name: 'nombre',
  sex: 'sexo',
  breedId: 'raza',
  birthDate: 'fecha de nacimiento',
  birthDateEstimated: 'fecha aproximada',
  origin: 'procedencia',
  originDetail: 'vendedor u origen',
  entryDate: 'fecha de ingreso',
  damId: 'madre',
  sireId: 'padre',
  sireExternalRef: 'padre externo',
  lotId: 'lote',
  notes: 'observaciones',
  photoUrl: 'foto',
  forSale: 'disponible para venta',
  tagIds: 'etiquetas',
};

const OUTCOME_LABEL = {
  CALVED: 'Parto',
  ABORTED: 'Aborto',
  FAILED: 'Diagnóstico negativo',
} as const;

function titleAndIcon(item: ApiTimelineItem): { title: string; icon: LucideIcon } {
  switch (item.kind) {
    case 'BIRTH':
      return {
        icon: Baby,
        title: item.data.dam === null ? 'Nacimiento' : `Nacimiento · madre ${item.data.dam.code}`,
      };
    case 'ENTRY':
      return {
        icon: LogIn,
        title:
          item.data.originDetail === null
            ? 'Ingreso a la finca'
            : `Ingreso a la finca · ${item.data.originDetail}`,
      };
    case 'SERVICE': {
      const sire = item.data.sire?.code ?? item.data.sireExternalRef;
      return { icon: HeartHandshake, title: sire === null ? 'Servicio' : `Servicio · ${sire}` };
    }
    case 'DIAGNOSIS':
      return { icon: Stethoscope, title: 'Palpación positiva' };
    case 'PREGNANCY_OUTCOME': {
      const stillborn = item.data.stillbornCount;
      return {
        icon: Baby,
        title:
          stillborn > 0
            ? `${OUTCOME_LABEL[item.data.outcome]} · ${stillborn} muerta${stillborn === 1 ? '' : 's'} al nacer`
            : OUTCOME_LABEL[item.data.outcome],
      };
    }
    case 'VACCINATION':
      return { icon: Syringe, title: `Vacuna ${item.data.vaccine}` };
    case 'TREATMENT':
      return { icon: Pill, title: `Tratamiento · ${item.data.medication}` };
    case 'WEIGHT':
      return { icon: Scale, title: `Pesaje · ${formatWeight(item.data.weightKg)}` };
    case 'LOT_MOVEMENT':
      return {
        icon: ArrowRightLeft,
        title: `Cambio de lote · ${item.data.fromLot ?? 'sin lote'} → ${item.data.toLot ?? 'sin lote'}`,
      };
    case 'IDENTIFIER_ASSIGNED':
      return {
        icon: Tag,
        title: `${IDENTIFIER_TYPE_LABEL[item.data.type]} ${item.data.value} asignado`,
      };
    case 'IDENTIFIER_RETIRED':
      return {
        icon: Tag,
        title: `${IDENTIFIER_TYPE_LABEL[item.data.type]} ${item.data.value} retirado${
          item.data.reason === null
            ? ''
            : ` · ${RETIRE_REASON_LABEL[item.data.reason].toLowerCase()}`
        }`,
      };
    case 'EXIT':
      return { icon: LogOut, title: `Salida · ${EXIT_TYPE_LABEL[item.data.type]}` };
    case 'EDIT':
      return {
        icon: Pencil,
        title: `Edición · ${item.data.changes.map((change) => FIELD_LABEL[change.field] ?? change.field).join(', ')}`,
      };
  }
}

/** Evento de la API → elemento del componente `Timeline` (06 §6). */
export function toTimelineItem(item: ApiTimelineItem): TimelineItem {
  const { title, icon } = titleAndIcon(item);
  return {
    id: item.key,
    icon,
    title,
    date: item.date,
    ...(item.kind === 'EDIT' && item.data.userName !== null ? { author: item.data.userName } : {}),
    ...(item.voided ? { voided: {} } : {}),
  };
}

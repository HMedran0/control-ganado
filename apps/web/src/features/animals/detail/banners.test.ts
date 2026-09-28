import { toIsoDate, type AnimalDetail } from '@hato/shared';
import { describe, expect, it } from 'vitest';

import { animalBanners, relativeDays } from './banners';

const HOY = toIsoDate('2026-09-25');

function animal(patch: Partial<AnimalDetail>): AnimalDetail {
  return {
    id: 'a',
    code: '045',
    name: null,
    sex: 'FEMALE',
    breed: { id: 'b', name: 'Brahman' },
    birthDate: toIsoDate('2020-01-01'),
    birthDateEstimated: false,
    ageMonths: 68,
    category: 'COW',
    derivedTags: [],
    calvingCount: 2,
    expectedCalvingDate: null,
    manualTags: [],
    forSale: false,
    lot: null,
    lastWeight: null,
    status: 'ACTIVE',
    alerts: [],
    origin: 'BORN_ON_FARM',
    originDetail: null,
    entryDate: toIsoDate('2020-01-01'),
    ageDays: 2000,
    dam: null,
    sire: null,
    sireExternalRef: null,
    notes: null,
    photoUrl: null,
    exit: null,
    identifiers: [],
    reproduction: null,
    vaccines: [],
    withdrawalUntil: null,
    version: 1,
    ...patch,
  };
}

describe('relativeDays', () => {
  it('hoy, en n días, hace n días', () => {
    expect(relativeDays(HOY, HOY)).toBe('hoy');
    expect(relativeDays(toIsoDate('2026-09-26'), HOY)).toBe('en 1 día');
    expect(relativeDays(toIsoDate('2026-09-19'), HOY)).toBe('hace 6 días');
  });
});

describe('avisos de la ficha (06 §5.3)', () => {
  it('vacuna vencida: en rojo, con cuándo', () => {
    const banners = animalBanners(
      animal({
        vaccines: [
          {
            vaccineId: 'v',
            name: 'Aftosa',
            status: 'OVERDUE',
            reason: 'CLOSED_CYCLE',
            dueOn: toIsoDate('2026-09-19'),
            lastAppliedOn: null,
          },
        ],
      }),
      HOY,
    );
    expect(banners).toEqual([
      {
        key: 'vaccine:v',
        tone: 'alerta',
        title: 'Aftosa vencida hace 6 días',
        description: 'Faltó en el último ciclo oficial de vacunación.',
      },
    ]);
  });

  it('parto próximo, servida sin diagnóstico y retiro', () => {
    const banners = animalBanners(
      animal({
        alerts: ['calving_soon', 'withdrawal', 'unconfirmed_service'],
        expectedCalvingDate: toIsoDate('2026-10-21'),
        withdrawalUntil: toIsoDate('2026-10-01'),
        reproduction: {
          calvingCount: 2,
          lastCalvingDate: null,
          openPregnancy: {
            id: 'p',
            serviceDate: toIsoDate('2026-06-01'),
            confirmedAt: null,
            expectedCalvingDate: toIsoDate('2027-03-20'),
          },
        },
      }),
      HOY,
    );
    expect(banners.map((banner) => banner.title)).toEqual([
      'Parto estimado en 26 días',
      'Servida hace 116 días sin diagnóstico',
      'En retiro hasta el 01/10/2026',
    ]);
  });

  it('un animal que ya salió no tiene avisos', () => {
    expect(
      animalBanners(animal({ status: 'SOLD', alerts: ['withdrawal'], withdrawalUntil: HOY }), HOY),
    ).toEqual([]);
  });
});

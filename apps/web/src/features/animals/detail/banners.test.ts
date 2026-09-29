import { toIsoDate, type AnimalDetail, type PregnancyView } from '@hato/shared';
import { describe, expect, it } from 'vitest';

import { animalBanners, relativeDays } from './banners';

const HOY = toIsoDate('2026-09-25');

function openPregnancy(patch: Partial<PregnancyView>): PregnancyView {
  return {
    id: 'p',
    dam: { id: 'a', code: '045', name: null },
    serviceDate: toIsoDate('2026-06-01'),
    serviceDateEstimated: false,
    method: 'NATURAL',
    sire: null,
    sireExternalRef: null,
    responsible: null,
    confirmedAt: null,
    diagnosisResponsible: null,
    expectedCalvingDate: toIsoDate('2027-03-20'),
    expectedCalvingManual: false,
    outcome: 'PENDING',
    outcomeDate: null,
    calvingType: null,
    stillbornCount: 0,
    isImported: false,
    notes: null,
    gestationDays: 116,
    calves: [],
    voided: null,
    version: 1,
    ...patch,
  };
}

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
    entryDateEstimated: false,
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
    codeHistory: { previousHolder: null, currentHolder: null },
    archive: null,
    qrUrl: 'http://localhost:5173/a/0199a1b2-0000-7000-8000-000000000001',
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
          importedPriorCalvings: 0,
          lastCalvingDate: null,
          openPregnancy: openPregnancy({}),
          calvingInterval: { lastDays: null, averageDays: null },
          history: [],
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

  it('parto vencido sin registrar: pide registrar el parto o el aborto (M5)', () => {
    const banners = animalBanners(
      animal({
        alerts: ['calving_soon', 'calving_overdue'],
        expectedCalvingDate: toIsoDate('2026-09-01'),
        reproduction: {
          calvingCount: 2,
          importedPriorCalvings: 0,
          lastCalvingDate: null,
          openPregnancy: openPregnancy({
            confirmedAt: toIsoDate('2026-02-01'),
            expectedCalvingDate: toIsoDate('2026-09-01'),
          }),
          calvingInterval: { lastDays: null, averageDays: null },
          history: [],
        },
      }),
      HOY,
    );
    expect(banners.find((banner) => banner.key === 'calving-overdue')).toEqual({
      key: 'calving-overdue',
      tone: 'alerta',
      title: 'Pasó la fecha de parto: registra el parto o el aborto',
      description: 'El parto estaba estimado para el 01/09/2026 (hace 24 días).',
      action: 'calving',
    });
  });

  it('un animal que ya salió no tiene avisos', () => {
    expect(
      animalBanners(animal({ status: 'SOLD', alerts: ['withdrawal'], withdrawalUntil: HOY }), HOY),
    ).toEqual([]);
  });
});

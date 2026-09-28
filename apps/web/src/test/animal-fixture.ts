import { toIsoDate, type AnimalDetail } from '@hato/shared';

export const FIXTURE_ANIMAL_ID = '0199a1b2-0000-7000-8000-000000000005';

/** Ficha mínima de una vaca activa, para las pruebas de componentes de la ficha. */
export function animalDetail(patch: Partial<AnimalDetail> = {}): AnimalDetail {
  return {
    id: FIXTURE_ANIMAL_ID,
    code: '5',
    name: null,
    sex: 'FEMALE',
    breed: { id: '0199a1b2-0000-7000-8000-00000000000b', name: 'Brahman' },
    birthDate: toIsoDate('2021-02-10'),
    birthDateEstimated: false,
    ageMonths: 67,
    category: 'COW',
    derivedTags: [],
    calvingCount: 1,
    expectedCalvingDate: null,
    manualTags: [],
    forSale: false,
    lot: null,
    lastWeight: null,
    status: 'ACTIVE',
    alerts: [],
    origin: 'BORN_ON_FARM',
    originDetail: null,
    entryDate: toIsoDate('2021-02-10'),
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

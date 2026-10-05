import {
  formatDate,
  formatWeight,
  isoDateFromInstant,
  uuidv7,
  type AnimalRef,
  type ScaleAssociation,
  type ScaleColumnMapping,
  type UnknownChip,
  type WeightImportDryRun,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState, type ChangeEvent } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { FormError } from '../../components/ui/FormError';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { isApiError } from '../../lib/api/errors';
import { useRequiredSession } from '../../lib/auth/context';
import { FARM_TIME_ZONE } from '../../lib/clock';
import { AnimalPicker } from '../animals/form/AnimalPicker';
import {
  useCreateScaleProfile,
  useScaleImport,
  useScaleProfiles,
  type ScaleImportRequest,
} from './api';
import { SCALE_ROW_STATUS_LABEL, SCALE_VIA_LABEL } from './labels';

const PAGE = 100;
/** Sin perfil: la API reconoce las columnas por sus nombres y propone el mapeo. */
const PROPOSE = '';

const errorText = (error: unknown): string =>
  isApiError(error) ? error.detail : 'Ocurrió un error inesperado.';

/** Qué decidió la persona para cada chip desconocido (PES-04 CA3). */
type ChipChoice = {
  readonly animal: AnimalRef | null;
  readonly saveChip: boolean;
  readonly skip: boolean;
};

/**
 * Importar la sesión de pesaje de la báscula (PES-04, 06 §5.12). Paso 1: el perfil (la plantilla
 * Tru-Test, un perfil de la finca o «Reconocer las columnas») y el archivo. Paso 2: la simulación,
 * sin guardar nada: asociados (por chip, por chapeta o por código), chips desconocidos, repetidos y
 * pesos atípicos; cada chip desconocido se asocia a un animal o no se importa. Paso 3: «Guardar N
 * pesajes», que crea la jornada de pesaje una sola vez aunque se repita el clic (ADR-011).
 */
export function ScaleImportPage() {
  const session = useRequiredSession();
  const isAdmin = session.role === 'ADMIN';
  const profiles = useScaleProfiles();
  const { preview, confirm } = useScaleImport();
  const createProfile = useCreateScaleProfile();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [profileId, setProfileId] = useState<string>('tru-test');
  const [file, setFile] = useState<File | null>(null);
  const [importKey, setImportKey] = useState<string>(() => uuidv7());
  const [choices, setChoices] = useState<Readonly<Record<string, ChipChoice>>>({});
  /**
   * Chips desconocidos del archivo. Se acumulan entre simulaciones: un chip asociado ya no sale como
   * desconocido en la siguiente, pero su asociación tiene que seguir a la vista para cambiarla.
   */
  const [unknownChips, setUnknownChips] = useState<readonly UnknownChip[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [profileName, setProfileName] = useState('');

  const requestFor = (
    nextFile: File,
    nextProfile: string,
    nextChoices: Readonly<Record<string, ChipChoice>>,
    mapping: ScaleColumnMapping | null = null,
  ): ScaleImportRequest => ({
    file: nextFile,
    scaleProfileId: nextProfile === PROPOSE ? null : nextProfile,
    mapping,
    associations: Object.entries(nextChoices).flatMap(([chip, choice]): ScaleAssociation[] =>
      choice.animal === null || choice.skip
        ? []
        : [{ chip, animalId: choice.animal.id, saveChip: choice.saveChip }],
    ),
    skip: Object.entries(nextChoices)
      .filter(([, choice]) => choice.skip)
      .map(([chip]) => chip),
  });

  const simulate = (
    nextFile: File,
    nextProfile: string,
    nextChoices: Readonly<Record<string, ChipChoice>>,
  ): void => {
    confirm.reset();
    preview.mutate(requestFor(nextFile, nextProfile, nextChoices), {
      onSuccess: (result) => {
        setUnknownChips((current) => [
          ...current,
          ...result.unknownChips.filter(
            (chip) => !current.some((known) => known.chip === chip.chip),
          ),
        ]);
        // «Este animal ya tiene el chip X»: el chip no se guarda; la casilla queda desmarcada.
        if (result.chipNotices.length === 0) return;
        setChoices((current) => {
          const next = { ...current };
          for (const notice of result.chipNotices) {
            const choice = next[notice.chip];
            if (choice !== undefined) next[notice.chip] = { ...choice, saveChip: false };
          }
          return next;
        });
      },
    });
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.files?.[0];
    if (next === undefined) return;
    setFile(next);
    setImportKey(uuidv7());
    setChoices({});
    setUnknownChips([]);
    setShown(PAGE);
    simulate(next, profileId, {});
  };

  const choose = (chip: string, change: Partial<ChipChoice>): void => {
    const current = choices[chip] ?? { animal: null, saveChip: true, skip: false };
    const next = { ...choices, [chip]: { ...current, ...change } };
    setChoices(next);
    if (file !== null) simulate(file, profileId, next);
  };

  const result = preview.data;
  const done = confirm.data;

  if (done !== undefined) {
    const unknown = result?.unknownChips.filter((chip) => choices[chip.chip]?.animal == null);
    return (
      <>
        <PageHeader title="Importar pesaje de la báscula" />
        <div className="flex max-w-xl flex-col gap-4">
          <p role="status" className="rounded-control bg-potrero-claro p-3 font-bold text-potrero">
            {done.replayed
              ? 'Esta importación ya se había hecho; no se repitió.'
              : `${done.created} ${done.created === 1 ? 'pesaje guardado' : 'pesajes guardados'}${
                  unknown === undefined || unknown.length === 0
                    ? ''
                    : ` · ${unknown.length} ${unknown.length === 1 ? 'chip sin asociar' : 'chips sin asociar'}`
                }.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/animals"
              search={{ sort: '-lastWeight' }}
              className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
            >
              Ver los animales
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                confirm.reset();
                preview.reset();
                setFile(null);
                if (input.current !== null) input.current.value = '';
              }}
            >
              Importar otro archivo
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Importar pesaje de la báscula" />
      <div className="flex max-w-4xl flex-col gap-8">
        <section aria-labelledby="paso-perfil" className="flex flex-col gap-4">
          <h2 id="paso-perfil" className="text-lg font-bold">
            1. Elige la báscula y el archivo
          </h2>
          <SelectField
            label="Perfil de báscula"
            hint="La plantilla Tru-Test es provisional: se ajusta con un archivo real de tu báscula."
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value);
              if (file !== null) simulate(file, event.target.value, choices);
            }}
          >
            {profiles.data?.items.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.provisional ? ' (provisional)' : ''}
                {profile.unit === 'LB' ? ' · libras' : ''}
              </option>
            ))}
            <option value={PROPOSE}>Otro formato: reconocer las columnas</option>
          </SelectField>
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="font-bold">
              Archivo de la báscula (.csv o .xlsx, hasta 5 MB)
            </label>
            <input
              ref={input}
              id={inputId}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="min-h-touch rounded-control border-2 border-cerca bg-superficie p-2 file:mr-3 file:min-h-touch file:rounded-control file:border-0 file:bg-potrero-claro file:px-4 file:font-bold file:text-monte"
              onChange={onFile}
            />
          </div>
          <p className="text-texto-2">Primero revisamos el archivo sin guardar nada.</p>
        </section>

        <div role="status" aria-live="polite">
          {preview.isPending ? <p className="text-texto-2">Revisando el archivo…</p> : null}
        </div>
        <FormError message={preview.error === null ? null : errorText(preview.error)} />

        {result === undefined || file === null ? null : (
          <Simulation
            result={result}
            unknownChips={unknownChips}
            choices={choices}
            shown={shown}
            onMore={() => {
              setShown((value) => value + PAGE);
            }}
            onChoose={choose}
          />
        )}

        {result !== undefined && file !== null && result.profile === null && isAdmin ? (
          <section aria-labelledby="guardar-perfil" className="flex flex-col gap-3">
            <h2 id="guardar-perfil" className="text-md font-bold">
              Guardar estas columnas como perfil de la finca
            </h2>
            <p className="text-texto-2">
              Así la próxima vez eliges el perfil y no hay que reconocer las columnas.
            </p>
            <TextField
              label="Nombre del perfil"
              hint="Por ejemplo, Báscula del corral."
              value={profileName}
              onChange={(event) => {
                setProfileName(event.target.value);
              }}
            />
            <FormError
              message={createProfile.error === null ? null : errorText(createProfile.error)}
            />
            <Button
              variant="secondary"
              className="self-start"
              disabled={createProfile.isPending || profileName.trim() === ''}
              onClick={() => {
                void createProfile
                  .mutateAsync({
                    name: profileName,
                    fileFormat: file.name.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'CSV',
                    columnMapping: result.mapping,
                  })
                  .then(
                    (saved) => {
                      setProfileId(saved.id);
                      setProfileName('');
                    },
                    () => undefined,
                  );
              }}
            >
              Guardar perfil
            </Button>
          </section>
        ) : null}

        {result === undefined || file === null ? null : (
          <section className="flex flex-col gap-3">
            <FormError message={confirm.error === null ? null : errorText(confirm.error)} />
            <Button
              block
              disabled={result.importable === 0 || confirm.isPending || preview.isPending}
              onClick={() => {
                confirm.mutate({
                  request: requestFor(
                    file,
                    profileId,
                    choices,
                    result.profile === null ? result.mapping : null,
                  ),
                  importKey,
                  expectedRows: result.importable,
                });
              }}
            >
              {confirm.isPending
                ? 'Guardando…'
                : result.importable === 1
                  ? 'Guardar 1 pesaje'
                  : `Guardar ${result.importable} pesajes`}
            </Button>
          </section>
        )}
      </div>
    </>
  );
}

function Simulation({
  result,
  unknownChips,
  choices,
  shown,
  onMore,
  onChoose,
}: {
  result: WeightImportDryRun;
  unknownChips: readonly UnknownChip[];
  choices: Readonly<Record<string, ChipChoice>>;
  shown: number;
  onMore: () => void;
  onChoose: (chip: string, change: Partial<ChipChoice>) => void;
}) {
  const counters: [string, number, 'potrero' | 'aviso' | 'alerta'][] = [
    ['Asociados', result.counts.matched, 'potrero'],
    ['Chips desconocidos', result.counts.unknownChips, 'aviso'],
    ['Repetidos', result.counts.duplicates, 'aviso'],
    ['Pesos atípicos', result.counts.outliers, 'aviso'],
    ['Con error', result.counts.errors, 'alerta'],
  ];
  return (
    <section aria-labelledby="paso-revision" className="flex flex-col gap-4">
      <h2 id="paso-revision" className="text-lg font-bold">
        2. Revisa antes de guardar
      </h2>
      {result.previousImport === null ? null : (
        <p className="rounded-control bg-aviso-claro p-3 text-aviso-intenso">
          Este archivo ya se importó el{' '}
          {formatDate(
            isoDateFromInstant(new Date(result.previousImport.importedAt), FARM_TIME_ZONE),
          )}{' '}
          ({result.previousImport.created} pesajes).
        </p>
      )}
      <p className="text-texto-2">
        {result.totalRows} filas · columnas: peso «{result.columns.weight}»
        {result.columns.eid === null ? '' : `, chip «${result.columns.eid}»`}
        {result.columns.visualId === null ? '' : `, número «${result.columns.visualId}»`}
        {result.columns.date === null
          ? ', sin fecha (se usa la de hoy)'
          : `, fecha «${result.columns.date}»`}
        .
      </p>
      {result.unit === 'LB' ? (
        <p className="rounded-control bg-info-claro p-3 font-bold text-info-intenso">
          Los pesos del archivo están en libras: se convierten a kilos (redondeados a 0,1 kg).
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {counters.map(([label, value, tone]) => (
          <li
            key={label}
            className={`flex flex-col rounded-control border-2 p-3 ${
              tone === 'potrero'
                ? 'border-potrero text-potrero'
                : tone === 'aviso'
                  ? 'border-aviso text-aviso-intenso'
                  : 'border-alerta text-alerta-intenso'
            }`}
          >
            <span className="font-display text-xl leading-none">{value}</span>
            <span className="font-bold">{label}</span>
          </li>
        ))}
      </ul>
      {result.warnings.map((warning) => (
        <p key={warning.message} className="rounded-control bg-aviso-claro p-3 text-aviso-intenso">
          {warning.message}
        </p>
      ))}

      {unknownChips.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <h3 className="font-bold">Chips desconocidos</h3>
          {unknownChips.map((chip) => {
            const choice = choices[chip.chip] ?? { animal: null, saveChip: true, skip: false };
            return (
              <div
                key={chip.chip}
                className="flex flex-col gap-3 rounded-control border-2 border-aviso p-3"
              >
                <p className="font-bold">
                  Chip {chip.chip} · {formatWeight(chip.weightKg)} · {formatDate(chip.date)} (fila{' '}
                  {chip.rows.join(', ')})
                </p>
                <AnimalPicker
                  label={`Asociar el chip ${chip.chip} a un animal`}
                  value={choice.animal}
                  onChange={(animal) => {
                    onChoose(chip.chip, { animal, skip: false, saveChip: true });
                  }}
                />
                {choice.animal === null ? null : (
                  <Checkbox
                    label="Guardar este chip como RFID del animal"
                    checked={choice.saveChip}
                    onChange={(event) => {
                      onChoose(chip.chip, { saveChip: event.target.checked });
                    }}
                  />
                )}
                <Checkbox
                  label="No importar este chip"
                  checked={choice.skip}
                  onChange={(event) => {
                    onChoose(chip.chip, {
                      skip: event.target.checked,
                      animal: event.target.checked ? null : choice.animal,
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      {result.chipNotices.map((notice) => (
        <p
          key={notice.chip}
          className="rounded-control bg-aviso-claro p-3 font-bold text-aviso-intenso"
        >
          {notice.message}
        </p>
      ))}

      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Filas del archivo">
        <table className="w-full text-left">
          <caption className="sr-only">Filas del archivo de la báscula</caption>
          <thead>
            <tr className="border-b-2 border-cerca">
              <th scope="col" className="p-2">
                Fila
              </th>
              <th scope="col" className="p-2">
                Animal
              </th>
              <th scope="col" className="p-2">
                Cómo se asoció
              </th>
              <th scope="col" className="p-2 text-right">
                Peso
              </th>
              <th scope="col" className="p-2">
                Fecha
              </th>
              <th scope="col" className="p-2">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.slice(0, shown).map((row) => (
              <tr key={row.row} className="border-b border-cerca align-top">
                <td className="p-2">{row.row}</td>
                <td className="p-2">
                  {row.animal === null ? (row.eid ?? row.visualId ?? '—') : row.animal.code}
                </td>
                <td className="p-2">{row.via === null ? '—' : SCALE_VIA_LABEL[row.via]}</td>
                <td className="p-2 text-right">
                  {row.weightKg === null ? '—' : formatWeight(row.weightKg)}
                  {result.unit === 'LB' && row.originalWeight !== null
                    ? ` (${String(row.originalWeight).replace('.', ',')} lb)`
                    : ''}
                </td>
                <td className="p-2">{row.date === null ? '—' : formatDate(row.date)}</td>
                <td className="p-2">
                  <span className="font-bold">{SCALE_ROW_STATUS_LABEL[row.status]}</span>
                  {row.message === null ? null : <span className="block">{row.message}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length > shown ? (
        <Button variant="ghost" className="self-start" onClick={onMore}>
          Mostrar más
        </Button>
      ) : null}
    </section>
  );
}

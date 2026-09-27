import { addDays, toIsoDate, type IsoDate } from '@hato/shared';
import { Baby, Bell, HeartPulse, Scale, Syringe } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Logo } from '../components/layout/Logo';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Button } from '../components/ui/Button';
import { Chapeta } from '../components/ui/Chapeta';
import { Checkbox } from '../components/ui/Checkbox';
import { ConnectionBanner } from '../components/ui/ConnectionBanner';
import { DataTable, type DataColumn, type SortState } from '../components/ui/DataTable';
import { DateQuickPick } from '../components/ui/DateQuickPick';
import { EmptyState } from '../components/ui/EmptyState';
import { FormError } from '../components/ui/FormError';
import { NumberField } from '../components/ui/NumberField';
import { PasswordField } from '../components/ui/PasswordField';
import { QuestionRow } from '../components/ui/QuestionRow';
import { SearchBar, type SearchSource } from '../components/ui/SearchBar';
import { SegmentedChoice } from '../components/ui/SegmentedChoice';
import { Stepper } from '../components/ui/Stepper';
import { Tag } from '../components/ui/Tag';
import { TextField } from '../components/ui/TextField';
import { Timeline } from '../components/ui/Timeline';
import { UndoToastProvider, useUndoToast } from '../components/ui/UndoToast';
import { useToday } from '../lib/clock';

/**
 * Muestra de todos los componentes del sistema de diseño en todos sus estados (07 M2).
 * Solo existe en desarrollo (ver `routes/dev.ui.tsx`). Los datos son de la finca ficticia de
 * referencia; los códigos siguen el patrón `{YY}-{NNN}` (08 §2.3).
 */
export function UiShowcase() {
  useEffect(() => {
    document.title = 'Muestra de componentes · Hato';
  }, []);

  return (
    <UndoToastProvider>
      <main id="contenido" className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-8 lg:px-8">
        <header>
          <p className="font-cifras text-xl text-potrero">Hato · solo en desarrollo</p>
          <h1 className="text-xl font-bold">Muestra de componentes</h1>
          <p className="text-texto-2">
            Cada componente de 06-ux-ui.md §6 en todos sus estados. Esta página no existe en el
            paquete de producción.
          </p>
        </header>

        <ChapetaDemo />
        <LogoDemo />
        <TagsDemo />
        <AlertDemo />
        <QuestionDemo />
        <SearchDemo />
        <RfidFieldDemo />
        <ChoicesDemo />
        <CheckboxDemo />
        <NumbersDemo />
        <FeedbackDemo />
        <TimelineDemo />
        <TableDemo />
        <EmptyDemo />
        <PrimitivesDemo />
      </main>
    </UndoToastProvider>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="border-b border-cerca pb-2 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-aux text-texto-2">{children}</p>;
}

const CODES = ['26-045', '26-046', '25-118', '24-007'];

function ChapetaDemo() {
  const [index, setIndex] = useState(0);
  return (
    <Section id="chapeta" title="Chapeta">
      <div className="flex flex-wrap items-end gap-6">
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="P-12" size="s" />
          <Caption>s · 56 px</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="P-12" size="m" />
          <Caption>m · 72 px</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="P-12" size="l" />
          <Caption>l · 96 px</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="26-045" size="s" />
          <Caption>s · código largo</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="087" size="s" />
          <Caption>s · 3 dígitos</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="26-045" size="m" />
          <Caption>m · código largo</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="26-045" size="l" />
          <Caption>l · código largo</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="25-118" size="m" exitLabel="Vendido" />
          <Caption>Salió de la finca</Caption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <Chapeta code="24-007" size="s" exitLabel="Retirado" />
          <Caption>Salió (s)</Caption>
        </figure>
      </div>
      <div className="flex items-center gap-6">
        <Chapeta code={CODES[index] ?? '26-045'} size="l" animated />
        <Button
          variant="secondary"
          onClick={() => {
            setIndex((current) => (current + 1) % CODES.length);
          }}
        >
          Leer otro animal
        </Button>
      </div>
    </Section>
  );
}

function LogoDemo() {
  return (
    <Section id="logo" title="Logo">
      <Logo />
    </Section>
  );
}

function TagsDemo() {
  return (
    <Section id="tag" title="Tag">
      <div className="flex flex-wrap gap-2">
        <Tag tone="info">Preñada</Tag>
        <Tag tone="potrero">Parida · 4</Tag>
        <Tag tone="neutro">Lote Sabana</Tag>
        <Tag tone="aviso">En retiro</Tag>
        <Tag tone="alerta" icon={Syringe}>
          Aftosa vencida
        </Tag>
        <Tag tone="potrero">Disponible para venta</Tag>
      </div>
    </Section>
  );
}

function AlertDemo() {
  const [done, setDone] = useState(false);
  return (
    <Section id="alertbanner" title="AlertBanner">
      <AlertBanner
        tone="alerta"
        title="Aftosa vencida hace 6 días"
        action={{ label: 'Registrar vacuna', to: '/record' }}
      />
      <AlertBanner
        tone="aviso"
        title="En retiro por medicamento hasta 28/09"
        description="No vender ni ordeñar para consumo hasta esa fecha."
      />
      <AlertBanner
        tone="info"
        title={done ? 'Palpación registrada' : 'Servida hace 45 días sin diagnóstico'}
        action={
          done
            ? undefined
            : {
                label: 'Registrar palpación',
                onClick: () => {
                  setDone(true);
                },
              }
        }
      />
    </Section>
  );
}

function QuestionDemo() {
  return (
    <Section id="questionrow" title="QuestionRow">
      <ul className="divide-y divide-cerca rounded-panel border border-cerca bg-superficie px-4">
        <li>
          <QuestionRow
            question="¿Cuántos animales hay?"
            summary="136 machos · 148 hembras"
            value="284"
            to="/animals"
          />
        </li>
        <li>
          <QuestionRow
            question="¿Qué falta vacunar?"
            summary="9 vencidas · 15 esta quincena"
            value="24"
            tone="alerta"
            to="/alerts"
          />
        </li>
        <li>
          <QuestionRow
            question="¿Cuánto hay invertido?"
            summary="Hato activo · solo administrador"
            value="$ 812 M"
            to="/finance"
          />
        </li>
      </ul>
    </Section>
  );
}

function SearchDemo() {
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState('');
  const [last, setLast] = useState<{ query: string; source: SearchSource } | null>(null);
  return (
    <Section id="searchbar" title="SearchBar">
      <Caption>
        Normal, con el atajo «/» en escritorio. Una ráfaga de 15 dígitos con Enter (lector RFID) se
        busca aunque el campo no tenga el foco.
      </Caption>
      <SearchBar
        value={query}
        onChange={setQuery}
        onSearch={(q, source) => {
          setLast({ query: q, source });
        }}
        shortcut
      />
      <p className="text-texto-2" data-testid="ultima-busqueda">
        {last === null
          ? 'Todavía no has buscado.'
          : `Última búsqueda: ${last.query} (${last.source})`}
      </p>
      <Caption>Listo para leer, como en la jornada: borde amarillo de chapeta.</Caption>
      <SearchBar
        label="Leer chip"
        value={reading}
        onChange={setReading}
        onSearch={() => undefined}
        readerReady
      />
    </Section>
  );
}

function RfidFieldDemo() {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Section id="campo-lector" title="Campo que se llena con el lector">
      <Caption>
        «Identificador» tiene data-rfid-field: una lectura queda escrita, su Enter no envía el
        formulario y el foco pasa a «Nombre».
      </Caption>
      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const identifier = data.get('identificador');
          setSaved(typeof identifier === 'string' ? identifier : '');
        }}
      >
        <TextField label="Identificador" name="identificador" data-rfid-field="" />
        <TextField label="Nombre" name="nombre" />
        <Button type="submit">Guardar animal</Button>
        <p role="status">{saved === null ? '' : `Animal guardado con ${saved}.`}</p>
      </form>
    </Section>
  );
}

type Sexo = 'MALE' | 'FEMALE';
type TipoParto = 'NORMAL' | 'ASSISTED' | 'CESAREAN';

function ChoicesDemo() {
  const today = useToday();
  const [sexo, setSexo] = useState<Sexo | null>('MALE');
  const [tipo, setTipo] = useState<TipoParto | null>(null);
  const [date, setDate] = useState<IsoDate>(today);
  const [lastWeek, setLastWeek] = useState<IsoDate>(addDays(today, -7));
  return (
    <Section id="segmentedchoice" title="SegmentedChoice y DateQuickPick">
      <div className="grid gap-6 lg:grid-cols-2">
        <SegmentedChoice<Sexo>
          label="Sexo"
          options={[
            { value: 'MALE', label: 'Macho' },
            { value: 'FEMALE', label: 'Hembra' },
          ]}
          value={sexo}
          onChange={setSexo}
        />
        <SegmentedChoice<TipoParto>
          label="Tipo de parto"
          options={[
            { value: 'NORMAL', label: 'Normal' },
            { value: 'ASSISTED', label: 'Asistido' },
            { value: 'CESAREAN', label: 'Cesárea' },
          ]}
          value={tipo}
          onChange={setTipo}
          error={tipo === null ? 'Elige el tipo de parto.' : undefined}
        />
        <SegmentedChoice
          label="Estado (deshabilitado)"
          options={[
            { value: 'SANA', label: 'Sana' },
            { value: 'DEBIL', label: 'Débil' },
            { value: 'MUERTA', label: 'Muerta' },
          ]}
          value="SANA"
          onChange={() => undefined}
          disabled
        />
        <DateQuickPick label="Fecha del parto" value={date} onChange={setDate} today={today} />
        <DateQuickPick
          label="Fecha del servicio (otra fecha)"
          value={lastWeek}
          onChange={setLastWeek}
          today={today}
          min={toIsoDate('2024-01-01')}
        />
      </div>
    </Section>
  );
}

function CheckboxDemo() {
  const [official, setOfficial] = useState(true);
  const [vaccines, setVaccines] = useState<string[]>(['aftosa']);
  const toggle = (id: string, checked: boolean) => {
    setVaccines((current) => (checked ? [...current, id] : current.filter((v) => v !== id)));
  };
  return (
    <Section id="checkbox" title="Checkbox">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col">
          <Checkbox
            label="Ciclo oficial del ICA"
            description="Vacunación de aftosa, brucelosis o rabia ejecutada por Fedegán."
            checked={official}
            onChange={(event) => {
              setOfficial(event.target.checked);
            }}
          />
          <Checkbox label="Mostrar desactivados" />
          <Checkbox label="Deshabilitada" disabled />
          <Checkbox label="Deshabilitada y marcada" disabled defaultChecked />
        </div>
        <fieldset className="flex flex-col rounded-panel border border-cerca p-4">
          <legend className="px-1 font-bold">Vacunas del ciclo</legend>
          <Checkbox
            label="Aftosa"
            description="Fiebre aftosa"
            checked={vaccines.includes('aftosa')}
            onChange={(event) => {
              toggle('aftosa', event.target.checked);
            }}
          />
          <Checkbox
            label="Rabia silvestre"
            description="Rabia de origen silvestre"
            checked={vaccines.includes('rabia')}
            onChange={(event) => {
              toggle('rabia', event.target.checked);
            }}
          />
        </fieldset>
      </div>
    </Section>
  );
}

function NumbersDemo() {
  const [peso, setPeso] = useState<string | null>('32');
  const [valor, setValor] = useState<string | null>('1250000');
  const [dosis, setDosis] = useState<string | null>(null);
  const [crias, setCrias] = useState(1);
  return (
    <Section id="numberfield" title="NumberField y Stepper">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <NumberField
            label="Peso al nacer (kg)"
            unit="kg"
            maxDecimals={1}
            value={peso}
            onChange={setPeso}
          />
          <Caption>Valor: {peso ?? 'vacío'}</Caption>
        </div>
        <div className="flex flex-col gap-2">
          <NumberField
            label="Valor de compra"
            currency
            value={valor}
            onChange={setValor}
            hint="Solo lo ve el administrador."
          />
          <Caption>Valor: {valor ?? 'vacío'}</Caption>
        </div>
        <NumberField
          label="Dosis (ml)"
          unit="ml"
          maxDecimals={1}
          value={dosis}
          onChange={setDosis}
          error={dosis === null ? 'Escribe la dosis aplicada.' : undefined}
        />
        <Stepper label="Crías" value={crias} onChange={setCrias} min={1} max={3} />
      </div>
    </Section>
  );
}

function FeedbackDemo() {
  const show = useUndoToast();
  const [undone, setUndone] = useState(0);
  return (
    <Section id="undotoast" title="UndoToast y ConnectionBanner">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          onClick={() => {
            show({
              message: 'Vacuna registrada',
              onUndo: () => {
                setUndone((count) => count + 1);
              },
            });
          }}
        >
          Registrar vacuna
        </Button>
        <p className="text-texto-2">Deshechos: {undone}</p>
      </div>
      <Caption>Sin conexión (forzado para la muestra):</Caption>
      <ConnectionBanner online={false} />
    </Section>
  );
}

function TimelineDemo() {
  return (
    <Section id="timeline" title="Timeline">
      <Timeline
        label="Historial de P-12"
        items={[
          {
            id: '1',
            icon: Scale,
            title: 'Pesaje · 452 kg',
            date: toIsoDate('2026-09-03'),
            author: 'Wilmer Ortega',
          },
          {
            id: '2',
            icon: Syringe,
            title: 'Vacuna aftosa',
            date: toIsoDate('2026-05-12'),
            author: 'Dra. Paola Barrios',
            to: '/alerts',
          },
          {
            id: '3',
            icon: HeartPulse,
            title: 'Servicio IA · Toro Z-3',
            date: toIsoDate('2026-01-12'),
            author: 'Dra. Paola Barrios',
            voided: { reason: 'Se registró en la vaca equivocada.' },
          },
          {
            id: '4',
            icon: Baby,
            title: 'Parto · 25-233',
            date: toIsoDate('2025-11-30'),
            author: 'Yeison Mendoza',
          },
        ]}
      />
    </Section>
  );
}

type Row = {
  id: string;
  code: string;
  name: string;
  breed: string;
  age: string;
  tags: { label: string; tone: 'info' | 'potrero' }[];
  weight: string;
  alert: string | null;
  exited?: string;
};

const ROWS: Row[] = [
  {
    id: '1',
    code: '22-019',
    name: '—',
    breed: 'Gyr',
    age: '3 a 8 m',
    tags: [{ label: 'Preñada', tone: 'info' }],
    weight: '418 kg',
    alert: 'En retiro',
  },
  {
    id: '2',
    code: '21-012',
    name: 'Canela',
    breed: 'Brahman',
    age: '5 a 2 m',
    tags: [
      { label: 'Preñada', tone: 'info' },
      { label: 'Parida · 4', tone: 'potrero' },
    ],
    weight: '452 kg',
    alert: 'Aftosa vencida',
  },
  {
    id: '3',
    code: '20-031',
    name: 'Mariposa',
    breed: 'Cebú',
    age: '6 a 1 m',
    tags: [{ label: 'Parida · 5', tone: 'potrero' }],
    weight: '470 kg',
    alert: null,
    exited: 'Vendido',
  },
];

const COLUMNS: DataColumn<Row>[] = [
  {
    key: 'code',
    header: 'Código',
    sortable: true,
    mobile: 'leading',
    cell: (row) => (
      <Chapeta
        code={row.code}
        size="s"
        {...(row.exited === undefined ? {} : { exitLabel: row.exited })}
      />
    ),
  },
  { key: 'name', header: 'Nombre', mobile: 'primary', cell: (row) => row.name },
  { key: 'breed', header: 'Raza', mobile: 'secondary', cell: (row) => row.breed },
  { key: 'age', header: 'Edad', mobile: 'secondary', cell: (row) => row.age },
  {
    key: 'tags',
    header: 'Clasificación',
    mobile: 'secondary',
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        {row.tags.map((tag) => (
          <Tag key={tag.label} tone={tag.tone}>
            {tag.label}
          </Tag>
        ))}
      </span>
    ),
  },
  {
    key: 'weight',
    header: 'Último peso',
    sortable: true,
    align: 'end',
    mobile: 'hidden',
    cell: (row) => row.weight,
  },
  {
    key: 'alert',
    header: 'Alertas',
    mobile: 'secondary',
    cell: (row) =>
      row.alert === null ? '—' : <span className="font-bold text-alerta">{row.alert}</span>,
  },
];

function TableDemo() {
  const [sort, setSort] = useState<SortState>({ key: 'code', direction: 'asc' });
  const rows = [...ROWS].sort((a, b) => {
    const key = sort.key === 'weight' ? 'weight' : 'code';
    const order = a[key].localeCompare(b[key], 'es-CO', { numeric: true });
    return sort.direction === 'asc' ? order : -order;
  });
  return (
    <Section id="datatable" title="DataTable">
      <DataTable
        caption="Animales de ejemplo"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
      />
    </Section>
  );
}

function EmptyDemo() {
  return (
    <Section id="emptystate" title="EmptyState">
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          icon={Scale}
          title="Todavía no hay pesajes"
          description="Registra el primero para ver la curva de crecimiento."
          action={{ label: 'Registrar pesaje', to: '/record' }}
        />
        <EmptyState
          icon={Bell}
          title="Sin alertas por ahora"
          description="Cuando una vacuna esté por vencer o un parto esté cerca, aparecerá aquí."
        />
      </div>
    </Section>
  );
}

function PrimitivesDemo() {
  const [name, setName] = useState('');
  return (
    <Section id="primitivas" title="Botones y campos (M2a)">
      <div className="flex flex-wrap gap-3">
        <Button>Guardar parto</Button>
        <Button variant="secondary">Exportar a Excel</Button>
        <Button variant="ghost">Cambiar</Button>
        <Button disabled>Guardando…</Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TextField
          label="Nombre del animal"
          hint="Opcional."
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField
          label="Código"
          defaultValue="21-012"
          error="Ya existe un animal con el código 21-012. Usa otro código o abre su ficha."
        />
        <PasswordField label="Contraseña" autoComplete="off" />
        <div className="flex flex-col gap-2">
          <FormError message="Usuario o contraseña incorrectos." />
          <Caption>Error general de formulario.</Caption>
        </div>
      </div>
    </Section>
  );
}

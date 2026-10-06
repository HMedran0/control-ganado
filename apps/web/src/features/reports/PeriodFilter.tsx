import { isIsoDate, isoDateFromParts, isoDateParts } from '@hato/shared';
import { useState } from 'react';

import { TextField } from '../../components/ui/TextField';
import { useToday } from '../../lib/clock';

export type Period = {
  readonly from: string;
  readonly to: string;
  readonly valid: boolean;
  readonly today: string;
  readonly setFrom: (value: string) => void;
  readonly setTo: (value: string) => void;
};

/** Desde y hasta de un reporte; por defecto, del 1.º de enero a hoy (como Nacimientos). */
export function usePeriod(): Period {
  const today = useToday();
  const [from, setFrom] = useState<string>(isoDateFromParts(isoDateParts(today).year, 1, 1));
  const [to, setTo] = useState<string>(today);
  return {
    from,
    to,
    today,
    valid: isIsoDate(from) && isIsoDate(to) && from <= to,
    setFrom,
    setTo,
  };
}

export function PeriodFilter({ period }: { period: Period }) {
  return (
    <>
      <TextField
        label="Desde"
        type="date"
        value={period.from}
        max={period.today}
        onChange={(event) => {
          period.setFrom(event.target.value);
        }}
      />
      <TextField
        label="Hasta"
        type="date"
        value={period.to}
        max={period.today}
        onChange={(event) => {
          period.setTo(event.target.value);
        }}
        error={period.valid ? undefined : 'La fecha final no puede ser anterior a la inicial.'}
      />
    </>
  );
}

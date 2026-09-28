import { useState } from 'react';

import { SearchBar } from '../../../components/ui/SearchBar';
import { useRfidReader } from '../../../lib/rfid/useRfidReader';
import { useAnimalSearch } from './useAnimalSearch';

/**
 * Barra de búsqueda de animales (06 §6): en la barra superior en escritorio, con el atajo «/»,
 * y arriba de Inicio y Animales en móvil (06 §4).
 */
export function AnimalSearchBar({ shortcut = false }: { shortcut?: boolean }) {
  const [value, setValue] = useState('');
  const search = useAnimalSearch();
  return (
    <SearchBar
      value={value}
      onChange={setValue}
      shortcut={shortcut}
      onSearch={(query, source) => {
        void search(query, source);
      }}
    />
  );
}

/**
 * Lector RFID en cualquier pantalla con sesión (ANI-05 CA3): una lectura con el foco fuera de
 * un campo busca el animal, aunque la pantalla no tenga barra de búsqueda. Si la barra está en
 * pantalla, ella atiende la lectura primero y esta la deja pasar.
 */
export function GlobalRfidReader() {
  const search = useAnimalSearch();
  useRfidReader({
    onRead: (code) => {
      void search(code, 'lector');
    },
  });
  return null;
}

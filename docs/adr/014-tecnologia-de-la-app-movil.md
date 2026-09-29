# ADR-014: Tecnología de la app móvil

- Estado: **propuesta**. Se decide antes de empezar la fase 2, con las pruebas de abajo.
- Requisitos: SYN-01, IDN-04, PES-03, LEC-06, AUT-15
- Relacionadas: ADR-012 (escrituras sin conexión), 04 §6 (Móvil)

## Contexto

La especificación daba por decidido React Native con Expo (04, ADR-08 de la tabla). Con la web ya
construida, hay una alternativa que reutiliza mucho más: Capacitor, que empaqueta la misma interfaz
web como app nativa y agrega complementos nativos (Bluetooth, SQLite, cámara). La app móvil tiene
exigencias que deciden: trabajar sin conexión, leer un lector RFID Bluetooth, conectarse a la báscula
Tru-Test (Bluetooth clásico en Android, BLE en iPhone) y arrancar rápido en un Android de gama baja,
con un solo desarrollador para mantenerla.

## Opciones

1. **Expo (React Native):** interfaz nativa escrita otra vez con los mismos esquemas y reglas de
   `packages/shared`; ecosistema maduro de Bluetooth y SQLite.
2. **Capacitor:** la misma web (React, Tailwind, Radix) dentro de una vista nativa, con complementos
   para lo nativo; reutiliza casi toda la interfaz.

## Criterio de decisión

Una prueba de 2 a 3 días con cada opción. Cada prueba debe:

- leer un lector RFID Bluetooth;
- guardar y consultar datos sin conexión con SQLite;
- sincronizar con la API según el ADR-012 (`id` del cliente, `Idempotency-Key`, `version`);
- medir el tamaño de la app y el tiempo de arranque en un Android de gama baja.

Pesan también:

- cuánta interfaz se reutiliza;
- el mantenimiento con un solo desarrollador;
- el soporte de Bluetooth clásico en Android y de BLE en iPhone (para PES-03).

## Decisión

Pendiente. Se registra aquí, con los resultados de las dos pruebas, antes de M12. Mientras tanto,
todo lo que en el 04, el 06 y el 07 menciona Expo depende de este ADR.

## Consecuencias

- La prueba es la primera tarea de la fase 2 (07 §5).
- `packages/shared` sigue sin APIs de Node (ADR-003): sirve a cualquiera de las dos opciones.

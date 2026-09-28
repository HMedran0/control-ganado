# ADR-010 — «Hoy» de la API: fecha real salvo `CLOCK_FIXED_TODAY` en pruebas

- **Fecha:** 2026-09-28
- **Estado:** Aceptada
- **Hito:** M4c
- **Afecta:** `apps/api/src/infra/clock.service.ts`, `apps/api/src/config/env.schema.ts`, `.env.example`, `apps/web/playwright.config.ts`

## Contexto

Hasta M4b, el `Clock` de la API leía `SEED_TODAY`, la misma variable que fija el «hoy» de la
finca de referencia (08 §3, `2026-09-25`). Como el `.env` de desarrollo la trae para que
`pnpm db:seed` funcione, la API de desarrollo quedaba congelada en esa fecha sin que nadie lo
pidiera, y la web —que propone la fecha real del navegador— recibía `DATE_IN_FUTURE` al
registrar algo «hoy». En M4b se rodeó en Playwright pasándole a la API la fecha real de Bogotá
como `SEED_TODAY`, es decir, usando la variable del seed para lo contrario de su propósito.

Una sola variable tenía dos dueños: el seed, que necesita una fecha fija para ser determinista,
y el reloj de la API, que en producción debe ser siempre el real. Un `SEED_TODAY` olvidado en un
servidor habría congelado alertas, edades y vencimientos sin ningún error visible.

## Decisión

1. `SEED_TODAY` es **solo del seed** (`prisma/seed/guards.ts`) y de sus pruebas. La API no la
   lee: `parseEnv` la descarta como cualquier variable desconocida.
2. El `Clock` devuelve la fecha real en `APP_TIMEZONE` (America/Bogota). Solo si está definida
   `CLOCK_FIXED_TODAY` (`AAAA-MM-DD`, fecha real) devuelve esa fecha fija.
3. `CLOCK_FIXED_TODAY` es **solo para pruebas**. Con `NODE_ENV=production`, `parseEnv` la
   rechaza y la API no arranca, con el mensaje «CLOCK_FIXED_TODAY es solo para pruebas: quítala
   del entorno de producción (ADR-010)».
4. Las pruebas de integración no dependen de variables: fijan «hoy» con `FakeClock`
   (`test/helpers/app.ts`), y `applyTestEnv` borra `CLOCK_FIXED_TODAY` heredada del entorno.
5. Las pruebas de extremo a extremo usan la fecha real, igual que el navegador. Se retira el
   arreglo de M4b en `playwright.config.ts`.

`GET /health` sigue informando `today` y `clockFixed`, y el arranque registra
`clockFixedToday` en el log, para detectar una fecha fija olvidada.

## Consecuencias

- `pnpm dev` trabaja con la fecha de hoy aunque el `.env` traiga `SEED_TODAY`. Las cifras
  exactas del seed (284 activos, 14 terneras pendientes de brucelosis…) solo se cumplen con
  «hoy» = `2026-09-25`; quien quiera verlas en la web levanta la API con
  `CLOCK_FIXED_TODAY=2026-09-25`.
- Las pruebas de extremo a extremo no pueden afirmar cifras que dependan de la edad o de los
  vencimientos: con la fecha real, cambian con los días. Las cifras exactas se prueban en la
  API con `FakeClock` (`seed.e2e-spec.ts`, `classification-equivalence.e2e-spec.ts`).
- Un error de configuración en producción se detecta al arrancar, no semanas después.

## Alternativas descartadas

| Alternativa                                                    | Por qué no                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Seguir leyendo `SEED_TODAY` en la API y quitarla del `.env`    | El seed la necesita en el mismo `.env`; volvería el conflicto.                                               |
| Ignorar `CLOCK_FIXED_TODAY` en producción en vez de rechazarla | Una configuración que se ignora en silencio esconde el error; mejor no arrancar.                             |
| Sin variable: fijar «hoy» solo con `FakeClock`                 | Las pruebas manuales de la web con las cifras del seed no tendrían forma de fijar la fecha sin tocar código. |

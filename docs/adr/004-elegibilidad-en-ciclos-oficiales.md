# ADR-004 — Elegibilidad en los ciclos oficiales de vacunación

- **Fecha:** 2026-09-26
- **Estado:** Aceptada
- **Hito:** decidido en M0.2, corregido y formalizado al abrir M0.3a
- **Afecta:** `packages/shared/src/domain/vaccination.ts`, RN-13 del SRS

## Contexto

RN-13 dice, para las vacunas de tipo `OFFICIAL_CYCLE`: «animal activo elegible sin aplicación
de esa vacuna entre inicio y fin del ciclo en curso → pendiente; del último ciclo cerrado →
vencida». La regla no decía qué pasa con los animales que **no estaban en la finca** durante
ese ciclo, y en la finca de referencia eso no es un caso raro:

- El ciclo 2026-1 cerró el 23 de junio de 2026. Un ternero nacido el 1 de julio no pudo
  vacunarse en él.
- Lo mismo vale para un animal **comprado** en agosto: existía, pero no en esta finca. Su
  vacunación de ese ciclo, si la hubo, la registró el hato anterior y el RUV no es de esta
  finca.

Aplicando RN-13 al pie de la letra, los dos aparecerían con aftosa **vencida** el día que se
registran. Con 284 animales activos y dos ciclos al año, eso convierte la alerta en ruido: el
operario aprende a ignorar una lista que siempre tiene vencidos falsos, que es exactamente el
riesgo que RNF-03 quiere evitar.

En M0.2 se implementó una primera versión que solo miraba la fecha de nacimiento, y quedó
registrada únicamente como comentario en el código. Esta decisión la corrige y la formaliza.

## Decisión

Para las vacunas `OFFICIAL_CYCLE`, un animal **no es elegible** para un ciclo si no estaba en
la finca cuando el ciclo cerró:

```
inFarmSince = max(birthDate, entryDate)
si inFarmSince > cycle.endsOn  →  NOT_APPLICABLE / NOT_IN_FARM_DURING_CYCLE
```

`Animal.entryDate` ya existe en el modelo de datos: es igual a `birthDate` en los animales
nacidos en la finca y posterior en los comprados, así que la regla cubre los dos casos con una
sola comparación. Se toma el **máximo** de las dos fechas para que un dato inconsistente (un
ingreso anterior al nacimiento, posible al importar desde Excel) no haga elegible a un animal
que todavía no había nacido.

El día del cierre **cuenta** como estar en la finca: un animal que ingresó el 23 de junio sí
era elegible para el ciclo que cerró el 23 de junio.

La regla se aplica igual al ciclo en curso: si el animal ingresó durante el ciclo abierto,
queda `PENDING`, porque todavía puede vacunarse.

`docs/01-srs.md` RN-13 se actualizó en el mismo commit para decir lo mismo. La especificación y
el código no pueden discrepar en una regla de alertas.

## Consecuencias

- `AnimalForVaccine` pide `entryDate` además de `birthDate`. Quien llame a `vaccineStatus`
  tiene que leer esa columna; el tipo lo obliga.
- El estado `NOT_APPLICABLE` con motivo `NOT_IN_FARM_DURING_CYCLE` es informativo: la ficha del
  animal puede explicar por qué no hay alerta, en lugar de no mostrar nada.
- Un animal comprado **sin** vacunación de aftosa registrada no queda marcado para el ciclo ya
  cerrado, pero sí para el siguiente. Es lo correcto en la práctica: lo que se puede exigir es
  que se vacune en el próximo ciclo.
- El reporte de progreso de un ciclo (`GET /vaccination-cycles/:id/progress`, M6) debe usar la
  misma función para que el denominador no incluya animales que no podían vacunarse.

## Alternativas descartadas

| Alternativa                                              | Por qué no                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| RN-13 literal: todo animal activo elegible queda vencido | Genera vencidos falsos para cada cría nacida y cada animal comprado después del ciclo; vuelve inútil la alerta.   |
| Mirar solo `birthDate` (lo implementado en M0.2)         | Resuelve las crías, no los comprados. Un animal comprado en agosto seguía apareciendo vencido del ciclo de junio. |
| Marcarlos pendientes en lugar de no aplicables           | Pide vacunar contra un ciclo que ya cerró; el vacunador de Fedegán no puede expedir un RUV de un ciclo terminado. |
| Guardar en el animal un campo «exento del ciclo X»       | Dato derivable convertido en almacenado, contra RN-16, y una casilla más que alguien tiene que mantener a mano.   |

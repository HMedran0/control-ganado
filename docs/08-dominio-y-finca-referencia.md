# Dominio ganadero, finca de referencia y decisiones

Este documento cierra las preguntas abiertas del SRS (§9). Cada decisión indica su origen:

- **[Real]**: práctica o norma verificada en fuentes del sector (enlaces al final).
- **[Ficticio]**: dato inventado para una finca de referencia coherente. Sirve para construir, sembrar datos y probar. Debe reemplazarse cuando se valide con la finca real, sin cambiar código: todo lo ficticio vive en configuración o en el seed.
- **[Validar]**: valor por defecto razonable que debe confirmarse con la finca o el veterinario (introducido en `09-ampliacion-validacion-ganaderos.md`). Vive siempre en configuración, nunca fijo en el código.

Regla para Claude Code: **no inventar reglas de dominio nuevas**. Si algo no está aquí ni en el SRS, preguntar.

---

## 1. Decisiones sobre las preguntas abiertas

### 1.1 ¿Qué es "ganado cotero"? — [Real + decisión]
No existe una categoría zootécnica estándar con ese nombre. En el español de Colombia, "cotero" designa a quien carga bultos, y el enunciado define el ganado cotero como "animales destinados a labores o clasificación específica de la finca".
**Decisión:** `COTERO` es una **etiqueta manual del sistema** (no derivada) con descripción editable por la finca. Por defecto: "Animal destinado a trabajo (carga, tiro) o a un uso específico definido por la finca". La finca puede crear etiquetas manuales adicionales (CLS-02). No afecta ningún cálculo.

### 1.2 Edad de destete — [Real]
En sistemas de cría y doble propósito en Colombia el destete se hace alrededor de los **7 meses** (rango 6–7,7 meses; UPRA, 2024; CONtexto Ganadero, 2022).
**Decisión:** `weaningAgeMonths = 7` por defecto (antes 9), configurable.

### 1.3 ¿Desde cuándo una hembra está "preñada"? — [Real]
El diagnóstico de gestación se hace por palpación o ecografía semanas después del servicio.
**Decisión (sin cambios):** "Servida" desde el servicio; "Preñada" solo con diagnóstico positivo. Alerta "Servida sin diagnóstico" a los 90 días del servicio.

### 1.4 Duración de la gestación — [Real]
La gestación del ganado cebuino es más larga que la del europeo: en Brahman, 292,8 días en promedio (Plasse et al., 1968); en razas europeas se usa ~283 días.
**Decisión:** la raza tiene un **grupo** y una **duración de gestación** propia. La fecha estimada de parto usa la gestación de la raza de la madre; si no tiene, usa el valor de la finca.

| Grupo | Razas semilla | Gestación por defecto |
|---|---|---|
| `INDICUS` | Brahman, Cebú comercial, Gyr, Guzerá, Nelore | 293 días |
| `TAURUS` | Holstein, Pardo suizo, Simmental, Angus, Romosinuano, Costeño con cuernos, Blanco orejinegro | 283 días |
| `CROSS` | Cruce, Girolando, Brahman × Pardo | 288 días |
| (finca) | raza sin valor | `gestationDays` de la finca = 285 |

Nota: Romosinuano y Costeño con cuernos son criollos (taurinos); el valor es configurable.

### 1.5 Vacunas: plan oficial y plan de la finca — [Real]
En Colombia, la vacunación contra **fiebre aftosa**, **brucelosis bovina** y **rabia de origen silvestre** se hace en **dos ciclos oficiales al año**, ejecutados por vacunadores de Fedegán, que expiden el **Registro Único de Vacunación (RUV)**. En 2026 el primer ciclo fue del 4 de mayo al 23 de junio; en 2025 el segundo ciclo fue del 27 de octubre al 16 de diciembre (ICA).
- **Aftosa:** todos los bovinos y bufalinos, en cada ciclo (salvo zonas libres sin vacunación).
- **Brucelosis:** solo **hembras de 3 a 9 meses** (Cepa 19 o RB51); revacunación con RB51 entre **9 y 15 meses**; **prohibido en machos**.
- **Rabia silvestre:** obligatoria solo en zonas de riesgo.
- Otras vacunas (por ejemplo, clostridiales o "triple") son decisión de la finca y su veterinario.

**Decisión:** la vacuna tiene un **tipo de programación**:

| `scheduleType` | Cómo se calcula lo pendiente | Ejemplo |
|---|---|---|
| `OFFICIAL_CYCLE` | Pendiente si el animal elegible no tiene aplicación dentro del ciclo oficial en curso (o del último ciclo cerrado, como vencida). | Aftosa, rabia silvestre |
| `AGE_WINDOW` | Pendiente si el animal cumple la regla de elegibilidad (sexo, edad) y no tiene aplicación de esa vacuna. Vencida al pasar la edad máxima. | Brucelosis (hembras 3–9 m) |
| `INTERVAL` | Próxima fecha = aplicación + intervalo (comportamiento original). | Clostridial anual |
| `NONE` | Sin alerta. | Aplicaciones esporádicas |

Cada vacuna tiene elegibilidad opcional: `eligibleSex`, `minAgeDays`, `maxAgeDays`. Los ciclos oficiales se configuran por finca (fechas de inicio y fin por año). La vacunación guarda opcionalmente el **número de RUV**. El sistema **bloquea** registrar brucelosis en machos (regla oficial).

### 1.6 Identificación en uso — [Real + Ficticio]
**[Real]** El DIN colombiano (Resolución ICA 338 de 2012) es un arete **amarillo** que se aplica en el cartílago de la oreja y puede ser solo visual o combinado con un dispositivo electrónico (botón RFID o bolo ruminal). El código individual identifica de forma única al bovino; el chip RFID usa el estándar ISO 11784/11785 (15 dígitos, código de país 170 para Colombia).
**[Ficticio]** La finca de referencia usa chapetas plásticas propias numeradas, hierro de la finca en los adultos, y DIN oficial solo en los terneros identificados en 2026.
**Decisión de validación:**
- `RFID`: se admiten chips ISO 11784/11785 (FDX-B o HDX) de 15 dígitos. No se admiten formatos que no sean ISO, como los chips de mascotas de 10 caracteres. Menos o más de 15 dígitos bloquea. Los tres primeros dígitos son el código de país (ISO 3166: `170` para Colombia) o el de un fabricante (`900` a `998`), que es como vienen muchos chips inyectables y bolos ruminales; con cualquier otro prefijo (otro país, el `999` de los transpondedores de prueba) se advierte «Prefijo poco común: verifica el número», sin bloquear (ajuste previo de M9; antes se advertía todo lo que no empezaba por `170`).
- `RFID`, dónde va el chip (`carrier`, opcional): en un arete (`EAR_TAG`), inyectado bajo la piel (`INJECTABLE`) o en un bolo ruminal (`BOLUS`). Se elige al registrarlo, la ficha lo muestra («Chip inyectable 982 000123456789») y la plantilla de importación tiene la columna «Dónde va el chip». Al reemplazar un chip, el nuevo va donde iba el anterior. Dónde se aplica el inyectable en la finca es pregunta para el piloto (09 §6, pregunta 11).
- `DIN`: se guarda normalizado (mayúsculas, sin espacios ni guiones). Sin patrón estricto hasta verificar el formato oficial vigente.
- `VISUAL_TAG`: texto libre normalizado.

### 1.7 Lector RFID y báscula — [Ficticio]
La finca de referencia **no tiene** lector ni báscula. Pesa con **cinta bovinométrica** (método `TAPE`). Consecuencia: el MVP no depende de hardware; el modo teclado del lector se prueba con un lector en préstamo o simulando la ráfaga de dígitos.

### 1.8 Usuarios, correo y dispositivos — [Ficticio]
El mayordomo y el vaquero **no tienen correo**. Consecuencia: **el inicio de sesión es con nombre de usuario** (el correo es opcional para OPERATOR y VET, y obligatorio para ADMIN). Ver §2.4.

### 1.9 Conectividad — [Ficticio, coherente con la región]
Casa de la finca: 4G intermitente (1–2 barras). Manga y potreros lejanos: sin señal. El administrador también consulta desde el pueblo con buena señal.
Consecuencia: confirma la prioridad de la app móvil sin conexión (fase 2) y de los borradores locales en la web (fase 1).

### 1.10 Lotes — [Real + Ficticio]
Las fincas de doble propósito agrupan el ganado por estado productivo. Lotes semilla: **Paridas** (vacas con cría al pie), **Horras y novillas**, **Levante** (machos destetados), **Toros**.

### 1.11 Tipo de finca — [Ficticio]
**Cría y doble propósito** (leche y carne), típica de los Montes de María: `productionSystem = DOBLE_PROPOSITO` (CFG-03). El control de leche entra como alcance extendido en M9b (LEC-01 a LEC-05, 09 §4.2); el seed de la finca incluye control lechero (§3.6). Su tablero (M8a) muestra las preguntas de cría (destete, intervalo entre partos, horras) y el retiro de leche hasta que exista el control lechero; sin `salesFocus`.

### 1.12 Gastos que se siguen por animal — [Ficticio]
- Directos: compra, medicamentos y tratamientos individuales, veterinario por caso, transporte de un animal.
- Compartidos (repartidos): sal mineralizada, suplemento, vacunación de ciclo, desparasitación de lote.
- **No se asigna a animales**: mano de obra, arriendo, mantenimiento de cercas y pastos. Desde M7 se registran como **gasto general** de la finca (ECO-01 CA3): no entran en la inversión de ningún animal y sí en los gastos del período.

---

## 2. Ajustes al modelo derivados de las decisiones

### 2.1 Categoría de manejo (exclusiva) + etiquetas (combinables)
Las fincas colombianas usan categorías de manejo (ternero, novilla, vaca, levante, toro) además de estados reproductivos. El enunciado pide "ganado parido", "preñado", "terneros" y "terneras". Para cubrir ambos:

**Categoría de manejo** (cada animal activo tiene exactamente una, derivada):

| Código | Nombre en UI | Regla |
|---|---|---|
| `CALF_MALE` | Ternero | Macho, edad < destete |
| `CALF_FEMALE` | Ternera | Hembra, edad < destete |
| `HEIFER` | Novilla | Hembra, edad ≥ destete, sin partos |
| `COW` | Vaca | Hembra con al menos un parto |
| `YOUNG_MALE` | Levante | Macho, edad ≥ destete y < 24 meses |
| `ADULT_MALE` | Toro / macho adulto | Macho, edad ≥ 24 meses |

**Etiquetas derivadas** (combinables): `SERVED` Servida · `PREGNANT` Preñada · `CALVED` Parida (n partos) · `DRY` Horra · `WITHDRAWAL` En retiro. Con el control de leche (M9b, 09 §4.2): `LACTATING` En ordeño · `DRIED_OFF` Seca.
- **Horra** [Real, término de uso común]: vaca no preñada ni servida cuyo último parto fue hace ≥ edad de destete (sin cría al pie).
- **Seca** [Real]: vaca a la que se le suspendió el ordeño y que aún no vuelve a parir. **No confundir con Horra:** la constante `DRY` significa Horra y no se renombra (ya está implementada y probada); «seca» es `DRIED_OFF`. La aclaración va también en el glosario del SRS y en un comentario junto a la constante.

**Etiquetas manuales:** `COTERO`, "Disponible para venta" y las que defina la finca.

### 2.2 Reporte por grupos de edad del ICA — [Real]
El ICA agrupa la población bovina por sexo y edad. Se agrega el reporte **"Inventario por grupos de edad (formato ICA)"**, útil para trámites y ciclos de vacunación:
- Hembras: < 3 meses · 3–9 meses · 9–12 meses · 1–2 años · 2–3 años · 3–5 años · > 5 años.
- Machos: < 3 meses · 3–9 meses · 9–12 meses · 1–2 años · 2–3 años · > 3 años.

Formato del reporte (M8b, ADR-018) [Validar con el ICA y la finca, 09 §6 pregunta 10]: la finca, su municipio y departamento, el código de predio ICA y la fecha de corte (hoy); una tabla por sexo con sus grupos en este orden, los que están en cero también, y el total de cada sexo y del hato. La edad es en meses cumplidos (ADR-002) al día de corte, sobre los animales activos.

### 2.3 Código de las crías — [Real, práctica común + decisión]
Es común numerar los animales con el año de nacimiento. **Patrón configurable** `calfCodePattern`, por defecto `{YY}-{NNN}` (por ejemplo, `26-045`: año 2026, consecutivo 45 del año). Tokens: `{YYYY}`, `{YY}`, `{NNN}` (consecutivo del año con ceros), `{N}` (consecutivo sin ceros). El sistema sugiere el siguiente código libre; el usuario puede cambiarlo.
Los animales existentes conservan el código que ya tienen (en la finca de referencia, números de tres dígitos: `001`–`350`).

**Numeración reutilizable** [Real, 09 §2]: muchas fincas numeran 1, 2, 3… y le dan el número de un animal vendido a uno nuevo. La finca elige en Configuración `codeReuse` (por defecto `false`) y `codeSuggestion` (`PATTERN` o `LOWEST_FREE`) (ANI-10). El historial nunca se mezcla: pertenece al identificador interno del animal, no a su número (RN-33). DIN y RFID son de por vida y nunca se reasignan (RN-32). La finca de referencia sigue con `codeReuse = false` y `PATTERN`; la segunda finca de pruebas usa numeración reutilizable (§3.5).
Nota: los códigos del prototipo visual (`P-12`, `T-245`) son ilustrativos.

### 2.4 Inicio de sesión
`username` obligatorio y único (minúsculas, 3–30 caracteres, `[a-z0-9._-]`). El `email` es **obligatorio para quien tenga membresía ADMIN** y opcional para OPERATOR y VET (09 §5); se guarda y se compara normalizado (sin espacios, en minúsculas). El login acepta usuario o correo.

Desde M10a el ADMIN invita por correo (AUT-13), los correos se verifican antes de usarse para recuperar la contraseña o entrar con Google (AUT-14), y se puede entrar con Google si el correo coincide con un usuario existente verificado o con una invitación (AUT-15). No hay registro abierto (REG-01, futuro). Quien no tiene correo sigue entrando con usuario y la contraseña temporal que le crea el ADMIN.

### 2.5 Importación del inventario inicial — nuevo requisito ANI-09
Las soluciones en uso lo confirman: Control Ganadero (Apptank) promueve el paso de datos desde Excel y Progan ofrece un módulo de importación con mapeo automático de campos y validación en tiempo real (por ejemplo, rechaza partos registrados a machos). Ver SRS ANI-09 y la plantilla `docs/referencia/plantilla-importacion.xlsx`.

---

## 3. Finca de referencia (datos ficticios)

Todos los nombres, cifras y valores de esta sección son **ficticios**.

| Dato | Valor |
|---|---|
| Nombre | Finca La Esperanza |
| Ubicación | Vereda Loma Grande, San Juan Nepomuceno, Bolívar |
| Área | 180 ha en 9 potreros |
| Sistema | Cría y doble propósito |
| Código de predio ICA | `13657-0000-0001` (formato ilustrativo) |
| Zona de riesgo de rabia silvestre | Sí |
| Hierro | "LE" |
| Registros actuales | Cuaderno por año (partos y servicios), hojas del RUV, facturas en una carpeta, y un Excel básico de inventario que lleva el hijo del propietario |

### 3.1 Usuarios
| Usuario | Nombre | Rol | Correo | Dispositivo |
|---|---|---|---|---|
| `alvaro` | Álvaro Pérez Castro | ADMIN (propietario) | alvaro@demo.co | Android gama media y portátil |
| `wilmer` | Wilmer Ortega | OPERATOR (mayordomo) | — | Android gama baja |
| `yeison` | Yeison Mendoza | OPERATOR (vaquero) | — | Android gama baja |
| `paola.vet` | Dra. Paola Barrios | VET (visita cada 15 días) | vet@demo.co | Android gama alta |

### 3.2 Hato activo (284 animales)
| Categoría | Cantidad | Detalle |
|---|---:|---|
| Vacas | 118 | 64 preñadas confirmadas (2 con el parto vencido sin registrar, M5), 11 servidas sin diagnóstico (3 con más de 90 días), 72 con cría al pie, 29 horras; partos por vaca entre 1 y 7 |
| Novillas | 34 | 12 servidas, de ellas 7 preñadas |
| Terneros | 38 | < 7 meses |
| Terneras | 36 | < 7 meses; 14 entre 3 y 9 meses sin brucelosis (pendientes) |
| Levante | 52 | 14 marcados "Disponible para venta" |
| Toros | 4 | 2 Brahman, 1 Gyr, 1 Romosinuano; desde M8a con la etiqueta del sistema «Reproductor» (sin peso de venta) |
| Coteros | 2 | Bueyes adultos con etiqueta COTERO (cuentan como machos adultos) |

Distribución de razas: Brahman comercial 40 %, Brahman × Pardo 30 %, Girolando 20 %, Romosinuano 10 %.
Método reproductivo: 85 % monta natural, 15 % inseminación artificial (pajillas externas, `sireExternalRef`).
Historial sembrado: 3 años (2024–2026) de partos, servicios, vacunas de ciclo con RUV, pesajes con cinta cada 3 meses en levante, 10 ventas y 3 muertes. Desde M6, cinco levantes con alertas de peso el 25/09/2026: tres ganaron solo 15 kg entre el 15/06 y el 15/09 (0,163 kg/día) y dos perdieron el 8 % (también cuentan como ganancia baja): 5 con «Ganancia baja» y 2 con «Perdió peso». Dos animales siguen en retiro de medicamento.

### 3.3 Plan sanitario de referencia
| Vacuna | Tipo | Regla |
|---|---|---|
| Aftosa | `OFFICIAL_CYCLE` | Todos, cada ciclo |
| Brucelosis RB51 | `AGE_WINDOW` | Hembras de 90 a 270 días; bloqueada en machos |
| Rabia silvestre | `OFFICIAL_CYCLE` | Todos (finca en zona de riesgo) |
| Clostridial polivalente | `INTERVAL` 365 días | Todos desde 3 meses (valor ficticio, validar con veterinario) |

Ciclos oficiales configurados: 2025-2 (27/10/2025–16/12/2025) [Real], 2026-1 (04/05/2026–23/06/2026) [Real], 2026-2 (01/11/2026–15/12/2026) [**Ficticio**, reemplazar al publicarse].

### 3.4 Valores económicos de referencia
Todos **ficticios**, solo para pruebas: compra de novilla $2.800.000; sal mineralizada $180.000 por bulto repartido en el lote; tratamiento individual $35.000–$120.000; precio de referencia en pie $7.800/kg.

Desde M7 (`apps/api/prisma/seed/finance-cases.ts`, con su propio generador e identificadores para no mover nada anterior): desparasitación del lote de levante el 16/09/2026 por $312.000 repartida **según el peso** entre los 54 levantes con pesaje; arreglo de la cerca del potrero La Loma ($650.000, 20/08/2026) y jornales de vaquería ($480.000, 05/09/2026) como **gastos generales**; un bulto de sal del 08/07/2026 registrado dos veces y **anulado** al otro día; y un **avalúo a mano** del toro reproductor ($7.200.000, 01/09/2026). Las cifras están en `EXPECTED_FINANCE`.

### 3.5 Segunda finca de pruebas: Finca El Retiro — [Ficticio] (M4c)
Finca pequeña para probar la numeración reutilizable (ANI-10, ANI-11, IDN-06). No cambia ninguna cifra de la finca de referencia.
- `codeReuse = true`, `codeSuggestion = LOWEST_FREE`, numeración 1–40.
- Al menos dos números reutilizados: un animal vendido y otro activo con el mismo número, cada uno con su propio historial.
- Un animal vendido con chapeta liberada (`EXITED`) y DIN y RFID que siguen asociados a él (RN-32).
- Un ADMIN propio con correo, para las pruebas de aislamiento por finca.
- Desde M8a, **finca de levante y ceba** que vende machos (`productionSystem = LEVANTE_CEBA`, `salesFocus = MALES`), con ocho machos comprados el 20/05/2026 (códigos 41 a 48, `apps/api/prisma/seed/retiro-ceba.ts`, con su propio generador): en el lote **Ceba A**, el 41 y el 42 llegan a 450 kg este mes (28/09 y 30/09, a 0,8 kg/día), el 43 ya pasó los 450 kg, el 44 tiene más de 24 meses («Toro») y también llega este mes, y el 45 debería estar en el peso según su ganancia pero su último pesaje es de julio; en **Ceba B**, el 46 y el 47 ganan menos de 0,30 kg/día; el 48 es el toro reproductor, con la etiqueta «Reproductor». El Retiro pasa de 41 animales (38 activos) a 49 (46 activos); las cifras de La Esperanza no cambian. Sus cifras del tablero están en `EXPECTED_DASHBOARD`.
- Desde M8b, los machos de M4c (del 1 al 40) ganan de 0,4 a 0,7 kg/día entre pesajes hasta un peso adulto de 550 kg [Ficticio], para que los días para la venta (244 en promedio) y las fechas estimadas sean creíbles; antes su peso subía y bajaba de un pesaje a otro y el promedio pasaba de mil días. Las hembras y los casos de ceba del 41 al 48 no cambian.

### 3.6 Control lechero del seed — [Ficticio] (M9b)
La finca de referencia (doble propósito) recibe 90 días de control lechero coherente para sus vacas en ordeño y algunos secados. Producción por vaca entre 4 y 10 litros diarios, consistente con UPRA (2024), que reporta 5,69 a 9,88 litros por vaca al día en doble propósito. Las cifras esperadas (vacas en ordeño, secas, secar pronto, producción de ayer y del mes) se agregan a `expected.ts` en M9b.

### 3.7 Parámetros por sistema productivo — [Validar]
Valores por defecto de `Farm.settings`, confirmables con la finca o el veterinario (09 §3 y §4):
- `dryOffBeforeCalvingDays = 60` (la práctica común es secar 45 a 60 días antes del parto) [Real].
- `weightGainAlertKgPerDay`: 0,30 kg/día para Levante; por categoría de manejo.
- `weightLossAlertPercent = 5`.
- `weightGainAnchorMaxDays = 180` (M6, ADR-015): el último pesaje anterior a la ventana de 90 días completa la ganancia si está a lo sumo a 180 días del inicio de la ventana; así una finca que pesa cada tres meses tiene ganancia de 90 días. Confirmar con la finca y el veterinario.
- `targetSaleWeightKg`: 450 kg en machos de Levante y en los de 24 meses o más (Toro) [Validar] (M8a). En la ceba colombiana se venden novillos de 24 a 36 meses, que la clasificación por edad llama «Toro»; los reproductores no tienen peso de venta: se marcan con la etiqueta del sistema «Reproductor» (`REPRODUCTOR`, como COTERO). Pendiente con la finca piloto: cómo llaman a ese macho y si separan los reproductores (09 §6, preguntas 7 y 8).
- Orden de los reportes por sistema productivo (M8b, `reportOrder`) [Validar, 09 §6 pregunta 9]: cría y doble propósito empiezan por partos próximos y nacimientos; levante y ceba, por inventario, vendidos y retirados y el reporte económico; lechería, por partos próximos e inventario; ciclo completo, por inventario, partos y nacimientos.
- `overdueCalvingAlertDays = 15` (M5): días después del parto estimado de una preñez abierta para la alerta «Parto vencido sin registrar» (RN-39). Decisión de la sesión de M5; confirmar con la finca y el veterinario.

---

### 3.8 Tercera finca de pruebas: Finca La Nueva — [Ficticio] (M4d)
Finca recién creada para probar la importación del inventario (ANI-09) con la plantilla de referencia, cuyos códigos (087, 012, 26-031…) chocarían con los de La Esperanza. No cambia ninguna cifra de las otras dos fincas.
- Sin animales. Las mismas razas (con su grupo y gestación) y los mismos lotes que La Esperanza, que son los que usa la plantilla.
- Un ADMIN propio con correo, `nueva.admin`.
- Las pruebas de extremo a extremo importan en ella la plantilla una vez (en escritorio): hay que volver a sembrar la base de pruebas antes de repetirlas.

**Decisión de la importación (M4d).** La plantilla de referencia trae a Canela (087, nacida en 2019) con padre 012, un toro nacido en 2020. Un padre más joven que la cría no puede ser ese animal: con numeración reutilizable, lo normal es que sea otro con el mismo número. La importación guarda lo escrito como referencia externa del padre y avisa; la madre sí se exige (ANI-09 CA4).

## 4. Alcance núcleo y orden de construcción

Para asegurar un producto evaluable aunque el semestre se complique:

| Nivel | Hitos | Contenido |
|---|---|---|
| **Núcleo** (debe estar para el piloto) | M0–M6 (M4a a M4d), M8, M10a | Autenticación con sesión deslizante, animales, identificación, numeración reutilizable, **importación**, reproducción y partos, vacunación con alertas y ciclos, pesos con importación de la báscula, tablero por sistema productivo y reportes, correo, invitación, recuperación de contraseña y acceso con Google |
| **Completo** | M7, M9, M9b, M10b | Finanzas con reparto de gastos, jornadas en web, control de leche, endurecimiento y despliegue |
| **Fase 2** | M12–M17 | Móvil sin conexión, lector RFID Bluetooth, pesaje en vivo con indicador Tru-Test (PES-03), ordeño sin conexión |

M10b (despliegue y respaldos) es obligatorio antes de cargar datos reales, aunque esté en "Completo". Si el cronograma no alcanza, M9b pasa a la fase 2 y después AUT-15 (Google); AUT-12 a AUT-14 no se recortan (09 §6).

## 5. Decisiones de infraestructura — [Ficticio/por defecto]
- Repositorio privado en GitHub llamado `hato`, rama principal `main`, integración continua con GitHub Actions.
- Servidor: VPS con 2 vCPU, 4 GB de RAM y Ubuntu 24.04 LTS, en cualquier proveedor. Dominio configurable por variable de entorno (`PUBLIC_WEB_URL`); para demo, un subdominio del dominio que se adquiera.
- Respaldos en almacenamiento compatible con S3 (Backblaze B2 o Cloudflare R2).

---

## Fuentes
- ICA (2026). Primer ciclo de vacunación contra la fiebre aftosa 2026. https://www.ica.gov.co/noticias/ica-primer-ciclo-vacunacion-fiebre-aftosa-2026
- ICA (2025). Fechas del segundo ciclo de vacunación 2025. https://www.ica.gov.co/noticias/fechas-segundo-ciclo-vacunacion
- ICA. Vacunación contra brucelosis bovina. https://www.ica.gov.co/areas/pecuaria/servicios/enfermedades-animales/brucelosis-bovina-1/vacunacion-brucelosis.aspx
- ICA. Población bovina por sexo y categorías de edad. https://www.ica.gov.co/areas/pecuaria/servicios/enfermedades-animales/fiebre-aftosa/instructivo-cuadro3-poblacion-marco-final-poblacio.aspx
- ICA (2012). Resolución 338 de 2012 (Norma DIN). https://faolex.fao.org/docs/pdf/col118137.pdf
- UPRA (2024). Sistema productivo en ganadería bovina doble propósito. https://upra.gov.co/sites/default/files/2025-03/01_CosProdBov2_20241223.pdf
- CONtexto Ganadero (2022). ¿Cuál es la edad ideal para destetar terneros en ganaderías de cría? https://www.contextoganadero.com/ganaderia-sostenible/cual-es-la-edad-ideal-para-destetar-terneros-en-ganaderias-de-cria
- Plasse, D., Warnick, A. C., Reese, R. E. y Koger, M. (1968). Gestation length in Brahman cattle. Journal of Animal Science, 27(1), 101–104. https://academic.oup.com/jas/article-abstract/27/1/101/4701303
- Progan Software Ganadero. Módulo de importación Excel. https://progansoftware.com/importacionexcel/
- Control Ganadero (Apptank). App Store. https://apps.apple.com/co/app/control-ganadero/id664392203
- Google (s. f.). OpenID Connect. Google Identity. https://developers.google.com/identity/openid-connect/openid-connect
- Congreso de Colombia (2012). Ley 1581 de 2012, protección de datos personales. https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981

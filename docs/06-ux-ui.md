# Diseño UX/UI

## 1. Para quién diseñamos

| Persona | Situación | Lo que necesita de la interfaz |
|---|---|---|
| **Don Álvaro, administrador** (55 años) | Revisa el hato desde el celular en la mañana y desde un computador en la oficina de la finca. | Respuestas inmediatas: cuántas hay, cuáles paren, qué falta vacunar, cuánto lleva invertido. Sin navegar por menús. |
| **Wilmer, vaquero** (32 años) | Trabaja en la manga con el animal enfrente, bajo sol fuerte, manos sucias o con guantes, a veces sin señal. Usa WhatsApp con soltura, pero no formularios largos. | Encontrar al animal en segundos, registrar con pocos toques, letras grandes, no perder lo que registró. |
| **Dra. Paola, veterinaria** | Visita cada 15 días; palpa, vacuna y trata en jornadas de decenas de animales. | Registro rápido en serie, historial sanitario y reproductivo claro por animal. |

Principio rector: **diseño para la manga, no para la oficina.** Si una pantalla funciona para Wilmer con una mano y a pleno sol, funciona para todos.

## 2. Principios de diseño

1. **Buscar primero.** El animal es la unidad de todo. La búsqueda está siempre visible y acepta cualquier identificador.
2. **Responder, no mostrar datos.** El tablero se organiza como las preguntas reales del administrador, cada una con su respuesta y un toque para ver el detalle.
3. **Escribir lo menos posible.** Valores por defecto sensatos (fecha = hoy, vacuna de la jornada, raza de la madre), botones grandes en lugar de listas desplegables cuando hay pocas opciones, teclado numérico para pesos y códigos.
4. **Deshacer en vez de confirmar.** Para registros de rutina se guarda de inmediato con opción "Deshacer" durante unos segundos. Los diálogos de confirmación se reservan para acciones graves (salida, archivo, anulación).
5. **Legible a pleno sol.** Contraste alto, fondo claro, texto base de 17 px, nada de gris claro sobre blanco para información importante.
6. **Nunca perder trabajo.** Borradores automáticos, aviso claro de conexión y (en F2) operación completa sin señal.

## 3. Identidad visual

### 3.1 Concepto
El sistema toma sus señas del objeto más característico del manejo del ganado: **la chapeta**. El código de cada animal se muestra siempre con la forma y el color de un arete de identificación. Es el único elemento audaz; todo lo demás es sobrio y funcional.

### 3.2 Paleta

| Token | Hex | Uso |
|---|---|---|
| `--color-monte` | `#1F2A1E` | Texto principal, íconos. Verde casi negro, tomado del monte en sombra. |
| `--color-sabana` | `#F4F6F0` | Fondo de la aplicación. Blanco verdoso, descansa la vista al sol sin el tono crema genérico. |
| `--color-superficie` | `#FFFFFF` | Superficies elevadas (paneles, hojas). |
| `--color-potrero` | `#2E5A36` | Acción principal, enlaces, estados activos. |
| `--color-potrero-claro` | `#E3ECE1` | Fondos de selección y etiquetas neutras. |
| `--color-chapeta` | `#F5C518` | Solo para el componente Chapeta y el foco del lector. Texto encima siempre `--color-monte`. |
| `--color-cerca` | `#D5DACF` | Bordes y divisores. |
| `--color-texto-2` | `#4A5547` | Texto secundario (contraste ≥ 7:1 sobre sabana). |
| `--color-alerta` | `#B42318` | Vencido, error, acción destructiva. |
| `--color-aviso` | `#9A4B00` | Próximo a vencer, advertencias. |
| `--color-info` | `#1D4E89` | Información neutra, preñez. |
| `--color-info-claro` · `--color-alerta-claro` · `--color-aviso-claro` · `--color-neutro-claro` | `#E3EBF5` · `#FCEBEA` · `#FBEFE3` · `#E8EBE4` | Tintes de fondo para `Tag` y `AlertBanner` (M2b, tomados del prototipo). |
| `--color-info-intenso` · `--color-alerta-intenso` · `--color-aviso-intenso` | `#173F70` · `#8E1B12` · `#6E3500` | Texto principal sobre los tintes: con el tono base no se llega a 7:1 (el rojo de alerta no lo alcanza ni sobre blanco). |
| `--color-chapeta-borde` | `#C99E00` | Borde de la chapeta (`docs/referencia/prototipo/LEEME.md`). |

Contrastes exigidos por `apps/web/src/styles/tokens.test.ts`: 7:1 para el texto principal (también sobre los tintes, con los tonos intensos) y 4,5:1 para el texto de `Tag` (14 px en negrita).

Reglas: el amarillo de chapeta nunca se usa para botones ni alertas (perdería su significado). El rojo solo para lo que requiere acción. Modo oscuro: no en F1 (el contexto principal es exterior diurno); los tokens permiten agregarlo después.

### 3.3 Tipografía

| Rol | Fuente | Justificación |
|---|---|---|
| Interfaz y texto | **Atkinson Hyperlegible** (400, 700) | Diseñada para máxima distinción entre caracteres (1/l/I, 0/O, 5/S), clave para códigos y para usuarios con visión cansada o bajo sol. |
| Códigos de chapeta y cifras grandes | **Barlow Condensed** (600) con `font-variant-numeric: tabular-nums` | Evoca los números estampados de los aretes; condensada para que códigos largos quepan en la chapeta. |

Escala (px): 14 (auxiliar), 17 (base), 20, 24, 32, 44 (cifras del tablero). Interlineado 1,5 en texto, 1,15 en cifras. Longitud de línea máxima 70 caracteres.

### 3.4 Forma, espacio y movimiento
- Espaciado base 4 px; ritmo habitual 8 / 12 / 16 / 24 / 32.
- Radios con jerarquía: controles 8 px, hojas y paneles 12 px, chapeta con su silueta propia. No todo lleva el mismo radio.
- Sombras casi ausentes: se separa con bordes `--color-cerca` y cambios de fondo, no con sombras grises repetidas.
- Objetivo táctil mínimo 48 × 48 px; botones principales en móvil 56 px de alto y ancho completo.
- Movimiento solo como respuesta a una acción: la chapeta "entra" al leer un animal (150 ms), el aviso de "Guardado · Deshacer" se desliza desde abajo. Respetar `prefers-reduced-motion`.

### 3.5 Revisión contra diseños genéricos
Se descartó un tablero de tarjetas KPI idénticas con número grande y gradiente: se reemplazó por la lista de preguntas (§5.1), que nace del enunciado. Se descartó el fondo crema con acento terracota: la paleta sale del potrero y de la chapeta. No se usan etiquetas en mayúsculas sostenidas ni tipografía monoespaciada para datos.

## 4. Arquitectura de información y navegación

```
Inicio (preguntas del día + alertas)
Animales
  ├─ Listado con filtros
  ├─ Ficha del animal
  │    ├─ Resumen · Reproducción · Leche(M9b) · Sanidad · Pesos · Genealogía · Costos(A) · Historial · Cambios(A)
  │    └─ Acciones: vacuna, peso, servicio/parto, tratamiento, secado(M9b), salida y su reversión(A), archivar y restaurar(A)
  └─ Nuevo animal
Registrar (+)
  ├─ Parto · Servicio · Palpación
  ├─ Vacunación (individual o masiva)
  ├─ Pesaje · Importar pesaje de la báscula (M6) · Tratamiento
  ├─ Control de leche · Jornada de ordeño · Secado (M9b)
  ├─ Gasto (A)
  └─ Jornada de manejo
Alertas (vacunas, partos, servidas sin diagnóstico, retiros, ganancia baja, perdió peso; secar pronto en M9b)
Reportes
Más: Jornadas · Finanzas(A) · Configuración(A) · Mi cuenta (datos, correo, Sesiones, Google) · Salir
Configuración(A) → Finca (incluye Numeración de los animales, M4c) · Archivados (M4c)
Configuración(A) → Usuarios: crear usuario sin correo · Invitar por correo · invitaciones pendientes · cerrar las sesiones de un usuario
```

- **Móvil (< 768 px):** barra inferior fija con 5 destinos: Inicio · Animales · **Registrar** (botón central destacado) · Alertas · Más. Búsqueda fija en la parte superior de Inicio y Animales.
- **Escritorio (≥ 1024 px):** barra lateral izquierda con los mismos destinos + Reportes y Finanzas visibles; búsqueda en la barra superior con atajo `/`.
- Las rutas reflejan el estado (filtros, pestaña de la ficha) para poder compartir un enlace o volver atrás.

## 5. Pantallas clave (wireframes)

### 5.1 Inicio — "Preguntas del día" (móvil)
```
┌──────────────────────────────────┐
│ Finca La Esperanza        ⚙      │
│ ┌──────────────────────────────┐ │
│ │ 🔍 Buscar por código o chip  │ │
│ └──────────────────────────────┘ │
│                                  │
│ ¿Cuántos animales hay?      412  │
│   198 machos · 214 hembras    ›  │
│ ─────────────────────────────── │
│ ¿Cuántas están preñadas?     63  │
│   + 11 servidas sin palpar    ›  │
│ ─────────────────────────────── │
│ ¿Cuáles paren pronto?         7  │
│   La próxima en 3 días (P-118) › │
│ ─────────────────────────────── │
│ ¿Qué falta vacunar?          24  │
│   9 vencidas · 15 esta quincena› │  ← número en rojo si hay vencidas
│ ─────────────────────────────── │
│ ¿Cuántos nacieron este año?  88  │
│   46 machos · 42 hembras      ›  │
│ ─────────────────────────────── │
│ ¿Cuáles están para venta?    14  │
│ ─────────────────────────────── │
│ ¿Cuánto hay invertido?  $812 M   │  ← solo ADMIN
├──────────────────────────────────┤
│ Inicio  Animales  (+)  Alertas Más│
└──────────────────────────────────┘
```
Cada fila completa es táctil y abre el listado filtrado. Las cifras usan Barlow Condensed 44 px alineadas a la derecha. En escritorio, las preguntas forman dos columnas y a la derecha aparece la lista de alertas más urgentes.

**Preguntas por sistema productivo (CFG-03, M8).** A las comunes se agregan las del sistema de la finca, en el mismo formato de fila: en cría, «¿Cuántos terneros se destetan este mes?» y «¿Cuál es el intervalo entre partos?»; en levante y ceba, «¿Cuáles alcanzan el peso de venta este mes?» y «¿Qué lotes ganan menos peso?»; en lechería y doble propósito, «¿Cuántas vacas están en ordeño y cuántas secas?», «¿Cuánta leche se produjo ayer?» y «¿Cuáles se deben secar pronto?». El sistema productivo cambia qué se destaca y en qué orden, no los datos.

**Aviso de correo sin verificar (AUT-14 CA4, M10a).** Un ADMIN con el correo sin verificar ve arriba de Inicio: «Verifica tu correo para poder recuperar tu contraseña. Te enviamos un enlace a a***@demo.co» con **Reenviar el enlace**. No bloquea el uso.

### 5.2 Listado de animales
```
┌──────────────────────────────────┐
│ ← Animales                 ⤓ Excel│
│ 🔍 Buscar…                        │
│ [Hembras ✕] [Preñadas ✕] [+ Filtro]│
│ 63 animales                       │
│ ┌────┐ Canela                     │
│ │P-12│ Hembra · Brahman · 5 a 2 m │
│ └────┘ Preñada · Parida (4)  ⚠ vacuna│
│ ┌────┐ —                          │
│ │P-19│ Hembra · Gyr · 3 a 8 m     │
│ └────┘ Preñada · parto en 3 días  │
└──────────────────────────────────┘
```
La chapeta a la izquierda de cada fila es la ancla visual. Las alertas se muestran como texto con ícono, no solo color.

Arriba, junto a **Nuevo animal** (M4d): **⤓ Excel** para todos, que descarga exactamente lo filtrado (ANI-06 CA4), y para el ADMIN **Etiquetas**, que abre la hoja de etiquetas de lo filtrado (§5.15). Con animales seleccionados, la barra de acciones en lote suma **Imprimir etiquetas** (ADMIN, hasta 200).

### 5.3 Ficha del animal
```
┌──────────────────────────────────┐
│ ←                               ⋮│
│   ┌──────┐  Canela               │
│   │ P-12 │  Hembra · Brahman     │
│   └──────┘  5 años 2 meses       │
│   Chip 170 000123456789 · DIN 0457│
│   [Preñada] [Parida · 4] [Lote Sabana]│
│ ┌──────────────────────────────┐ │
│ │ ⚠ Aftosa vencida hace 6 días │ │
│ │   Registrar vacuna           │ │
│ └──────────────────────────────┘ │
│ Resumen│Reprod.│Sanidad│Pesos│… │
│                                  │
│ Preñez actual                    │
│ Servicio 12/01/2026 · IA · Toro Z-3│
│ Parto estimado 21/10/2026 (26 d) │
│ ─────────────────────────────── │
│ Último peso 452 kg · 03/09/2026  │
│ Madre P-4 · Crías: T-201, T-233  │
├──────────────────────────────────┤
│ [ Vacuna ] [ Peso ] [ Parto ]    │  ← acciones rápidas fijas
└──────────────────────────────────┘
```
En móvil la barra de pestañas se desplaza de lado dentro de sí misma, sin desplazar la página; la pestaña activa queda a la vista al entrar y cada pestaña mide al menos 48 px de alto (M4b).

**QR del sistema (IDN-03, M4d).** Al final del Resumen, bajo los identificadores: el QR de la ficha (unos 3 cm), con "Escanéalo con el celular para abrir esta ficha. Pide iniciar sesión y no muestra datos del animal a nadie de fuera de la finca." y, para el ADMIN, el enlace **Imprimir etiqueta**. Todos los roles ven el QR.

**Reproducción (M5, REP-05).** La pestaña tiene tres secciones: **Preñez actual** (servicio, con «aprox.» si la fecha es estimada, método, toro o pajilla, diagnóstico con quién palpó, días de gestación y parto estimado, con «(corregido a mano)» si lo es), **Partos** (número, último parto e intervalo entre partos: «405 días el último · promedio 394 días», o «Sin dato: hacen falta dos partos seguidos con fecha de servicio real», RN-38) y **Historial reproductivo** (cada preñez con su desenlace, fecha y tipo de parto, crías enlazadas y muertas al nacer; las anuladas con borde punteado y su motivo). Acciones de una hembra activa: «Registrar servicio» (sin preñez abierta), «Registrar palpación», «Registrar parto», «Registrar aborto» y «Corregir fechas» (con preñez abierta). El ADMIN ve «Anular» en cada preñez; un parto con crías que siguen en la finca responde «Archiva primero las crías de este parto: 26-045».

**Avisos reproductivos con acción (M5).** «Parto estimado en 3 días» y «Pasó la fecha de parto: registra el parto o el aborto» (alerta, RN-39) llevan el botón **Registrar parto**; «Servida hace 96 días sin diagnóstico», **Registrar palpación**. En el listado, la fila muestra «Parto vencido sin registrar» y el filtro de alertas lo incluye.

**Importados (ANI-09, M4d).** Una fecha de ingreso que la importación tomó del nacimiento se muestra como "12/03/2020 (estimada: es la de nacimiento)" hasta que alguien la corrige. En Reproducción, "Partos: 4 (3 anteriores al sistema, sin fecha)".

**Número anterior (ANI-11, M4c).** En una finca con numeración reutilizable, bajo el encabezado y en tono informativo: «Este número lo tuvo antes 5 · vendido el 12/03/2026», con enlace a la ficha de ese animal. En la ficha de un animal que salió: «Su número 5 lo tiene hoy otro animal», con enlace. El historial nunca mezcla los eventos de los dos.

**Leche (M9b).** En las vacas de una finca de lechería o doble propósito, la ficha muestra la etiqueta «En ordeño · 84 días en leche» o «Seca», y la pestaña **Leche**: curva de la lactancia actual, acumulado, promedio diario, pico y comparación con lactancias anteriores (LEC-04). «Secar pronto» aparece como aviso cuando el parto está a menos de `dryOffBeforeCalvingDays`.

### 5.4 Registrar parto (flujo de una pantalla)
```
┌──────────────────────────────────┐
│ ← Registrar parto                 │
│ Madre  ┌────┐ Canela · preñez IA  │
│        │P-12│ estimado 21/10      │
│        └────┘            Cambiar  │
│ Fecha  [Hoy] [Ayer] [Otra…]       │
│ Tipo   [Normal] [Asistido] [Cesárea]│
│ Crías  [ − ]  1  [ + ]            │
│ ── Cría 1 ─────────────────────── │
│ Código     [ 26-045     ] sugerido│
│ Sexo       [ Macho ] [ Hembra ]   │
│ Peso (kg)  [ 32         ] 🔢      │
│ Estado     [Sana] [Débil] [Muerta]│
│ Chapeta    [ opcional   ]         │
│ Observaciones [               ]   │
│ ┌──────────────────────────────┐ │
│ │      Guardar parto           │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```
El código de la cría se sugiere con el patrón de la finca (por defecto año-consecutivo, `26-045`). Al guardar: "Parto guardado · 26-045 creado" y se abre la ficha de la madre. Nota: los códigos del prototipo visual (`P-12`, `T-245`) son ilustrativos.

**Implementado en M5.** La madre y su preñez van arriba («Preñez: servicio del 12/01/2026 · Inseminación · parto estimado 01/11/2026», o «Sin preñez registrada: el parto quedará con fecha de servicio estimada»). El orden de cada cría es **Estado** (Sana · Débil · Muerta), **Sexo**, **Código**, **Peso al nacer** y **Chapeta**: con «Muerta» desaparecen código, peso y chapeta y aparece «Una cría muerta al nacer queda en el parto, pero no se registra como animal». Con el `Stepper` en 2 o 3, los códigos sugeridos son distintos entre sí (consecutivos con el patrón, o los menores libres con numeración reutilizable) y llenan solo los campos que la persona no escribió. Un código tomado aparece junto al código de esa cría. Mensajes: «Parto guardado · 26-045 y 26-046 creados»; sin crías vivas, «Parto guardado.».

**Servicio, palpación y aborto (M5).** Pantallas cortas desde la ficha o desde **Registrar**:
- Servicio: fecha (`DateQuickPick`), método (Monta natural · Inseminación), toro de la finca (buscador de machos) o «Pajilla o toro de fuera», responsable y observaciones; debajo, «Parto estimado: 01/11/2026» con la gestación de la raza. Si la hembra ya tiene una preñez abierta, un aviso lo dice antes de guardar y el error ofrece «Ver la preñez abierta» (REP-01 CA3).
- Palpación: con preñez abierta, fecha, resultado (Preñada · Vacía) y «Quién palpó»; sin preñez abierta, «Meses de gestación» (1 a 9) para registrar una preñez confirmada sin servicio conocido.
- Aborto: fecha y observaciones; sin preñez abierta, lo explica y ofrece registrar el servicio.

**Registrar (M5, M6).** Primero el animal (código, nombre o chip) y luego botones grandes: Vacuna · Peso · Tratamiento y, para hembras, Parto · Servicio · Palpación (sus pantallas explican si el animal no es hembra). Debajo, «Para muchos animales»: **Vacunación por lote** e **Importar pesaje de la báscula**.

**Reportes → Nacimientos (NAC-01, M5).** Desde y hasta (por defecto el año en curso), cinco totales (nacidos vivos, machos, hembras, débiles, muertos al nacer), la tabla de crías con madre enlazada, padre, raza, peso y estado, y la lista de partos con muertos al nacer. La página de Alertas se llenó en M6 (§5.17).

### 5.5 Jornada de manejo (pantalla de trabajo)
```
┌──────────────────────────────────┐
│ Vacunación aftosa · Lote Sabana  │
│ 37 de 52 trabajados    Terminar  │
│ ┌──────────────────────────────┐ │
│ │ 📶 Leer chip o escribir código│ │  ← borde amarillo chapeta = listo para leer
│ └──────────────────────────────┘ │
│   ┌──────┐  Hembra · 3 a 8 m     │
│   │ P-19 │  Preñada · parto 3 d  │
│   └──────┘                       │
│ ⚠ En retiro hasta 28/09          │
│ Aftosa · 2 ml · Dra. Paola  ✎    │
│ Peso (kg) [          ] opcional  │
│ ┌──────────────────────────────┐ │
│ │    Guardar y siguiente       │ │
│ └──────────────────────────────┘ │
│ Anteriores: P-44 ✓  P-7 ✓  T-10 ✓│
└──────────────────────────────────┘
```
Tras guardar, el campo de lectura recupera el foco automáticamente. Si el animal ya fue trabajado: "P-19 ya se vacunó en esta jornada a las 9:42".

### 5.6 Importar inventario (ANI-09, escritorio)
Configuración → **Importar inventario** (ADMIN). Pensada para escritorio, funciona también en el celular.

Paso 1, "Descarga la plantilla": botón **Descargar la plantilla**, que trae las razas y los lotes de la finca en listas desplegables. Paso 2, "Sube tu archivo": campo "Archivo (.xlsx o .csv, hasta 5 MB)" y la casilla "Crear las razas que no existen" ("Se crean en el grupo Cruce; después puedes ajustarlas en Configuración → Razas."). Al elegir el archivo se simula sin guardar nada ("Revisando el archivo…").

Paso 3, simulación: si ese mismo archivo ya se importó, un aviso "Este archivo ya se importó el 28/09/2026 (11 animales)". Tres contadores grandes — **Listas para importar**, **Con advertencias**, **Con errores** — y debajo los problemas **agrupados por fila**, con `SegmentedChoice` "Mostrar: Todas · Errores · Advertencias". Cada fila es una tarjeta con borde de color y texto ("Fila 13 · Error: no se importa", "Fila 4 · Advertencia") y la lista de problemas con su columna ("Código madre: La madre 012 es macho."). Las filas con advertencia traen la casilla "Importar la fila 4", marcada; desmarcarla vuelve a simular sin ella, así el número del botón siempre es el real (si se desmarca una madre, sus crías del archivo también quedan fuera). Se muestran 100 filas y **Mostrar más**. Botón principal: **Importar 271 animales**; secundarios: **Descargar filas con error** y **Elegir otro archivo**.

Resultado: "271 animales importados · 13 filas por corregir", con **Ver los animales** e **Importar otro archivo**. Un doble clic no importa dos veces; si la confirmación llega repetida, "Esta importación ya se había hecho; no se repitió."

Texto de ayuda: "Primero revisamos el archivo sin guardar nada. Puedes importar varias veces: los códigos que ya existen quedan como error y no se tocan."

### 5.7 Inicio de sesión
Campos "Usuario" (acepta también correo) y "Contraseña" con opción de mostrarla; botón **Entrar**.
- Si la finca tiene correo configurado (`GET /auth/config`, M10a): enlace **¿Olvidaste tu contraseña?** (§5.11). Debajo, siempre: "Si no tienes correo, pídele al administrador de la finca una contraseña temporal".
- Sin correo configurado, como hasta M10a: solo el texto "Si olvidaste tu contraseña, pídele al administrador de la finca una temporal".
- Si Google está configurado: separador «o» y botón **Continuar con Google** (con el logo de Google según su guía de marca, texto en español). Sin `GOOGLE_*`, el botón no aparece.
- Al volver de Google sin acceso: "Esta cuenta de Google no tiene acceso a ninguna finca. Pídele al administrador una invitación." (`GOOGLE_NO_ACCESS`).
- Al cumplirse el tope de la sesión (AUT-10 CA2): "Por seguridad, vuelve a escribir tu contraseña", con el usuario ya escrito.

### 5.8 Vacunación masiva
Paso 1: vacuna, fecha, dosis, responsable. Paso 2: selección por lote, categoría o todos, con conteo y lista para desmarcar. Paso 3: "Vas a registrar Aftosa a 52 animales" → **Registrar 52 vacunaciones**.

**Implementado en M6.** El paso 2 tiene **Revisar la selección**, que simula sin guardar: arriba «Se omiten 3 animales» con cada código y su motivo («La vacuna no se aplica a su sexo», «Ya la tiene en este ciclo», «Ya la tiene registrada ese día», «No había nacido o no estaba en la finca en esa fecha», «Ya no está en la finca»), un aviso con los que están fuera de la edad recomendada, y la lista «Se vacunan (desmarca los que no)» con casillas. Al guardar: «52 vacunaciones registradas · 3 animales omitidos.». Desde el avance de un ciclo (Configuración → Ciclos) se llega con la vacuna elegida: «Vacunar pendientes».

**Registrar vacuna, tratamiento y peso (M6).** Pantallas de un animal, con la ficha de vuelta al guardar («Vacuna registrada: Aftosa el 25/09/2026.»). Vacuna: lista de vacunas activas; si no se aplica a su sexo, el aviso en rojo y el botón deshabilitado antes de guardar; fuera de edad, aviso que deja guardar; RUV solo en las de ciclo oficial; «Próxima aplicación» solo en las de intervalo, con la fecha que se propondría. Tratamiento: diagnóstico, medicamento, dosis, días de tratamiento, retiro de carne y de leche, y en vivo «Queda en retiro: carne hasta el 21/10/2026 · leche hasta el 30/09/2026.»; el costo solo para el ADMIN. Peso: «Último peso: 452 kg el 03/09/2026», el peso con teclado numérico, el aviso «El peso se aleja más del 30 % del último (452 kg). Verifícalo antes de guardar.», **Cómo se pesó** (Báscula · Cinta · Estimado) y **Cómo se identificó al animal** (Búsqueda · Lector de chip · QR), propuesto según cómo se abrió la ficha.

**Sanidad y Pesos en la ficha (M6).** Acciones rápidas bajo el encabezado de un animal activo: **Vacuna · Peso · Tratamiento**. Sanidad: cada vacuna con su estado (Vencida, Pendiente, Próxima, Al día, No aplica) y «Registrar Aftosa» cuando hace falta; «Retiro de medicamentos» con «Carne hasta … · Leche hasta …»; vacunaciones y tratamientos con «Anular» para ADMIN y VET. Pesos (se carga al abrir la pestaña): la gráfica de la evolución, la ganancia diaria (entre los dos últimos, en 90 días y desde el nacimiento, o «Sin dato»), los avisos de ganancia baja y pérdida, y la tabla de pesajes con «Anular» para quien lo registró o el ADMIN. Los avisos de la ficha suman «Ganancia baja: 0,163 kg/día en los últimos 90 días» y «Perdió peso: bajó 8 % desde el pesaje anterior» con **Registrar peso**, y los de vacunas traen **Registrar vacuna**.

**Gráfica de peso (M6).** SVG propio, sin librería: una serie, así que sin leyenda; línea de 2 px y puntos de 8 px en `--color-potrero`, rejilla en `--color-cerca`, etiquetas en `--color-texto-2`. Al pasar el dedo o el puntero, una línea vertical punteada y el pesaje más cercano debajo («15/06/2026 · 240 kg»); los puntos se enfocan con el teclado y dicen lo mismo. La tabla de pesajes es la vista accesible de los mismos datos.

### 5.9 Mi cuenta (AUT-11 en M4d; correo y Google en M10a)
```
┌──────────────────────────────────┐
│ Mi cuenta                        │
│ Álvaro Pérez Castro · alvaro     │
│ Correo alvaro@demo.co ✓ verificado│
│ [ Cambiar contraseña ]           │
│ ─────────────────────────────── │
│ Sesiones                         │
│ Chrome · Android       Este equipo│
│   Desde 02/09 · usada hoy        │
│ Edge · Windows                   │
│   Desde 14/08 · usada hace 3 días│
│   [ Cerrar sesión en este equipo ]│
│ [ Cerrar las demás sesiones ]    │
│ ─────────────────────────────── │
│ Google  No vinculada  [ Vincular ]│
└──────────────────────────────────┘
```
- Cada sesión muestra navegador y sistema (del `userAgent`), inicio y último uso; la actual dice "Este equipo" y no tiene botón propio (para cerrarla está Salir).
- Cerrar una sesión o las demás pide confirmación corta, porque obliga a volver a entrar en ese equipo: "¿Cerrar la sesión en Edge · Windows? Tendrás que volver a entrar en ese equipo."
- Correo: sin verificar, "Sin verificar · Reenviar el enlace"; cambiarlo pide la contraseña actual y deja el nuevo sin verificar hasta abrir el enlace.
- Google: **Vincular** y **Desvincular** piden la contraseña actual. Desvincular el único método de acceso no se ofrece: "Crea una contraseña antes de desvincular Google".
- La lista va de la sesión usada más recientemente a la más antigua; el último uso se lee "usada hoy", "usada ayer", "usada hace 3 días" y, pasada una semana, "usada el 14/08/2026". "Cerrar las demás sesiones" solo aparece si hay otras, y al terminar dice "Se cerró 1 sesión." o "Se cerraron 2 sesiones."
- Al cumplirse el tope de la sesión, el inicio de sesión dice "Por seguridad, vuelve a escribir tu contraseña" con el usuario ya escrito (§5.7).
- En Configuración → Usuarios, el ADMIN tiene en cada usuario **Cerrar todas sus sesiones** ("equipo perdido o prestado"; el diálogo dice "Se cerrará su sesión en todos sus equipos."), y en la parte de arriba **Invitar por correo** (correo y rol) con la lista de invitaciones pendientes (correo, rol, vence el…, **Reenviar**, **Anular**).

### 5.10 Aceptar invitación (AUT-13, M10a)
El enlace del correo abre `/invitacion#token=…`. La página lee el token del fragmento, lo borra de la barra de direcciones (`history.replaceState`) y lo envía en el cuerpo (`POST /invitations/preview`). Se sirve con `Referrer-Policy: no-referrer`.
```
┌──────────────────────────────────┐
│ Te invitaron a                   │
│ Finca La Esperanza               │
│ como Veterinaria · vet@demo.co   │
│ Nombre      [                  ] │
│ Usuario     [ paola.vet        ] │
│ Contraseña  [                  ] │
│ [ Entrar a la finca ]            │
│ ───────────── o ──────────────── │
│ [ G  Continuar con Google ]      │
└──────────────────────────────────┘
```
- Si el correo ya es de un usuario (de otra finca), la pantalla dice "Ya tienes una cuenta en Hato" y pide solo su contraseña, o usa la sesión abierta: **Unirme a Finca La Esperanza**.
- Enlace vencido, usado o anulado: "La invitación no es válida o ya venció. Pídele al administrador una nueva." (`INVITATION_INVALID`).
- Al terminar, la sesión queda abierta y el correo verificado.

### 5.11 Olvidé mi contraseña y restablecer (AUT-14, M10a)
- **¿Olvidaste tu contraseña?** pide el correo y responde siempre lo mismo: "Si ese correo está registrado y verificado, te enviamos un enlace. Revisa también la carpeta de spam." Nunca dice si la cuenta existe.
- El enlace abre `/restablecer#token=…` (mismo manejo del fragmento y `Referrer-Policy: no-referrer` que §5.10): nueva contraseña dos veces y **Guardar contraseña**. Al terminar: "Contraseña guardada. Cerramos tus otras sesiones por seguridad."
- La verificación de correo abre `/verificar-correo#token=…` y confirma "Correo verificado".
- Enlace vencido o usado: "El enlace ya no es válido o venció. Pide uno nuevo." con el botón para pedirlo.

### 5.12 Importar pesaje de la báscula (PES-04, M6)
**Implementado en M6.** El perfil viene elegido en la plantilla Tru-Test (marcada «provisional»); «Otro formato: reconocer las columnas» deja que la API proponga el mapeo, y el ADMIN lo puede guardar como perfil de la finca. La simulación dice las columnas usadas, avisa si el archivo está en libras («se convierten a kilos, redondeados a 0,1 kg») o si ya se importó, y en la tabla cada fila dice **Cómo se asoció** (Por chip · Por chapeta · Por código · Asociado a mano) y su estado. Cada chip desconocido tiene el buscador «Asociar el chip … a un animal», la casilla **Guardar este chip como RFID del animal** (marcada) y **No importar este chip**; si el animal ya tiene otro chip, la casilla queda desmarcada con «Este animal ya tiene el chip X: revisa la asociación». El chip asociado sigue a la vista para cambiarlo.

Mismo patrón de simulación que §5.6. Paso 1: elegir el perfil de báscula o, la primera vez, subir el archivo y confirmar el mapeo propuesto (qué columna es el chip, el número visual, el peso y la fecha), que se guarda con un nombre ("Báscula del corral"). Paso 2 (simulación): contadores **Asociados**, **Chips desconocidos**, **Repetidos** y **Pesos atípicos**; cada chip desconocido tiene **Asociar a un animal** o **No importar**. Paso 3: **Guardar 48 pesajes** → crea la jornada de pesaje y muestra "48 pesajes guardados · 3 chips sin asociar".

### 5.13 Jornada de ordeño (LEC-01, M9b)
Lista de las vacas en ordeño del lote, una fila por vaca con la chapeta, el nombre, días en leche y un `NumberField` de litros con teclado numérico; Enter pasa a la siguiente. Una vaca con retiro de leche muestra "Leche no apta para la venta" junto al campo. Botón fijo abajo: **Guardar ordeño de 23 vacas**. El ordeño (AM, PM o total del día) y la fecha se eligen una vez arriba con `SegmentedChoice` y `DateQuickPick`.

### 5.14 Salida, reversión, archivo y numeración (M4c)
Todas estas acciones son del ADMIN: los demás roles no ven los botones y la API las rechaza igual. Los diálogos siguen el principio 4 (§2): son acciones graves, así que piden confirmación; al terminar, la ficha muestra un aviso verde con el resultado ("Salida de 5 registrada.") y, debajo, las advertencias de la API en tono de aviso.

**Configuración → Finca → Numeración de los animales (ANI-10).** Bloque propio al final de los parámetros de la finca:
- "¿Reutilizar números de animales que salen de la finca?" (`SegmentedChoice` Sí / No), con la ayuda "Si vende el 5, el próximo animal puede ser el 5. El historial de cada uno no se mezcla."
- "Número sugerido para un animal nuevo": **Código de las crías** o **Menor número libre**. Con el primero aparece el campo "Código de las crías" con la explicación de `{YY}`, `{YYYY}`, `{NNN}` y `{N}` y un ejemplo ("{YY}-{NNN} da 26-045").
- Pasar de Sí a No con números repetidos no se guarda: el error `CODE_REUSE_CONFLICT` dice qué números chocan.

**Registrar salida (ANI-04).** Botón **Registrar salida** en la ficha de un animal activo. Diálogo "Registrar salida de Canela" con la descripción "El animal sale del inventario activo. Si fue un error, se puede revertir." Campos: **Tipo de salida** (venta, muerte, sacrificio, robo, traslado, otro), **Fecha de salida**, y si es venta **Precio de venta** (obligatorio) y **Comprador** (opcional); al final **Motivo u observaciones** (opcional). Si el animal está en retiro y la salida es venta o sacrificio, aparece un recuadro de aviso "Está en retiro de medicamento hasta el 12/10/2026." con la casilla "Confirmo la salida aunque esté en retiro" ("Queda registrado en los cambios del animal."); sin marcarla, la API responde `WITHDRAWAL_ACTIVE` (RN-22). Botón **Registrar salida**.

**Revertir salida (ANI-04 CA5, IDN-06 CA3).** En la ficha de un animal que salió, botón **Revertir salida**. Diálogo "Revertir la salida de Canela": "Vuelve al inventario activo. Se anula la venta del 12/03/2026." Si su número ya lo tiene otro animal activo, el mismo diálogo muestra el error de la API con el enlace **Abrir la ficha de 5** y agrega el campo **Código nuevo** ("Otro animal activo ya tiene su número. Sugerido: 41.") con el atajo **Usar el 41**. Si el número está libre pero su chapeta la tiene otro animal, la reversión se hace sin preguntar y el aviso dice "El identificador 5 ya lo tiene el animal 30: quedó retirado en este animal."

```
┌──────────────────────────────────┐
│ Revertir la salida de 5        ✕ │
│ Vuelve al inventario activo. Se  │
│ anula la venta del 12/03/2026.   │
│ ┌──────────────────────────────┐ │
│ │ El código 5 ya lo tiene el   │ │
│ │ animal activo 5. Asígnale un │ │
│ │ código nuevo…                │ │
│ │ Abrir la ficha de 5          │ │
│ └──────────────────────────────┘ │
│ Código nuevo                     │
│ [ 41                          ]  │
│ Otro animal activo ya tiene su   │
│ número. Sugerido: 41.            │
│ [      Revertir salida       ]   │
└──────────────────────────────────┘
```

**Archivar (ANI-03).** Botón **Archivar** (secundario, en la ficha de cualquier animal no archivado). Diálogo "Archivar Canela": "Deja de aparecer en listados y conteos, y se retiran todos sus identificadores, también el DIN y el chip. Se puede restaurar desde Configuración → Archivados." Campo **Motivo** obligatorio (por ejemplo, "Registro duplicado por error"). Botón **Archivar animal**. La ficha de un archivado muestra arriba el aviso "Archivado el 28/09/2026" con el motivo, y en lugar de las acciones, **Restaurar animal**.

**Restaurar.** Diálogo "Restaurar Canela": "Vuelve a aparecer en listados y conteos, con los identificadores que sigan libres." Si su código ya lo tiene otro animal, pide **Código nuevo** igual que la reversión. Los identificadores que ya tiene otro animal llegan como aviso.

**Configuración → Archivados.** Lista de los animales archivados ("Animales que se sacaron del hato por error o por estar duplicados. Abre la ficha para ver el motivo y restaurarlo."), una fila por animal con código y nombre, sexo, categoría y raza, y **Cargar más** al final. Vacía: `EmptyState` "No hay animales archivados · Cuando archives un registro duplicado o hecho por error, aparece aquí."

**Pestaña Cambios (AUD-01 CA2, solo ADMIN).** Última pestaña de la ficha. Cada cambio del animal, de sus identificadores y, desde M7, de sus preñeces, partos, vacunaciones, tratamientos y pesajes, del más reciente al más antiguo, como una frase en lenguaje de finca con quién, qué hizo y sobre qué: "Álvaro registró la salida del animal 5", "Wilmer anuló la vacuna Aftosa del 12/05/2026 · motivo: Era otra vaca", "Paola registró el parto de la preñez con servicio del 02/11/2025"; debajo, la fecha y la hora, y la lista de campos con antes → después ("Tipo de salida: Venta → —"). Los ids de raza, lote, madre y padre se muestran como nombre o código, y los montos nunca aparecen, ni siquiera para el ADMIN (se consultan en Costos). Vacía: "Sin cambios registrados".

### 5.15 Hoja de etiquetas con QR (IDN-03, M4d)
Solo ADMIN. Se llega desde **Etiquetas** en el listado (todo lo filtrado), **Imprimir etiquetas** en la selección o **Imprimir etiqueta** en la ficha. Título "Etiquetas con QR" ("Para tarjetas de manejo o fichas de potrero. El QR abre la ficha del animal después de iniciar sesión.").

Controles: `SegmentedChoice` **Papel** (Carta · A4, por defecto carta, el que venden las papelerías en Colombia) y **Formato** (Tarjetas (2 × 4) · Etiquetas (3 × 7)), botón **Imprimir** y el resumen "22 etiquetas · 2 hojas". Ayuda: "En el diálogo de impresión deja la escala en 100 % y sin encabezados ni pies de página." Si son más de 1.000, se avisa que la hoja trae las primeras.

Debajo, la vista previa: hojas blancas del tamaño real (márgenes de 10 mm), con una cuadrícula de etiquetas separadas por una línea punteada. Cada etiqueta: la **Chapeta** con el código (grande en tarjetas, mediana en etiquetas), el nombre, "Chapeta 087", "DIN …", "Chip 170 000123456789" y, a la derecha, el QR tan grande como cabe. Al imprimir solo salen las hojas: la navegación, el título y los controles se ocultan, y cada hoja va en su página. No se genera PDF (M19).

```
┌────────────────────┬────────────────────┬────────────────────┐
│ ┌────┐     ▄▄▄▄▄   │ ┌────┐     ▄▄▄▄▄   │ ┌────┐     ▄▄▄▄▄   │
│ │087 │     █ ▄ █   │ │140 │     █▀▄ █   │ │201 │     █ ▀▄█   │
│ └────┘     ▀▀▀▀▀   │ └────┘     ▀▀▀▀▀   │ └────┘     ▀▀▀▀▀   │
│ Canela             │ Chapeta 140        │ Estrella           │
│ Chip 170 0001…     │                    │ Chapeta 201        │
├────────────────────┼────────────────────┼────────────────────┤
│        …           │         …          │         …          │
```

### 5.16 Pesaje en vivo en la manga (PES-03, M15, app móvil)
Boceto del flujo, no diseño final: el diseño detallado se hace en M15 y depende del ADR de tecnología móvil (ADR-014, propuesto: Expo o Capacitor).
- Pantalla de trabajo como la jornada (§5.5), vertical y con controles grandes para una mano. Arriba, el estado del indicador ("Báscula conectada · XR5000", "Reconectando…") y el conteo de la jornada.
- Al leer el chip aparece la ficha resumida: Chapeta con el código, categoría, último peso y su fecha.
- Mientras el peso oscila, la cifra se ve en gris con "Esperando peso estable"; al estabilizarse, se guarda sola, con un sonido y vibración cortos, y muestra el peso, "+32 kg desde el 12/08 (0,58 kg/día)" y las alertas de PES-05.
- "Baja el animal": hasta que la báscula vuelve cerca de cero, no se registra otro.
- Chip desconocido: diálogo con **Asociar a un animal**, **Registrar animal nuevo** y **Omitir**; el peso queda retenido mientras tanto. El mismo animal dos veces: **Reemplazar el peso** o **Conservar ambos**. Peso atípico: aviso de PES-01.
- Siempre a mano: **Anular el último** (con motivo) y **Digitar peso** si la báscula falla.


### 5.17 Alertas (M6)
Una fila de botones por grupo (Vacunas · Reproducción · Retiros · Pesos), cada uno con el tipo y su conteo («Ganancia baja 5»); se marcan varios (se combinan con «o») y el filtro de lote va al lado. Los filtros van en la URL. «23 animales con alertas» y una tarjeta por animal: la chapeta, el código enlazado a la ficha, la categoría y el lote, y una línea por alerta con lo que pasa y su acción («Aftosa vencida (16/12/2025) · Registrar vacuna», «parto estimado el 01/10/2026 (en 6 días) · Registrar parto», «Carne hasta el 21/10/2026», «0,163 kg/día en 90 días (lo esperado: 0,3 kg/día) · Registrar peso»). **Mostrar más** pagina; **Quitar los filtros** vuelve a todas. Sin alertas, el estado vacío explica qué aparece aquí.
## 6. Componentes del sistema de diseño

| Componente | Descripción y reglas |
|---|---|
| `Chapeta` | Silueta de arete (rectángulo con parte superior redondeada y orificio), fondo `--color-chapeta`, código en Barlow Condensed. Tamaños (ancho): s (listas, 56 px), m (ficha, 72 px), l (jornada, 96 px); alto 1,2 veces el ancho. Letra del código ≈ 0,4 del ancho (22, 30 y 40 px); los códigos largos (`26-045`) se achican, pero nunca por debajo de 18, 23 y 31 px respectivamente: en una lista al sol, menos de 18 px no se lee. La silueta también forma el logo (chapeta pequeña con «H» + «Hato»). Si el animal salió de la finca: fondo `--color-cerca` y texto tachado nunca; se agrega la etiqueta "Vendido" o "Retirado". |
| `SearchBar` | Acepta texto y lecturas RFID (`useRfidReader`, 04 §6). Resultados agrupados: coincidencia exacta primero ("Chip 170…"). Estado "leyendo" con borde chapeta. Excepción aprobada en M2b a «etiquetas visibles» (§8): su etiqueta («Buscar animal») es solo para lectores de pantalla; se ven el ícono y el placeholder. |
| `QuestionRow` | Pregunta + resumen + cifra; fila completa enlazada. |
| `Tag` | Etiquetas de clasificación: fondo claro del color semántico, texto en el tono oscuro del mismo color, siempre con texto (no solo color). Con leche (M9b): «En ordeño · 84 d» y «Seca». |
| `AlertBanner` | Alerta accionable dentro de la ficha: texto de lo que pasa + botón de la acción que lo resuelve. |
| `SegmentedChoice` | Grupo de botones grandes para 2–4 opciones (sexo, tipo de parto, estado). Reemplaza listas desplegables. |
| `DateQuickPick` | Hoy · Ayer · Otra fecha (abre el selector de fecha nativo del sistema). Por defecto Hoy; «hoy» es el día en America/Bogota (`useToday`), y no admite fechas futuras. |
| `NumberField` | Teclado numérico (`inputmode="decimal"`), unidades visibles (kg, $), separadores es-CO al perder foco. Interpreta con `parseDecimalEsCo` de `shared` y entrega una cadena decimal, nunca `number`. Con decimales, un punto seguido de 1–2 dígitos es decimal (`452.5`); en pesos el punto es siempre de miles (`1.25` → 125). |
| `Stepper` | − valor + para cantidades pequeñas (crías). |
| `Timeline` | Eventos con ícono por tipo, fecha, autor y enlace al detalle; eventos anulados en gris con motivo. |
| `UndoToast` | "Vacuna registrada · Deshacer" 6 s. |
| `ConnectionBanner` | "Sin conexión. Lo que escribas se guardará cuando vuelva la señal." (F1: no enviar hasta reconectar; F2: cola local). |
| `EmptyState` | Explica qué va aquí y ofrece la acción para llenarlo. |
| `DataTable` (escritorio) | Listados con columnas ordenables; en móvil se transforma en lista de filas. |

Base técnica: primitivas accesibles de Radix UI estilizadas con Tailwind y tokens en CSS custom properties (`apps/web/src/styles/tokens.css`), mapeados en la configuración de Tailwind (con Tailwind 4 es CSS: el bloque `@theme inline` de `apps/web/src/styles/app.css`; no hay `tailwind.config`). Íconos: Lucide, 24 px, trazo 2.

## 7. Redacción de la interfaz

- Español de Colombia, trato de "tú" en la interfaz de la app (neutro y cercano). Validar con la finca; si prefieren "usted", cambiar en `packages/shared/src/i18n`.
- Vocabulario del ganadero: parto, preñez, servicio, palpación, destete, chapeta, lote, manga. Nada de "registro de evento reproductivo".
- Botones con verbo + objeto: "Guardar parto", "Registrar vacuna", "Terminar jornada". La confirmación repite el verbo: "Parto guardado".
- Errores que dicen qué pasó y cómo seguir: "Ya existe un animal con el código P-12. Usa otro código o abre la ficha de P-12." Nunca "Error de validación".
- Vacíos que invitan: "Todavía no hay pesajes. Registra el primero para ver la curva de crecimiento."
- «Horra» y «Seca» no son lo mismo y nunca se intercambian: Horra es la vaca sin preñez ni cría al pie (`DRY`); Seca, la que dejó de ordeñarse (`DRIED_OFF`).
- Correos (AUT-12): asunto corto con el nombre de la finca ("Te invitaron a Finca La Esperanza en Hato", "Restablece tu contraseña de Hato"); cuerpo en texto plano y HTML simple, sin imágenes remotas; un solo botón o enlace con el verbo ("Aceptar la invitación", "Crear una contraseña nueva"); cuándo vence ("El enlace vence en 1 hora"); y qué hacer si no lo pidió ("Si no pediste esto, ignora este correo: tu contraseña no cambia").
- Fechas `21/10/2026`; relativas cuando ayudan ("en 3 días", "hace 6 días"). Dinero `$ 1.250.000`. Peso `452 kg`. Edad "5 a 2 m".

## 8. Accesibilidad y condiciones de campo
- WCAG 2.1 AA como mínimo; contraste de texto principal ≥ 7:1 por el uso a pleno sol.
- Todo operable con teclado en escritorio; foco visible de 3 px en `--color-potrero` (en la jornada, en `--color-chapeta` sobre fondo oscuro del borde).
- Estados comunicados con texto e ícono, no solo con color (daltonismo).
- Formularios con etiquetas visibles (no solo placeholder) y errores junto al campo.
- Controles principales en el tercio inferior de la pantalla en móvil (uso con el pulgar).
- Pruebas automáticas con axe-core en Playwright.

## 9. Responsive
| Ancho | Diseño |
|---|---|
| < 768 px | Una columna, barra inferior, acciones fijas abajo. |
| 768–1023 px | Una columna más ancha; listados con 2 líneas por fila. |
| ≥ 1024 px | Barra lateral, tablero en 2 columnas + panel de alertas, listados en tabla, ficha con resumen fijo a la izquierda y pestañas a la derecha. |

## 10. Prototipo
Antes de implementar la web completa, construir un prototipo navegable de Inicio, Ficha, Registrar parto y Jornada con datos de ejemplo y probarlo con al menos un usuario real de la finca (RNF-03). Los hallazgos se registran en `docs/ux-hallazgos.md`.

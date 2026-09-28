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
  │    ├─ Resumen · Reproducción · Leche(M9b) · Sanidad · Pesos · Genealogía · Costos(A) · Historial
  │    └─ Acciones: vacuna, peso, servicio/parto, tratamiento, secado(M9b), salida(A)
  └─ Nuevo animal
Registrar (+)
  ├─ Parto · Servicio · Palpación
  ├─ Vacunación (individual o masiva)
  ├─ Pesaje · Importar pesaje de la báscula (M6) · Tratamiento
  ├─ Control de leche · Jornada de ordeño · Secado (M9b)
  ├─ Gasto (A)
  └─ Jornada de manejo
Alertas (vacunas, partos, servidas sin diagnóstico, retiros, ganancia baja, secar pronto)
Reportes
Más: Jornadas · Finanzas(A) · Configuración(A) · Mi cuenta (datos, correo, Sesiones, Google) · Salir
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
Paso 1: "Descarga la plantilla" y "Sube tu archivo". Paso 2 (simulación): tres contadores grandes — **Listas para importar**, **Con advertencias**, **Con errores** — y debajo la tabla de problemas (fila, columna, mensaje) con filtro. Botón principal: **Importar 271 animales**; secundario: **Descargar filas con error**. Paso 3: confirmación "271 animales importados · 13 filas por corregir" con enlace al listado.
Texto de ayuda: "Puedes importar varias veces. Los códigos que ya existen se omiten."

### 5.7 Inicio de sesión
Campos "Usuario" (acepta también correo) y "Contraseña" con opción de mostrarla; botón **Entrar**.
- Si la finca tiene correo configurado (`GET /auth/config`, M10a): enlace **¿Olvidaste tu contraseña?** (§5.11). Debajo, siempre: "Si no tienes correo, pídele al administrador de la finca una contraseña temporal".
- Sin correo configurado, como hasta M10a: solo el texto "Si olvidaste tu contraseña, pídele al administrador de la finca una temporal".
- Si Google está configurado: separador «o» y botón **Continuar con Google** (con el logo de Google según su guía de marca, texto en español). Sin `GOOGLE_*`, el botón no aparece.
- Al volver de Google sin acceso: "Esta cuenta de Google no tiene acceso a ninguna finca. Pídele al administrador una invitación." (`GOOGLE_NO_ACCESS`).
- Al cumplirse el tope de la sesión (AUT-10 CA2): "Por seguridad, vuelve a escribir tu contraseña", con el usuario ya escrito.

### 5.8 Vacunación masiva
Paso 1: vacuna, fecha, dosis, responsable. Paso 2: selección por lote, categoría o todos, con conteo y lista para desmarcar. Paso 3: "Vas a registrar Aftosa a 52 animales" → **Registrar 52 vacunaciones**.

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
- En Configuración → Usuarios, el ADMIN tiene en cada usuario **Cerrar todas sus sesiones** ("equipo perdido o prestado"), y en la parte de arriba **Invitar por correo** (correo y rol) con la lista de invitaciones pendientes (correo, rol, vence el…, **Reenviar**, **Anular**).

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
Mismo patrón de simulación que §5.6. Paso 1: elegir el perfil de báscula o, la primera vez, subir el archivo y confirmar el mapeo propuesto (qué columna es el chip, el número visual, el peso y la fecha), que se guarda con un nombre ("Báscula del corral"). Paso 2 (simulación): contadores **Asociados**, **Chips desconocidos**, **Repetidos** y **Pesos atípicos**; cada chip desconocido tiene **Asociar a un animal** o **No importar**. Paso 3: **Guardar 48 pesajes** → crea la jornada de pesaje y muestra "48 pesajes guardados · 3 chips sin asociar".

### 5.13 Jornada de ordeño (LEC-01, M9b)
Lista de las vacas en ordeño del lote, una fila por vaca con la chapeta, el nombre, días en leche y un `NumberField` de litros con teclado numérico; Enter pasa a la siguiente. Una vaca con retiro de leche muestra "Leche no apta para la venta" junto al campo. Botón fijo abajo: **Guardar ordeño de 23 vacas**. El ordeño (AM, PM o total del día) y la fecha se eligen una vez arriba con `SegmentedChoice` y `DateQuickPick`.

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

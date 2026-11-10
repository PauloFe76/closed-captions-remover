# Subtitle Cleaner — Documento de Arquitectura

> Extensión de Chrome para filtrar en tiempo real el contenido no-dialogal de los subtítulos (closed captions) en sitios de streaming, dejando solo el diálogo puro.

**Estado del proyecto:** M4 completo: Netflix y Prime Video funcionando en uso real sobre un núcleo compartido (`SubtitleObserver`) con un adaptador de solo datos por sitio. Pendiente: bug del guion inicial (ver 4.2), M3 (harness multi-sitio) y luego Disney+ y Max.
**Repo:** https://github.com/PauloFe76/closed-captions-remover (público)
**Última actualización:** 2026-11-10

---

## 1. Problema

Al ver series/películas en inglés con subtítulos en inglés (para reforzar el oído, no para traducir), la mayoría de los sitios de streaming ofrecen **closed captions (CC)** en vez de **subtítulos puros**. Los CC incluyen descripciones no-dialogales pensadas para personas con discapacidad auditiva:

- `[music playing]`, `[door creaking]`, `[indistinct chatter]`
- Nombres de hablante en mayúsculas: `JOHN:`, `(NARRATOR):`
- Descripciones de sonido ambiente entre paréntesis: `(sighs)`, `(laughs)`

Este ruido visual rompe la inmersión cuando el objetivo es simplemente tener un respaldo textual del diálogo.

## 2. Objetivo

Una extensión de Chrome (Manifest V3) que, en tiempo real, detecte los subtítulos que se están renderizando en la página y elimine (u oculte) todo el contenido no-dialogal, dejando visible solo el diálogo.

## 3. Alcance y no-alcance

**Incluye:**
- Filtrado en tiempo real vía content script, sin modificar el stream de audio/video ni evadir DRM.
- Soporte multi-sitio mediante configuración modular por plataforma (Netflix y Prime Video hechos; Disney+ y Max pendientes de inspección; YouTube quedó fuera de scope por decisión propia).
- Reglas de limpieza activables/desactivables individualmente desde un menú de opciones (hecho en M2).

**No incluye (por ahora):**
- Traducción de subtítulos.
- Generación de subtítulos propios (STT).
- Publicación en la Chrome Web Store bajo nombre/branding de terceros (Netflix, etc.) — ver sección de legalidad.
- Restauración retroactiva del cue visible al desactivar el filtro (decisión: opcional, ver 4.4).

## 4. Consideraciones técnicas clave

### 4.1 Cómo renderiza subtítulos cada plataforma

| Tipo | Cómo funciona | Ejemplos | Estrategia de filtrado |
|---|---|---|---|
| **Nativo (`<track>` / WebVTT)** | El navegador parsea un archivo VTT/SRT y expone `cue.text` vía la Text Track API | YouTube (fuera de scope actual) | Escuchar el evento `cuechange` sobre el `TextTrack` |
| **Overlay inyectado por JS** | La plataforma dibuja los subtítulos como texto en un `<div>` que actualiza dinámicamente, sin usar `<track>` | **Netflix y Prime Video (confirmados)**; Disney+ y Max a verificar por inspección | `MutationObserver` sobre el contenedor de subtítulos |

**Confirmado por inspección manual del DOM (M0):** Netflix no tiene `<track kind="captions">`. Los subtítulos se inyectan como overlay puro:

```
div.player-timedtext-text-container
  └─ span (wrapper)
      └─ span (leaf, contiene el texto real, ej. "[scoffs]")
```

**Confirmado por inspección manual del DOM (M4, paso 0):** Prime Video también es overlay JS. La estructura observada:

```
div (position:absolute, sin clase)
  └─ p
      └─ span (wrapper, clase con aspecto de hash)
          └─ span.atvwebplayersdk-captions-text (leaf, contiene el texto, ej. "[eerie wailing]")
```

Solo `atvwebplayersdk-captions-text` parece un nombre semántico (del SDK del reproductor). Las demás clases (`fbhsa9`, `f1iwgj00`, `f7j034j`) parecen hashes generados que pueden cambiar en cualquier deploy, por eso **no se usan en selectores**. Como el contenedor no tiene una clase estable, se usa el elemento `<p>` (estructural).

Estrategia común: un `MutationObserver` sobre `document.body` (childList + subtree + characterData) que busca "hojas" de texto con el selector del sitio y limpia las que no tienen hijos elemento. La implementación vive en `core/subtitle-observer.js` (ver 4.8).

**Para cada sitio nuevo no se asume nada:** antes de escribir código se repite la inspección del M0 (paso 0).

### 4.2 Reglas de limpieza

Implementadas en `content-scripts/core/cleaner.js` como lista `DEFAULT_RULES`. Desde M2 cada regla es un objeto plano:

```
{ id, label, example, pattern (string), flags, enabledByDefault }
```

**Por qué el patrón es un string y no un `RegExp`:** `chrome.storage` solo persiste datos serializables (strings, números, arrays, objetos planos); un objeto `RegExp` se perdería al guardarlo. El `RegExp` se reconstruye con `new RegExp(pattern, flags)` en el momento de limpiar. `clean()` usa `.replace(regex, '')`: busca y quita todas las coincidencias (flag `g`), no solo valida.

**Orden de aplicación (fijo):** corchetes → nombre de hablante → paréntesis, aplicando solo las reglas activas, y un `.trim()` final.

| Regla | id | Patrón | Default |
|---|---|---|---|
| Corchetes | `brackets` | `\[[^\]]*\]` (`g`) | ON |
| Nombre de hablante en mayúsculas | `speakerLabel` | `^[A-Z][A-Z0-9 '.-]{1,30}: *` (`gm`) | ON |
| Paréntesis de sonido ambiente | `parentheses` | `\([^)]*\)` (`g`) | OFF (riesgo de falso positivo con diálogo real) |

**Bug corregido (2026-11-06) en `speakerLabel`:** la versión original usaba `\s` dentro de la clase de caracteres y `\s*` tras los dos puntos. Como `\s` incluye el salto de línea, una línea en mayúsculas seguida de otra con `NOMBRE:` se leía como un único hablante gigante y se borraba diálogo real (`"WAIT\nJOHN: Hi"` → `"Hi"`). Además, sin el flag `m` solo se limpiaba el primer hablante de un texto multilínea. Corrección: espacio literal en lugar de `\s`, `: *` en lugar de `:\s*`, y flag `gm`. Lo detectó la revisión manual de un caso de test que "pasaba" con una lógica incorrecta (ver 4.5).

**Bug conocido (2026-11-10, pendiente):** en líneas de diálogo con guion al inicio, por ejemplo `-[Salazar chuckles]` seguido de `-I swear to God.`, la regla de corchetes quita el corchete pero deja un `-` suelto al principio de la línea. Detectado en uso real en Netflix; el harness no tenía un caso así. Antes de tocar la regla: (1) decidir el resultado esperado (¿se conserva el guion del diálogo restante o no?), (2) escribir el caso en `CASES[]` con el esperado a mano, (3) verlo fallar, (4) recién ahí corregir. Recordar la lección de multilínea: probar el caso con el diálogo en una o en dos líneas.

### 4.3 Manejo de cues vacíos
Si tras limpiar el texto la línea queda vacía (era 100% `[music playing]`), el `MutationObserver` oculta el contenedor completo (`display: none`) en vez de dejar un subtítulo en blanco parpadeando. Lo que oculta la extensión queda marcado con `data-sc-hidden` para no pisar nunca el estilo de un elemento que no ocultó ella.

### 4.4 Estado y persistencia en tiempo real
Todo vive en `chrome.storage.local`:

- `subtitleCleanerEnabled` (boolean): toggle global, lo escribe el popup.
- `subtitleCleanerRuleStates` (`{ ruleId: boolean }`): estado de cada regla, lo escribe la options page. Si no existe, se usan los `enabledByDefault`.

El content script lee ambos al cargar y escucha `chrome.storage.onChanged`, así los cambios aplican sin recargar la página. Con el toggle apagado, un contenedor que la extensión había ocultado se vuelve a mostrar en el próximo cue.

**Limitación conocida (decisión de producto: se deja así):** al desactivar el filtro, el cue que ya está en pantalla queda limpio hasta que entra el próximo (segundos). Es cosmético y de bajo impacto. Si más adelante molesta, la solución prevista es guardar el texto original en un atributo `data-original` del span antes de limpiar y restaurarlo al desactivar. Se eligió `data-original` y no un `Map` externo porque Netflix descarta y recrea los `<span>` en cada cue: el atributo muere con el nodo, mientras que un `Map` acumularía entradas huérfanas (memory leak) salvo que se agregue lógica extra para limpiarlas.

### 4.5 Testing
Sin un set de test data no es posible cubrir los edge cases de forma repetible solo mirando contenido real. Se armó un test harness (`test/test-page.html` + `test/test-page.js`) que replica la estructura real del DOM de Netflix y corre un dataset de casos (`CASES[]`) contra el content script real.

**Cómo se abre:** desde el link "test harness" al pie de la options page, como página de la propia extensión (`chrome-extension://.../test/test-page.html`). Ya no requiere el permiso "Permitir acceso a las URLs de archivos" ni que el manifest matchee `file:///*`: la página carga `cleaner.js`, `subtitle-observer.js` y `netflix.js` directo con `<script src>`.

**Dos modos:**
- **Regresión (valores fijos):** corre siempre con brackets ON, speakerLabel ON, parentheses OFF, sin importar la config del usuario. Detecta si se rompió el regex.
- **Configuración actual:** lee (sin modificar) lo que el usuario tiene en Opciones y valida el cableado storage → content script → DOM.

**Resultados esperados 100% hardcodeados:** cada caso define `expected(ruleStates)` con strings escritos a mano según el estado de las reglas relevantes; nunca se calcula llamando a `SubtitleCleaner.clean()`. Si se calculara con la misma función bajo prueba, un regex roto "aprendería" su resultado incorrecto como válido.

**Casos (12):** corchete simple (oculta contenedor), corchete + diálogo, múltiples corchetes, speaker label solo, speaker label + corchetes (depende de dos reglas, 4 combinaciones), diálogo puro (control negativo), paréntesis (activa/inactiva), corchete mal formado, dos líneas con hablantes distintos, speaker label con apóstrofe y guion, línea en mayúsculas seguida de hablante (`caps_line_then_label`, regresión del bug de 4.2), label seguido de salto de línea (`speaker_label_then_newline`).

**Verificación adicional:** los 12 casos se contrastaron fuera del navegador contra las 8 combinaciones posibles de reglas (96 chequeos, 0 fallas).

**Alcance del harness (qué cubre y qué no):** prueba la cadena completa para Netflix (nodo nuevo en el DOM → observer → cleaner → ocultar contenedor), no solo el limpiador. Pero replica únicamente el DOM de Netflix y carga solo su adaptador: **`prime.js` no está cubierto por el harness**; Prime se verificó a mano en uso real. Cerrar esa brecha es el M3. Tras la refactorización del M4 el harness dio 12/12 en ambos modos, y además el núcleo se probó fuera del navegador (jsdom, 8 chequeos) contra el DOM de Netflix y el de Prime, incluyendo un `<p>` ajeno de la interfaz de Prime para confirmar que no se toca.

**Lección (caso `two_lines_different_speakers`):** el esperado original (`"Wait.\nJOHN: For what?"`) estaba escrito para coincidir con lo que el código hacía, no con lo que debía hacer: un test que fija el bug como "comportamiento esperado". Un test pasa por el motivo correcto solo si su esperado sale de la intención, no del código.

**Lección (CSP de Manifest V3):** las páginas de la extensión corren con `script-src 'self'`, que descarta en silencio el JavaScript escrito directamente en un `<script>` dentro del HTML. Todo el JS de popup, options y test va en archivos `.js` aparte. Ante un "no hace nada", mirar primero la consola (F12).

### 4.6 Legalidad
Manipulación visual client-side de un elemento del DOM en un uso personal no infringe términos de servicio ni evade DRM (no se toca el stream de video/audio). Cuidado solo si se decide publicar en la Web Store usando marcas registradas (ej. "Netflix") en el nombre/branding.

### 4.7 Popup vs. options page
Decisión: el popup queda para acciones rápidas (toggle global + botón que abre las opciones) y la configuración de reglas vive en una options page aparte. El popup se cierra al perder el foco y tiene poco espacio; con más reglas y más sitios (M4) se quedaría corto. Se mantiene `options_page` (pestaña nueva); `options_ui` embebido es una alternativa solo de presentación.

### 4.8 Núcleo compartido y adaptadores por sitio (M4)
**Problema que resuelve:** copiar `netflix.js` a `prime.js` habría duplicado la lectura de storage, el toggle y el ocultado en cada sitio; cada cambio futuro había que repetirlo N veces, y arreglar un sitio podía romper otro.

**Por qué se extrajo recién con el segundo sitio:** con solo Netflix habríamos adivinado qué necesita variar. Con Prime delante se vio qué cambia de verdad entre sitios: el selector de las hojas de texto y el contenedor a ocultar. Todo lo demás es común.

**Diseño:** la clase `SubtitleObserver` (`core/subtitle-observer.js`) contiene el comportamiento; cada sitio aporta un objeto de configuración (datos) y arranca el observer:

```
{ name, leafSelector, containerSelector }
```

- `leafSelector`: CSS de los elementos que contienen el texto (se procesan solo si no tienen hijos elemento).
- `containerSelector`: ancestro que agrupa una línea de subtítulo; es lo que se oculta si queda vacío. Tiene que contener a las hojas.

```
Netflix: leafSelector '.player-timedtext-text-container span'
         containerSelector '.player-timedtext-text-container'
Prime:   leafSelector '.atvwebplayersdk-captions-text'
         containerSelector 'p'
```

**Aislamiento:** el manifest tiene una entrada de `content_scripts` por sitio y cada una carga solo su adaptador. Si un sitio cambia su DOM, se toca únicamente su archivo.

**Decisiones del núcleo (cambios deliberados respecto del `netflix.js` anterior):**
1. **Nunca se toca un contenedor sin hojas.** `containerSelector: 'p'` es genérico y Prime tiene muchos `<p>` de interfaz; sin esta guarda se ocultarían.
2. **Solo se reescribe el texto si cambió.** Escribir dispara otra mutación; con esta condición el proceso converge en lugar de reaccionar a sus propios cambios (idempotencia).
3. **Se reacciona también al cambio de texto dentro de una hoja existente** (mutación `childList` cuyo target es la hoja), no solo a nodos agregados y `characterData`, porque no se sabe si cada sitio recrea o reutiliza los nodos.
4. **Se marca lo ocultado con `data-sc-hidden`** y solo eso se vuelve a mostrar.

**Regla para selectores:** preferir clases semánticas y estructura antes que clases con aspecto de hash generado.

## 5. Arquitectura actual

```
subtitle-cleaner/
├── manifest.json                 # Manifest V3 — v0.3.0, una entrada de content_scripts por sitio, options_page
├── content-scripts/
│   ├── core/
│   │   ├── cleaner.js             # motor de reglas: DEFAULT_RULES + setRuleStates()/clean()
│   │   └── subtitle-observer.js   # clase SubtitleObserver: observer + storage + ocultar/mostrar (común)
│   └── sites/
│       ├── netflix.js             # adaptador Netflix (solo datos) + arranque
│       └── prime.js               # adaptador Prime Video (solo datos) + arranque
├── popup/
│   ├── popup.html                 # toggle global + botón "Reglas de filtrado…"
│   └── popup.js
├── options/
│   ├── options.html               # un checkbox por regla + link al test harness
│   └── options.js                 # genera la UI desde DEFAULT_RULES, guarda por regla
└── test/
    ├── test-page.html             # estructura del harness (sin JS inline, por CSP)
    └── test-page.js               # CASES[] con expected hardcodeado, 2 modos
```

**Una sola fuente de verdad para las reglas:** `options.js` y el test harness leen `SubtitleCleaner.DEFAULT_RULES`; agregar una regla en `cleaner.js` la hace aparecer en el menú sin tocar `options.js`.

**Flujo de datos:**
1. El manifest carga, según el sitio, `cleaner.js` + `subtitle-observer.js` + el adaptador de ese sitio.
2. El adaptador crea `new SubtitleObserver(adapter).start()`, que lee `subtitleCleanerEnabled` y `subtitleCleanerRuleStates` de `chrome.storage.local`, escucha `onChanged` y arranca un `MutationObserver` sobre `document.body`.
3. Ante cada mutación, el observer ubica las hojas de texto (`leafSelector`) afectadas y agrupa por contenedor (`containerSelector`).
4. Cada contenedor se limpia con `SubtitleCleaner.clean()` (solo reglas activas). Si el toggle global está desactivado, no se limpia y se vuelve a mostrar lo que se había ocultado.
5. Si el texto limpio de todo el contenedor queda vacío, el contenedor se oculta; si no, se muestra.

## 6. Milestones

### M0 — Setup y validación técnica ✅
Inspección del DOM real de Netflix; confirmado overlay JS puro. YouTube fuera de scope por decisión propia.

### M1 — MVP en Netflix ✅
Manifest V3 + `MutationObserver`; regex de corchetes + speaker label; manejo de cues vacíos. Confirmado en uso real.

### M1.1 — Toggle básico ✅
Popup on/off, persistido en `chrome.storage.local`, aplicado en vivo.

### M1.2 — Test harness ✅
Dataset de casos corrido contra el content script real.

### M2 — Menú de opciones granular ✅
- Options page con un checkbox por regla (corchetes, hablante, paréntesis), persistido como `subtitleCleanerRuleStates`.
- Reglas parametrizadas en `cleaner.js` (patrón como string).
- Link al test harness desde las opciones; test harness v2 (sin permisos de archivo, dos modos, esperados hardcodeados, 12 casos).
- Corrección del regex de `speakerLabel` (ver 4.2).

### M2.1 — Restauración retroactiva al desactivar (opcional, diferido)
Guardar el original en `data-original` y restaurarlo al desactivar el filtro o una regla. Se implementa solo si el comportamiento actual molesta en uso real.

### M3 — Test harness multi-sitio (pendiente)
Parametrizar el "shape" del DOM mockeado por sitio en `test-page.js` (hoy solo replica Netflix y carga solo `netflix.js`) para cubrir también `prime.js` y los adaptadores futuros.

### M4 — Soporte para Prime Video ✅ (trabajado directo en `main`)
1. Paso 0 hecho: inspección del DOM de Prime (overlay JS, ver 4.1).
2. Extracción de `SubtitleObserver` a `core/` y adaptadores de solo datos (ver 4.8).
3. Manifest v0.3.0 con una entrada por sitio.
4. Confirmado funcionando en Prime en uso real; Netflix sin regresiones (harness 12/12 en ambos modos).
5. Pendiente menor: confirmar con el dominio real de Prime que usa el usuario que el `matches` del manifest (`primevideo.com` y `amazon.com/gp/video/*`) es el correcto, y sacar el que sobre.

### M4.1 — Disney+ y Max (pendiente)
Paso 0 por sitio (inspección del DOM) antes de escribir código. Para Max, verificar primero si ofrece una pista de subtítulos separada de los closed captions; si es así, quizás no haga falta adaptador (confirmar con más de un título).

### M5 — Icono, empaquetado y distribución
- Diseñar un ícono (hoy no tiene).
- Definir distribución: "Cargar descomprimida" (zip) vs. Chrome Web Store; si es Web Store, revisar naming/trademark y preparar assets.
- Si se mantiene instalación manual, documentar el proceso para terceros.

## 7. Riesgos y puntos abiertos

- **Cambios de DOM por parte de las plataformas:** pueden romper el selector sin aviso. Mitigación: selectores robustos y un adaptador aislado por sitio (ver 4.8).
- **Clases con hash en Prime:** `leafSelector` usa la única clase semántica visible; el `containerSelector` (`p`) es estructural y podría dejar de valer si Prime cambia su estructura. Se arregla solo en `prime.js`.
- **Falsos positivos con paréntesis:** por eso la regla está OFF por defecto y es opcional desde M2.
- **Rendimiento:** el `MutationObserver` observa todo `document.body`. Prime tiene mucha interfaz, así que conviene vigilarlo en uso prolongado; si hay impacto, acotarlo a un ancestro más cercano del reproductor.
- **Regex y texto multilínea:** `\s` y `^` se comportan distinto con saltos de línea (ver 4.2). Cualquier regla nueva debería probarse con un caso multilínea.
- **Bug del guion inicial:** abierto, ver 4.2.
- **Brecha de cobertura:** `prime.js` no tiene casos en el harness hasta el M3.
- **Disney+ y Max pueden no parecerse a Netflix ni a Prime:** de ahí el paso 0 de inspección por sitio.

## 8. Flujo de trabajo y repo

- **Decisión (2026-11-10):** se trabaja directo en `main`, sin ramas `feature/...`. Para compensar: commits chicos y atómicos (uno por cambio lógico), la documentación en commits aparte con prefijo `docs:`, y `main` siempre con un punto de restauración limpio (el commit anterior) al que volver con `git revert`.
- Antes de cerrar un milestone: test harness en verde en ambos modos + probar en uso real en cada sitio soportado.
- Cargar la extensión: `chrome://extensions` → modo desarrollador → "Cargar descomprimida" apuntando a la carpeta que contiene `manifest.json` (la estructura de subcarpetas tiene que respetarse, o el manifest no encuentra los archivos). Tras cambiar código, recargar la extensión desde esa misma pantalla.

## 9. Próximos pasos inmediatos

- [x] Test harness en 12/12 en ambos modos tras la corrección de `speakerLabel`.
- [x] Commit y push de M2 a `main`.
- [x] M4: refactorización a `SubtitleObserver` + adaptador de Prime, commiteado y pusheado a `main`.
- [ ] Commit de este documento (`docs:`).
- [ ] Bug del guion inicial: primero el caso en `CASES[]` con esperado a mano, verlo fallar, después corregir la regla.
- [ ] M3: harness multi-sitio (cubrir `prime.js`).
- [ ] Confirmar el dominio de Prime en el manifest.
- [ ] M4.1: paso 0 de Disney+; verificar CC vs. subtítulos separados en Max.
- [ ] M5: ícono y empaquetado/distribución.
- [ ] Seguir monitoreando en uso real y sumar edge cases a `CASES[]`.

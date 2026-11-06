# Subtitle Cleaner — Documento de Arquitectura

> Extensión de Chrome para filtrar en tiempo real el contenido no-dialogal de los subtítulos (closed captions) en sitios de streaming, dejando solo el diálogo puro.

**Estado del proyecto:** M1 completo sobre Netflix (filtro + toggle + test harness) — en monitoreo con uso real antes de avanzar al menú de opciones
**Última actualización:** 2026-09-22

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
- Soporte multi-sitio mediante configuración modular por plataforma (Netflix primero; YouTube quedó fuera de scope por decisión propia, se prioriza el sitio de uso real).
- Reglas de limpieza configurables (regex) desde un popup/menú de opciones.

**No incluye (por ahora):**
- Traducción de subtítulos.
- Generación de subtítulos propios (STT).
- Publicación en la Chrome Web Store bajo nombre/branding de terceros (Netflix, etc.) — ver sección de legalidad.

## 4. Consideraciones técnicas clave

### 4.1 Cómo renderiza subtítulos cada plataforma

| Tipo | Cómo funciona | Ejemplos | Estrategia de filtrado |
|---|---|---|---|
| **Nativo (`<track>` / WebVTT)** | El navegador parsea un archivo VTT/SRT y expone `cue.text` vía la Text Track API | YouTube (fuera de scope actual) | Escuchar el evento `cuechange` sobre el `TextTrack` |
| **Overlay inyectado por JS** | La plataforma dibuja los subtítulos como texto en un `<div>` que actualiza dinámicamente, sin usar `<track>` | **Netflix (confirmado)**, probablemente Prime/Disney+ | `MutationObserver` sobre el contenedor de subtítulos |

**Confirmado por inspección manual del DOM (M0):** Netflix no tiene `<track kind="captions">`. Los subtítulos se inyectan como overlay puro:

```
div.player-timedtext-text-container
  └─ span (wrapper)
      └─ span (leaf, contiene el texto real, ej. "[scoffs]")
```

Esto define la estrategia real usada en el M1: `MutationObserver` sobre `document.body` (childList + characterData), filtrando por el selector `.player-timedtext-text-container` y limpiando los `<span>` "hoja" (sin hijos elemento).

### 4.2 Reglas de limpieza (regex)

Implementadas en `content-scripts/core/cleaner.js`, como lista de reglas independientes:

- **Corchetes** `/\[[^\]]*\]/g` — activa por defecto. Cubre `[music playing]`, `[scoffs]`, etc.
- **Nombre de hablante en mayúsculas** `/^[A-Z][A-Z0-9\s'.-]{1,30}:\s*/g` — activa por defecto. Cubre `JOHN:`, `MARY-ANNE'S VOICE:`.
- **Paréntesis de sonido ambiente** `/\([^)]*\)/g` — **NO activa por defecto** (riesgo de falso positivo con diálogo real que use paréntesis). Pendiente de exponer como toggle opcional (ver Roadmap).

### 4.3 Manejo de cues vacíos
Si tras limpiar el texto la línea queda vacía (era 100% `[music playing]`), el `MutationObserver` oculta el contenedor completo (`display: none`) en vez de dejar un subtítulo en blanco parpadeando. Confirmado funcionando vía test harness (caso `brackets_simple`).

### 4.4 Toggle en tiempo real
El estado on/off se guarda en `chrome.storage.local` (clave `subtitleCleanerEnabled`). El popup lo lee/escribe; el content script lo escucha vía `chrome.storage.onChanged`, así el cambio aplica sin recargar la página.

**Limitación conocida:** al desactivar, las líneas ya limpiadas en pantalla no se restauran retroactivamente — recién la próxima línea de subtítulo muestra el CC completo de nuevo. Pendiente de resolver guardando el texto original en un atributo `data-*` para poder restaurarlo (ver Roadmap).

### 4.5 Testing
Sin un set de test data no es posible cubrir los edge cases de forma repetible solo mirando contenido real. Se armó `test/test-page.html`: una página local que replica la estructura real del DOM de Netflix e inyecta un dataset de casos (array `CASES` en el script) contra el content script real, comparando resultado obtenido vs. esperado. Requiere habilitar "Permitir acceso a las URLs de archivos" para la extensión en `chrome://extensions`, porque el manifest matchea `file:///*` además de Netflix.

Casos cubiertos hoy: corchete simple (oculta contenedor), corchete + diálogo, múltiples corchetes, speaker label solo y combinado con corchetes, diálogo puro sin cambios (control negativo), paréntesis sin tocar (confirma que la regla está inactiva), corchete mal formado (no rompe), dos líneas con hablantes distintos, speaker label con apóstrofe y guion.

### 4.6 Legalidad
Manipulación visual client-side de un elemento del DOM en un uso personal no infringe términos de servicio ni evade DRM (no se toca el stream de video/audio). Cuidado solo si se decide publicar en la Web Store usando marcas registradas (ej. "Netflix") en el nombre/branding.

## 5. Arquitectura actual

```
subtitle-cleaner/
├── manifest.json                 # Manifest V3 — matches Netflix + file:// (test harness)
├── content-scripts/
│   ├── core/
│   │   └── cleaner.js             # motor de limpieza (regex engine, reglas activas)
│   └── sites/
│       └── netflix.js             # adaptador Netflix: MutationObserver + toggle vía storage
├── popup/
│   ├── popup.html                 # botón toggle on/off
│   └── popup.js                   # lee/escribe chrome.storage.local
└── test/
    └── test-page.html             # test harness con dataset de casos (CASES[])
```

**Flujo de datos actual:**
1. El content script (`netflix.js`) carga junto con la página de Netflix (o del test harness) y arranca un `MutationObserver` sobre `document.body`.
2. Al cargar, lee el estado del toggle desde `chrome.storage.local` y queda escuchando cambios (`chrome.storage.onChanged`).
3. Cada vez que aparece o cambia un `.player-timedtext-text-container`, sus `<span>` hoja pasan por `SubtitleCleaner.clean()` (reglas de `cleaner.js`).
4. Si el toggle está desactivado, `cleanContainer` corta temprano y no modifica nada.
5. Si el texto limpio queda vacío, el contenedor se oculta completo.

**Lo que falta para llegar a la arquitectura modular original (multi-sitio, options page, reglas por-nombre) está en el Roadmap.**

## 6. Milestones

### M0 — Setup y validación técnica ✅ Completo
- Se inspeccionó el DOM real de Netflix con subtítulos en pantalla.
- Confirmado: no hay `<track kind="captions">`, es overlay JS puro (`.player-timedtext-text-container`).
- YouTube quedó fuera de scope por decisión propia (se prioriza el sitio de uso real).

### M1 — MVP en Netflix ✅ Completo
- Manifest V3 + content script con `MutationObserver` (no `cuechange`, porque Netflix no usa `<track>`).
- Regex de corchetes + speaker label funcionando en tiempo real.
- Manejo de cues vacíos (ocultar contenedor).
- Confirmado funcionando en uso real.

### M1.1 — Toggle básico ✅ Completo
- Popup con botón on/off.
- Estado persistido en `chrome.storage.local`, aplicado en tiempo real sin recargar.

### M1.2 — Test harness ✅ Completo
- `test/test-page.html` con dataset de 10 casos definidos (`CASES[]`), corridos contra el content script real.
- Resuelve la falta de un set de test data para cobertura repetible.

### M2 — Menú de opciones granular (próximo)
- Options page (o ampliar el popup) con un toggle por regla: corchetes, paréntesis, nombre de hablante — activar/desactivar cada una individualmente en vez de todo-o-nada.
- Persistir cada regla como entrada separada en `chrome.storage.local` (hoy `cleaner.js` tiene las reglas hardcodeadas en el array `RULES`).
- Restaurar texto original al desactivar una regla en caliente (guardar original en `data-*` antes de limpiar), resolviendo la limitación anotada en 4.4.

### M3 — Test harness multi-sitio
- Generalizar `test-page.html` para aceptar no solo la estructura de Netflix sino la de otras fuentes (Prime, Disney+, etc.) a medida que se agreguen adaptadores — parametrizar el "shape" del DOM mockeado por sitio en vez de hardcodear la estructura de Netflix.

### M4 — Soporte multi-sitio real
- Adaptador para Prime Video / Disney+ (según prioridad de uso real), reutilizando `cleaner.js` como motor común.
- Arquitectura de adaptadores generalizada (detección de sitio por hostname + carga del adaptador correspondiente).

### M5 — Icono, empaquetado y distribución
- Diseñar un ícono para la extensión (hoy no tiene).
- Definir forma de compartir/distribuir: instalación manual vía "Cargar descomprimida" (zip) vs. publicación en la Chrome Web Store.
- Si se opta por Web Store: revisar naming/trademark (no usar "Netflix" en el nombre/branding), preparar assets requeridos (ícono en varios tamaños, capturas, descripción).
- Si se mantiene instalación manual: documentar el proceso de carga para compartir con terceros fácilmente.

## 7. Riesgos y puntos abiertos

- **Cambios de DOM por parte de las plataformas**: Netflix/Prime pueden cambiar su estructura interna sin aviso, rompiendo el selector. Mitigación: selectores lo más robustos posible + fácil de actualizar por adaptador.
- **Falsos positivos con paréntesis**: diálogo real a veces usa paréntesis; por eso la regla está desactivada por defecto — se resuelve mejor con el toggle granular del M2.
- **Rendimiento**: el `MutationObserver` observa todo `document.body` (no un contenedor padre acotado, porque no se confirmó su clase). Vigilar si aparece algún impacto de performance en uso prolongado; si aparece, acotar el observer a un ancestro más cercano del reproductor.
- **Restauración al togglear**: desactivar el filtro no restaura retroactivamente las líneas ya limpiadas (ver 4.4) — pendiente para M2.

## 8. Próximos pasos inmediatos

- [ ] Seguir monitoreando el M1 en uso real para detectar edge cases no cubiertos por el test harness y sumarlos al dataset `CASES[]`.
- [ ] Arrancar M2: menú de opciones con toggles individuales por regla.
- [ ] Generalizar el test harness para múltiples fuentes (M3).
- [ ] Definir ícono y estrategia de empaquetado/distribución (M5).

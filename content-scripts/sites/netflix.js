// content-scripts/sites/netflix.js
//
// Adaptador para Netflix: Netflix no usa <track kind="captions">, dibuja los
// subtítulos como overlay JS puro dentro de .player-timedtext-text-container.
// Por eso usamos MutationObserver en vez de escuchar el evento "cuechange".

const SUBTITLE_CONTAINER_SELECTOR = '.player-timedtext-text-container';

let extensionEnabled = true;

function isLeafSpan(node) {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    node.tagName === 'SPAN' &&
    // "hoja" = no tiene elementos hijos, solo texto
    Array.from(node.childNodes).every((c) => c.nodeType === Node.TEXT_NODE)
  );
}

function cleanContainer(container) {
  if (!extensionEnabled) return;

  const leafSpans = container.querySelectorAll('span');
  let anyVisibleTextLeft = false;

  leafSpans.forEach((span) => {
    if (!isLeafSpan(span)) return;

    const cleaned = SubtitleCleaner.clean(span.textContent);
    span.textContent = cleaned;

    if (cleaned.length > 0) anyVisibleTextLeft = true;
  });

  // Si tras limpiar no queda texto (era 100% ruido no-dialogal), ocultamos
  // el contenedor completo en vez de dejar un subtítulo en blanco.
  container.style.display = anyVisibleTextLeft ? '' : 'none';
}

function scanForSubtitleContainers(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  if (root.matches?.(SUBTITLE_CONTAINER_SELECTOR)) {
    cleanContainer(root);
  }
  root.querySelectorAll?.(SUBTITLE_CONTAINER_SELECTOR).forEach(cleanContainer);
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(scanForSubtitleContainers);

    // characterData: cuando el texto de un nodo existente cambia in-place
    if (mutation.type === 'characterData' && mutation.target.parentElement) {
      const container = mutation.target.parentElement.closest(
        SUBTITLE_CONTAINER_SELECTOR
      );
      if (container) cleanContainer(container);
    }
  }
});

function startObserving() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function loadStateFromStorage() {
  chrome.storage.local.get(
    ['subtitleCleanerEnabled', 'subtitleCleanerRuleStates'],
    (result) => {
      extensionEnabled = result.subtitleCleanerEnabled ?? true;

      if (result.subtitleCleanerRuleStates) {
        SubtitleCleaner.setRuleStates(result.subtitleCleanerRuleStates);
      }
      // si no hay nada guardado todavía, cleaner.js ya arranca con sus
      // valores enabledByDefault.
    }
  );
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.subtitleCleanerEnabled) {
    extensionEnabled = changes.subtitleCleanerEnabled.newValue;
    // Nota (M2, opcional/pendiente): al desactivar no se restaura
    // retroactivamente el cue visible en pantalla en ese instante —
    // se resuelve solo, en el próximo cambio de cue. Ver doc de
    // arquitectura, sección 4.4, si más adelante se decide implementar
    // la restauración con data-original.
  }

  if (changes.subtitleCleanerRuleStates) {
    SubtitleCleaner.setRuleStates(changes.subtitleCleanerRuleStates.newValue);
  }
});

loadStateFromStorage();
startObserving();

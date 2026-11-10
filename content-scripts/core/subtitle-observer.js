// content-scripts/core/subtitle-observer.js
//
// Lógica COMÚN a todos los sitios: observar el DOM, leer el estado desde
// chrome.storage, limpiar el texto con SubtitleCleaner y ocultar las líneas
// que quedan vacías. No sabe nada de ningún sitio en particular: eso lo
// aporta un "adaptador" (un objeto con datos, ver content-scripts/sites/).
//
// Contrato del adaptador:
//   name              string  solo para depuración
//   leafSelector      string  CSS de los elementos que contienen el texto del
//                             subtítulo (se procesan solo si no tienen hijos
//                             elemento, o sea, "hojas")
//   containerSelector string  CSS del ancestro que agrupa una línea de
//                             subtítulo; es lo que se oculta si queda vacío.
//                             Tiene que CONTENER a las hojas.

class SubtitleObserver {
  constructor(adapter) {
    this.adapter = adapter;
    this.enabled = true;
    this.observer = new MutationObserver((mutations) =>
      this.handleMutations(mutations)
    );
  }

  start() {
    console.log(`[Subtitle Cleaner] ${this.adapter.name} activo en`, location.href, window === window.top ? '(frame principal)' : '(iframe)');
    this.loadStateFromStorage();
    chrome.storage.onChanged.addListener((changes, area) =>
      this.onStorageChanged(changes, area)
    );
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ---------- estado (storage) ----------

  loadStateFromStorage() {
    chrome.storage.local.get(
      ['subtitleCleanerEnabled', 'subtitleCleanerRuleStates'],
      (result) => {
        this.enabled = result.subtitleCleanerEnabled ?? true;
        if (result.subtitleCleanerRuleStates) {
          SubtitleCleaner.setRuleStates(result.subtitleCleanerRuleStates);
        }
      }
    );
  }

  onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (changes.subtitleCleanerEnabled) {
      this.enabled = changes.subtitleCleanerEnabled.newValue ?? true;
    }
    if (changes.subtitleCleanerRuleStates) {
      SubtitleCleaner.setRuleStates(changes.subtitleCleanerRuleStates.newValue);
    }
  }

  // ---------- detección ----------

  handleMutations(mutations) {
    const containers = new Set();
    for (const m of mutations) {
      if (m.type === 'characterData') {
        this.collectFrom(m.target.parentElement, containers, false);
      } else {
        // childList: el target es el padre cuyos hijos cambiaron (cubre el
        // caso "el sitio reemplaza el texto dentro de la misma hoja")...
        this.collectFrom(m.target, containers, false);
        // ...y además miramos todo lo que se agregó (nodos nuevos completos).
        m.addedNodes.forEach((n) => this.collectFrom(n, containers, true));
      }
    }
    containers.forEach((c) => this.cleanContainer(c));
  }

  collectFrom(node, containers, deep) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    const { leafSelector } = this.adapter;
    this.collectLeaf(node.closest(leafSelector), containers);
    if (deep) {
      node
        .querySelectorAll(leafSelector)
        .forEach((leaf) => this.collectLeaf(leaf, containers));
    }
  }

  collectLeaf(leaf, containers) {
    if (!leaf || !this.isLeaf(leaf)) return;
    const container = leaf.closest(this.adapter.containerSelector);
    if (container) containers.add(container);
  }

  isLeaf(el) {
    return Array.from(el.childNodes).every((c) => c.nodeType === Node.TEXT_NODE);
  }

  // ---------- limpieza ----------

  cleanContainer(container) {
    if (!this.enabled) {
      this.show(container);
      return;
    }

    const leaves = Array.from(
      container.querySelectorAll(this.adapter.leafSelector)
    ).filter((el) => this.isLeaf(el));

    // Un containerSelector genérico (ej. "p") puede matchear elementos que
    // no tienen nada que ver con subtítulos: sin hojas, no se toca.
    if (leaves.length === 0) return;

    let anyTextLeft = false;
    for (const leaf of leaves) {
      const cleaned = SubtitleCleaner.clean(leaf.textContent);
      // Solo escribimos si cambió: escribir dispara otra mutación, y así
      // el proceso converge en vez de reaccionar a sus propios cambios.
      if (cleaned !== leaf.textContent) leaf.textContent = cleaned;
      if (cleaned.length > 0) anyTextLeft = true;
    }

    if (anyTextLeft) this.show(container);
    else this.hide(container);
  }

  // Marcamos lo que ocultamos nosotros para nunca pisar el estilo de un
  // elemento que no fue ocultado por la extensión.
  hide(container) {
    container.style.display = 'none';
    container.dataset.scHidden = '1';
  }

  show(container) {
    if (!container.dataset.scHidden) return;
    container.style.display = '';
    delete container.dataset.scHidden;
  }
}
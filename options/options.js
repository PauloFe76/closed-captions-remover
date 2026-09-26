// options/options.js
//
// Genera un checkbox por cada regla definida en cleaner.js (DEFAULT_RULES) y
// persiste el estado de cada una por separado en chrome.storage.local, bajo
// la clave "subtitleCleanerRuleStates" (un objeto { ruleId: boolean }).
//
// Importante: acá NO reinventamos la lista de reglas — la leemos de
// SubtitleCleaner.DEFAULT_RULES (definida en cleaner.js, cargado antes que
// este script). Así hay una sola fuente de verdad: si mañana agregás una
// regla nueva en cleaner.js, aparece acá sin tocar este archivo.

const rulesContainer = document.getElementById('rulesContainer');
const savedMsg = document.getElementById('savedMsg');

function currentDefaults() {
  return Object.fromEntries(
    SubtitleCleaner.DEFAULT_RULES.map((r) => [r.id, r.enabledByDefault])
  );
}

function renderRules(ruleStates) {
  rulesContainer.innerHTML = '';

  SubtitleCleaner.DEFAULT_RULES.forEach((rule) => {
    const row = document.createElement('div');
    row.className = 'rule';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `rule-${rule.id}`;
    checkbox.checked = ruleStates[rule.id] ?? rule.enabledByDefault;

    checkbox.addEventListener('change', () => {
      saveRuleState(rule.id, checkbox.checked);
    });

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.innerHTML = `
      <div class="rule-label">${rule.label}</div>
      <div class="rule-example">ej: ${rule.example}</div>
    `;

    row.appendChild(checkbox);
    row.appendChild(label);
    rulesContainer.appendChild(row);
  });
}

function saveRuleState(ruleId, isEnabled) {
  chrome.storage.local.get(['subtitleCleanerRuleStates'], (result) => {
    const current = result.subtitleCleanerRuleStates ?? currentDefaults();
    const updated = { ...current, [ruleId]: isEnabled };

    chrome.storage.local.set({ subtitleCleanerRuleStates: updated }, () => {
      savedMsg.textContent = 'Guardado ✓';
      setTimeout(() => (savedMsg.textContent = ''), 1200);
    });
  });
}

chrome.storage.local.get(['subtitleCleanerRuleStates'], (result) => {
  const ruleStates = result.subtitleCleanerRuleStates ?? currentDefaults();
  renderRules(ruleStates);
});

// Link al test harness: se abre en una pestaña nueva como página de la
// propia extensión (chrome-extension://.../test/test-page.html), por eso
// necesita chrome.runtime.getURL() en vez de un href relativo fijo.
document.getElementById('testHarnessLink').addEventListener('click', (e) => {
  e.preventDefault();
  window.open(chrome.runtime.getURL('test/test-page.html'), '_blank');
});

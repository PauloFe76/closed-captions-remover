// test/test-page.js
//
// IMPORTANTE: el "expected" de cada caso está hardcodeado a mano como texto
// fijo, condicionado por el estado de las reglas relevantes — NUNCA se
// calcula llamando a SubtitleCleaner.clean(). Si lo calculáramos con esa
// función, un regex roto "aprendería" su propio resultado incorrecto como
// si fuera el correcto, y el test dejaría de servir para detectar el bug
// que se supone que tiene que atrapar.

const FIXED_RULE_STATES = {
  brackets: true,
  speakerLabel: true,
  parentheses: false,
};

// Cada caso define su input y una función expected(ruleStates) escrita a
// mano con strings fijos — no regex, no llamadas a cleaner.js.
const CASES = [
  {
    id: 'brackets_simple',
    input: '[music playing]',
    expected: (r) => (r.brackets ? '' : '[music playing]'),
  },
  {
    id: 'brackets_with_dialogue',
    input: "[door creaking] Who's there?",
    expected: (r) => (r.brackets ? "Who's there?" : "[door creaking] Who's there?"),
  },
  {
    id: 'multiple_brackets',
    input: '[music playing] [indistinct chatter]',
    expected: (r) => (r.brackets ? '' : '[music playing] [indistinct chatter]'),
  },
  {
    id: 'speaker_label_only',
    input: 'JOHN:',
    expected: (r) => (r.speakerLabel ? '' : 'JOHN:'),
  },
  {
    id: 'speaker_label_with_brackets',
    input: 'JOHN: [sighs] I told you already.',
    // depende de las dos reglas -> 4 combinaciones posibles
    expected: (r) => {
      if (r.brackets && r.speakerLabel) return 'I told you already.';
      if (!r.brackets && r.speakerLabel) return '[sighs] I told you already.';
      if (r.brackets && !r.speakerLabel) return 'JOHN:  I told you already.';
      return 'JOHN: [sighs] I told you already.';
    },
  },
  {
    id: 'pure_dialogue_control',
    input: "I can't believe this is happening.",
    // control negativo: ninguna regla lo debería tocar nunca
    expected: () => "I can't believe this is happening.",
  },
  {
    id: 'parentheses_untouched',
    input: '(laughs) That was close.',
    expected: (r) => (r.parentheses ? 'That was close.' : '(laughs) That was close.'),
  },
  {
    id: 'malformed_bracket',
    input: '[music playing without closing bracket',
    // falta el "]" de cierre: no matchea el regex de corchetes pase lo que
    // pase con la regla -> siempre queda intacto
    expected: () => '[music playing without closing bracket',
  },
  {
    id: 'two_lines_different_speakers',
    input: 'MARY: Wait.\nJOHN: For what?',
    // cada línea tiene su propio hablante: con la regla activa se limpian los dos
    expected: (r) => (r.speakerLabel ? 'Wait.\nFor what?' : 'MARY: Wait.\nJOHN: For what?'),
  },
  {
    id: 'caps_line_then_label',
    input: 'WAIT\nJOHN: Hi',
    // regresión: "WAIT" es diálogo real en mayúsculas, NO es un hablante.
    // Antes se borraba junto con "JOHN:" porque \s cruzaba el salto de línea.
    expected: (r) => (r.speakerLabel ? 'WAIT\nHi' : 'WAIT\nJOHN: Hi'),
  },
  {
    id: 'speaker_apostrophe_hyphen',
    input: "MARY-ANNE'S VOICE: Come in.",
    expected: (r) => (r.speakerLabel ? 'Come in.' : "MARY-ANNE'S VOICE: Come in."),
  },
  {
    id: 'speaker_label_then_newline',
    input: 'JOHN:\nHello',
    // el hablante queda solo en su línea: se saca el label, el diálogo sobrevive
    expected: (r) => (r.speakerLabel ? 'Hello' : 'JOHN:\nHello'),
  },
];

function buildCaseDOM(testCase) {
  const container = document.createElement('div');
  container.className = 'player-timedtext-text-container';
  container.id = `container-${testCase.id}`;

  const wrapper = document.createElement('span');
  const leaf = document.createElement('span');
  leaf.textContent = testCase.input;

  wrapper.appendChild(leaf);
  container.appendChild(wrapper);
  return container;
}

function describeRuleStates(states) {
  return SubtitleCleaner.DEFAULT_RULES.map((r) => `${r.label}: ${states[r.id] ? 'ON' : 'OFF'}`).join(
    ' · '
  );
}

function getCurrentRuleStates() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['subtitleCleanerRuleStates'], (result) => {
      resolve(
        result.subtitleCleanerRuleStates ??
          Object.fromEntries(SubtitleCleaner.DEFAULT_RULES.map((r) => [r.id, r.enabledByDefault]))
      );
    });
  });
}

async function runTests(mode) {
  document.getElementById('btnFixed').classList.toggle('active', mode === 'fixed');
  document.getElementById('btnCurrent').classList.toggle('active', mode === 'current');

  const ruleStates = mode === 'fixed' ? FIXED_RULE_STATES : await getCurrentRuleStates();

  // Esto sincroniza el content script real (netflix.js) para que limpie
  // los spans de prueba con este estado de reglas.
  SubtitleCleaner.setRuleStates(ruleStates);

  document.getElementById('modeInfo').textContent =
    (mode === 'fixed' ? 'Valores fijos' : 'Tu configuración real (Opciones)') +
    ' → ' +
    describeRuleStates(ruleStates);

  const sandbox = document.getElementById('sandbox');
  sandbox.innerHTML = '';
  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';
  let passCount = 0;

  for (const testCase of CASES) {
    const container = buildCaseDOM(testCase);
    sandbox.appendChild(container);

    // darle un tick al MutationObserver para que procese la inserción
    await new Promise((r) => setTimeout(r, 50));

    const leaf = container.querySelector('span span') || container.querySelector('span');
    const actualText = leaf.textContent;
    const actualHidden = container.style.display === 'none';

    const expectedText = testCase.expected(ruleStates);
    const expectedHidden = expectedText === '';

    const pass = actualText === expectedText && actualHidden === expectedHidden;
    if (pass) passCount++;

    const caseDiv = document.createElement('div');
    caseDiv.className = `case ${pass ? 'pass' : 'fail'}`;
    caseDiv.innerHTML = `
      <div class="label">${pass ? '✅' : '❌'} ${testCase.id}</div>
      <div class="mono">input: ${JSON.stringify(testCase.input)}</div>
      <div class="mono">esperado: ${JSON.stringify(expectedText)} (hidden=${expectedHidden})</div>
      <div class="mono">obtenido: ${JSON.stringify(actualText)} (hidden=${actualHidden})</div>
    `;
    resultsEl.appendChild(caseDiv);
  }

  document.getElementById('summary').textContent = `${passCount} / ${CASES.length} casos OK`;
}

document.getElementById('btnFixed').addEventListener('click', () => runTests('fixed'));
document.getElementById('btnCurrent').addEventListener('click', () => runTests('current'));

window.addEventListener('load', () => setTimeout(() => runTests('fixed'), 200));
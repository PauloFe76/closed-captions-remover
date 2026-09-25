// content-scripts/core/cleaner.js
//
// Motor de limpieza de subtítulos. Define las reglas disponibles y expone
// una API para aplicarlas sobre un texto.
//
// IMPORTANTE (M2): las reglas ya NO están hardcodeadas como un array fijo de
// RegExp. chrome.storage no puede persistir objetos RegExp (no son
// serializables), así que cada regla se define como { pattern, flags } en
// texto plano, y el RegExp se reconstruye en el momento de limpiar.

const DEFAULT_RULES = [
  {
    id: 'brackets',
    label: 'Descripciones entre corchetes',
    example: '[music playing]',
    pattern: '\\[[^\\]]*\\]',
    flags: 'g',
    enabledByDefault: true,
  },
  {
    id: 'speakerLabel',
    label: 'Nombre de hablante en mayúsculas',
    example: "JOHN: ¿Qué hacés acá?",
    pattern: "^[A-Z][A-Z0-9\\s'.-]{1,30}:\\s*",
    flags: 'g',
    enabledByDefault: true,
  },
  {
    id: 'parentheses',
    label: 'Sonido ambiente entre paréntesis',
    example: '(sighs)',
    pattern: '\\([^)]*\\)',
    flags: 'g',
    enabledByDefault: false, // riesgo de falso positivo con diálogo real
  },
];

const SubtitleCleaner = (() => {
  // Por defecto, arrancamos con el estado "enabledByDefault" de cada regla.
  // netflix.js pisa esto apenas lee el storage real.
  let ruleStates = Object.fromEntries(
    DEFAULT_RULES.map((r) => [r.id, r.enabledByDefault])
  );

  function setRuleStates(newStates) {
    ruleStates = { ...ruleStates, ...newStates };
  }

  function getRuleStates() {
    return { ...ruleStates };
  }

  function clean(text) {
    let result = text;
    for (const rule of DEFAULT_RULES) {
      if (!ruleStates[rule.id]) continue;
      const regex = new RegExp(rule.pattern, rule.flags);
      result = result.replace(regex, '');
    }
    return result.trim();
  }

  return {
    DEFAULT_RULES,
    clean,
    setRuleStates,
    getRuleStates,
  };
})();

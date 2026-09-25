// popup/popup.js

const toggle = document.getElementById('enabledToggle');
const statusText = document.getElementById('statusText');
const openOptionsBtn = document.getElementById('openOptions');

function refreshStatusText(enabled) {
  statusText.textContent = enabled
    ? 'Ocultando ruido no-dialogal.'
    : 'Mostrando subtítulos completos.';
}

chrome.storage.local.get(['subtitleCleanerEnabled'], (result) => {
  const enabled = result.subtitleCleanerEnabled ?? true;
  toggle.checked = enabled;
  refreshStatusText(enabled);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ subtitleCleanerEnabled: enabled });
  refreshStatusText(enabled);
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

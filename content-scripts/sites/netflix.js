// content-scripts/sites/netflix.js
//
// Adaptador de Netflix: solo DATOS. Netflix no usa <track>, dibuja los
// subtítulos como overlay JS dentro de .player-timedtext-text-container.
// Toda la lógica vive en core/subtitle-observer.js.

const NetflixAdapter = {
  name: 'Netflix',
  leafSelector: '.player-timedtext-text-container span',
  containerSelector: '.player-timedtext-text-container',
};

new SubtitleObserver(NetflixAdapter).start();
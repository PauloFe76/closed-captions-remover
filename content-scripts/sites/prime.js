
// content-scripts/sites/prime.js
//
// Adaptador de Prime Video: solo DATOS. Toda la lógica vive en
// core/subtitle-observer.js.
//
// Estructura observada (inspección del DOM, M4 paso 0):
//   div (position:absolute) > p > span.<hash> > span.atvwebplayersdk-captions-text
//
// Solo "atvwebplayersdk-captions-text" parece un nombre semántico del SDK del
// reproductor. Las demás clases (fbhsa9, f1iwgj00, f7j034j...) parecen hashes
// generados que pueden cambiar en cualquier deploy: NO usarlas en selectores.
 
const PrimeAdapter = {
  name: 'Prime Video',
  leafSelector: '.atvwebplayersdk-captions-text',
  containerSelector: 'p',
};
 
new SubtitleObserver(PrimeAdapter).start();
 
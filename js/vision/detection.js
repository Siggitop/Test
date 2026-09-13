/**
 * detection.js
 * ------------
 * Markererkennung über js-aruco2, mit einem Mehrskalen-Kompromiss gegen dessen größte
 * Schwäche gegenüber OpenCV.
 *
 * js-aruco2 ist ein deutlich simplerer Detektor als OpenCV: ein einziger, fest
 * verdrahteter Adaptive-Threshold (feste interne Fenstergröße), keine Mehrskalen-Suche.
 * Bei einem Foto in voller Handy-Auflösung (z.B. 1920×1080) kann dieses feste Fenster für
 * einen großen/nahen Marker ungünstig sitzen, während ein kleinerer/entfernterer Marker
 * im selben Bild gut erkannt wird (oder umgekehrt) - in der Praxis äußert sich das genau
 * als "nur einer von zwei Markern wird gefunden".
 *
 * Abhilfe ohne die Bibliothek selbst patchen zu müssen: dieselbe Aufnahme zusätzlich in
 * zwei kleineren Auflösungen erneut versuchen und die gefundenen Marker-IDs
 * zusammenführen. Kein Ersatz für OpenCVs Robustheit, aber ein wirksamer, günstiger
 * Kompromiss.
 */

import { DICTIONARY_NAME } from './aruco-setup.js';

/** Auflösungsstufen (relativ zur Originalgröße), die der Reihe nach versucht werden. */
const DETECTION_SCALES = [1, 0.55, 0.35];

/**
 * Erkennt Marker in einem einzelnen Canvas bei einer bestimmten Skalierung.
 *
 * @param {HTMLCanvasElement} canvas Quellbild in Originalauflösung
 * @param {number} scale 1 = Originalgröße, <1 = verkleinert
 * @returns {Array} gefundene Marker (js-aruco2-Format: {id, corners, hammingDistance})
 */
function detectAtScale(canvas, scale) {
  let srcCanvas = canvas;
  if (scale !== 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * scale));
    c.height = Math.max(1, Math.round(canvas.height * scale));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    srcCanvas = c;
  }
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const detector = new AR.Detector({ dictionaryName: DICTIONARY_NAME });
  const found = detector.detect(imageData);

  // Ecken zurück auf die Auflösung der Originalaufnahme skalieren, damit die
  // Kamera-Matrix K (fx/fy/cx/cy, bezogen auf die Originalgröße) weiterhin passt.
  if (scale !== 1) {
    found.forEach((m) => m.corners.forEach((c) => { c.x /= scale; c.y /= scale; }));
  }
  return found;
}

/**
 * Erkennt Marker in einem Canvas, probiert bei Bedarf mehrere Auflösungsstufen durch und
 * führt die gefundenen IDs zusammen. Bricht früh ab, sobald mindestens 2 verschiedene
 * Marker gefunden wurden (das Minimum, das die App für eine Rohrverbindung braucht).
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Array} eindeutige gefundene Marker, aufsteigend nach ID sortiert
 */
export function runDetection(canvas) {
  const uniqueById = new Map();
  const scalesTried = [];

  for (const scale of DETECTION_SCALES) {
    let found;
    try {
      found = detectAtScale(canvas, scale);
    } catch (err) {
      console.warn('[Erkennung] Fehler bei Skalierung', scale, err);
      continue;
    }
    scalesTried.push(`${scale}: ${found.length} gefunden`);
    found.forEach((m) => { if (!uniqueById.has(m.id)) uniqueById.set(m.id, m); });
    if (uniqueById.size >= 2) break;
  }

  console.log('[Erkennung] Versuche:', scalesTried.join(' · '));
  return [...uniqueById.values()].sort((a, b) => a.id - b.id);
}

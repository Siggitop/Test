/**
 * opencv-ready.js
 * ----------------
 * opencv.js wird in index.html als klassisches <script> VOR dem Haupt-Modul geladen (wie
 * zuvor js-aruco2s cv.js/aruco.js) - das globale `cv`-Objekt existiert dadurch sofort,
 * seine WASM-Bindings (cv.Mat, cv.aruco_ArucoDetector, cv.solvePnP, ...) werden aber erst
 * asynchronisch angehängt, sobald die ~11MB WASM-Kompilierung im Hintergrund fertig ist
 * (typischerweise 1-3s). Dieses Modul kapselt das Warten darauf an einer zentralen Stelle,
 * statt dass jede Aufrufstelle selbst prüfen müsste, ob `cv` schon einsatzbereit ist.
 */

export const cvReady = new Promise((resolve) => {
  // Race-Bedingung beachten: opencv.js ist ein SINGLE_FILE-Build (WASM direkt eingebettet,
  // kein separater Netzwerk-Request) - die Initialisierung kann so schnell abgeschlossen
  // sein, dass onRuntimeInitialized bereits gefeuert hat, BEVOR dieses (als type="module"
  // erst nach den klassischen Scripts ausgeführte) Modul überhaupt läuft. cv.Mat dient als
  // zuverlässiger Indikator, ob das schon passiert ist.
  //
  // WICHTIG: bewusst ohne Argument auflösen (resolve(), nicht resolve(cv))! Das riesige,
  // WASM-gebundene cv-Objekt als Erfüllungswert einer Promise zu übergeben hat sich als
  // zuverlässiger Hänger erwiesen (die Promise-Maschinerie prüft dafür typeof cv.then,
  // was auf diesem Objekt offenbar pathologisch teuer/blockierend ist). cv bleibt ohnehin
  // ein globales Objekt - kein Grund, es zusätzlich als Wert durchzureichen.
  if (cv.Mat) { resolve(); return; }
  cv.onRuntimeInitialized = () => resolve();
});

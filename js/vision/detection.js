/**
 * detection.js
 * ------------
 * Markererkennung über opencv.js (ArUco/objdetect-Modul, seit OpenCV 4.7 Teil des
 * Kernmoduls - kein separates contrib-Modul nötig). Nutzt Sub-Pixel-Eckenverfeinerung
 * (CORNER_REFINE_APRILTAG - die genaueste verfügbare Variante; die App verarbeitet ein
 * Einzelfoto, nicht Echtzeit-Video, der Mehraufwand ist unkritisch), was hier direkt die
 * Eckengenauigkeit verbessert, die vorher (mit js-aruco2, ohne Sub-Pixel-Verfeinerung) die
 * Hauptursache für die beobachteten Reprojektionsfehler war.
 *
 * Verantwortlich NUR für die Erkennung selbst (Marker-IDs + deren 4 Bildecken) - die
 * Posenschätzung daraus passiert in pose-estimation.js.
 */

let detector = null;

/**
 * Baut den ArucoDetector beim ersten Aufruf (lazy, da `cv` zu diesem Zeitpunkt bereits
 * initialisiert sein muss - siehe opencv-ready.js/main.js, das den Aufrufer erst nach
 * Abschluss der WASM-Init startet).
 */
function getDetector() {
  if (!detector) {
    const dict = cv.getPredefinedDictionary(cv.DICT_6X6_250);
    const params = new cv.aruco_DetectorParameters();
    params.cornerRefinementMethod = cv.CORNER_REFINE_APRILTAG;
    const refineParams = new cv.aruco_RefineParameters(10, 3, true);
    detector = new cv.aruco_ArucoDetector(dict, params, refineParams);
  }
  return detector;
}

/**
 * Erkennt Marker in einem Canvas.
 *
 * @param {HTMLCanvasElement} canvas Quellbild
 * @returns {Array<{id:number, corners:Array<{x:number,y:number}>}>} gefundene Marker,
 *   aufsteigend nach ID sortiert. Ecken in TL/TR/BR/BL-Reihenfolge (OpenCV-Konvention,
 *   von pose-estimation.js direkt so erwartet).
 */
export function runDetection(canvas) {
  const src = cv.imread(canvas);
  const corners = new cv.MatVector();
  const ids = new cv.Mat();
  const rejected = new cv.MatVector();
  try {
    getDetector().detectMarkers(src, corners, ids, rejected);

    const found = [];
    for (let i = 0; i < ids.rows; i++) {
      const c = corners.get(i);
      const pts = [];
      for (let p = 0; p < 4; p++) pts.push({ x: c.data32F[p * 2], y: c.data32F[p * 2 + 1] });
      c.delete();
      found.push({ id: ids.data32S[i], corners: pts });
    }
    found.sort((a, b) => a.id - b.id);
    return found;
  } finally {
    // WASM-Heap-Speicher wird nicht vom JS-Garbage-Collector erfasst - jedes erzeugte
    // cv.Mat/MatVector muss explizit freigegeben werden.
    src.delete();
    corners.delete();
    ids.delete();
    rejected.delete();
  }
}

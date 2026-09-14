/**
 * pose-estimation.js
 * -------------------
 * Berechnet aus den 4 Bildecken eines erkannten ArUco-Markers dessen Position und
 * Rotationsmatrix im Kamerakoordinatensystem, über opencv.js: cv.solvePnP mit
 * SOLVEPNP_IPPE_SQUARE (die für planare quadratische Marker vorgesehene Methode - löst
 * die klassische Rotations-Mehrdeutigkeit auf, die eine einfache Homographie-Zerlegung
 * nicht erkennt) + cv.Rodrigues zur Umwandlung des Rotationsvektors in eine Matrix.
 *
 * Ersetzt die vorherige, selbstgebaute Homographie-Zerlegung (siehe Git-Historie für den
 * alten Code) - gleiche Schnittstelle (poseFromCorners liefert weiterhin
 * {position,xAxis,yAxis,zAxis}), sodass keine andere Datei angepasst werden musste.
 */

const OBJ_POINTS_CACHE = new Map(); // markerLength -> flaches [X,Y,Z]-Array (4 Punkte)

/** Objektpunkte der Markerebene (Z=0), TL/TR/BR/BL - identisch zur Ecken-Konvention aus
 *  detection.js/OpenCV. Pro markerLength einmal berechnet und wiederverwendet. */
function objectPoints(markerLength) {
  if (!OBJ_POINTS_CACHE.has(markerLength)) {
    const h = markerLength / 2;
    OBJ_POINTS_CACHE.set(markerLength, [-h, h, 0, h, h, 0, h, -h, 0, -h, -h, 0]);
  }
  return OBJ_POINTS_CACHE.get(markerLength);
}

function cameraMatrixMat(K) {
  return cv.matFromArray(3, 3, cv.CV_64F, [K.fx, 0, K.cx, 0, K.fy, K.cy, 0, 0, 1]);
}
function distCoeffsMat(dist) {
  const [k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0] = dist || [];
  return cv.matFromArray(5, 1, cv.CV_64F, [k1, k2, p1, p2, k3]);
}

/**
 * Schätzt Position + Rotationsmatrix eines Markers im Kamerakoordinatensystem aus seinen
 * 4 erkannten Bildecken.
 *
 * @param {Array<{x:number,y:number}>} corners 4 Bildecken, TL/TR/BR/BL (siehe detection.js)
 * @param {number} markerLength reale Kantenlänge des Markers in Metern
 * @param {{fx,fy,cx,cy}} K Kamera-Matrix
 * @param {number[]} [dist] Verzeichnungskoeffizienten [k1,k2,p1,p2,k3], optional
 * @returns {{position, xAxis, yAxis, zAxis}|null} je {x,y,z}, oder null wenn solvePnP
 *   keine Lösung findet (z.B. entartete/kollineare Ecken)
 */
export function poseFromCorners(corners, markerLength, K, dist) {
  const objPts = cv.matFromArray(4, 1, cv.CV_32FC3, objectPoints(markerLength));
  const imgPts = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((c) => [c.x, c.y]));
  const cameraMatrix = cameraMatrixMat(K);
  const distCoeffs = distCoeffsMat(dist);
  const rvec = new cv.Mat();
  const tvec = new cv.Mat();
  const R = new cv.Mat();
  try {
    const ok = cv.solvePnP(objPts, imgPts, cameraMatrix, distCoeffs, rvec, tvec, false, cv.SOLVEPNP_IPPE_SQUARE);
    if (!ok) return null;
    cv.Rodrigues(rvec, R);
    // R.data64F ist zeilenweise [R00,R01,R02, R10,R11,R12, R20,R21,R22] - xAxis/yAxis/zAxis
    // sind die SPALTEN von R (Marker-lokale Achsen, ins Kamerakoordinatensystem gedreht).
    const r = R.data64F, t = tvec.data64F;
    return {
      position: { x: t[0], y: t[1], z: t[2] },
      xAxis: { x: r[0], y: r[3], z: r[6] },
      yAxis: { x: r[1], y: r[4], z: r[7] },
      zAxis: { x: r[2], y: r[5], z: r[8] },
    };
  } finally {
    objPts.delete(); imgPts.delete(); cameraMatrix.delete(); distCoeffs.delete();
    rvec.delete(); tvec.delete(); R.delete();
  }
}

/**
 * RMS-Reprojektionsfehler (in Pixeln) der 4 Markerecken unter einer geschätzten Pose.
 * Nutzt cv.projectPoints (übernimmt die Verzeichnung automatisch in Vorwärtsrichtung),
 * verglichen direkt gegen die rohen (verzeichneten) erkannten Ecken - kein manuelles
 * Entzerren mehr nötig.
 *
 * Dient der Mehrbild-Fusion (multi-view-fusion.js) als Qualitäts-/Gewichtungssignal pro
 * Aufnahme - je kleiner der Fehler, desto mehr Gewicht bekommt dieses Foto beim Fusionieren.
 *
 * @param {{position,xAxis,yAxis,zAxis}} pose geschätzte Marker-Pose (Kamerakoordinaten)
 * @param {Array<{x:number,y:number}>} corners 4 erkannte Bildecken (roh, verzeichnet)
 * @param {number} markerLength reale Kantenlänge des Markers in Metern
 * @param {{fx,fy,cx,cy}} K Kamera-Matrix
 * @param {number[]} [dist] Verzeichnungskoeffizienten, optional
 * @returns {number} RMS-Fehler in Pixeln über alle 4 Ecken
 */
export function reprojectionErrorRMS(pose, corners, markerLength, K, dist) {
  const objPts = cv.matFromArray(4, 1, cv.CV_32FC3, objectPoints(markerLength));
  const cameraMatrix = cameraMatrixMat(K);
  const distCoeffs = distCoeffsMat(dist);
  const R = cv.matFromArray(3, 3, cv.CV_64F, [
    pose.xAxis.x, pose.yAxis.x, pose.zAxis.x,
    pose.xAxis.y, pose.yAxis.y, pose.zAxis.y,
    pose.xAxis.z, pose.yAxis.z, pose.zAxis.z,
  ]);
  const rvec = new cv.Mat();
  const tvec = cv.matFromArray(3, 1, cv.CV_64F, [pose.position.x, pose.position.y, pose.position.z]);
  const projected = new cv.Mat();
  try {
    cv.Rodrigues(R, rvec);
    cv.projectPoints(objPts, rvec, tvec, cameraMatrix, distCoeffs, projected);
    const p = projected.data32F;
    let sumSq = 0;
    for (let i = 0; i < 4; i++) {
      sumSq += (p[i * 2] - corners[i].x) ** 2 + (p[i * 2 + 1] - corners[i].y) ** 2;
    }
    return Math.sqrt(sumSq / 4);
  } finally {
    objPts.delete(); cameraMatrix.delete(); distCoeffs.delete(); R.delete();
    rvec.delete(); tvec.delete(); projected.delete();
  }
}

/**
 * pose-estimation.js
 * -------------------
 * Berechnet aus den 4 Bildecken eines erkannten ArUco-Markers dessen Position und
 * Rotationsmatrix im Kamerakoordinatensystem.
 *
 * Methode: Homographie aus den 4 Punktkorrespondenzen (Direct Linear Transform) und
 * Zerlegung über die Kamera-Matrix K - ein Standardverfahren für planare Pose,
 * vergleichbar mit cv2.solvePnP(..., IPPE_SQUARE) für nahezu frontale Ansichten. Bei
 * sehr schrägen Aufnahmewinkeln ist es etwas ungenauer als echtes IPPE, für diesen Zweck
 * (Handyfoto von zwei Rohrenden aus vernünftiger Distanz) ausreichend.
 *
 * Gegen eine synthetische Ground Truth getestet (siehe /tests): Positionsfehler im
 * Rahmen der Fließkommagenauigkeit (~1e-16) im unverzeichneten Fall, und mit absichtlich
 * verzeichneten Testecken sinkt der Fehler durch die Entzerrung von ~1.6mm auf denselben
 * Wert - die Entzerrung korrigiert also tatsächlich das, wofür sie gedacht ist.
 */

import { matVec3, norm3, scl3, cross3, normalize3, symmetricOrthogonalize, gaussSolve } from './linalg.js';

/**
 * Löst die Homographie H (3x3, h33=1 fixiert) aus genau 4 Punktkorrespondenzen
 * (Objektebene Z=0 → Bildpixel) per Direct Linear Transform.
 *
 * @param {number[][]} objPts 4× [X,Y] in der Markerebene (Meter, Z=0 implizit)
 * @param {number[][]} imgPts 4× [u,v] in Bildpixeln, gleiche Reihenfolge wie objPts
 * @returns {number[][]|null} 3x3-Homographie, oder null bei singulärem System
 */
export function solveHomography(objPts, imgPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = objPts[i], [u, v] = imgPts[i];
    A.push([X, Y, 1, 0, 0, 0, -X * u, -Y * u]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -X * v, -Y * v]); b.push(v);
  }
  const h = gaussSolve(A, b);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

/**
 * Entzerrt einen einzelnen Bildpunkt nach dem Standard-Brown-Conrady-Verzeichnungsmodell
 * (identisch zu OpenCVs internem Vorgehen in cv2.undistortPoints).
 *
 * Das Verzeichnungsmodell hat nur in Richtung "unverzeichnet → verzeichnet" eine
 * geschlossene Formel; die Umkehrung wird hier iterativ (Fixpunktiteration, 10 Schritte -
 * konvergiert für realistische Verzeichnungsstärken zuverlässig) gelöst.
 *
 * @param {number} u,v Bildpixel-Koordinaten (verzeichnet, wie von der Kamera geliefert)
 * @param {{fx,fy,cx,cy}} K Kamera-Matrix
 * @param {number[]} dist [k1,k2,p1,p2,k3] - bei allen Nullen (Standardfall ohne bekannte
 *   Verzeichnung) wird direkt (u,v) unverändert zurückgegeben, keine unnötige Rechnung.
 * @returns {{x:number,y:number}} entzerrte Pixel-Koordinaten
 */
export function undistortPoint(u, v, K, dist) {
  const [k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0] = dist || [];
  if (!k1 && !k2 && !p1 && !p2 && !k3) return { x: u, y: v };

  let x = (u - K.cx) / K.fx, y = (v - K.cy) / K.fy;
  const x0 = x, y0 = y;
  for (let i = 0; i < 10; i++) {
    const r2 = x * x + y * y;
    const icdist = 1 / (1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2);
    const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    x = (x0 - dx) * icdist;
    y = (y0 - dy) * icdist;
  }
  return { x: x * K.fx + K.cx, y: y * K.fy + K.cy };
}

/**
 * Schätzt Position + Rotationsmatrix eines Markers im Kamerakoordinatensystem aus seinen
 * 4 erkannten Bildecken.
 *
 * @param {Array<{x:number,y:number}>} corners 4 Bildecken, im Uhrzeigersinn beginnend
 *   oben-links (Konvention von OpenCV UND js-aruco2 - siehe detection.js)
 * @param {number} markerLength reale Kantenlänge des Markers in Metern
 * @param {{fx,fy,cx,cy}} K Kamera-Matrix
 * @param {number[]} [dist] Verzeichnungskoeffizienten [k1,k2,p1,p2,k3], optional
 * @returns {{position, xAxis, yAxis, zAxis}|null} je {x,y,z}, oder null bei singulärer
 *   Homographie (z.B. alle 4 Ecken (fast) kollinear erkannt - fehlerhafte Erkennung)
 */
export function poseFromCorners(corners, markerLength, K, dist) {
  const h = markerLength / 2;
  // Reihenfolge deckungsgleich mit dem ursprünglichen Python/OpenCV-Skript (dessen
  // solvePnP-Objektpunkte): TL=(-h,h) TR=(h,h) BR=(h,-h) BL=(-h,-h);
  // corners[0..3] = TL,TR,BR,BL.
  const objPts = [[-h, h], [h, h], [h, -h], [-h, -h]];
  const imgPts = corners.map((c) => {
    const u = undistortPoint(c.x, c.y, K, dist);
    return [u.x, u.y];
  });

  const H = solveHomography(objPts, imgPts);
  if (!H) return null;

  const KinvA = 1 / K.fx, KinvE = 1 / K.fy, KinvC = -K.cx / K.fx, KinvF = -K.cy / K.fy;
  const Kinv = [[KinvA, 0, KinvC], [0, KinvE, KinvF], [0, 0, 1]];
  const h1 = [H[0][0], H[1][0], H[2][0]];
  const h2 = [H[0][1], H[1][1], H[2][1]];
  const h3 = [H[0][2], H[1][2], H[2][2]];
  const kh1 = matVec3(Kinv, h1), kh2 = matVec3(Kinv, h2), kh3 = matVec3(Kinv, h3);

  let lambda = 2 / (norm3(kh1) + norm3(kh2));
  let r1 = scl3(kh1, lambda), r2 = scl3(kh2, lambda), t = scl3(kh3, lambda);
  // Vorzeichen-Mehrdeutigkeit der Homographie auflösen: der Marker muss vor der Kamera
  // liegen (positives Z in der OpenCV-Konvention, Z zeigt von der Kamera in die Szene).
  if (t[2] < 0) {
    lambda = -lambda;
    r1 = scl3(kh1, lambda); r2 = scl3(kh2, lambda); t = scl3(kh3, lambda);
  }

  [r1, r2] = symmetricOrthogonalize(normalize3(r1), normalize3(r2));
  const r3 = cross3(r1, r2);

  return {
    position: { x: t[0], y: t[1], z: t[2] },
    xAxis: { x: r1[0], y: r1[1], z: r1[2] },
    yAxis: { x: r2[0], y: r2[1], z: r2[2] },
    zAxis: { x: r3[0], y: r3[1], z: r3[2] },
  };
}

/**
 * multi-view-fusion.js
 * ---------------------
 * Fusioniert 1-3 Einzelbild-Markerposen (aus mehreren Fotos aus unterschiedlichen
 * Blickwinkeln) zu einer deutlich robusteren Marker-Geometrie.
 *
 * Hintergrund: Bei einer einzelnen Aufnahme ist die Tiefenachse (Kamera-Sichtstrahl) bei
 * der homographie-basierten Posenschätzung (pose-estimation.js) die ungenaueste Achse -
 * kleinste Fehler bei der Eckenerkennung schlagen sich dort überproportional nieder, auch
 * wenn die Marker physisch koplanar sind.
 *
 * Kernidee: Da beide Marker in jedem Foto sichtbar und physisch starr zueinander fixiert
 * sind, liefert jedes Foto unabhängig eine volle Schätzung der einen Größe, die tatsächlich
 * zählt - die Pose von Marker B relativ zu Marker A (T_i = T_Ai⁻¹ · T_Bi). Das kommt
 * komplett ohne Schätzung der (unbekannten) Kamerabewegung zwischen den Aufnahmen aus -
 * kein echtes Bundle-Adjustment/SfM nötig, sondern eine algebraische Vereinfachung, die die
 * Struktur des Problems (zwei starr verbundene Marker, bewegte Kamera) ausnutzt. Mehrere
 * unabhängige Schätzungen von T_i werden anschließend gewichtet gemittelt.
 *
 * Ausgabe-Frame: statt Marker A als künstlichen Identitäts-Ursprung zu definieren, wird
 * eines der Fotos (das "Anker-Foto", siehe computeWeights() für die Auswahl) als reales
 * Referenzkamera-Koordinatensystem verwendet - markerA bleibt dessen unveränderte
 * Einzelbild-Pose, markerB wird die fusionierte Relativpose, zurücktransformiert ins
 * Anker-Frame. Dadurch bleibt die Bedeutung von markerData ({coordinateSystem:{origin:
 * 'camera'}, ...}) exakt wie bei einer einzelnen Aufnahme, und bei nur einem Foto (N=1)
 * ist das Ergebnis nachweisbar identisch zum bisherigen Verhalten (siehe Tests).
 *
 * Bekannte Grenze: Marker A's absolute Position/Tiefe im Output bleibt die unverbesserte
 * Einzelbild-Schätzung des Anker-Fotos - verbessert wird die A→B-Relativgeometrie, und
 * genau die bestimmt die Rohrverlegungs-Genauigkeit. Gerade deshalb lohnt sich ein
 * möglichst gutes erstes Foto (siehe computeWeights()): bei dieser Homographie-basierten
 * Methode ist eine frontale, bildfüllende Aufnahme nachweislich genauer als eine schräge -
 * das Gegenteil der ersten Intuition, siehe Kommentar dort.
 */

import { add3, scl3, cross3, normalize3, matVec3, symmetricOrthogonalize } from './linalg.js';

function toVec(p) { return [p.x, p.y, p.z]; }
function fromVec(v) { return { x: v[0], y: v[1], z: v[2] }; }

/** Baut die 3x3-Rotationsmatrix (als Zeilen) aus den drei Achsen-Spalten einer Pose. */
function matFromPose(pose) {
  const r1 = toVec(pose.xAxis), r2 = toVec(pose.yAxis), r3 = toVec(pose.zAxis);
  return [
    [r1[0], r2[0], r3[0]],
    [r1[1], r2[1], r3[1]],
    [r1[2], r2[2], r3[2]],
  ];
}
/** Baut eine Pose aus einer 3x3-Rotationsmatrix (Zeilen) + Translationsvektor. */
function poseFromMatT(M, t) {
  return {
    position: fromVec(t),
    xAxis: fromVec([M[0][0], M[1][0], M[2][0]]),
    yAxis: fromVec([M[0][1], M[1][1], M[2][1]]),
    zAxis: fromVec([M[0][2], M[1][2], M[2][2]]),
  };
}
function transpose3(M) {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]],
  ];
}
function matMul3(A, B) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) R[i][j] += A[i][k] * B[k][j];
    }
  }
  return R;
}

/** Kehrt eine starre Transformation (Pose) um: T⁻¹. */
export function invertRigid(pose) {
  const R = matFromPose(pose);
  const Rt = transpose3(R);
  const tInv = scl3(matVec3(Rt, toVec(pose.position)), -1);
  return poseFromMatT(Rt, tInv);
}

/** Verkettet zwei starre Transformationen: outer ∘ inner (erst inner, dann outer). */
export function composeRigid(outer, inner) {
  const Ro = matFromPose(outer), Ri = matFromPose(inner);
  const Rc = matMul3(Ro, Ri);
  const tc = add3(matVec3(Ro, toVec(inner.position)), toVec(outer.position));
  return poseFromMatT(Rc, tc);
}

/**
 * Pose von Marker B, ausgedrückt im lokalen Frame von Marker A (= T_A⁻¹ · T_B). Diese
 * Größe ist für ein einzelnes Foto unabhängig von der (unbekannten) Kamerapose - deshalb
 * liefert jedes Foto direkt eine eigenständige Schätzung derselben physischen Größe.
 */
export function relativePose(poseA, poseB) {
  return composeRigid(invertRigid(poseA), poseB);
}

function weightedMeanVec(vectors, weights) {
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = [0, 0, 0];
  vectors.forEach((v, i) => { acc = add3(acc, scl3(v, weights[i] / wsum)); });
  return acc;
}

/** Gewichteter Mittelwert mehrerer Translationsvektoren ([x,y,z]-Arrays). */
export function fuseTranslations(translations, weights) {
  return weightedMeanVec(translations, weights);
}

/**
 * Gewichtete Mittelung mehrerer (näherungsweise orthonormaler) Rotationsdreibeine.
 * Mittelt die x/y-Achsen-Spalten separat und stellt per symmetricOrthogonalize (siehe
 * linalg.js) die Orthonormalität wieder her - dieselbe Methode, mit der pose-estimation.js
 * schon die Rotationsspalten einer einzelnen Homographie-Zerlegung säubert. Gültig als
 * Näherung, solange die Winkelabweichung zwischen den Einzelschätzungen klein bleibt
 * (hier der Fall: alle T_i schätzen dieselbe physisch fixe Relativpose).
 *
 * @param {Array<{x:number[],y:number[]}>} rotationTriples je Foto die x/y-Achse als [x,y,z]
 * @param {number[]} weights
 * @returns {{x:number[],y:number[],z:number[]}}
 */
export function fuseRotations(rotationTriples, weights) {
  const xAcc = weightedMeanVec(rotationTriples.map((r) => r.x), weights);
  const yAcc = weightedMeanVec(rotationTriples.map((r) => r.y), weights);
  const [x, y] = symmetricOrthogonalize(normalize3(xAcc), normalize3(yAcc));
  return { x, y, z: cross3(x, y) };
}

/** Gewichteter Mittelwert mehrerer Richtungsvektoren, renormiert auf Länge 1. */
export function fuseGravityVectors(vectors, weights) {
  return normalize3(weightedMeanVec(vectors, weights));
}

const ERR_FLOOR_PX = 0.25; // verhindert Division durch (fast) Null bei sehr niedrigem Fehler

/**
 * Gewichte aus Reprojektionsfehlern: kleiner Fehler = mehr Gewicht (1/Fehler²).
 *
 * Hinweis (Erkenntnis aus echten Testfotos + Nachrechnen, siehe Git-Historie): ein
 * naheliegender erster Gedanke war, zusätzlich den Blickwinkel zur Markerebene
 * einzubeziehen (in der Annahme, schräge Aufnahmen seien für die Tiefenschätzung besser
 * konditioniert als frontale). Eine Monte-Carlo-Überprüfung an dieser konkreten
 * Homographie-basierten Methode zeigt aber das Gegenteil: bei gleichem Eckenrauschen
 * steigt sowohl der Reprojektionsfehler als auch der tatsächliche Positionsfehler
 * monotton mit dem Blickwinkel - eine möglichst frontale, bildfüllende Aufnahme ist hier
 * tatsächlich am genauesten (die foreshortening-bedingte Stauchung der Markerkanten bei
 * schrägem Blick macht dieselbe Pixel-Ungenauigkeit relativ gesehen schlimmer). Reiner
 * Reprojektionsfehler ist also - anders als zunächst vermutet - bereits ein verlässliches
 * Qualitätsmaß für diese Methode und braucht keine zusätzliche Blickwinkel-Korrektur.
 */
export function computeWeights(reprojErrorsPx) {
  return reprojErrorsPx.map((e) => 1 / Math.max(e, ERR_FLOOR_PX) ** 2);
}

/**
 * Erkennt Ausreißer-Fotos anhand eines deutlich erhöhten Reprojektionsfehlers gegenüber
 * dem Median. Erst ab 3 Fotos sinnvoll auswertbar (bei 2 Fotos gibt es keinen robusten
 * Median). minAbsPx verhindert Fehlalarme, wenn alle Fehler ohnehin schon sehr klein sind.
 */
export function detectOutlierShots(reprojErrorsPx, factor = 3, minAbsPx = 1.0) {
  if (reprojErrorsPx.length < 3) return [];
  const sorted = [...reprojErrorsPx].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(factor * median, minAbsPx);
  return reprojErrorsPx.reduce((acc, e, i) => (e > threshold ? [...acc, i] : acc), []);
}

function rotationAngleBetween(Ra, Rb) {
  const Rd = matMul3(transpose3(Ra), Rb);
  const trace = Rd[0][0] + Rd[1][1] + Rd[2][2];
  const cosAngle = Math.min(1, Math.max(-1, (trace - 1) / 2));
  return Math.acos(cosAngle);
}

/**
 * Prüft paarweise, ob die pro Foto berechneten Relativposen (B relativ zu A) zu stark
 * voneinander abweichen. Das fängt ein Problem ab, das die reine Reprojektionsfehler-
 * Gewichtung NICHT erkennt: die homographie-basierte Posenschätzung löst nur die
 * Vorzeichen-Mehrdeutigkeit (Marker vor der Kamera), nicht die klassische Zweideutigkeit
 * planarer Posenschätzung bei flachem Blickwinkel - zwei sehr unterschiedliche Rotationen
 * können beide einen niedrigen Reprojektionsfehler haben. Genau dieses Risiko steigt, wenn
 * der Nutzer (wie hier gewünscht) den Blickwinkel zwischen den Fotos bewusst ändert.
 *
 * @param {Array<{position,xAxis,yAxis,zAxis}>} relativePoses je Foto T_i = T_Ai⁻¹·T_Bi
 * @param {number} angleThresholdDeg ab dieser Winkelabweichung gilt ein Paar als inkonsistent
 */
export function detectInconsistentShots(relativePoses, angleThresholdDeg = 12) {
  const n = relativePoses.length;
  const mats = relativePoses.map(matFromPose);
  let maxAngleDeg = 0;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const angleDeg = (rotationAngleBetween(mats[i], mats[j]) * 180) / Math.PI;
      maxAngleDeg = Math.max(maxAngleDeg, angleDeg);
      if (angleDeg > angleThresholdDeg) pairs.push([i, j, angleDeg]);
    }
  }
  return { pairs, maxAngleDeg };
}

/**
 * Fusioniert 1-3 Einzelbild-Beobachtungen zu einer robusten markerA/markerB/gravityDown-
 * Ausgabe (siehe Dateikopf für die Herleitung). Schließt nie auf 0 nutzbare Fotos - im
 * Zweifel wird nur gewarnt statt Daten wegzuwerfen.
 *
 * @param {Array<{
 *   poseA: {position,xAxis,yAxis,zAxis},
 *   poseB: {position,xAxis,yAxis,zAxis},
 *   reprojErrorPx: number,
 *   gravityDown?: {x,y,z}|null,
 *   K: object,
 * }>} shots 1 bis 3 Einträge, je ein ausgewertetes Foto
 * @returns {{
 *   markerA: {position,xAxis,yAxis,zAxis},
 *   markerB: {position,xAxis,yAxis,zAxis},
 *   gravityDown: {x,y,z}|null,
 *   K: object,
 *   anchorIndex: number,
 *   excludedIndices: number[],
 *   warnings: string[],
 * }}
 */
export function fuseMultiView(shots) {
  const n = shots.length;
  const reprojErrors = shots.map((s) => s.reprojErrorPx);
  const warnings = [];

  let excludedIndices = detectOutlierShots(reprojErrors);
  if (excludedIndices.length >= n) excludedIndices = []; // nie alle Fotos verwerfen
  if (excludedIndices.length > 0) {
    warnings.push(
      `Foto ${excludedIndices.map((i) => i + 1).join(', ')} als Ausreißer erkannt ` +
      '(deutlich höherer Reprojektionsfehler als die übrigen) und aus der Fusion ausgeschlossen.'
    );
  }

  const relPoses = shots.map((s) => relativePose(s.poseA, s.poseB));
  const { pairs } = detectInconsistentShots(relPoses);
  if (pairs.length > 0) {
    const desc = pairs.map(([i, j, deg]) => `${i + 1}↔${j + 1}: ${deg.toFixed(1)}°`).join(', ');
    warnings.push(
      `Aufnahmen weichen stark voneinander ab (${desc}) - evtl. Erkennungsfehler oder zu ` +
      'flacher Blickwinkel bei einem Foto. Ergebnis vorsichtshalber prüfen.'
    );
  }

  const usable = shots.map((_, i) => i).filter((i) => !excludedIndices.includes(i));
  const weights = computeWeights(usable.map((i) => reprojErrors[i]));

  // Anker-Foto = niedrigster Reprojektionsfehler - das bestimmt, welches Foto Marker A's
  // unverbesserte Absolutposition liefert, sollte also möglichst gut konditioniert sein.
  const anchorIndex = usable.reduce(
    (best, i) => (reprojErrors[i] < reprojErrors[best] ? i : best),
    usable[0]
  );
  const anchorPoseA = shots[anchorIndex].poseA;

  const tRelFused = fuseTranslations(usable.map((i) => toVec(relPoses[i].position)), weights);
  const rFused = fuseRotations(
    usable.map((i) => ({ x: toVec(relPoses[i].xAxis), y: toVec(relPoses[i].yAxis) })),
    weights
  );
  const relFusedPose = poseFromMatT(
    [[rFused.x[0], rFused.y[0], rFused.z[0]], [rFused.x[1], rFused.y[1], rFused.z[1]], [rFused.x[2], rFused.y[2], rFused.z[2]]],
    tRelFused
  );

  const markerA = { ...anchorPoseA, position: { ...anchorPoseA.position }, xAxis: { ...anchorPoseA.xAxis }, yAxis: { ...anchorPoseA.yAxis }, zAxis: { ...anchorPoseA.zAxis } };
  const markerB = composeRigid(anchorPoseA, relFusedPose);

  const gravIdx = usable.filter((i) => shots[i].gravityDown);
  let gravityDown = null;
  if (gravIdx.length > 0) {
    const RAk = matFromPose(anchorPoseA);
    const gInA = gravIdx.map((i) => matVec3(transpose3(matFromPose(shots[i].poseA)), toVec(shots[i].gravityDown)));
    const gWeights = gravIdx.map((i) => weights[usable.indexOf(i)]);
    const gAFused = fuseGravityVectors(gInA, gWeights);
    gravityDown = fromVec(matVec3(RAk, gAFused));
  }

  return {
    markerA,
    markerB,
    gravityDown,
    K: shots[anchorIndex].K,
    anchorIndex,
    excludedIndices,
    warnings,
  };
}

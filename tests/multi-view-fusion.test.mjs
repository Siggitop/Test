/**
 * multi-view-fusion.test.mjs
 * ----------------------------
 * Testet js/vision/multi-view-fusion.js gegen synthetische Ground Truth: eine feste
 * Marker-A→B-Relativpose wird aus mehreren simulierten Kamerapositionen (unterschiedliche
 * Blickwinkel) auf Bildecken projiziert, optional mit deterministischem Sub-Pixel-Rauschen
 * versehen, durch die echte poseFromCorners()-Schätzung gejagt und anschließend fusioniert.
 *
 * Ausführen: node tests/multi-view-fusion.test.mjs
 */
import { poseFromCorners, reprojectionErrorRMS } from '../js/vision/pose-estimation.js';
import {
  invertRigid, composeRigid, relativePose,
  fuseTranslations, fuseMultiView,
} from '../js/vision/multi-view-fusion.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const K = { fx: 1000, fy: 1000, cx: 640, cy: 360 };
const distZero = [0, 0, 0, 0, 0];
const markerLength = 0.07, h = markerLength / 2;
const objPts = [[-h, h], [h, h], [h, -h], [-h, -h]];

// --- eigenständige (von multi-view-fusion.js unabhängige) Hilfsfunktionen für die
//     synthetische Ground Truth - dieselbe Rolle wie rotMatrix/toCam in
//     pose-estimation.test.mjs. ---
function rotMatrix(rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i][j] += Ry[i][k] * Rx[k][j];
  return R;
}
function matMul(A, B) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i][j] += A[i][k] * B[k][j];
  return R;
}
function matVecG(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}
function addV(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

function toPoseObj(R, t) {
  return {
    position: { x: t[0], y: t[1], z: t[2] },
    xAxis: { x: R[0][0], y: R[1][0], z: R[2][0] },
    yAxis: { x: R[0][1], y: R[1][1], z: R[2][1] },
    zAxis: { x: R[0][2], y: R[1][2], z: R[2][2] },
  };
}

// Deterministischer, reproduzierbarer "Rausch"-Generator (kein Math.random()) - Wert in [-1,1).
function seededNoise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}

/** Projiziert die 4 Markerecken (Objektebene) durch (R,t,K) auf Bildpixel, optional mit
 *  deterministischem Sub-Pixel-Rauschen (simuliert Eckenerkennungs-Ungenauigkeit). */
function projectCorners(R, t, noiseAmpPx, noiseSeedBase) {
  return objPts.map(([X, Y], j) => {
    const p = addV(matVecG(R, [X, Y, 0]), t);
    let u = (K.fx * p[0]) / p[2] + K.cx;
    let v = (K.fy * p[1]) / p[2] + K.cy;
    if (noiseAmpPx) {
      u += noiseAmpPx * seededNoise(noiseSeedBase + j * 2);
      v += noiseAmpPx * seededNoise(noiseSeedBase + j * 2 + 1);
    }
    return { x: u, y: v };
  });
}

function relPosError(poseA, poseB, tGt) {
  const rel = relativePose(poseA, poseB);
  return Math.hypot(rel.position.x - tGt[0], rel.position.y - tGt[1], rel.position.z - tGt[2]);
}

// --- Feste Ground-Truth-Relativpose B relativ zu A, und drei simulierte Kamerastandorte
//     (unterschiedliche Position/Blickwinkel um denselben, physisch starren Markerpaar) ---
const R_AB_gt = rotMatrix(0.3, -0.2);
const t_AB_gt = [0.5, 0.02, -0.03];
const camShotsGT = [
  { R: rotMatrix(0.05, 0.35), t: [0.03, -0.02, 0.55] },
  { R: rotMatrix(-0.35, -0.1), t: [-0.05, 0.05, 0.60] },
  { R: rotMatrix(0.4, -0.5), t: [0.08, 0.03, 0.50] },
];

function makeShot(i, noiseAmpPx) {
  const { R: RA, t: tA } = camShotsGT[i];
  const RB = matMul(RA, R_AB_gt);
  const tB = addV(matVecG(RA, t_AB_gt), tA);
  const cornersA = projectCorners(RA, tA, noiseAmpPx, i * 1000 + 1);
  const cornersB = projectCorners(RB, tB, noiseAmpPx, i * 1000 + 500);
  const poseA = poseFromCorners(cornersA, markerLength, K, distZero);
  const poseB = poseFromCorners(cornersB, markerLength, K, distZero);
  const eA = reprojectionErrorRMS(poseA, cornersA, markerLength, K, distZero);
  const eB = reprojectionErrorRMS(poseB, cornersB, markerLength, K, distZero);
  return { poseA, poseB, reprojErrorPx: Math.sqrt((eA * eA + eB * eB) / 2), K };
}

// --- Test 1: composeRigid/invertRigid sind zueinander invers -----------------
{
  const T = toPoseObj(rotMatrix(0.4, -0.6), [0.3, -0.1, 1.2]);
  const roundTrip = composeRigid(T, invertRigid(T));
  const posErr = Math.hypot(roundTrip.position.x, roundTrip.position.y, roundTrip.position.z);
  const rotErr = Math.hypot(roundTrip.xAxis.x - 1, roundTrip.xAxis.y, roundTrip.xAxis.z);
  check('composeRigid(T, invertRigid(T)) ≈ Identität (Position)', posErr < 1e-9, `Fehler=${posErr.toExponential(2)}`);
  check('composeRigid(T, invertRigid(T)) ≈ Identität (Rotation)', rotErr < 1e-9, `Fehler=${rotErr.toExponential(2)}`);
}

// --- Test 2: ein einzelnes Foto (N=1) reproduziert exakt das heutige Verhalten ---
{
  const shot = makeShot(0, 0); // kein Rauschen -> exakter Vergleich möglich
  const fused = fuseMultiView([shot]);
  const posErrA = Math.hypot(
    fused.markerA.position.x - shot.poseA.position.x,
    fused.markerA.position.y - shot.poseA.position.y,
    fused.markerA.position.z - shot.poseA.position.z
  );
  const posErrB = Math.hypot(
    fused.markerB.position.x - shot.poseB.position.x,
    fused.markerB.position.y - shot.poseB.position.y,
    fused.markerB.position.z - shot.poseB.position.z
  );
  check('N=1: markerA unverändert', posErrA < 1e-9, `Fehler=${posErrA.toExponential(2)}m`);
  check('N=1: markerB unverändert', posErrB < 1e-9, `Fehler=${posErrB.toExponential(2)}m`);
}

// --- Test 3: Fusion aus mehreren verrauschten Fotos schlägt den schlechtesten Einzel-Shot ---
{
  const noiseAmp = 0.7; // px
  const shots = [0, 1, 2].map((i) => makeShot(i, noiseAmp));
  const fused = fuseMultiView(shots);

  const singleErrors = shots.map((s) => relPosError(s.poseA, s.poseB, t_AB_gt));
  const worstSingle = Math.max(...singleErrors);
  const fusedErr = relPosError(fused.markerA, fused.markerB, t_AB_gt);

  check(
    'Fusion aus 3 verrauschten Fotos ist deutlich genauer als der schlechteste Einzel-Shot',
    fusedErr < 0.7 * worstSingle,
    `fusioniert=${(fusedErr * 1000).toFixed(2)}mm, schlechtester Einzelwert=${(worstSingle * 1000).toFixed(2)}mm`
  );
}

// --- Test 4: ein Foto mit stark verschobener Ecke wird als Ausreißer erkannt und
//     die Fusion bleibt trotzdem nah an der Ground Truth (viel besser als naive Mittelung) ---
{
  const good = [makeShot(0, 0.3), makeShot(1, 0.3)];

  const { R: RA, t: tA } = camShotsGT[2];
  const RB = matMul(RA, R_AB_gt);
  const tB = addV(matVecG(RA, t_AB_gt), tA);
  const cornersA = projectCorners(RA, tA, 0.3, 2000);
  const cornersB = projectCorners(RB, tB, 0.3, 2500);
  cornersB[1].x += 18; cornersB[1].y -= 14; // eine Ecke grob fehlerkannt simulieren
  const poseA3 = poseFromCorners(cornersA, markerLength, K, distZero);
  const poseB3 = poseFromCorners(cornersB, markerLength, K, distZero);
  const eA3 = reprojectionErrorRMS(poseA3, cornersA, markerLength, K, distZero);
  const eB3 = reprojectionErrorRMS(poseB3, cornersB, markerLength, K, distZero);
  const badShot = { poseA: poseA3, poseB: poseB3, reprojErrorPx: Math.sqrt((eA3 * eA3 + eB3 * eB3) / 2), K };

  const shots = [...good, badShot];
  const fused = fuseMultiView(shots);
  const fusedErr = relPosError(fused.markerA, fused.markerB, t_AB_gt);

  const relPoses = shots.map((s) => relativePose(s.poseA, s.poseB));
  const unweighted = fuseTranslations(relPoses.map((r) => [r.position.x, r.position.y, r.position.z]), [1, 1, 1]);
  const unweightedErr = Math.hypot(unweighted[0] - t_AB_gt[0], unweighted[1] - t_AB_gt[1], unweighted[2] - t_AB_gt[2]);

  check('Ausreißer-Foto (Index 2) wird erkannt und ausgeschlossen', fused.excludedIndices.includes(2), `excludedIndices=${JSON.stringify(fused.excludedIndices)}, reprojErr=${shots.map((s) => s.reprojErrorPx.toFixed(2))}`);
  check(
    'Gewichtete/ausreißerbereinigte Fusion ist deutlich genauer als naive ungewichtete Mittelung aller 3 Fotos',
    fusedErr < 0.5 * unweightedErr,
    `fusioniert=${(fusedErr * 1000).toFixed(2)}mm, ungewichteter Mittelwert=${(unweightedErr * 1000).toFixed(2)}mm`
  );
}

// --- Test 5: stark voneinander abweichende Relativposen erzeugen eine Warnung ---
{
  const poseA1 = toPoseObj(rotMatrix(0.1, 0.1), [0, 0, 0.6]);
  const poseB1 = composeRigid(poseA1, toPoseObj(R_AB_gt, t_AB_gt));
  const poseA2 = toPoseObj(rotMatrix(-0.2, 0.3), [0.05, -0.02, 0.58]);
  const R_AB_bad = matMul(rotMatrix(0.5, 0), R_AB_gt); // ~29° zusätzliche Rotation ggü. der Ground Truth
  const poseB2 = composeRigid(poseA2, toPoseObj(R_AB_bad, t_AB_gt));

  const shots = [
    { poseA: poseA1, poseB: poseB1, reprojErrorPx: 0.3, K },
    { poseA: poseA2, poseB: poseB2, reprojErrorPx: 0.3, K },
  ];
  const fused = fuseMultiView(shots);
  check(
    'Stark abweichende Relativposen zwischen zwei Fotos erzeugen eine Warnung',
    fused.warnings.some((w) => w.includes('weichen stark')),
    fused.warnings.join(' | ') || '(keine Warnung)'
  );
}

// --- Test 6: Schwerkraft-Fusion (rein algebraisch, kein Rauschen) --------------
{
  const gWorldDown = [0, -1, 0]; // gemeinsame "unten"-Richtung, ausgedrückt in jedem Kamera-Frame
  const shots = [0, 1, 2].map((i) => {
    const { R: RA, t: tA } = camShotsGT[i];
    const RB = matMul(RA, R_AB_gt);
    const tB = addV(matVecG(RA, t_AB_gt), tA);
    const g = matVecG(RA, gWorldDown);
    return {
      poseA: toPoseObj(RA, tA),
      poseB: toPoseObj(RB, tB),
      reprojErrorPx: 0.3, // konstant -> keine Gewichtungs-Verzerrung in diesem Test
      gravityDown: { x: g[0], y: g[1], z: g[2] },
      K,
    };
  });
  const fused = fuseMultiView(shots);
  const anchorRA = camShotsGT[fused.anchorIndex].R;
  const expected = matVecG(anchorRA, gWorldDown);
  const err = Math.hypot(
    fused.gravityDown.x - expected[0], fused.gravityDown.y - expected[1], fused.gravityDown.z - expected[2]
  );
  check('Schwerkraft-Fusion liefert die korrekt ins Anker-Frame transformierte Richtung', err < 1e-9, `Fehler=${err.toExponential(2)}`);
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

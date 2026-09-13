/**
 * pose-estimation.test.mjs
 * ---------------------------
 * Testet js/vision/pose-estimation.js gegen eine synthetische Ground Truth: eine
 * bekannte Marker-Pose wird mit einem bekannten Lochkamera-Modell (inkl. optionaler
 * Verzeichnung) auf 4 Bildpunkte projiziert - poseFromCorners() muss daraus wieder exakt
 * die ursprüngliche Pose zurückgewinnen.
 *
 * Ausführen: node tests/pose-estimation.test.mjs
 */
import { poseFromCorners } from '../js/vision/pose-estimation.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const K = { fx: 1000, fy: 1000, cx: 640, cy: 360 };
const markerLength = 0.07, h = markerLength / 2;
const objPts3D = [[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]];

function rotMatrix(rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i][j] += Ry[i][k] * Rx[k][j];
  return R;
}
const Rgt = rotMatrix(0.15, 0.25);
const tgt = [0.05, -0.02, 0.6];

function toCam(p) {
  return [
    Rgt[0][0] * p[0] + Rgt[0][1] * p[1] + Rgt[0][2] * p[2] + tgt[0],
    Rgt[1][0] * p[0] + Rgt[1][1] * p[1] + Rgt[1][2] * p[2] + tgt[1],
    Rgt[2][0] * p[0] + Rgt[2][1] * p[1] + Rgt[2][2] * p[2] + tgt[2],
  ];
}
function posErr(pose) {
  return Math.hypot(pose.position.x - tgt[0], pose.position.y - tgt[1], pose.position.z - tgt[2]);
}

// --- Test 1: ohne Verzeichnung -----------------------------------------------
{
  const corners = objPts3D.map((p) => {
    const cam = toCam(p);
    return { x: K.fx * cam[0] / cam[2] + K.cx, y: K.fy * cam[1] / cam[2] + K.cy };
  });
  const pose = poseFromCorners(corners, markerLength, K, [0, 0, 0, 0, 0]);
  const err = posErr(pose);
  check('Pose ohne Verzeichnung: Positionsfehler < 1e-6m', err < 1e-6, `Fehler=${err.toExponential(2)}m`);

  const rotErr = Math.hypot(
    pose.xAxis.x - Rgt[0][0], pose.xAxis.y - Rgt[1][0], pose.xAxis.z - Rgt[2][0]
  );
  check('Pose ohne Verzeichnung: xAxis stimmt mit Ground Truth überein', rotErr < 1e-6, `Fehler=${rotErr.toExponential(2)}`);
}

// --- Test 2: mit Verzeichnung - undistortPoint() muss sie korrekt entfernen --
{
  const dist = [0.08, -0.02, 0.001, -0.0005, 0.0];
  function distortNormalized(x, y) {
    const [k1, k2, p1, p2, k3] = dist, r2 = x * x + y * y;
    const rad = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    return { x: x * rad + dx, y: y * rad + dy };
  }
  const cornersDist = objPts3D.map((p) => {
    const cam = toCam(p);
    const xn = cam[0] / cam[2], yn = cam[1] / cam[2];
    const d = distortNormalized(xn, yn);
    return { x: K.fx * d.x + K.cx, y: K.fy * d.y + K.cy };
  });

  const poseWrong = poseFromCorners(cornersDist, markerLength, K, [0, 0, 0, 0, 0]);
  const poseRight = poseFromCorners(cornersDist, markerLength, K, dist);
  const errWrong = posErr(poseWrong);
  const errRight = posErr(poseRight);

  check('Verzeichnete Ecken OHNE Korrektur ergeben einen spürbaren Fehler', errWrong > 0.001, `Fehler=${(errWrong * 1000).toFixed(2)}mm`);
  check('Verzeichnete Ecken MIT Korrektur: Fehler auf <1e-5m reduziert', errRight < 1e-5, `Fehler=${errRight.toExponential(2)}m`);
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

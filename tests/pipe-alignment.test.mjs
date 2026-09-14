/**
 * pipe-alignment.test.mjs
 * --------------------------
 * Testet js/scene/pipe-alignment.js gegen die vom Nutzer beschriebenen Szenarien:
 *   1. Beide Rohre annähernd waagerecht und annähernd parallel -> exakt parallel, beide
 *      nur minimal (und fair, je zur Hälfte) gedreht.
 *   2. Ein Rohr annähernd senkrecht, eines annähernd waagerecht -> exakt 90° zueinander,
 *      allein durch die Neigungs-Korrektur (Schritt 1), ohne Azimut-Eingriff.
 *   3. Beide waagerecht, annähernd 90° zueinander (L-Bogen) -> exakt 90°, fair verteilt.
 *   4. Bereits exakt ausgerichtete Eingabe -> keine Korrektur (null).
 *   5. Keine Schwerkraftreferenz -> keine Korrektur (null).
 *   6. Nach der Korrektur bleibt das lokale Koordinatensystem jedes Markers orthonormal
 *      (yAxis/zAxis werden konsistent mitgedreht, nicht nur xAxis).
 *
 * Ausführen: node tests/pipe-alignment.test.mjs
 */
import * as THREE from 'three';
import { computeAlignmentCorrection } from '../js/scene/pipe-alignment.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = UP.clone().negate(); // tableNormal-Konvention: zeigt nach unten

function markerFromEuler(xDeg, yDeg, zDeg, axis = new THREE.Vector3(1, 0, 0)) {
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(xDeg), THREE.MathUtils.degToRad(yDeg), THREE.MathUtils.degToRad(zDeg), 'XYZ'
  );
  const q = new THREE.Quaternion().setFromEuler(e);
  return {
    xAxis: axis.clone().applyQuaternion(q).normalize(),
    yAxis: new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize(),
    zAxis: new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize(),
  };
}

function angleDeg(a, b) {
  return THREE.MathUtils.radToDeg(a.angleTo(b));
}

// 1. Beide annähernd waagerecht (leicht geneigt) und annähernd parallel (kleiner Azimut-
//    Unterschied durch Rauschen) -> exakt parallel, fair verteilt.
{
  const A = markerFromEuler(0, 0, -1.2); // ~1.2° Nick-Rauschen
  const B = markerFromEuler(0, 3.4, 0.7); // ~3.4° Azimut- + 0.7° Nick-Rauschen
  const res = computeAlignmentCorrection(A, B, DOWN);
  check('Fall 1: Korrektur gefunden', !!res);
  if (res) {
    const finalAngle = angleDeg(res.markerA.xAxis, res.markerB.xAxis);
    check('Fall 1: Rohre nach Korrektur exakt parallel', finalAngle < 1e-6, `Winkel=${finalAngle.toFixed(4)}°`);
    check('Fall 1: beide Rohre exakt waagerecht (90° zur Vertikalen)',
      Math.abs(90 - angleDeg(res.markerA.xAxis, UP)) < 1e-6 && Math.abs(90 - angleDeg(res.markerB.xAxis, UP)) < 1e-6);
    check('Fall 1: nur minimale Einzel-Drehungen (<5°)', res.angleChangeADeg < 5 && res.angleChangeBDeg < 5,
      `A=${res.angleChangeADeg.toFixed(2)}° B=${res.angleChangeBDeg.toFixed(2)}°`);
    check('Fall 1: Korrektur fair verteilt (ähnlich groß für A und B)',
      Math.abs(res.angleChangeADeg - res.angleChangeBDeg) < 1.5,
      `A=${res.angleChangeADeg.toFixed(2)}° B=${res.angleChangeBDeg.toFixed(2)}°`);
  }
}

// 2. Ein Rohr fast senkrecht, eines fast waagerecht -> exakt 90° zueinander, rein aus
//    Schritt 1 (Neigungs-Korrektur), ohne dass die Kompassrichtung von A angefasst wird.
{
  const vertical = { xAxis: new THREE.Vector3(0.02, 0.999, -0.01).normalize(), yAxis: new THREE.Vector3(1, 0, 0), zAxis: new THREE.Vector3(0, 0, 1) };
  const horizontal = { xAxis: new THREE.Vector3(1, 0.03, 0).normalize(), yAxis: new THREE.Vector3(0, 1, 0), zAxis: new THREE.Vector3(0, 0, 1) };
  const origHorizAz = horizontal.xAxis.clone().setY(0).normalize();
  const res = computeAlignmentCorrection(vertical, horizontal, DOWN);
  check('Fall 2: Korrektur gefunden', !!res);
  if (res) {
    const finalAngle = angleDeg(res.markerA.xAxis, res.markerB.xAxis);
    check('Fall 2: exakt 90° zueinander', Math.abs(finalAngle - 90) < 1e-6, `Winkel=${finalAngle.toFixed(4)}°`);
    check('Fall 2: A exakt senkrecht (0°/180° zur Vertikalen)',
      angleDeg(res.markerA.xAxis, UP) < 1e-6 || Math.abs(180 - angleDeg(res.markerA.xAxis, UP)) < 1e-6);
    check('Fall 2: B exakt waagerecht', Math.abs(90 - angleDeg(res.markerB.xAxis, UP)) < 1e-6);
    const newHorizAz = res.markerB.xAxis.clone().setY(0).normalize();
    check('Fall 2: Kompassrichtung von B unverändert (kein Azimut-Eingriff nötig)',
      angleDeg(origHorizAz, newHorizAz) < 1e-6);
  }
}

// 3. Beide waagerecht, ~90° zueinander (L-Bogen) -> exakt 90°, fair verteilt.
{
  const A = { xAxis: new THREE.Vector3(1, 0, 0), yAxis: new THREE.Vector3(0, 1, 0), zAxis: new THREE.Vector3(0, 0, -1) };
  const B = markerFromEuler(0, 92, 0); // ~92° statt exakt 90° um Y gedreht
  const res = computeAlignmentCorrection(A, B, DOWN);
  check('Fall 3: Korrektur gefunden', !!res);
  if (res) {
    const finalAngle = angleDeg(res.markerA.xAxis, res.markerB.xAxis);
    check('Fall 3: exakt 90° zueinander', Math.abs(finalAngle - 90) < 1e-6, `Winkel=${finalAngle.toFixed(4)}°`);
    check('Fall 3: fair verteilt (beide ähnlich klein gedreht)',
      Math.abs(res.angleChangeADeg - res.angleChangeBDeg) < 1.5,
      `A=${res.angleChangeADeg.toFixed(2)}° B=${res.angleChangeBDeg.toFixed(2)}°`);
  }
}

// 4. Bereits exakt ausgerichtet -> keine Korrektur.
{
  const A = { xAxis: new THREE.Vector3(1, 0, 0), yAxis: new THREE.Vector3(0, 1, 0), zAxis: new THREE.Vector3(0, 0, -1) };
  const B = { xAxis: new THREE.Vector3(1, 0, 0), yAxis: new THREE.Vector3(0, 1, 0), zAxis: new THREE.Vector3(0, 0, -1) };
  const res = computeAlignmentCorrection(A, B, DOWN);
  check('Fall 4: bereits perfekt ausgerichtet -> keine Korrektur (null)', res === null);
}

// 5. Keine Schwerkraftreferenz -> keine Korrektur.
{
  const A = { xAxis: new THREE.Vector3(1, 0.1, 0), yAxis: new THREE.Vector3(0, 1, 0), zAxis: new THREE.Vector3(0, 0, 1) };
  const B = { xAxis: new THREE.Vector3(1, -0.1, 0.2), yAxis: new THREE.Vector3(0, 1, 0), zAxis: new THREE.Vector3(0, 0, 1) };
  const res = computeAlignmentCorrection(A, B, null);
  check('Fall 5: ohne Schwerkraftreferenz -> keine Korrektur (null)', res === null);
}

// 6. Orthonormalität bleibt erhalten (yAxis/zAxis werden mitgedreht, nicht nur xAxis).
{
  const A = markerFromEuler(0, 2, 2.9);
  const B = markerFromEuler(0, -1.5, 4.6);
  const res = computeAlignmentCorrection(A, B, DOWN);
  check('Fall 6: Korrektur gefunden', !!res);
  if (res) {
    const dotXY_A = res.markerA.xAxis.dot(res.markerA.yAxis);
    const dotXY_B = res.markerB.xAxis.dot(res.markerB.yAxis);
    check('Fall 6: Marker A bleibt orthonormal (xAxis·yAxis ≈ 0)', Math.abs(dotXY_A) < 1e-9, `dot=${dotXY_A.toExponential(2)}`);
    check('Fall 6: Marker B bleibt orthonormal (xAxis·yAxis ≈ 0)', Math.abs(dotXY_B) < 1e-9, `dot=${dotXY_B.toExponential(2)}`);
    const crossErrA = new THREE.Vector3().crossVectors(res.markerA.xAxis, res.markerA.yAxis).distanceTo(res.markerA.zAxis);
    check('Fall 6: Marker A bleibt rechtshändig (x × y ≈ z)', crossErrA < 1e-9, `Fehler=${crossErrA.toExponential(2)}`);
  }
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

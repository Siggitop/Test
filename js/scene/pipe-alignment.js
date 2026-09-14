/**
 * pipe-alignment.js
 * -------------------
 * Rohrleitungen werden in der Praxis immer in Waage, senkrecht oder im 45°-Winkel verlegt
 * - sowohl für sich genommen (relativ zur Schwerkraft) als auch zueinander. Die per ArUco-
 * Marker gemessenen Rohrachsen (xAxis) weichen davon durch Erkennungs-/Sensorrauschen
 * immer leicht ab. Dieses Modul findet die nächstliegende "saubere" Ausrichtung und
 * verteilt die dafür nötige Korrektur fair auf beide Marker - jeweils die minimal nötige
 * Drehung um den eigenen Mittelpunkt (Position bleibt unangetastet).
 *
 * Vorgehen (zwei geometrisch unabhängige Korrekturschritte):
 *
 *  1. Neigung zur Schwerkraft (Winkel zur Vertikalen) wird für JEDEN Marker EINZELN auf
 *     das nächste Vielfache von 45° gerundet - das ist die einzige Korrektur, die für ein
 *     einzelnes Rohr allein aus der (absoluten) Schwerkraftrichtung folgt, unabhängig vom
 *     jeweils anderen Marker. Landet ein Rohr dadurch exakt auf "senkrecht" (0°/180°), ist
 *     der Winkel zum anderen (ebenfalls gerundeten) Rohr automatisch exakt korrekt - z.B.
 *     exakt 90° zu einem waagerechten Rohr - ganz ohne weiteren Schritt, weil der Winkel
 *     zwischen "exakt senkrecht" und irgendeiner Richtung nur von deren eigener Neigung
 *     abhängt, nicht von deren Kompassrichtung.
 *
 *  2. Nur falls nach Schritt 1 BEIDE Rohre nicht-senkrecht sind (nur dann ist eine
 *     Kompassrichtung/Azimut überhaupt aussagekräftig - ein senkrechtes Rohr hat keine):
 *     der Azimut-Unterschied (Kompasswinkel zueinander in der Horizontalen) wird auf das
 *     nächste Vielfache von 45° gerundet und die dafür nötige Korrektur hälftig auf beide
 *     Marker verteilt (gleich große Gegenkorrektur je Marker) - das minimiert die Summe
 *     der beiden nötigen Einzel-Drehungen und behandelt beide Rohre fair.
 */

import * as THREE from 'three';

const SNAP_STEP_DEG = 45;
const MIN_CHANGE_DEG = 0.05; // darunter: keine sichtbare/sinnvolle Korrektur, nicht "nachzittern"

function snapToStep(deg, step = SNAP_STEP_DEG) {
  return Math.round(deg / step) * step;
}

function isVertical(tiltDeg) {
  return tiltDeg < 1e-6 || Math.abs(tiltDeg - 180) < 1e-6;
}

/** Horizontale Komponente eines (normierten) Richtungsvektors relativ zu `up`, oder null
 *  falls der Vektor (näherungsweise) senkrecht ist - dann ist "horizontal" nicht definiert. */
function horizontalComponent(dir, up) {
  const h = dir.clone().sub(up.clone().multiplyScalar(dir.dot(up)));
  return h.lengthSq() > 1e-8 ? h.normalize() : null;
}

/** Baut die minimale Rotation, die oldXAxis auf newXAxis dreht, und wendet sie auf alle
 *  drei Achsen des Markers an - so bleibt das lokale Koordinatensystem orthonormal und
 *  ohne zusätzlichen "Twist" konsistent. */
function applyMinimalRotation(oldXAxis, newXAxis, marker) {
  const q = new THREE.Quaternion().setFromUnitVectors(oldXAxis, newXAxis);
  return {
    xAxis: newXAxis.clone(),
    yAxis: marker.yAxis ? marker.yAxis.clone().applyQuaternion(q) : undefined,
    zAxis: marker.zAxis ? marker.zAxis.clone().applyQuaternion(q) : undefined,
  };
}

/**
 * Berechnet die Ausrichtungs-Korrektur für ein Marker-Paar.
 *
 * @param {{xAxis:THREE.Vector3,yAxis?:THREE.Vector3,zAxis?:THREE.Vector3}} markerA
 * @param {{xAxis:THREE.Vector3,yAxis?:THREE.Vector3,zAxis?:THREE.Vector3}} markerB
 * @param {THREE.Vector3} tableNormal Schwerkraft-"unten", normiert (siehe horizontal-plane.js)
 * @returns {null|{
 *   markerA: {xAxis:THREE.Vector3,yAxis?:THREE.Vector3,zAxis?:THREE.Vector3},
 *   markerB: {xAxis:THREE.Vector3,yAxis?:THREE.Vector3,zAxis?:THREE.Vector3},
 *   angleChangeADeg:number, angleChangeBDeg:number,
 * }} null, wenn keine Schwerkraftreferenz vorliegt oder beide Rohre bereits (quasi) exakt
 *   ausgerichtet sind - dann ist keine Korrektur nötig.
 */
export function computeAlignmentCorrection(markerA, markerB, tableNormal) {
  if (!tableNormal) return null;
  const up = tableNormal.clone().negate().normalize();
  const dirA = markerA.xAxis.clone().normalize();
  const dirB = markerB.xAxis.clone().normalize();

  const tiltDeg = (dir) => THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(dir.dot(up), -1, 1)));
  const tiltATargetDeg = snapToStep(tiltDeg(dirA));
  const tiltBTargetDeg = snapToStep(tiltDeg(dirB));

  const azA = horizontalComponent(dirA, up);
  const azB = horizontalComponent(dirB, up);

  // Gemeinsame horizontale Referenzbasis (beliebig gewählt, aber für A und B identisch -
  // nur die Winkel-DIFFERENZ zwischen den beiden Kompassrichtungen zählt, nicht deren
  // absolute Ausrichtung).
  let eastRef = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1));
  if (eastRef.lengthSq() < 1e-6) eastRef = new THREE.Vector3().crossVectors(up, new THREE.Vector3(1, 0, 0));
  eastRef.normalize();
  const northRef = new THREE.Vector3().crossVectors(eastRef, up).normalize();
  const headingDeg = (h) => THREE.MathUtils.radToDeg(Math.atan2(h.dot(northRef), h.dot(eastRef)));
  const dirFromTiltAndHeading = (tiltTargetDeg, headingTargetDeg, fallbackAz) => {
    if (isVertical(tiltTargetDeg)) return up.clone().multiplyScalar(tiltTargetDeg < 90 ? 1 : -1);
    const t = THREE.MathUtils.degToRad(tiltTargetDeg);
    const az = headingTargetDeg == null
      ? (fallbackAz || eastRef)
      : eastRef.clone().multiplyScalar(Math.cos(THREE.MathUtils.degToRad(headingTargetDeg)))
        .add(northRef.clone().multiplyScalar(Math.sin(THREE.MathUtils.degToRad(headingTargetDeg))));
    return up.clone().multiplyScalar(Math.cos(t)).add(az.clone().normalize().multiplyScalar(Math.sin(t))).normalize();
  };

  let newDirA, newDirB;

  if (isVertical(tiltATargetDeg) || isVertical(tiltBTargetDeg) || !azA || !azB) {
    // Mindestens ein Rohr ist (Ziel-)senkrecht - der Winkel zum anderen Rohr folgt allein
    // aus Schritt 1, Azimut/Kompassrichtung bleibt für beide unangetastet.
    newDirA = dirFromTiltAndHeading(tiltATargetDeg, azA ? headingDeg(azA) : null, azA);
    newDirB = dirFromTiltAndHeading(tiltBTargetDeg, azB ? headingDeg(azB) : null, azB);
  } else {
    // Beide nicht-senkrecht -> Azimut-Differenz zueinander aufs 45°-Raster runden und
    // hälftig auf beide verteilen (fair, minimiert die Summe der Einzel-Drehungen).
    const headingA = headingDeg(azA);
    const headingB = headingDeg(azB);
    let deltaAz = headingB - headingA;
    deltaAz = ((deltaAz + 180) % 360 + 360) % 360 - 180; // auf (-180°,180°] normieren
    const deltaAzTarget = snapToStep(deltaAz);
    const correction = deltaAzTarget - deltaAz;
    newDirA = dirFromTiltAndHeading(tiltATargetDeg, headingA - correction / 2);
    newDirB = dirFromTiltAndHeading(tiltBTargetDeg, headingB + correction / 2);
  }

  const angleChangeADeg = THREE.MathUtils.radToDeg(dirA.angleTo(newDirA));
  const angleChangeBDeg = THREE.MathUtils.radToDeg(dirB.angleTo(newDirB));
  if (angleChangeADeg < MIN_CHANGE_DEG && angleChangeBDeg < MIN_CHANGE_DEG) return null;

  return {
    markerA: applyMinimalRotation(dirA, newDirA, markerA),
    markerB: applyMinimalRotation(dirB, newDirB, markerB),
    angleChangeADeg,
    angleChangeBDeg,
  };
}

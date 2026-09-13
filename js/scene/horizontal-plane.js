/**
 * horizontal-plane.js
 * --------------------
 * Zeichnet die horizontale Referenzebene ("das ist waagerecht") in der 3D-Szene - AUSSCHLIESSLICH
 * aus dem echten Schwerkraftvektor der Aufnahme, keine Ersatzebene mehr aus reiner
 * Marker-Geometrie.
 *
 * Frühere Version dieser App hat die Ebene ersatzweise aus der Annahme "beide Marker
 * liegen auf derselben Fläche" geschätzt (Kreuzprodukt aus der Verbindungslinie A→B und
 * den beiden Marker-X-Achsen). Das Problem: je nach Anbau-Situation der Marker konnte
 * diese Schätzung genauso gut schräg oder eher senkrecht ausfallen und wurde trotzdem
 * fälschlich als "die Horizontale" wahrgenommen. Diese Schätzung dient jetzt nur noch als
 * Konsistenz-Check in der Konsole, nicht mehr als sichtbare Ebene.
 */

import * as THREE from 'three';
import { createLabelSprite } from './geometry-helpers.js';

/**
 * Loggt (nur zur Information, keine sichtbare Auswirkung) wie gut beide Marker-X-Achsen
 * mit der Annahme "liegen auf derselben Ebene" zusammenpassen - 0° wäre perfekt koplanar.
 */
function logMarkerPlaneConsistency(markerA, markerB) {
  const abDir = new THREE.Vector3().subVectors(markerB.position, markerA.position).normalize();
  const rawN1 = new THREE.Vector3().crossVectors(abDir, markerA.xAxis).normalize();
  const rawN2 = new THREE.Vector3().crossVectors(abDir, markerB.xAxis).normalize();
  let angleDeg = THREE.MathUtils.radToDeg(rawN1.angleTo(rawN2));
  if (angleDeg > 90) angleDeg = 180 - angleDeg;
  console.log(
    '(Nur Info) Ebenen-Konsistenz A/B aus Markern allein:', angleDeg.toFixed(2),
    '° Abweichung (0° = perfekt koplanar) - wird nicht mehr angezeigt.'
  );
}

/**
 * Baut Gitter + halbtransparente Fläche + Beschriftung für die horizontale Referenzebene
 * und fügt sie der Szene hinzu, falls ein Schwerkraftvektor vorliegt.
 *
 * @param {THREE.Scene} scene
 * @param {object} markerA,markerB bereits in Three.js-Koordinaten umgerechnete Marker
 *   (siehe main.js readMarker())
 * @param {{x,y,z}|null} gravityDownCv Schwerkraft-"Unten" in OpenCV-Kamerakoordinaten,
 *   wie von capture/gravity.js geliefert (noch NICHT nach Three.js umgerechnet)
 * @param {(v:{x,y,z})=>THREE.Vector3} cvToThree Koordinatenumrechnung, siehe main.js
 * @param {THREE.Vector3} midAB Mittelpunkt zwischen beiden Markern
 * @param {number} markerDist Abstand A-B in Metern (für die Ebenengröße)
 * @param {number} unit Referenzgröße für Beschriftungshöhe
 * @returns {{usedGravity:boolean, tableNormal:THREE.Vector3|null}}
 */
export function setupHorizontalPlane(scene, markerA, markerB, gravityDownCv, cvToThree, midAB, markerDist, unit) {
  logMarkerPlaneConsistency(markerA, markerB);

  if (!gravityDownCv) {
    console.log('Keine horizontale Referenzebene angezeigt: kein Schwerkraftvektor vorhanden (Sensor bei der Aufnahme nicht verfügbar/erlaubt).');
    return { usedGravity: false, tableNormal: null };
  }

  const tableNormal = cvToThree(gravityDownCv).normalize();

  // Darf ruhig 1m unterhalb der Marker liegen (dient nur als Referenz für "waagerecht",
  // nicht als exakte reale Standfläche) - tableNormal zeigt bereits nach unten.
  const planeCenter = midAB.clone().add(tableNormal.clone().multiplyScalar(1.0));
  const planeSize = Math.max(markerDist * 6, 0.3);
  const gridQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tableNormal);

  const grid = new THREE.GridHelper(planeSize, 16, 0xc98a2e, 0xe7c892);
  grid.quaternion.copy(gridQuat);
  grid.position.copy(planeCenter);
  scene.add(grid);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeSize, planeSize),
    new THREE.MeshBasicMaterial({ color: 0xf4d9a0, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  plane.quaternion.copy(gridQuat);
  plane.position.copy(planeCenter);
  scene.add(plane);

  const label = createLabelSprite('Horizontale (Schwerkraft)', '#8a5a12', unit * 0.22);
  // Minimal in Richtung "oben" (-tableNormal) versetzt, damit das Label nicht exakt in
  // der Gitterebene liegt (Z-Fighting) und leicht darüber schwebt statt dahinter zu liegen.
  label.position.copy(planeCenter).addScaledVector(tableNormal, -planeSize * 0.02);
  scene.add(label);

  return { usedGravity: true, tableNormal };
}

/**
 * Rein informativ: Winkel der jeweiligen Rohrachse (xAxis) zur Schwerkraft, nur in die
 * Konsole geloggt. Wird NICHT automatisch zur Korrektur der Marker-Rotation verwendet -
 * ein einzelner Marker hat keine feste Beziehung zur Schwerkraft (das Rohr kann in jede
 * Richtung zeigen), daher wäre ein automatisches "Einrasten" ohne bekannte
 * Anbau-Konvention riskant. Hilft aber beim Plausibilisieren: exakt 0°/90° ist bei
 * geraden HLK-Rohrläufen der Normalfall.
 */
export function logPipeAxisAnglesToGravity(markerA, markerB, tableNormal) {
  const angleTo = (axis) => {
    const a = THREE.MathUtils.radToDeg(axis.angleTo(tableNormal));
    const fromHorizontal = Math.abs(90 - a);
    if (fromHorizontal < 2) return 'horizontal (±' + fromHorizontal.toFixed(1) + '°)';
    if (a < 2 || a > 178) return 'vertikal (±' + Math.min(a, 180 - a).toFixed(1) + '°)';
    return 90 - fromHorizontal < 45
      ? (90 - a).toFixed(0) + '° über der Horizontalen'
      : a.toFixed(0) + '° zur Vertikalen';
  };
  console.log('Rohrachse A relativ zur Schwerkraft:', angleTo(markerA.xAxis));
  console.log('Rohrachse B relativ zur Schwerkraft:', angleTo(markerB.xAxis));
}

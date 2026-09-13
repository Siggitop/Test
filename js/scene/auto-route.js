/**
 * auto-route.js
 * -------------
 * Verbindet Marker A und B automatisch mit geraden Stücken + 90°/45°-Bögen.
 *
 * Startrichtung an A = markerA.xAxis (wie beim manuellen Routing). Ankunftsrichtung an B
 * = -markerB.xAxis: an B zeigt +X in Richtung des vorhandenen Rohrs dahinter (siehe
 * geometry-helpers.createFadingStub), die neue Route muss also aus der Gegenrichtung
 * ankommen, um sauber in einer Linie in das vorhandene Rohr überzugehen.
 *
 * Ergebnis ist nur ein pragmatischer, gültiger Vorschlag (kürzeste Lösung mit maximal
 * zwei Zwischen-Bögen) - kein optimaler/kürzester Pfad im umfassenden Sinn, und bewusst
 * jederzeit über die normalen Routing-Werkzeuge weiter anpassbar.
 *
 * WICHTIG: Sobald DA und DB (anti-)parallel sind - und genau das ist der mit Abstand
 * häufigste Realfall (gerade Verlängerung ODER seitlicher Versatz zwischen zwei etwa
 * gleich ausgerichteten Rohrenden) - sind DA und DB als Vektoren linear ABHÄNGIG. Jedes
 * 3x3-Gleichungssystem der Form [DA | irgendeine Zwischenrichtung | DB] ist dann IMMER
 * singulär (Rang höchstens 2), unabhängig von der gewählten Zwischenrichtung. Das war der
 * ursprüngliche Grund, warum Auto-Route zuerst praktisch nie eine Lösung gefunden hat.
 * Für diesen Fall gibt es deshalb einen eigenen "Versatz"-Zweig weiter unten (zwei gleich
 * große Bögen mit geradem Zwischenstück - die klassische Versatz-Lösung).
 *
 * Alle drei Zweige (gerade / Versatz / Ecklösung) wurden gegen synthetische Testfälle
 * verifiziert (siehe /tests) - u.a. per Kontrollsumme, dass L1·c0+L2·c1+L3·c2 exakt
 * wieder den geforderten Verbindungsvektor ergibt.
 *
 * BEKANNTE GRENZE: Der Ecklösungs-Zweig (3 Segmente) findet nur Lösungen, bei denen sich
 * das exakte 3x3-Gleichungssystem [DA | Zwischenrichtung | DB] mit durchweg POSITIVEN
 * Längen lösen lässt. Erfordert die Geometrie eigentlich ein "Überschwingen" (z.B. erst
 * über das Ziel hinausfahren und dann zurück, ein klassisches S-förmiges Ausweichmanöver),
 * findet keiner der Kandidaten eine gültige Lösung, obwohl geometrisch durchaus ein
 * Rohrverlauf existieren würde - der Algorithmus liefert dann bewusst sauber `null`
 * zurück (siehe /tests, Testfall "Bekannte Grenze") statt falscher/negativer Geometrie.
 * In diesem Fall: manuell verlegen (wie überall in dieser App jederzeit möglich).
 */

import * as THREE from 'three';
import { perpDirs } from './geometry-helpers.js';

/** Kandidaten-Zwischenrichtungen relativ zu einer Vorwärtsrichtung: die 4 90°-Richtungen
 *  plus die 4 daraus abgeleiteten 45°-Richtungen (gleicher Satz wie die manuellen
 *  Routing-Griffe). */
function turnCandidates(fwd) {
  const p = perpDirs(fwd);
  return [...p, ...p.map((v) => fwd.clone().add(v).normalize())];
}

/** Löst L1·c0 + L2·c1 + L3·c2 = delta exakt. null, wenn singulär oder eine Länge unter
 *  minSegmentLength/negativ wäre. */
function solve3(c0, c1, c2, delta, minSegmentLength) {
  const M = new THREE.Matrix3().set(c0.x, c1.x, c2.x, c0.y, c1.y, c2.y, c0.z, c1.z, c2.z);
  if (Math.abs(M.determinant()) < 1e-9) return null;
  const L = delta.clone().applyMatrix3(M.clone().invert());
  if (L.x >= minSegmentLength && L.y >= minSegmentLength && L.z >= minSegmentLength) return [L.x, L.y, L.z];
  return null;
}

/**
 * Berechnet einen Vorschlag für die automatische Rohr-Route zwischen zwei Markern.
 *
 * @param {{position:THREE.Vector3, xAxis:THREE.Vector3}} markerA
 * @param {{position:THREE.Vector3, xAxis:THREE.Vector3}} markerB
 * @param {number} unit Referenzgröße (üblicherweise der A-B-Abstand) für Toleranzen
 * @param {number} minSegmentLength Mindestlänge je Teilstück (Platz für die Bogenradien)
 * @returns {Array<{dir:THREE.Vector3, len:number}>|null} Liste der Teilstücke, oder null
 *   wenn keine einfache Lösung gefunden wurde (Details siehe Browser-Konsole)
 */
export function tryAutoRoute(markerA, markerB, unit, minSegmentLength) {
  const A = markerA.position, DA = markerA.xAxis.clone().normalize();
  const B = markerB.position, DB = markerB.xAxis.clone().normalize().negate();
  const delta = new THREE.Vector3().subVectors(B, A);
  const log = (...a) => console.log('[AutoRoute]', ...a);

  if (delta.length() < 1e-6) { log('A und B liegen am selben Punkt.'); return null; }
  const deltaDir = delta.clone().normalize();
  log(
    'DA=', DA.toArray().map((n) => n.toFixed(3)),
    'DB=', DB.toArray().map((n) => n.toFixed(3)),
    'delta=', delta.toArray().map((n) => n.toFixed(3)),
    'DA·DB=', DA.dot(DB).toFixed(3)
  );

  // 1 Segment: direkte gerade Verbindung.
  if (deltaDir.dot(DA) > 0.999 && deltaDir.dot(DB) > 0.999) {
    log('Lösung: 1 gerades Segment.');
    return [{ dir: DA.clone(), len: delta.length() }];
  }

  const collinear = Math.abs(DA.dot(DB)) > 0.97;

  if (collinear) {
    // Versatz-Fall: Anteil von delta entlang DA ("Vorlauf") und senkrecht dazu
    // ("seitlicher Versatz") trennen. Zwei gleich große 45°-Bögen mit einem geraden
    // Zwischenstück überbrücken den seitlichen Versatz, während vor und nach dem
    // Versatz weiter parallel zu DA verlegt wird (bzw. bei DB≈-DA automatisch auch
    // parallel zu DB).
    const along = delta.dot(DA);
    const lateral = delta.clone().sub(DA.clone().multiplyScalar(along));
    const latLen = lateral.length();
    log('Kollinearer Fall: Vorlauf=', along.toFixed(3), 'seitlicher Versatz=', latLen.toFixed(3));

    if (latLen < minSegmentLength) {
      if (along > 2 * minSegmentLength && deltaDir.dot(DA) > 0.9) {
        log('Kaum Versatz, aber nicht exakt fluchtend -> ein gerades Segment.');
        return [{ dir: DA.clone(), len: delta.length() }];
      }
      log('Kollinear, aber kein sinnvoller Versatz gefunden (zu wenig Vorlauf/Versatz).');
      return null;
    }

    const latDir = lateral.clone().normalize();
    const kinkDir = DA.clone().add(latDir).normalize(); // 45° zwischen DA und Versatzrichtung
    const L2 = latLen / Math.SQRT1_2;             // Bogenlänge, die genau latLen Versatz erzeugt
    const forwardUsed = L2 * Math.SQRT1_2;         // = latLen, Vorlauf-Anteil des Versatz-Segments
    const remaining = along - forwardUsed;

    if (L2 >= minSegmentLength && remaining >= 2 * minSegmentLength) {
      const L1 = remaining / 2, L3 = remaining / 2;
      log('Lösung: Versatz mit 2×45°-Bogen, L1=', L1.toFixed(3), 'L2=', L2.toFixed(3), 'L3=', L3.toFixed(3));
      return [{ dir: DA.clone(), len: L1 }, { dir: kinkDir, len: L2 }, { dir: DA.clone(), len: L3 }];
    }
    log('Versatz-Geometrie ergäbe zu kurze/negative Segmente (remaining=', remaining.toFixed(3), ').');
    return null;
  }

  // Nicht-kollinearer Fall (z.B. Ecklösung): DA und DB sind linear unabhängig, ein
  // Gleichungssystem [DA | Zwischenrichtung | DB] kann daher grundsätzlich lösbar sein.

  // 2 Segmente (ein Bogen): nur exakt lösbar, wenn delta in der von DA/DB aufgespannten Ebene liegt.
  {
    const n = new THREE.Vector3().crossVectors(DA, DB).normalize();
    if (Math.abs(delta.dot(n)) < unit * 0.01) {
      const uu = DA.dot(DA), uv = DA.dot(DB), vv = DB.dot(DB), ud = DA.dot(delta), vd = DB.dot(delta);
      const det = uu * vv - uv * uv;
      if (Math.abs(det) > 1e-9) {
        const L1 = (ud * vv - vd * uv) / det, L2 = (uu * vd - uv * ud) / det;
        if (L1 >= minSegmentLength && L2 >= minSegmentLength) {
          log('Lösung: 2 Segmente (ein Bogen).');
          return [{ dir: DA.clone(), len: L1 }, { dir: DB.clone(), len: L2 }];
        }
      }
    }
  }

  // 3 Segmente (zwei Bögen) über eine Zwischenrichtung aus dem Kandidatensatz.
  let best = null;
  turnCandidates(DA).forEach((mid) => {
    const sol = solve3(DA, mid, DB, delta, minSegmentLength);
    if (sol) {
      const total = sol[0] + sol[1] + sol[2];
      if (!best || total < best.total) {
        best = { total, steps: [{ dir: DA.clone(), len: sol[0] }, { dir: mid.clone(), len: sol[1] }, { dir: DB.clone(), len: sol[2] }] };
      }
    }
  });
  if (best) { log('Lösung: 3 Segmente (zwei Bögen), Gesamtlänge=', best.total.toFixed(3)); return best.steps; }

  log('Keine Lösung gefunden.');
  return null;
}

/**
 * auto-route.test.mjs
 * ----------------------
 * Testet js/scene/auto-route.js (das echte Modul, nicht nachgebaut) gegen die vier
 * Szenarien, die während der Entwicklung den ursprünglichen Bug (Auto-Route fand fast
 * nie eine Lösung) aufgedeckt bzw. den Fix verifiziert haben:
 *   1. Demo-Daten: reine gerade Verlängerung
 *   2. Parallele Marker-Achsen MIT seitlichem Versatz (der Regelfall in der Praxis)
 *   3. Zu enger Versatz -> muss sauber "keine Lösung" liefern, nicht falsche Geometrie
 *   4. Nicht-kollineare (90°-Ecke) Marker-Achsen -> anderer Lösungsweg im Modul
 *
 * Ausführen: node tests/auto-route.test.mjs
 */
import * as THREE from 'three';
import { tryAutoRoute } from '../js/scene/auto-route.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

function marker(pos, xAxis) {
  return { position: new THREE.Vector3(...pos), xAxis: new THREE.Vector3(...xAxis) };
}

/** Prüft, dass die Summe der Teilstücke exakt wieder den A→B-Vektor ergibt. */
function checkStepsReachTarget(name, steps, markerA, markerB) {
  if (!steps) { check(name + ': Lösung gefunden', false); return; }
  const sum = new THREE.Vector3();
  steps.forEach((s) => sum.add(s.dir.clone().normalize().multiplyScalar(s.len)));
  const reached = markerA.position.clone().add(sum);
  const err = reached.distanceTo(markerB.position);
  check(name + ': Summe der Teilstücke erreicht B exakt', err < 1e-9, `Fehler=${err.toExponential(2)}, ${steps.length} Segment(e)`);
  check(name + ': alle Längen positiv', steps.every((s) => s.len > 0));
}

// 1. Demo-Daten: gerade Verlängerung
{
  const A = marker([0, 0, 0], [1, 0, 0]);
  const B = marker([2, 0, 0], [-1, 0, 0]);
  const steps = tryAutoRoute(A, B, 2, 0.01);
  checkStepsReachTarget('Demo (gerade)', steps, A, B);
  check('Demo (gerade): genau 1 Segment', steps && steps.length === 1);
}

// 2. Paralleler Versatz (der Regelfall) - 30cm Vorlauf, 5cm seitlicher Versatz
{
  const A = marker([0, 0, 0], [1, 0, 0]);
  const B = marker([0.3, 0.05, 0], [-1, 0, 0]);
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  checkStepsReachTarget('Versatz 5cm', steps, A, B);
  check('Versatz 5cm: 3 Segmente (Versatz-Lösung)', steps && steps.length === 3);
}

// 3. Zu enger Versatz -> keine gültige Lösung, aber auch kein Crash / keine falsche Geometrie
{
  const A = marker([0, 0, 0], [1, 0, 0]);
  const B = marker([0.06, 0.05, 0], [-1, 0, 0]);
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, 0.03);
  check('Enger Versatz: liefert sauber null statt falscher Geometrie', steps === null);
}

// 4. Nicht-kollineare Ecklösung (90°), echt dreidimensional. Konstruiert aus bekannten
//    Teilstücken (L0=0.2 entlang DA, L1=0.15 entlang einer 90°-Zwischenrichtung, L2=0.25
//    entlang DB), damit garantiert eine gültige Lösung existiert - siehe Test 5 für den
//    Fall, dass für eine beliebig gewählte B-Position/Achse KEINE einfache Lösung
//    existiert (das ist bei diesem Algorithmus-Ansatz nicht ungewöhnlich, siehe dort).
{
  const A = marker([0, 0, 0], [1, 0, 0]);
  // delta = 0.2*(1,0,0) + 0.15*(0,1,0) + 0.25*(0,0,-1) = (0.2, 0.15, -0.25)
  const B = marker([0.2, 0.15, -0.25], [0, 0, 1]); // DB = -B.xAxis = (0,0,-1)
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  checkStepsReachTarget('90°-Ecke (3D, konstruiert lösbar)', steps, A, B);
}

// 5. Dokumentierte Grenze: eine Ecklösung, die VOLLSTÄNDIG in einer Ebene liegt (A, B,
//    beide Achsen und die Verbindung liegen exakt in der z=0-Ebene), UND bei der die
//    direkte 2-Segment-Lösung eine negative (unphysikalische) Länge ergäbe, kann der
//    aktuelle Algorithmus NICHT lösen: jede Zwischenrichtung aus dem Kandidatensatz liegt
//    entweder auch in derselben Ebene (dann ist [DA|mid|DB] immer singulär, da 3 Vektoren
//    in einer 2D-Ebene niemals linear unabhängig sein können) oder hat eine
//    Z-Komponente (dann erzwingt die z=0-Bedingung von delta zwangsläufig eine Länge von
//    0 für dieses Segment, was wieder auf die fehlschlagende 2-Segment-Lösung
//    zurückfällt). Ein Lösungsweg gibt es geometrisch trotzdem (ein S-förmiger Umweg mit
//    "Überschwingen"), nur eben nicht mit dem aktuellen, auf einen exakt bestimmten
//    3x3-Gleichungssatz begrenzten Ansatz. Der Algorithmus liefert hier bewusst sauber
//    `null` zurück statt falscher/negativer Geometrie - die Route ist dann manuell zu
//    verlegen (wie im Docstring von auto-route.js beschrieben, ist das ein bewusst in
//    Kauf genommener, klar kommunizierter Kompromiss, kein stiller Fehler).
{
  const A = marker([0, 0, 0], [1, 0, 0]);
  const B = marker([0.3, 0.3, 0], [0, 1, 0]);
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  check('Bekannte Grenze (voll-koplanare Ecke): liefert sauber null, keine falsche Geometrie', steps === null);
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

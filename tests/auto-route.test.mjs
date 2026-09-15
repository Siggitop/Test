/**
 * auto-route.test.mjs
 * ----------------------
 * Testet js/scene/auto-route.js (das echte Modul, nicht nachgebaut) gegen die
 * Szenarien, die während der Entwicklung den ursprünglichen Bug (Auto-Route fand fast
 * nie eine Lösung) aufgedeckt bzw. den Fix verifiziert haben, sowie den späteren
 * Mehrsegment-Fallback für komplexere Wege:
 *   1. Demo-Daten: reine gerade Verlängerung
 *   2. Parallele Marker-Achsen MIT seitlichem Versatz (der Regelfall in der Praxis)
 *   3. Zu enger Versatz für die einfache Formel -> jetzt per komplexem Weg lösbar
 *   4. Nicht-kollineare (90°-Ecke) Marker-Achsen -> anderer Lösungsweg im Modul
 *   5. Ehemals dokumentierte Grenze (voll-koplanare Ecke) -> jetzt per komplexem Weg lösbar
 *   6.-8. Direkte Tests der Linear-Algebra-Bausteine des Mehrsegment-Fallbacks
 *         (solveUnderdetermined, solveInterval1D, solvePolygon2D) - stellen sicher, dass
 *         auch der 2-freie-Parameter-Pfad (Polygon-Schnitt, in der Praxis selten der
 *         beste/kürzeste Kandidat und daher schwer über tryAutoRoute allein zu erreichen)
 *         korrekt ist, nicht nur der 1-Parameter-Pfad (Intervall).
 *  10. Regressionstest: nicht achsenausgerichtete Marker (Azimut-Differenz kein Vielfaches
 *      von 45°) durften früher Segmente mit willkürlichem Zwischenwinkel erzeugen (echter,
 *      am Gerät gemeldeter Bug) - muss jetzt bewusst null statt falscher Geometrie liefern.
 *  11. Gegenprobe dazu: realistisches Posen-Rauschen um eine tatsächlich saubere 90°-
 *      Installation darf NICHT dazu führen, dass gar keine Lösung mehr gefunden wird.
 *
 * Ausführen: node tests/auto-route.test.mjs
 */
import * as THREE from 'three';
import {
  tryAutoRoute, solveUnderdetermined, solveInterval1D, solvePolygon2D, STANDARD_DIRS,
} from '../js/scene/auto-route.js';

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
  const A = marker([0, 0, 0], [-1, 0, 0]);
  const B = marker([2, 0, 0], [1, 0, 0]);
  const steps = tryAutoRoute(A, B, 2, 0.01);
  checkStepsReachTarget('Demo (gerade)', steps, A, B);
  check('Demo (gerade): genau 1 Segment', steps && steps.length === 1);
}

// 2. Paralleler Versatz (der Regelfall) - 30cm Vorlauf, 5cm seitlicher Versatz
{
  const A = marker([0, 0, 0], [-1, 0, 0]);
  const B = marker([0.3, 0.05, 0], [1, 0, 0]);
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  checkStepsReachTarget('Versatz 5cm', steps, A, B);
  check('Versatz 5cm: 3 Segmente (Versatz-Lösung)', steps && steps.length === 3);
}

// 3. Zu enger Versatz für die einfache 2×45°-Bogen-Lösung (remaining < 2×minSegmentLength)
//    -> die reine Versatz-Formel scheitert, aber der allgemeinere Mehrsegment-Fallback
//    (komplexerer Weg mit zusätzlichen Zwischenrichtungen) findet trotzdem eine gültige,
//    geometrisch exakte Lösung statt hier aufzugeben.
{
  const A = marker([0, 0, 0], [-1, 0, 0]);
  const B = marker([0.06, 0.05, 0], [1, 0, 0]);
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, 0.03);
  checkStepsReachTarget('Enger Versatz (komplexer Weg)', steps, A, B);
  check('Enger Versatz (komplexer Weg): mehr als 3 Segmente genutzt', steps && steps.length > 3, `${steps?.length} Segment(e)`);
}

// 4. Nicht-kollineare Ecklösung (90°), echt dreidimensional. Konstruiert aus bekannten
//    Teilstücken (L0=0.2 entlang DA, L1=0.15 entlang einer 90°-Zwischenrichtung, L2=0.25
//    entlang DB), damit garantiert eine gültige Lösung existiert - siehe Test 5 für den
//    Fall, dass für eine beliebig gewählte B-Position/Achse KEINE einfache Lösung
//    existiert (das ist bei diesem Algorithmus-Ansatz nicht ungewöhnlich, siehe dort).
//    Regressionssicherung "so wenig Winkel wie möglich": es gäbe eine (minimal kürzere)
//    5-Segment-Lösung, aber die einfachere, dem Nutzer verständlichere 3-Segment-Lösung
//    wird bevorzugt, weil weniger Bögen wichtiger sind als die letzten paar Zentimeter.
{
  const A = marker([0, 0, 0], [-1, 0, 0]);
  // delta = 0.2*(1,0,0) + 0.15*(0,1,0) + 0.25*(0,0,-1) = (0.2, 0.15, -0.25)
  const B = marker([0.2, 0.15, -0.25], [0, 0, -1]); // DB = +B.xAxis = (0,0,-1)
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  checkStepsReachTarget('90°-Ecke (3D, konstruiert lösbar)', steps, A, B);
  check('90°-Ecke: so wenig Segmente wie möglich (3, nicht die minimal kürzere 5-Segment-Lösung)',
    steps && steps.length === 3, `${steps?.length} Segment(e)`);
}

// 5. Ehemals dokumentierte Grenze: eine Ecklösung, die VOLLSTÄNDIG in einer Ebene liegt
//    (A, B, beide Achsen und die Verbindung liegen exakt in der z=0-Ebene), UND bei der
//    die direkte 2-Segment-Lösung eine negative (unphysikalische) Länge ergäbe. Die
//    2-/3-Segment-Zweige allein können das nicht lösen (jede Zwischenrichtung liegt
//    entweder auch in der Ebene -> singuläres System, oder hat eine Z-Komponente -> die
//    z=0-Bedingung von delta erzwingt Länge 0 für dieses Segment). Der geometrische
//    Lösungsweg braucht ein "Überschwingen" (S-förmiger Umweg aus der Ebene heraus und
//    wieder zurück) - genau das findet jetzt der Mehrsegment-Fallback (siehe
//    auto-route.js, "KOMPLEXERE WEGE"), der zusätzliche Zwischenrichtungen mit
//    Z-Komponente kombiniert, die sich am Ende gegenseitig aufheben.
{
  const A = marker([0, 0, 0], [-1, 0, 0]);
  const B = marker([0.3, 0.3, 0], [0, -1, 0]);
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  checkStepsReachTarget('Ehemalige Grenze (voll-koplanare Ecke, jetzt per komplexem Weg lösbar)', steps, A, B);
  check('Ehemalige Grenze: mehr als 3 Segmente genutzt', steps && steps.length > 3, `${steps?.length} Segment(e)`);
}

// 6. STANDARD_DIRS: 18 eindeutige Einheitsvektoren (6 Flächen + 12 Kanten-Diagonalen).
{
  check('STANDARD_DIRS: genau 18 Richtungen', STANDARD_DIRS.length === 18, `${STANDARD_DIRS.length}`);
  check('STANDARD_DIRS: alle normiert', STANDARD_DIRS.every((d) => Math.abs(d.length() - 1) < 1e-9));
  const allDistinct = STANDARD_DIRS.every((d, i) => STANDARD_DIRS.every((o, j) => i === j || d.distanceTo(o) > 1e-6));
  check('STANDARD_DIRS: alle eindeutig', allDistinct);
}

/** Hilfsfunktion: M·L (Summe Li·dirs[i]) als THREE.Vector3. */
function applyDirs(dirs, L) {
  const out = new THREE.Vector3();
  dirs.forEach((d, i) => out.addScaledVector(d, L[i]));
  return out;
}

// 7. solveUnderdetermined: 5 Richtungen (2 freie Parameter) - Partikulärlösung UND beide
//    Nullraum-Basisvektoren müssen das Gleichungssystem exakt erfüllen (M·nullBasis=0).
{
  const dirs = [STANDARD_DIRS[0], STANDARD_DIRS[2], STANDARD_DIRS[4], STANDARD_DIRS[6], STANDARD_DIRS[9]];
  const delta = new THREE.Vector3(0.4, -0.15, 0.25);
  const sys = solveUnderdetermined(dirs, delta);
  check('solveUnderdetermined: Lösung gefunden', !!sys);
  if (sys) {
    check('solveUnderdetermined: genau 2 Nullraum-Basisvektoren (5-3)', sys.nullBasis.length === 2, `${sys.nullBasis.length}`);
    const errL0 = applyDirs(dirs, sys.L0).distanceTo(delta);
    check('solveUnderdetermined: Partikulärlösung erfüllt M·L0=delta', errL0 < 1e-9, `Fehler=${errL0.toExponential(2)}`);
    sys.nullBasis.forEach((n, i) => {
      const errN = applyDirs(dirs, n).length();
      check(`solveUnderdetermined: Nullraum-Vektor ${i} erfüllt M·n=0`, errN < 1e-9, `Fehler=${errN.toExponential(2)}`);
    });
  }
}

// 8. solveInterval1D: 1 freier Parameter - konstruiertes Beispiel mit bekanntem gültigen
//    Intervall für t, prüft dass die Rückgabe M·L=delta erfüllt und alle Längen ≥ minLen.
{
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)];
  const delta = new THREE.Vector3(0.1, 0.3, 0.2); // L4 (4. Richtung, -X) muss > 0 sein, da L1 sonst negativ würde
  const minLen = 0.02;
  const sys = solveUnderdetermined(dirs, delta);
  check('solveInterval1D: Nullraum ist 1-dimensional', sys && sys.nullBasis.length === 1, `${sys?.nullBasis.length}`);
  if (sys && sys.nullBasis.length === 1) {
    const L = solveInterval1D(sys.L0, sys.nullBasis[0], minLen);
    check('solveInterval1D: Lösung gefunden', !!L);
    if (L) {
      const err = applyDirs(dirs, L).distanceTo(delta);
      check('solveInterval1D: erfüllt M·L=delta', err < 1e-9, `Fehler=${err.toExponential(2)}`);
      check('solveInterval1D: alle Längen ≥ minLen', L.every((v) => v >= minLen - 1e-9), `L=${L.map((v) => v.toFixed(4))}`);
    }
  }
}

// 9. solvePolygon2D: 2 freie Parameter - ein Fall, den der 1-Parameter-Pfad (nur 4
//    Richtungen) NICHT lösen kann (delta hat in allen 4 Basisrichtungen zu wenig
//    "Spielraum"), der aber mit einer 5. Richtung (2 freie Parameter) lösbar wird.
{
  const dirs = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0),
  ];
  const delta = new THREE.Vector3(0.05, 0.05, 0.3);
  const minLen = 0.04; // > delta.x und delta.y einzeln -> mit nur 3-4 Richtungen unlösbar
  const sys = solveUnderdetermined(dirs, delta);
  check('solvePolygon2D: Nullraum ist 2-dimensional', sys && sys.nullBasis.length === 2, `${sys?.nullBasis.length}`);
  if (sys && sys.nullBasis.length === 2) {
    const L = solvePolygon2D(sys.L0, sys.nullBasis[0], sys.nullBasis[1], minLen, delta.length());
    check('solvePolygon2D: Lösung gefunden', !!L);
    if (L) {
      const err = applyDirs(dirs, L).distanceTo(delta);
      check('solvePolygon2D: erfüllt M·L=delta', err < 1e-9, `Fehler=${err.toExponential(2)}`);
      check('solvePolygon2D: alle Längen ≥ minLen', L.every((v) => v >= minLen - 1e-9), `L=${L.map((v) => v.toFixed(4))}`);
    }
  }
}

/** Prüft, dass JEDER Winkel zwischen zwei aufeinanderfolgenden Segmenten 0/45/90/135/180°
 *  ist (±Toleranz) - die Kern-Garantie, die buildCandidatePool()s Mischung aus Welt-/DA-/
 *  DB-relativen Richtungen ohne eine Nachprüfung NICHT automatisch erfüllt, siehe
 *  Kommentar bei `allTurnsClean` in auto-route.js. */
function checkAllTurnsClean(name, steps) {
  if (!steps) { check(name + ': Lösung gefunden', false); return; }
  const CLEAN = [0, 45, 90, 135, 180];
  steps.forEach((s, i) => {
    if (i === steps.length - 1) return;
    const deg = THREE.MathUtils.radToDeg(s.dir.angleTo(steps[i + 1].dir));
    const clean = CLEAN.some((c) => Math.abs(deg - c) < 6);
    check(`${name}: Winkel Segment ${i}->${i + 1} ist 0/45/90/135/180°`, clean, `${deg.toFixed(2)}°`);
  });
}

// 10. Regressionstest für einen echten Bug: nicht achsenausgerichtete Marker (der
//     Normalfall bei echten Messungen - pipe-alignment.js korrigiert nur die Neigung
//     relativ zur Schwerkraft, NICHT die Kompassrichtung/Azimut der Marker zueinander)
//     erzeugten früher teils willkürliche Winkel zwischen den Segmenten (107°, 146° etc.),
//     weil buildCandidatePool() Richtungen aus dem Weltgitter, relativ zu DA und relativ
//     zu DB mischt, ohne zu prüfen, ob zwei GEWÄHLTE Richtungen zueinander (nicht nur zu
//     ihrem jeweiligen Ursprung) sauber sind. Beide Marker hier sind bewusst horizontal
//     (Y=0, wie nach einer Neigungskorrektur), aber mit einer Azimut-Differenz (37°), die
//     kein Vielfaches von 45° ist - genau der Fall, den pipe-alignment.js NICHT abdeckt.
{
  const az = (deg) => { const r = THREE.MathUtils.degToRad(deg); return [Math.cos(r), 0, Math.sin(r)]; };
  const A = marker([0, 0, 0], az(0));
  const B = marker([2, 0.3, 1], az(180 - 37));
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  // Bei einer echten 37°-Azimut-Differenz gibt es innerhalb des abgesuchten Raums (≤5
  // Segmente aus Welt-/DA-/DB-relativen 45°-Richtungen) tatsächlich keine gültige
  // All-45°/90°-Lösung - der korrekte Fix gibt dafür bewusst null zurück, statt (wie vor
  // dem Fix) eine Lösung mit einem willkürlichen Winkel anzubieten.
  check('37°-Azimut-Differenz: korrekt keine Lösung (statt einer mit falschem Winkel)', steps === null, `${steps?.length} Segment(e) zurückgegeben`);
}

// 11. Rausch-Robustheit: zwei horizontale Marker, tatsächlich exakt 90° Azimut auseinander
//     installiert, aber mit realistischem Posen-Schätzungs-Rauschen (±8° je Marker) - das
//     darf NICHT dazu führen, dass keine Lösung mehr gefunden wird (sonst wäre Auto-Route
//     bei jeder echten Aufnahme unbrauchbar), und die gefundene Lösung muss trotzdem
//     überall saubere Winkel haben.
{
  const az = (deg) => { const r = THREE.MathUtils.degToRad(deg); return [Math.cos(r), 0, Math.sin(r)]; };
  const noiseDeg = 8;
  const A = marker([0, 0, 0], az(0 + noiseDeg));
  const B = marker([1.5, 0, 1.5], az(90 - noiseDeg));
  const unit = A.position.distanceTo(B.position);
  const steps = tryAutoRoute(A, B, unit, unit * 0.02);
  check(`±${noiseDeg}° Rauschen um eine echte 90°-Installation: Lösung trotzdem gefunden`, !!steps, `${steps?.length} Segment(e)`);
  checkAllTurnsClean(`±${noiseDeg}° Rauschen`, steps);
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

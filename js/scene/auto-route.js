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
 * KOMPLEXERE WEGE (4-5 Segmente): Lösen die einfachen Zweige oben nichts (z.B. weil die
 * Geometrie ein "Überschwingen" braucht - erst über das Ziel hinausfahren und dann
 * zurück, ein klassisches S-förmiges Ausweichmanöver), greift weiter unten eine
 * allgemeinere Suche: sie probiert Kombinationen aus 2 bzw. 3 zusätzlichen
 * Zwischenrichtungen aus einem festen globalen Satz von 18 Standardrichtungen (6
 * Flächen- + 12 Kanten-Diagonalrichtungen eines Würfels - alles, was durch reine
 * 90°/45°-Schritte von einer Achse aus erreichbar ist). Das ergibt pro Versuch ein
 * unterbestimmtes Gleichungssystem (mehr Richtungen als Koordinaten) mit 1 bzw. 2 frei
 * wählbaren Parametern - die Suche nach positiven Segmentlängen wird dann zu einem
 * kleinen linearen Optimierungsproblem (Intervall- bzw. Polygon-Schnitt), siehe
 * `searchWithMiddleCount` unten. Auch das findet nicht JEDE geometrisch mögliche Route
 * (mehr als 3 zusätzliche Zwischenrichtungen werden aus Aufwandsgründen nicht probiert),
 * aber deutlich mehr als die reinen 2-/3-Segment-Spezialfälle oben.
 */

import * as THREE from 'three';
import { perpDirs } from './geometry-helpers.js';

// -- Genereller Mehrsegment-Löser (siehe Dateikopf-Kommentar) -----------------------------

const FACE_DIRS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
/** Die 12 Kanten-Diagonalen eines Würfels (45° zwischen je zwei senkrechten Flächen-
 *  richtungen) - zusammen mit FACE_DIRS der vollständige Satz "sauberer" Richtungen, in
 *  die real verlegte Rohre laut Dateikopf-Kommentar zeigen können. */
const EDGE_DIRS = [];
for (let i = 0; i < FACE_DIRS.length; i++) {
  for (let j = i + 1; j < FACE_DIRS.length; j++) {
    if (Math.abs(FACE_DIRS[i].dot(FACE_DIRS[j])) > 0.5) continue; // identisch/entgegengesetzt
    EDGE_DIRS.push(FACE_DIRS[i].clone().add(FACE_DIRS[j]).normalize());
  }
}
export const STANDARD_DIRS = [...FACE_DIRS, ...EDGE_DIRS]; // 18 Richtungen

function kCombinations(arr, k) {
  const results = [];
  const combo = [];
  (function recurse(start) {
    if (combo.length === k) { results.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      recurse(i + 1);
      combo.pop();
    }
  })(0);
  return results;
}

/**
 * Löst M·L = delta für eine 3×K-Matrix M (Spalten = `dirs`) per Gauß-Jordan-Elimination
 * (mit Partial Pivoting). Liefert eine Partikulärlösung (freie Variablen = 0) plus eine
 * Basis des Nullraums (K-3 Vektoren), oder null, falls `dirs` den R³ nicht aufspannt
 * (Rang < 3 - z.B. wenn alle gewählten Richtungen zufällig koplanar sind).
 */
export function solveUnderdetermined(dirs, delta) {
  const K = dirs.length;
  const rows = [
    dirs.map((d) => d.x).concat(delta.x),
    dirs.map((d) => d.y).concat(delta.y),
    dirs.map((d) => d.z).concat(delta.z),
  ];
  const pivotCols = [];
  let pivotRow = 0;
  for (let col = 0; col < K && pivotRow < 3; col++) {
    let maxRow = pivotRow, maxVal = Math.abs(rows[pivotRow][col]);
    for (let r = pivotRow + 1; r < 3; r++) {
      if (Math.abs(rows[r][col]) > maxVal) { maxVal = Math.abs(rows[r][col]); maxRow = r; }
    }
    if (maxVal < 1e-9) continue; // Spalte linear abhängig von bereits gewählten Pivots
    [rows[pivotRow], rows[maxRow]] = [rows[maxRow], rows[pivotRow]];
    const piv = rows[pivotRow][col];
    for (let c = 0; c <= K; c++) rows[pivotRow][c] /= piv;
    for (let r = 0; r < 3; r++) {
      if (r === pivotRow) continue;
      const f = rows[r][col];
      if (f !== 0) for (let c = 0; c <= K; c++) rows[r][c] -= f * rows[pivotRow][c];
    }
    pivotCols.push(col);
    pivotRow++;
  }
  if (pivotRow < 3) return null;

  const freeCols = [];
  for (let c = 0; c < K; c++) if (!pivotCols.includes(c)) freeCols.push(c);

  const L0 = new Array(K).fill(0);
  pivotCols.forEach((col, i) => { L0[col] = rows[i][K]; });

  const nullBasis = freeCols.map((freeCol) => {
    const n = new Array(K).fill(0);
    n[freeCol] = 1;
    pivotCols.forEach((col, i) => { n[col] = -rows[i][freeCol]; });
    return n;
  });

  return { L0, nullBasis };
}

/** 1 freier Parameter: L(t) = L0 + t·n, gesucht ein t mit L(t) ≥ minLen überall. Die
 *  Bedingungen ergeben je nach Vorzeichen von n[i] eine untere oder obere Schranke für t -
 *  deren Schnitt ist ein Intervall (oder leer = keine Lösung). Von den gültigen t wird das
 *  gewählt, das die Gesamtlänge minimiert (liegt bei einem linearen Ziel immer an einem
 *  Rand des Intervalls). */
export function solveInterval1D(L0, n, minLen) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < L0.length; i++) {
    if (Math.abs(n[i]) < 1e-12) {
      if (L0[i] < minLen) return null;
      continue;
    }
    const bound = (minLen - L0[i]) / n[i];
    if (n[i] > 0) lo = Math.max(lo, bound); else hi = Math.min(hi, bound);
  }
  if (lo > hi + 1e-9) return null;
  const sumN = n.reduce((a, b) => a + b, 0);
  let t;
  if (sumN > 1e-12) t = Number.isFinite(lo) ? lo : hi;
  else if (sumN < -1e-12) t = Number.isFinite(hi) ? hi : lo;
  else t = Number.isFinite(lo) ? lo : hi;
  if (!Number.isFinite(t)) return null;
  return L0.map((v, i) => v + t * n[i]);
}

/** Sutherland-Hodgman: schneidet ein konvexes Polygon mit der Halbebene a·t1+b·t2 ≤ c. */
function clipPolygon(poly, a, b, c) {
  if (poly.length === 0) return poly;
  const inside = (p) => a * p[0] + b * p[1] <= c + 1e-9;
  const intersect = (p1, p2) => {
    const d1 = a * p1[0] + b * p1[1] - c, d2 = a * p2[0] + b * p2[1] - c;
    const t = d1 / (d1 - d2);
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  };
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i], prev = poly[(i - 1 + poly.length) % poly.length];
    const currIn = inside(curr), prevIn = inside(prev);
    if (currIn) {
      if (!prevIn) out.push(intersect(prev, curr));
      out.push(curr);
    } else if (prevIn) {
      out.push(intersect(prev, curr));
    }
  }
  return out;
}

/** 2 freie Parameter: L(t1,t2) = L0 + t1·n1 + t2·n2, gesucht ein (t1,t2) mit L ≥ minLen
 *  überall. Jede Bedingung ist eine Halbebene in der (t1,t2)-Ebene - deren Schnitt (falls
 *  nicht leer) ein konvexes Polygon. Das lineare Ziel "Gesamtlänge minimieren" wird an
 *  einer Polygon-Ecke minimal, deshalb wird über alle Ecken die beste gewählt. */
export function solvePolygon2D(L0, n1, n2, minLen, scale) {
  const BIG = Math.max(scale, 1) * 1000;
  let poly = [[-BIG, -BIG], [BIG, -BIG], [BIG, BIG], [-BIG, BIG]];
  for (let i = 0; i < L0.length && poly.length; i++) {
    poly = clipPolygon(poly, -n1[i], -n2[i], L0[i] - minLen);
  }
  if (poly.length < 3) return null;
  const sumN1 = n1.reduce((a, b) => a + b, 0), sumN2 = n2.reduce((a, b) => a + b, 0);
  const base = L0.reduce((a, b) => a + b, 0);
  let best = null;
  poly.forEach(([t1, t2]) => {
    const total = base + t1 * sumN1 + t2 * sumN2;
    if (!best || total < best.total) best = { total, t1, t2 };
  });
  return L0.map((v, i) => v + best.t1 * n1[i] + best.t2 * n2[i]);
}

/** Sucht positive Segmentlängen für die feste Richtungsfolge `dirs` (erstes = DA, letztes
 *  = DB, dazwischen frei gewählte Zwischenrichtungen). Reicht die Anzahl Freiheitsgrade
 *  (K-3) über 2 hinaus, wird bewusst nicht versucht (bräuchte ein 3D+-Polytop statt
 *  Intervall/Polygon) - für diese Fälle bleibt manuelles Verlegen die Lösung. */
function solveFeasibleLengths(dirs, delta, minLen) {
  const sys = solveUnderdetermined(dirs, delta);
  if (!sys) return null;
  const { L0, nullBasis } = sys;
  let L;
  if (nullBasis.length === 0) L = L0.every((v) => v >= minLen) ? L0 : null;
  else if (nullBasis.length === 1) L = solveInterval1D(L0, nullBasis[0], minLen);
  else if (nullBasis.length === 2) L = solvePolygon2D(L0, nullBasis[0], nullBasis[1], minLen, delta.length());
  else return null;
  if (!L || L.some((v) => v < minLen - 1e-6)) return null;
  return L;
}

/** Probiert alle Kombinationen aus `numMiddle` zusätzlichen Zwischenrichtungen (aus
 *  STANDARD_DIRS) zwischen DA und DB und gibt die Lösung mit der kürzesten Gesamtlänge
 *  zurück, oder null. */
export function searchWithMiddleCount(DA, DB, delta, minSegmentLength, numMiddle) {
  let best = null;
  const combos = numMiddle === 0 ? [[]] : kCombinations(STANDARD_DIRS, numMiddle);
  combos.forEach((mids) => {
    const dirs = [DA, ...mids, DB];
    const L = solveFeasibleLengths(dirs, delta, minSegmentLength);
    if (L) {
      const total = L.reduce((a, b) => a + b, 0);
      if (!best || total < best.total) {
        best = { total, steps: dirs.map((d, i) => ({ dir: d.clone(), len: L[i] })) };
      }
    }
  });
  return best;
}

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
    log('Versatz-Geometrie ergäbe zu kurze/negative Segmente (remaining=', remaining.toFixed(3), ') - versuche komplexere Wege.');
  } else {
    // Nicht-kollinearer Fall (z.B. Ecklösung): DA und DB sind linear unabhängig, ein
    // Gleichungssystem [DA | Zwischenrichtung | DB] kann daher grundsätzlich lösbar sein.

    // 2 Segmente (ein Bogen): nur exakt lösbar, wenn delta in der von DA/DB aufgespannten Ebene liegt.
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

  // 3 Segmente (zwei Bögen) über eine Zwischenrichtung aus dem (DA-relativen) Kandidatensatz.
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

  // Komplexere Wege: 1, 2 oder 3 zusätzliche Zwischenrichtungen aus dem vollständigen
  // globalen Richtungssatz (nicht nur relativ zu DA) - deckt auch Fälle ab, die die
  // einfacheren Zweige oben bewusst nicht lösen (S-förmige Überschwung-Manöver o.ä.).
  for (const numMiddle of [1, 2, 3]) {
    const res = searchWithMiddleCount(DA, DB, delta, minSegmentLength, numMiddle);
    if (res) {
      log(`Lösung: ${res.steps.length} Segmente (komplexer Weg, ${numMiddle} zusätzliche Zwischenrichtung(en)), Gesamtlänge=`, res.total.toFixed(3));
      return res.steps;
    }
  }

  log('Keine Lösung gefunden.');
  return null;
}

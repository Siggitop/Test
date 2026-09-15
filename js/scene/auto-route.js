/**
 * auto-route.js
 * -------------
 * Verbindet Marker A und B automatisch mit geraden Stücken + 90°/45°-Winkeln - und zwar mit
 * SO WENIG WINKELN/BÖGEN WIE MÖGLICH (nur so viele wie zwingend nötig), unter allen so
 * gefundenen Lösungen mit der kürzesten Gesamtlänge als Kriterium zweiter Ordnung. Der
 * Suchraum ist auf 1-5 Segmente und "saubere" 90°/45°-Richtungen begrenzt (kein
 * exhaustiver kürzester Pfad über alle geometrisch denkbaren Richtungen/Winkel - das wäre
 * für ein Echtzeit-Klick-Ergebnis weder nötig noch praxisgerecht, da real verlegte Rohre
 * ohnehin nur in Waage/senkrecht/45° liegen, siehe pipe-alignment.js).
 *
 * Startrichtung an A = -markerA.xAxis (wie beim manuellen Routing). +X zeigt jeweils in
 * Richtung des vorhandenen (unmodellierten) Rohrs dahinter (siehe
 * geometry-helpers.createFadingStub) - die Marker-Mitte ist das offene Ende dieses
 * vorhandenen Rohrs. Die neue Route muss also auf der GEGENrichtung (-X) beginnen bzw.
 * ankommen, da +X bereits vom vorhandenen Rohr belegt ist. Ankunftsrichtung an B =
 * +markerB.xAxis (die Route nähert sich B aus dessen -X-Richtung und bewegt sich beim
 * Ankommen in +X, um sauber in einer Linie ins vorhandene Rohr überzugehen).
 *
 * VORGEHEN: `tryAutoRoute` bricht NICHT beim ersten Treffer ab, sondern sammelt Kandidaten
 * aus mehreren Strategien und gibt am Ende die mit den WENIGSTEN Segmenten zurück (bei
 * Gleichstand die kürzeste) - sonst wäre z.B. eine früh gefundene 3-Segment-Lösung nicht
 * vergleichbar mit einer eventuell einfacheren 2-Segment-Alternative, und eine unnötig
 * komplexe (aber zufällig minimal kürzere) 5-Segment-Lösung würde einer einfacheren
 * 3-Segment-Lösung fälschlich vorgezogen:
 *
 *  1. Direkte gerade Verbindung (1 Segment) - falls anwendbar unschlagbar kurz (Luftlinie).
 *  2. Kollinearer Versatz (2×45°-Bogen mit geradem Zwischenstück) - die klassische Lösung
 *     für den mit Abstand häufigsten Praxisfall (DA und DB (anti-)parallel, z.B. gerade
 *     Verlängerung oder seitlicher Versatz zwischen zwei gleich ausgerichteten
 *     Rohrenden). Bei (anti-)parallelem DA/DB ist jedes Gleichungssystem
 *     [DA | Zwischenrichtung | DB] singulär (Rang ≤ 2), unabhängig von der gewählten
 *     Zwischenrichtung - ohne diesen eigenen Zweig fände Auto-Route für den häufigsten
 *     Fall praktisch nie eine Lösung.
 *  3. Nicht-kollinearer Fall: exakte 2-Segment-Lösung (ein Bogen), falls delta in der von
 *     DA/DB aufgespannten Ebene liegt.
 *  4. Allgemeine Suche mit 1-3 zusätzlichen Zwischenrichtungen (3-5 Segmente gesamt) aus
 *     einem kombinierten Kandidatenpool (18 feste Weltrichtungen + Richtungen relativ zu
 *     DA und DB) - deckt sowohl den klassischen "eine Ecklösung"-Fall als auch komplexere
 *     Wege ab, die ein Überschwingen brauchen (S-förmiger Umweg), siehe
 *     `searchWithMiddleCount`/`buildCandidatePool` unten. Für 4/5 Segmente ergibt sich ein
 *     unterbestimmtes Gleichungssystem mit 1 bzw. 2 freien Parametern - die Suche nach
 *     positiven Segmentlängen wird dann zu einem kleinen linearen Optimierungsproblem
 *     (Intervall- bzw. Polygon-Schnitt).
 *
 * Alle Zweige wurden gegen synthetische Testfälle verifiziert (siehe /tests) - u.a. per
 * Kontrollsumme, dass die Teilstücke exakt wieder den geforderten Verbindungsvektor
 * ergeben.
 *
 * GRENZE: mehr als 3 zusätzliche Zwischenrichtungen (>5 Segmente insgesamt) werden aus
 * Aufwandsgründen nicht probiert (bräuchte ein 3D+-Polytop statt Intervall/Polygon) - für
 * so einen Fall bleibt manuelles Verlegen die Lösung.
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
 *  `pool`) zwischen DA und DB und gibt die Lösung mit der kürzesten Gesamtlänge zurück,
 *  oder null. */
export function searchWithMiddleCount(DA, DB, delta, minSegmentLength, numMiddle, pool = STANDARD_DIRS) {
  let best = null;
  const combos = numMiddle === 0 ? [[]] : kCombinations(pool, numMiddle);
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

/** Kombinierter Kandidatenpool für die Mehrsegment-Suche: die 18 festen Weltrichtungen
 *  PLUS die Richtungen relativ zu DA und relativ zu DB (perpDirs + 45°-Kombinationen,
 *  gleicher Satz wie die manuellen Routing-Griffe). Die Weltrichtungen allein reichen nur,
 *  wenn DA/DB bereits exakt achsenausgerichtet sind (z.B. nach der automatischen
 *  Rohrachsen-Korrektur, siehe pipe-alignment.js) - die DA-/DB-relativen Kandidaten
 *  decken auch (noch) nicht exakt ausgerichtete Marker-Achsen ab. Nahezu identische
 *  Richtungen (z.B. wenn DA selbst schon eine Weltrichtung ist) werden entfernt, damit
 *  die Suche nicht unnötig viele redundante Kombinationen durchprobiert. */
function buildCandidatePool(DA, DB) {
  const raw = [...STANDARD_DIRS, ...turnCandidates(DA), ...turnCandidates(DB)];
  const pool = [];
  raw.forEach((d) => { if (!pool.some((u) => u.dot(d) > 0.999)) pool.push(d); });
  return pool;
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
  const A = markerA.position, DA = markerA.xAxis.clone().normalize().negate();
  const B = markerB.position, DB = markerB.xAxis.clone().normalize();
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

  // Sammelt ALLE gültigen Kandidaten aus jeder Strategie unten (statt bei der ersten
  // gefundenen Lösung sofort aufzuhören) - am Ende wird die Kandidatin mit der
  // kürzesten Gesamtlänge zurückgegeben. Nur so ist "kürzestmöglich" (innerhalb des
  // abgesuchten Raums) tatsächlich garantiert: eine früh gefundene 3-Segment-Lösung kann
  // z.B. länger sein als eine andernorts mögliche 4- oder 5-Segment-Lösung.
  //
  // WICHTIG: jeder Kandidat wird hier zusätzlich auf saubere 45°/90°-Winkel ZWISCHEN
  // AUFEINANDERFOLGENDEN Segmenten geprüft, bevor er überhaupt in die Auswahl kommt.
  // Grund: buildCandidatePool() liefert Richtungen aus drei verschiedenen Bezugssystemen
  // (feste Weltachsen, relativ zu DA, relativ zu DB) - jede einzelne Richtung ist sauber
  // zu IHREM EIGENEN Ursprung, aber zwei Richtungen aus unterschiedlichen Bezugssystemen
  // (z.B. eine Weltachse gefolgt von einer DB-relativen Richtung) landen bei nicht
  // achsenausgerichteten Markern (der Normalfall bei echten Messungen, nicht bei
  // synthetischen Testfixtures) i.A. auf einem beliebigen Winkel zueinander - ohne diese
  // Prüfung wurden solche Kombinationen bisher trotzdem akzeptiert, sobald nur die
  // Längen-Gleichung eine positive Lösung hatte. Das betrifft auch den scheinbar simplen
  // "2 Segmente (ein Bogen)"-Zweig unten: DA und DB selbst können bei echten Markern
  // ebenfalls in einem beliebigen Winkel zueinander stehen.
  const CLEAN_ANGLES_DEG = [0, 45, 90, 135, 180];
  // 6° gewählt statt z.B. 1°: reale Marker-Posen haben selbst nach allen Genauigkeits-
  // verbesserungen noch etwas Rotationsrauschen (getestet: ±8° pro Marker um eine
  // tatsächlich exakte 90°-Installation wird bei 6° noch zuverlässig als "sauber"
  // erkannt), pipe-alignment.js korrigiert außerdem nur die Neigung relativ zur
  // Schwerkraft, NICHT die Kompassrichtung (Azimut) der Marker zueinander. 6° liegt
  // trotzdem weit unter dem Abstand zu tatsächlich falschen Winkeln (in der Praxis eher
  // >20° daneben, siehe Testfälle in tests/auto-route.test.mjs).
  const ANGLE_TOL_DEG = 6;
  const allTurnsClean = (steps) => {
    for (let i = 0; i < steps.length - 1; i++) {
      const deg = THREE.MathUtils.radToDeg(steps[i].dir.angleTo(steps[i + 1].dir));
      if (!CLEAN_ANGLES_DEG.some((c) => Math.abs(deg - c) < ANGLE_TOL_DEG)) return false;
    }
    return true;
  };

  const candidates = [];
  const addCandidate = (steps, label) => {
    if (!steps) return;
    if (!allTurnsClean(steps)) {
      log(`Kandidat "${label}" verworfen: Winkel zwischen zwei Segmenten ist nicht 0/45/90/135/180°`);
      return;
    }
    candidates.push({ total: steps.reduce((s, x) => s + x.len, 0), steps, label });
  };

  // 1 Segment: direkte gerade Verbindung - falls anwendbar immer die global kürzeste
  // Lösung (Luftlinie), da kein Umweg sie unterbieten kann.
  if (deltaDir.dot(DA) > 0.999 && deltaDir.dot(DB) > 0.999) {
    addCandidate([{ dir: DA.clone(), len: delta.length() }], '1 Segment (direkt)');
  }

  const collinear = Math.abs(DA.dot(DB)) > 0.97;

  if (collinear) {
    // Versatz-Fall: Anteil von delta entlang DA ("Vorlauf") und senkrecht dazu
    // ("seitlicher Versatz") trennen. Zwei gleich große 45°-Bögen mit einem geraden
    // Zwischenstück überbrücken den seitlichen Versatz, während vor und nach dem
    // Versatz weiter parallel zu DA verlegt wird (bzw. bei DB≈-DA automatisch auch
    // parallel zu DB). Das ist die "natürliche" 3-Segment-Lösung für diesen mit Abstand
    // häufigsten Praxisfall; wird trotzdem nur als EIN Kandidat neben der allgemeinen
    // Suche unten gewertet, statt sofort zurückgegeben zu werden.
    const along = delta.dot(DA);
    const lateral = delta.clone().sub(DA.clone().multiplyScalar(along));
    const latLen = lateral.length();
    log('Kollinearer Fall: Vorlauf=', along.toFixed(3), 'seitlicher Versatz=', latLen.toFixed(3));

    if (latLen < minSegmentLength && along > 2 * minSegmentLength && deltaDir.dot(DA) > 0.9) {
      addCandidate([{ dir: DA.clone(), len: delta.length() }], 'kaum Versatz (gerade)');
    } else if (latLen >= minSegmentLength) {
      const latDir = lateral.clone().normalize();
      const kinkDir = DA.clone().add(latDir).normalize(); // 45° zwischen DA und Versatzrichtung
      const L2 = latLen / Math.SQRT1_2;             // Bogenlänge, die genau latLen Versatz erzeugt
      const remaining = along - L2 * Math.SQRT1_2;   // Vorlauf abzüglich Versatz-Segment-Anteil
      if (L2 >= minSegmentLength && remaining >= 2 * minSegmentLength) {
        addCandidate([
          { dir: DA.clone(), len: remaining / 2 }, { dir: kinkDir, len: L2 }, { dir: DA.clone(), len: remaining / 2 },
        ], 'Versatz (45°-Jog)');
      }
    }
  } else {
    // Nicht-kollinearer Fall: 2 Segmente (ein Bogen) - nur exakt lösbar, wenn delta in
    // der von DA/DB aufgespannten Ebene liegt (Sonderfall, den die allgemeine Suche
    // unten wegen der dort vorausgesetzten vollen Rang-3-Bedingung nicht abdeckt).
    const n = new THREE.Vector3().crossVectors(DA, DB).normalize();
    if (Math.abs(delta.dot(n)) < unit * 0.01) {
      const uu = DA.dot(DA), uv = DA.dot(DB), vv = DB.dot(DB), ud = DA.dot(delta), vd = DB.dot(delta);
      const det = uu * vv - uv * uv;
      if (Math.abs(det) > 1e-9) {
        const L1 = (ud * vv - vd * uv) / det, L2 = (uu * vd - uv * ud) / det;
        if (L1 >= minSegmentLength && L2 >= minSegmentLength) {
          addCandidate([{ dir: DA.clone(), len: L1 }, { dir: DB.clone(), len: L2 }], '2 Segmente (ein Bogen)');
        }
      }
    }
  }

  // Allgemeine Suche: 1 bis 3 zusätzliche Zwischenrichtungen (3 bis 5 Segmente gesamt)
  // aus einem kombinierten Kandidatenpool (feste Weltrichtungen + relativ zu DA/DB) -
  // deckt strukturell auch den alten "3-Segmente-DA-relativ"-Sonderfall mit ab (der
  // Kandidatenpool enthält dessen 8 Richtungen als Teilmenge), plus komplexere Wege für
  // Fälle, die ein Überschwingen brauchen.
  const pool = buildCandidatePool(DA, DB);
  for (const numMiddle of [1, 2, 3]) {
    const res = searchWithMiddleCount(DA, DB, delta, minSegmentLength, numMiddle, pool);
    if (res) addCandidate(res.steps, `${res.steps.length} Segmente (${numMiddle} Zwischenrichtung(en))`);
  }

  if (!candidates.length) { log('Keine Lösung gefunden.'); return null; }

  // Wichtigstes Kriterium: so WENIGE Segmente (= Winkel/Bögen) wie möglich - eine
  // 5-Segment-Lösung wird nie einer gültigen 3-Segment-Lösung vorgezogen, selbst wenn sie
  // rechnerisch etwas kürzer wäre. Erst bei GLEICHER Segmentanzahl entscheidet die
  // Gesamtlänge (kürzer ist dann besser).
  candidates.sort((a, b) => a.steps.length - b.steps.length || a.total - b.total);
  const best = candidates[0];
  log(
    `Lösung: ${best.label}, ${best.steps.length} Segment(e), Gesamtlänge=`, best.total.toFixed(3),
    `(wenigste Segmente/kürzeste von ${candidates.length} verglichenen Kandidat(en): ` +
    `${candidates.map((c) => `${c.steps.length}×${c.total.toFixed(3)}`).join(', ')})`
  );
  return best.steps;
}

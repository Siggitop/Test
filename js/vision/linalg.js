/**
 * linalg.js
 * ---------
 * Kleine, von Three.js unabhängige Vektor-/Matrix-Hilfsfunktionen für 3er-Vektoren
 * (als einfache [x,y,z]-Arrays) und ein generischer n×n-Gleichungslöser.
 *
 * Bewusst OHNE Abhängigkeit zu Three.js oder dem Browser gehalten: das macht diese
 * Funktionen leicht isoliert mit Node testbar (siehe /tests im Repo-Root) und
 * wiederverwendbar überall dort, wo noch keine Three.js-Vektoren existieren
 * (z.B. bei der Pose-Schätzung direkt aus Bildkoordinaten).
 */

/** Länge (euklidische Norm) eines 3er-Vektors. */
export function norm3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Komponentenweise Summe zweier 3er-Vektoren. */
export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Komponentenweise Differenz zweier 3er-Vektoren (a - b). */
export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Skalierung eines 3er-Vektors mit einem Faktor s. */
export function scl3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Skalarprodukt zweier 3er-Vektoren. */
export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Kreuzprodukt zweier 3er-Vektoren. */
export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Normiert einen 3er-Vektor auf Länge 1 (Nullvektor bleibt unverändert). */
export function normalize3(a) {
  const n = norm3(a) || 1;
  return scl3(a, 1 / n);
}

/** Matrix (3x3, als Array von 3 Zeilen) mal Vektor. */
export function matVec3(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

/**
 * Symmetrische Orthogonalisierung zweier näherungsweise orthogonaler Einheitsvektoren.
 *
 * Hintergrund: Bei der Pose-Schätzung aus einer Homographie (siehe pose-estimation.js)
 * sind die beiden ersten Rotationsspalten r1/r2 durch Mess- und Rundungsfehler nie exakt
 * orthogonal. Der naheliegende Fix ist Gram-Schmidt (r1 bleibt unangetastet, r2 wird
 * orthogonal zu r1 gemacht) - das wälzt aber den GESAMTEN Fehler einseitig auf r2 ab,
 * obwohl r1 und r2 aus derselben Rechnung stammen und gleiches Vertrauen verdienen.
 *
 * Die hier verwendete Lösung ist mathematisch exakt für genau dieses Problem (kleinste
 * gemeinsame Winkeländerung an BEIDEN Vektoren): für zwei Einheitsvektoren a, b sind
 * s=a+b und d=a-b immer exakt orthogonal zueinander (s·d = a·a - b·b = 1 - 1 = 0).
 * Aus s und d normiert lässt sich direkt ein sauberes, symmetrisch korrigiertes Paar
 * bilden.
 *
 * Verifiziert gegen Gram-Schmidt mit einem synthetischen Testfall: die
 * Winkeländerung verteilt sich exakt hälftig auf beide Vektoren statt komplett auf einen.
 *
 * @param {number[]} a Erster (rauschbehafteter) Einheitsvektor
 * @param {number[]} b Zweiter (rauschbehafteter) Einheitsvektor
 * @returns {[number[], number[]]} Orthonormalisiertes Paar [a', b']
 */
export function symmetricOrthogonalize(a, b) {
  const s = normalize3(add3(a, b));
  const d = normalize3(sub3(a, b));
  return [normalize3(add3(s, d)), normalize3(sub3(s, d))];
}

/**
 * Löst das lineare Gleichungssystem A·x = b per Gauß-Elimination mit Spaltenpivotisierung.
 *
 * Wird für zwei unterschiedlich große Systeme verwendet:
 *  - exakt bestimmt (n=8) bei der 4-Punkt-Homographie eines einzelnen Markers
 *  - als Normalgleichungen (ebenfalls n=8, aber aus beliebig vielen Punkten aufsummiert)
 *    bei der Kalibrierblatt-Auswertung mit vielen Markern gleichzeitig
 *
 * @param {number[][]} A n×n-Koeffizientenmatrix (wird nicht verändert, intern kopiert)
 * @param {number[]} b Rechte Seite, Länge n
 * @returns {number[]|null} Lösungsvektor x, oder null bei (numerisch) singulärer Matrix
 */
export function gaussSolve(A, b) {
  const n = A.length;
  // Erweiterte Matrix [A|b] als Arbeitskopie - das Original bleibt unangetastet.
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Spaltenpivotisierung: die betragsmäßig größte verbleibende Zeile nach oben tauschen,
    // das reduziert numerische Rundungsfehler deutlich gegenüber "immer Diagonale nehmen".
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-10) return null; // (numerisch) singulär
    [M[col], M[piv]] = [M[piv], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

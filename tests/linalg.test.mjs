/**
 * linalg.test.mjs
 * -----------------
 * Direkter Node-Test der echten Projektmodule (kein Copy-Paste-Code) - läuft ohne
 * Browser, da linalg.js bewusst keine Three.js-Abhängigkeit hat.
 *
 * Ausführen: node tests/linalg.test.mjs
 */
import { gaussSolve, symmetricOrthogonalize, dot3, normalize3 } from '../js/vision/linalg.js';
import { DICT_6X6_250_CODES } from '../js/vision/dictionary-6x6-250-data.js';

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

// --- gaussSolve: einfaches 3x3-System mit bekannter Lösung -------------------
{
  // 2x + y = 5, x + 3y = 10, x + y + z = 6  ->  x=1, y=3, z=2
  const A = [[2, 1, 0], [1, 3, 0], [1, 1, 1]];
  const b = [5, 10, 6];
  const x = gaussSolve(A, b);
  check('gaussSolve löst 3x3-System korrekt', x && Math.abs(x[0] - 1) < 1e-9 && Math.abs(x[1] - 3) < 1e-9 && Math.abs(x[2] - 2) < 1e-9);
}
{
  // singuläres System -> muss null liefern, nicht abstürzen
  const A = [[1, 2], [2, 4]];
  const x = gaussSolve(A, [1, 2]);
  check('gaussSolve erkennt singuläres System', x === null);
}

// --- symmetricOrthogonalize: Fehler verteilt sich hälftig auf beide Vektoren --
{
  const a = normalize3([1, 0.06, -0.02]);
  const b = normalize3([-0.05, 0.995, 0.03]);
  const [ap, bp] = symmetricOrthogonalize(a, b);
  const dotAfter = dot3(ap, bp);
  const angleA = Math.acos(Math.min(1, dot3(a, ap))) * 180 / Math.PI;
  const angleB = Math.acos(Math.min(1, dot3(b, bp))) * 180 / Math.PI;
  check('symmetricOrthogonalize: Ergebnis ist exakt orthogonal', Math.abs(dotAfter) < 1e-9);
  check('symmetricOrthogonalize: Korrektur verteilt sich fair (±0.01°)', Math.abs(angleA - angleB) < 0.01);
}

// --- Dictionary-Daten: Vollständigkeit + Hamming-Distanz-Kontrolle -----------
{
  check('DICT_6X6_250_CODES hat genau 250 Einträge', DICT_6X6_250_CODES.length === 250);

  function hamming(a, b) {
    let x = a ^ 0, y = b ^ 0; // Platzhalter, echte Berechnung unten (36-Bit, kein Bitwise!)
    return null;
  }
  // 36 Bit übersteigen sichere Bitwise-Operator-Grenzen -> Hamming-Distanz über
  // Ganzzahl-Division/Modulo statt XOR+popcount berechnen.
  function bits(v) {
    const out = [];
    let r = v;
    for (let i = 0; i < 36; i++) { out.push(r % 2); r = Math.floor(r / 2); }
    return out;
  }
  function hammingDist(a, b) {
    const ba = bits(a), bb = bits(b);
    let d = 0;
    for (let i = 0; i < 36; i++) if (ba[i] !== bb[i]) d++;
    return d;
  }
  let minDist = Infinity;
  for (let i = 0; i < DICT_6X6_250_CODES.length; i++) {
    for (let j = i + 1; j < DICT_6X6_250_CODES.length; j++) {
      const d = hammingDist(DICT_6X6_250_CODES[i], DICT_6X6_250_CODES[j]);
      if (d < minDist) minDist = d;
    }
  }
  check('minimale Hamming-Distanz der 250 Codes ist exakt 11 (= OpenCVs dokumentierter Wert für DICT_6X6_250)', minDist === 11);
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

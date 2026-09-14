/**
 * linalg.test.mjs
 * -----------------
 * Direkter Node-Test der echten Projektmodule (kein Copy-Paste-Code) - läuft ohne
 * Browser, da linalg.js bewusst keine Three.js-Abhängigkeit hat.
 *
 * Ausführen: node tests/linalg.test.mjs
 */
import { gaussSolve, symmetricOrthogonalize, dot3, normalize3 } from '../js/vision/linalg.js';

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

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

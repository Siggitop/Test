/**
 * npz-loader.test.mjs
 * ----------------------
 * Testet js/calibration/npz-loader.js gegen zwei mit echtem numpy erzeugte .npz-Dateien
 * (siehe tests/fixtures/) - einmal unkomprimiert (np.savez), einmal deflate-komprimiert
 * (np.savez_compressed), da .npz-Dateien beide Varianten enthalten können.
 *
 * Braucht `fflate` aus node_modules (siehe package.json) - in der App selbst kommt
 * fflate über die Importmap in index.html von einem CDN, hier lokal installiert nur zum
 * Testen des echten npz-loader.js-Moduls unter Node.
 *
 * Ausführen: node tests/npz-loader.test.mjs  (oder: npm test)
 */
import { readFile } from 'node:fs/promises';
import { loadCalibrationNpz } from '../js/calibration/npz-loader.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

// loadCalibrationNpz erwartet ein File-ähnliches Objekt mit .arrayBuffer() - im Browser
// ist das ein echtes File aus <input type="file">, hier eine minimale Nachbildung um
// eine lokale Testdatei einzulesen.
async function fakeFileFor(path) {
  const buf = await readFile(path);
  return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

const EXPECTED = { fx: 1234.5, fy: 1230.1, cx: 960, cy: 540, dist: [0.12, -0.05, 0.001, -0.0004, 0.003] };

for (const [label, path] of [
  ['unkomprimiert (np.savez)', 'tests/fixtures/test_calib_stored.npz'],
  ['deflate-komprimiert (np.savez_compressed)', 'tests/fixtures/test_calib_compressed.npz'],
]) {
  const result = await loadCalibrationNpz(await fakeFileFor(path));
  check(`${label}: fx/fy/cx/cy korrekt`,
    Math.abs(result.fx - EXPECTED.fx) < 1e-9 &&
    Math.abs(result.fy - EXPECTED.fy) < 1e-9 &&
    Math.abs(result.cx - EXPECTED.cx) < 1e-9 &&
    Math.abs(result.cy - EXPECTED.cy) < 1e-9,
    `fx=${result.fx} fy=${result.fy} cx=${result.cx} cy=${result.cy}`);
  check(`${label}: dist-Koeffizienten korrekt`,
    EXPECTED.dist.every((v, i) => Math.abs(v - result.dist[i]) < 1e-9));
  check(`${label}: hasDist=true`, result.hasDist === true);
}

// Fehlerfall: Datei ohne K.npy -> verständliche Fehlermeldung, kein Absturz
{
  try {
    // Eine leere ZIP-ähnliche Struktur reicht hier nicht - stattdessen eine .npz ohne
    // "K"-Array simulieren, indem die dist-Datei als "K.npy" fehlt (wir nutzen die echte
    // Testdatei, entfernen aber gedanklich nichts - stattdessen einfach eine offensichtlich
    // kaputte Datei testen).
    const brokenFile = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    await loadCalibrationNpz(brokenFile);
    check('kaputte Datei wirft einen Fehler statt abzustürzen', false);
  } catch (err) {
    check('kaputte Datei wirft einen Fehler statt abzustürzen', true, err.message);
  }
}

console.log(failures === 0 ? '\nAlle Tests bestanden.' : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

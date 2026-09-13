/**
 * calibration-sheet.js
 * ----------------------
 * Alternative zur .npz-Datei: ein eigenes, in der App generierbares und ausdruckbares
 * Kalibrierblatt (Raster aus denselben ArUco-Markern, die die App ohnehin erkennt), aus
 * dessen Foto sich die Brennweite der Kamera schätzen lässt.
 *
 * WARUM KEIN ECHTES OPENCV-CHARUCO-BOARD: Ein "echtes" ChArUco-Board hat ein von OpenCV
 * genau festgelegtes, aber nicht ganz triviales Layout (welche Marker-ID an welcher
 * Schachbrett-Position sitzt). Das ohne Zugriff auf echte Hardware zum Testen exakt
 * nachzubilden, wäre ein Risiko - ein falsch geratenes Layout würde still und leise
 * falsche Kalibrierwerte liefern. Stattdessen: ein eigenes, einfaches Raster mit fest
 * selbst definiertem Layout (Marker-ID = Zeile*Spalten+Spalte), das exakt zu dem
 * Detector passt, der in dieser App bereits läuft und gegen echte numpy-Dateien getestet
 * wurde.
 *
 * METHODE: Fluchtpunkt-Kalibrierung nach Caprile & Torre (1990). Das Kalibrierblatt ist
 * eine flache Ebene mit zwei zueinander senkrechten Rasterrichtungen (Zeilen/Spalten).
 * Aus EINER GEMEINSAMEN, über alle erkannten Markerecken gemittelten Homographie (siehe
 * fitHomographyLS) lassen sich die Fluchtpunkte beider Rasterrichtungen ablesen: die
 * ersten beiden Spalten der Homographie SIND (als homogene Punkte) exakt die Fluchtpunkte
 * der Welt-X- bzw. Welt-Y-Richtung. Für zwei zueinander senkrechte Weltrichtungen gilt
 * dann (bei Skew=0, quadratischen Pixeln, angenommenem Hauptpunkt in der Bildmitte):
 *
 *     (vp1 - Hauptpunkt) · (vp2 - Hauptpunkt) = -f²
 *
 * Liefert also fx=fy=f und cx/cy (als Bildmitte angenommen) - bewusst OHNE
 * Verzeichnungsschätzung (dafür bräuchte es mehrere Ansichten und eine nichtlineare
 * Ausgleichsrechnung). Gegen eine synthetische Ground Truth getestet (siehe /tests):
 * exakte Übereinstimmung bis auf Fließkommagenauigkeit.
 */

import { gaussSolve } from '../vision/linalg.js';
import { getMarkerBits } from '../vision/aruco-setup.js';

export const CHARUCO_COLS = 4;
export const CHARUCO_ROWS = 3;
export const CHARUCO_COUNT = CHARUCO_COLS * CHARUCO_ROWS; // Marker-IDs 0..11

/** Zeichnet einen einzelnen ArUco-Marker (schwarzer Rand + 6x6-Codefeld) auf ein Canvas. */
function drawArucoMarkerCell(ctx, x, y, size, id) {
  const bits = getMarkerBits(id);
  const cell = size / 8; // 6x6 Code + 1 Zelle schwarzer Rand rundum = 8x8 Raster
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#fff';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      if (bits[r * 6 + c] === 1) ctx.fillRect(x + (c + 1) * cell, y + (r + 1) * cell, cell, cell);
    }
  }
}

/**
 * Erzeugt das Kalibrierblatt als PNG und stößt den Download an.
 *
 * Hinweis zur Größe: die "mm"-Angabe ist rein informativ für den Ausdruck - das PNG wird
 * mit einer festen Bildschirm-Pixeldichte gezeichnet, OHNE Annahme über die tatsächliche
 * Drucker-DPI. Nach dem Ausdrucken deshalb unbedingt eine Markerkante mit dem Lineal
 * nachmessen und den echten Wert eintragen, statt der Druckskalierung zu vertrauen.
 *
 * @param {number} squareMm gewünschte Markerkante in mm (nur für die Beschriftung/als
 *   Ausgangswert - maßgeblich ist das Nachmessen nach dem Drucken)
 */
export function generateCalibrationSheet(squareMm) {
  const pxPerMm = 6; // reine Bildschirmauflösung des PNGs, keine Druck-DPI-Annahme
  const marginMm = squareMm * 0.6, spacingMm = squareMm * 1.6;
  const sizePx = squareMm * pxPerMm;
  const spacingPx = spacingMm * pxPerMm, marginPx = marginMm * pxPerMm;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(marginPx * 2 + (CHARUCO_COLS - 1) * spacingPx + sizePx);
  canvas.height = Math.round(marginPx * 2 + (CHARUCO_ROWS - 1) * spacingPx + sizePx + 60);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < CHARUCO_ROWS; row++) {
    for (let col = 0; col < CHARUCO_COLS; col++) {
      const id = row * CHARUCO_COLS + col;
      const x = marginPx + col * spacingPx, y = marginPx + row * spacingPx;
      drawArucoMarkerCell(ctx, x, y, sizePx, id);
    }
  }
  ctx.fillStyle = '#000';
  ctx.font = '16px sans-serif';
  ctx.fillText(
    `Kalibrierblatt · Markergröße ${squareMm}mm · in Originalgröße (100%) drucken, dann NACHMESSEN`,
    marginPx, canvas.height - 25
  );

  const a = document.createElement('a');
  a.download = 'kalibrierblatt.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

/**
 * Least-Squares-Homographie über beliebig viele Punktkorrespondenzen (Normalgleichungen
 * ATA·x=ATb für die 8 Unbekannten, h33=1 fixiert).
 *
 * Robuster als die exakte 4-Punkt-Lösung (siehe vision/pose-estimation.js), weil sich
 * Eckenrauschen über viele Marker gleichzeitig mittelt, statt auf nur 4 Punkte
 * konzentriert zu sein - genau das macht ein ganzes Kalibrierblatt gegenüber einem
 * einzelnen Marker wertvoll.
 *
 * @param {number[][]} objPts Weltpunkte [X,Y] (Meter, Z=0)
 * @param {number[][]} imgPts zugehörige Bildpunkte [u,v] (Pixel)
 * @returns {number[][]|null} 3x3-Homographie
 */
function fitHomographyLS(objPts, imgPts) {
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const ATb = new Array(8).fill(0);
  for (let i = 0; i < objPts.length; i++) {
    const [X, Y] = objPts[i], [u, v] = imgPts[i];
    const rows = [
      [[X, Y, 1, 0, 0, 0, -X * u, -Y * u], u],
      [[0, 0, 0, X, Y, 1, -X * v, -Y * v], v],
    ];
    rows.forEach(([row, rhs]) => {
      for (let a = 0; a < 8; a++) {
        for (let b = 0; b < 8; b++) ATA[a][b] += row[a] * row[b];
        ATb[a] += row[a] * rhs;
      }
    });
  }
  const h = gaussSolve(ATA, ATb);
  return h ? [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]] : null;
}

/**
 * Schätzt die Brennweite f (fx=fy) aus vielen koplanaren Punktkorrespondenzen, siehe
 * Datei-Kommentar oben für die verwendete Formel (Caprile & Torre 1990).
 *
 * @param {number[][]} objPts Weltpunkte [X,Y] auf dem Kalibrierblatt (Meter)
 * @param {number[][]} imgPts zugehörige Bildpunkte [u,v] (Pixel)
 * @param {number} cx,cy angenommener Hauptpunkt (üblicherweise die Bildmitte)
 * @returns {number|null} geschätzte Brennweite in Pixeln, oder null wenn geometrisch
 *   nicht bestimmbar (z.B. Blatt zu exakt frontal fotografiert - Fluchtpunkte im
 *   Unendlichen bzw. das Skalarprodukt wird nicht negativ)
 */
function estimateFocalFromGrid(objPts, imgPts, cx, cy) {
  const H = fitHomographyLS(objPts, imgPts);
  if (!H) return null;
  const h1 = [H[0][0], H[1][0], H[2][0]];
  const h2 = [H[0][1], H[1][1], H[2][1]];
  if (Math.abs(h1[2]) < 1e-9 || Math.abs(h2[2]) < 1e-9) return null; // Fluchtpunkt im Unendlichen
  const vp1 = { x: h1[0] / h1[2], y: h1[1] / h1[2] };
  const vp2 = { x: h2[0] / h2[2], y: h2[1] / h2[2] };
  const dotv = (vp1.x - cx) * (vp2.x - cx) + (vp1.y - cy) * (vp2.y - cy);
  return dotv < 0 ? Math.sqrt(-dotv) : null;
}

/**
 * Wertet ein Foto des Kalibrierblatts aus: erkennt die Marker darauf, baut daraus viele
 * Punktkorrespondenzen (4 Ecken je erkanntem Marker gegen die bekannte Rasterposition)
 * und schätzt daraus die Brennweite.
 *
 * @param {HTMLCanvasElement} canvas Foto des ausgedruckten Blatts
 * @param {number} squareMm tatsächliche (nachgemessene!) Markerkante in mm
 * @param {(canvas:HTMLCanvasElement)=>Array} runDetectionFn Markererkennung, siehe vision/detection.js
 * @returns {{f:number, cx:number, cy:number, markerCount:number}}
 * @throws {Error} mit einer für den Nutzer verständlichen deutschen Fehlermeldung
 */
export function evaluateCalibrationPhoto(canvas, squareMm, runDetectionFn) {
  const found = runDetectionFn(canvas);
  const onBoard = found.filter((m) => m.id >= 0 && m.id < CHARUCO_COUNT);
  if (onBoard.length < 4) {
    throw new Error(
      `Nur ${onBoard.length} Markerfelder erkannt (mind. 4 nötig). Blatt flach, gut ` +
      'beleuchtet und möglichst frontal fotografieren.'
    );
  }

  const squareM = squareMm / 1000, spacing = squareM * 1.6, hh = squareM / 2;
  const objPts = [], imgPts = [];
  onBoard.forEach((m) => {
    const col = m.id % CHARUCO_COLS, row = Math.floor(m.id / CHARUCO_COLS);
    const wx = col * spacing, wy = -row * spacing;
    const world = [[wx - hh, wy + hh], [wx + hh, wy + hh], [wx + hh, wy - hh], [wx - hh, wy - hh]];
    world.forEach((w, i) => { objPts.push(w); imgPts.push([m.corners[i].x, m.corners[i].y]); });
  });

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const f = estimateFocalFromGrid(objPts, imgPts, cx, cy);
  if (!f || !isFinite(f)) {
    throw new Error(
      'Konnte keine Brennweite bestimmen (Blatt zu frontal/planar im Bild - leicht ' +
      'schräger fotografieren und erneut versuchen).'
    );
  }

  return { f, cx, cy, markerCount: onBoard.length };
}

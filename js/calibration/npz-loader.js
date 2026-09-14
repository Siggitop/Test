/**
 * npz-loader.js
 * -------------
 * Liest eine numpy .npz-Datei (wie sie das ursprüngliche Python-Kalibrierungsskript via
 * `np.savez("camera_calib.npz", K=K, dist=dist)` erzeugt) direkt im Browser ein - ganz
 * ohne Server, ohne Python.
 *
 * Eine .npz-Datei ist technisch einfach ein ZIP-Archiv, in dem jedes gespeicherte Array
 * als eigene .npy-Datei liegt (hier erwartet: "K.npy" und "dist.npy" - exakt die Namen,
 * unter denen das Python-Skript sie über calib["K"] / calib["dist"] anspricht).
 *
 * Für das ZIP-Entpacken wird die kleine, gut etablierte Bibliothek fflate verwendet
 * (unterstützt sowohl unkomprimierte als auch deflate-komprimierte Einträge, also sowohl
 * np.savez als auch np.savez_compressed).
 *
 * Der .npy-Parser selbst ist reines, abhängigkeitsfreies JavaScript und wurde gegen
 * echte, mit numpy erzeugte Testdateien verifiziert (siehe /tests).
 */

import { unzipSync } from 'fflate';

/**
 * Parst den Inhalt einer einzelnen .npy-Datei.
 *
 * Format (siehe numpy-Dokumentation "npy format"): 6 Byte Magic "\x93NUMPY", 1 Byte
 * Major-, 1 Byte Minor-Version, dann (je nach Version) ein 2- oder 4-Byte-Längenfeld für
 * einen ASCII-kodierten Python-Dict-Header (u.a. dtype, shape), gefolgt von den rohen,
 * little-endian gepackten Daten.
 *
 * @param {ArrayBuffer} buffer Inhalt einer .npy-Datei
 * @returns {{shape:number[], data:Float64Array}}
 */
export function parseNpy(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 6));
  if (magic !== '\x93NUMPY') throw new Error('keine gültige .npy-Datei (falsches Magic-Byte)');

  const major = view.getUint8(6);
  let headerLen, headerStart;
  if (major === 1) { headerLen = view.getUint16(8, true); headerStart = 10; }
  else { headerLen = view.getUint32(8, true); headerStart = 12; }

  const headerStr = new TextDecoder('ascii').decode(new Uint8Array(buffer, headerStart, headerLen));
  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  if (!descrMatch || !shapeMatch) throw new Error('.npy-Header nicht lesbar: ' + headerStr);

  const descr = descrMatch[1];
  const shape = shapeMatch[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const dataStart = headerStart + headerLen;
  const littleEndian = descr[0] !== '>'; // '<' oder '=' -> little-endian (Browser sind das ohnehin)
  const type = descr.slice(1);
  const n = shape.length ? shape.reduce((a, b) => a * b, 1) : 1;

  let bytesPerEl, getter;
  if (type === 'f8') { bytesPerEl = 8; getter = (o) => view.getFloat64(o, littleEndian); }
  else if (type === 'f4') { bytesPerEl = 4; getter = (o) => view.getFloat32(o, littleEndian); }
  else if (type === 'i8') { bytesPerEl = 8; getter = (o) => Number(view.getBigInt64(o, littleEndian)); }
  else if (type === 'i4') { bytesPerEl = 4; getter = (o) => view.getInt32(o, littleEndian); }
  else throw new Error('nicht unterstützter numpy-dtype: ' + descr);

  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = getter(dataStart + i * bytesPerEl);
  return { shape, data };
}

/** Node-Buffer/Uint8Array -> exaktes ArrayBuffer-Slice (ohne evtl. Pool-Offset). */
function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * Lädt eine camera_calib.npz-Datei und extrahiert Kamera-Matrix + Verzeichnung.
 *
 * @param {File|Blob} file vom <input type="file"> Element (oder ein per fetch() geladener
 *   Blob für eine mitgelieferte Standard-Kalibrierung - beide haben .arrayBuffer())
 * @returns {Promise<{fx:number,fy:number,cx:number,cy:number,dist:number[],hasDist:boolean,
 *   imageWidth?:number,imageHeight?:number}>} imageWidth/imageHeight sind nur gesetzt, wenn
 *   das Kalibrierskript sie mitgespeichert hat (np.savez(..., image_width=w, image_height=h))
 *   - sie erlauben es, fx/fy/cx/cy beim Einsatz an eine abweichende Kamera-Stream-Auflösung
 *   anzupassen (siehe capture-controller.js).
 * @throws {Error} mit einer für den Nutzer verständlichen deutschen Fehlermeldung
 */
export async function loadCalibrationNpz(file) {
  const buf = await file.arrayBuffer();
  const zip = unzipSync(new Uint8Array(buf));

  const kEntry = Object.keys(zip).find((n) => /(^|\/)K\.npy$/i.test(n));
  const distEntry = Object.keys(zip).find((n) => /(^|\/)dist\.npy$/i.test(n));
  const widthEntry = Object.keys(zip).find((n) => /(^|\/)image_width\.npy$/i.test(n));
  const heightEntry = Object.keys(zip).find((n) => /(^|\/)image_height\.npy$/i.test(n));
  if (!kEntry) {
    throw new Error(`kein "K.npy" im Archiv gefunden (enthalten: ${Object.keys(zip).join(', ')})`);
  }

  const kParsed = parseNpy(toArrayBuffer(zip[kEntry]));
  if (kParsed.data.length < 9) throw new Error('K hat nicht die erwarteten 3×3=9 Werte');
  // Zeilen-major 3x3: [fx,0,cx, 0,fy,cy, 0,0,1]
  const [fx, , cx, , fy, cy] = kParsed.data;

  let dist = [0, 0, 0, 0, 0];
  let hasDist = false;
  if (distEntry) {
    const dParsed = parseNpy(toArrayBuffer(zip[distEntry]));
    dist = Array.from(dParsed.data.slice(0, 5));
    while (dist.length < 5) dist.push(0);
    hasDist = true;
  }

  let imageWidth, imageHeight;
  if (widthEntry) imageWidth = parseNpy(toArrayBuffer(zip[widthEntry])).data[0];
  if (heightEntry) imageHeight = parseNpy(toArrayBuffer(zip[heightEntry])).data[0];

  return { fx, fy, cx, cy, dist, hasDist, imageWidth, imageHeight };
}

/**
 * aruco-setup.js
 * --------------
 * Registriert das echte OpenCV-Dictionary DICT_6X6_250 (siehe dictionary-6x6-250-data.js
 * für die Herkunft der Zahlen und wichtige Vorbehalte) bei der js-aruco2-Bibliothek und
 * stellt Bit-Hilfsfunktionen bereit, die sowohl die Markererkennung (detection.js) als
 * auch die Kalibrierblatt-Generierung (calibration/calibration-sheet.js) brauchen.
 *
 * Voraussetzung: cv.js und aruco.js von js-aruco2 müssen VOR diesem Modul als klassische
 * <script>-Tags (kein type="module") geladen sein, damit das globale `AR`-Objekt
 * existiert. Siehe die Kommentare dazu in index.html.
 */

export const DICTIONARY_NAME = 'DICT_6X6_250';

/**
 * Registriert das Dictionary global bei js-aruco2. Muss genau einmal vor der ersten
 * Markererkennung aufgerufen werden (siehe main.js).
 */
export function registerDictionary(codeList) {
  if (typeof AR === 'undefined') {
    throw new Error(
      'Das globale AR-Objekt (js-aruco2) existiert nicht. cv.js und aruco.js müssen als ' +
      'klassische <script>-Tags VOR diesem Modul geladen werden.'
    );
  }
  AR.DICTIONARIES[DICTIONARY_NAME] = {
    nBits: 36,
    tau: 11, // reale minimale Hamming-Distanz der 250 Codes, siehe dictionary-6x6-250-data.js
    codeList,
  };
}

/**
 * Entpackt einen 36-Bit-Code (als normale JS-Zahl, siehe Hinweis unten) in ein Array aus
 * 36 Bits, zeilenweise über das 6x6-Raster, MSB zuerst - exakt die Konvention, die auch
 * OpenCV beim Erzeugen der codeList-Werte verwendet hat (siehe dictionary-6x6-250-data.js).
 *
 * WICHTIG: 36 Bit übersteigen den sicheren Bereich von JavaScripts Bitweise-Operatoren
 * (>>, &, <<  rechnen intern mit 32-Bit-Integern und würden den Wert stillschweigend
 * korrumpieren!). Deshalb hier bewusst nur Ganzzahl-Division/Modulo verwendet - das ist
 * für Zahlen bis 2^53 exakt, da JS-Zahlen intern als Double mit 53-Bit-Mantisse
 * gespeichert werden.
 *
 * @param {number} codeVal 36-Bit-Code als normale Zahl
 * @returns {number[]} 36 Bits (0 oder 1), Index 0 = MSB = Zelle oben-links im Raster
 */
export function codeToBits36(codeVal) {
  const bits = new Array(36);
  let remaining = codeVal;
  for (let i = 35; i >= 0; i--) {
    bits[i] = remaining % 2;
    remaining = Math.floor(remaining / 2);
  }
  return bits;
}

/**
 * Liefert das 6x6-Bit-Muster eines Markers aus dem registrierten Dictionary - wird zum
 * Zeichnen des Kalibrierblatts gebraucht (siehe calibration/calibration-sheet.js).
 *
 * @param {number} id Marker-ID (0..249)
 * @returns {number[]} 36 Bits, siehe codeToBits36()
 */
export function getMarkerBits(id) {
  const code = AR.DICTIONARIES[DICTIONARY_NAME].codeList[id];
  return codeToBits36(code);
}

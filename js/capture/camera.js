/**
 * camera.js
 * ---------
 * Startet die Rückkamera des Geräts und liefert eine grobe Standard-Schätzung der
 * Kamera-Matrix K, solange keine echte Kalibrierung vorliegt.
 */

/**
 * Startet die Kamera (Rückkamera bevorzugt) und hängt den Stream an das <video>-Element.
 *
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<MediaStream>}
 * @throws {Error} wenn getUserMedia fehlschlägt (z.B. kein HTTPS/localhost, keine
 *   Berechtigung, keine Kamera vorhanden) - der Aufrufer zeigt die Fehlermeldung an.
 */
export async function startCamera(videoEl) {
  // width/height sind nur "ideal" (unverbindliche Wünsche, kein Fehlschlag bei
  // Nichterreichen) - hier bewusst hoch angesetzt (deutlich über 1920x1080), damit der
  // Browser die höchste vom Gerät gebotene Stream-Auflösung liefert, statt sich an einer
  // konservativen Vorgabe zu orientieren. Grund: eine niedrige Stream-Auflösung
  // (z.B. 1080x1920) weicht im Seitenverhältnis/Auflösung typischerweise deutlich von
  // separat aufgenommenen, hochauflösenden Kalibrierfotos (z.B. 3024x4032) ab - das
  // erzwingt bei npz-loader.js/applyCalibration() eine ungenaue Umrechnung und damit einen
  // systematischen Tiefenfehler. Eine höhere Stream-Auflösung reduziert diesen Abstand
  // (und verbessert nebenbei die Eckenerkennung selbst). Die Browser-Orientierung
  // (Hoch-/Querformat) übernimmt der Browser automatisch passend zum Gerät - welche Zahl
  // hier "width" heißt, spielt dafür keine Rolle.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  // Kontinuierlichen Autofokus explizit anfordern, falls Gerät/Browser das unterstützt
  // (kein Teil der ursprünglichen getUserMedia-Constraints oben, sonst bricht die ganze
  // Anfrage auf Geräten ohne Unterstützung mit OverconstrainedError ab - deshalb per
  // Capability-Check + separatem applyConstraints() danach, und defensiv mit try/catch).
  // Ohne das kann die Kamera je nach Gerät/Standardeinstellung beim Nahbereich-Fotografieren
  // der Marker unscharf bleiben (z.B. wenn der Video-Modus auf Fixfokus/Unendlich steht).
  const [track] = stream.getVideoTracks();
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (err) {
      console.warn('Kontinuierlicher Autofokus konnte nicht aktiviert werden:', err);
    }
  }

  return stream;
}

/**
 * Grobe Schätzung der Kamera-Matrix K ohne echte Kalibrierung: fx≈fy≈Bildbreite ist eine
 * verbreitete Faustregel für Smartphone-Rückkameras (~55-65° horizontales Sichtfeld).
 * Für genaue Ergebnisse: echte Kalibrierung über eine der drei Optionen im
 * Kalibrierungs-Feld (siehe js/calibration/).
 *
 * @param {number} w,h Bildbreite/-höhe in Pixeln
 * @returns {{fx:number,fy:number,cx:number,cy:number}}
 */
export function estimateK(w, h) {
  return { fx: w, fy: w, cx: w / 2, cy: h / 2 };
}

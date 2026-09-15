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
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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

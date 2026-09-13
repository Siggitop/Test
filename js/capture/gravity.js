/**
 * gravity.js
 * ----------
 * Liest den Beschleunigungssensor des Geräts aus und liefert die "Unten"-Richtung im
 * Kamerakoordinatensystem (OpenCV-Konvention: X rechts, Y runter, Z von der Kamera weg
 * in die Szene), damit die 3D-Ansicht später die reale horizontale Ebene kennt statt sie
 * nur aus der (nicht immer zutreffenden) Annahme "beide Marker liegen auf derselben
 * Fläche" zu erraten.
 *
 * ANNAHME (Handy in normaler Fotohaltung, Rückkamera, Hochformat, oben=oben):
 *   Geräte-X (Bildschirm nach rechts)  ≈ Kamera-X (Bild nach rechts)
 *   Geräte-Y (Bildschirm nach oben)    ≈ -Kamera-Y (Kamera-Y zeigt nach unten)
 *   Geräte-Z (aus dem Screen heraus)   ≈ -Kamera-Z (Kamera blickt in die Szene)
 * accelerationIncludingGravity zeigt bei ruhendem Gerät ungefähr nach OBEN (Gegenkraft
 * zur Erdanziehung) - "unten" ist daher die negierte, normierte Richtung.
 * Falls diese Zuordnung auf einem konkreten Gerät nicht passt (z.B. Querformat, andere
 * Sensor-Konvention des Browsers): einfach die Vorzeichen in deviceAccelToCameraFrame()
 * tauschen - das ist die einzige Stelle, an der diese Annahme steckt.
 */

function deviceAccelToCameraFrame(a) {
  return { x: a.x, y: -a.y, z: -a.z };
}

export class GravitySensor {
  /**
   * @param {HTMLElement} readoutEl Element, in dem der aktuelle Status als Text angezeigt wird
   * @param {HTMLElement} gestureTargetEl Element, dessen erster Tap/Klick als Nutzer-Geste
   *   für die iOS-Berechtigungsanfrage verwendet wird
   */
  constructor(readoutEl, gestureTargetEl) {
    this.readoutEl = readoutEl;
    this.gestureTargetEl = gestureTargetEl;
    this.lastAccel = null;
    this.listenerAttached = false;

    // Auf iOS braucht DeviceMotionEvent.requestPermission() zwingend eine ECHTE
    // Nutzer-Geste im selben Ereignis - ein sofortiger Aufruf beim Laden der Seite (ohne
    // Geste) schlägt dort garantiert fehl und würde fälschlich "nicht verfügbar" anzeigen,
    // bevor man überhaupt die Chance hatte anzutippen. Deshalb: auf Browsern mit dieser
    // API erst auf den ersten Tap warten; auf Android/Desktop (keine solche API) sofort
    // versuchen.
    if (typeof DeviceMotionEvent === 'undefined' || typeof DeviceMotionEvent.requestPermission !== 'function') {
      this.requestPermissionAndStart();
    } else {
      this._setText('Schwerkraft-Sensor: Bildschirm antippen zum Aktivieren');
      gestureTargetEl.addEventListener('pointerdown', () => this.requestPermissionAndStart(), { once: true });
    }
  }

  _setText(text) { this.readoutEl.textContent = text; }
  _setHtml(html) { this.readoutEl.innerHTML = html; }

  /** Fordert (falls nötig) die iOS-Berechtigung an und startet danach den Listener. */
  async requestPermissionAndStart() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          this._setText('Schwerkraft-Sensor: Zugriff verweigert (iOS-Einstellungen → Safari → Bewegung & Ausrichtung erlauben, dann Seite neu laden)');
          return;
        }
      } catch (e) {
        this._setHtml('Schwerkraft-Sensor: Anfrage fehlgeschlagen <button id="retryMotionBtn" style="margin-left:6px;padding:3px 8px;font-size:11px;border-radius:6px">erneut versuchen</button>');
        const btn = document.getElementById('retryMotionBtn');
        if (btn) btn.onclick = () => this.requestPermissionAndStart();
        return;
      }
    }
    this._attachListener();
  }

  _attachListener() {
    if (this.listenerAttached) return;
    this.listenerAttached = true;
    window.addEventListener('devicemotion', (e) => {
      if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) {
        this.lastAccel = e.accelerationIncludingGravity;
        const d = this.currentGravityDown();
        if (d) this._setText(`Schwerkraft ok · unten ≈ (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`);
      }
    });
    this._setText('Schwerkraft-Sensor: warte auf Bewegungsdaten – Handy kurz ruhig halten …');

    // Kommt nach ein paar Sekunden immer noch kein einziger Wert an (Desktop-Browser ohne
    // Sensor, Berechtigung im Hintergrund verweigert, kein HTTPS o.ä.), ehrlich anzeigen
    // statt dauerhaft "warte..." stehen zu lassen - inkl. Retry-Knopf.
    setTimeout(() => {
      if (!this.lastAccel) {
        this._setHtml('Schwerkraft-Sensor: keine Daten empfangen <button id="retryMotionBtn2" style="margin-left:6px;padding:3px 8px;font-size:11px;border-radius:6px">erneut versuchen</button>');
        const btn = document.getElementById('retryMotionBtn2');
        if (btn) btn.onclick = () => { this.listenerAttached = false; this.requestPermissionAndStart(); };
      }
    }, 3000);
  }

  /**
   * Liefert die aktuelle "Unten"-Richtung im Kamerakoordinatensystem, oder null solange
   * noch keine Sensordaten eingetroffen sind.
   * @returns {{x:number,y:number,z:number}|null} normierter Vektor
   */
  currentGravityDown() {
    if (!this.lastAccel) return null;
    const c = deviceAccelToCameraFrame(this.lastAccel);
    const len = Math.hypot(c.x, c.y, c.z);
    if (len < 1e-6) return null;
    return { x: -c.x / len, y: -c.y / len, z: -c.z / len };
  }
}

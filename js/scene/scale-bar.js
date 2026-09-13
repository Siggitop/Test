/**
 * scale-bar.js
 * ------------
 * Kleiner Maßstabsbalken (wie auf einer Landkarte), der sich live an den aktuellen
 * Kamera-Zoom anpasst - hilft beim Einschätzen realer Rohrlängen in der 3D-Ansicht.
 */

/** Rundet einen rohen Weltlängen-Wert auf eine "schöne" Zahl (1/2/5 × 10^n). */
function niceScale(raw) {
  const exp = Math.floor(Math.log10(raw));
  const base = raw / Math.pow(10, exp);
  let niceBase;
  if (base < 1.5) niceBase = 1;
  else if (base < 3.5) niceBase = 2;
  else if (base < 7.5) niceBase = 5;
  else niceBase = 10;
  return niceBase * Math.pow(10, exp);
}

/** Formatiert eine Weltlänge (Meter) als cm oder m, je nach Größenordnung. */
function formatLength(m) {
  if (m < 1) return (m * 100).toFixed(m < 0.1 ? 1 : 0) + ' cm';
  return m.toFixed(m < 10 ? 2 : 1) + ' m';
}

export class ScaleBar {
  constructor() {
    this.fillEl = document.getElementById('scalebar-fill');
    this.labelEl = document.getElementById('scalebar-label');
  }

  /** Einmal pro Frame aufrufen, nachdem sich die Kamera bewegt haben könnte. */
  update(camera, controls, renderer) {
    const dist = camera.position.distanceTo(controls.target);
    const vFovRad = (camera.fov * Math.PI) / 180;
    const worldHeight = 2 * dist * Math.tan(vFovRad / 2);
    const h = renderer.domElement.clientHeight || 1;
    const worldPerPixel = worldHeight / h;

    const targetPx = 90;
    const rawWorld = targetPx * worldPerPixel;
    const niceWorld = niceScale(rawWorld);
    const px = niceWorld / worldPerPixel;

    this.fillEl.style.width = Math.max(px, 2) + 'px';
    this.labelEl.textContent = formatLength(niceWorld);
  }
}

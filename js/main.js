/**
 * main.js
 * -------
 * Einstiegspunkt der App (wird von index.html als `<script type="module">` geladen).
 *
 * Aufgabe: auf die (asynchrone) opencv.js-Initialisierung warten, den Aufnahme-Flow
 * starten und - sobald echte oder Demo-Markerdaten vorliegen - die 3D-Ansicht
 * (PipeRoutingApp) starten. Enthält bewusst keine eigene Logik, nur die Verdrahtung der
 * Module.
 */

import { cvReady } from './vision/opencv-ready.js';
import { initCaptureFlow } from './capture/capture-controller.js';
import { PipeRoutingApp } from './scene/PipeRoutingApp.js';

const appContainer = document.getElementById('app');

// initCaptureFlow() startet u.a. die Kamera - die Markererkennung selbst (Shutter/
// Kalibrierblatt) braucht cv erst beim tatsächlichen Auslösen, aber wir warten hier
// bewusst zentral einmal ab, statt an jeder Aufrufstelle einzeln zu prüfen.
cvReady.then(() => {
  initCaptureFlow((markerData) => {
    // eslint-disable-next-line no-new -- die App verdrahtet sich selbst über DOM-Events,
    // eine Referenz wird hier nicht gebraucht.
    new PipeRoutingApp(appContainer, markerData);
  });
});

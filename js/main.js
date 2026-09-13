/**
 * main.js
 * -------
 * Einstiegspunkt der App (wird von index.html als `<script type="module">` geladen).
 *
 * Aufgabe: das ArUco-Dictionary registrieren, den Aufnahme-Flow starten und - sobald
 * echte oder Demo-Markerdaten vorliegen - die 3D-Ansicht (PipeRoutingApp) starten.
 * Enthält bewusst keine eigene Logik, nur die Verdrahtung der Module.
 */

import { registerDictionary } from './vision/aruco-setup.js';
import { DICT_6X6_250_CODES } from './vision/dictionary-6x6-250-data.js';
import { initCaptureFlow } from './capture/capture-controller.js';
import { PipeRoutingApp } from './scene/PipeRoutingApp.js';

// Muss vor der ersten Markererkennung passiert sein.
registerDictionary(DICT_6X6_250_CODES);

const appContainer = document.getElementById('app');

initCaptureFlow((markerData) => {
  // eslint-disable-next-line no-new -- die App verdrahtet sich selbst über DOM-Events,
  // eine Referenz wird hier nicht gebraucht.
  new PipeRoutingApp(appContainer, markerData);
});

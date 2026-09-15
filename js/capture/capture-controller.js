/**
 * capture-controller.js
 * ------------------------
 * Verdrahtet den kompletten Aufnahme-Bildschirm: Kamera-Vorschau, Schwerkraft-Sensor,
 * die drei Kalibrierungs-Wege (.npz / Kalibrierblatt / manuell), den Auslöser und den
 * "Demo-Daten"-Testpfad.
 *
 * Das Ergebnis (fertige markerData, siehe main.js für die genaue Form) wird über einen
 * Callback nach außen gereicht - dieses Modul weiß absichtlich NICHTS von der 3D-Szene,
 * das hält die Verantwortlichkeiten sauber getrennt (Aufnahme+Auswertung hier,
 * Darstellung in js/scene/).
 */

import { startCamera, estimateK } from './camera.js';
import { GravitySensor } from './gravity.js';
import { runDetection } from '../vision/detection.js';
import { poseFromCorners, reprojectionErrorRMS } from '../vision/pose-estimation.js';
import { fuseMultiView } from '../vision/multi-view-fusion.js';
import { loadCalibrationNpz } from '../calibration/npz-loader.js';
import {
  generateCalibrationSheet,
  evaluateCalibrationPhoto,
} from '../calibration/calibration-sheet.js';

const MAX_SHOTS = 3;

const DEMO_MARKER_DATA = {
  markerA: { id: 'A', position: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: 0, y: 0, z: 1 } },
  markerB: { id: 'B', position: { x: 2, y: 0, z: 0 }, xAxis: { x: -1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: 0, y: 0, z: -1 } },
};

/**
 * Initialisiert den gesamten Aufnahme-Bildschirm und startet die Kamera + den
 * Schwerkraft-Sensor. Ab hier läuft alles ereignisgesteuert über die DOM-Elemente.
 *
 * @param {(markerData: object) => void} onMarkerData wird aufgerufen, sobald echte
 *   (per Foto) oder Demo-Markerdaten bereitstehen und der Nutzer zur 3D-Ansicht
 *   weitergehen möchte
 */
export function initCaptureFlow(onMarkerData) {
  const video = document.getElementById('camVideo');
  const captureCanvas = document.getElementById('captureCanvas');
  const shutterBtn = document.getElementById('shutter');
  const captureStatus = document.getElementById('captureStatus');
  const gravityReadout = document.getElementById('gravityReadout');
  const calibToggle = document.getElementById('calibToggle');
  const calibBox = document.getElementById('calibBox');
  const analyzeOverlay = document.getElementById('analyzeOverlay');
  const analyzeText = document.getElementById('analyzeText');
  const resultBox = document.getElementById('resultBox');
  const captureScreen = document.getElementById('captureScreen');

  const calFx = document.getElementById('calFx');
  const calFy = document.getElementById('calFy');
  const calCx = document.getElementById('calCx');
  const calCy = document.getElementById('calCy');
  const calMarkerLen = document.getElementById('calMarkerLen');
  const calibSummary = document.getElementById('calibSummary');

  let camStream = null;
  let calibDist = [0, 0, 0, 0, 0]; // aktuell aktive Verzeichnungskoeffizienten (nur aus .npz)

  // --- Mehrbild-Aufnahme: bis zu MAX_SHOTS akzeptierte Fotos werden gesammelt und bei
  //     jedem neuen Foto per fuseMultiView() zu einer robusteren Marker-Geometrie fusioniert
  //     (siehe js/vision/multi-view-fusion.js). idA/idB legen anhand des ersten akzeptierten
  //     Fotos fest, welche ArUco-IDs "Marker A"/"Marker B" sind, damit eine zufällige dritte
  //     Detektion in einem späteren Foto nicht versehentlich found[0]/found[1] vertauscht.
  let shots = [];
  let idA = null, idB = null;

  calibToggle.onclick = () => calibBox.classList.toggle('open');

  // --- Kamera + Schwerkraft starten ---------------------------------------
  // opencv.js ist an dieser Stelle bereits fertig initialisiert (main.js wartet darauf,
  // bevor initCaptureFlow überhaupt aufgerufen wird) - Auslöser jetzt freigeben und den
  // anfänglichen "wird geladen"-Hinweis durch die eigentliche Anleitung ersetzen.
  shutterBtn.disabled = false;
  captureStatus.textContent =
    'Beide ArUco-Marker ins Bild halten, ruhig halten, dann auslösen. Für mehr Genauigkeit ' +
    'danach optional bis zu 2 weitere Fotos aus anderen Blickwinkeln.';

  startCamera(video)
    .then((stream) => {
      camStream = stream;
      video.addEventListener('loadedmetadata', () => {
        const K = estimateK(video.videoWidth, video.videoHeight);
        setCalibFields(K.fx, K.fy, K.cx, K.cy);
        loadDefaultCalibration();
      }, { once: true });
    })
    .catch((err) => {
      captureStatus.innerHTML = `<span class="errText">Kamera nicht verfügbar: ${err.message}.<br>Benötigt HTTPS oder localhost und Kamera-Berechtigung.</span>`;
      shutterBtn.disabled = true;
    });

  const gravity = new GravitySensor(gravityReadout, captureScreen);

  function setCalibFields(fx, fy, cx, cy) {
    calFx.value = fx.toFixed(1);
    calFy.value = fy.toFixed(1);
    calCx.value = cx.toFixed(1);
    calCy.value = cy.toFixed(1);
  }
  function showCalibSummary(text, ok = true) {
    calibSummary.textContent = text;
    calibSummary.style.color = ok ? '#7be0b0' : '#ff8a8a';
  }
  function currentK() {
    return {
      fx: parseFloat(calFx.value) || video.videoWidth || 1000,
      fy: parseFloat(calFy.value) || video.videoWidth || 1000,
      cx: parseFloat(calCx.value) || (video.videoWidth || 0) / 2,
      cy: parseFloat(calCy.value) || (video.videoHeight || 0) / 2,
      imageWidth: video.videoWidth || 0,
      imageHeight: video.videoHeight || 0,
    };
  }

  /**
   * Übernimmt eine geladene .npz-Kalibrierung (Datei-Upload oder mitgelieferte
   * Standard-Datei) in die Kalibrierfelder. Die K.npy-Werte stammen typischerweise von
   * separaten, in voller Auflösung aufgenommenen Kalibrierfotos (z.B. 3024×4032) - der
   * Kamerastream hier läuft aber meist in einer anderen Auflösung (z.B. 1920×1080).
   * fx/fy/cx/cy sind Pixelgrößen und müssen deshalb proportional auf die tatsächliche
   * Stream-Auflösung skaliert werden, sonst stimmen Pose-Berechnung und (davon abgeleitet)
   * die Kamerasicht-Perspektive nicht mit der Realität überein.
   */
  function applyCalibration({ fx, fy, cx, cy, dist, hasDist, imageWidth, imageHeight }) {
    let aspectMismatch = false;
    if (imageWidth && imageHeight && video.videoWidth && video.videoHeight) {
      const sx = video.videoWidth / imageWidth;
      const sy = video.videoHeight / imageHeight;
      if (Math.abs(sx / sy - 1) > 0.15) {
        aspectMismatch = true;
        console.warn(
          `Kalibrierung: Seitenverhältnis der Kalibrierfotos (${imageWidth}×${imageHeight}) weicht ` +
          `deutlich vom Kamerastream (${video.videoWidth}×${video.videoHeight}) ab - Skalierung evtl. ungenau.`
        );
      }
      fx *= sx; cx *= sx;
      fy *= sy; cy *= sy;
    }
    setCalibFields(fx, fy, cx, cy);
    calibDist = dist;
    return { fx, fy, cx, cy, hasDist, aspectMismatch };
  }

  /** Lädt beim Start automatisch assets/default-calib.npz, falls vorhanden - so ist die
   *  App direkt mit einer echten Kalibrierung nutzbar, ohne dass die Datei jedes Mal von
   *  Hand ausgewählt werden muss. Eine manuelle Auswahl (Tab ".npz") überschreibt das
   *  danach jederzeit wieder.
   *
   *  WICHTIG: diese Standard-Datei stammt von genau EINEM konkreten Handy, nicht vom
   *  Gerät der aktuellen Nutzerin/des aktuellen Nutzers - andere Brennweite, anderer
   *  Bildmittelpunkt und vor allem andere Verzeichnungskoeffizienten führen zu einem
   *  SYSTEMATISCHEN (nicht durch Mehrbild-Fusion ausgleichbaren) Tiefenfehler, der sich
   *  z.B. als Höhenversatz zweier eigentlich koplanarer Marker zeigt. Deshalb hier klar
   *  sichtbar (nicht nur in der Konsole) darauf hinweisen, wenn schon allein das
   *  Seitenverhältnis von Kalibrierfoto und Kamerastream nicht zusammenpasst - ein starkes
   *  Indiz dafür, dass diese Kalibrierung nicht zum tatsächlich genutzten Gerät passt. */
  function loadDefaultCalibration() {
    fetch('assets/default-calib.npz')
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => loadCalibrationNpz(blob))
      .then((loaded) => {
        const { hasDist, aspectMismatch } = applyCalibration(loaded);
        if (aspectMismatch) {
          showCalibSummary(
            'Standard-.npz aktiv, passt aber nicht zu diesem Kamerastream (anderes Seitenverhältnis) - ' +
            'stammt von einem anderen Gerät. Für genaue Tiefe/Höhe eigene Kalibrierung nutzen (Tab ".npz" ' +
            'oder "Kalibrierblatt").', false
          );
        } else {
          showCalibSummary(
            'Aktive Kalibrierung: Standard-.npz' + (hasDist ? ' (inkl. Verzeichnungskorrektur)' : '') +
            ' - stammt von einem anderen Gerät, für beste Genauigkeit eigene Kalibrierung nutzen.'
          );
        }
      })
      .catch(() => {}); // keine mitgelieferte Standard-Kalibrierung -> grobe Schätzung bleibt aktiv
  }

  // --- Kalibrierungs-Tabs ---------------------------------------------------
  const calibTabs = { npz: 'calibTabNpz', charuco: 'calibTabCharuco', manual: 'calibTabManual' };
  const calibPanes = { npz: 'calibPaneNpz', charuco: 'calibPaneCharuco', manual: 'calibPaneManual' };
  Object.keys(calibTabs).forEach((key) => {
    document.getElementById(calibTabs[key]).onclick = () => {
      Object.keys(calibTabs).forEach((k) => {
        document.getElementById(calibTabs[k]).classList.toggle('active', k === key);
        document.getElementById(calibPanes[k]).style.display = k === key ? '' : 'none';
      });
    };
  });
  // Manuelle Eingabe passt zu keiner Verzeichnung mehr, die aus einer .npz stammte.
  [calFx, calFy, calCx, calCy].forEach((el) => {
    el.addEventListener('input', () => {
      calibDist = [0, 0, 0, 0, 0];
      showCalibSummary('Manuelle Werte aktiv (keine Verzeichnungskorrektur).');
    });
  });

  // --- Option A: .npz-Datei --------------------------------------------------
  document.getElementById('npzFile').onchange = async (e) => {
    const file = e.target.files[0];
    const statusEl = document.getElementById('npzStatus');
    if (!file) return;
    try {
      const loaded = await loadCalibrationNpz(file);
      const { fx, fy, cx, cy, hasDist, aspectMismatch } = applyCalibration(loaded);
      statusEl.innerHTML = `<span style="color:#7be0b0">✓ geladen: fx=${fx.toFixed(1)} fy=${fy.toFixed(1)} cx=${cx.toFixed(1)} cy=${cy.toFixed(1)}${hasDist ? ' · Verzeichnung inklusive' : ' · keine Verzeichnung in der Datei gefunden'}</span>` +
        (aspectMismatch ? '<br><span class="errText">⚠ Seitenverhältnis der Kalibrierfotos passt nicht zum Kamerastream - falsche Datei? Genauigkeit eingeschränkt.</span>' : '');
      showCalibSummary(
        'Aktive Kalibrierung: .npz-Datei' + (hasDist ? ' (inkl. Verzeichnungskorrektur)' : ''),
        !aspectMismatch
      );
    } catch (err) {
      statusEl.innerHTML = `<span class="errText">Fehler: ${err.message}</span>`;
    }
  };

  // --- Option B: eigenes Kalibrierblatt --------------------------------------
  document.getElementById('charucoGenerate').onclick = () => {
    const squareMm = parseFloat(document.getElementById('charucoSquare').value) || 30;
    generateCalibrationSheet(squareMm);
    document.getElementById('charucoStatus').innerHTML =
      '<span style="color:#7be0b0">✓ heruntergeladen. In Originalgröße (100%, nicht "an Seite anpassen") drucken, danach eine Markerkante mit dem Lineal nachmessen und den tatsächlichen Wert oben eintragen.</span>';
  };
  document.getElementById('charucoShot').onclick = async () => {
    const statusEl = document.getElementById('charucoStatus');
    if (!video.videoWidth) { statusEl.innerHTML = '<span class="errText">Kamera nicht bereit.</span>'; return; }
    statusEl.textContent = 'Analysiere …';
    await new Promise((r) => setTimeout(r, 30));
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    try {
      const squareMm = parseFloat(document.getElementById('charucoSquare').value) || 30;
      const { f, cx, cy, markerCount } = evaluateCalibrationPhoto(c, squareMm, runDetection);
      calibDist = [0, 0, 0, 0, 0];
      setCalibFields(f, f, cx, cy);
      statusEl.innerHTML = `<span style="color:#7be0b0">✓ ${markerCount} Markerfelder erkannt, f=${f.toFixed(1)}px geschätzt.</span>`;
      showCalibSummary(`Aktive Kalibrierung: Kalibrierblatt (f=${f.toFixed(0)}px, keine Verzeichnung)`);
    } catch (err) {
      statusEl.innerHTML = `<span class="errText">${err.message}</span>`;
    }
  };

  // --- Auslösen: Frame + Schwerkraft einfrieren, dann auswerten ------------
  shutterBtn.onclick = async () => {
    if (!video.videoWidth) { captureStatus.textContent = 'Kamera noch nicht bereit …'; return; }
    const gravityDown = gravity.currentGravityDown();
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    captureCanvas.getContext('2d', { willReadFrequently: true })
      .drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    analyzeOverlay.classList.add('show');
    analyzeText.textContent = 'Marker werden gesucht …';
    const spinner = analyzeOverlay.querySelector('.spinner');
    spinner.style.display = '';
    resultBox.style.display = 'none';
    await new Promise((r) => setTimeout(r, 30)); // UI erst rendern lassen, dann (blockierend) erkennen

    let found;
    try {
      found = runDetection(captureCanvas);
    } catch (err) {
      showAnalyzeError('Fehler bei der Bilderkennung: ' + err.message);
      return;
    }

    if (found.length < 2) {
      showAnalyzeError(
        `Nur ${found.length} Marker erkannt (mind. 2 nötig). Näher ran, mehr Licht, Marker ` +
        'möglichst frontal und beide etwa gleich groß im Bild - dann "Erneut versuchen". ' +
        'Details siehe Browser-Konsole.'
      );
      return;
    }

    // Ab dem zweiten Foto: dieselben zwei Marker wie in Foto 1 verlangen (per ArUco-ID, nicht
    // Array-Index) - sonst könnte eine zusätzliche Spurious-Detektion still "Marker A"/"Marker B"
    // vertauschen und die Fusion mit inkonsistenten Daten füttern.
    const mA = idA == null ? found[0] : found.find((m) => m.id === idA);
    const mB = idB == null ? found[1] : found.find((m) => m.id === idB);
    if (!mA || !mB) {
      showAnalyzeError(
        `Marker ${idA}/${idB} aus Foto 1 hier nicht gefunden - bitte dieselben zwei Marker ` +
        'wie beim ersten Foto im Bild halten, dann erneut versuchen.'
      );
      return;
    }

    const K = currentK();
    const markerLength = parseFloat(calMarkerLen.value) || 0.0705;
    const poseA = poseFromCorners(mA.corners, markerLength, K, calibDist);
    const poseB = poseFromCorners(mB.corners, markerLength, K, calibDist);
    if (!poseA || !poseB) {
      showAnalyzeError('Pose konnte nicht berechnet werden (Homographie singulär). Anderer Blickwinkel, dann erneut versuchen.');
      return;
    }

    const eA = reprojectionErrorRMS(poseA, mA.corners, markerLength, K, calibDist);
    const eB = reprojectionErrorRMS(poseB, mB.corners, markerLength, K, calibDist);
    const pendingShot = {
      poseA, poseB, K,
      reprojErrorPx: Math.sqrt((eA * eA + eB * eB) / 2),
      gravityDown: gravityDown || null,
    };
    const fused = fuseMultiView([...shots, pendingShot]);

    const markerData = {
      coordinateSystem: { origin: 'camera', unit: 'meter' },
      markerA: { id: idA == null ? mA.id : idA, ...fused.markerA },
      markerB: { id: idB == null ? mB.id : idB, ...fused.markerB },
      K: fused.K,
    };
    if (fused.gravityDown) markerData.gravityDown = fused.gravityDown;

    const distMM = (Math.hypot(
      fused.markerA.position.x - fused.markerB.position.x,
      fused.markerA.position.y - fused.markerB.position.y,
      fused.markerA.position.z - fused.markerB.position.z
    ) * 1000).toFixed(1);
    const hasDist = calibDist.some((v) => v !== 0);

    const shotCount = shots.length + 1;
    const qualityRows = [...shots, pendingShot].map((s, i) => {
      const ok = s.reprojErrorPx < 1.5;
      return `Foto ${i + 1}: <span class="${ok ? 'okText' : 'errText'}">${s.reprojErrorPx.toFixed(2)}px Reprojektionsfehler</span>`;
    }).join('<br>');
    const warningsHtml = fused.warnings.length
      ? `<div class="errText" style="margin-top:6px">${fused.warnings.join('<br>')}</div>` : '';
    const canAddMore = shotCount < MAX_SHOTS;

    resultBox.style.display = 'block';
    resultBox.innerHTML = `<b class="okText">✓ ${found.length} Marker erkannt</b>
     Verwendet: Marker ${mA.id} &amp; ${mB.id} · Foto ${shotCount}/${MAX_SHOTS}<br>
     ${qualityRows}<br>
     Abstand (fusioniert): ${distMM} mm<br>
     Kalibrierung: fx=${K.fx.toFixed(0)} fy=${K.fy.toFixed(0)}${hasDist ? ' · inkl. Verzeichnungskorrektur' : ''}<br>
     Schwerkraft-Referenz: ${fused.gravityDown ? '<span class="okText">vorhanden</span>' : '<span class="errText">fehlt (Ebene wird aus Markern geschätzt)</span>'}
     ${warningsHtml}
     <div class="row" style="margin-top:12px;gap:8px">
       <button id="goToScene" class="primary" style="flex:1">Fertig, weiter zur 3D-Ansicht</button>
       ${canAddMore ? '<button id="addAnotherPhoto" class="ghost" style="flex:1">+ Noch ein Foto</button>' : ''}
       <button id="retakePhoto" style="flex:1">Wiederholen</button>
     </div>`;
    analyzeText.textContent = '';
    spinner.style.display = 'none';

    function commitPendingShot() {
      if (idA == null) { idA = mA.id; idB = mB.id; }
      shots.push(pendingShot);
    }

    document.getElementById('goToScene').onclick = () => {
      commitPendingShot();
      camStream && camStream.getTracks().forEach((t) => t.stop());
      captureScreen.style.display = 'none';
      analyzeOverlay.classList.remove('show');
      onMarkerData(markerData);
    };
    if (canAddMore) {
      document.getElementById('addAnotherPhoto').onclick = () => {
        commitPendingShot();
        analyzeOverlay.classList.remove('show');
        captureStatus.textContent =
          `Foto ${shots.length + 1}/${MAX_SHOTS}: Kamera an eine andere Position/anderen Blickwinkel ` +
          'bewegen, dann erneut auslösen.';
      };
    }
    document.getElementById('retakePhoto').onclick = () => {
      analyzeOverlay.classList.remove('show');
    };
  };

  function showAnalyzeError(msg) {
    analyzeText.innerHTML = `<span class="errText">${msg}</span><div class="row" style="margin-top:14px"><button id="retakePhoto2" class="primary">Erneut versuchen</button></div>`;
    analyzeOverlay.querySelector('.spinner').style.display = 'none';
    document.getElementById('retakePhoto2').onclick = () => analyzeOverlay.classList.remove('show');
  }

  // --- Demo-Daten (ohne Kamera testen) ---------------------------------------
  document.getElementById('demoLink').onclick = () => {
    camStream && camStream.getTracks().forEach((t) => t.stop());
    captureScreen.style.display = 'none';
    onMarkerData(DEMO_MARKER_DATA);
  };

  // --- Neues Foto: einfachste robuste Lösung ist ein kompletter Neustart -----
  document.getElementById('newPhoto').onclick = () => location.reload();
}

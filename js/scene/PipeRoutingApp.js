/**
 * PipeRoutingApp.js
 * -------------------
 * Die eigentliche 3D-Ansicht: Three.js-Szene, Marker-Darstellung, horizontale
 * Referenzebene, interaktives Rohr-Routing (manuell per Griffe + automatisch) und die
 * dazugehörige UI-Verdrahtung (Buttons, Touch/Maus-Interaktion, Kamera-Perspektive).
 *
 * Bewusst als Klasse statt als lose Funktion mit Closures: macht den gesamten Zustand
 * (aktuelle Position, Richtung, Verlauf, Szene-Objekte, ...) als benannte
 * Instanz-Eigenschaften sichtbar, statt in einer einzigen sehr langen Funktion versteckt
 * zu sein. Reine Zeichenfunktionen (Zylinder, Bögen, Pfeile, ...) und der
 * Auto-Routing-Algorithmus sind bewusst NICHT Teil dieser Klasse, sondern eigenständige,
 * zustandslose Module (siehe geometry-helpers.js, auto-route.js) - das macht sie
 * unabhängig testbar und wiederverwendbar.
 */

import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

import {
  createCylinderMesh, createElbowMesh, createFadingStub, createMarkerVisual,
  perpDirs, colorForDirection, CARDINALS, createLabelSprite,
} from './geometry-helpers.js';
import { setupHorizontalPlane, logPipeAxisAnglesToGravity } from './horizontal-plane.js';
import { tryAutoRoute } from './auto-route.js';
import { ScaleBar } from './scale-bar.js';

/** OpenCV-Kamerakoordinaten (X rechts, Y runter, Z in die Szene) -> Three.js (Y hoch,
 *  Z aus dem Bildschirm heraus): Y und Z werden gespiegelt, X bleibt. */
function cvToThree(v) {
  return new THREE.Vector3(v.x, -v.y, -v.z);
}

/** Wandelt die rohen (OpenCV-konventionierten) Marker-Posendaten in Three.js-Vektoren um. */
function readMarker(m) {
  const out = { id: m.id, position: cvToThree(m.position), xAxis: cvToThree(m.xAxis).normalize() };
  if (m.yAxis) out.yAxis = cvToThree(m.yAxis).normalize();
  if (m.zAxis) out.zAxis = cvToThree(m.zAxis).normalize();
  return out;
}

/** Klassifiziert eine Richtungsänderung rein geometrisch (Skalarprodukt alte/neue
 *  Richtung) statt sich auf den global gewählten UI-Modus zu verlassen - so wird sowohl
 *  beim manuellen Tippen als auch beim Auto-Routing (das ggf. andere Winkel als
 *  `selectedMode` braucht) immer der tatsächliche Biegewinkel gezeichnet. */
function classifyTurn(oldDir, newDir) {
  const d = oldDir.dot(newDir);
  if (d > 0.999) return 'straight';
  if (d > 0.5) return 'b45';
  return 'b90';
}

/** Vertikales FOV (Grad) für THREE.PerspectiveCamera, das der echten Aufnahmekamera
 *  entspricht - unabhängig davon, ob das Browserfenster (canvasAspect) ein anderes
 *  Seitenverhältnis hat als das Kalibrierfoto (K.imageWidth × K.imageHeight). Analog zu
 *  CSS "object-fit: cover": die enger passende Achse wird exakt physikalisch korrekt
 *  abgebildet, die andere zeigt entsprechend mehr/weniger vom Bild statt zu verzerren. */
function calibratedVerticalFov(K, canvasAspect) {
  const photoAspect = K.imageWidth / K.imageHeight;
  if (canvasAspect > photoAspect) {
    return THREE.MathUtils.radToDeg(2 * Math.atan(K.imageHeight / (2 * K.fy)));
  }
  const hFov = 2 * Math.atan(K.imageWidth / (2 * K.fx));
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hFov / 2) / canvasAspect));
}

export class PipeRoutingApp {
  /**
   * @param {HTMLElement} container Element, in das der WebGL-Canvas eingehängt wird
   * @param {object} markerData rohe Markerdaten (OpenCV-Konvention), siehe main.js
   */
  constructor(container, markerData) {
    this.markerA = readMarker(markerData.markerA);
    this.markerB = readMarker(markerData.markerB);
    this.markerDist = this.markerA.position.distanceTo(this.markerB.position) || 1;
    this.UNIT = this.markerDist;
    // Nur vorhanden, wenn per echtem Foto (nicht Demo-Daten) erfasst und wenn die
    // Kalibrierung Bildmaße mitliefert - siehe capture-controller.js.
    this.calibK = (markerData.K && markerData.K.imageWidth && markerData.K.imageHeight) ? markerData.K : null;

    this._computeConstants();
    this._setupRenderer(container);
    this._setupSceneObjects();
    this._setupMarkersAndPlane(markerData);
    this._setupRoutingState();
    this._wireUI();
    this._wirePickInteraction();

    this.scaleBar = new ScaleBar();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    addEventListener('resize', () => this._onResize());
  }

  // -- Setup ------------------------------------------------------------------

  _computeConstants() {
    const UNIT = this.UNIT;
    this.PIPE_R = THREE.MathUtils.clamp(UNIT * 0.045, 0.0018, 0.06);
    this.SEG_LEN = THREE.MathUtils.clamp(UNIT * 0.55, 0.02, 1.0);
    this.ENDPOINT_R = THREE.MathUtils.clamp(UNIT * 0.06, 0.0025, 0.06);
    this.HANDLE_OFF = THREE.MathUtils.clamp(UNIT * 0.42, 0.015, 0.48);
    this.HANDLE_R = THREE.MathUtils.clamp(UNIT * 0.06, 0.0022, 0.06);
    this.HANDLE_LINE = this.HANDLE_OFF * 0.65;
    this.MARKER_R = THREE.MathUtils.clamp(UNIT * 0.055, 0.004, 0.026);
    this.MARKER_ARROW = THREE.MathUtils.clamp(UNIT * 0.9, 0.06, 0.55);
    this.STUB_LEN = THREE.MathUtils.clamp(0.35, 0.02, this.markerDist * 0.45);
    this.MIN_SEG = Math.max(this.PIPE_R * 3, UNIT * 0.01);
  }

  _setupRenderer(container) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd8dfe8);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa8bc, 2.4));
    const dl = new THREE.DirectionalLight(0xffffff, 2.0); dl.position.set(4, 7, 5); this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.6); dl2.position.set(-4, 3, -5); this.scene.add(dl2);

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
  }

  _setupSceneObjects() {
    this.pipes = new THREE.Group(); this.scene.add(this.pipes);
    this.joints = new THREE.Group(); this.scene.add(this.joints);
    this.markersGroup = new THREE.Group(); this.scene.add(this.markersGroup);
    this.measureGroup = new THREE.Group(); this.scene.add(this.measureGroup);
    // Gizmo (Routing-Griffe) startet ausgeblendet, um den Blick auf die Rohre frei zu
    // halten - wird bei Bedarf über den Knopf oben eingeblendet.
    this.joints.visible = false;
  }

  _setupMarkersAndPlane(markerData) {
    const { markerA, markerB, markerDist, UNIT } = this;

    const camOffsetDir = new THREE.Vector3(3, 2.5, 4).normalize();
    this.camera.position.copy(markerA.position).add(camOffsetDir.multiplyScalar(Math.max(markerDist * 3, 0.6)));
    this.midAB = new THREE.Vector3().addVectors(markerA.position, markerB.position).multiplyScalar(0.5);
    this.controls.target.copy(this.midAB);
    this.controls.minDistance = markerDist * 0.3;
    this.controls.maxDistance = markerDist * 30;
    this.controls.update();

    const { usedGravity, tableNormal, planeMesh } = setupHorizontalPlane(
      this.scene, markerA, markerB, markerData.gravityDown ?? null, cvToThree, this.midAB, markerDist, UNIT
    );
    this.usedGravity = usedGravity;
    this.tableNormal = tableNormal;
    this.horizontalPlaneMesh = planeMesh;

    document.getElementById('markerInfo').textContent =
      `Start: Marker ${markerA.id} · Ziel: Marker ${markerB.id} · Abstand ${(markerDist * 100).toFixed(1)} cm` +
      (usedGravity ? ' · Horizontale aus Schwerkraft-Sensor' : ' · keine Horizontale (Sensor war bei der Aufnahme nicht verfügbar)');

    if (usedGravity) logPipeAxisAnglesToGravity(markerA, markerB, tableNormal);
    console.log('ArUco Marker A:', markerA);
    console.log('ArUco Marker B:', markerB);
    console.log('A → B Abstand:', markerDist.toFixed(3), 'm');

    this.markersGroup.add(createMarkerVisual(markerA, true, this.MARKER_R, this.MARKER_ARROW));
    this.markersGroup.add(createMarkerVisual(markerB, false, this.MARKER_R, this.MARKER_ARROW));
    this.markersGroup.add(createFadingStub(markerA.position, markerA.xAxis, this.STUB_LEN, this.PIPE_R * 0.9));
    this.markersGroup.add(createFadingStub(markerB.position, markerB.xAxis, this.STUB_LEN, this.PIPE_R * 0.9));

    const targetGuide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([markerA.position.clone(), markerB.position.clone()]),
      new THREE.LineDashedMaterial({ color: 0x93a1b3, dashSize: UNIT * 0.06, gapSize: UNIT * 0.04 })
    );
    targetGuide.computeLineDistances();
    this.scene.add(targetGuide);
  }

  _setupRoutingState() {
    this.current = this.markerA.position.clone();
    this.direction = this.markerA.xAxis.clone();
    this.history = [];
    this.selectedMode = 'b90';
    this.lastPipeMesh = null;
    this.lastPipeStart = null;
    this.lastPipeEnd = null;
    this._drawEndpointHandles(this.current);
  }

  // -- Handles / Griffe ---------------------------------------------------------

  /** Welche Richtungen aktuell als Griffe angeboten werden: am allerersten Schritt alle
   *  6 Kardinalrichtungen, danach je nach Modus 90°- oder 45°-Abzweigungen von der
   *  aktuellen Richtung (plus "geradeaus weiter" ist immer dabei). */
  _handleDirs() {
    const dirs = [this.direction.clone()];
    if (this.history.length === 0) {
      CARDINALS.forEach((v) => dirs.push(v.clone()));
    } else if (this.selectedMode === 'b90') {
      dirs.push(...perpDirs(this.direction));
    } else {
      dirs.push(...perpDirs(this.direction).map((v) => this.direction.clone().add(v).normalize()));
    }
    const out = [];
    dirs.forEach((d) => { if (!out.some((o) => o.dot(d) > 0.98)) out.push(d); });
    return out;
  }

  _drawEndpointHandles(p, active = true) {
    this.joints.clear();
    const g = new THREE.Group();
    g.position.copy(p);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(this.ENDPOINT_R, 20, 20),
      new THREE.MeshStandardMaterial({
        color: active ? 0x2468e8 : 0x51637c, metalness: 0.55, roughness: 0.3, emissive: active ? 0x0c2c63 : 0,
      })
    );
    g.add(sphere);

    this._handleDirs().forEach((v) => {
      const c = colorForDirection(v);
      const o = new THREE.Group();
      o.position.copy(v.clone().multiplyScalar(this.HANDLE_OFF));
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(this.HANDLE_R, 0), new THREE.MeshBasicMaterial({ color: c }));
      m.userData.dir = v; m.userData.route = true;
      o.add(m);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), v.clone().multiplyScalar(-this.HANDLE_LINE)]),
        new THREE.LineBasicMaterial({ color: c })
      );
      o.add(line);
      g.add(o);
    });
    this.joints.add(g);
  }

  // -- Routing --------------------------------------------------------------------

  addSegment(dir, mode, len) {
    if (len === undefined) len = this.SEG_LEN;
    if (mode === undefined) mode = this.history.length > 0 ? classifyTurn(this.direction, dir) : 'straight';

    const end = this.current.clone().add(dir.clone().normalize().multiplyScalar(len));
    this.history.push({ dir: dir.clone(), mode, len });

    if (mode === 'straight') {
      this._addPipe(this.current, end);
    } else {
      if (this.lastPipeMesh) {
        this.pipes.remove(this.lastPipeMesh);
        const trimmedEnd = this.current.clone().sub(this.direction.clone().normalize().multiplyScalar(this.PIPE_R * 3));
        this._addPipe(this.lastPipeStart, trimmedEnd);
      }
      const { mesh, p1 } = createElbowMesh(this.current, this.direction, dir, this.PIPE_R);
      this.pipes.add(mesh);
      this._addPipe(p1, end);
    }

    this.current.copy(end);
    this.direction.copy(dir).normalize();
    this._drawEndpointHandles(this.current);
  }

  _addPipe(a, b) {
    const mesh = createCylinderMesh(a, b, this.PIPE_R, false);
    this.pipes.add(mesh);
    this.lastPipeMesh = mesh;
    this.lastPipeStart = a.clone();
    this.lastPipeEnd = b.clone();
    return mesh;
  }

  undo() {
    if (!this.history.length) return;
    this.pipes.clear();
    this.lastPipeMesh = null;
    const h = this.history.slice(0, -1);
    this.history = [];
    this.current.copy(this.markerA.position);
    this.direction.copy(this.markerA.xAxis).normalize();
    h.forEach((x) => this.addSegment(x.dir, x.mode, x.len));
    this._drawEndpointHandles(this.current);
  }

  reset() {
    this.pipes.clear();
    this.lastPipeMesh = null;
    this.history = [];
    this.current.copy(this.markerA.position);
    this.direction.copy(this.markerA.xAxis).normalize();
    this._drawEndpointHandles(this.current);
  }

  autoRoute() {
    const steps = tryAutoRoute(this.markerA, this.markerB, this.UNIT, this.MIN_SEG);
    if (!steps) {
      alert('Keine einfache automatische Route gefunden (Details in der Browser-Konsole). Bitte manuell verlegen.');
      return;
    }
    this.reset();
    steps.forEach((s) => this.addSegment(s.dir, undefined, s.len));
  }

  // -- UI-Verdrahtung ---------------------------------------------------------------

  _wireUI() {
    ['b90', 'b45'].forEach((id) => {
      document.getElementById(id).onclick = () => {
        this.selectedMode = id;
        document.querySelectorAll('#modeSwitch button.modebtn').forEach((b) => b.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        this._drawEndpointHandles(this.current);
      };
    });
    document.getElementById('undo').onclick = () => this.undo();
    document.getElementById('reset').onclick = () => this.reset();
    document.getElementById('autoroute').onclick = () => this.autoRoute();

    const toggleGizmoBtn = document.getElementById('toggleGizmo');
    toggleGizmoBtn.onclick = () => {
      this.joints.visible = !this.joints.visible;
      toggleGizmoBtn.classList.toggle('active', this.joints.visible);
    };

    const panelEl = document.getElementById('panel');
    const togglePanelBtn = document.getElementById('togglePanel');
    togglePanelBtn.onclick = () => {
      const visible = panelEl.style.display === 'none';
      panelEl.style.display = visible ? '' : 'none';
      togglePanelBtn.classList.toggle('active', visible);
    };

    this._defaultHint = 'Maus: Orbit · Mausrad: Zoom · Touch: 1 Finger Routing / 2 Finger Kamera';

    this.inCameraView = false;
    this._savedCamPos = new THREE.Vector3();
    this._savedCamQuat = new THREE.Quaternion();
    this._savedTarget = new THREE.Vector3();
    this._savedFov = this.camera.fov;
    // Blickrichtung in der Kamerasicht (Yaw/Pitch relativ zur Original-Kameraausrichtung,
    // also relativ zur Identity-Quaternion) - siehe _wirePickInteraction fürs Schwenken.
    this._camViewYaw = 0;
    this._camViewPitch = 0;
    const toggleCamViewBtn = document.getElementById('toggleCamView');
    const hintEl = document.getElementById('hint');
    const enterCameraView = () => {
      this.inCameraView = true;
      toggleCamViewBtn.classList.add('active');
      this._savedCamPos.copy(this.camera.position);
      this._savedCamQuat.copy(this.camera.quaternion);
      this._savedTarget.copy(this.controls.target);
      this.camera.position.set(0, 0, 0);
      this.camera.up.set(0, 1, 0);
      this._camViewYaw = 0;
      this._camViewPitch = 0;
      this.camera.quaternion.identity();
      this.camera.updateMatrixWorld();
      this.controls.enabled = false;
      if (this.calibK) {
        this.camera.fov = calibratedVerticalFov(this.calibK, this.camera.aspect);
        this.camera.updateProjectionMatrix();
      }
      this._pinchLastDist = null;
      this._activePointers.clear();
      hintEl.textContent = 'Original-Kamera-Perspektive · Ziehen zum Schwenken · Scrollen/Kneifen zum Zoomen · zum Zurücksetzen nochmal auf "Kamera-Sicht" klicken';
    };
    const exitCameraView = () => {
      this.inCameraView = false;
      toggleCamViewBtn.classList.remove('active');
      this.camera.position.copy(this._savedCamPos);
      this.camera.quaternion.copy(this._savedCamQuat);
      this.controls.target.copy(this._savedTarget);
      this.camera.fov = this._savedFov;
      this.camera.updateProjectionMatrix();
      this.controls.enabled = true;
      this.controls.update();
      hintEl.textContent = this._defaultHint;
    };
    toggleCamViewBtn.onclick = () => {
      if (this.inCameraView) { exitCameraView(); return; }
      if (this.measuring) exitMeasuring();
      enterCameraView();
    };

    // -- Messen: Abstand zwischen zwei angetippten Punkten, immer als orthogonale
    // Versatz-Strecken entlang der Bezugsachsen X/Y/Z (nie als direkte/diagonale Distanz) -
    // siehe _wirePickInteraction für die Punktauswahl per Klick/Tap.
    this.measuring = false;
    this.measurePoints = [];
    const toggleMeasureBtn = document.getElementById('toggleMeasure');
    const enterMeasuring = () => {
      this.measuring = true;
      this.measurePoints = [];
      this._clearMeasurement();
      toggleMeasureBtn.classList.add('active');
      hintEl.textContent = 'Messen: zwei Punkte am Modell antippen - zeigt den Versatz in X/Y/Z';
    };
    const exitMeasuring = () => {
      this.measuring = false;
      this.measurePoints = [];
      this._clearMeasurement();
      toggleMeasureBtn.classList.remove('active');
      hintEl.textContent = this._defaultHint;
    };
    toggleMeasureBtn.onclick = () => {
      if (this.measuring) { exitMeasuring(); return; }
      if (this.inCameraView) exitCameraView();
      enterMeasuring();
    };
  }

  /** Entfernt alle bisher gezeichneten Mess-Hilfslinien/-Punkte/-Labels. */
  _clearMeasurement() {
    this.measureGroup.clear();
  }

  /** Kleiner weißer Punkt zur Bestätigung eines gewählten Messpunkts. */
  _addMeasureDot(p) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(this.MARKER_R * 0.5, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    dot.position.copy(p);
    dot.renderOrder = 10;
    this.measureGroup.add(dot);
  }

  /**
   * Zeichnet die Strecke zwischen zwei Messpunkten NICHT als direkte/diagonale Linie,
   * sondern als "Treppe" aus bis zu 3 achsenparallelen Teilstrecken (erst X, dann Y, dann
   * Z) - jede einzeln beschriftet. Das entspricht, wie am Bau tatsächlich gemessen wird
   * (Versatz je Richtung), nicht der Luftlinie zwischen den Punkten.
   */
  _updateMeasurementVisual(p1, p2) {
    this._clearMeasurement();
    this._addMeasureDot(p1);
    this._addMeasureDot(p2);

    const corner1 = new THREE.Vector3(p2.x, p1.y, p1.z);
    const corner2 = new THREE.Vector3(p2.x, p2.y, p1.z);
    const segments = [
      { a: p1, b: corner1, axis: 'X', color: 0xd23c3c },
      { a: corner1, b: corner2, axis: 'Y', color: 0x1f9d52 },
      { a: corner2, b: p2, axis: 'Z', color: 0x2468e8 },
    ];

    segments.forEach(({ a, b, axis, color }) => {
      const len = a.distanceTo(b);
      if (len < 1e-4) return; // keine Komponente in dieser Achse - nichts zu zeichnen/beschriften
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineDashedMaterial({ color, dashSize: this.UNIT * 0.025, gapSize: this.UNIT * 0.015, depthTest: false })
      );
      line.computeLineDistances();
      line.renderOrder = 10;
      this.measureGroup.add(line);

      const hex = '#' + color.toString(16).padStart(6, '0');
      const label = createLabelSprite(`Δ${axis} ${(len * 100).toFixed(1)} cm`, hex, this.UNIT * 0.14);
      label.position.copy(a).lerp(b, 0.5);
      label.renderOrder = 11;
      this.measureGroup.add(label);
    });
  }

  _setControlsEnabled(en) {
    this.controls.enabled = en && !this.inCameraView;
  }

  _wirePickInteraction() {
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.draggingRoute = false;
    this._lookDragging = false;
    this._lookLast = { x: 0, y: 0 };
    // Für Pinch-Zoom in der Kamerasicht: alle aktuell aufliegenden Touch-Pointer, damit
    // sich bei genau 2 Fingern der Abstand zwischen ihnen verfolgen lässt.
    this._activePointers = new Map();
    this._pinchLastDist = null;

    const pick = (e) => {
      // THREE.Raycaster prüft .visible NICHT selbst - bei ausgeblendetem Gizmo würden
      // sonst unsichtbare Griffe weiterhin "blind" antippbar bleiben. Deshalb hier
      // explizit sperren.
      if (!this.joints.visible) return null;
      const r = this.renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouse.set(x, y);
      this.ray.setFromCamera(this.mouse, this.camera);
      const hit = this.ray.intersectObjects(this.joints.children, true).find((x) => x.object.userData.route);
      return hit?.object.userData.dir || null;
    };

    // Messpunkt-Auswahl: trifft Rohre/Bögen, Marker-Kugeln und die horizontale
    // Referenzebene (falls vorhanden) - bewusst NICHT die Routing-Griffe/Endpunkt-Kugel,
    // das sind flüchtige UI-Hilfsmittel, keine Modellgeometrie.
    const pickMeasurePoint = (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouse.set(x, y);
      this.ray.setFromCamera(this.mouse, this.camera);
      const targets = [...this.pipes.children, ...this.markersGroup.children];
      if (this.horizontalPlaneMesh) targets.push(this.horizontalPlaneMesh);
      const hit = this.ray.intersectObjects(targets, true)[0];
      return hit ? hit.point.clone() : null;
    };

    // Schwenken in der Kamerasicht: OrbitControls ist dort komplett deaktiviert (sie
    // würde die Kamera vom fixen Aufnahmepunkt wegbewegen), daher hier eine einfache
    // eigene "Blick drehen, Position fest"-Steuerung wie bei einem Kugelpanorama.
    const applyLook = (dx, dy) => {
      const LOOK_SPEED = 0.005; // rad pro Pixel
      this._camViewYaw -= dx * LOOK_SPEED;
      this._camViewPitch = THREE.MathUtils.clamp(
        this._camViewPitch - dy * LOOK_SPEED, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01
      );
      this.camera.quaternion.setFromEuler(new THREE.Euler(this._camViewPitch, this._camViewYaw, 0, 'YXZ'));
    };

    // Zoom in der Kamerasicht: verändert nur das FOV (wie ein echtes Kamerazoom), die
    // Position bleibt exakt am Aufnahmepunkt - sonst wäre es kein "Blick aus der Kamera" mehr.
    const ZOOM_MIN_FOV = 12, ZOOM_MAX_FOV = 100;
    const setFov = (fov) => {
      this.camera.fov = THREE.MathUtils.clamp(fov, ZOOM_MIN_FOV, ZOOM_MAX_FOV);
      this.camera.updateProjectionMatrix();
    };

    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (!this.inCameraView) return;
      e.preventDefault();
      setFov(this.camera.fov + e.deltaY * 0.05);
    }, { passive: false });

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (this.measuring && (e.pointerType === 'touch' || e.button === 0)) {
        const p = pickMeasurePoint(e);
        if (p) {
          if (this.measurePoints.length >= 2) this.measurePoints = [];
          this.measurePoints.push(p);
          if (this.measurePoints.length === 2) {
            this._updateMeasurementVisual(this.measurePoints[0], this.measurePoints[1]);
          } else {
            this._clearMeasurement();
            this._addMeasureDot(p);
          }
        }
        return; // im Messmodus keine Routing-/Schwenk-/Zoom-Interaktion parallel
      }
      if (e.pointerType === 'touch') {
        this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._activePointers.size >= 2) {
          // Zweiter Finger übernimmt fürs Zoomen - ein evtl. laufendes Einzelfinger-
          // Schwenken pausiert, bis wieder nur ein Finger aufliegt.
          this._lookDragging = false;
          this._pinchLastDist = null;
        }
      }
      if (e.pointerType === 'touch' || e.button === 0) {
        if (this.inCameraView && this._activePointers.size >= 2) return;
        const d = pick(e);
        if (d) {
          this.draggingRoute = true; this._setControlsEnabled(false); this.addSegment(d);
        } else if (this.inCameraView) {
          this._lookDragging = true;
          this._lookLast.x = e.clientX; this._lookLast.y = e.clientY;
          this.renderer.domElement.setPointerCapture(e.pointerId);
        }
      }
    });
    const endTouch = (e) => {
      if (e.pointerType === 'touch') {
        this._activePointers.delete(e.pointerId);
        if (this._activePointers.size < 2) this._pinchLastDist = null;
      }
      this.draggingRoute = false;
      this._setControlsEnabled(true);
      if (this._lookDragging) {
        this._lookDragging = false;
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      }
    };
    this.renderer.domElement.addEventListener('pointerup', endTouch);
    this.renderer.domElement.addEventListener('pointercancel', endTouch);
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && this._activePointers.has(e.pointerId)) {
        this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (this.inCameraView && this._activePointers.size >= 2) {
        const [p1, p2] = this._activePointers.values();
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this._pinchLastDist != null && this._pinchLastDist > 1) {
          setFov(this.camera.fov * (this._pinchLastDist / dist));
        }
        this._pinchLastDist = dist;
        return;
      }
      if (this._lookDragging) {
        applyLook(e.clientX - this._lookLast.x, e.clientY - this._lookLast.y);
        this._lookLast.x = e.clientX; this._lookLast.y = e.clientY;
        return;
      }
      if (!this.draggingRoute) return;
      const d = pick(e);
      if (d) { this.addSegment(d); this.draggingRoute = false; this._setControlsEnabled(true); }
    });
  }

  // -- Render-Loop --------------------------------------------------------------

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    if (this.inCameraView && this.calibK) {
      this.camera.fov = calibratedVerticalFov(this.calibK, this.camera.aspect);
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    if (!this.inCameraView) this.controls.update();
    this.scaleBar.update(this.camera, this.controls, this.renderer);
    this.renderer.render(this.scene, this.camera);
  }
}

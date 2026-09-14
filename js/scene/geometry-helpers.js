/**
 * geometry-helpers.js
 * --------------------
 * Zustandslose Bau- und Zeichen-Funktionen für die 3D-Szene: Rohrzylinder, Bögen,
 * Pfeile, Marker-Visualisierung, Text-Sprites. Nehmen alle benötigten Objekte/Werte als
 * Parameter entgegen und geben fertige Three.js-Objekte zurück, statt selbst Zustand zu
 * halten - so bleiben sie unabhängig testbar und wiederverwendbar, während die
 * eigentliche Routing-Logik (aktuelle Position, Richtung, Verlauf) zentral in
 * PipeRoutingApp.js verwaltet wird.
 */

import * as THREE from 'three';

/** Materialfarbe für Rohrsegmente: kräftiges Blau für das gerade aktiv bearbeitete
 *  Segment, gedecktes Blaugrau für alle anderen. */
export function pipeMaterial(active = false) {
  return new THREE.MeshStandardMaterial({
    color: active ? 0x2468e8 : 0x51637c,
    metalness: 0.55,
    roughness: 0.3,
    emissive: active ? 0x0c2c63 : 0,
  });
}

/** Erzeugt einen Rohrzylinder zwischen zwei Punkten (noch NICHT einer Gruppe hinzugefügt -
 *  das macht der Aufrufer, damit diese Funktion zustandslos bleibt). */
export function createCylinderMesh(a, b, radius, active = false) {
  const v = new THREE.Vector3().subVectors(b, a);
  const len = v.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 20), pipeMaterial(active));
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
  return mesh;
}

/**
 * Erzeugt einen Rohrbogen (Quadratic-Bezier-Tube) an einem Knickpunkt zwischen zwei
 * Richtungen. Gibt zusätzlich die getrimmten An-/Abschlusspunkte zurück, damit der
 * Aufrufer die angrenzenden geraden Segmente exakt daran anschließen kann.
 */
export function createElbowMesh(pivot, fromDir, toDir, radius) {
  const bendRadius = radius * 3.0;
  const p0 = pivot.clone().sub(fromDir.clone().normalize().multiplyScalar(bendRadius));
  const p1 = pivot.clone().add(toDir.clone().normalize().multiplyScalar(bendRadius));
  const curve = new THREE.QuadraticBezierCurve3(p0, pivot.clone(), p1);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 12, false), pipeMaterial(false));
  return { mesh, p0, p1, bendRadius };
}

/**
 * Deutet ein bereits vorhandenes Rohrstück an einem Marker an: läuft vom Marker aus ein
 * kurzes Stück in die übergebene Richtung und blendet dabei auf 0 Opazität aus.
 * Technik: mehrere kurze, sich leicht überlappende Zylinder-Segmente mit absteigender
 * Opazität statt eines echten Shaders - reicht für die reine Andeutung völlig aus.
 */
export function createFadingStub(origin, dir, length, radius, segments = 12) {
  const group = new THREE.Group();
  const d = dir.clone().normalize();
  const stepLen = length / segments;
  for (let i = 0; i < segments; i++) {
    const a = origin.clone().add(d.clone().multiplyScalar(i * stepLen));
    const b = origin.clone().add(d.clone().multiplyScalar((i + 1) * stepLen));
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const opacity = Math.max(0, 1 - (i + 0.5) / segments) * 0.7;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8b98a8, metalness: 0.4, roughness: 0.5, transparent: true, opacity, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, stepLen * 1.05, 12), mat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    group.add(mesh);
  }
  return group;
}

/** Die 6 Welt-Kardinalrichtungen - Startauswahl für den allerersten Routing-Schritt. */
export const CARDINALS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];

/** Liefert 4 zu `forward` senkrechte Einheitsvektoren (für 90°-Abzweigungen). */
export function perpDirs(forward) {
  const ref = Math.abs(forward.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(ref, forward).normalize();
  const v = new THREE.Vector3().crossVectors(forward, u).normalize();
  return [u.clone(), u.clone().negate(), v.clone(), v.clone().negate()];
}

/** Farbcodierung einer Richtung nach vorherrschender Achse (für Griffe/Pfeile). */
export function colorForDirection(v) {
  if (Math.abs(v.x) > 0.95) return 0xd23c3c;
  if (Math.abs(v.y) > 0.95) return 0x1f9d52;
  if (Math.abs(v.z) > 0.95) return 0x2468e8;
  return 0xd98a1e;
}

/** Ein einfacher Linie+Pfeilspitze-Achsenpfeil, relativ zu `start` positioniert. */
export function createArrow(start, dir, length, color) {
  const group = new THREE.Group();
  const lineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(length),
  ]);
  group.add(new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color })));
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(length * 0.06, 0.005), Math.max(length * 0.16, 0.013), 12),
    new THREE.MeshBasicMaterial({ color })
  );
  cone.position.copy(dir.clone().multiplyScalar(length));
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  group.add(cone);
  group.position.copy(start);
  return group;
}

/** Kugel + XYZ-Achsenpfeile für einen ArUco-Marker (Start=blau, Ziel=orange). */
export function createMarkerVisual(marker, isStart, markerRadius, arrowLength) {
  const g = new THREE.Group();
  g.position.copy(marker.position);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(markerRadius, 16, 16),
    new THREE.MeshStandardMaterial({ color: isStart ? 0x2468e8 : 0xd9821e })
  );
  g.add(sphere);
  g.add(createArrow(new THREE.Vector3(0, 0, 0), marker.xAxis, arrowLength, 0xd23c3c));
  if (marker.yAxis) g.add(createArrow(new THREE.Vector3(0, 0, 0), marker.yAxis, arrowLength, 0x1f9d52));
  else console.warn(`Marker ${marker.id}: yAxis fehlt – wird nicht gezeichnet.`);
  if (marker.zAxis) g.add(createArrow(new THREE.Vector3(0, 0, 0), marker.zAxis, arrowLength, 0x2468e8));
  else console.warn(`Marker ${marker.id}: zAxis fehlt – wird nicht gezeichnet.`);
  return g;
}

/** Ein Textlabel als Sprite (immer zur Kamera gedreht) mit hellem Pillenhintergrund. */
export function createLabelSprite(text, color, worldHeight) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontPx = 54;
  ctx.font = `600 ${fontPx}px system-ui,-apple-system,sans-serif`;
  const textW = ctx.measureText(text).width;
  canvas.width = Math.ceil(textW) + 56;
  canvas.height = fontPx * 1.9;
  ctx.font = `600 ${fontPx}px system-ui,-apple-system,sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height * 0.25);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 28, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = worldHeight, w = h * (canvas.width / canvas.height);
  sprite.scale.set(w, h, 1);
  return sprite;
}

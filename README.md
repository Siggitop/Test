# RohrRouting – Foto → 3D

Web-App zur Verbindung zweier per ArUco-Marker markierter Rohrenden: Foto mit dem
Smartphone aufnehmen, Marker werden im Browser erkannt und deren Pose berechnet, die
reale Schwerkraftrichtung wird über den Bewegungssensor aufgezeichnet, und in einer
interaktiven 3D-Ansicht lässt sich die Rohrverbindung automatisch vorschlagen oder
manuell mit 90°/45°-Bögen verlegen.

Läuft komplett im Browser, kein Server, kein Build-Schritt - nur Kamera und Bewegungs-
sensor brauchen einen sicheren Kontext (siehe [Starten](#starten) unten).

## Projektstruktur

```
index.html                       Schlanke HTML-Shell (nur Struktur, kein Code)
css/style.css                    Gesamtes Styling

js/main.js                       Einstiegspunkt: verdrahtet alles miteinander

js/vision/                       Bilderkennung & Pose-Schätzung (kein DOM-Zugriff)
  linalg.js                        Vektor-/Matrix-Hilfsfunktionen, Gauß-Elimination
  opencv-ready.js                  Wartet auf die asynchrone opencv.js-WASM-Initialisierung
  detection.js                     ArUco-Erkennung über opencv.js (ArucoDetector)
  pose-estimation.js               Posen-Schätzung über opencv.js (solvePnP/IPPE_SQUARE)
  multi-view-fusion.js             Fusioniert 1-3 Fotos zu einer robusteren Marker-Geometrie

js/calibration/                  Kamera-Kalibrierung
  npz-loader.js                    ZIP+NPY-Parser für camera_calib.npz
  calibration-sheet.js             Eigenes Kalibrierblatt: generieren + auswerten

js/capture/                      Aufnahme-Bildschirm
  camera.js                        getUserMedia-Handling
  gravity.js                       Bewegungssensor / Schwerkraftvektor
  capture-controller.js            Verdrahtet den kompletten Aufnahme-Bildschirm

js/scene/                        3D-Ansicht (Three.js)
  geometry-helpers.js              Zustandslose Zeichen-Funktionen (Rohr, Bogen, Pfeile, ...)
  horizontal-plane.js              Schwerkraftbasierte horizontale Referenzebene
  auto-route.js                    Auto-Routing-Algorithmus (reine Funktion)
  scale-bar.js                     Maßstabsbalken-HUD
  PipeRoutingApp.js                 Die eigentliche 3D-App (Szene, Routing, Interaktion)

tests/                           Node-Tests für die Three.js-unabhängigen Kernmodule
  fixtures/                        Mit echtem numpy erzeugte Test-.npz-Dateien
  *.test.mjs
```

**Architekturprinzip:** `js/vision/`, `js/calibration/` und die meisten `js/scene/`-Module
sind bewusst *zustandslos* bzw. unabhängig vom DOM/Three.js-Szenenzustand gehalten (reine
Funktionen mit Ein-/Ausgabe) - das macht sie einzeln mit Node testbar (siehe `tests/`) und
wiederverwendbar. Der gesamte veränderliche Zustand der 3D-Ansicht (aktuelle
Routing-Position, Verlauf, Szene-Objekte, ...) ist an einer einzigen Stelle gebündelt:
der Klasse `PipeRoutingApp`.

## Starten

Kamera und Bewegungssensor funktionieren nur in einem "sicheren Kontext" (HTTPS oder
`localhost`) - direktes Öffnen der `index.html` per Doppelklick (`file://`) reicht nicht.
Irgendein simpler lokaler Server genügt, zum Beispiel:

```bash
npx serve .
# oder
python3 -m http.server 8000
```

und dann `http://localhost:<port>` öffnen. Für einen Test auf dem eigenen Smartphone im
selben WLAN die Rechner-IP statt `localhost` verwenden, oder z.B. via `ngrok`/Cloudflare
Tunnel eine HTTPS-URL erzeugen.

Ohne Kamera lässt sich die 3D-Ansicht auch direkt über den Link "Demo-Daten laden" auf dem
Aufnahme-Bildschirm testen.

## Tests

Die Three.js-unabhängigen Kernmodule (Pose-Schätzung, lineare Algebra, npz-Parser,
Auto-Routing-Geometrie) haben Node-Tests, die die **echten** Projektdateien importieren
(kein Copy-Paste-Code) und gegen synthetische Ground Truth bzw. echte, mit numpy erzeugte
Testdateien prüfen:

```bash
npm install   # installiert fflate + three NUR für die Tests, siehe package.json
npm test
```

Die restlichen Module (`geometry-helpers.js`, `horizontal-plane.js`, `PipeRoutingApp.js`)
hängen eng am DOM/WebGL und werden am besten direkt im Browser geprüft (Kamera- bzw.
Demo-Daten-Flow durchspielen, Konsole beobachten).

## Bekannte Einschränkungen (bewusst, mit Fundstelle im Code)

- **`.npz`-Kalibrierfotos in anderer Auflösung/Seitenverhältnis als der Live-Kamerastream
  (z.B. normale Handyfotos im Fotomodus vs. der 1920×1080-Videostream) verursachen einen
  SYSTEMATISCHEN Tiefenfehler**, den Mehrbild-Fusion (`js/vision/multi-view-fusion.js`)
  NICHT ausgleichen kann (die mittelt nur zufälliges Eckenrauschen zwischen Fotos weg,
  keine in jedem Foto gleiche Kalibrierungs-Bias) - zeigt sich z.B. als Höhenversatz
  zweier eigentlich koplanarer Marker (als "Höhenversatz" in der Infotafel sichtbar,
  `PipeRoutingApp.js`). Grund: `applyCalibration()` (`capture-controller.js`) skaliert
  fx/fy/cx/cy beim Laden unabhängig je Achse auf die Stream-Auflösung - das ist nur bei
  einer reinen Größenänderung exakt richtig, nicht wenn Foto- und Video-Modus
  unterschiedliche Sensor-Ausschnitte/Seitenverhältnisse nutzen (sehr üblich bei
  Smartphones). `capture-controller.js` warnt deshalb sichtbar (nicht nur in der Konsole),
  wenn Kalibrierfoto- und Stream-Seitenverhältnis deutlich abweichen, und bestätigt
  umgekehrt sichtbar mit fx/fy-Werten, wenn eine Kalibrierung geladen wurde. Für
  belastbare Tiefe/Höhe: Kalibrierfotos möglichst in derselben Auflösung wie der
  Live-Kamerastream aufnehmen, dann entfällt die Umrechnung (und damit diese
  Fehlerquelle) komplett.
- **Kalibrierblatt schätzt keine Verzeichnung.** `calibration-sheet.js` liefert nur
  fx/fy + angenommene Bildmitte (Fluchtpunkt-Methode aus einer einzigen Ansicht). Für
  Verzeichnungskorrektur: `.npz`-Weg mit echter OpenCV-Kalibrierung nutzen.
- **Kein echtes OpenCV-ChArUco-Board.** Bewusste Design-Entscheidung, siehe Kommentar in
  `calibration-sheet.js`: ein eigenes Marker-Raster statt eines ChArUco-Boards, dessen
  exaktes Layout ohne Hardware-Test zu riskant nachzubilden gewesen wäre. Wer bereits ein
  echtes ChArUco-Board besitzt, kommt damit nicht weiter - dafür ist der `.npz`-Weg da.
- **Schwerkraft fließt bewusst NICHT in die Marker-Rotation ein.** Nur als horizontale
  Referenzebene und als informative Winkelanzeige in der Konsole - siehe die ausführliche
  Begründung in `horizontal-plane.js` und `PipeRoutingApp.js`.
- **Auto-Routing findet nicht jede geometrisch mögliche Lösung.** Der 3-Segment-Zweig
  scheitert an Fällen, die ein "Überschwingen" bräuchten (S-förmiger Umweg) - liefert dann
  bewusst `null` statt falscher Geometrie. Siehe Kommentar + Testfall "Bekannte Grenze" in
  `js/scene/auto-route.js` bzw. `tests/auto-route.test.mjs`. Die Route lässt sich in jedem
  Fall weiterhin manuell verlegen.
- **Geräte-zu-Kamera-Koordinaten-Zuordnung für die Schwerkraft ist eine Annahme**
  (normale Fotohaltung, Hochformat) - siehe Kommentar in `js/capture/gravity.js`, falls
  auf einem konkreten Gerät die Vorzeichen nicht passen.

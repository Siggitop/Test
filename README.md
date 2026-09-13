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
  dictionary-6x6-250-data.js       Rohdaten des echten OpenCV DICT_6X6_250
  aruco-setup.js                   Registriert das Dictionary bei js-aruco2
  detection.js                     Mehrskalen-Markererkennung
  pose-estimation.js               Homographie, Entzerrung, Posen-Schätzung

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

- **Markererkennung ist einfacher als OpenCV.** `js-aruco2` (die Browser-Bibliothek)
  hat einen deutlich simpleren, fest verdrahteten Schwellwert-Filter statt OpenCVs
  mehrstufiger, robusterer Pipeline. `js/vision/detection.js` gleicht das teilweise durch
  eine Mehrskalen-Suche aus, ist aber kein vollwertiger Ersatz.
- **DICT_6X6_250-Bitreihenfolge nicht an echter Hardware getestet.** Die Codes in
  `dictionary-6x6-250-data.js` wurden bit-genau aus dem OpenCV-Quellcode extrahiert und
  die minimale Hamming-Distanz (11) stimmt exakt mit OpenCVs dokumentiertem Wert überein
  - ein starkes Indiz für Korrektheit, aber kein Test an einem echten Foto mit echtem
  ausgedrucktem Marker in dieser Entwicklungsumgebung. Siehe Kommentar dort für den ersten
  Verdachtspunkt, falls doch nichts erkannt wird.
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

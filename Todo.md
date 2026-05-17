# Tool & Constraint Implementierung

## Zeichenwerkzeuge

- [x] **Select** — Objekte anklicken, Drag-Selektion, Move
- [x] **Line** — Zwei-Punkt-Linie
- [x] **Circle** — Mittelpunkt + Radius
- [x] **Rect** — Achsenparalleles Rechteck (2 Punkte)
- [x] **Triangle** — Gleichseitiges Dreieck, Mittelpunkt + Radius
- [ ] **Polyline** — Offener Linienzug, mehrere Punkte
- [x] **Polygon** — 5/6/8-Eck (M zum Wechseln), Mittelpunkt + Radius; Eckpunkt-Drag = Radius + Drehung
- [ ] **Spline** — Kurve durch mehrere Punkte
- [ ] **Fillet** — Verrundung zwischen zwei Linien

## Geometrische Constraints

- [ ] **Horizontal** — Linie erzwingen waagerecht
- [ ] **Vertical** — Linie erzwingen senkrecht
- [ ] **Parallel** — Zwei Linien parallel
- [ ] **Coincident** — Zwei Punkte auf gleicher Position
- [ ] **Equal Length** — Zwei Linien gleich lang

## Bemaßungs-Constraints

- [ ] **Dimension (horizontal)** — Horizontaler Abstand
- [ ] **Dimension (vertikal)** — Vertikaler Abstand
- [ ] **Radius** — Kreis-Radius
- [ ] **Diameter** — Kreis-Durchmesser
- [ ] **Angle** — Winkel einer Linie / zwischen zwei Linien

## CAM / Toolpaths

- [ ] **CAM-Grundsatz** — Toolpaths deterministisch über Geometrie-/CAM-Algorithmen erzeugen, nicht direkt per LLM.
- [ ] **Lokale KI als CAM-Assistent** — Später optional für Parametervorschläge, Operationserklärung, G-Code-Prüfung und Plausibilitätswarnungen.
- [ ] **Toolpath-Datenmodell** — Operation, Tool, Stock, Geometry, Toolpath, Linking-Moves und Safety-Informationen definieren.
- [ ] **Werkzeug-/Material-/Maschinenprofile** — Fräserdaten, Materialwerte, Vorschub/Drehzahl, Maschinenlimits und Postprozessor-Grundlagen.
- [ ] **2D-Konturstrategie** — Außen-/Innenkonturen mit Werkzeugradiuskompensation erzeugen.
- [ ] **Pocketing Basis** — 2D-Taschen mit konstantem Step-over, Inseln und Innenkonturen unterstützen.
- [ ] **Materialabtragsvorschau** — Simulieren/visualisieren, welche Bereiche bereits geräumt sind.
- [ ] **Restmaterial-Erkennung** — Nachfolgende Bahnen nur für noch vorhandenes Material berechnen.
- [ ] **Adaptive-ähnliches Clearing** — Werkzeugumschlingung begrenzen, Vollnut vermeiden, Übergänge glätten.
- [ ] **Echtes Adaptive Clearing** — Dynamische Engagement-Berechnung, Kollisionsprüfung, Lastmodell und stabile Linking-Moves.

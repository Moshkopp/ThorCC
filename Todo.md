# Todo

## Sketcher Design: CAD Sober Pass

Der Sketcher soll weg vom neonartigen Debug-/Game-HUD-Look und hin zu einer ruhigen, technischen CAD-Arbeitsfläche.

### Geometrie

- Sketch-Linien in klarem, aber ruhigerem Cyan darstellen.
- Linien dünner und weniger leuchtend zeichnen.
- Selektierte Geometrie in Amber/Orange markieren, ohne starken Glow.
- Preview-Geometrie hellgrau, gestrichelt oder halbtransparent darstellen.
- Fehler und Overconstraints später gezielt rot markieren, nicht dauerhaft dominant.

### Bemaßung

- Bemaßungen nicht wie große Buttons darstellen.
- Maßwert als kleiner technischer Text direkt an oder über der Maßlinie anzeigen.
- Maßlinien dünn und präzise darstellen.
- Extension Lines klar sichtbar machen.
- Pfeile oder technische Ticks an den Maßlinien-Enden ergänzen.
- Label-Hintergrund nur sehr subtil verwenden oder ganz entfernen.
- Dimensions-Constraints nicht zusätzlich als Constraint-Badge anzeigen.

### Constraints

- Constraint-Anzeigen nicht als Badge-Wolken darstellen.
- Kleine monochrome Glyphen nahe an der betroffenen Geometrie verwenden.
- Geeignete technische Symbole verwenden: `H`, `V`, `=`, `∥`, `⊥`, Winkel.
- Constraint-Glyphen in Screen-Pixeln stabil halten, damit sie beim Zoomen nicht riesig wirken.
- Doppelte Marker pro Entity/Constraint-Typ vermeiden.

### Viewport

- Grid dezenter machen.
- Hauptachsen etwas klarer als das Grid darstellen.
- Kontrast so einstellen, dass Geometrie, Maße und Constraints sauber unterscheidbar sind.
- Keine dekorativen Glows oder spielerischen Effekte im Arbeitsbereich.

### Sidebar und Tooling

- Sidebar weniger wie Game-HUD gestalten.
- Glow-Effekte reduzieren.
- Letterspacing reduzieren.
- Toolbar dichter und technischer aufbauen.
- Buttons kompakter und funktionaler gestalten.
- Status und History dezenter darstellen oder einklappbar machen.

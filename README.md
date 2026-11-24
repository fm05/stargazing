# ✦ Sternenhimmel – Astrofoto-Vorhersage

Web-App (PWA) fürs iPhone, die für deinen Standort berechnet, wie gut die Chancen auf **Sternen- und Milchstraßenfotos** in den nächsten Nächten sind. Kein App Store und kein Apple-Developer-Konto nötig.

## Funktionen

**Nacht**
- **Score 0–100** für „Sterne“ und „Milchstraße“, inkl. bester Zeit und begrenzenden Faktoren
- **Vorhersage-Sicherheit** durch Vergleich der Wettermodelle ICON, ECMWF, GFS und Météo-France
- **Stunde-für-Stunde-Matrix** mit allen Parametern, **Höhendiagramm** von Mond und Milchstraße
- **Kalender-Export** (.ics mit Erinnerung) und **Spot teilen**

**Woche**
- **7-Nächte-Übersicht** mit Mini-Verlauf, beste Nacht markiert, 30-Tage-Mondkalender
- **Gespeicherte Spots vergleichen** – alle Lieblingsorte für 3 Nächte nebeneinander

**Karte**
- Ebenen: **Lichtverschmutzung**, **Wolken-Satellitenbild** (Meteosat-Infrarot, mit Zeitregler), **Regenradar** (animiert)
- **Spot-Finder:** dunkelste und wolkenärmste Orte im Umkreis von 25/50/100 km für die gewählte Nacht
- **Beliebte Spots** aus OpenStreetMap: Sternenparks, Sternwarten, Aussichtspunkte, Aussichtstürme, Gipfel – sortiert nach Dunkelheit
- Ort antippen → Bortle-Klasse, als Standort übernehmen, merken oder teilen

**Himmel**
- **Himmelsansicht** mit Milchstraßenband, Planeten, Mond und Deep-Sky-Objekten – mit Zeitregler und **Kompassmodus** (dreht sich mit dem Handy)
- **Planeten** und **Deep-Sky-Objekte** der Nacht mit bester Uhrzeit, Höhe, Richtung und passender Brennweite
- **ISS-, Tiangong- und Hubble-Überflüge** sowie Warnung vor frisch gestarteten Starlink-Zügen
- **Polarlicht:** Kp-Vorhersage, Echtzeit-Sonnenwind (Bz, Geschwindigkeit), OVATION-Wahrscheinlichkeit, Polarlicht-Oval

**Mehr**
- **Kamera & Rechner:** NPF-/500er-Regel, ISO, Bildwinkel, Zeitraffer, Panorama, Sternspuren, Stacking
- **Packliste**, die sich an die Nacht anpasst (Kälte, Tau, Wind, Mond, Polarlicht, Meteore)
- **Fototagebuch** mit Foto, Einstellungen und automatisch gespeicherten Bedingungen
- **Sichern & Teilen:** Export/Import aller Daten als Datei, Spot-Links, Koordinaten einfügen, dauerhafter Speicher
- **Rotlicht-Modus**, Ortssuche, GPS, Lieblingsorte, **Bortle-Klasse automatisch** aus dem Lichtverschmutzungs-Atlas
- Funktioniert offline mit den zuletzt geladenen Daten

Alle Daten bleiben auf dem Gerät (localStorage/IndexedDB) – es gibt keinen eigenen Server.

### Berücksichtigte Parameter

| Parameter | Quelle |
|---|---|
| Wolken gesamt / tief / mittel / hoch | Open-Meteo |
| Niederschlagswahrscheinlichkeit & Menge | Open-Meteo |
| Luftfeuchte, Taupunkt-Abstand (Beschlaggefahr) | Open-Meteo |
| Wind & Böen | Open-Meteo |
| Sichtweite | Open-Meteo |
| Temperatur | Open-Meteo |
| Jetstream (250 hPa) | Open-Meteo |
| Aerosol-optische Dicke, Saharastaub | Open-Meteo Air Quality |
| Seeing (geschätzt aus Jetstream, 500/850-hPa-Wind) | Open-Meteo |
| Kp-Index → Polarlicht-Chance | NOAA SWPC |
| Sonnenstand, Dämmerungen, astronomische Nacht | lokal berechnet |
| Mondphase, -beleuchtung, -auf/-untergang, -höhe | lokal berechnet |
| Sichtbarkeit & Höhe des Milchstraßenzentrums, Saisonbeginn | lokal berechnet |
| Hellster sichtbarer Milchstraßen-Abschnitt (Sommer: Zentrum, Winter: Kassiopeia/Perseus …) | lokal berechnet |
| Meteorströme, nächster Neumond | lokal berechnet |
| Lichtverschmutzung (Bortle) | Atlas der künstlichen Himmelshelligkeit, D. Lorenz (VIIRS 2025) |
| Wolkenbewertung mehrerer Modelle | Open-Meteo (ICON, ECMWF, GFS, Météo-France) |
| Planetenpositionen & -helligkeit | lokal berechnet (JPL-Bahnelemente, Mallama-Helligkeiten) |
| Satellitenbahnen | CelesTrak (TLE) + satellite.js (SGP4) |
| Sonnenwind, OVATION-Polarlichtmodell | NOAA SWPC |
| Wolken-Satellitenbild | EUMETSAT (Meteosat MTG, Infrarot 10,5 µm) |
| Regenradar | RainViewer |
| Beliebte Spots | OpenStreetMap (Overpass API) |
| Karte | OpenStreetMap + Leaflet |
| Ortsnamen | BigDataCloud, Ausweich: OSM Nominatim |

## Aufs iPhone bringen (kostenlos über GitHub Pages)

1. Auf GitHub im Repository **Settings → Pages** öffnen.
2. Bei *Source* „Deploy from a branch“ wählen, den Branch mit der App und den Ordner `/ (root)` auswählen, **Save**.
3. Nach ca. 1 Minute ist die App unter `https://<benutzername>.github.io/stargazing/` erreichbar.
4. Auf dem iPhone die Adresse in **Safari** öffnen → **Teilen** → **Zum Home-Bildschirm**.
5. Beim ersten Start die Ortung erlauben.

> GitHub Pages ist für öffentliche Repositories kostenlos; für private Repositories braucht man GitHub Pro.
> Die Ortung funktioniert nur über HTTPS (bei GitHub Pages automatisch der Fall).

## Lokal testen

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Wie der Score entsteht

Für jede Nachtstunde werden Faktoren zwischen 0 und 1 berechnet (Dunkelheit, Wolken, Niederschlag, Mond, Transparenz, Sichtweite, Feuchte, Wind, Lichtverschmutzung, im Milchstraßen-Modus zusätzlich Höhe und Helligkeit des besten sichtbaren Milchstraßen-Abschnitts) und multipliziert. Der Wert der Nacht ist das beste zusammenhängende 2-Stunden-Fenster ab nautischer Dunkelheit. Die Logik steht in `js/score.js`.

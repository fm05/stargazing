# ✦ Sternenhimmel – Astrofoto-Vorhersage

Web-App (PWA) fürs iPhone, die für deinen Standort berechnet, wie gut die Chancen auf **Sternen- und Milchstraßenfotos** in den nächsten Nächten sind. Kein App Store und kein Apple-Developer-Konto nötig.

## Funktionen

- **Score 0–100** für „Sterne“ und „Milchstraße“, inkl. bester Zeit und begrenzenden Faktoren
- **Stunde-für-Stunde-Matrix** mit allen Parametern
- **Höhendiagramm** von Mond und galaktischem Zentrum über die Nacht (antippen für Details)
- **7-Nächte-Übersicht** mit Markierung der besten Nacht und 30-Tage-Mondkalender
- **Kamera-Rechner** (NPF- und 500er-Regel, ISO-Vorschlag, Bildwinkel, Einstellungen)
- **Rotlicht-Modus** zum Schutz der Dunkeladaption
- Ortssuche, GPS, gespeicherte Lieblingsorte, Bortle-Klasse pro Ort
- Funktioniert offline mit den zuletzt geladenen Daten

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
| Seeing & Transparenz | 7Timer! ASTRO |
| Kp-Index → Polarlicht-Chance | NOAA SWPC |
| Sonnenstand, Dämmerungen, astronomische Nacht | lokal berechnet |
| Mondphase, -beleuchtung, -auf/-untergang, -höhe | lokal berechnet |
| Sichtbarkeit & Höhe des Milchstraßenzentrums, Saisonbeginn | lokal berechnet |
| Meteorströme, nächster Neumond | lokal berechnet |
| Lichtverschmutzung (Bortle) | manuell, mit Link zur Lichtverschmutzungskarte |

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

Für jede Nachtstunde werden Faktoren zwischen 0 und 1 berechnet (Dunkelheit, Wolken, Niederschlag, Mond, Transparenz, Sichtweite, Feuchte, Wind, Lichtverschmutzung, im Milchstraßen-Modus zusätzlich die Höhe des galaktischen Zentrums) und multipliziert. Der Wert der Nacht ist das beste zusammenhängende 2-Stunden-Fenster. Die Logik steht in `js/score.js`.

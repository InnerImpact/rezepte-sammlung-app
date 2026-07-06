# Rezepte Sammlung — App

Statische PWA (kein Backend). Liest und schreibt die Rezepte über die GitHub-API
aus einem separaten, privaten Daten-Repo. Der Zugriffs-Token wird nur im Browser
des jeweiligen Geräts gespeichert (localStorage) und liegt NICHT in diesem Code.

- `demo/` — neutrale Beispiel-Rezepte für die erste Ansicht ohne Verbindung
- `js/`, `css/` — App
- `sw.js`, `manifest.webmanifest` — Offline + Installation auf dem Homescreen

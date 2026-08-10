A browser-based augmented reality experience that shows how coral reefs lose
their colour as sea temperature rises. Built for **INTE 42312 — Virtual and
Augmented Reality**.

**Live:** https://sandaniwimalaweera.github.io/reefwatch-ar/

---

## The problem

Coral bleaching is invisible to most people. Sri Lanka's reefs at Pigeon Island
and Hikkaduwa have bleached badly during warm years, but a tourist snorkelling
above dead coral usually cannot tell it is dead, and a temperature figure in a
news report makes nobody care.

ReefWatch AR puts a reef on the floor in front of you and lets today's real sea
temperature decide whether it lives.

## Why WebXR

A tourist visiting for one day will not install a native app. They will open a
link. The whole experience runs from a QR code in a browser, on Android or iOS,
with nothing to download and no app store involved.

---

## Two modes

| Mode | Tracking | What it does |
|---|---|---|
| Scan the card | Image tracking (MindAR) | A coral head appears on a printed marker card, with fish. Tap it to bleach it. |
| Place a reef | Plane detection (WebXR hit-test) | Drop a full reef section on your floor at real scale. Live sea temperature drives its colour, and a slider lets you change the water. |

## Live data

Sea surface temperature comes from the [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)
— free, and no API key required.

```
https://marine-api.open-meteo.com/v1/marine
  ?latitude=8.72&longitude=81.21
  &current=sea_surface_temperature
  &cell_selection=sea
```

That single value is mapped to a bleach factor between 0 and 1, which drives the
coral material colour. If the request fails the app falls back to a cached value
and says so, rather than breaking.

The temperature-to-bleaching mapping is a **simplified model for visualisation**.
Real bleaching depends on accumulated heat stress over weeks, not a single
reading.

---

## Running it locally

The camera will not work over plain `http://`, so you need HTTPS even in
development.

```bash
# serve the folder
python3 -m http.server 8000

# expose it over HTTPS so your phone can open it
cloudflared tunnel --url http://localhost:8000
```

Open the generated `https://…trycloudflare.com` link on your phone.

## Printing the marker

The marker card is at `assets/marker-print.pdf`. Print it at A5 on matte paper
if you can — gloss reflects light and hurts tracking.

---

## Project structure

```
index.html          Landing page, mode selection
marker.html         Image-tracking scene
markerless.html     WebXR hit-test scene
css/style.css       Shared styling
js/                 api.js, bleach.js, marker-scene.js, xr-scene.js, ui.js
assets/             models, image targets, audio
docs/               CHALLENGES.md, TESTING.md, report
```

## Browser support

| Browser | Marker mode | Markerless mode |
|---|---|---|
| Android Chrome | Yes | Yes |
| iOS Safari | Yes | Limited — see docs/TESTING.md |
| Desktop Chrome | Yes, with a webcam | No |

---

## Credits

All third-party models, audio, libraries and data are listed in
[CREDITS.md](CREDITS.md) with their licences.

Marine data from Open-Meteo, generated using data from the German Weather
Service (DWD), CC BY 4.0.

# Credits and Licences

Every third-party asset, library and data source used in ReefWatch AR, as
required by the academic integrity section of the assignment brief.

## 3D Models

| Model | File | Author | Source | Licence |
|---|---|---|---|---|
| Coral head | `assets/models/coral.glb` | rkuhlf | https://sketchfab.com/3d-models/coral-3f051742aa3b466fa3b8df9bb990d170 | CC BY 4.0 |
| Reef section | `assets/models/reef.glb` | rkuhlf | https://sketchfab.com/3d-models/coral-dbf4bee13bf84396815073e5cabf8ac3 | CC BY 4.0 |
| Reef section, real-scale variant | `assets/models/reef-ar.glb` | rkuhlf | as above — same mesh, root transform baked for AR Quick Look | CC BY 4.0 |

The unmodified source downloads are kept in `assets/models/coral-raw/` and
`assets/models/reef-raw/` with their original `license.txt` files. Optimisation
figures are in [docs/CHALLENGES.md](docs/CHALLENGES.md#asset-optimisation-record).

There is no fish model. Every fish is built from Three.js primitives at runtime
by `buildFish()` in `js/lib-reef.js` — a lathed body, shaped fins, and spheres
for the eyes — and animated by the boids flocking in the `reef-school`
component. The same is true of the marine snow and the caustic lighting.

## Audio

No third-party audio. Every sound in the project — the underwater ambience and
the interface taps alike — is synthesised at runtime by the Web Audio API in
`js/ambience.js`. Nothing is sampled, recorded or downloaded, so there is
nothing here to license.

| Sound | How it is made |
|---|---|
| Body of water | Brown noise through a slowly swept lowpass |
| Surge | The same noise through a bandpass, breathing on a second, slower LFO |
| Snapping shrimp | Short bandpassed noise bursts, scheduled at a rate set by reef health |
| Bubbles | Sines with a rising pitch ramp, in streams of one to four |
| Interface taps | The same droplet at six pitches, through the same reverb |
| Underwater reverb | A generated impulse response: decaying noise, darkening as it decays |

## Libraries

| Library | Version | Licence | Use |
|---|---|---|---|
| A-Frame | 1.5.0 | MIT | 3D scene graph and rendering, on both pages |
| MindAR | 1.2.5 | MIT | Image target tracking on the marker page |
| `<model-viewer>` | 3.5.0 | Apache 2.0 | Converts the reef to USDZ and hands it to AR Quick Look (ARKit) on iOS, Scene Viewer on Android |

Three.js is used throughout for the procedural geometry, but only through the
copy A-Frame bundles; it is not loaded separately.

## Data

Marine data from [Open-Meteo](https://open-meteo.com/), generated using data
from the German Weather Service (DWD). Licensed CC BY 4.0.

```
https://marine-api.open-meteo.com/v1/marine
  ?latitude=8.72&longitude=81.21
  &current=sea_surface_temperature
  &cell_selection=sea
```

Attribution appears in the app's own credits sheet on both AR pages, not only
in this file, as CC BY requires.

## Fonts

Bricolage Grotesque, Public Sans and JetBrains Mono, served via Google Fonts.
All three are licensed under the SIL Open Font License 1.1.

## Declaration

The design, implementation and written report are my own work. Third-party
assets and libraries are used under the open licences recorded above.

# Credits and Licences

All third-party assets used in ReefWatch AR are listed here, as required by the
academic integrity section of the assignment brief. Add every asset the moment
you download it - do not leave this until the end.

## 3D Models

| Model | File | Author | Source | Licence |

|---|---|---|---|---|
| Coral head | `assets/models/coral.glb` | rkuhlf | https://sketchfab.com/3d-models/coral-3f051742aa3b466fa3b8df9bb990d170 | CC-BY 4.0 |
| Reef section | `assets/models/reef.glb` | rkuhlf | https://sketchfab.com/3d-models/coral-dbf4bee13bf84396815073e5cabf8ac3 | CC-BY 4.0 |
| Fish | `assets/models/fish.glb` | (fill in later) | (fill in later) | (fill in later) |


## Audio

No third-party audio. Every sound in the project — the underwater
ambience and the interface taps alike — is synthesised at runtime by
the Web Audio API in `js/ambience.js`. Nothing is sampled, recorded or
downloaded, so there is nothing here to license.

| Sound | Source | How it is made |
|---|---|---|
| Body of water | `js/ambience.js` | Brown noise through a slowly swept lowpass |
| Surge | `js/ambience.js` | The same noise through a bandpass, breathing on a second, slower LFO |
| Snapping shrimp | `js/ambience.js` | Short bandpassed noise bursts, scheduled at a rate set by reef health |
| Bubbles | `js/ambience.js` | Sines with a rising pitch ramp, in streams of one to four |
| Interface taps | `js/ambience.js` | The same droplet at five pitches, through the same reverb |
| Underwater reverb | `js/ambience.js` | A generated impulse response: decaying noise, darkening as it decays |

## Libraries

| Library | Version | Licence | Use |
|---|---|---|---|
| A-Frame | *(fill in)* | MIT | 3D scene graph and rendering |
| MindAR | *(fill in)* | MIT | Image target tracking |
| &lt;model-viewer&gt; | 3.5.0 | Apache 2.0 | Converts the reef to USDZ and hands it to AR Quick Look (ARKit) on iOS, Scene Viewer on Android |

## Data

Marine data from [Open-Meteo](https://open-meteo.com/), generated using data from
the German Weather Service (DWD). Licensed CC BY 4.0.

Endpoint used: `https://marine-api.open-meteo.com/v1/marine`
Variable: `sea_surface_temperature`

## Fonts

Bricolage Grotesque, Public Sans and JetBrains Mono - served via Google Fonts,
all licensed under the SIL Open Font License 1.1.

## Declaration

The design, implementation and written report are my own work. Third-party
assets and libraries are used under the open licences recorded above.

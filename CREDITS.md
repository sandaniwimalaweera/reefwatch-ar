# Credits and Licences

All third-party assets used in ReefWatch AR are listed here, as required by the
academic integrity section of the assignment brief. Add every asset the moment
you download it - do not leave this until the end.

## 3D Models

| Model | File | Author | Source | Licence |

|---|---|---|---|---|
| Coral head | `assets/models/coral.glb` | rkuhlf | https://sketchfab.com/3d-models/coral-3f051742aa3b466fa3b8df9bb990d170 | CC-BY 4.0 |
| Reef section | `assets/models/reef.glb` | rkuhlf | https://sketchfab.com/3d-models/coral-dbf4bee13bf84396815073e5cabf8ac3 | CC-BY 4.0 |
| Fish school | `assets/models/fish-school.glb` | LasquetiSpice | https://sketchfab.com/3d-models/animated-swimming-tropical-fish-school-loop-62ccf83b35c744d7b5ffb7be80d4ea99 | CC-BY 4.0 |

CC BY 4.0 requires the attribution below to appear wherever the work is
shared. It is reproduced in the in-app credits sheet on both AR pages, and
the licence file as downloaded is kept at
`assets/models/fish-school-raw/license.txt`.

> This work is based on "Animated Swimming Tropical Fish School Loop" (https://sketchfab.com/3d-models/animated-swimming-tropical-fish-school-loop-62ccf83b35c744d7b5ffb7be80d4ea99) by LasquetiSpice (https://sketchfab.com/LasquetiSpice) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

The model was modified for web delivery: specular-glossiness materials
converted to metallic-roughness, tangents and the normal, occlusion and
emissive maps removed, vertices welded, animation keyframes resampled,
textures reduced to 512 px WebP, and mesh attributes quantized. The
geometry and the swim cycle are unaltered. See docs/CHALLENGES.md.


## Audio

| Sound | File | Author | Source | Licence |
|---|---|---|---|---|
| Underwater ambience | `assets/audio/ambience.mp3` | *(fill in)* | Freesound | CC0 |

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

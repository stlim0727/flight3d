# 3D Assets & Attributions

Flight3d incorporates optimized open-source 3D models and atmospheric environment maps.

## Aircraft 3D Models
- **Boeing 737-800 Cockpit (`public/models/b737-cockpit-medium.glb`, `b737-cockpit-draco.glb`)**:
  - **Author**: [hakai315](https://sketchfab.com/hakai315)
  - **Source**: [Boeing 737-800 Cockpit](https://sketchfab.com/3d-models/boeing-737-800-cockpit-d463256f98654b36af019d2d88bd5bbe)
  - **License**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
  - **Modifications**: Existing glTF-Transform optimization/Draco compression; Flight3d runtime alignment, PBR material adjustments, static batching, live instrument overlays, and articulated controls. GLB bytes are unchanged in issue #9.
  - **Attribution evidence**: Both shipped GLBs carry the original author, title, source and license in `asset.extras`. See [cockpit asset notes](docs/development/cockpit-assets.md) and the [distributed notice](public/models/b737-cockpit.LICENSE.txt).

- **Boeing 737-800 (`public/models/b737-800.glb`)**:
  - **Author**: [amvlab/aircraft-models](https://github.com/amvlab/aircraft-models)
  - **License**: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
  - **Description**: Real-world scale (~35.8m wingspan, ~37.9m length) Boeing 737 airliner featuring swept wings, blended winglets, dual turbofan engines, and spinning turbine fan animations.

- **Cessna 172SP Skyhawk (`public/models/c172.glb`)**:
  - **Author**: [NLM](https://sketchfab.com/NLM)
  - **Source**: [FREE Cessna 172SP](https://sketchfab.com/3d-models/free-cessna-172sp-c9cadc2f026946da8cf9715a683739e9)
  - **License**: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
  - **Description**: Real-world scale (~11.0m wingspan, ~8.28m length) general aviation aircraft featuring high wings, fixed tricycle landing gear, articulated propeller, and detailed exterior and 3D cockpit interior with dual yokes and analog flight gauges.
  - **Modifications**: Draco mesh compression, runtime alignment, ground mooring artifact occlusion, articulated control surfaces and yokes, and cockpit eye camera calibration. See [license notice](public/models/c172.LICENSE.txt).

## Environment Maps & Textures
- **Kloofendal Partly Cloudy Sky HDR (`public/textures/environment/sky_1k.hdr`)**:
  - **Author**: Greg Zaal ([Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy))
  - **License**: [CC0 1.0 Universal (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)
  - **Description**: High-dynamic-range panoramic environment map used for Image-Based Lighting (IBL) and realistic PBR metallic/roughness reflection on the aircraft fuselage and canopy.

# Incheon parked 737s

Incheon prepares 48 static 737-800s: 33 along the mapped Terminal 1 footprint
and 15 on remote aprons. Korean Air, Jeju Air, Jin Air and flydubai liveries
alternate through the layout. Airframes use the bundled `b737-800.glb`; colors,
wordmarks and tail motifs are authored interpretations, not official airline
texture packs or particular registrations. Occupancy is scenery placement,
not a live schedule or published stand assignment.

[Emirates' fleet](https://www.emirates.com/english/experience/our-fleet/) does not
include the modeled 737. The UAE scheme uses
[flydubai's 737 fleet](https://www.flydubai.com/en/help/our-fleet/).
Jeju Air documents the 737-800 in its
[fleet leaflet](https://static.jejuair.net/cms/images/file_upload/20230721103134984.pdf).

## Placement and ground handling

`incheonParking.js` generates deterministic positions against source apron
polygons and their holes. A 27 m radius contains the complete 737 footprint;
centres are at least 58 m apart. Candidates stay clear of mapped buildings,
taxilanes, runway safety strips and the gate/pushback/taxi/lineup departure path.
Terminal stands face their sampled terminal wall. No pavement, elevation or
building footprint is changed to fit aircraft. P01–P48 are internal authored IDs.

Gear, wheel chocks and painted stop/lead-in lines make aircraft visibly parked.
Airframes remain fixed across pause, reset and camera changes. A 100 m spatial
index and one shared triangle BVH add body/wing/gear collision through the
airport's existing obstacle-probe interface. Collision does not depend on
visual quality or distance culling. The complete departure remains unobstructed.

## Shared rendering

`ParkedAirlinerAssets.js` loads the exterior once for the fleet, bakes its neutral
transforms and shares geometry between instances. No cockpit, avionics, engine
audio or flight physics is instantiated for each parked aircraft. Four body
materials and four shared-atlas decal batches preserve windows and add airline
colors/titles. Gear and ground paint add two shared batches: ten in total.
The four authored atlases are 1024×512; no external livery service is called.

| Existing quality preset | Maximum visible | Horizontal camera range |
| --- | ---: | ---: |
| High | 48 | 2,200 m |
| Balanced | 32 | 1,600 m |
| Performance | 16 | 1,000 m |

Nearest stands fill fixed instance buffers. Quality changes reuse meshes,
geometry and textures. Performance mode also disables parked-aircraft shadows.
Exterior loading is asynchronous and failure leaves the airport flyable; repeated
loads reuse one promise. Disposing before a late load completes cannot resurrect
meshes or buffers.

## Verification

```sh
node --test tests/incheonParking.test.js
npm run dev -- --host 127.0.0.1 --port 5287
APP_URL=http://127.0.0.1:5287/ chrome-session --project flight3d node scripts/verify-incheon-parked.mjs
```

The browser harness loads the production airport, waits for the actual exterior,
checks all three quality limits and shared geometry, captures each airline and
the terminal, and completes the physical departure with parked collision active.
`VISUAL_ONLY=1` skips the flight for cosmetic iterations and records `flight:null`.
Measurements compare a frozen identical view with the fleet hidden/shown; draw
call/triangle deltas are not an FPS or hardware performance guarantee.

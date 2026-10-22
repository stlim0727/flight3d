# 🏛️ Boeing 737 Ultra-Realistic Flight Simulator Architecture

This document provides a comprehensive technical overview of the Boeing 737-800 3D Flight Simulator architecture, mathematical coordinate conventions, physics engines, rendering pipeline, and instructions for future feature extensions and coding agent modifications.

---

## 1. System Overview & Data Flow

```
                +---------------------------------------+
                |     User Input / Hardware Yoke        |
                |   (Keyboard, Mouse, Gamepad, Touch)   |
                +-------------------+-------------------+
                                    |
                                    v
+-----------------------------------+-----------------------------------+
|                     FlightControls (src/controls)                     |
|  - Progressive Throttle, Dual-Axis Yoke, Rudder Pedals, Elevator Trim |
+-----------------------------------+-----------------------------------+
                                    |
          +-------------------------+-------------------------+
          | 120 Hz Fixed Timestep Integration Loop (Substeps) |
          v                                                   v
+-----------------------+                           +-------------------+
|  Atmosphere & Weather |                           |    EngineModel    |
|  - ISA 1976 Model     |                           |  - Twin CFM56-7B  |
|  - Altitude / Density |                           |  - Spool Latency  |
|  - Dynamic Pressure q |                           |  - Thrust Reverser|
+-----------+-----------+                           +---------+---------+
            |                                                 |
            +-----------------------+-------------------------+
                                    v
          +---------------------------------------------------+
          |          Aerodynamics (src/physics)               |
          |  - 6-DOF Forces: Lift, Induced/Parasite Drag, Cy  |
          |  - 6-DOF Moments: Cm (Pitch), Cl (Roll), Cn (Yaw) |
          |  - Ground Effect Factor & Stall Buffet Hysteresis |
          +-------------------------+-------------------------+
                                    |
                                    v
          +---------------------------------------------------+
          |          LandingGear (src/physics)                |
          |  - 3-Point Oleo-Pneumatic Spring-Damper Bogies    |
          |  - Tire Scrub, Braking Friction, Nosewheel Tiller |
          +-------------------------+-------------------------+
                                    |
                                    v
          +---------------------------------------------------+
          |        Rigid Body State Integration (main.js)     |
          |  - Linear: F_net = m * a  => Position (x, y, z)   |
          |  - Angular: M_net = I * α => Quaternion (q_rot)   |
          +-------------------------+-------------------------+
                                    |
          +-------------------------+-------------------------+
          | 60 FPS Render & Audio Synthesis Loop (Every Frame)|
          v                                                   v
+-----------------------+                           +-------------------+
| Cockpit Canvas Displays|                          | FlightAudio Engine|
| - PFD (Attitude Tape) |                           | - Turbofan RPM    |
| - ND (Centerline Nav) |                           | - Wind Slipstream |
| - EICAS (N1, EGT, CAS)|                           | - Boeing GPWS     |
+-----------+-----------+                           +-------------------+
            |
            v
+-----------------------------------------------------------------------+
|                       Three.js WebGL Renderer                         |
|  - Boeing 737-800 3D Model with Articulated Control Surfaces          |
|  - Gerstner Wave Ocean with Fresnel Sun Reflections & Moving Ships    |
|  - 22km Terrain with Plateau Airport, PAPI, Flashing ALS Rabbit Strobes|
|  - 4,000+ Instanced Trees and City Buildings                          |
+-----------------------------------------------------------------------+
```

---

### Render timing and camera tracking

Physics runs at 120 Hz. `RenderPose` interpolates position and quaternion between
the previous and current physics steps using the remaining accumulator fraction.
The aircraft mesh and cameras share that displayed pose, with up to one physics
step (8.33 ms) of visual delay. Telemetry and collisions use current physics state.
Because gear and aerodynamics also read the aircraft mesh, `integratePhysics`
restores its authoritative transform before querying forces. Presets and
deterministic `stepSimulation` calls discard interpolation history.

Moving exterior cameras (chase, drone and parked/slow-taxi flyby) carry aircraft
translation immediately and damp only their relative framing. Airborne and
rollout flyby shots remain fixed in world space. Regressions should cover uneven
frame intervals, 90/144/165 Hz displays, view changes and preset resets; constant
60 Hz stepping alone can conceal both translation lag and fixed-step judder.

## 2. Coordinate Conventions & Aeronautical Math

The simulator couples the standard **Three.js WebGL World Frame** with the standard **ISO/AIAA Aeronautical Body Frame**.

### 2.1 World Frame (Three.js Cartesian)
- **$+X$**: East (Runway 09L centerline heading $090^\circ$)
- **$+Y$**: Upwards (Altitude above Sea Level)
- **$+Z$**: South
- **$-Z$**: North

### 2.2 Aircraft Body Frame
Relative to the Aircraft Center of Gravity (CG):
- **$+X_{body}$**: Starboard (Right Wingtip)
- **$+Y_{body}$**: Zenith (Through cockpit roof / cabin ceiling)
- **$-Z_{body}$**: Forward (Longitudinal axis through radome nose)

### 2.3 Aeronautical Velocity Transformation
Let $\mathbf{v}_{air,world} = \mathbf{v}_{aircraft} - \mathbf{v}_{wind}$. In the aircraft local frame:
$$\mathbf{v}_{body} = \mathbf{q}_{aircraft}^{-1} \cdot \mathbf{v}_{air,world}$$
The aerodynamic forward, lateral, and normal velocity components are:
$$u = -v_{body,z} \quad (\text{forward speed})$$
$$v = +v_{body,x} \quad (\text{rightward lateral speed})$$
$$w = -v_{body,y} \quad (\text{downward normal speed})$$

The total True Airspeed ($V_{tas}$), Angle of Attack ($\alpha$), and Sideslip Angle ($\beta$) are:
$$V_{tas} = \sqrt{u^2 + v^2 + w^2}$$
$$\alpha = \text{atan2}(w, \max(0.5, u))$$
$$\beta = \arcsin\left(\text{clamp}\left(\frac{v}{V_{tas}}, -1.0, 1.0\right)\right)$$

### 2.4 Heading Computation
Euler angles suffer from gimbal ambiguity during steep climbs/dives. Heading is computed by projecting the aircraft forward vector onto the horizontal $XZ$ plane:
$$\mathbf{fwd}_{world} = \mathbf{q}_{aircraft} \cdot (0, 0, -1)$$
$$\text{Heading} = \left(\text{radToDeg}(\text{atan2}(\mathbf{fwd}_x, -\mathbf{fwd}_z)) + 360^\circ\right) \pmod{360^\circ}$$

---

## 3. Physics Engine Specifications

### 3.1 Atmosphere Model (`src/physics/Atmosphere.js`)
Implements the 1976 International Standard Atmosphere (ISA):
- **Troposphere ($h \le 11,000\text{ m}$)**:
  $$T(h) = T_0 - L \cdot h \quad (T_0 = 288.15\text{ K}, L = 0.0065\text{ K/m})$$
  $$P(h) = P_0 \left(\frac{T(h)}{T_0}\right)^{\frac{g_0}{L \cdot R}}$$
  $$\rho(h) = \frac{P(h)}{R \cdot T(h)}$$
- **Lower Stratosphere ($11,000\text{ m} < h \le 25,000\text{ m}$)**:
  $$T(h) = T_{tropo} = 216.65\text{ K}$$
  $$P(h) = P_{tropo} \cdot \exp\left(-\frac{g_0 (h - 11000)}{R \cdot T_{tropo}}\right)$$
- **Airspeed Conversions**:
  $$\text{IAS} = V_{tas} \sqrt{\frac{\rho(h)}{\rho_0}}$$
  $$\text{Mach} = \frac{V_{tas}}{\sqrt{\gamma R T(h)}}$$

### 3.2 Aerodynamic Coefficients & Ground Effect (`src/physics/Aerodynamics.js`)
- **Lift Coefficient**:
  $$C_L = C_{L0}(\delta_{flap}) + C_{L\alpha} \cdot \alpha - 0.38 \cdot \delta_{spoiler}$$
  Post-stall hysteresis blends into flat-plate crossflow ($2 \sin\alpha \cos\alpha$).
- **Induced Drag & Ground Effect**:
  $$\phi_{ground} = \frac{(16 h / b)^2}{1 + (16 h / b)^2}$$
  $$C_{Di} = \frac{C_L^2}{\pi \cdot AR \cdot e} \cdot \phi_{ground}$$
  $$C_D = C_{D0} + C_{D,flap} + C_{D,gear} + C_{D,spoiler} + C_{Di} + C_{D,mach}$$
- **Stability Derivatives & Control Moments**:
  $$M_x (\text{Pitch}) = q \cdot S \cdot \bar{c} \cdot \left[ C_{m0} + C_{m\alpha}\alpha + C_{m\delta e}\delta_e + C_{mq} \frac{q \bar{c}}{2 V_{tas}} \right]$$
  $$M_y (\text{Yaw}) = q \cdot S \cdot b \cdot \left[ C_{n\beta}\beta + C_{n\delta r}\delta_r + C_{nr} \frac{r b}{2 V_{tas}} \right]$$
  $$M_z (\text{Roll}) = q \cdot S \cdot b \cdot \left[ C_{l\beta}\beta + C_{l\delta a}\delta_a + C_{lp} \frac{p b}{2 V_{tas}} \right]$$

### 3.3 Engine Model (`src/physics/EngineModel.js`)
- Simulates two high-bypass CFM56-7B turbofans ($121\text{ kN}$ max static thrust each).
- Realistic spool latency modeled via non-linear first-order lag with rotor inertia:
  $$\Delta N_1 = (N_{1,target} - N_1) \cdot \Delta t \cdot k_{spool} \cdot \left(0.8 + 0.4 \frac{N_1}{100}\right)$$
- Spool times: Idle to TOGA in $3.2\text{ s}$, TOGA to idle in $2.4\text{ s}$.
- Ground thrust reverser blocks forward thrust and generates $-35\%$ reverse braking thrust.

### 3.4 Tricycle Landing Gear (`src/physics/LandingGear.js`)
- 3 independent oleo-pneumatic contact points:
  - Nose: $(0, -2.1, -12.5)\text{m}$, $k = 420\text{ kN/m}$, $c = 48\text{ kN}\cdot\text{s/m}$.
  - Left Main: $(-3.2, -2.2, 1.8)\text{m}$, $k = 650\text{ kN/m}$, $c = 62\text{ kN}\cdot\text{s/m}$.
  - Right Main: $(3.2, -2.2, 1.8)\text{m}$, $k = 650\text{ kN/m}$, $c = 62\text{ kN}\cdot\text{s/m}$.
- Dynamic tire friction: rolling friction $\mu_{roll} = 0.02$, maximum braking $\mu_{brake} = 0.55$, lateral tire scrub $\mu_{lat} = 0.75$.
- Speed-sensitive nosewheel tiller reduces authority from $55^\circ$ during low-speed taxi to $<10^\circ$ at takeoff rotation to prevent high-speed rollover.

---

## 4. Extension Guide for Coding Agents

### 4.1 Adding a New Aircraft Type
To add an aircraft (e.g. Airbus A320, Boeing 777, F-16):
1. Open `src/config/aircraftConfigs.js`.
2. Add a new configuration entry conforming to the `AircraftConfig` schema:
   ```javascript
   export const AIRBUS_A320 = {
     id: 'a320-200',
     name: 'Airbus A320-200',
     massProperties: { emptyMassKg: 42600, maxTakeoffMassKg: 78000, currentMassKg: 64000, Ixx: 1250000, Iyy: 2400000, Izz: 3500000 },
     aerodynamics: { wingspanM: 35.8, wingAreaM2: 122.6, meanChordM: 3.89, oswaldEfficiency: 0.84, cl0Clean: 0.24, claPerRad: 5.70, alphaStallDeg: 15.0, cd0Clean: 0.0180, ... },
     engines: { numEngines: 2, modelName: 'CFM LEAP-1A', maxStaticThrustN: 120600, ... },
     landingGear: { ... }
   };
   ```
3. Instantiate `Aerodynamics` and `EngineModel` with the new config:
   ```javascript
   const aero = new Aerodynamics(AIRBUS_A320);
   ```

### 4.2 Adding New Airports & Runways
1. Open `src/config/simConfig.js`.
2. Define runway coordinates, elevation, threshold vectors, and lighting frequencies.
3. In `src/environment/Airport.js`, the runway geometry and ALS strobe arrays dynamically adapt to the runway length and heading parameters.
4. In `src/config/scenarioRegistry.js`, list the airport in every spawn scenario it offers; lobby/in-game button labels, briefing lines, and preset availability are all derived from that table.

### 4.3 Event Catalog (`src/core/EventBus.js`)
The decoupled event bus allows external telemetry loggers, multiplayer sockets, or blackbox recorders to listen without touching simulation internals:
- `flight:takeoff`: Emitted when all landing gear leaves ground contact.
- `flight:touchdown`: Emitted with vertical descent velocity and G-load on touchdown.
- `flight:stall`: Emitted with stall severity percentage.
- `flight:crashed`: Emitted with collision telemetry (type, speed, impact point, obstacle description).
- `flight:reset`: Emitted when user initiates instant repair and runway alignment.
- `aircraft:gearTransit`: Emitted during gear up/down cycles.
- `aircraft:tune`: Emitted when live tuning sliders are adjusted.

### 4.4 Multi-Obstacle Collision Detection (`src/physics/CollisionDetector.js`)
The collision pipeline runs on every 120Hz physics sub-step:
1. **8-Point Aircraft Transform Matrix:**
   - Evaluates world coordinates of 8 critical fuselage locations: Nose Radome, Tail Cone, Vertical Fin, Left/Right Wingtips, Left/Right CFM56 Engine Nacelles, and Belly Keel.
2. **Spatial Hash Grid Broadphase ($150\text{m} \times 150\text{m}$ Cells):**
   - Indexes 3,500+ procedural trees and 550+ city skyscrapers into constant-time lookup buckets, keeping collision overhead below $0.02\text{ ms}$ per physics substep.
3. **Runway Operational Envelope Protection:**
   - Normal takeoff rotation (pitch $-5.5^\circ \sim +14.5^\circ$), oleo strut landing compression, and wings-level roll ($\le 16.5^\circ$) on the airport plateau are safeguarded to ensure authentic touch-and-go and ILS landings without false alarms.
   - Detects extreme structural failures: vertical slam ($V_y < -12.5\text{ m/s}$), wingtip ground strikes, inverted nose dives, tail strikes, or gear-up belly collisions.

### 4.5 Procedural Particle Explosion & Audio Synthesis Engine (`src/effects/ExplosionSystem.js`)
1. **Point Light Flash:** $15,000\text{ lm}$ instant incandescent flash illuminating local geometry with exponential decay.
2. **Expanding Fireball Core:** Procedural radial gradient billboard particles expanding to $28\text{m}$ with combustion turbulence.
3. **Buoyant Plume Smoke:** $40\sim 60$ dense carbonaceous smoke particles driven by upward buoyancy ($1.8\text{m/s}$) and atmospheric wind.
4. **Ballistic Shrapnel & Sparks:** High-velocity shrapnel ($25\sim 45\text{m/s}$) with gravity and ground bounce damping.
5. **Shockwave Ring:** Fast planar supersonic compression ring expanding to $60\text{m}$.
6. **Water Splash Geysers:** 40+ hydro-ballistic white foam particles erupted $35\text{m}$ upward during maritime ditching.
7. **Procedural Web Audio API Sound:** Sub-bass low-pass shockwave thump ($30\sim 80\text{Hz}$) + broadband crunch noise burst with instant jet engine silence.

---

## 5. Autonomous Flight & Crash Testing Framework

To ensure rapid iteration and enable AI agents and human developers to autonomously verify aerodynamics and reproduce issues without manual flying:

### 5.1 Architecture & Headless CDP Driver
```
[Node.js Test Agent] <--(CDP WebSocket)--> [Headless Chrome (SwiftShader)]
        |                                                 |
        +-- Step Simulation API: sim.stepSimulation(dt) --+
        +-- Virtual Control Injections: setVirtualInput()-+
        +-- Real-time Telemetry & Anomaly Assertions -----+
        +-- Frame Screenshots & ASCII Test Report --------+
```
- **Discrete Substepping API (`window.simulator.stepSimulation(simSeconds)`)**:
  Runs pure 120Hz physics substepping in discrete 250ms chunks, completely decoupling physics numerical precision from software WebGL rendering speeds.
- **Virtual Control Injections (`window.simulator.controls.setVirtualInput(axis, val)`)**:
  Allows programmatic yoke, throttle, rudder, and brake actuation while preserving realistic control stiffness and actuator latency.

### 5.2 Autonomous Flight Scenarios (`npm run test:flight`)
1. **Takeoff & Initial Climb**: TOGA throttle, Vr rotation at 133 KT, positive climb rate confirmation, gear retraction.
2. **High-Altitude Stall & Recovery**: Induction of aerodynamic separation at AoA > 15°, stall warning assertion, nose-down yoke + TOGA recovery.
3. **Approach, Touchdown & Braking**: 0.3 NM short final on 3° glideslope, 25 FT AGL flare, main gear touchdown, spoiler deployment, reverse thrust, and anti-skid deceleration to 0 KT on runway centerline.
4. **Preset & Multi-Camera Stress**: Rapid cycling through all airport/flight presets and 5 camera modes to detect state corruption or NaN vectors.
5. **Autonomous Demo Director & User Handover**: 6-stage demo state machine progression and immediate human pilot takeover upon control input.

### 5.3 Autonomous Crash & Explosion Scenarios (`npm run test:crash`)
1. **Control Tower Collision**: Cylinder proximity intersection at 85 KT with debris eruption.
2. **Ocean Water Ditching**: High-speed maritime impact with geyser water plume.
3. **Mountain Ridge Collision**: Alpine rocky peak collision on the 20km terrain.
4. **City Skyscraper Collision**: Glass facade skyscraper collision in metropolitan downtown.
5. **Tree Strike & Quick Restart**: Forest canopy clipping with instant state reconstruction and clean runway reset via <kbd>Space</kbd>/<kbd>R</kbd>.

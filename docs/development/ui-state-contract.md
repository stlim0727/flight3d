# UI State Contract

This document establishes the UI state contract governing screen roles, allowed behaviors, and transitions across flight preparation, active flight, in-flight management, and flight debrief, as defined in [Issue #565](https://github.com/stlim0727/flight3d/issues/565).

---

## 1. UI States & Roles

| State | Purpose | Allowed Actions & Visible Controls | Prohibited / Hidden Controls |
|---|---|---|---|
| **1. Next Flight Preparation**<br>(`FLOW.LOBBY`, `resumableFlight = false`) | Choose flight conditions and launch a new flight | • Airport selection (coastal, incheon, lukla, neon, valley)<br>• Aircraft selection (B738, C172, F16)<br>• Scenario selection (runway, approach, challenge, cruise, bridge, cliff, valley, demo)<br>• Time-of-day selection<br>• Dispatch briefing<br>• **"새 비행 시작" / "데모 시작" (`btn-fly`)**<br>• Settings tab & Replay library | • "비행 계속하기" (`btn-lobby-resume`)<br>• "비행 종료" (`btn-lobby-end`)<br>• In-flight instruments / HUD |
| **2. Active Flight**<br>(`FLOW.FLIGHT`) | Piloting and situational awareness | • Flight controls (stick, throttle, rudder, flaps, gear, trim, brakes)<br>• Instruments, HUD, autopilot bar, notifications<br>• Pause toggle (`ESC`, `P`, or pause button)<br>• Main menu toggle (`menu-toggle`)<br>• Camera view switching (`C`, `0-9`, quick camera dropdown)<br>• Audio volume / mute (`M`) | • Flight condition selection (aircraft, airport, scenario, time)<br>• Starting new flights without exiting current sortie |
| **3. In-Flight Menu Management**<br>(`FLOW.LOBBY`, `resumableFlight = true`) | Manage currently held flight and personal settings | • **"비행 계속하기" (`btn-lobby-resume`)**<br>• **"시나리오 재시작" (`btn-lobby-restart`)**<br>• **"비행 종료" (`btn-lobby-end` -> exits to Debrief/Preparation)**<br>• Held sortie summary card (aircraft, airport, scenario, time)<br>• Settings tab (audio, language, graphics, controls, dev tools)<br>• Replay library dialog | • **Flight condition selectors (aircraft, airport, scenario, time select/chips) MUST BE HIDDEN**<br>• "새 비행 시작" (`btn-fly`) MUST BE HIDDEN<br>• Dispatch briefing for other scenarios MUST BE HIDDEN |
| **4. Paused Screen**<br>(`FLOW.PAUSED`, `#pause-menu`) | Quick in-flight pause | • "계속하기" (`btn-pause-resume` -> resumes flight)<br>• "시나리오 재시작" (`btn-pause-restart` -> restarts current flight with initial confirmed conditions)<br>• "메인 메뉴 및 설정" (`btn-pause-lobby` -> opens In-Flight Menu Management)<br>• "비행 종료" (`btn-pause-exit` -> ends flight and opens Debrief) | • Flight condition selectors |
| **5. Flight Debrief / Results**<br>(`FLOW.DEBRIEF`, `#debrief-overlay`) | Review completed flight telemetry & outcome | • Telemetry review (altitude, speed, Gs, touchdown sink rate)<br>• Scrub chart & event timeline<br>• Save / export replay & telemetry JSON<br>• **"같은 조건으로 재시도" (`debrief-retry`)**<br>• **"로비로 이동" (`debrief-lobby` -> exits to Preparation Screen)**<br>• Camera view of parked/crashed plane | • Active flight controls<br>• Resuming previous flight |

---

## 2. Invariants & Common Contract

### 2.1 Flight Conditions vs Personal Preferences
1. **Confirmed Flight Conditions**:
   - Airport, aircraft, scenario/mission, and time-of-day are **locked upon flight start**.
   - While a flight is running or held in the menu, the user cannot change these conditions.
   - To fly with different conditions, the user must explicitly click **"비행 종료" (End Flight)**, which closes the current sortie and returns to the Preparation Screen.
2. **Personal Preferences**:
   - Volume, language, graphics quality, control bindings, and developer mode are personal settings and remain adjustable at any time without resetting or modifying flight conditions.
3. **In-Flight Time-of-Day Cycling**:
   - Keyboard hotkeys (`[` and `]`) for cycling time-of-day during active flight are disabled in standard flight mode and reserved strictly for Developer Mode (`devEnabled`).

### 2.2 Pausing Rules & Multi-Pause Guards
1. **Singleplayer Auto-Pause**:
   - In singleplayer, opening the menu (`FLOW.LOBBY` with held flight or `#pause-menu`) freezes physics, mission time, and scenario timers.
   - Opening camera selection menus (`open-camera`, `camera-select` in `#flight-more-panel`) freezes physics during selection to prevent crashing while navigating menus.
2. **Multi-Pause State Guard**:
   - Multiple pause reasons may overlap (e.g. paused via ESC, then opening camera select or menu).
   - Resuming from one action (e.g. camera selection committed) must **not** resume physics if another pause source (e.g. menu or manual pause) is still active.
3. **Multiplayer Exemption**:
   - In multiplayer, opening menus or switching cameras does **not** freeze the shared simulation or peer aircraft. The local player is marked as `held` in snapshots.

# ✈️ Boeing 737 Ultra-Realistic 3D Flight Simulator

[![Node Version](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r186-black.svg)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-6.0-purple.svg)](https://vitejs.dev)
[![Unit Tests](https://img.shields.io/badge/Unit%20Tests-30%2F30%20Pass%20(100%25)-success.svg)](file:///home/stlim/flight3d/tests)
[![Flight CDP Tests](https://img.shields.io/badge/Flight%20Agent-5%2F5%20Pass%20(100%25)-blue.svg)](file:///home/stlim/flight3d/scripts/test-flight-agent.js)
[![Crash CDP Tests](https://img.shields.io/badge/Crash%20Agent-5%2F5%20Pass%20(100%25)-red.svg)](file:///home/stlim/flight3d/scripts/test-crash-scenarios.js)

IL-2 슈투르모빅(IL-2 Sturmovik) 및 정밀 비행 시뮬레이터(MSFS / X-Plane) 수준의 현실적인 6-DOF 항공역학 물리 모델과 실제 보잉 737 실사 사진을 정밀 반영한 글래스 콕핏 계기판, 절차적 굴곡 지형, 햇빛이 반사되는 거스트너 파도 수면, 해상 선박 및 공항 관제탑 시스템을 모두 갖춘 고성능 웹 3D 비행 시뮬레이터입니다.

**[브라우저에서 실행](https://stlim0727.github.io/flight3d/)** · [GitHub Pages 배포 안내](docs/development/github-pages-deployment.md)

---

## 📸 스크린샷 갤러리 (Screenshots)

| 콕핏 정면 뷰 (Cockpit View) | 글래스 계기판 (PFD / ND / EICAS / MCP) |
| :---: | :---: |
| ![Cockpit Forward View](cockpit_view.png) | ![Cockpit Instruments](cockpit_instruments_view.png) |

| 센터 페데스탈 & FMC/CDU | 해안가 선회 & 날개 뷰 (Wing View) |
| :---: | :---: |
| ![Cockpit Pedestal](cockpit_pedestal_view.png) | ![Demo Coastal Banking](demo_coastal_banking_showcase.png) |

| 3NM PAPI 최종 진입 (Final Approach) | 거스트너 파도 & 해상 선단 (Ocean Fleet) |
| :---: | :---: |
| ![Demo Approach PAPI](demo_approach_papi_showcase.png) | ![Ocean Ships](ocean_ships_view.png) |

| 관제탑 충돌 폭발 (Tower Crash) | 도심 빌딩 충돌 폭발 (Building Crash) |
| :---: | :---: |
| ![Crash Tower](crash_tower_showcase.png) | ![Crash Building](crash_building_showcase.png) |

---

## 🌟 핵심 기능 (Key Features)

### 1. 🔬 IL-2급 현실적 항공역학 물리 모델 (`src/physics/`)
* **보잉 737-800 규격 기체 제원:** 운항 중량 $66,000\text{ kg}$, 주 관성 모멘트($I_{xx}, I_{yy}, I_{zz}$) 반영으로 거대 여객기 특유의 묵직한 질량 관성과 초당 약 $2.2^\circ$의 FCTM 로테이션율 모사.
* **유압 액추에이터 변위 속도 제한 (PCU Slew Rate Limiter):** 조종면 급변 방지 및 점진적 타면 전개.
* **동압 감응 조작 저항 (Dynamic Pressure Stiffening):** 고속 비행 시 타면 반력 증가로 과조작 방지.
* **비선형 받음각($\alpha$) & 양력/항력 극선:** 실속 영역 진입 시 유동 박리, 양력 급감, 유도항력 급증 및 버핏(Buffeting) 진동.
* **지면 효과 (Ground Effect):** 접지 직전 날개폭 이하 고도에서 유도항력 급감 및 쿠션 플레어 부유감 구현.
* **CFM56-7B 트윈 터보팬 엔진:** 가속 시정수(스풀 지연), 고도 감율, 지상 전용 역추진(Reverse Thrust).
* **3점식 올레오-뉴매틱 랜딩기어:** 스프링-댐퍼 서스펜션, 안티스키드 제동, 속도 감응형 전륜 조향.

### 2. 🖥️ 실사 사진 기반 정밀 글래스 콕핏 & 항전 계통 (`src/avionics/`, `src/aircraft/Cockpit.js`)
* **글레어실드 모드 컨트롤 패널 (MCP):** 호박색 7세그먼트 발광창, F/D 스위치, A/T 암, 오토파일럿 분리 바, 마스터 경보등.
* **FMC / CDU (비행 관리 컴퓨터 / 컨트롤 디스플레이 유닛):** 센터 페데스탈 37° 경사각 듀얼 유닛, 녹색 형광 CRT 비행 계획 표시.
* **통합 예비 비행 계기 (ISFD):** 인공수평선, 속도/고도 테이프, 기압 설정이 집약된 중앙 예비 계기.
* **주 비행 표시장치 (PFD):** 시안/브라운 인공수평의, 마젠타 F/D 십자선, 속도 트렌드 벡터, $V_1 / V_R / V_2$ 결심 속도 버그.
* **항법 표시장치 (ND):** 활성 비행 계획 마젠타 경로선, 활주로 1NM 눈금선, VOR 주파수 수신.
* **엔진 및 승무원 경보 시스템 (EICAS):** 트윈 엔진 N1/EGT/N2 게이지, 유압 압력, 기어 인디케이터(Down/Transit).
* **가동 3D 콕핏 컨트롤:** 승강타/보조익 연동 W-요크, 트윈 스로틀 레버, 대형 듀얼 피치 트림 휠, 랜딩기어 레버, 호박색 앰비언트 플러드 조명, A-필러 밀폐감.

### 3. 🌊 절차적 3D 월드, 해양 & 공항 시스템 (`src/environment/`)
* **거스트너 파도 셰이더 & 해상 선단:** 햇빛 정반사(Sun Glint)와 프레넬 반사, 부력으로 흔들리는 컨테이너선, 대형 유람선, 쾌속 요트.
* **실시간 4등식 PAPI 조명:** 항공기 상대 고도각을 $120\text{Hz}$로 계산하여 $3.0^\circ$ 활공각 정렬 시 정확히 **2등 백색 / 2등 적색** 유도.
* **ICAO / FAA 표준 활주로:** 3,200m 09L/27R 활주로, 150m~900m TDZ 마킹, 900m MALSR 진입등(주행 점멸 래빗 및 크로스바), 65m 회전 레이더 관제탑.
* **지형 및 대기권:** 20km 프랙탈 산맥, 3,500+ 그루의 나무, 500+ 채의 도심 고층 빌딩, 시간대별 대기권 원근 안개(Aerial Perspective Fog).

### 4. 🎬 6단계 자율 시네마틱 데모 비행 디렉터 (`src/director/DemoFlightDirector.js`)
* 첫 접속 시 활주로 이륙 활주 $\rightarrow$ 로테이션 & 기어 수납 $\rightarrow$ 해안가 선회 $\rightarrow$ 파도/선단 크루즈 $\rightarrow$ 3NM PAPI 접근 $\rightarrow$ 플레어/접지/역추진 제동을 자동으로 시연.
* 사용자가 언제든지 <kbd>Esc</kbd> 또는 조종키를 누르면 지연 없이 즉각 수동 조종으로 매끄럽게 전환.

### 5. 💥 다중 장애물 충돌 감지 & 시네마틱 폭발 시스템 (`src/physics/CollisionDetector.js`, `src/effects/ExplosionSystem.js`)
* **8포인트 바운딩 프로브 정밀 검사:** 기수(Radome), 미부(Tail), 수직미익(Fin), 좌/우 주익단(Wingtip), 좌/우 CFM56 엔진, 동체 하단(Belly)을 월드 좌표로 실시간 변환.
* **전 방위 장애물 충돌 판정:** 20km 굴곡 산맥, 해상 수면, 공항 관제탑(Cylinder), 여객 터미널/격납고(AABB), 550+ 채의 도심 고층 빌딩 및 3,500+ 그루의 수목(Spatial Grid Broadphase), 해상 선박.
* **활주로 정상 운항 포락선 보호:** 활주로 접지 시 올레오 서스펜션 완충 및 정상 로테이션(피치 -5.5° ~ +14.5°) 시 오발생 없는 안전 비행 보장. 과도한 강하율(-12.5 m/s 이상), 윙팁 지면 스크랩(롤 16.5° 초과), 기어 미전개 동체 접지 시 충돌 판정.
* **다단계 시네마틱 입자 폭발 시스템:** 동적 섬광 포인트 라이트(15,000 lm), 팽창 화염구 코어, 대량의 부유식 흑연 연기 기둥, 탄도 궤적 파편 스파크, 지면/수면 충격파 링, 해상 비산 물보라 간헐천, 잔해 지속 연기.
* **Web Audio API 절차적 폭발음:** 초저역(30~80Hz) 충격음 쿵과 메탈 파쇄 노이즈를 절차적으로 합성 재생.
* **기체 파손 비주얼 & 원터치 재시작:** 날개 구조 변형, 전원 소등, 충돌 텔레메트리 카드 HUD 및 <kbd>Space</kbd> / <kbd>R</kbd> 원터치 즉시 재시작.
* **실시간 4등식 PAPI 조명:** 항공기 상대 고도각을 $120\text{Hz}$로 계산하여 $3.0^\circ$ 활공각 정렬 시 정확히 **2등 백색 / 2등 적색** 유도.
* **ICAO / FAA 표준 활주로:** 3,200m 09L/27R 활주로, 150m~900m TDZ 마킹, 900m MALSR 진입등(주행 점멸 래빗 및 크로스바), 65m 회전 레이더 관제탑.
* **지형 및 대기권:** 20km 프랙탈 산맥, 3,500+ 그루의 나무, 500+ 채의 도심 고층 빌딩, 시간대별 대기권 원근 안개(Aerial Perspective Fog).

### 4. 🎬 6단계 자율 시네마틱 데모 비행 디렉터 (`src/director/DemoFlightDirector.js`)
* 첫 접속 시 활주로 이륙 활주 $\rightarrow$ 로테이션 & 기어 수납 $\rightarrow$ 해안가 선회 $\rightarrow$ 파도/선단 크루즈 $\rightarrow$ 3NM PAPI 접근 $\rightarrow$ 플레어/접지/역추진 제동을 자동으로 시연.
* 사용자가 언제든지 <kbd>Esc</kbd> 또는 조종키를 누르면 지연 없이 즉각 수동 조종으로 매끄럽게 전환.

---

## 🚀 빠른 시작 (Getting Started)

### 설치 및 로컬 서버 구동

```bash
# 의존성 설치
npm install

# Vite 개발 서버 실행 (포트 5173)
npm run dev
```

브라우저에서 `http://localhost:5173/` 접속 시 시뮬레이터가 즉시 실행됩니다.

---

## 🎮 조작 방법 (Controls)

| 구분 | 단축키 | 기능 설명 |
| :--- | :--- | :--- |
| **데모 비행** | <kbd>P</kbd> | 시네마틱 자율 데모 비행 시작 / 다시 보기 |
| **수동 조종 전환** | <kbd>Esc</kbd> / 조종키 입력 | 데모 비행 즉시 중단 및 조종사 직접 조종 핸드오버 |
| **피치 (승강타)** | <kbd>W</kbd> / <kbd>S</kbd> 또는 <kbd>↑</kbd> / <kbd>↓</kbd> | 기수 내림(하강) / 기수 올림(상승) |
| **롤 (보조익)** | <kbd>A</kbd> / <kbd>D</kbd> 또는 <kbd>←</kbd> / <kbd>→</kbd> | 좌측 뱅크 선회 / 우측 뱅크 선회 |
| **요 (방향타)** | <kbd>Q</kbd> / <kbd>E</kbd> | 러더 좌/우 (지상 활주로 노즈휠 조향) |
| **스로틀 (출력)** | <kbd>=</kbd> / <kbd>−</kbd> | 엔진 추력 점진 증가 / 감소 |
| **출력 프리셋** | <kbd>X</kbd> / <kbd>Z</kbd> | 이륙 최대 출력 (TOGA 100%) / 아이들 (Idle 22%) |
| **지상 브레이크** | <kbd>Space</kbd> | 휠 브레이크 작동 (지상 감속) |
| **피치 트림** | <kbd>T</kbd> / <kbd>Y</kbd> | 기수 다운 트림 / 기수 업 트림 (트림 휠 회전) |
| **플랩** | <kbd>F</kbd> / <kbd>V</kbd> | 플랩 전개 / 접기 (`UP` $\rightarrow$ `1` $\rightarrow$ `5` $\rightarrow$ `15` $\rightarrow$ `20` $\rightarrow$ `30` $\rightarrow$ `40`) |
| **랜딩 기어** | <kbd>G</kbd> | 바퀴 접기 / 내리기 (Gear Up / Down, 레버 및 3-Green 표시등 연동) |
| **스포일러** | <kbd>B</kbd> | 에어브레이크 전개 (급강하 및 착륙 양력 감쇄) |
| **역추진** | <kbd>R</kbd> | 착륙 접지 후 엔진 역추진 장치 가동 |
| **카메라 시점** | <kbd>C</kbd> | 콕핏 $\rightarrow$ 3인칭 체이스 $\rightarrow$ 윙 뷰 $\rightarrow$ 관제탑 $\rightarrow$ 플라이바이 |
| **시점 회전** | <kbd>마우스 드래그</kbd> | 콕핏 내부 360° 시야 둘러보기 (더블클릭 시 정면 복귀) |
| **시간대 변경** | <kbd>[</kbd> / <kbd>]</kbd> | 새벽 $\rightarrow$ 정오 $\rightarrow$ 황금빛 석양 $\rightarrow$ 황혼 $\rightarrow$ 야경 |
| **물리 진단창** | <kbd>`</kbd> 또는 <kbd>F3</kbd> | 120Hz 텔레메트리, G-Force/AoA 그래프, 실시간 공력 튜닝 슬라이더 |
| **사운드 음소거** | <kbd>M</kbd> | 제트엔진 및 GPWS 사운드 켜기/끄기 |
| **도움말** | <kbd>H</kbd> | 비행 조작 매뉴얼 팝업 토글 |
| **충돌 후 재시작** | <kbd>Space</kbd> / <kbd>R</kbd> / <kbd>Enter</kbd> | 충돌 폭발 후 기체 완전 복원 및 활주로 09L 즉각 재시작 |

---

## 🧪 테스트 및 품질 보증 (Testing & QA)

### 1. 물리 단위 테스트 (Unit Tests)
```bash
npm test
```
* **결과:** 30 / 30 통과 (100% Pass)
* 대기 모델(ISA), 6-DOF 공력 미계수, 터보팬 엔진 스풀 지연, 착륙장치 올레오 서스펜션, 8포인트 다중 장애물 충돌 감지기 수학적 검증.

### 2. 자율 비행 CDP 테스트 에이전트 (Autonomous CDP Flight Agent)
```bash
npm run test:flight
```
AI 코딩 에이전트 및 개발자가 게임을 수동으로 조작하지 않아도 Headless Chrome과 Chrome DevTools Protocol(CDP)을 통해 5대 핵심 비행 시나리오를 자율 검증합니다:
1. `[PASS]` 활주로 이륙 활주, $V_R(133\text{ KT})$ FCTM 회전 및 초기 상승률 검증
2. `[PASS]` 고고도 받음각($>15^\circ$) 실속 유발 및 기수 하강/추력 복구 검증
3. `[PASS]` $3.0^\circ$ 글라이드슬로프 접근, $25\text{ft}$ 플레어, 접지 및 역추진/브레이크 정지 검증
4. `[PASS]` 프리셋 및 5대 카메라 뷰 스트레스 전환 및 NaN/예외 미발생 검증
5. `[PASS]` 6단계 자율 데모 비행 상태 전이 및 조종사 즉시 수동 제어권 회복 검증

### 3. 자율 충돌 및 폭발 CDP 테스트 에이전트 (Autonomous CDP Crash Suite)
```bash
npm run test:crash
```
다양한 지형지물 및 인공 구조물과의 물리 충돌 판정 및 폭발 이펙트를 자동 검증합니다:
1. `[PASS]` 공항 관제탑(Control Tower) 실린더 정밀 충돌 판정 및 파편 폭발
2. `[PASS]` 해상 수면(Ocean Water) 고속 다이빙 충돌 및 물보라 간헐천
3. `[PASS]` 20km 프랙탈 산악 지형(Mountain Ridge) 암벽 격돌
4. `[PASS]` 도심 고층 빌딩(Skyscraper) 격돌 및 대형 화염구 생성
5. `[PASS]` 산림 수목(Forest Trees) 접촉 및 <kbd>Space</kbd>/<kbd>R</kbd> 원터치 즉각 재시작 무결성 검증

---

## 📁 프로젝트 구조 및 아키텍처

```
flight3d/
├── src/
│   ├── aircraft/          # Boeing 737 기체 모델, 3D 버추얼 콕핏, 조종면
│   ├── audio/             # Web Audio API 절차적 제트엔진 사운드 및 GPWS 경보음
│   ├── avionics/          # PFD, ND, EICAS, MCP, ISFD, CDU 캔버스 계기판
│   ├── controls/          # 동압 감응 조작계 및 입력 핸들러
│   ├── core/              # 이벤트 버스 및 좌표계 유틸리티
│   ├── director/          # 6단계 시네마틱 자율 데모 비행 디렉터
│   ├── environment/       # 4등식 PAPI 공항, 20km 절차 지형, 거스트너 수면, 선박
│   ├── physics/           # 6-DOF 공력, CFM56 엔진, 올레오 랜딩기어, ISA 대기
│   ├── ui/                # HUD 오버레이, 도움말, 데모 배너, 실시간 물리 진단창
│   └── main.js            # 시뮬레이터 메인 루프 (120Hz 물리 서브스텝)
├── tests/                 # 자동화 물리 단위 테스트
├── scripts/               # 자율 비행 CDP 테스트 러너 및 스크린샷 캡처
├── ARCHITECTURE.md        # 좌표계, 수식, 서브시스템 간 데이터 흐름 상세 규격
└── CODE_METRICS.md        # 모듈별 코드 복잡도, 유지보수성, 성능 가이드라인
```

자세한 기술 문서는 [`ARCHITECTURE.md`](ARCHITECTURE.md) 및 [`CODE_METRICS.md`](CODE_METRICS.md)를 참고하세요.

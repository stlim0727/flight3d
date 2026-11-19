# 제주국제공항(RKPC) 지형·시설 구현 및 인천-제주 항로 계획

인천공항 및 영종도 지형·위성 파이프라인([incheon-scenery.md](incheon-scenery.md))에 이어,
제주국제공항(RKPC / CJU)과 대한민국 대표 노선인 **인천 ⇄ 제주 (RKSI ⇄ RKPC)** 항로를
Flight3d 시뮬레이터에 통합하기 위한 기술 규격 및 구현 계획입니다.

Discussion / Issue: [#858](https://github.com/stlim0727/flight3d/issues/858)

---

## 1. 제주도 및 제주공항의 지형적 이점

1. **완벽한 섬(Island) 경계와 해안선 처리**:
   - 사방이 바다로 둘러싸인 독립된 섬으로, OSM `natural=coastline` 기반의 닫힌 다각형 마스크(`land-mask.png`)를 적용하면 인위적인 경계 절단 없이 Three.js 무한 바다 메쉬([WaterOcean.js](../src/environment/WaterOcean.js))와 100% 매끄럽게 연결됩니다.
2. **해발 36m부터 한라산 1,950m까지의 극적인 고도비**:
   - 해안가 바로 옆에 위치한 제주공항(표고 36m)부터 남쪽의 한라산 백록담(해발 1,950m) 및 수많은 기생화산(오름) 군락이 형성하는 웅장한 지형을 Copernicus WorldDEM-30 30m 수치표고모델(DSM)로 정밀하게 재현할 수 있습니다.
3. **특색 있는 교차 활주로 (Cross Runway)**:
   - 주 활주로: **RW 07/25 (3,180m × 45m)** — 동서 방향, 바다 쪽 해상 접근 및 대형 여객기(B737/A321/B777) 주력 활주로
   - 보조 활주로: **RW 13/31 (1,900m × 45m)** — 북서-남동 방향 교차 활주로
   - 제주 특유의 강한 측풍(Crosswind) 및 돌풍 접근 시나리오 제공에 최적.

---

## 2. 좌표계 및 데이터셋 출처

### (1) 좌표 투영 기준 (Local Frame)
* **기준 원점**: 북위 33.5113°, 동경 126.4930° (제주국제공항 중심)
* **투영 방식**: WGS84 ECEF 접평면 탑센트릭 좌표 (+X 동쪽, +Z 남쪽, 단위 m)
* **공항 표고**: AIP 기준 36.0 m (118 ft)

### (2) 데이터 소스 및 라이선스
* **지형 DEM**: Copernicus WorldDEM-30 (EU/ESA)
  - 타일: `Copernicus_DSM_COG_10_N33_00_E126_00_DEM`
* **공항/도심 벡터**: OpenStreetMap (ODbL 1.0)
  - 활주로, 유도로, 터미널 풋프린트, 제주시 도심 도로 및 건물군
* **위성 텍스처**: Esri World Imagery (비상업/Attribution)
  - `incheonSurfaceMaterial`의 마이크로 그레인/노멀 릴리프 셰이더를 공유하여 지상 픽셀레이션 방지

---

## 3. 인천 ⇄ 제주 항로 (RKSI ⇄ RKPC Route)

실제 국내선 항공로(Y711 / Y722)를 기반으로 항로 데이터셋(`src/config/koreaFlightRoutes.json`)을 구축했습니다.

* **비행 거리**: 약 451.2 km (243.6 NM)
* **표준 순항 고도**: FL280 (28,000 ft)
* **주요 웨이포인트(Fix)**:
  1. `RKSI`: 인천공항 활주로 15R 출발
  2. `BOPTA`: 서해상 고도 상승 픽스 (FL140)
  3. `OLMEN`: 전북 서해안 순항 전환 픽스 (FL240)
  4. `SOSDO`: 서남해상 주 순항 픽스 (FL280)
  5. `DOTOL`: 진도 남서쪽 강하 시작점 (Top of Descent, FL180)
  6. `TAMNA`: 제주 북서쪽 초기 접근 픽스 (Initial Approach Fix, 5,000 ft)
  7. `RW07`: 제주공항 활주로 07번 터치다운 (118 ft)

---

## 4. 시뮬레이터 비행 모드 지원

1. **로비 즉시 비행 프리셋 (Lobby Scenarios)**:
   - `jeju.runway`: 제주공항 활주로 07/25 대기 및 이륙
   - `jeju.approach`: 바다 방향 07번 활주로 3 NM 최종 어프로치 (계기착륙 ILS)
   - `jeju.cruise`: 한라산 상공 10,000 ft 관광 순항
2. **풀 플라이트 항로 순항 모드 (Route Cruise)**:
   - B737 조종석의 CDU(FMC) 및 ND(Navigation Display)에 항로 웨이포인트 표출
   - 450 km 장거리 비행 시 지루함을 줄이기 위한 **4x / 8x 시간 가속(Time Warp)** 및 **구간 스킵(Skip to Next Waypoint / Descent)** 기능 제공

---

## 5. 단계별 추진 로드맵

- [x] **Phase 1**: 인천공항 12km 위성 텍스처 드레이핑 및 표면 머티리얼 구현 (#864)
- [x] **Phase 1.5**: 인천-제주 항로 규격 및 웨이포인트 데이터셋 구축 (`koreaFlightRoutes.json`)
- [ ] **Phase 2**: 제주도 Copernicus DEM 추출 및 OSM RKPC 공항 데이터 전처리 스크립트 작성 (`scripts/terrain/build-jeju.py`)
- [ ] **Phase 3**: 제주공항 3D 메쉬 생성 및 시너리 로더 구현 (`src/environment/JejuAirport.js`, `JejuFlightSurface.js`)
- [ ] **Phase 4**: B737 CDU / ND 및 자동항법에 인천-제주 항로 웨이포인트 연결
- [ ] **Phase 5**: 로비 공항 선택 UI 확장 및 제주 비행 시나리오 등록

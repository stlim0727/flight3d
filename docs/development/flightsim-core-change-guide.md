# flightsim-core 수정 판단 가이드

공유하는 **비행 계산·상태 전이·기본 기체 물리 설정**을 바꾸려면
[flightsim-core](https://github.com/stlim0727/flightsim-core)를 수정합니다.
**입력 장치·화면·시나리오·환경 데이터와 연결 방식**을 바꾸려면 Flight3d를 수정합니다.
공개 입출력 계약이 바뀌거나 새 기능을 앱에 연결해야 하면 두 저장소를 함께 수정합니다.

이 가이드는 독립 패키지 전환 구조를 기준으로 합니다. 작업 전에 체크아웃의
`package.json`에 `@stlim0727/flightsim-core` 의존성이 있는지 확인하세요.
의존성이 없다면 전환 전 브랜치인지 먼저 확인하고, 변경할 기준 브랜치를 맞춥니다.
현재 소유권은 파일이 있는 디렉터리명보다 실제 import/export와
[패키지 exports](https://github.com/stlim0727/flightsim-core/blob/main/package.json)가 우선합니다.

## 변경 위치를 고르는 표

| 바꾸려는 동작 | 수정할 저장소와 구현 | 판단 예시 |
| --- | --- | --- |
| 양력·항력·실속·추력·연료 소모 | 코어: `Aerodynamics`, `Atmosphere`, `EngineModel` | 같은 상태·입력에서 힘이나 모멘트가 잘못 계산됨 |
| 질량·CG·관성·트림 해법·공유 기체 물리 계수 | 코어: `MassProperties`, `TrimSolver`, `config/aircraftConfigs.js`, `massDistributions.js` | B738 기본 질량 분포나 C172 항력 계수를 바꿈 |
| 시간 적분·접지 반응·착륙장치·수면 접촉 | 코어: `FlightPhysicsCore`, `LandingGear`, `WaterDitching`와 관련 순수 계산 | 올바른 지형 높이를 제공해도 관통·접지 힘 계산이 잘못됨 |
| 동압 감응·조종면 레이트·중립 복귀·트림/스로틀 램프·공통 데드존 계산 | 코어: `FlightControlLaws` | 같은 정규화 입력 시퀀스에서 모든 소비자가 공유할 조종 응답을 바꿈 |
| 키 바인딩·HOTAS 축 매핑·터치 이벤트·자이로 권한·사용자 감도 설정 | Flight3d: `FlightControls`, `HotasController`, `TouchFlightControls`, `gyroBrowser`, 설정 UI | 특정 조이스틱의 축 부호나 사용자가 선택한 데드존 값을 바꿈 |
| 기기 각도에서 화면 기울기를 구하는 수학 | 코어: `controls/gyroOrientation.js` | 동일한 beta/gamma/화면 각도로 잘못된 pitch/roll을 계산함 |
| HDG/ALT/VS/SPD/APP 제어·트림 피드포워드 | 코어: `physics/Autopilot.js` | 올바른 텔레메트리와 접근 편차를 줘도 고도 유지 명령이 잘못됨 |
| AP 버튼·모드 표시·공항 선택·접근 경로 데이터 | Flight3d: UI, 로컬 AP 어댑터, `config/approachData.js` | 활주로 임계점·방위·고도 데이터를 고침 |
| 접근 경로의 공통 편차 계산식 | 코어: `navigation/approachDeviation.js` | 올바른 접근 지오메트리에서 횡방향/글라이드슬로프 편차 계산이 잘못됨 |
| 경보 조건·우선순위·해제 지연·고도 콜아웃 교차 판정 | 코어: `FlightWarningsCore` | 같은 텔레메트리에서 실속·과속 경보나 콜아웃 상태가 잘못됨 |
| 경보 번역·HUD 표시·음색·볼륨·재생 제어 | Flight3d: `FlightWarnings` 호환 계층, HUD, i18n, `FlightAudio` | 경보 상태는 맞는데 표시나 소리가 잘못됨 |
| 공항·지형·도시 바람·활주로 데이터와 샘플링 연결 | Flight3d: 환경/지리 모듈, `UrbanWindField`, 콜백 연결 | 잘못된 좌표·높이·풍속이 코어에 전달됨 |
| 장면 건물 충돌·크래시 카메라·파편·시각 효과 | Flight3d: `CollisionDetector`, 카메라와 효과 모듈 | 건물 충돌 대상이나 렌더링 효과를 바꿈 |
| 데모/미션 조종·단계 전환·프리셋·기록·리플레이 | Flight3d: `director/`, `PilotControlLaws`, 미션·프리셋·리플레이 모듈 | 특정 데모의 회전 시점이나 착륙 목표 속도를 바꿈 |
| 공통 코어 API·입력/텔레메트리 필드·공유 새 기체 추가 | 양쪽 | 코어 구현/계약과 Flight3d 연결·UI·리소스·테스트를 함께 갱신함 |

`src/physics/`에 있다고 전부 코어 소유는 아닙니다. 예를 들어
`CollisionDetector`와 `UrbanWindField`는 현재 Flight3d에 남아 있습니다.
`PilotControlLaws`도 일부 계산이 순수 함수이지만 현재는 Flight3d의 데모/미션 조종입니다.
브라우저 없이 실행할 수 있다는 사실만으로 기존 모듈을 자동으로 코어로 옮기지 않습니다.

## 증상에서 수정 위치까지

1. 입력부터 확인합니다. 기체 설정, 축 부호·범위, 단위, dt, 지형/바람/접근 경로
   콜백 값이 맞는지 조사합니다. Flight3d의 잘못된 단위 변환이나 콜백 연결은
   앱에서 수정합니다.
2. 문제 시점의 상태와 입력 시퀀스를 고정해, 코어의 공개 API로 재현합니다.
   올바른 입력에서도 공유 계산·상태 전이가 잘못되면 코어에서 수정하고 회귀 테스트를 둡니다.
   키 유지/해제, reset, 접지/이륙, 경보 유지/해제처럼 여러 스텝이 필요한 경우를 포함합니다.
3. 코어 출력이 올바르면 소비자를 조사합니다. AP 명령 덮어쓰기, 프리셋 초기화,
   표시 단위, 오디오 재생, 장면 보간 문제는 Flight3d에서 수정합니다.
4. 앱에 필요한 값이 공개 계약에 없다면 두 저장소의 변경을 연결합니다.
   코어에 일반적인 입력/출력 또는 주입 지점을 추가하고, Flight3d가 실제 데이터를
   제공하거나 결과를 소비하도록 연결합니다.

예를 들어 인천에서만 착륙이 이상하면 먼저 활주로 높이·임계점·접근 설정과 스폰 상태를
확인합니다. 잘못된 공항 데이터를 맞추기 위해 모든 공항에 적용되는 양력 계수를
바꾸지 않습니다. 특정 HOTAS에서만 떨리면 먼저 축 매핑과 사용자 데드존을 확인합니다.
이미 제공되는 옵션이나 콜백으로 표현할 수 있는 앱별 설정은 그 연결부에서 처리합니다.

## 호환 파일과 환경 경계

Flight3d의 다음 파일은 주로 패키지 구현을 재수출하는 호환 경로입니다:

- `src/physics/FlightPhysicsCore.js`, `Aerodynamics.js`, `LandingGear.js` 등
- `src/config/aircraftConfigs.js`, `massDistributions.js`
- `src/controls/FlightControlLaws.js`, `gyroOrientation.js`
- `src/systems/FlightWarningsCore.js`

공유 로직을 이 파일들에 복제하거나 `node_modules`를 직접 편집하지 않습니다.
실제 구현은 코어 저장소에서 바꾸고 새 버전을 소비합니다. 로컬
`src/physics/Autopilot.js`는 Flight3d의 공항 편차 함수를 주입하는 어댑터이므로,
주입/연결 변경은 여기에서 처리하고 제어 법칙 변경은 코어에서 처리합니다.

코어는 DOM, 렌더러, 장치 폴링, 저장소, i18n, 오디오/UI 콜백에 의존하지 않습니다.
Three.js는 수학용 peer dependency입니다. 지형·바람·활주로·내비게이션은 소비자가
콜백/일반 데이터로 제공합니다. 텔레메트리·조종 입력의 단위와 수명은
[헤드리스 시스템 계약](headless-flight-systems.md)과 [물리 코어 계약](physics-core.md)을 따릅니다.

## 코어 변경을 Flight3d에 반영하는 순서

1. 코어 저장소의 최신 `origin/main`에서 작업 트리와 브랜치를 만듭니다.
   공유 계산이나 계약을 바꾸고, 재현된 동작에 맞는 테스트를 추가·수정합니다.
2. 코어에서 `npm run check`, `npm test`, `npm run test:package`를 실행합니다.
   마지막 명령은 실제 tarball을 별도 소비자 프로젝트에 설치해 실행합니다.
   루트 export/subpath, Three.js 호환 범위, 입력 부호·단위·reset 계약도 확인합니다.
3. 코어 PR을 검토·병합하고 CI를 확인합니다. 배포할 변경은 버전과 lockfile을 갱신해
   새 릴리스 태그를 만듭니다. 이미 배포한 태그를 이동하거나 기존 릴리스 커밋을 덮어쓰지 않습니다.
4. Flight3d의 별도 PR에서 `package.json`과 `package-lock.json`을 새 **전체 커밋 SHA**의
   HTTPS Git 의존성으로 함께 갱신합니다. `npm ci`로 재설치를 확인합니다.
   로컬 경로, workspace 링크나 이동하는 브랜치 참조를 배포 의존성으로 남기지 않습니다.
   현재 패키지는 Git 배포이며 npmjs.com 인증은 설치에 필요하지 않습니다.
5. 아래 표에 따라 Flight3d 통합 검증을 실행하고 전체 테스트·빌드는 CI에서 확인합니다.
   PR에 코어 PR/릴리스/커밋과 실제 검증 결과를 연결합니다. 양쪽 변경이 필요한 경우
   코어 릴리스가 먼저 준비되고 소비자 PR이 그 커밋을 고정하도록 순서를 맞춥니다.

Flight3d의 UI·콜백 연결만 바뀌는 작업에는 코어 릴리스나 의존성 갱신이 필요하지 않습니다.
코어 문서만 고치고 배포 API/동작을 바꾸지 않는 작업도 소비자 커밋 갱신을 요구하지 않습니다.

## 변경별 검증 선택

| 변경 | Flight3d에서 확인할 것 |
| --- | --- |
| 패키지 버전/exports/의존성 | `npm ci`, `tests/corePackageBoundary.test.js`, `tests/flightPhysicsCore.test.js`, `tests/headlessFlightSystems.test.js`, 빌드 |
| 힘·기체 설정·적분 | 해당 물리 테스트와 궤적 비교, `test:flight`; 접지·충돌 영향이 있으면 `test:crash` |
| 조종 응답·입력 장치 | `tests/flightControls.test.js`, `controlResponseAudit.test.js`, `hotasController.test.js`, 자이로/터치 관련 테스트; 모바일 입력이면 `test:mobile` |
| 오토파일럿·경보 | `tests/autopilot.test.js`, `flightWarnings.test.js`, `headlessFlightSystems.test.js`; 소리/표시를 바꾸면 실제 브라우저 확인 |
| 데모/미션·프리셋 | 해당 시나리오 테스트와 `test:demo` 또는 해당 미션 검증 |
| 문서·링크만 변경 | 경로·링크·절차를 실제 코드와 대조하고 diff 확인; 비행 시나리오 재실행은 필요하지 않음 |

Flight3d의 긴 전체 테스트는 원격 CI를 사용하고, 로컬에서는 변경에 맞는 집중 테스트와
`npm run check`를 실행합니다. 코어의 Node 테스트와 tarball 검증은 렌더링·터치·오디오를
증명하지 않습니다. 브라우저 검증이 필요하면 [하드웨어 GPU 절차](browser-gpu.md)를 따르고,
실행한 브라우저·렌더러·픽셀 검증과 시나리오 결과를 기록합니다. 실패·미실행·타임아웃은
통과로 기록하지 않습니다.

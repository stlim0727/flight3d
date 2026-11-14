# Gemini research snapshot 4

Source: https://share.gemini.google/Emf3m94rBCFt

Captured: 2026-11-13, using Obscura. This is an unverified external research archive, not an implementation specification. Read [the archive index](README.md) and its correction register first. Earlier errors are intentionally retained.

Scope: rendered shared-page text, full code blocks, extracted TeX annotations and links. This is not a capture of linked conversations, original attachments, hidden project context or Google account data. Page navigation/footer text is retained for capture fidelity. Source formatting may be flattened; the separate code and TeX sections preserve those representations where available.

## Rendered page text

```text
Gemini
현실적인 미사일 유도 제어 시스템 구현 스펙
https://share.gemini.google/qsH37Hb74SQH
Responses below were generated with a creator's Project according to their custom instructions. November 13, 2026 at 03:36 PM
Published November 13, 2026 at 03:37 PM
You said 중력 횡성분이 누락됐습니다. 유도 명령에서 중력을 보상했는데, 최종 가속도에는 중력의 종방향 성분만 더합니다. 전체 중력을 별도로 적용해야 보상이 일관되고, 락을 잃었을 때도 정상…

중력 횡성분이 누락됐습니다. 유도 명령에서 중력을 보상했는데, 최종 가속도에는 중력의 종방향 성분만 더합니다. 전체 중력을 별도로 적용해야 보상이 일관되고, 락을 잃었을 때도 정상적인 탄도 낙하가 됩니다.

ON_ENTRY도 CPA 통과를 기다립니다. 바깥 조건이 tauCpa < 1이라 이번 틱에 신관 경계에 진입해도 계속 접근 중이면 기폭하지 않습니다. 진입 모드와 CPA 모드의 조건을 분리하세요.

TVC 힘까지 공력 양력으로 환산해 유도항력을 계산합니다. 공력과 추력편향의 힘을 나누고, 추력편향에 따른 전방 추력 감소도 반영하세요.

norm² 피해 곡선은 역제곱 감쇠가 아니라 임의의 이차 감쇠 곡선입니다. 설명을 정정하세요.

공개되지 않은 값을 모두 ‘기밀’로 단정하지 말고, 출처 미확인·공개 자료 부족·모델 가정으로 구분하세요.

지적해 주신 5가지 결함과 부정확한 서술을 모두 수정했습니다.

중력 벡터 합산 일관성 복원: 유도 명령에서 중력을 보상(
−
g
⃗
⊥
v
^
m
-\vec{g}_{\perp\hat{v}_m}
−
g
​
⊥
v
^
m
​
​
)하는 것과 최종 운동방정식에 전체 중력 벡터 $\vec{g}$를 별도로 적용하는 것을 분리했습니다. 이로써 유도 활성 중에는 중력 횡성분이 정확히 상쇄되고, 락온 상실(Loss of Lock) 시 유도 명령이
0
0
0이 되면 전체 중력 $\vec{g}$의 횡·종 성분이 모두 작용하여 정상적인 포물선 탄도 낙하가 이루어집니다.

신관 기폭 조건 분리 (ON_ENTRY vs AT_CPA): 바깥의 tauCpa < 1.0 조건을 제거하여, ON_ENTRY 모드는 이번 틱 내에 신관 경계(
R
fuze
R_{\text{fuze}}
R
fuze
​
)에 진입(tauEntry <= 1.0)하는 즉시 기폭하고, AT_CPA 모드만 최단 접근점 통과(tauCpa < 1.0)까지 기다리도록 분기했습니다.

공력 횡력과 TVC 추력편향 분리 및 전방 추력 감소 반영: 총 횡가속도 명령을 공력 조종면이 담당할 양력(
F
aero, lat
F_{\text{aero, lat}}
F
aero, lat
​
)과 추력편향 노즐이 담당할 횡추력(
F
tvc, lat
F_{\text{tvc, lat}}
F
tvc, lat
​
)으로 분리했습니다. 유도항력(
C
D
i
C_{Di}
C
Di
​
)은 오직 공력 양력(
F
aero, lat
F_{\text{aero, lat}}
F
aero, lat
​
)만으로 계산하며, TVC 편향각 $\delta_{\text{TVC}}$에 따른 전방 유효 추력 감소(
T
cos
⁡
δ
TVC
T \cos\delta_{\text{TVC}}
Tcosδ
TVC
​
)를 종방향 가속도에 반영했습니다.

피해 감쇠 함수 설명 정정: 선형 정규화 거리 norm의 제곱(norm * norm)을 '역제곱 감쇠'라고 잘못 표기했던 부분을 정정하고, 임의의 2차 다항 감쇠 곡선(Quadratic Falloff)임을 명시했습니다(실제 역제곱 감쇠가 필요하다면
(
R
lethal
/
d
)
2
(R_{\text{lethal}}/d)^2
(R
lethal
​
/d)
2
형태로 별도 모델링해야 함을 구분).

출처 분류 표기 정정: 공개 미확인 데이터를 일괄 '비공개/기밀'로 단정하지 않고, 공개 1차 출처 확인 / 출처 미확인·공개 자료 부족 / 시뮬레이션 모델 가정으로 정확히 분류했습니다.

1. 제원 데이터 분류 정정 (출처 확인 vs 공개 자료 부족 vs 모델 가정)
항목
AIM-9M
AIM-9X
AIM-120C
검증 및 분류
길이 / 직경
2.87 m /
0.127 m
3.00 m /
0.127 m
3.66 m /
0.178 m
공개 1차 출처 확인 (USAF Fact Sheet)
발사 중량 (
m
0
​
)
85.5 kg (
190 lb)
약
84.4 kg (
186 lb)
150.75 kg (
335 lb)
공개 1차 출처 확인 (USAF/USN Fact Sheet)
탄두 형식 및 중량
환형 파편 (
9.4 kg)
환형 파편 (
9.4 kg)
고폭 파편 (약 $18\text{ kg}$급)
공개 확인 / 세부 작약량 자료 부족
추력편향(TVC) 유무
없음 (공력 카나드)
있음 (제트 베인 TVC)
없음 (공력 꼬리날개)
공개 1차 출처 확인 (USN Fact Sheet)
추진제 질량 / 추력 곡선 / 연소 시간
m
prop
​
≈27 kg,
t
burn
​
≈2.2 s,
T≈26.5 kN
m
prop
​
≈27 kg,
t
burn
​
≈2.2 s,
T≈26.5 kN
m
prop
​
≈48 kg, Boost(
2.5s)+Sustain(
5.5s)
출처 미확인 / 모델 가정 (세부 모터 곡선 공개 자료 부족으로
ΔV 역산 가정치 사용)
최대 기동 G / TVC 편향각
35G (공력 한계)
55G (
δ
TVC,max
​
≈15
∘
)
38G (공력 한계)
출처 미확인 / 모델 가정 (조종면 한계는 시뮬레이션 튜닝 파라미터)
시커 짐벌 한계 / 추적 각속도
±35
∘
/
25
∘
/s
±90
∘
/
40
∘
/s
±60
∘
/
35
∘
/s
출처 미확인 / 모델 가정 (HOBS 운용 개념 외 구체적 각속도는 모델 가정)
신관 작동 반경 (
R
fuze
​
) / 살상 반경 (
R
lethal
​
)
독립 파라미터로 별도 정의
독립 파라미터로 별도 정의
독립 파라미터로 별도 정의
모델 가정 (서로 독립된 게임·물리 판정 파라미터)
2. 수정된 물리·유도·기폭 수식
① 중력 보상과 운동방정식의 일관된 분리

유도 제어기가 요청하는 횡가속도 명령과 기체에 작용하는 실제 외부 중력을 명확히 분리합니다.

중력의 종방향 및 횡방향 분해:

g
⃗
∥
=
(
g
⃗
⋅
v
^
m
)
 
v
^
m
,
g
⃗
⊥
=
g
⃗
−
g
⃗
∥
\vec{g}_{\parallel} = (\vec{g} \cdot \hat{v}_m)\,\hat{v}_m, \quad \vec{g}_{\perp} = \vec{g} - \vec{g}_{\parallel}
g
​
∥
​
=(
g
​
⋅
v
^
m
​
)
v
^
m
​
,
g
​
⊥
​
=
g
​
−
g
​
∥
​

횡방향 유도 명령 (
a
⃗
lat, cmd
\vec{a}_{\text{lat, cmd}}
a
lat, cmd
​
):

락온(
locked
=
true
\text{locked} = \text{true}
locked=true) 상태에서만 중력 횡성분(
−
g
⃗
⊥
-\vec{g}_{\perp}
−
g
​
⊥
​
)을 보상하여 궤적 처짐을 방지합니다.

락온이 풀리면(
locked
=
false
\text{locked} = \text{false}
locked=false)
a
⃗
lat, cmd
=
0
⃗
\vec{a}_{\text{lat, cmd}} = \vec{0}
a
lat, cmd
​
=
0
이 됩니다.

a
⃗
raw
=
N
⋅
V
c
⋅
(
Ω
⃗
LOS
×
u
^
R
)
+
N
2
a
⃗
target
,
⊥
LOS
−
g
⃗
⊥
\vec{a}_{\text{raw}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2}\vec{a}_{\text{target},\perp\text{LOS}} - \vec{g}_{\perp}
a
raw
​
=N⋅V
c
​
⋅(
Ω
LOS
​
×
u
^
R
​
)+
2
N
​
a
target,⊥LOS
​
−
g
​
⊥
​
a
⃗
lat, cmd
=
a
⃗
raw
−
(
a
⃗
raw
⋅
v
^
m
)
 
v
^
m
\vec{a}_{\text{lat, cmd}} = \vec{a}_{\text{raw}} - (\vec{a}_{\text{raw}} \cdot \hat{v}_m)\,\hat{v}_m
a
lat, cmd
​
=
a
raw
​
−(
a
raw
​
⋅
v
^
m
​
)
v
^
m
​

최종 운동방정식 (전체 중력
g
⃗
\vec{g}
g
​
항상 적용):

a
⃗
total
=
(
T
forward
−
D
m
(
t
)
)
v
^
m
+
a
⃗
lat, actual
+
g
⃗
\vec{a}_{\text{total}} = \left(\frac{T_{\text{forward}} - D}{m(t)}\right)\hat{v}_m + \vec{a}_{\text{lat, actual}} + \vec{g}
a
total
​
=(
m(t)
T
forward
​
−D
​
)
v
^
m
​
+
a
lat, actual
​
+
g
​

검증: 유도 중에는
a
⃗
lat, actual
\vec{a}_{\text{lat, actual}}
a
lat, actual
​
안에 $-\vec{g}{\perp}$가 포함되어 $\vec{g}$의 횡성분과 상쇄되며, 락온이 풀려 $\vec{a}{\text{lat, actual}} \to \vec{0}$이 되면 $\vec{a}_{\text{total}}$에 전체 중력
g
⃗
\vec{g}
g
​
(종성분 + 횡성분)가 그대로 남아 정상적인 포물선 탄도 낙하를 그립니다.

② 공력 횡력과 TVC 추력편향 분리 및 전방 추력 감소

총 필요 횡력 $F_{\text{lat, req}} = m(t)\Vert{}\vec{a}_{\text{lat, cmd}}\Vert{}$를 공력과 TVC로 분배합니다.

가용 횡력 한계:

F
aero, max
=
q
ˉ
S
ref
C
L
max
⁡
,
F
tvc, max
=
T
(
t
)
sin
⁡
δ
TVC
,
max
⁡
F_{\text{aero, max}} = \bar{q} S_{\text{ref}} C_{L\max}, \quad F_{\text{tvc, max}} = T(t)\sin\delta_{\text{TVC},\max}
F
aero, max
​
=
q
ˉ
​
S
ref
​
C
Lmax
​
,F
tvc, max
​
=T(t)sinδ
TVC,max
​
F
lat, actual
=
min
⁡
(
m
(
t
)
G
struct
g
0
,
  
F
aero, max
+
F
tvc, max
)
F_{\text{lat, actual}} = \min\left(m(t) G_{\text{struct}} g_0, \; F_{\text{aero, max}} + F_{\text{tvc, max}}\right)
F
lat, actual
​
=min(m(t)G
struct
​
g
0
​
,F
aero, max
​
+F
tvc, max
​
)

공력 양력과 TVC 횡추력 분배 (공력 우선 사용 후 부족분을 TVC로 보충):

F
aero, lat
=
min
⁡
(
F
lat, actual
,
  
F
aero, max
)
F_{\text{aero, lat}} = \min(F_{\text{lat, actual}}, \; F_{\text{aero, max}})
F
aero, lat
​
=min(F
lat, actual
​
,F
aero, max
​
)
F
tvc, lat
=
max
⁡
(
0
,
  
F
lat, actual
−
F
aero, lat
)
F_{\text{tvc, lat}} = \max(0, \; F_{\text{lat, actual}} - F_{\text{aero, lat}})
F
tvc, lat
​
=max(0,F
lat, actual
​
−F
aero, lat
​
)

유도항력(공력 양력만 반영) 및 전방 추력 감소(TVC 편향각 반영):

유도항력: TVC 횡추력은 노즐 제트 편향이므로 날개 유도항력을 발생시키지 않습니다. 오직 $F_{\text{aero, lat}}$만
C
L
C_L
C
L
​
로 환산합니다.

C
L
=
F
aero, lat
q
ˉ
S
ref
,
C
D
=
C
D
0
(
Mach
)
+
K
(
Mach
)
C
L
2
C_L = \frac{F_{\text{aero, lat}}}{\bar{q} S_{\text{ref}}}, \quad C_D = C_{D0}(\text{Mach}) + K(\text{Mach}) C_L^2
C
L
​
=
q
ˉ
​
S
ref
​
F
aero, lat
​
​
,C
D
​
=C
D0
​
(Mach)+K(Mach)C
L
2
​

전방 유효 추력 감소: TVC로 $F_{\text{tvc, lat}}$만큼 추력 벡터를 꺾으면 전방 축 추력은 피타고라스 관계에 의해 감소합니다.

sin
⁡
δ
TVC
=
F
tvc, lat
T
(
t
)
,
T
forward
=
max
⁡
(
0
,
  
T
(
t
)
2
−
F
tvc, lat
2
)
=
T
(
t
)
cos
⁡
δ
TVC
\sin\delta_{\text{TVC}} = \frac{F_{\text{tvc, lat}}}{T(t)}, \quad T_{\text{forward}} = \sqrt{\max\left(0, \; T(t)^2 - F_{\text{tvc, lat}}^2\right)} = T(t)\cos\delta_{\text{TVC}}
sinδ
TVC
​
=
T(t)
F
tvc, lat
​
​
,T
forward
​
=
max(0,T(t)
2
−F
tvc, lat
2
​
)
​
=T(t)cosδ
TVC
​
③ 신관 기폭 조건 분리 (ON_ENTRY vs AT_CPA)

두 모드의 기폭 트리거 조건을 완전히 분리합니다.

경계 진입 즉시 기폭 (ON_ENTRY):

틱 시작 시 이미 반경 내부(
∥
r
⃗
0
∥
≤
R
fuze
\Vert{}\vec{r}_0\Vert{} \le R_{\text{fuze}}
∥
r
0
​
∥≤R
fuze
​
)이거나, 이번 틱 동안 신관 구면 경계(
∥
r
⃗
(
τ
)
∥
=
R
fuze
\Vert{}\vec{r}(\tau)\Vert{} = R_{\text{fuze}}
∥
r
(τ)∥=R
fuze
​
)를 밖에서 안으로 관통하는 진입 근
τ
entry
∈
[
0
,
1
]
\tau_{\text{entry}} \in [0, 1]
τ
entry
​
∈[0,1] 이 존재하면 최단점(CPA) 통과를 기다리지 않고 즉시
τ
entry
\tau_{\text{entry}}
τ
entry
​
시점에 기폭합니다.

최단 접근점 지연 기폭 (AT_CPA):

틱 내 최단 접근 거리
d
cpa
≤
R
fuze
d_{\text{cpa}} \le R_{\text{fuze}}
d
cpa
​
≤R
fuze
​
이면서, 최단 접근 시각이 이번 틱 내부에서 지나간 경우(
τ
cpa
<
1.0
\tau_{\text{cpa}} < 1.0
τ
cpa
​
<1.0, 즉 거리가 최소치를 찍고 멀어지기 시작한 시점)에
τ
cpa
\tau_{\text{cpa}}
τ
cpa
​
시점으로 보간하여 기폭합니다.

④ 탄두 피해 곡선 모델링 표기 정정

norm = 1 - (d - R_lethal) / (R_fuze_max - R_lethal)에 대한 norm * norm 계산은 물리적 역제곱 법칙(
1
/
d
2
1/d^2
1/d
2
)이 아니라 경계에서
1.0
1.0
1.0, 최대 파편 반경에서
0.0
0.0
0.0으로 부드럽게 떨어지는 임의의 2차 감쇠 곡선(Quadratic Falloff Curve)입니다. 물리적 역제곱 감쇠 근사를 원한다면
(
R
lethal
/
d
)
2
(R_{\text{lethal}} / d)^2
(R
lethal
​
/d)
2
형태를 별도로 선택할 수 있도록 구분해야 합니다.

3. 수정된 120Hz 고정 스텝 TypeScript 코드
TypeScript
import * as THREE from 'three'; export interface MissileSpec { id: 'aim-9m' | 'aim-9x' | 'aim-120c' | 'manpads'; // [공개 1차 출처 확인값] lengthM: number; diameterM: number; massInitialKg: number; warheadMassKg: number; // [출처 미확인 / 시뮬레이션 모델 가정값 - 추진 및 공력] propellantMassKg: number; boostTimeSec: number; burnTimeSec: number; boostThrustN: number; sustainThrustN: number; hasTVC: boolean; tvcMaxDeflectionRad: number; // 예: AIM-9X ~ 0.26 rad (15 deg) cd0Subsonic: number; cd0TransonicPeak: number; cd0Supersonic: number; inducedDragK: number; clMax: number; structuralMaxG: number; autopilotTauSec: number; // [출처 미확인 / 시뮬레이션 모델 가정값 - 유도 및 시커] navGain: number; apnTargetAccelWeight: number; gimbalLimitRad: number; // [시뮬레이션 모델 가정값 - 독립된 신관 및 탄두 모델] fuzeTriggerRadiusM: number; fuzeTriggerMode: 'ON_ENTRY' | 'AT_CPA'; warheadLethalRadiusM: number; warheadMaxFragRadiusM: number; damageFalloffModel: 'QUADRATIC' | 'INVERSE_SQUARE'; } export interface DetonationEvent { detonated: boolean; tau: number; detonationPos: THREE.Vector3; targetPosAtDet: THREE.Vector3; damageDistanceM: number; isLethalKill: boolean; damageRatio: number; } const _r0 = new THREE.Vector3(); const _r1 = new THREE.Vector3(); const _dr = new THREE.Vector3(); const _vHat = new THREE.Vector3(); const _losDir = new THREE.Vector3(); const _relVel = new THREE.Vector3(); const _omegaLOS = new THREE.Vector3(); const _aRaw = new THREE.Vector3(); const _aTargetPerpLOS = new THREE.Vector3(); const _aLatCmd = new THREE.Vector3(); const _aLatTarget = new THREE.Vector3(); const _gPerp = new THREE.Vector3(); const _gravity = new THREE.Vector3(0, -9.80665, 0); export function stepMissile120Hz( dt: number, // 1 / 120 missile: { pos: THREE.Vector3; prevPos: THREE.Vector3; vel: THREE.Vector3; latAccel: THREE.Vector3; flightTime: number; locked: boolean; active: boolean; }, target: { pos: THREE.Vector3; prevPos: THREE.Vector3; vel: THREE.Vector3; accel: THREE.Vector3; }, spec: MissileSpec, airDensity: number, speedOfSound: number
): DetonationEvent | null { if (!missile.active) return null; missile.prevPos.copy(missile.pos); missile.flightTime += dt; // 1. 가변 질량 및 총 추력 (모델 가정: 구간별 일정 연소율) const burnFrac = Math.min(missile.flightTime / spec.burnTimeSec, 1.0); const currentMass = spec.massInitialKg - spec.propellantMassKg * burnFrac; const isBurning = missile.flightTime <= spec.burnTimeSec; const totalThrust = isBurning ? (missile.flightTime <= spec.boostTimeSec ? spec.boostThrustN : spec.sustainThrustN) : 0.0; // 2. 시커 짐벌 한계 검사 _r0.subVectors(target.pos, missile.pos); const dist = _r0.length(); const speed = missile.vel.length(); if (speed > 1e-3 && dist > 1e-3) { _vHat.copy(missile.vel).divideScalar(speed); _losDir.copy(_r0).divideScalar(dist); const offBoresight = Math.acos(THREE.MathUtils.clamp(_vHat.dot(_losDir), -1, 1)); if (offBoresight > spec.gimbalLimitRad) { missile.locked = false; } } // 3. 속도 벡터 직교 횡방향 유도 명령 (중력 횡성분 보상 포함) _aLatTarget.set(0, 0, 0); const qBar = 0.5 * airDensity * speed * speed; const refArea = Math.PI * Math.pow(spec.diameterM * 0.5, 2); const aeroMaxForce = qBar * refArea * spec.clMax; const tvcMaxLateralForce = isBurning && spec.hasTVC ? totalThrust * Math.sin(spec.tvcMaxDeflectionRad) : 0.0; if (missile.locked && speed > 10.0 && dist > 1.0) { _relVel.subVectors(target.vel, missile.vel); const closingVel = -_losDir.dot(_relVel); if (closingVel > 0) { _omegaLOS.crossVectors(_r0, _relVel).divideScalar(dist * dist); _aRaw.crossVectors(_omegaLOS, _losDir).multiplyScalar(spec.navGain * closingVel); // APN 표적 기동 보정 _aTargetPerpLOS.copy(target.accel).addScaledVector(_losDir, -target.accel.dot(_losDir)); _aRaw.addScaledVector(_aTargetPerpLOS, spec.navGain * spec.apnTargetAccelWeight); // 중력의 횡성분(g_perp)만 추출하여 유도 명령에서 보상 _gPerp.copy(_gravity).addScaledVector(_vHat, -_gravity.dot(_vHat)); _aRaw.sub(_gPerp); // 속도 벡터 vHat 방향 성분을 제거하여 순수 횡가속도 명령만 남김 _aLatCmd.copy(_aRaw).addScaledVector(_vHat, -_aRaw.dot(_vHat)); const maxLatAccel = Math.min( spec.structuralMaxG * 9.80665, (aeroMaxForce + tvcMaxLateralForce) / currentMass ); if (_aLatCmd.length() > maxLatAccel) { _aLatCmd.normalize().multiplyScalar(maxLatAccel); } _aLatTarget.copy(_aLatCmd); } } // 1차 액추에이터 지연 필터 및 직교성 유지 const lagAlpha = dt / (spec.autopilotTauSec + dt); missile.latAccel.lerp(_aLatTarget, lagAlpha); if (speed > 1e-3) { missile.latAccel.addScaledVector(_vHat, -missile.latAccel.dot(_vHat)); } // 4. 공력 양력과 TVC 추력편향 분리 -> 유도항력 및 전방 추력 감소 계산 const totalLatForce = missile.latAccel.length() * currentMass; const aeroLatForce = Math.min(totalLatForce, aeroMaxForce); const tvcLatForce = Math.min( Math.max(0.0, totalLatForce - aeroLatForce), tvcMaxLateralForce ); // 전방 유효 추력: TVC 편향으로 인한 코사인 성분 감소 반영 const forwardThrust = isBurning ? Math.sqrt(Math.max(0.0, totalThrust * totalThrust - tvcLatForce * tvcLatForce)) : 0.0; // 유도항력은 오직 공력 양력(aeroLatForce)만으로 산출 const mach = speed / Math.max(speedOfSound, 1.0); const cd0 = mach < 0.85 ? spec.cd0Subsonic : mach < 1.2 ? spec.cd0TransonicPeak : spec.cd0Supersonic; const clCurrent = qBar > 1.0 ? aeroLatForce / (qBar * refArea) : 0.0; const cdTotal = cd0 + spec.inducedDragK * clCurrent * clCurrent; const dragForce = qBar * refArea * cdTotal; const aForward = (forwardThrust - dragForce) / currentMass; // 5. 최종 가속도 적분: 종방향(추력-항력) + 횡방향 유도 + 전체 중력(_gravity) missile.vel.addScaledVector(_vHat, aForward * dt); missile.vel.addScaledVector(missile.latAccel, dt); missile.vel.addScaledVector(_gravity, dt); missile.pos.addScaledVector(missile.vel, dt); // 6. 동시각 선형 보간 근접신관 판정 (ON_ENTRY / AT_CPA 분리) return evaluateCoTemporalFuze(missile.prevPos, missile.pos, target.prevPos, target.pos, spec); } function evaluateCoTemporalFuze( m0: THREE.Vector3, m1: THREE.Vector3, t0: THREE.Vector3, t1: THREE.Vector3, spec: MissileSpec ): DetonationEvent | null { _r0.subVectors(t0, m0); _r1.subVectors(t1, m1); _dr.subVectors(_r1, _r0); const r0Sq = _r0.lengthSq(); const drLenSq = _dr.lengthSq(); const fuzeRadiusSq = spec.fuzeTriggerRadiusM * spec.fuzeTriggerRadiusM; let triggered = false; let tauDet = 0.0; if (spec.fuzeTriggerMode === 'ON_ENTRY') { // [모드 1: 경계 진입 즉시 기폭] 최단점(CPA) 통과를 기다리지 않고 진입 순간 즉시 기폭 if (r0Sq <= fuzeRadiusSq) { triggered = true; tauDet = 0.0; } else if (drLenSq > 1e-9) { const b = _r0.dot(_dr); const c = r0Sq - fuzeRadiusSq; const disc = b * b - drLenSq * c; if (disc >= 0) { const tauEntry = (-b - Math.sqrt(disc)) / drLenSq; if (tauEntry >= 0.0 && tauEntry <= 1.0) { triggered = true; tauDet = tauEntry; } } } } else { // [모드 2: 최단 접근점 지연 기폭] 최단 거리가 반경 이내이고 이번 틱 내부에서 통과(tauCpa < 1) 시 기폭 const tauCpa = drLenSq > 1e-9 ? THREE.MathUtils.clamp(-_r0.dot(_dr) / drLenSq, 0.0, 1.0) : 0.0; const distAtCpaSq = r0Sq + 2 * _r0.dot(_dr) * tauCpa + drLenSq * tauCpa * tauCpa; if (distAtCpaSq <= fuzeRadiusSq && tauCpa < 1.0) { triggered = true; tauDet = tauCpa; } } if (!triggered) return null; const detonationPos = new THREE.Vector3().lerpVectors(m0, m1, tauDet); const targetPosAtDet = new THREE.Vector3().lerpVectors(t0, t1, tauDet); const damageDistanceM = detonationPos.distanceTo(targetPosAtDet); // 독립된 탄두 살상 반경 기준 피해 계산 const isLethalKill = damageDistanceM <= spec.warheadLethalRadiusM; let damageRatio = 0.0; if (isLethalKill) { damageRatio = 1.0; } else if (damageDistanceM <= spec.warheadMaxFragRadiusM) { if (spec.damageFalloffModel === 'INVERSE_SQUARE') { // 물리적 역제곱 감쇠 근사: (R_lethal / d)^2 const ratio = spec.warheadLethalRadiusM / Math.max(damageDistanceM, 1e-3); damageRatio = THREE.MathUtils.clamp(ratio * ratio, 0.0, 1.0); } else { // 임의의 2차 감쇠 곡선 (Quadratic Falloff) const span = Math.max(spec.warheadMaxFragRadiusM - spec.warheadLethalRadiusM, 0.1); const norm = 1.0 - (damageDistanceM - spec.warheadLethalRadiusM) / span; damageRatio = norm * norm; } } return { detonated: true, tau: tauDet, detonationPos, targetPosAtDet, damageDistanceM, isLethalKill, damageRatio, }; }
Sign in

Gemini may display inaccurate info, including about people, so double-check its responses.

Google Privacy Policy
Opens in a new window
Google Terms of Service
Opens in a new window
Your privacy & Gemini Apps
Opens in a new window
About Gemini
Subscriptions
For Business
Sign in
```

## Code blocks extracted from the page

### Block 1

```text
import * as THREE from 'three';

export interface MissileSpec {
  id: 'aim-9m' | 'aim-9x' | 'aim-120c' | 'manpads';
  // [공개 1차 출처 확인값]
  lengthM: number;
  diameterM: number;
  massInitialKg: number;
  warheadMassKg: number;

  // [출처 미확인 / 시뮬레이션 모델 가정값 - 추진 및 공력]
  propellantMassKg: number;
  boostTimeSec: number;
  burnTimeSec: number;
  boostThrustN: number;
  sustainThrustN: number;
  hasTVC: boolean;
  tvcMaxDeflectionRad: number; // 예: AIM-9X ~ 0.26 rad (15 deg)
  cd0Subsonic: number;
  cd0TransonicPeak: number;
  cd0Supersonic: number;
  inducedDragK: number;
  clMax: number;
  structuralMaxG: number;
  autopilotTauSec: number;

  // [출처 미확인 / 시뮬레이션 모델 가정값 - 유도 및 시커]
  navGain: number;
  apnTargetAccelWeight: number;
  gimbalLimitRad: number;

  // [시뮬레이션 모델 가정값 - 독립된 신관 및 탄두 모델]
  fuzeTriggerRadiusM: number;
  fuzeTriggerMode: 'ON_ENTRY' | 'AT_CPA';
  warheadLethalRadiusM: number;
  warheadMaxFragRadiusM: number;
  damageFalloffModel: 'QUADRATIC' | 'INVERSE_SQUARE';
}

export interface DetonationEvent {
  detonated: boolean;
  tau: number;
  detonationPos: THREE.Vector3;
  targetPosAtDet: THREE.Vector3;
  damageDistanceM: number;
  isLethalKill: boolean;
  damageRatio: number;
}

const _r0 = new THREE.Vector3();
const _r1 = new THREE.Vector3();
const _dr = new THREE.Vector3();
const _vHat = new THREE.Vector3();
const _losDir = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _omegaLOS = new THREE.Vector3();
const _aRaw = new THREE.Vector3();
const _aTargetPerpLOS = new THREE.Vector3();
const _aLatCmd = new THREE.Vector3();
const _aLatTarget = new THREE.Vector3();
const _gPerp = new THREE.Vector3();
const _gravity = new THREE.Vector3(0, -9.80665, 0);

export function stepMissile120Hz(
  dt: number, // 1 / 120
  missile: {
    pos: THREE.Vector3;
    prevPos: THREE.Vector3;
    vel: THREE.Vector3;
    latAccel: THREE.Vector3;
    flightTime: number;
    locked: boolean;
    active: boolean;
  },
  target: {
    pos: THREE.Vector3;
    prevPos: THREE.Vector3;
    vel: THREE.Vector3;
    accel: THREE.Vector3;
  },
  spec: MissileSpec,
  airDensity: number,
  speedOfSound: number
): DetonationEvent | null {
  if (!missile.active) return null;

  missile.prevPos.copy(missile.pos);
  missile.flightTime += dt;

  // 1. 가변 질량 및 총 추력 (모델 가정: 구간별 일정 연소율)
  const burnFrac = Math.min(missile.flightTime / spec.burnTimeSec, 1.0);
  const currentMass = spec.massInitialKg - spec.propellantMassKg * burnFrac;
  const isBurning = missile.flightTime <= spec.burnTimeSec;
  const totalThrust = isBurning
    ? (missile.flightTime <= spec.boostTimeSec ? spec.boostThrustN : spec.sustainThrustN)
    : 0.0;

  // 2. 시커 짐벌 한계 검사
  _r0.subVectors(target.pos, missile.pos);
  const dist = _r0.length();
  const speed = missile.vel.length();

  if (speed > 1e-3 && dist > 1e-3) {
    _vHat.copy(missile.vel).divideScalar(speed);
    _losDir.copy(_r0).divideScalar(dist);
    const offBoresight = Math.acos(THREE.MathUtils.clamp(_vHat.dot(_losDir), -1, 1));
    if (offBoresight > spec.gimbalLimitRad) {
      missile.locked = false;
    }
  }

  // 3. 속도 벡터 직교 횡방향 유도 명령 (중력 횡성분 보상 포함)
  _aLatTarget.set(0, 0, 0);
  const qBar = 0.5 * airDensity * speed * speed;
  const refArea = Math.PI * Math.pow(spec.diameterM * 0.5, 2);
  const aeroMaxForce = qBar * refArea * spec.clMax;
  const tvcMaxLateralForce =
    isBurning && spec.hasTVC ? totalThrust * Math.sin(spec.tvcMaxDeflectionRad) : 0.0;

  if (missile.locked && speed > 10.0 && dist > 1.0) {
    _relVel.subVectors(target.vel, missile.vel);
    const closingVel = -_losDir.dot(_relVel);

    if (closingVel > 0) {
      _omegaLOS.crossVectors(_r0, _relVel).divideScalar(dist * dist);
      _aRaw.crossVectors(_omegaLOS, _losDir).multiplyScalar(spec.navGain * closingVel);

      // APN 표적 기동 보정
      _aTargetPerpLOS.copy(target.accel).addScaledVector(_losDir, -target.accel.dot(_losDir));
      _aRaw.addScaledVector(_aTargetPerpLOS, spec.navGain * spec.apnTargetAccelWeight);

      // 중력의 횡성분(g_perp)만 추출하여 유도 명령에서 보상
      _gPerp.copy(_gravity).addScaledVector(_vHat, -_gravity.dot(_vHat));
      _aRaw.sub(_gPerp);

      // 속도 벡터 vHat 방향 성분을 제거하여 순수 횡가속도 명령만 남김
      _aLatCmd.copy(_aRaw).addScaledVector(_vHat, -_aRaw.dot(_vHat));

      const maxLatAccel = Math.min(
        spec.structuralMaxG * 9.80665,
        (aeroMaxForce + tvcMaxLateralForce) / currentMass
      );

      if (_aLatCmd.length() > maxLatAccel) {
        _aLatCmd.normalize().multiplyScalar(maxLatAccel);
      }
      _aLatTarget.copy(_aLatCmd);
    }
  }

  // 1차 액추에이터 지연 필터 및 직교성 유지
  const lagAlpha = dt / (spec.autopilotTauSec + dt);
  missile.latAccel.lerp(_aLatTarget, lagAlpha);
  if (speed > 1e-3) {
    missile.latAccel.addScaledVector(_vHat, -missile.latAccel.dot(_vHat));
  }

  // 4. 공력 양력과 TVC 추력편향 분리 -> 유도항력 및 전방 추력 감소 계산
  const totalLatForce = missile.latAccel.length() * currentMass;
  const aeroLatForce = Math.min(totalLatForce, aeroMaxForce);
  const tvcLatForce = Math.min(
    Math.max(0.0, totalLatForce - aeroLatForce),
    tvcMaxLateralForce
  );

  // 전방 유효 추력: TVC 편향으로 인한 코사인 성분 감소 반영
  const forwardThrust = isBurning
    ? Math.sqrt(Math.max(0.0, totalThrust * totalThrust - tvcLatForce * tvcLatForce))
    : 0.0;

  // 유도항력은 오직 공력 양력(aeroLatForce)만으로 산출
  const mach = speed / Math.max(speedOfSound, 1.0);
  const cd0 =
    mach < 0.85
      ? spec.cd0Subsonic
      : mach < 1.2
        ? spec.cd0TransonicPeak
        : spec.cd0Supersonic;

  const clCurrent = qBar > 1.0 ? aeroLatForce / (qBar * refArea) : 0.0;
  const cdTotal = cd0 + spec.inducedDragK * clCurrent * clCurrent;
  const dragForce = qBar * refArea * cdTotal;

  const aForward = (forwardThrust - dragForce) / currentMass;

  // 5. 최종 가속도 적분: 종방향(추력-항력) + 횡방향 유도 + 전체 중력(_gravity)
  missile.vel.addScaledVector(_vHat, aForward * dt);
  missile.vel.addScaledVector(missile.latAccel, dt);
  missile.vel.addScaledVector(_gravity, dt);
  missile.pos.addScaledVector(missile.vel, dt);

  // 6. 동시각 선형 보간 근접신관 판정 (ON_ENTRY / AT_CPA 분리)
  return evaluateCoTemporalFuze(missile.prevPos, missile.pos, target.prevPos, target.pos, spec);
}

function evaluateCoTemporalFuze(
  m0: THREE.Vector3,
  m1: THREE.Vector3,
  t0: THREE.Vector3,
  t1: THREE.Vector3,
  spec: MissileSpec
): DetonationEvent | null {
  _r0.subVectors(t0, m0);
  _r1.subVectors(t1, m1);
  _dr.subVectors(_r1, _r0);

  const r0Sq = _r0.lengthSq();
  const drLenSq = _dr.lengthSq();
  const fuzeRadiusSq = spec.fuzeTriggerRadiusM * spec.fuzeTriggerRadiusM;

  let triggered = false;
  let tauDet = 0.0;

  if (spec.fuzeTriggerMode === 'ON_ENTRY') {
    // [모드 1: 경계 진입 즉시 기폭] 최단점(CPA) 통과를 기다리지 않고 진입 순간 즉시 기폭
    if (r0Sq <= fuzeRadiusSq) {
      triggered = true;
      tauDet = 0.0;
    } else if (drLenSq > 1e-9) {
      const b = _r0.dot(_dr);
      const c = r0Sq - fuzeRadiusSq;
      const disc = b * b - drLenSq * c;
      if (disc >= 0) {
        const tauEntry = (-b - Math.sqrt(disc)) / drLenSq;
        if (tauEntry >= 0.0 && tauEntry <= 1.0) {
          triggered = true;
          tauDet = tauEntry;
        }
      }
    }
  } else {
    // [모드 2: 최단 접근점 지연 기폭] 최단 거리가 반경 이내이고 이번 틱 내부에서 통과(tauCpa < 1) 시 기폭
    const tauCpa = drLenSq > 1e-9 ? THREE.MathUtils.clamp(-_r0.dot(_dr) / drLenSq, 0.0, 1.0) : 0.0;
    const distAtCpaSq = r0Sq + 2 * _r0.dot(_dr) * tauCpa + drLenSq * tauCpa * tauCpa;
    if (distAtCpaSq <= fuzeRadiusSq && tauCpa < 1.0) {
      triggered = true;
      tauDet = tauCpa;
    }
  }

  if (!triggered) return null;

  const detonationPos = new THREE.Vector3().lerpVectors(m0, m1, tauDet);
  const targetPosAtDet = new THREE.Vector3().lerpVectors(t0, t1, tauDet);
  const damageDistanceM = detonationPos.distanceTo(targetPosAtDet);

  // 독립된 탄두 살상 반경 기준 피해 계산
  const isLethalKill = damageDistanceM <= spec.warheadLethalRadiusM;
  let damageRatio = 0.0;

  if (isLethalKill) {
    damageRatio = 1.0;
  } else if (damageDistanceM <= spec.warheadMaxFragRadiusM) {
    if (spec.damageFalloffModel === 'INVERSE_SQUARE') {
      // 물리적 역제곱 감쇠 근사: (R_lethal / d)^2
      const ratio = spec.warheadLethalRadiusM / Math.max(damageDistanceM, 1e-3);
      damageRatio = THREE.MathUtils.clamp(ratio * ratio, 0.0, 1.0);
    } else {
      // 임의의 2차 감쇠 곡선 (Quadratic Falloff)
      const span = Math.max(spec.warheadMaxFragRadiusM - spec.warheadLethalRadiusM, 0.1);
      const norm = 1.0 - (damageDistanceM - spec.warheadLethalRadiusM) / span;
      damageRatio = norm * norm;
    }
  }

  return {
    detonated: true,
    tau: tauDet,
    detonationPos,
    targetPosAtDet,
    damageDistanceM,
    isLethalKill,
    damageRatio,
  };
}

```

## TeX annotations in document order

### Equation 1

```tex
-\vec{g}_{\perp\hat{v}_m}
```

### Equation 2

```tex
0
```

### Equation 3

```tex
R_{\text{fuze}}
```

### Equation 4

```tex
F_{\text{aero, lat}}
```

### Equation 5

```tex
F_{\text{tvc, lat}}
```

### Equation 6

```tex
C_{Di}
```

### Equation 7

```tex
F_{\text{aero, lat}}
```

### Equation 8

```tex
T \cos\delta_{\text{TVC}}
```

### Equation 9

```tex
(R_{\text{lethal}}/d)^2
```

### Equation 10

```tex
\vec{g}_{\parallel} = (\vec{g} \cdot \hat{v}_m)\,\hat{v}_m, \quad \vec{g}_{\perp} = \vec{g} - \vec{g}_{\parallel}
```

### Equation 11

```tex
\vec{a}_{\text{lat, cmd}}
```

### Equation 12

```tex
\text{locked} = \text{true}
```

### Equation 13

```tex
-\vec{g}_{\perp}
```

### Equation 14

```tex
\text{locked} = \text{false}
```

### Equation 15

```tex
\vec{a}_{\text{lat, cmd}} = \vec{0}
```

### Equation 16

```tex
\vec{a}_{\text{raw}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2}\vec{a}_{\text{target},\perp\text{LOS}} - \vec{g}_{\perp}
```

### Equation 17

```tex
\vec{a}_{\text{lat, cmd}} = \vec{a}_{\text{raw}} - (\vec{a}_{\text{raw}} \cdot \hat{v}_m)\,\hat{v}_m
```

### Equation 18

```tex
\vec{g}
```

### Equation 19

```tex
\vec{a}_{\text{total}} = \left(\frac{T_{\text{forward}} - D}{m(t)}\right)\hat{v}_m + \vec{a}_{\text{lat, actual}} + \vec{g}
```

### Equation 20

```tex
\vec{a}_{\text{lat, actual}}
```

### Equation 21

```tex
\vec{g}
```

### Equation 22

```tex
F_{\text{aero, max}} = \bar{q} S_{\text{ref}} C_{L\max}, \quad F_{\text{tvc, max}} = T(t)\sin\delta_{\text{TVC},\max}
```

### Equation 23

```tex
F_{\text{lat, actual}} = \min\left(m(t) G_{\text{struct}} g_0, \; F_{\text{aero, max}} + F_{\text{tvc, max}}\right)
```

### Equation 24

```tex
F_{\text{aero, lat}} = \min(F_{\text{lat, actual}}, \; F_{\text{aero, max}})
```

### Equation 25

```tex
F_{\text{tvc, lat}} = \max(0, \; F_{\text{lat, actual}} - F_{\text{aero, lat}})
```

### Equation 26

```tex
C_L
```

### Equation 27

```tex
C_L = \frac{F_{\text{aero, lat}}}{\bar{q} S_{\text{ref}}}, \quad C_D = C_{D0}(\text{Mach}) + K(\text{Mach}) C_L^2
```

### Equation 28

```tex
\sin\delta_{\text{TVC}} = \frac{F_{\text{tvc, lat}}}{T(t)}, \quad T_{\text{forward}} = \sqrt{\max\left(0, \; T(t)^2 - F_{\text{tvc, lat}}^2\right)} = T(t)\cos\delta_{\text{TVC}}
```

### Equation 29

```tex
\Vert{}\vec{r}_0\Vert{} \le R_{\text{fuze}}
```

### Equation 30

```tex
\Vert{}\vec{r}(\tau)\Vert{} = R_{\text{fuze}}
```

### Equation 31

```tex
\tau_{\text{entry}} \in [0, 1]
```

### Equation 32

```tex
\tau_{\text{entry}}
```

### Equation 33

```tex
d_{\text{cpa}} \le R_{\text{fuze}}
```

### Equation 34

```tex
\tau_{\text{cpa}} < 1.0
```

### Equation 35

```tex
\tau_{\text{cpa}}
```

### Equation 36

```tex
1/d^2
```

### Equation 37

```tex
1.0
```

### Equation 38

```tex
0.0
```

### Equation 39

```tex
(R_{\text{lethal}} / d)^2
```

## Links present in the page

- "": https://www.google.co.kr/intl/en/about/products
- "Sign in": https://accounts.google.com/ServiceLogin?passive=1209600&osid=1&continue=https://gemini.google.com/share/4732e922ab81?social_preview%3Dtrue%26skid%3D8f949a6e-4ad9-44ff-b24e-6d713e078825&followup=https://gemini.google.com/share/4732e922ab81?social_preview%3Dtrue%26skid%3D8f949a6e-4ad9-44ff-b24e-6d713e078825&ec=GAZAkgU
- "Gemini": https://gemini.google.com/app
- "https://share.gemini.google/qsH37Hb74SQH": https://share.gemini.google/qsH37Hb74SQH
- "Google Privacy Policy\nOpens in a new window": https://policies.google.com/privacy
- "Google Terms of Service\nOpens in a new window": https://policies.google.com/terms
- "Your privacy & Gemini Apps\nOpens in a new window": https://support.google.com/gemini?p=privacy_notice
- "About Gemini": https://gemini.google/about/?utm_source=gemini&utm_medium=web&utm_campaign=gemini_zero_state_link_to_marketing_microsite
- "Subscriptions": https://one.google.com/ai
- "For Business": http://g.co/cloud/gemini-for-business

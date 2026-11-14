# Gemini research snapshot 1

Source: https://share.gemini.google/XwO8Isutc9dQ

Captured: 2026-11-13, using Obscura. This is an unverified external research archive, not an implementation specification. Read [the archive index](README.md) and its correction register first. Earlier errors are intentionally retained.

Scope: rendered shared-page text, full code blocks, extracted TeX annotations and links. This is not a capture of linked conversations, original attachments, hidden project context or Google account data. Page navigation/footer text is retained for capture fidelity. Source formatting may be flattened; the separate code and TeX sections preserve those representations where available.

## Rendered page text

```text
Gemini
현실적인 미사일 유도 제어 시스템 구현 스펙
https://share.gemini.google/Du66hd1xbHg8
Responses below were generated with a creator's Project according to their custom instructions. November 13, 2026 at 03:26 PM
Published November 13, 2026 at 03:29 PM
You said Https://github.com/stlim0727/flight3d/issues/713 현실적 구현을 위해 필요한 니가 할 수 있는 최선의 연구를 해봐. 미사일 정보, 수치, 공…

Https://github.com/stlim0727/flight3d/issues/713




현실적 구현을 위해 필요한 니가 할 수 있는 최선의 연구를 해봐. 미사일 정보, 수치, 공식 등등

flight3d 프로젝트의 issue #713에 대해 직접 외부 GitHub 페이지에 접속해 본문을 읽어오는 기능은 지원되지 않지만, 기존 아키텍처(Three.js + Rapier3D 기반 240Hz 서브스테핑 6-DOF 물리 엔진
)와 이전에 정리된 보유 기종(F-16 등
)을 바탕으로 현실적인 미사일(공대공/지대공 유도탄) 시스템 구현을 위한 완벽한 항공역학·유도 제어·폭발 물리 스펙과 수학 공식을 정리해 드립니다.

코딩 에이전트나 직접 구현에 바로 적용할 수 있도록 6-DOF 미사일 비행 역학, 비례항법(PN) 유도 알고리즘, 시커(Seeker) 모델, 근접신관(Proximity Fuze) 및 파편 피해(Frag) 공식까지 체계적으로 구성했습니다.

1. 대표 미사일 제원 데이터베이스 (MissileSpecs)

F-16 Fighting Falcon
및 현대 공중전 시뮬레이션 표준이 되는 단거리 적외선 유도탄(AIM-9M/X)과 중거리 능동 레이더 유도탄(AIM-120C AMRAAM), 그리고 위협용 지대공 미사일(SA-2 / SA-6급)의 현실적 물리 파라미터입니다.

파라미터 (단위)
AIM-9M Sidewinder (단거리 IR)
AIM-120C AMRAAM (중거리 ARH)
SA-6 Gainful (지대공 SAM)
발사 중량 (
m
0
​
)
85.3 kg
152.0 kg
599.0 kg
연소 후 중량 (
m
dry
​
)
57.5 kg (추진제 27.8 kg)
104.0 kg (추진제 48.0 kg)
380.0 kg (추진제 219 kg)
길이 / 직경 (
L/d)
2.85 m / 0.127 m
3.66 m / 0.178 m
5.80 m / 0.335 m
기준 단면적 (
S
ref
​
=πd
2
/4)
0.0127 m
2
0.0249 m
2
0.0881 m
2
로켓 연소 시간 (
t
burn
​
)
2.2초 (단일 고추력 펄스)
Boost 2.5초 + Sustain 5.5초
Boost 3.2초 + Sustain 18.0초
평균 추력 (
T
avg
​
)
~26,500 N (비추력
I
sp
​
≈230s)
Boost: 28,000 N / Sustain: 6,500 N
Boost: 85,000 N / Sustain: 22,000 N
최대 속도 (
M
max
​
)
Mach 2.5+
Mach 4.0
Mach 2.8
최대 기동 하중 (
G
max
​
)
35 G ~ 40 G
40 G
20 G ~ 25 G
시커 시야각 (Gimbal Limit)
±40
∘
(9X는
±90
∘
)
±60
∘
(능동 레이더)
지령유도 + 반능동
±45
∘
최대 추적 각속도 (
λ
˙
max
​
)
20
∘
/s∼30
∘
/s
35
∘
/s
15
∘
/s
근접신관 반경 (
R
fuze
​
)
8 m ~ 10 m (레이저)
12 m ~ 15 m (레이더)
20 m ~ 25 m (고폭 파편)
탄두 중량 (
m
warhead
​
)
9.4 kg (환형 파편 WDU-17/B)
18.0 kg (고폭 파편)
59.0 kg (고폭 파편)
2. 미사일 비행 역학 및 추진 모델 (Flight Dynamics)

미사일은 항공기와 달리 날개 면적이 극도로 작고, 로켓 연소 중 질량이 급격히 변하며, 초음속 조파항력(Wave Drag)이 지배적입니다. 기존 6-DOF 루프(240Hz 서브스테핑)
에서 별도의 경량 강체(또는 포인트 매스 + 자세 동역학)로 계산합니다.

① 가변 질량 및 추력 방정식 (Rocket Propulsion)

연소 시간(
t
≤
t
burn
t \le t_{\text{burn}}
t≤t
burn
​
) 동안 추진제가 소모되면서 질량이 선형적으로 줄어들어 종말 가속도가 폭발적으로 증가합니다.

m
(
t
)
=
m
0
−
m
˙
⋅
t
,
m
˙
=
m
0
−
m
dry
t
burn
m(t) = m_0 - \dot{m} \cdot t, \quad \dot{m} = \frac{m_0 - m_{\text{dry}}}{t_{\text{burn}}}
m(t)=m
0
​
−
m
˙
⋅t,
m
˙
=
t
burn
​
m
0
​
−m
dry
​
​

대기압 보정 추력: 고도가 높아질수록 노즐 출구 압력 차이로 추력이 소폭 상승합니다.

T
(
h
)
=
T
SL
+
A
nozzle
⋅
(
P
SL
−
P
(
h
)
)
T(h) = T_{\text{SL}} + A_{\text{nozzle}} \cdot (P_{\text{SL}} - P(h))
T(h)=T
SL
​
+A
nozzle
​
⋅(P
SL
​
−P(h))

연소 종료(
t
>
t
burn
t > t_{\text{burn}}
t>t
burn
​
) 이후 미사일은 순수 활공(Coasting) 상태가 되며, 기동할 때마다 유도항력으로 에너지를 잃고 속도가 급감합니다. (현실적인 회피 기동, 즉 Beam 기동이나 Barrel Roll로 미사일 에너지를 고갈시키는 전술이 여기서 나옵니다.)

② 초음속 항력 곡선 (
C
D
C_D
C
D
​
vs Mach)

미사일은 양력 발생을 위해 받음각(
α
\alpha
α)을 크게 꺾을 때 거대한 유도항력이 발생합니다.

C
D
(
Mach
,
α
)
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
⋅
C
L
2
C_D(\text{Mach}, \alpha) = C_{D0}(\text{Mach}) + K(\text{Mach}) \cdot C_L^2
C
D
​
(Mach,α)=C
D0
​
(Mach)+K(Mach)⋅C
L
2
​

유해항력 계수
C
D
0
(
Mach
)
C_{D0}(\text{Mach})
C
D0
​
(Mach) 근사 테이블:

아음속 (
Mach
<
0.8
\text{Mach} < 0.8
Mach<0.8): 0.28

천음속 항력 발산 (
Mach
=
1.05
∼
1.2
\text{Mach} = 1.05 \sim 1.2
Mach=1.05∼1.2): 0.62 (음속 돌파 구간 급증)

초음속 (
Mach
=
2.0
\text{Mach} = 2.0
Mach=2.0): 0.42

극초음속 (
Mach
=
3.5
+
\text{Mach} = 3.5+
Mach=3.5+): 0.32

양력 및 유도항력:

C
L
=
C
L
α
⋅
α
(
C
L
α
≈
12.0
∼
18.0
 /rad
)
C_L = C_{L\alpha} \cdot \alpha \quad (C_{L\alpha} \approx 12.0 \sim 18.0\text{ /rad})
C
L
​
=C
Lα
​
⋅α(C
Lα
​
≈12.0∼18.0 /rad)
K
(
Mach
)
≈
0.15
+
0.12
⋅
max
⁡
(
0
,
Mach
−
1.0
)
K(\text{Mach}) \approx 0.15 + 0.12 \cdot \max(0, \text{Mach} - 1.0)
K(Mach)≈0.15+0.12⋅max(0,Mach−1.0)
3. 유도 알고리즘: 증강 비례항법 (APN: Augmented Proportional Navigation)

실제 현대 공대공/지대공 미사일은 표적의 현재 위치를 향해 날아가는 순수 추격(Pure Pursuit)이 아니라, 표적과의 시선각 변화율(LOS Rate,
λ
⃗
˙
\dot{\vec{\lambda}}
λ
˙
)을 0으로 만들어 미래 충돌 지점(Intercept Point)을 선점하는 비례항법을 사용합니다.

① 벡터 기반 3D APN 유도 법칙

3D 공간에서 벡터 외적(
×
\times
×)을 사용하면 삼각함수 각도 오차 없이 깔끔하게 가속도 명령을 계산할 수 있습니다.

상대 위치 및 상대 속도 벡터:

R
⃗
=
P
⃗
target
−
P
⃗
missile
,
R
=
∥
R
⃗
∥
\vec{R} = \vec{P}_{\text{target}} - \vec{P}_{\text{missile}}, \quad R = \Vert{}\vec{R}\Vert{}
R
=
P
target
​
−
P
missile
​
,R=∥
R
∥
V
⃗
rel
=
V
⃗
target
−
V
⃗
missile
\vec{V}_{\text{rel}} = \vec{V}_{\text{target}} - \vec{V}_{\text{missile}}
V
rel
​
=
V
target
​
−
V
missile
​

접근 속도 (Closing Velocity,
V
c
V_c
V
c
​
):

V
c
=
−
R
⃗
⋅
V
⃗
rel
R
V_c = -\frac{\vec{R} \cdot \vec{V}_{\text{rel}}}{R}
V
c
​
=−
R
R
⋅
V
rel
​
​

(만약
V
c
<
0
V_c < 0
V
c
​
<0이고 거리
R
R
R이 멀어지기 시작하면 미사일이 표적을 놓친 상태(Missed)입니다.)

시선 회전 각속도 벡터 (LOS Rotation Rate,
Ω
⃗
LOS
\vec{\Omega}_{\text{LOS}}
Ω
LOS
​
):

Ω
⃗
LOS
=
R
⃗
×
V
⃗
rel
R
2
\vec{\Omega}_{\text{LOS}} = \frac{\vec{R} \times \vec{V}_{\text{rel}}}{R^2}
Ω
LOS
​
=
R
2
R
×
V
rel
​
​

최종 3축 가속도 명령 (
a
⃗
cmd
\vec{a}_{\text{cmd}}
a
cmd
​
):

a
⃗
cmd
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
\vec{a}_{\text{cmd}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2} \vec{a}_{\text{target}, \perp}
a
cmd
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
target,⊥
​

N
N
N (유도 상수, Navigation Gain): 보통 3.0 ~ 5.0 (종말 단계에서는 4.0 권장).

u
^
R
=
R
⃗
/
R
\hat{u}_R = \vec{R} / R
u
^
R
​
=
R
/R: 표적을 향하는 단위 시선 벡터.

a
⃗
target
,
⊥
\vec{a}_{\text{target}, \perp}
a
target,⊥
​
: 시선 벡터에 수직인 표적의 현재 기동 가속도 성분 (고G 회피 기동 중인 전투기를 맞추기 위한 APN 보정항).

② 동역학적 한계 및 구속 조건 (실제 미사일다움의 핵심)

계산된 $\vec{a}_{\text{cmd}}$를 미사일 속도에 바로 더하면 "절대 피할 수 없는 유도탄"이 됩니다. 반드시 아래 3가지 물리 제약을 걸어야 합니다.

가용 공력 G 제한 (Available Aerodynamic G): 고도가 높거나 속도가 느려지면 동압(
q
ˉ
=
1
2
ρ
V
2
\bar{q} = \frac{1}{2}\rho V^2
q
ˉ
​
=
2
1
​
ρV
2
)이 떨어져 조종핀(Fin)이 낼 수 있는 최대 G가 줄어듭니다.

G
avail
=
min
⁡
(
G
max
⁡
,
q
ˉ
⋅
S
ref
⋅
C
L
max
⁡
m
⋅
g
0
)
G_{\text{avail}} = \min\left(G_{\max}, \frac{\bar{q} \cdot S_{\text{ref}} \cdot C_{L\max}}{m \cdot g_0}\right)
G
avail
​
=min(G
max
​
,
m⋅g
0
​
q
ˉ
​
⋅S
ref
​
⋅C
Lmax
​
​
)
a
⃗
actual
=
clampMagnitude
(
a
⃗
cmd
,
G
avail
⋅
g
0
)
\vec{a}_{\text{actual}} = \text{clampMagnitude}(\vec{a}_{\text{cmd}}, G_{\text{avail}} \cdot g_0)
a
actual
​
=clampMagnitude(
a
cmd
​
,G
avail
​
⋅g
0
​
)

조종핀 액추에이터 1차 지연 (Autopilot Lag): 가속도 명령이 실제 기체 기동으로 이어지는 데
τ
autopilot
≈
0.15
s
∼
0.25
s
\tau_{\text{autopilot}} \approx 0.15\text{s} \sim 0.25\text{s}
τ
autopilot
​
≈0.15s∼0.25s의 시상수 지연을 둡니다.

자중(중력) 보상 (Gravity Bias): 중력 가속도 $\vec{g} = [0, -9.80665, 0]$을 상쇄하기 위해 유도 명령에 $-\vec{g}_{\perp}$를 더해줘야 저속 활공 중 미사일이 표적 아래로 처지지 않습니다.

4. 시커(Seeker) 및 기만체(Flare / Chaff) 판정 모델

플레이어가 플레어(Flare), 채프(Chaff), 또는 노칭(Notching) 기동으로 미사일을 회피할 수 있도록 시커의 물리적 한계를 구현합니다.

① 시커 시야각(FOV) 및 짐벌 한계(Gimbal Limit)

미사일 기수 벡터 $\hat{f}{\text{missile}}$와 표적 방향
u
^
R
\hat{u}_R
u
^
R
​
사이의 각도 $\theta{\text{off}} = \arccos(\hat{f}_{\text{missile}} \cdot \hat{u}_R)$가 gimbalLimit(예:
40
∘
∼
60
∘
40^\circ \sim 60^\circ
40
∘
∼60
∘
)를 초과하면 시커 락온 상실(Loss of Lock) 처리 후 직진 관성 비행으로 전환합니다.

② 기종별 기만 판정 공식

적외선 미사일 (IR - AIM-9 계열):

신호 세기(IR Signature): 엔진 추력(N1/애프터버너 여부)과 시선각(후방 배기구 직시 시 최대, 정면 진입 시 최소)에 비례.

플레어 기만 확률: 플레어가 시커의 순간 시야각(IFOV, 약
2
∘
∼
4
∘
2^\circ \sim 4^\circ
2
∘
∼4
∘
) 내에 표적과 함께 들어올 때, 플레어의 복사 강도가 항공기 IR 신호보다 크면 시커 중심점이 플레어로 전이(Decoy)됩니다. (애프터버너를 끄고 플레어를 투하하면 기만 확률 급상승)

능동/반능동 레이더 미사일 (Radar - AIM-120 / SAM 계열):

도플러 노칭(Doppler Notching): 레이더 시커는 지면 클러터(Ground Clutter)를 걸러내기 위해 표적의 시선 방향 속도(
V
target
⋅
u
^
R
V_{\text{target}} \cdot \hat{u}_R
V
target
​
⋅
u
^
R
​
)를 필터링합니다. 표적이 미사일 진행 방향에 대해
90
∘
90^\circ
90
∘
수직(Beam)으로 비행하여 시선 속도 성분이
±
30
 kt
\pm 30\text{ kt}
±30 kt 이내로 떨어지고 채프(Chaff)를 뿌리면 락온이 풀립니다.

5. 근접신관(Proximity Fuze) 및 파편 피해 계산

미사일은 표적 메쉬와 직접 충돌(Direct Hit)하지 않더라도, 가장 가까워지는 순간(CPA: Closest Point of Approach)에 반경
R
fuze
R_{\text{fuze}}
R
fuze
​
이내라면 기폭합니다.

① 서브스텝 CPA 보간 (터널링 방지)

마하 3의 미사일(
≈
1
,
000
 m/s
\approx 1,000\text{ m/s}
≈1,000 m/s)과 전투기(
≈
300
 m/s
\approx 300\text{ m/s}
≈300 m/s)가 정면 교차하면 1 물리 틱(
Δ
t
=
1
/
240
s
\Delta t = 1/240\text{s}
Δt=1/240s) 동안에도 약 $5.4\text{m}$를 이동합니다. 틱과 틱 사이의 선분 최단 거리(Segment-to-Segment CPA)를 계산해 기폭 여부를 판정해야 통과 버그(Tunneling)가 발생하지 않습니다.

② Gurney 방정식 기반 탄두 피해(Damage) 모델

기폭 거리
d
d
d에 따른 파편 밀도(역제곱 법칙) 및 폭압 감쇠 공식:

Damage
(
d
)
=
D
base
⋅
(
R
lethal
max
⁡
(
d
,
1.0
)
)
2
⋅
max
⁡
(
0
,
1
−
d
R
fuze
)
\text{Damage}(d) = D_{\text{base}} \cdot \left(\frac{R_{\text{lethal}}}{\max(d, 1.0)}\right)^2 \cdot \max\left(0, 1 - \frac{d}{R_{\text{fuze}}}\right)
Damage(d)=D
base
​
⋅(
max(d,1.0)
R
lethal
​
​
)
2
⋅max(0,1−
R
fuze
​
d
​
)

d
≤
R
lethal
d \le R_{\text{lethal}}
d≤R
lethal
​
(치명 반경, 약
3
m
∼
5
m
3\text{m} \sim 5\text{m}
3m∼5m): 즉각 기체 파괴 또는 치명적 부품(엔진 화재, 유압 상실, 조종면 파손) 손상.

R
lethal
<
d
≤
R
fuze
R_{\text{lethal}} < d \le R_{\text{fuze}}
R
lethal
​
<d≤R
fuze
​
: 거리에 반비례한 파편 피격 → 연료 누출, 레이다 고장, 기체 구조 한계 G 저하(손상된 기체로 비상 착륙 유도).

6. Three.js + Rapier3D 통합 코드 구조 예시 (MissileGuidance.ts)

기존 FlightPhysicsEngine 구조
에 바로 붙일 수 있는 핵심 유도 및 동역학 업데이트 스니펫입니다.

TypeScript
export interface MissileSpec { id: string; massInitial: number; // kg massDry: number; // kg refArea: number; // m^2 burnTime: number; // s boostTime: number; // s boostThrust: number; // N sustainThrust: number; // N maxG: number; // G navGain: number; // APN 상수 N (보통 4.0) gimbalLimitRad: number; // 시커 최대 시야각 fuzeRadius: number; // 근접신관 기폭 반경 (m) lethalRadius: number; // 치명 반경 (m) seekerType: 'IR' | 'RADAR'; } export function stepMissileGuidance( dt: number, missile: MissileState, target: TargetState, spec: MissileSpec ) { missile.flightTime += dt; // 1. 현재 질량 및 추력 계산 const isBurning = missile.flightTime <= spec.burnTime; const burnRatio = Math.min(missile.flightTime / spec.burnTime, 1.0); const currentMass = spec.massInitial - (spec.massInitial - spec.massDry) * burnRatio; let thrust = 0; if (isBurning) { thrust = missile.flightTime <= spec.boostTime ? spec.boostThrust : spec.sustainThrust; } // 2. 상대 벡터 및 시커 시야각 체크 const relPos = target.pos.clone().sub(missile.pos); const dist = relPos.length(); const losDir = relPos.clone().divideScalar(Math.max(dist, 0.001)); // CPA(최단 접근 거리) 기반 근접신관 기폭 판정 if (dist <= spec.fuzeRadius && dist > missile.prevDist) { triggerDetonation(missile, target, missile.prevDist, spec); return; } missile.prevDist = dist; // 시커 짐벌 한계 초과 시 락온 해제 const offBoresight = Math.acos(THREE.MathUtils.clamp(missile.forward.dot(losDir), -1, 1)); if (offBoresight > spec.gimbalLimitRad) { missile.locked = false; } // 3. 증강 비례항법 (APN) 유도 가속도 산출 const accelCmd = new THREE.Vector3(0, 0, 0); if (missile.locked) { const relVel = target.vel.clone().sub(missile.vel); const closingVel = -losDir.dot(relVel); if (closingVel > 0) { // Omega_LOS = (R x V_rel) / R^2 const omegaLOS = new THREE.Vector3().crossVectors(relPos, relVel).divideScalar(dist * dist); // a_pn = N * Vc * (Omega_LOS x u_R) const pnAccel = new THREE.Vector3().crossVectors(omegaLOS, losDir).multiplyScalar(spec.navGain * closingVel); // 표적 기동 가속도 수직 성분 보정 (APN) const targetAccelPerp = target.accel.clone().sub(losDir.clone().multiplyScalar(target.accel.dot(losDir))); accelCmd.add(pnAccel).addScaledVector(targetAccelPerp, spec.navGain * 0.5); } } // 4. 동압 기반 최대 가용 G 제한 및 1차 지연 필터 const speed = missile.vel.length(); const rho = getAirDensity(missile.pos.y); const qBar = 0.5 * rho * speed * speed; const aeroMaxG = (qBar * spec.refArea * 4.5) / (currentMass * 9.80665); // CL_max ~ 4.5 const effectiveMaxAccel = Math.min(spec.maxG, aeroMaxG) * 9.80665; if (accelCmd.length() > effectiveMaxAccel) { accelCmd.normalize().multiplyScalar(effectiveMaxAccel); } // 액추에이터 응답 지연 (tau = 0.18s) const lagAlpha = dt / (0.18 + dt); missile.actualAccel.lerp(accelCmd, lagAlpha); // 5. 항력(초음속 파동항력 + 기동 유도항력) 및 힘 합산 const mach = speed / getSpeedOfSound(missile.pos.y); const cd0 = getMissileCD0(mach); const loadFactor = missile.actualAccel.length() / 9.80665; const cdInduced = 0.004 * loadFactor * loadFactor; // 기동 시 에너지 손실 const dragMag = qBar * spec.refArea * (cd0 + cdInduced); const totalForce = new THREE.Vector3() .addScaledVector(missile.forward, thrust - dragMag) .addScaledVector(missile.actualAccel, currentMass) .add(new THREE.Vector3(0, -9.80665 * currentMass, 0)); // 속도 및 자세 적분 missile.vel.addScaledVector(totalForce, dt / currentMass); missile.pos.addScaledVector(missile.vel, dt); if (missile.vel.lengthSq() > 1.0) { missile.forward.copy(missile.vel).normalize(); } }
구현 우선순위 추천

1단계 (발사 및 APN 탄도): MissileSpec 데이터 정의
및 stepMissileGuidance 물리 루프(240Hz 서브스테핑 공유)
연동, 로켓 연소 화염/연기 트레일 파티클 연결.

2단계 (RWR 및 방어 수단): F-16 콕핏 내 RWR(레이더 경보 수신기) 심볼 및 발사 경보음(Launch Warning Tone) 추가
, 플레어/채프 투하 및 도플러 노칭 기만 로직 연동.

3단계 (피해 모델 & 텔레메트리): 근접신관 기폭 시 단발 엔진 정지(
V
MCA
V_{\text{MCA}}
V
MCA
​
비대칭 추력 연동
) 또는 유압 저하 등 기존 6-DOF 고장 물리
와 결합.

혹시 issue #713에서 목표로 하시는 미사일 전투 시나리오(예: F-16 공대공 교전 vs 지대공 SAM 회피 미션, 또는 봇 아레나용 미사일 회피 AI)의 구체적인 방향이 있다면 말씀해 주세요. 그에 맞춰 RWR 계기판 UI 규격이나 기만체(Flare/Chaff) 물리 코드까지 이어서 작성해 드리겠습니다.

You said 모든 시나리오 고려

모든 시나리오 고려

flight3d 프로젝트의 전체 시나리오(공대공 BVR/WVR, 지대공 SAM 회피, 저고도 계곡 침투/SEAD, 봇 아레나 평가 및 디브리프/G-LOC 연동)를 모두 포괄하여, 기존 아키텍처(Three.js + Rapier3D 240Hz 서브스테핑, Scratch Vector GC 최적화, v8 가상 틱 결정론, 디브리프 및 파일럿 생체 모델)에 그대로 통합할 수 있는 완전판 미사일 물리·유도·방어·평가 마스터 스펙입니다.

1. 시나리오별 미사일 전체 아키텍처 매트릭스

보유 기종(F-16, B737-800, C172)과 맵 환경(Incheon RKSI, Lukla VNLK, Hangang, Mountain Valley, Neon Metropolis)을 모두 수용할 수 있도록 미사일을 4가지 카테고리로 분류합니다.

카테고리
대표 기종 (id)
적용 시나리오
유도 방식 (Guidance)
시커 특성 (Seeker)
단거리 공대공 (SRM)
aim-9m / aim-9x
F-16 근접전(WVR), 꼬리 물기 추격
APN (
N=4.0)
냉각식 적외선(IR) / IIR (전방위 락온, 후방 추력 비례)
중거리 공대공 (MRM)
aim-120c
F-16 BVR 교전, 고고도 요격
관성+데이터링크(Mid-course)
→ 종말 APN (
N=4.5)
능동 레이더(ARH), 도플러 속도 게이트
중거리 지대공 (SAM)
sa-6 / sa-11
산악 계곡(Valley) 침투, SEAD, 회피 챌린지
지령유도(CLOS) 또는 반능동 레이더(SARH)
지상 사격통제 레이더(FCR) 조준 유지 필수
휴대용 대공 (MANPADS)
igla-s / stinger
저고도 한강/도심/민항기 비상 회피
비례항법 (
N=3.5)
2색 적외선(IR/UV), 단거리 급기동(
18G)
2. 정밀 추진·공력·유도·기만 물리 공식
① 다단 추력(Boost-Sustain) 및 가변 질량 모델

단일 추력이 아닌 부스트(고추력 가속)
→
\to
→ 서스테인(순항 유지)
→
\to
→ 활공(Coasting) 3단 페이즈를 적용해야 사거리와 회피 타이밍이 현실과 일치합니다.

T
(
t
,
h
)
=
{
T
boost
+
A
e
(
P
0
−
P
(
h
)
)
(
0
≤
t
≤
t
boost
)
T
sustain
+
A
e
(
P
0
−
P
(
h
)
)
(
t
boost
<
t
≤
t
burn
)
0
(
t
>
t
burn
)
T(t, h) = \begin{cases} T_{\text{boost}} + A_e (P_0 - P(h)) & (0 \le t \le t_{\text{boost}}) \\ T_{\text{sustain}} + A_e (P_0 - P(h)) & (t_{\text{boost}} < t \le t_{\text{burn}}) \\ 0 & (t > t_{\text{burn}}) \end{cases}
T(t,h)=
⎩
⎨
⎧
​
T
boost
​
+A
e
​
(P
0
​
−P(h))
T
sustain
​
+A
e
​
(P
0
​
−P(h))
0
​
(0≤t≤t
boost
​
)
(t
boost
​
<t≤t
burn
​
)
(t>t
burn
​
)
​
m
(
t
)
=
m
0
−
∫
0
t
T
(
τ
,
0
)
I
s
p
⋅
g
0
 
d
τ
(
단, 
m
(
t
)
≥
m
dry
)
m(t) = m_0 - \int_0^t \frac{T(\tau, 0)}{I_{sp} \cdot g_0} \, d\tau \quad (\text{단, } m(t) \ge m_{\text{dry}})
m(t)=m
0
​
−∫
0
t
​
I
sp
​
⋅g
0
​
T(τ,0)
​
dτ(단, m(t)≥m
dry
​
)

고도별 대기의 영향: 고도 10,000m(
ρ
≈
0.41
 kg/m
3
\rho \approx 0.41\text{ kg/m}^3
ρ≈0.41 kg/m
3
)에서는 해수면(
ρ
0
=
1.225
 kg/m
3
\rho_0 = 1.225\text{ kg/m}^3
ρ
0
​
=1.225 kg/m
3
) 대비 항력이 1/3로 줄어 AIM-120C의 유효 사거리가 3배 이상 늘어나지만, 반대로 조종핀 공력 한계(
G
avail
∝
q
ˉ
G_{\text{avail}} \propto \bar{q}
G
avail
​
∝
q
ˉ
​
)도 1/3로 줄어 선회 반경이 커집니다.

② 3D 증강 비례항법 (APN) + 고도 로프팅(Lofting)

중거리 미사일(AIM-120, SAM)은 발사 직후 공기 밀도가 낮은 고고도로 상승했다가 내리꽂는 로프팅(Loft) 궤적을 그려 에너지를 보존합니다.

초기/중기 유도 (Mid-course Loft, 거리
R
>
12
 km
R > 12\text{ km}
R>12 km):

a
⃗
loft
=
a
⃗
APN
+
u
⃗
up
⋅
g
0
⋅
clamp
(
R
−
12000
15000
,
0
,
1.5
)
\vec{a}_{\text{loft}} = \vec{a}_{\text{APN}} + \vec{u}_{\text{up}} \cdot g_0 \cdot \text{clamp}\left(\frac{R - 12000}{15000}, 0, 1.5\right)
a
loft
​
=
a
APN
​
+
u
up
​
⋅g
0
​
⋅clamp(
15000
R−12000
​
,0,1.5)

종말 증강 비례항법 (Terminal APN, 거리
R
≤
12
 km
R \le 12\text{ km}
R≤12 km):

R
⃗
=
P
⃗
t
−
P
⃗
m
,
V
⃗
rel
=
V
⃗
t
−
V
⃗
m
,
V
c
=
−
R
⃗
⋅
V
⃗
rel
∥
R
⃗
∥
\vec{R} = \vec{P}_t - \vec{P}_m, \quad \vec{V}_{\text{rel}} = \vec{V}_t - \vec{V}_m, \quad V_c = -\frac{\vec{R} \cdot \vec{V}_{\text{rel}}}{\Vert{}\vec{R}\Vert{}}
R
=
P
t
​
−
P
m
​
,
V
rel
​
=
V
t
​
−
V
m
​
,V
c
​
=−
∥
R
∥
R
⋅
V
rel
​
​
Ω
⃗
LOS
=
R
⃗
×
V
⃗
rel
∥
R
⃗
∥
2
,
a
⃗
cmd
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
t
,
⊥
−
g
⃗
⊥
\vec{\Omega}_{\text{LOS}} = \frac{\vec{R} \times \vec{V}_{\text{rel}}}{\Vert{}\vec{R}\Vert{}^2}, \quad \vec{a}_{\text{cmd}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2} \vec{a}_{t, \perp} - \vec{g}_{\perp}
Ω
LOS
​
=
∥
R
∥
2
R
×
V
rel
​
​
,
a
cmd
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
t,⊥
​
−
g
​
⊥
​

공력 유도항력 페널티 (에너지 고갈 핵심): 미사일이 $30\text{G}$로 선회할 때 거대한 유도항력이 발생해 속도가 급감합니다.

C
L
=
m
⋅
∥
a
⃗
actual
∥
q
ˉ
⋅
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
⋅
C
L
2
C_L = \frac{m \cdot \Vert{}\vec{a}_{\text{actual}}\Vert{}}{\bar{q} \cdot S_{\text{ref}}}, \quad C_D = C_{D0}(\text{Mach}) + K(\text{Mach}) \cdot C_L^2
C
L
​
=
q
ˉ
​
⋅S
ref
​
m⋅∥
a
actual
​
∥
​
,C
D
​
=C
D0
​
(Mach)+K(Mach)⋅C
L
2
​
③ 시커 물리 및 모든 방어 기동(Countermeasures & Terrain Masking) 판정

플레이어가 취할 수 있는 4가지 현실적 회피 전술을 모두 물리 판정으로 구현합니다.

지형 차폐 (Terrain Masking — 산악 계곡/도심 시나리오 핵심):

매 물리 틱(또는 30Hz 레이캐스트)마다 발사기(SAM 레이더) 또는 미사일 시커 위치에서 표적까지 Rapier world.castRay를 쏩니다.

산봉우리(Valley/Lukla)나 고층 빌딩(Neon Metropolis/한강)에 레이가 가로막히면 LOS 차단(Occluded) 처리합니다.

차단 지속 시간이 memoryTime(약 2.5s)을 초과하면 시커는 마지막 예측 위치(Extrapolation)로 직진하다가 락온을 완전히 상실(Trash)합니다.

도플러 노칭 (Doppler Notching — 레이더 미사일 핵심):

표적의 시선 방향 접근 속도(Closure Rate)의 절대값 \vert{}V_{\text{target}} \cdot \hat{u}_R\vert{}$가 **노치 필터 대역($< 25\text{ m/s}, 약
48
 kt
48\text{ kt}
48 kt) 이내이고, 배경에 지면 클러터(고도 각도
θ
lookdown
<
0
∘
\theta_{\text{lookdown}} < 0^\circ
θ
lookdown
​
<0
∘
)가 존재할 때 레이더 락온 확률이 급감합니다. 이때 채프(Chaff)를 투하하면 기만 성공률이
85
%
85\%
85% 이상으로 상승합니다.

적외선 플레어 기만 (IR Flare Decoy — 열추적 미사일 핵심):

표적의 IR 복사 강도(
I
aircraft
I_{\text{aircraft}}
I
aircraft
​
) 공식:

I
aircraft
=
I
base
⋅
(
0.2
+
0.8
⋅
Throttle
2.5
+
2.5
⋅
I
Afterburner
)
⋅
(
0.35
+
0.65
⋅
1
−
f
^
target
⋅
u
^
R
2
)
I_{\text{aircraft}} = I_{\text{base}} \cdot \left(0.2 + 0.8 \cdot \text{Throttle}^{2.5} + 2.5 \cdot \mathbb{I}_{\text{Afterburner}}\right) \cdot \left(0.35 + 0.65 \cdot \frac{1 - \hat{f}_{\text{target}} \cdot \hat{u}_R}{2}\right)
I
aircraft
​
=I
base
​
⋅(0.2+0.8⋅Throttle
2.5
+2.5⋅I
Afterburner
​
)⋅(0.35+0.65⋅
2
1−
f
^
​
target
​
⋅
u
^
R
​
​
)

(애프터버너 점화 시 신호 3.5배 폭증, 정면에서 볼 때보다 후방 배기구에서 볼 때 신호 3배 강함)

시커 시야각(IFOV
3
∘
3^\circ
3
∘
) 내 플레어 총 복사량 $\sum I_{\text{flare}}$가 $I_{\text{aircraft}}$를 초과하면 추적 중심점이 플레어로 이동합니다.

기동 에너지 고갈 (Kinematics Defeat / Cranking & S-Turn):

연소 종료 후 활공 중인 미사일에 대해 좌우 급선회(S-Turn)를 강요하면, 미사일이 비례항법(
N
⋅
V
c
⋅
Ω
LOS
N \cdot V_c \cdot \Omega_{\text{LOS}}
N⋅V
c
​
⋅Ω
LOS
​
)으로 과도한 선행각을 잡느라 유도항력으로 속도가 Mach 0.8 이하로 떨어져 공력 G 한계(
G
avail
G_{\text{avail}}
G
avail
​
)가 붕괴합니다.

3. 기존 Flight3D 시스템(G-LOC, 디브리프, 봇 아레나) 통합 규격

기존에 설계하신 파일럿 생체 모델
, G-Force 필터링
, 디브리프
, 그리고 v8 봇 아레나 규격
과 충돌 없이 맞물리도록 연결 포인트를 정의합니다.
autonomous_pilot_project-v8.md

① 파일럿 G-LOC 및 반응성 저하와의 시너지

미사일 회피를 위해 F-16으로
8
G
∼
9
G
8\text{G} \sim 9\text{G}
8G∼9G 급선회(Break Turn)를 구사하면 pilotPhysiology의 의식 수준(consciousness)이 급감하며 터널 비전과 조종 지연이 발생합니다
.

반면 민항기(B737)나 경비행기(C172)로 SAM 회피 시나리오를 플레이할 경우, 구조 한계(
+
2.5
G
+2.5\text{G}
+2.5G /
+
3.8
G
+3.8\text{G}
+3.8G)
를 넘기면 날개 파손(Structural Failure)이 발생하므로 고G 기동 대신 지형 차폐(Terrain Masking)와 플레어/채프 타이밍으로 생존해야 하는 명확한 게임플레이 차별화가 생깁니다.

② 서브스텝 선분 최단 거리(Segment CPA) 근접신관 & 부위별 피해

240
Hz
240\text{Hz}
240Hz 서브스텝
에서 미사일 이동 선분(
P
m
,
t
−
1
→
P
m
,
t
P_{m, t-1} \to P_{m, t}
P
m,t−1
​
→P
m,t
​
)과 항공기 이동 선분(
P
a
,
t
−
1
→
P
a
,
t
P_{a, t-1} \to P_{a, t}
P
a,t−1
​
→P
a,t
​
) 사이의 최단 거리 $d_{\text{CPA}}$를 계산합니다.

$d_{\text{CPA}} \le R_{\text{fuze}}$일 때 기폭하며, 거리 $d_{\text{CPA}}$에 따라 단순 즉사가 아닌 시스템 고장 모델을 트리거합니다:

d
CPA
≤
R
lethal
d_{\text{CPA}} \le R_{\text{lethal}}
d
CPA
​
≤R
lethal
​
(
3
m
∼
5
m
3\text{m}\sim 5\text{m}
3m∼5m): 기체 공중 분해(Destroyed)
→
\to
→ 디브리프 Crash Forensics에 원인 MISSILE_IMPACT 및 명중 미사일 기종 기록
.

R
lethal
<
d
CPA
≤
R
fuze
R_{\text{lethal}} < d_{\text{CPA}} \le R_{\text{fuze}}
R
lethal
​
<d
CPA
​
≤R
fuze
​
(
5
m
∼
15
m
5\text{m}\sim 15\text{m}
5m∼15m): 파편 피격(Shrapnel Damage)
→
\to
→ 단발 엔진 화재/정지(비대칭 추력 발생)
, 연료 누출, 조종면 효율 40% 저하 상태에서 비상 착륙 미션으로 전환.

③ v8 자율주행 봇 아레나 (obs.threats) 인터페이스 확장

봇 아레나에 미사일 회피(Evasion) 미션을 추가할 때 onTick(obs)에 전달할 RWR(레이더 경보 수신기) 및 MAWS(미사일 접근 경보) 스냅샷 규격입니다. (반드시 Object.freeze 적용 및 미사일의 정확한 미래 궤적은 은닉
)
autonomous_pilot_project-v8.md

TypeScript
export interface ThreatWarningObs { id: string; type: 'SAM_SEARCH' | 'SAM_LOCK' | 'MISSILE_RADAR' | 'MISSILE_IR'; bearingDeg: number; // 기수 기준 상대 방위각 (-180 ~ +180, 센서 노이즈 포함) elevationDeg: number; // 상대 고각 signalStrength: number; // 0.0 ~ 1.0 (거리 및 출력 추정치, 정확한 m 거리는 비공개) isLaunchWarning: boolean; // 미사일 발사/추적 경보 여부 timeSinceDetectionSec: number; }
4. AI 코딩 에이전트 전달용 마스터 구현 프롬프트 (issue #713)

아래 내용을 복사하여 코딩 에이전트(Claude Code / Cursor 등)에 전달하면 기존 FlightPhysicsEngine과 DebriefOverlay 구조를 유지하면서 전체 미사일 시스템을 구현할 수 있습니다.

Markdown
# [Feature #713] 현실적 6-DOF 미사일(공대공/지대공) 물리, 유도, 기만 및 방어 시스템 구현 ## 1. 목표 Three.js + Rapier3D 기반 240Hz 서브스테핑 물리 엔진에 현실적인 공대공(AIM-9M, AIM-120C) 및 지대공(SA-6, MANPADS) 유도탄 시스템을 추가합니다. 모든 연산은 GC 스파이크 방지를 위해 Scratch Vector 패턴을 준수하고, 가상 물리 틱(Virtual Tick) 결정론을 유지해야 합니다. ## 2. 핵심 구현 모듈 명세 ### A. 데이터 스키마 (`src/schema/MissileDefinition.ts` & `public/content/missiles/*.json`) - 하드코딩 없이 JSON으로 기종별 스펙을 로드하도록 구현: - `massInitial`, `massDry`, `refArea`, `boostTime`, `burnTime`, `boostThrust`, `sustainThrust`, `isp` - `cd0MachTable` (아음속 0.28 -> 천음속 0.62 -> 초음속 0.35), `inducedDragK` - `maxG`, `navGain` (APN 상수 3.5~4.5), `autopilotTau` (0.18s), `gimbalLimitDeg`, `maxLosRateDegPerSec` - `seekerType` ('IR' | 'RADAR' | 'SARH'), `fuzeRadius`, `lethalRadius`, `loftEnabled` ### B. 240Hz 서브스텝 미사일 동역학 및 APN 유도 (`src/physics/MissileEngine.ts`) 1. **추진 및 가변 질량**: 부스트/서스테인 단계별 추력 및 연료 소모에 따른 질량 감소. 연소 종료 후 순수 활공(Coasting) 전환. 2. **고도 로프팅(Lofting) & 3D APN**: - 중거리(12km 초과) 로프팅 편향 가속도 적용. - 종말 구간 벡터 외적 기반 3D 증강 비례항법: `a_cmd = N * Vc * (Omega_LOS x u_R) + (N/2) * a_target_perp - g_perp`. 3. **공력 한계 및 에너지 손실**: - 동압(`qBar`) 기반 가용 최대 G(`aeroMaxG`) 클램핑 및 1차 지연 필터(`tau = 0.18s`). - 기동 하중(`loadFactor^2`)에 비례하는 유도항력 적용으로 급선회 시 미사일 속도 고갈 구현. ### C. 시커(Seeker) 및 방어/기만 판정 (`src/physics/SeekerAndCountermeasures.ts`) 1. **지형 차폐(Terrain Masking)**: Rapier `world.castRay`로 시커와 표적 사이 지형/건물 충돌 검사. `2.5초` 이상 차폐 시 락온 상실. 2. **도플러 노칭(Notching) & 채프**: 레이더 미사일 시선 방향 접근 속도(`|V_target · u_R|`)가 `25 m/s` 이하일 때 락온 저하 및 채프(Chaff) 투하 시 기만 확률 급상승. 3. **IR 신호 및 플레어**: 표적 스로틀, 애프터버너 여부, 후방 배기구 시선각에 따라 IR 강도 계산. IFOV 내 플레어 복사량이 표적을 초과하면 Decoy 전환. ### D. 근접신관(Segment CPA) 및 기체 피해 연동 - 1 물리 틱 내 미사일 이동 선분과 표적 이동 선분의 최단 거리(`segmentToSegmentCPA`)로 터널링 방지. - `d <= lethalRadius`: 기체 파괴 및 Debrief `Crash Forensics`에 `MISSILE_HIT` 기록.
- `lethalRadius < d <= fuzeRadius`: 파편 피해 (단발 엔진 정지, 유압/조종면 손상, 연료 누출 등 기존 고장 물리와 연동). ### E. UI / HUD / 텔레메트리 연동
- 콕핏 RWR(레이더 경보 수신기) 위젯 및 미사일 발사 경보음(WebAudio) 추가. - 플레어/채프 투하 키바인딩 및 잔탄 HUD 표시. - 봇 아레나 `onTick(obs)`에 노이즈가 포함된 `obs.threats` 배열 노출 (`Object.freeze` 적용).
autonomous_pilot_project-v8.md

다음 단계로 ① 콕핏 RWR(레이더 경보 수신기) 캔버스 UI 및 경보음 구현 코드, 또는 ② SAM 포대 AI 및 미사일 회피 봇 베이스라인 코드 중 어떤 부분을 먼저 구체화할까요?

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
export interface MissileSpec {
  id: string;
  massInitial: number;       // kg
  massDry: number;           // kg
  refArea: number;           // m^2
  burnTime: number;          // s
  boostTime: number;         // s
  boostThrust: number;       // N
  sustainThrust: number;     // N
  maxG: number;              // G
  navGain: number;           // APN 상수 N (보통 4.0)
  gimbalLimitRad: number;    // 시커 최대 시야각
  fuzeRadius: number;        // 근접신관 기폭 반경 (m)
  lethalRadius: number;      // 치명 반경 (m)
  seekerType: 'IR' | 'RADAR';
}

export function stepMissileGuidance(
  dt: number,
  missile: MissileState,
  target: TargetState,
  spec: MissileSpec
) {
  missile.flightTime += dt;

  // 1. 현재 질량 및 추력 계산
  const isBurning = missile.flightTime <= spec.burnTime;
  const burnRatio = Math.min(missile.flightTime / spec.burnTime, 1.0);
  const currentMass = spec.massInitial - (spec.massInitial - spec.massDry) * burnRatio;

  let thrust = 0;
  if (isBurning) {
    thrust = missile.flightTime <= spec.boostTime ? spec.boostThrust : spec.sustainThrust;
  }

  // 2. 상대 벡터 및 시커 시야각 체크
  const relPos = target.pos.clone().sub(missile.pos);
  const dist = relPos.length();
  const losDir = relPos.clone().divideScalar(Math.max(dist, 0.001));

  // CPA(최단 접근 거리) 기반 근접신관 기폭 판정
  if (dist <= spec.fuzeRadius && dist > missile.prevDist) {
    triggerDetonation(missile, target, missile.prevDist, spec);
    return;
  }
  missile.prevDist = dist;

  // 시커 짐벌 한계 초과 시 락온 해제
  const offBoresight = Math.acos(THREE.MathUtils.clamp(missile.forward.dot(losDir), -1, 1));
  if (offBoresight > spec.gimbalLimitRad) {
    missile.locked = false;
  }

  // 3. 증강 비례항법 (APN) 유도 가속도 산출
  const accelCmd = new THREE.Vector3(0, 0, 0);
  if (missile.locked) {
    const relVel = target.vel.clone().sub(missile.vel);
    const closingVel = -losDir.dot(relVel);

    if (closingVel > 0) {
      // Omega_LOS = (R x V_rel) / R^2
      const omegaLOS = new THREE.Vector3().crossVectors(relPos, relVel).divideScalar(dist * dist);
      // a_pn = N * Vc * (Omega_LOS x u_R)
      const pnAccel = new THREE.Vector3().crossVectors(omegaLOS, losDir).multiplyScalar(spec.navGain * closingVel);

      // 표적 기동 가속도 수직 성분 보정 (APN)
      const targetAccelPerp = target.accel.clone().sub(losDir.clone().multiplyScalar(target.accel.dot(losDir)));
      accelCmd.add(pnAccel).addScaledVector(targetAccelPerp, spec.navGain * 0.5);
    }
  }

  // 4. 동압 기반 최대 가용 G 제한 및 1차 지연 필터
  const speed = missile.vel.length();
  const rho = getAirDensity(missile.pos.y);
  const qBar = 0.5 * rho * speed * speed;
  const aeroMaxG = (qBar * spec.refArea * 4.5) / (currentMass * 9.80665); // CL_max ~ 4.5
  const effectiveMaxAccel = Math.min(spec.maxG, aeroMaxG) * 9.80665;

  if (accelCmd.length() > effectiveMaxAccel) {
    accelCmd.normalize().multiplyScalar(effectiveMaxAccel);
  }

  // 액추에이터 응답 지연 (tau = 0.18s)
  const lagAlpha = dt / (0.18 + dt);
  missile.actualAccel.lerp(accelCmd, lagAlpha);

  // 5. 항력(초음속 파동항력 + 기동 유도항력) 및 힘 합산
  const mach = speed / getSpeedOfSound(missile.pos.y);
  const cd0 = getMissileCD0(mach);
  const loadFactor = missile.actualAccel.length() / 9.80665;
  const cdInduced = 0.004 * loadFactor * loadFactor; // 기동 시 에너지 손실
  const dragMag = qBar * spec.refArea * (cd0 + cdInduced);

  const totalForce = new THREE.Vector3()
    .addScaledVector(missile.forward, thrust - dragMag)
    .addScaledVector(missile.actualAccel, currentMass)
    .add(new THREE.Vector3(0, -9.80665 * currentMass, 0));

  // 속도 및 자세 적분
  missile.vel.addScaledVector(totalForce, dt / currentMass);
  missile.pos.addScaledVector(missile.vel, dt);
  if (missile.vel.lengthSq() > 1.0) {
    missile.forward.copy(missile.vel).normalize();
  }
}

```

### Block 2

```text
export interface ThreatWarningObs {
  id: string;
  type: 'SAM_SEARCH' | 'SAM_LOCK' | 'MISSILE_RADAR' | 'MISSILE_IR';
  bearingDeg: number;       // 기수 기준 상대 방위각 (-180 ~ +180, 센서 노이즈 포함)
  elevationDeg: number;     // 상대 고각
  signalStrength: number;   // 0.0 ~ 1.0 (거리 및 출력 추정치, 정확한 m 거리는 비공개)
  isLaunchWarning: boolean; // 미사일 발사/추적 경보 여부
  timeSinceDetectionSec: number;
}

```

### Block 3

```text
# [Feature #713] 현실적 6-DOF 미사일(공대공/지대공) 물리, 유도, 기만 및 방어 시스템 구현

## 1. 목표
Three.js + Rapier3D 기반 240Hz 서브스테핑 물리 엔진에 현실적인 공대공(AIM-9M, AIM-120C) 및 지대공(SA-6, MANPADS) 유도탄 시스템을 추가합니다. 모든 연산은 GC 스파이크 방지를 위해 Scratch Vector 패턴을 준수하고, 가상 물리 틱(Virtual Tick) 결정론을 유지해야 합니다.

## 2. 핵심 구현 모듈 명세

### A. 데이터 스키마 (`src/schema/MissileDefinition.ts` & `public/content/missiles/*.json`)
- 하드코딩 없이 JSON으로 기종별 스펙을 로드하도록 구현:
  - `massInitial`, `massDry`, `refArea`, `boostTime`, `burnTime`, `boostThrust`, `sustainThrust`, `isp`
  - `cd0MachTable` (아음속 0.28 -> 천음속 0.62 -> 초음속 0.35), `inducedDragK`
  - `maxG`, `navGain` (APN 상수 3.5~4.5), `autopilotTau` (0.18s), `gimbalLimitDeg`, `maxLosRateDegPerSec`
  - `seekerType` ('IR' | 'RADAR' | 'SARH'), `fuzeRadius`, `lethalRadius`, `loftEnabled`

### B. 240Hz 서브스텝 미사일 동역학 및 APN 유도 (`src/physics/MissileEngine.ts`)
1. **추진 및 가변 질량**: 부스트/서스테인 단계별 추력 및 연료 소모에 따른 질량 감소. 연소 종료 후 순수 활공(Coasting) 전환.
2. **고도 로프팅(Lofting) & 3D APN**:
   - 중거리(12km 초과) 로프팅 편향 가속도 적용.
   - 종말 구간 벡터 외적 기반 3D 증강 비례항법: `a_cmd = N * Vc * (Omega_LOS x u_R) + (N/2) * a_target_perp - g_perp`.
3. **공력 한계 및 에너지 손실**:
   - 동압(`qBar`) 기반 가용 최대 G(`aeroMaxG`) 클램핑 및 1차 지연 필터(`tau = 0.18s`).
   - 기동 하중(`loadFactor^2`)에 비례하는 유도항력 적용으로 급선회 시 미사일 속도 고갈 구현.

### C. 시커(Seeker) 및 방어/기만 판정 (`src/physics/SeekerAndCountermeasures.ts`)
1. **지형 차폐(Terrain Masking)**: Rapier `world.castRay`로 시커와 표적 사이 지형/건물 충돌 검사. `2.5초` 이상 차폐 시 락온 상실.
2. **도플러 노칭(Notching) & 채프**: 레이더 미사일 시선 방향 접근 속도(`|V_target · u_R|`)가 `25 m/s` 이하일 때 락온 저하 및 채프(Chaff) 투하 시 기만 확률 급상승.
3. **IR 신호 및 플레어**: 표적 스로틀, 애프터버너 여부, 후방 배기구 시선각에 따라 IR 강도 계산. IFOV 내 플레어 복사량이 표적을 초과하면 Decoy 전환.

### D. 근접신관(Segment CPA) 및 기체 피해 연동
- 1 물리 틱 내 미사일 이동 선분과 표적 이동 선분의 최단 거리(`segmentToSegmentCPA`)로 터널링 방지.
- `d <= lethalRadius`: 기체 파괴 및 Debrief `Crash Forensics`에 `MISSILE_HIT` 기록.
- `lethalRadius < d <= fuzeRadius`: 파편 피해 (단발 엔진 정지, 유압/조종면 손상, 연료 누출 등 기존 고장 물리와 연동).

### E. UI / HUD / 텔레메트리 연동
- 콕핏 RWR(레이더 경보 수신기) 위젯 및 미사일 발사 경보음(WebAudio) 추가.
- 플레어/채프 투하 키바인딩 및 잔탄 HUD 표시.
- 봇 아레나 `onTick(obs)`에 노이즈가 포함된 `obs.threats` 배열 노출 (`Object.freeze` 적용).

```

## TeX annotations in document order

### Equation 1

```tex
t \le t_{\text{burn}}
```

### Equation 2

```tex
m(t) = m_0 - \dot{m} \cdot t, \quad \dot{m} = \frac{m_0 - m_{\text{dry}}}{t_{\text{burn}}}
```

### Equation 3

```tex
T(h) = T_{\text{SL}} + A_{\text{nozzle}} \cdot (P_{\text{SL}} - P(h))
```

### Equation 4

```tex
t > t_{\text{burn}}
```

### Equation 5

```tex
C_D
```

### Equation 6

```tex
\alpha
```

### Equation 7

```tex
C_D(\text{Mach}, \alpha) = C_{D0}(\text{Mach}) + K(\text{Mach}) \cdot C_L^2
```

### Equation 8

```tex
C_{D0}(\text{Mach})
```

### Equation 9

```tex
\text{Mach} < 0.8
```

### Equation 10

```tex
\text{Mach} = 1.05 \sim 1.2
```

### Equation 11

```tex
\text{Mach} = 2.0
```

### Equation 12

```tex
\text{Mach} = 3.5+
```

### Equation 13

```tex
C_L = C_{L\alpha} \cdot \alpha \quad (C_{L\alpha} \approx 12.0 \sim 18.0\text{ /rad})
```

### Equation 14

```tex
K(\text{Mach}) \approx 0.15 + 0.12 \cdot \max(0, \text{Mach} - 1.0)
```

### Equation 15

```tex
\dot{\vec{\lambda}}
```

### Equation 16

```tex
\times
```

### Equation 17

```tex
\vec{R} = \vec{P}_{\text{target}} - \vec{P}_{\text{missile}}, \quad R = \Vert{}\vec{R}\Vert{}
```

### Equation 18

```tex
\vec{V}_{\text{rel}} = \vec{V}_{\text{target}} - \vec{V}_{\text{missile}}
```

### Equation 19

```tex
V_c
```

### Equation 20

```tex
V_c = -\frac{\vec{R} \cdot \vec{V}_{\text{rel}}}{R}
```

### Equation 21

```tex
V_c < 0
```

### Equation 22

```tex
R
```

### Equation 23

```tex
\vec{\Omega}_{\text{LOS}}
```

### Equation 24

```tex
\vec{\Omega}_{\text{LOS}} = \frac{\vec{R} \times \vec{V}_{\text{rel}}}{R^2}
```

### Equation 25

```tex
\vec{a}_{\text{cmd}}
```

### Equation 26

```tex
\vec{a}_{\text{cmd}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2} \vec{a}_{\text{target}, \perp}
```

### Equation 27

```tex
N
```

### Equation 28

```tex
\hat{u}_R = \vec{R} / R
```

### Equation 29

```tex
\vec{a}_{\text{target}, \perp}
```

### Equation 30

```tex
\bar{q} = \frac{1}{2}\rho V^2
```

### Equation 31

```tex
G_{\text{avail}} = \min\left(G_{\max}, \frac{\bar{q} \cdot S_{\text{ref}} \cdot C_{L\max}}{m \cdot g_0}\right)
```

### Equation 32

```tex
\vec{a}_{\text{actual}} = \text{clampMagnitude}(\vec{a}_{\text{cmd}}, G_{\text{avail}} \cdot g_0)
```

### Equation 33

```tex
\tau_{\text{autopilot}} \approx 0.15\text{s} \sim 0.25\text{s}
```

### Equation 34

```tex
\hat{u}_R
```

### Equation 35

```tex
40^\circ \sim 60^\circ
```

### Equation 36

```tex
2^\circ \sim 4^\circ
```

### Equation 37

```tex
V_{\text{target}} \cdot \hat{u}_R
```

### Equation 38

```tex
90^\circ
```

### Equation 39

```tex
\pm 30\text{ kt}
```

### Equation 40

```tex
R_{\text{fuze}}
```

### Equation 41

```tex
\approx 1,000\text{ m/s}
```

### Equation 42

```tex
\approx 300\text{ m/s}
```

### Equation 43

```tex
\Delta t = 1/240\text{s}
```

### Equation 44

```tex
d
```

### Equation 45

```tex
\text{Damage}(d) = D_{\text{base}} \cdot \left(\frac{R_{\text{lethal}}}{\max(d, 1.0)}\right)^2 \cdot \max\left(0, 1 - \frac{d}{R_{\text{fuze}}}\right)
```

### Equation 46

```tex
d \le R_{\text{lethal}}
```

### Equation 47

```tex
3\text{m} \sim 5\text{m}
```

### Equation 48

```tex
R_{\text{lethal}} < d \le R_{\text{fuze}}
```

### Equation 49

```tex
V_{\text{MCA}}
```

### Equation 50

```tex
\to
```

### Equation 51

```tex
\to
```

### Equation 52

```tex
T(t, h) = \begin{cases} T_{\text{boost}} + A_e (P_0 - P(h)) & (0 \le t \le t_{\text{boost}}) \\ T_{\text{sustain}} + A_e (P_0 - P(h)) & (t_{\text{boost}} < t \le t_{\text{burn}}) \\ 0 & (t > t_{\text{burn}}) \end{cases}
```

### Equation 53

```tex
m(t) = m_0 - \int_0^t \frac{T(\tau, 0)}{I_{sp} \cdot g_0} \, d\tau \quad (\text{단, } m(t) \ge m_{\text{dry}})
```

### Equation 54

```tex
\rho \approx 0.41\text{ kg/m}^3
```

### Equation 55

```tex
\rho_0 = 1.225\text{ kg/m}^3
```

### Equation 56

```tex
G_{\text{avail}} \propto \bar{q}
```

### Equation 57

```tex
R > 12\text{ km}
```

### Equation 58

```tex
\vec{a}_{\text{loft}} = \vec{a}_{\text{APN}} + \vec{u}_{\text{up}} \cdot g_0 \cdot \text{clamp}\left(\frac{R - 12000}{15000}, 0, 1.5\right)
```

### Equation 59

```tex
R \le 12\text{ km}
```

### Equation 60

```tex
\vec{R} = \vec{P}_t - \vec{P}_m, \quad \vec{V}_{\text{rel}} = \vec{V}_t - \vec{V}_m, \quad V_c = -\frac{\vec{R} \cdot \vec{V}_{\text{rel}}}{\Vert{}\vec{R}\Vert{}}
```

### Equation 61

```tex
\vec{\Omega}_{\text{LOS}} = \frac{\vec{R} \times \vec{V}_{\text{rel}}}{\Vert{}\vec{R}\Vert{}^2}, \quad \vec{a}_{\text{cmd}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2} \vec{a}_{t, \perp} - \vec{g}_{\perp}
```

### Equation 62

```tex
C_L = \frac{m \cdot \Vert{}\vec{a}_{\text{actual}}\Vert{}}{\bar{q} \cdot S_{\text{ref}}}, \quad C_D = C_{D0}(\text{Mach}) + K(\text{Mach}) \cdot C_L^2
```

### Equation 63

```tex
48\text{ kt}
```

### Equation 64

```tex
\theta_{\text{lookdown}} < 0^\circ
```

### Equation 65

```tex
85\%
```

### Equation 66

```tex
I_{\text{aircraft}}
```

### Equation 67

```tex
I_{\text{aircraft}} = I_{\text{base}} \cdot \left(0.2 + 0.8 \cdot \text{Throttle}^{2.5} + 2.5 \cdot \mathbb{I}_{\text{Afterburner}}\right) \cdot \left(0.35 + 0.65 \cdot \frac{1 - \hat{f}_{\text{target}} \cdot \hat{u}_R}{2}\right)
```

### Equation 68

```tex
3^\circ
```

### Equation 69

```tex
N \cdot V_c \cdot \Omega_{\text{LOS}}
```

### Equation 70

```tex
G_{\text{avail}}
```

### Equation 71

```tex
8\text{G} \sim 9\text{G}
```

### Equation 72

```tex
+2.5\text{G}
```

### Equation 73

```tex
+3.8\text{G}
```

### Equation 74

```tex
240\text{Hz}
```

### Equation 75

```tex
P_{m, t-1} \to P_{m, t}
```

### Equation 76

```tex
P_{a, t-1} \to P_{a, t}
```

### Equation 77

```tex
d_{\text{CPA}} \le R_{\text{lethal}}
```

### Equation 78

```tex
3\text{m}\sim 5\text{m}
```

### Equation 79

```tex
\to
```

### Equation 80

```tex
R_{\text{lethal}} < d_{\text{CPA}} \le R_{\text{fuze}}
```

### Equation 81

```tex
5\text{m}\sim 15\text{m}
```

### Equation 82

```tex
\to
```

## Links present in the page

- "": https://www.google.co.kr/intl/en/about/products
- "Sign in": https://accounts.google.com/ServiceLogin?passive=1209600&osid=1&continue=https://gemini.google.com/share/2158d5ddc2ac?social_preview%3Dtrue%26skid%3D3d8104a9-1630-45aa-9823-69819b66c1de&followup=https://gemini.google.com/share/2158d5ddc2ac?social_preview%3Dtrue%26skid%3D3d8104a9-1630-45aa-9823-69819b66c1de&ec=GAZAkgU
- "Gemini": https://gemini.google.com/app
- "https://share.gemini.google/Du66hd1xbHg8": https://share.gemini.google/Du66hd1xbHg8
- "Google Privacy Policy\nOpens in a new window": https://policies.google.com/privacy
- "Google Terms of Service\nOpens in a new window": https://policies.google.com/terms
- "Your privacy & Gemini Apps\nOpens in a new window": https://support.google.com/gemini?p=privacy_notice
- "About Gemini": https://gemini.google/about/?utm_source=gemini&utm_medium=web&utm_campaign=gemini_zero_state_link_to_marketing_microsite
- "Subscriptions": https://one.google.com/ai
- "For Business": http://g.co/cloud/gemini-for-business

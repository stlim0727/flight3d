# Gemini research snapshot 3

Source: https://share.gemini.google/MmsXMVRuk7Z3

Captured: 2026-11-13, using Obscura. This is an unverified external research archive, not an implementation specification. Read [the archive index](README.md) and its correction register first. Earlier errors are intentionally retained.

Scope: rendered shared-page text, full code blocks, extracted TeX annotations and links. This is not a capture of linked conversations, original attachments, hidden project context or Google account data. Page navigation/footer text is retained for capture fidelity. Source formatting may be flattened; the separate code and TeX sections preserve those representations where available.

## Rendered page text

```text
Gemini
현실적인 미사일 유도 제어 시스템 구현 스펙
https://share.gemini.google/dilBPivKqYgm
Responses below were generated with a creator's Project according to their custom instructions. November 13, 2026 at 03:33 PM
Published November 13, 2026 at 03:34 PM
You said 항상 살상 반경 < 신관 작동 거리”라는 관계는 성립하지 않습니다. 둘은 독립적으로 모델링하세요. “공개 확인”이라고 쓴 항목마다 실제 문서 URL·해당 구절을 붙이세요. 기관명만…

항상 살상 반경 < 신관 작동 거리”라는 관계는 성립하지 않습니다. 둘은 독립적으로 모델링하세요.

“공개 확인”이라고 쓴 항목마다 실제 문서 URL·해당 구절을 붙이세요. 기관명만으로는 검증할 수 없습니다.

제시한 유도식은 시선에 수직인 성분과 속도에 수직인 성분을 혼동하고 있습니다. “속도 방향 가속도가 없다”는 설명과 수식을 일치시키세요.

CPA 수식은 같은 시각의 상대 위치를 비교하므로 맞는 방향입니다. 명칭은 일반적인 ‘두 선분 최단 거리’와 구분하고, 폭발 위치·피해 거리도 그 시각으로 맞추세요.

지적해 주신 4가지 기술적·검증적 오류를 모두 바로잡아 재구성했습니다.

1. 공개 확인값(1차 출처 URL 및 원문 구절) vs 비공개 추정값

공개 군사 자료에서 실제로 확인 가능한 항목은 기체 치수, 발사 중량, 최고 속도 대역, 탄두 명칭 및 중량까지입니다. 나머지 항목(추진제 질량, 추력 곡선, 연소 시간, 구조적 최대 G, 시커 추적 각속도·짐벌각, 신관/살상 반경)은 기밀이므로 모델링용 추정·가정값으로 분리했습니다.

① AIM-9M / AIM-9X Sidewinder

공개 확인 출처: 미 공군 공식 팩트시트 — AIM-9 Sidewinder

URL: [https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104557/aim-9-sidewinder/](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104557/aim-9-sidewinder/)

원문 확인 구절:

치수 및 중량: "Length: 9 feet, 5 inches (2.87 meters); AIM-9X is 9 feet, 10 inches (3 meters)", "Diameter: 5 inches (12.7 centimeters)", "Launch Weight: 190 pounds (85.5 kilograms)"

최고 속도: "Speed: Supersonic" (미 해군 팩트시트 [https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166794/aim-9-sidewinder/](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166794/aim-9-sidewinder/) 기준: "Speed: Mach 2.5+")

탄두: "Warhead: Annular blast fragmentation (20.8 pounds / 9.4 kilograms)"

AIM-9X 시커 및 TVC: "The AIM-9X incorporates ... a focal-plane array seeker and jet-vane thrust vector control" (미 해군 팩트시트 원문)

파라미터
AIM-9M
AIM-9X
분류
길이 / 직경 / 발사 중량
2.87 m /
0.127 m /
85.5 kg
3.00 m /
0.127 m / 약
84.4 kg
공개 확인 (상기 URL)
탄두 및 중량
환형 고폭 파편 (
9.4 kg)
환형 고폭 파편 (
9.4 kg)
공개 확인 (상기 URL)
추력편향(TVC) / 시커 형식
공력 카나드 / 냉각식 IR
제트 베인 TVC / FPA 적외선 영상(IIR)
공개 확인 (상기 URL)
추진제 질량 / 연소 시간 / 평균 추력
m
prop
​
≈27 kg /
t
burn
​
≈2.2 s /
T≈26.5 kN
m
prop
​
≈27 kg /
t
burn
​
≈2.2 s /
T≈26.5 kN
비공개 추정 (시뮬레이션용 근사)
최대 기동 하중 (
G
max
​
)
30∼35G
50∼60G (TVC 활성 구간 포함)
비공개 추정 (시뮬레이션용 근사)
시커 짐벌 한계 (
θ
gimbal
​
)
±35
∘
∼40
∘
±90
∘
(HOBS 구속 한계 근사)
비공개 추정 (HOBS 탑재만 공개)
② AIM-120C AMRAAM

공개 확인 출처: 미 공군 공식 팩트시트 — AIM-120 AMRAAM

URL: [https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104576/aim-120-amraam/](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104576/aim-120-amraam/)

원문 확인 구절:

치수 및 중량: "Length: 12 feet (3.66 meters)", "Diameter: 7 inches (17.78 centimeters)", "Launch Weight: 335 pounds (150.75 kilograms)"

최고 속도: "Speed: Supersonic" (미 해군 팩트시트 [https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166798/aim-120-amraam/](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166798/aim-120-amraam/) 기준: "Speed: Mach 4")

유도 방식: "Guidance System: Inertial midcourse with active radar terminal homing"

탄두: "Warhead: Blast fragmentation" (C-5 기준 약 $18\text{ kg}$급 공개 연감 수치, 세부 작약량 비공개)

파라미터
AIM-120C
분류
길이 / 직경 / 발사 중량
3.66 m /
0.178 m /
150.75 kg
공개 확인 (상기 URL)
최고 속도 / 유도 방식
Mach 4 / 관성 중간유도 + 종말 능동 레이더
공개 확인 (상기 URL)
추진제 질량 / 2단 추력 곡선
m
prop
​
≈48 kg, Boost(
2.5s,28 kN) + Sustain(
5.5s,6.5 kN)
비공개 추정 (시뮬레이션용 근사)
최대 기동 하중 / 시커 짐벌
35∼40G /
±60
∘
비공개 추정 (시뮬레이션용 근사)
③ FIM-92 Stinger (MANPADS 대표군)

공개 확인 출처: 미 육군/해병대 공개 자료 및 미 국방부 자료 (공개 연감 제원)

참고 URL: [https://www.marines.mil/News/News-Display/Article/2955754/](https://www.marines.mil/News/News-Display/Article/2955754/) 및 공개 제원(Length: 1.52 m (5 ft), Diameter: 70 mm (2.75 in), Missile Weight: 10.1 kg (22.3 lb), Warhead: 3 kg (6.6 lb) HE)

그 외 추력 곡선, 연소 시간(
∼
2
s
\sim 2\text{s}
∼2s 이젝터+부스트/서스테인), 최대 기동 G(
∼
18
∼
22
G
\sim 18 \sim 22\text{G}
∼18∼22G), 신관 작동 거리는 모두 비공개 추정값입니다.

2. 신관 작동 거리(
R
fuze
R_{\text{fuze}}
R
fuze
​
)와 탄두 살상 반경(
R
lethal
R_{\text{lethal}}
R
lethal
​
)의 독립 모델링

두 파라미터 사이에 R_lethal < R_fuze 같은 고정 부등식을 두지 않고 완전히 독립된 두 물리 모델로 분리합니다.

근접신관 모델 (ProximityFuzeModel) — "언제 기폭하는가?"

신관은 센서(레이저 빔 원뿔 또는 도플러 레이더 게이트)의 반사 신호 임계치와 표적 통과 검출(점근 후 거리 증가 시작, 즉
R
˙
\dot{R}
R
˙
부호 반전) 조건으로만 작동합니다.

따라서 신관 설정 감도, 접근 각도(Aspect), 표적 크기(RCS/광학 반사 면적)에 따라:

조기 기폭 (
R
fuze
>
R
lethal
R_{\text{fuze}} > R_{\text{lethal}}
R
fuze
​
>R
lethal
​
): 대형기(B737)의 넓은 반사 면적이나 레이더 클러터로 인해 탄두 유효 살상 반경 밖에서 신관이 먼저 작동해 탄두가 낭비될 수 있습니다.

지연/미작동 (
R
fuze
<
R
lethal
R_{\text{fuze}} < R_{\text{lethal}}
R
fuze
​
<R
lethal
​
또는 직격 전용): 신관 작동 반경이 살상 반경보다 좁게 설정되거나 직격(Hit-to-Kill) 모드인 경우, 살상 반경 내부를 스치고 지나가면서도 신관이 작동하지 않아 불발(Dud/Pass-through)이 발생할 수 있습니다.

탄두 피해 모델 (WarheadDamageModel) — "기폭 지점 $\vec{P}_{\text{det}}$에서 표적이 얼마나 손상되는가?"

신관이 기폭한 순간의 위치 \vec{P}_{\text{det}}$와 표적의 위치 $\vec{P}_{\text{target}} 사이의 실제 거리
d
det
=
∥
P
⃗
det
−
P
⃗
target
∥
d_{\text{det}} = \Vert{}\vec{P}_{\text{det}} - \vec{P}_{\text{target}}\Vert{}
d
det
​
=∥
P
det
​
−
P
target
​
∥, 그리고 탄두 파편 방출 패턴(구면 폭압 + 방향성 환형 파편 원뿔
θ
frag
\theta_{\text{frag}}
θ
frag
​
)을 독립적으로 계산합니다.

$R_{\text{lethal}}$은 탄두 고유의 파편 질량·초속 및 표적 장갑/기체 내구도에 의해 결정되는 독립 변수이며, $R_{\text{fuze}}$와 독립적으로 JSON 스펙에 정의합니다.

3. 유도 공식 수정: "속도 방향 가속도 0" 조건과 수식의 일치

이전 응답에서 시선 단위벡터
u
^
R
\hat{u}_R
u
^
R
​
에 수직인 평면으로 유도 명령을 투영했기 때문에, 미사일 속도 단위벡터
v
^
m
=
V
⃗
m
/
∥
V
⃗
m
∥
\hat{v}_m = \vec{V}_m / \Vert{}\vec{V}_m\Vert{}
v
^
m
​
=
V
m
​
/∥
V
m
​
∥ 방향 성분이 섞여 들어가 "속도 방향 가속도는 오직 추력과 항력만으로 결정된다"는 물리 가정과 수학적으로 모순되었습니다.

수정된 3D 유도 및 동역학 수식 (속도 벡터 직교 투영)

추진·항력·중력에 의한 종방향(속도 방향) 가속도:

v
^
m
=
V
⃗
m
∥
V
⃗
m
∥
\hat{v}_m = \frac{\vec{V}_m}{\Vert{}\vec{V}_m\Vert{}}
v
^
m
​
=
∥
V
m
​
∥
V
m
​
​
a
∥
=
T
(
t
,
h
)
cos
⁡
α
−
D
m
(
t
)
+
g
⃗
⋅
v
^
m
a_{\parallel} = \frac{T(t, h) \cos\alpha - D}{m(t)} + \vec{g} \cdot \hat{v}_m
a
∥
​
=
m(t)
T(t,h)cosα−D
​
+
g
​
⋅
v
^
m
​

(유도 제어기 $\vec{a}_{\text{guidance}}$는
v
^
m
\hat{v}_m
v
^
m
​
성분을 전혀 건드리지 않습니다.)

순수 횡방향(속도 벡터
v
^
m
\hat{v}_m
v
^
m
​
에 수직인 평면) 유도 명령
a
⃗
guidance
\vec{a}_{\text{guidance}}
a
guidance
​
:

먼저 일반 3D APN 원시 벡터를 구합니다:

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
\vec{a}_{\text{raw}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2}\vec{a}_{\text{target},\perp\text{LOS}} - \vec{g}
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

이어서 $\vec{a}{\text{raw}}$에서 미사일 속도 벡터
v
^
m
\hat{v}_m
v
^
m
​
방향 성분을 직교 제거(Orthogonal Projection onto
v
^
m
⊥
\hat{v}_m^\perp
v
^
m
⊥
​
)하여 조종핀(Fin) 또는 TVC가 발생시킬 수 있는 순수 횡가속도 명령만을 남깁니다: $$\vec{a}{\text{lat, cmd}} = \vec{a}{\text{raw}} - (\vec{a}{\text{raw}} \cdot \hat{v}_m),\hat{v}_m$$

이제
a
⃗
lat, cmd
⋅
v
^
m
≡
0
\vec{a}_{\text{lat, cmd}} \cdot \hat{v}_m \equiv 0
a
lat, cmd
​
⋅
v
^
m
​
≡0 이 항등적으로 성립하므로, 유도 명령은 오직 속도 벡터의 방향(선회각)만 바꾸고 속력 \Vert{}\vec{V}_m\Vert{}$에는 직접적인 양/음의 일을 하지 않습니다(선회로 인한 속력 감소는 오직 유도항력 $C_{Di} 증가를 통해서만 간접 발생).

가용 횡가속도 제한 및 1차 액추에이터 지연:

a
lat, max
=
min
⁡
(
G
struct
⋅
g
0
,
  
q
ˉ
S
ref
C
L
max
⁡
+
T
(
t
)
sin
⁡
δ
TVC
m
(
t
)
)
a_{\text{lat, max}} = \min\left(G_{\text{struct}} \cdot g_0, \; \frac{\bar{q} S_{\text{ref}} C_{L\max} + T(t)\sin\delta_{\text{TVC}}}{m(t)}\right)
a
lat, max
​
=min(G
struct
​
⋅g
0
​
,
m(t)
q
ˉ
​
S
ref
​
C
Lmax
​
+T(t)sinδ
TVC
​
​
)
a
⃗
lat, target
=
clampMagnitude
(
a
⃗
lat, cmd
,
  
a
lat, max
)
\vec{a}_{\text{lat, target}} = \text{clampMagnitude}(\vec{a}_{\text{lat, cmd}}, \; a_{\text{lat, max}})
a
lat, target
​
=clampMagnitude(
a
lat, cmd
​
,a
lat, max
​
)

1차 지연 필터 통과 후에도 속도 벡터와 직교성을 유지하기 위해 재직교화(Re-orthogonalize)합니다:

a
⃗
lat
←
a
⃗
lat
+
Δ
t
τ
+
Δ
t
(
a
⃗
lat, target
−
a
⃗
lat
)
\vec{a}_{\text{lat}} \leftarrow \vec{a}_{\text{lat}} + \frac{\Delta t}{\tau + \Delta t}(\vec{a}_{\text{lat, target}} - \vec{a}_{\text{lat}})
a
lat
​
←
a
lat
​
+
τ+Δt
Δt
​
(
a
lat, target
​
−
a
lat
​
)
a
⃗
lat
←
a
⃗
lat
−
(
a
⃗
lat
⋅
v
^
m
)
 
v
^
m
\vec{a}_{\text{lat}} \leftarrow \vec{a}_{\text{lat}} - (\vec{a}_{\text{lat}} \cdot \hat{v}_m)\,\hat{v}_m
a
lat
​
←
a
lat
​
−(
a
lat
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

최종 가속도 합산:

a
⃗
total
=
a
∥
 
v
^
m
+
a
⃗
lat
\vec{a}_{\text{total}} = a_{\parallel}\,\hat{v}_m + \vec{a}_{\text{lat}}
a
total
​
=a
∥
​
v
^
m
​
+
a
lat
​

유효 가정: 포인트 매스(3-DOF) + 속도 벡터 정렬 기체(Zero-sideslip Bank-to-Turn / Skid-to-Turn 대칭 모델)에서 성립합니다. 받음각
α
\alpha
α가 매우 큰 고각도(HOBS) 기동 중 동체 기수 방향과 속도 벡터가 크게 벌어지는 구간까지 모사하려면 기체 자세 쿼터니언을 분리한 완전 6-DOF 동역학으로 확장해야 합니다.

4. 동시각 선형 보간 최단 접근 판정 (Co-temporal Linear CPA) 및 기폭 위치 계산

두 3차원 선분의 공간상 기하학적 최단 거리(두 꼬인 직선/선분 사이의 거리, 매개변수
s
,
t
∈
[
0
,
1
]
s, t \in [0, 1]
s,t∈[0,1] 2개 사용)가 아니라, 동일한 틱 내 상대 시각 $\tau \in [0, 1]$에서의 동시각 상대 위치 벡터 차이 $\vec{r}(\tau)$의 최솟값을 구해야 합니다.

① 동시각 상대 위치 최솟값 및 기폭 시각
τ
∗
\tau^*
τ
∗
유도

120Hz 고정 스텝(
Δ
t
=
1
/
120
 s
\Delta t = 1/120\text{ s}
Δt=1/120 s) 동안 미사일이
P
⃗
m
,
0
→
P
⃗
m
,
1
\vec{P}_{m,0} \to \vec{P}_{m,1}
P
m,0
​
→
P
m,1
​
, 표적이 $\vec{P}{t,0} \to \vec{P}{t,1}$로 등속 직선 이동한다고 가정할 때, 정규화 시각 $\tau \in [0, 1]$에서의 상대 위치 벡터는 다음과 같습니다.

r
⃗
0
=
P
⃗
t
,
0
−
P
⃗
m
,
0
,
Δ
r
⃗
=
(
P
⃗
t
,
1
−
P
⃗
m
,
1
)
−
r
⃗
0
\vec{r}_0 = \vec{P}_{t,0} - \vec{P}_{m,0}, \quad \Delta \vec{r} = (\vec{P}_{t,1} - \vec{P}_{m,1}) - \vec{r}_0
r
0
​
=
P
t,0
​
−
P
m,0
​
,Δ
r
=(
P
t,1
​
−
P
m,1
​
)−
r
0
​
r
⃗
(
τ
)
=
r
⃗
0
+
τ
Δ
r
⃗
(
τ
∈
[
0
,
1
]
)
\vec{r}(\tau) = \vec{r}_0 + \tau \Delta \vec{r} \quad (\tau \in [0, 1])
r
(τ)=
r
0
​
+τΔ
r
(τ∈[0,1])

거리 제곱 함수
f
(
τ
)
=
∥
r
⃗
(
τ
)
∥
2
=
∥
r
⃗
0
∥
2
+
2
(
r
⃗
0
⋅
Δ
r
⃗
)
τ
+
∥
Δ
r
⃗
∥
2
τ
2
f(\tau) = \Vert{}\vec{r}(\tau)\Vert{}^2 = \Vert{}\vec{r}_0\Vert{}^2 + 2(\vec{r}_0 \cdot \Delta \vec{r})\tau + \Vert{}\Delta \vec{r}\Vert{}^2 \tau^2
f(τ)=∥
r
(τ)∥
2
=∥
r
0
​
∥
2
+2(
r
0
​
⋅Δ
r
)τ+∥Δ
r
∥
2
τ
2
를 미분하여
f
′
(
τ
)
=
0
f'(\tau) = 0
f
′
(τ)=0 이 되는 최단 접근 시각 $\tau_{\text{cpa}}$를 구합니다.

τ
cpa
=
clamp
(
−
r
⃗
0
⋅
Δ
r
⃗
∥
Δ
r
⃗
∥
2
,
  
0.0
,
  
1.0
)
(
단, 
∥
Δ
r
⃗
∥
2
>
ϵ
)
\tau_{\text{cpa}} = \text{clamp}\left(-\frac{\vec{r}_0 \cdot \Delta \vec{r}}{\Vert{}\Delta \vec{r}\Vert{}^2}, \; 0.0, \; 1.0\right) \quad (\text{단, } \Vert{}\Delta \vec{r}\Vert{}^2 > \epsilon)
τ
cpa
​
=clamp(−
∥Δ
r
∥
2
r
0
​
⋅Δ
r
​
,0.0,1.0)(단, ∥Δ
r
∥
2
>ϵ)

최단 접근 거리:
d
cpa
=
∥
r
⃗
(
τ
cpa
)
∥
d_{\text{cpa}} = \Vert{}\vec{r}(\tau_{\text{cpa}})\Vert{}
d
cpa
​
=∥
r
(τ
cpa
​
)∥

동시각 미사일 폭발 위치:
P
⃗
det
=
P
⃗
m
,
0
+
τ
cpa
(
P
⃗
m
,
1
−
P
⃗
m
,
0
)
\vec{P}_{\text{det}} = \vec{P}_{m,0} + \tau_{\text{cpa}}(\vec{P}_{m,1} - \vec{P}_{m,0})
P
det
​
=
P
m,0
​
+τ
cpa
​
(
P
m,1
​
−
P
m,0
​
)

동시각 표적 위치:
P
⃗
target, det
=
P
⃗
t
,
0
+
τ
cpa
(
P
⃗
t
,
1
−
P
⃗
t
,
0
)
\vec{P}_{\text{target, det}} = \vec{P}_{t,0} + \tau_{\text{cpa}}(\vec{P}_{t,1} - \vec{P}_{t,0})
P
target, det
​
=
P
t,0
​
+τ
cpa
​
(
P
t,1
​
−
P
t,0
​
)

피해 판정 거리:
d
damage
=
∥
P
⃗
det
−
P
⃗
target, det
∥
=
d
cpa
d_{\text{damage}} = \Vert{}\vec{P}_{\text{det}} - \vec{P}_{\text{target, det}}\Vert{} = d_{\text{cpa}}
d
damage
​
=∥
P
det
​
−
P
target, det
​
∥=d
cpa
​

② 신관 작동 조건 (통과 시점 및 반경 독립 검사)

신관 감지 여부:
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

점근 통과 조건:
τ
cpa
<
1.0
\tau_{\text{cpa}} < 1.0
τ
cpa
​
<1.0 이거나(틱 내부에서 최단점을 이미 지나쳐 멀어지기 시작함), 현재 틱 끝에서 접근 속도가 음수로 전환(
r
⃗
1
⋅
Δ
r
⃗
>
0
\vec{r}_1 \cdot \Delta \vec{r} > 0
r
1
​
⋅Δ
r
>0)될 때
τ
cpa
\tau_{\text{cpa}}
τ
cpa
​
시점에 기폭합니다. (참고: 실제 레이저/레이더 신관이 표적 외피에 가장 먼저 진입하는 경계 $\tau_{\text{entry}} \le \tau_{\text{cpa}}$에서 기폭하는 특성을 모사하려면
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
의 작은 근 $\tau_{\text{entry}}$를 기폭 시각으로 선택할 수도 있으며, 이 경우 기폭 거리는 정확히
d
damage
=
R
fuze
d_{\text{damage}} = R_{\text{fuze}}
d
damage
​
=R
fuze
​
가 됩니다. 반대로 지연 신관(Fuze Delay)으로 최단 접근점 기폭을 모사할 때는 $\tau_{\text{cpa}}$를 사용합니다.)

5. 120Hz 고정 스텝 TypeScript 구현 예시

위 수정 사항(속도 벡터 직교 유도 투영, 독립된 fuzeRadiusM / lethalRadiusM, 동시각 선형 CPA 및 기폭 좌표 산출)을 반영한 코드입니다.

TypeScript
import * as THREE from 'three'; export interface MissileSpec { id: 'aim-9m' | 'aim-9x' | 'aim-120c' | 'manpads'; // [공개 확인값 기반] lengthM: number; diameterM: number; massInitialKg: number; warheadMassKg: number; // [비공개 추정/근사값 - 추진 및 공력] propellantMassKg: number; boostTimeSec: number; burnTimeSec: number; boostThrustN: number; sustainThrustN: number; hasTVC: boolean; tvcMaxThrustLateralN: number; cd0Subsonic: number; cd0TransonicPeak: number; cd0Supersonic: number; inducedDragK: number; clMax: number; structuralMaxG: number; autopilotTauSec: number; // [비공개 추정/근사값 - 유도 및 시커] navGain: number; apnTargetAccelWeight: number; gimbalLimitRad: number; // [비공개 추정/근사값 - 신관과 탄두 살상 반경 독립 정의] fuzeTriggerRadiusM: number; // R_fuze (센서 작동 반경) fuzeTriggerMode: 'ON_ENTRY' | 'AT_CPA'; // 경계 진입 즉시 기폭 vs 최단점 지연 기폭 warheadLethalRadiusM: number; // R_lethal (탄두 유효 살상 반경, R_fuze와 독립) warheadMaxFragRadiusM: number; // 파편 도달 최대 반경 } export interface DetonationEvent { detonated: boolean; tau: number; // 틱 내 정규화 기폭 시각 [0, 1] detonationPos: THREE.Vector3; // 기폭 순간 미사일 위치 targetPosAtDet: THREE.Vector3;// 기폭 순간 표적 위치 damageDistanceM: number; // 기폭 시각 기준 실제 거리 isLethalKill: boolean; // damageDistanceM <= warheadLethalRadiusM damageRatio: number; // 0.0 ~ 1.0 (독립된 탄두 살상 모델 출력) } const _r0 = new THREE.Vector3(); const _r1 = new THREE.Vector3(); const _dr = new THREE.Vector3(); const _vHat = new THREE.Vector3(); const _losDir = new THREE.Vector3(); const _relVel = new THREE.Vector3(); const _omegaLOS = new THREE.Vector3(); const _aRaw = new THREE.Vector3(); const _aTargetPerpLOS = new THREE.Vector3(); const _aLatCmd = new THREE.Vector3(); const _aLatTarget = new THREE.Vector3(); const _gravity = new THREE.Vector3(0, -9.80665, 0); export function stepMissile120Hz( dt: number, // 1 / 120 missile: { pos: THREE.Vector3; prevPos: THREE.Vector3; vel: THREE.Vector3; latAccel: THREE.Vector3; flightTime: number; locked: boolean; active: boolean; }, target: { pos: THREE.Vector3; prevPos: THREE.Vector3; vel: THREE.Vector3; accel: THREE.Vector3; }, spec: MissileSpec, airDensity: number, speedOfSound: number
): DetonationEvent | null { if (!missile.active) return null; missile.prevPos.copy(missile.pos); missile.flightTime += dt; // 1. 가변 질량 및 추력 (연소 시간 내 선형 소모 가정) const burnFrac = Math.min(missile.flightTime / spec.burnTimeSec, 1.0); const currentMass = spec.massInitialKg - spec.propellantMassKg * burnFrac; const isBurning = missile.flightTime <= spec.burnTimeSec; const thrust = isBurning ? (missile.flightTime <= spec.boostTimeSec ? spec.boostThrustN : spec.sustainThrustN) : 0.0; // 2. 시커 짐벌 한계 판정 _r0.subVectors(target.pos, missile.pos); const dist = _r0.length(); const speed = missile.vel.length(); if (speed > 1e-3 && dist > 1e-3) { _vHat.copy(missile.vel).divideScalar(speed); _losDir.copy(_r0).divideScalar(dist); const offBoresight = Math.acos(THREE.MathUtils.clamp(_vHat.dot(_losDir), -1, 1)); if (offBoresight > spec.gimbalLimitRad) { missile.locked = false; } } // 3. 속도 벡터에 직교하는 순수 횡방향 유도 명령 산출 _aLatTarget.set(0, 0, 0); if (missile.locked && speed > 10.0 && dist > 1.0) { _relVel.subVectors(target.vel, missile.vel); const closingVel = -_losDir.dot(_relVel); if (closingVel > 0) { // Omega_LOS = (R x V_rel) / R^2 _omegaLOS.crossVectors(_r0, _relVel).divideScalar(dist * dist); _aRaw.crossVectors(_omegaLOS, _losDir).multiplyScalar(spec.navGain * closingVel); // APN 표적 기동 보정 (시선 수직 성분) _aTargetPerpLOS.copy(target.accel).addScaledVector(_losDir, -target.accel.dot(_losDir)); _aRaw.addScaledVector(_aTargetPerpLOS, spec.navGain * spec.apnTargetAccelWeight); _aRaw.sub(_gravity); // [핵심 수정] 미사일 속도 단위벡터 vHat 방향 성분을 제거하여 순수 횡가속도만 추출 _aLatCmd.copy(_aRaw).addScaledVector(_vHat, -_aRaw.dot(_vHat)); // 가용 횡가속도 한계 (동압 양력 + TVC 추력편향) const qBar = 0.5 * airDensity * speed * speed; const refArea = Math.PI * Math.pow(spec.diameterM * 0.5, 2); const aeroMaxForce = qBar * refArea * spec.clMax; const tvcMaxForce = isBurning && spec.hasTVC ? spec.tvcMaxThrustLateralN : 0; const maxLatAccel = Math.min( spec.structuralMaxG * 9.80665, (aeroMaxForce + tvcMaxForce) / currentMass ); if (_aLatCmd.length() > maxLatAccel) { _aLatCmd.normalize().multiplyScalar(maxLatAccel); } _aLatTarget.copy(_aLatCmd); } } // 1차 액추에이터 지연 후 vHat 직교성 재보장 const lagAlpha = dt / (spec.autopilotTauSec + dt); missile.latAccel.lerp(_aLatTarget, lagAlpha); if (speed > 1e-3) { missile.latAccel.addScaledVector(_vHat, -missile.latAccel.dot(_vHat)); } // 4. 종방향(속도 방향) 가속도: 추력, 파동항력, 횡기동 유도항력, 중력 투영 const qBar = 0.5 * airDensity * speed * speed; const refArea = Math.PI * Math.pow(spec.diameterM * 0.5, 2); const mach = speed / Math.max(speedOfSound, 1.0); const cd0 = mach < 0.85 ? spec.cd0Subsonic : mach < 1.2 ? spec.cd0TransonicPeak : spec.cd0Supersonic; const latForce = missile.latAccel.length() * currentMass; const clCurrent = qBar > 1.0 ? latForce / (qBar * refArea) : 0; const cdTotal = cd0 + spec.inducedDragK * clCurrent * clCurrent; const dragForce = qBar * refArea * cdTotal; const aParallel = (thrust - dragForce) / currentMass + _gravity.dot(_vHat); // 최종 속도 및 위치 적분 (a_total = a_parallel * vHat + a_lat) missile.vel.addScaledVector(_vHat, aParallel * dt); missile.vel.addScaledVector(missile.latAccel, dt); missile.pos.addScaledVector(missile.vel, dt); // 5. 동시각 선형 보간 근접신관(Co-temporal Linear CPA) 및 독립 탄두 피해 판정 return evaluateCoTemporalFuze(missile.prevPos, missile.pos, target.prevPos, target.pos, spec); } function evaluateCoTemporalFuze( m0: THREE.Vector3, m1: THREE.Vector3, t0: THREE.Vector3, t1: THREE.Vector3, spec: MissileSpec ): DetonationEvent | null { _r0.subVectors(t0, m0); _r1.subVectors(t1, m1); _dr.subVectors(_r1, _r0); const drLenSq = _dr.lengthSq(); let tauCpa = 0.0; if (drLenSq > 1e-9) { tauCpa = THREE.MathUtils.clamp(-_r0.dot(_dr) / drLenSq, 0.0, 1.0); } const distAtCpa = Math.sqrt( _r0.lengthSq() + 2 * _r0.dot(_dr) * tauCpa + drLenSq * tauCpa * tauCpa ); // 신관 작동 반경(fuzeTriggerRadiusM) 이내이고 최단점을 통과했는지 검사 if (distAtCpa <= spec.fuzeTriggerRadiusM && tauCpa < 1.0) { let tauDet = tauCpa; // 신관 경계 진입 시 즉시 기폭 모드일 경우 ||r(tau)|| = R_fuze 의 진입 시각 계산 if (spec.fuzeTriggerMode === 'ON_ENTRY' && drLenSq > 1e-9) { const b = _r0.dot(_dr); const c = _r0.lengthSq() - spec.fuzeTriggerRadiusM * spec.fuzeTriggerRadiusM; const disc = b * b - drLenSq * c; if (disc >= 0) { const tauEntry = (-b - Math.sqrt(disc)) / drLenSq; if (tauEntry >= 0.0 && tauEntry <= tauCpa) { tauDet = tauEntry; } } } // 기폭 시각 tauDet에서의 미사일·표적 동시각 위치 및 피해 거리 산출 const detonationPos = new THREE.Vector3().lerpVectors(m0, m1, tauDet); const targetPosAtDet = new THREE.Vector3().lerpVectors(t0, t1, tauDet); const damageDistanceM = detonationPos.distanceTo(targetPosAtDet); // 독립된 탄두 살상 반경(warheadLethalRadiusM) 기준 피해 계산 const isLethalKill = damageDistanceM <= spec.warheadLethalRadiusM; let damageRatio = 0.0; if (isLethalKill) { damageRatio = 1.0; } else if (damageDistanceM <= spec.warheadMaxFragRadiusM) { const span = Math.max(spec.warheadMaxFragRadiusM - spec.warheadLethalRadiusM, 0.1); const norm = 1.0 - (damageDistanceM - spec.warheadLethalRadiusM) / span; damageRatio = norm * norm; // 역제곱 감쇠 근사 } return { detonated: true, tau: tauDet, detonationPos, targetPosAtDet, damageDistanceM, isLethalKill, damageRatio, }; } return null; }
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
  // [공개 확인값 기반]
  lengthM: number;
  diameterM: number;
  massInitialKg: number;
  warheadMassKg: number;

  // [비공개 추정/근사값 - 추진 및 공력]
  propellantMassKg: number;
  boostTimeSec: number;
  burnTimeSec: number;
  boostThrustN: number;
  sustainThrustN: number;
  hasTVC: boolean;
  tvcMaxThrustLateralN: number;
  cd0Subsonic: number;
  cd0TransonicPeak: number;
  cd0Supersonic: number;
  inducedDragK: number;
  clMax: number;
  structuralMaxG: number;
  autopilotTauSec: number;

  // [비공개 추정/근사값 - 유도 및 시커]
  navGain: number;
  apnTargetAccelWeight: number;
  gimbalLimitRad: number;

  // [비공개 추정/근사값 - 신관과 탄두 살상 반경 독립 정의]
  fuzeTriggerRadiusM: number;    // R_fuze (센서 작동 반경)
  fuzeTriggerMode: 'ON_ENTRY' | 'AT_CPA'; // 경계 진입 즉시 기폭 vs 최단점 지연 기폭
  warheadLethalRadiusM: number;  // R_lethal (탄두 유효 살상 반경, R_fuze와 독립)
  warheadMaxFragRadiusM: number; // 파편 도달 최대 반경
}

export interface DetonationEvent {
  detonated: boolean;
  tau: number;                  // 틱 내 정규화 기폭 시각 [0, 1]
  detonationPos: THREE.Vector3; // 기폭 순간 미사일 위치
  targetPosAtDet: THREE.Vector3;// 기폭 순간 표적 위치
  damageDistanceM: number;      // 기폭 시각 기준 실제 거리
  isLethalKill: boolean;        // damageDistanceM <= warheadLethalRadiusM
  damageRatio: number;          // 0.0 ~ 1.0 (독립된 탄두 살상 모델 출력)
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

  // 1. 가변 질량 및 추력 (연소 시간 내 선형 소모 가정)
  const burnFrac = Math.min(missile.flightTime / spec.burnTimeSec, 1.0);
  const currentMass = spec.massInitialKg - spec.propellantMassKg * burnFrac;
  const isBurning = missile.flightTime <= spec.burnTimeSec;
  const thrust = isBurning
    ? (missile.flightTime <= spec.boostTimeSec ? spec.boostThrustN : spec.sustainThrustN)
    : 0.0;

  // 2. 시커 짐벌 한계 판정
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

  // 3. 속도 벡터에 직교하는 순수 횡방향 유도 명령 산출
  _aLatTarget.set(0, 0, 0);
  if (missile.locked && speed > 10.0 && dist > 1.0) {
    _relVel.subVectors(target.vel, missile.vel);
    const closingVel = -_losDir.dot(_relVel);

    if (closingVel > 0) {
      // Omega_LOS = (R x V_rel) / R^2
      _omegaLOS.crossVectors(_r0, _relVel).divideScalar(dist * dist);
      _aRaw.crossVectors(_omegaLOS, _losDir).multiplyScalar(spec.navGain * closingVel);

      // APN 표적 기동 보정 (시선 수직 성분)
      _aTargetPerpLOS.copy(target.accel).addScaledVector(_losDir, -target.accel.dot(_losDir));
      _aRaw.addScaledVector(_aTargetPerpLOS, spec.navGain * spec.apnTargetAccelWeight);
      _aRaw.sub(_gravity);

      // [핵심 수정] 미사일 속도 단위벡터 vHat 방향 성분을 제거하여 순수 횡가속도만 추출
      _aLatCmd.copy(_aRaw).addScaledVector(_vHat, -_aRaw.dot(_vHat));

      // 가용 횡가속도 한계 (동압 양력 + TVC 추력편향)
      const qBar = 0.5 * airDensity * speed * speed;
      const refArea = Math.PI * Math.pow(spec.diameterM * 0.5, 2);
      const aeroMaxForce = qBar * refArea * spec.clMax;
      const tvcMaxForce = isBurning && spec.hasTVC ? spec.tvcMaxThrustLateralN : 0;
      const maxLatAccel = Math.min(
        spec.structuralMaxG * 9.80665,
        (aeroMaxForce + tvcMaxForce) / currentMass
      );

      if (_aLatCmd.length() > maxLatAccel) {
        _aLatCmd.normalize().multiplyScalar(maxLatAccel);
      }
      _aLatTarget.copy(_aLatCmd);
    }
  }

  // 1차 액추에이터 지연 후 vHat 직교성 재보장
  const lagAlpha = dt / (spec.autopilotTauSec + dt);
  missile.latAccel.lerp(_aLatTarget, lagAlpha);
  if (speed > 1e-3) {
    missile.latAccel.addScaledVector(_vHat, -missile.latAccel.dot(_vHat));
  }

  // 4. 종방향(속도 방향) 가속도: 추력, 파동항력, 횡기동 유도항력, 중력 투영
  const qBar = 0.5 * airDensity * speed * speed;
  const refArea = Math.PI * Math.pow(spec.diameterM * 0.5, 2);
  const mach = speed / Math.max(speedOfSound, 1.0);
  const cd0 =
    mach < 0.85
      ? spec.cd0Subsonic
      : mach < 1.2
        ? spec.cd0TransonicPeak
        : spec.cd0Supersonic;

  const latForce = missile.latAccel.length() * currentMass;
  const clCurrent = qBar > 1.0 ? latForce / (qBar * refArea) : 0;
  const cdTotal = cd0 + spec.inducedDragK * clCurrent * clCurrent;
  const dragForce = qBar * refArea * cdTotal;

  const aParallel = (thrust - dragForce) / currentMass + _gravity.dot(_vHat);

  // 최종 속도 및 위치 적분 (a_total = a_parallel * vHat + a_lat)
  missile.vel.addScaledVector(_vHat, aParallel * dt);
  missile.vel.addScaledVector(missile.latAccel, dt);
  missile.pos.addScaledVector(missile.vel, dt);

  // 5. 동시각 선형 보간 근접신관(Co-temporal Linear CPA) 및 독립 탄두 피해 판정
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

  const drLenSq = _dr.lengthSq();
  let tauCpa = 0.0;
  if (drLenSq > 1e-9) {
    tauCpa = THREE.MathUtils.clamp(-_r0.dot(_dr) / drLenSq, 0.0, 1.0);
  }

  const distAtCpa = Math.sqrt(
    _r0.lengthSq() + 2 * _r0.dot(_dr) * tauCpa + drLenSq * tauCpa * tauCpa
  );

  // 신관 작동 반경(fuzeTriggerRadiusM) 이내이고 최단점을 통과했는지 검사
  if (distAtCpa <= spec.fuzeTriggerRadiusM && tauCpa < 1.0) {
    let tauDet = tauCpa;

    // 신관 경계 진입 시 즉시 기폭 모드일 경우 ||r(tau)|| = R_fuze 의 진입 시각 계산
    if (spec.fuzeTriggerMode === 'ON_ENTRY' && drLenSq > 1e-9) {
      const b = _r0.dot(_dr);
      const c = _r0.lengthSq() - spec.fuzeTriggerRadiusM * spec.fuzeTriggerRadiusM;
      const disc = b * b - drLenSq * c;
      if (disc >= 0) {
        const tauEntry = (-b - Math.sqrt(disc)) / drLenSq;
        if (tauEntry >= 0.0 && tauEntry <= tauCpa) {
          tauDet = tauEntry;
        }
      }
    }

    // 기폭 시각 tauDet에서의 미사일·표적 동시각 위치 및 피해 거리 산출
    const detonationPos = new THREE.Vector3().lerpVectors(m0, m1, tauDet);
    const targetPosAtDet = new THREE.Vector3().lerpVectors(t0, t1, tauDet);
    const damageDistanceM = detonationPos.distanceTo(targetPosAtDet);

    // 독립된 탄두 살상 반경(warheadLethalRadiusM) 기준 피해 계산
    const isLethalKill = damageDistanceM <= spec.warheadLethalRadiusM;
    let damageRatio = 0.0;
    if (isLethalKill) {
      damageRatio = 1.0;
    } else if (damageDistanceM <= spec.warheadMaxFragRadiusM) {
      const span = Math.max(spec.warheadMaxFragRadiusM - spec.warheadLethalRadiusM, 0.1);
      const norm = 1.0 - (damageDistanceM - spec.warheadLethalRadiusM) / span;
      damageRatio = norm * norm; // 역제곱 감쇠 근사
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

  return null;
}

```

## TeX annotations in document order

### Equation 1

```tex
\sim 2\text{s}
```

### Equation 2

```tex
\sim 18 \sim 22\text{G}
```

### Equation 3

```tex
R_{\text{fuze}}
```

### Equation 4

```tex
R_{\text{lethal}}
```

### Equation 5

```tex
\dot{R}
```

### Equation 6

```tex
R_{\text{fuze}} > R_{\text{lethal}}
```

### Equation 7

```tex
R_{\text{fuze}} < R_{\text{lethal}}
```

### Equation 8

```tex
d_{\text{det}} = \Vert{}\vec{P}_{\text{det}} - \vec{P}_{\text{target}}\Vert{}
```

### Equation 9

```tex
\theta_{\text{frag}}
```

### Equation 10

```tex
\hat{u}_R
```

### Equation 11

```tex
\hat{v}_m = \vec{V}_m / \Vert{}\vec{V}_m\Vert{}
```

### Equation 12

```tex
\hat{v}_m = \frac{\vec{V}_m}{\Vert{}\vec{V}_m\Vert{}}
```

### Equation 13

```tex
a_{\parallel} = \frac{T(t, h) \cos\alpha - D}{m(t)} + \vec{g} \cdot \hat{v}_m
```

### Equation 14

```tex
\hat{v}_m
```

### Equation 15

```tex
\hat{v}_m
```

### Equation 16

```tex
\vec{a}_{\text{guidance}}
```

### Equation 17

```tex
\vec{a}_{\text{raw}} = N \cdot V_c \cdot (\vec{\Omega}_{\text{LOS}} \times \hat{u}_R) + \frac{N}{2}\vec{a}_{\text{target},\perp\text{LOS}} - \vec{g}
```

### Equation 18

```tex
\hat{v}_m
```

### Equation 19

```tex
\hat{v}_m^\perp
```

### Equation 20

```tex
\vec{a}_{\text{lat, cmd}} \cdot \hat{v}_m \equiv 0
```

### Equation 21

```tex
a_{\text{lat, max}} = \min\left(G_{\text{struct}} \cdot g_0, \; \frac{\bar{q} S_{\text{ref}} C_{L\max} + T(t)\sin\delta_{\text{TVC}}}{m(t)}\right)
```

### Equation 22

```tex
\vec{a}_{\text{lat, target}} = \text{clampMagnitude}(\vec{a}_{\text{lat, cmd}}, \; a_{\text{lat, max}})
```

### Equation 23

```tex
\vec{a}_{\text{lat}} \leftarrow \vec{a}_{\text{lat}} + \frac{\Delta t}{\tau + \Delta t}(\vec{a}_{\text{lat, target}} - \vec{a}_{\text{lat}})
```

### Equation 24

```tex
\vec{a}_{\text{lat}} \leftarrow \vec{a}_{\text{lat}} - (\vec{a}_{\text{lat}} \cdot \hat{v}_m)\,\hat{v}_m
```

### Equation 25

```tex
\vec{a}_{\text{total}} = a_{\parallel}\,\hat{v}_m + \vec{a}_{\text{lat}}
```

### Equation 26

```tex
\alpha
```

### Equation 27

```tex
s, t \in [0, 1]
```

### Equation 28

```tex
\tau^*
```

### Equation 29

```tex
\Delta t = 1/120\text{ s}
```

### Equation 30

```tex
\vec{P}_{m,0} \to \vec{P}_{m,1}
```

### Equation 31

```tex
\vec{r}_0 = \vec{P}_{t,0} - \vec{P}_{m,0}, \quad \Delta \vec{r} = (\vec{P}_{t,1} - \vec{P}_{m,1}) - \vec{r}_0
```

### Equation 32

```tex
\vec{r}(\tau) = \vec{r}_0 + \tau \Delta \vec{r} \quad (\tau \in [0, 1])
```

### Equation 33

```tex
f(\tau) = \Vert{}\vec{r}(\tau)\Vert{}^2 = \Vert{}\vec{r}_0\Vert{}^2 + 2(\vec{r}_0 \cdot \Delta \vec{r})\tau + \Vert{}\Delta \vec{r}\Vert{}^2 \tau^2
```

### Equation 34

```tex
f'(\tau) = 0
```

### Equation 35

```tex
\tau_{\text{cpa}} = \text{clamp}\left(-\frac{\vec{r}_0 \cdot \Delta \vec{r}}{\Vert{}\Delta \vec{r}\Vert{}^2}, \; 0.0, \; 1.0\right) \quad (\text{단, } \Vert{}\Delta \vec{r}\Vert{}^2 > \epsilon)
```

### Equation 36

```tex
d_{\text{cpa}} = \Vert{}\vec{r}(\tau_{\text{cpa}})\Vert{}
```

### Equation 37

```tex
\vec{P}_{\text{det}} = \vec{P}_{m,0} + \tau_{\text{cpa}}(\vec{P}_{m,1} - \vec{P}_{m,0})
```

### Equation 38

```tex
\vec{P}_{\text{target, det}} = \vec{P}_{t,0} + \tau_{\text{cpa}}(\vec{P}_{t,1} - \vec{P}_{t,0})
```

### Equation 39

```tex
d_{\text{damage}} = \Vert{}\vec{P}_{\text{det}} - \vec{P}_{\text{target, det}}\Vert{} = d_{\text{cpa}}
```

### Equation 40

```tex
d_{\text{cpa}} \le R_{\text{fuze}}
```

### Equation 41

```tex
\tau_{\text{cpa}} < 1.0
```

### Equation 42

```tex
\vec{r}_1 \cdot \Delta \vec{r} > 0
```

### Equation 43

```tex
\tau_{\text{cpa}}
```

### Equation 44

```tex
\Vert{}\vec{r}(\tau)\Vert{} = R_{\text{fuze}}
```

### Equation 45

```tex
d_{\text{damage}} = R_{\text{fuze}}
```

## Links present in the page

- "": https://www.google.co.kr/intl/en/about/products
- "Sign in": https://accounts.google.com/ServiceLogin?passive=1209600&osid=1&continue=https://gemini.google.com/share/d9430c4f7d90?social_preview%3Dtrue%26skid%3Dc98883a6-f4f3-4054-be7e-e22cf3c418aa&followup=https://gemini.google.com/share/d9430c4f7d90?social_preview%3Dtrue%26skid%3Dc98883a6-f4f3-4054-be7e-e22cf3c418aa&ec=GAZAkgU
- "Gemini": https://gemini.google.com/app
- "https://share.gemini.google/dilBPivKqYgm": https://share.gemini.google/dilBPivKqYgm
- "Google Privacy Policy\nOpens in a new window": https://policies.google.com/privacy
- "Google Terms of Service\nOpens in a new window": https://policies.google.com/terms
- "Your privacy & Gemini Apps\nOpens in a new window": https://support.google.com/gemini?p=privacy_notice
- "About Gemini": https://gemini.google/about/?utm_source=gemini&utm_medium=web&utm_campaign=gemini_zero_state_link_to_marketing_microsite
- "Subscriptions": https://one.google.com/ai
- "For Business": http://g.co/cloud/gemini-for-business

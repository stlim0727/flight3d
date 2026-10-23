# PR 자동 자가 피드백

PR을 만들거나 추가 커밋을 push하면 Codex가 변경 코드를 정적으로 검토하고
한국어 피드백 코멘트 하나를 생성·갱신합니다. Draft는 건너뛰고, Ready for review
전환 시 실행합니다. 기본 대상 작성자는 `yt7good`이며 API 사용 비용이 발생합니다.
이 리뷰는 merge 조건이나 자동 승인 기능이 아닙니다.

## 처음 설정하기 (PR을 받는 저장소 관리자)

1. 이 변경을 PR 대상 저장소의 기본 브랜치에 merge합니다. 이 파일을 추가한 PR
   자체에서는 새 워크플로가 아직 자동 실행되지 않습니다.
2. 대상 저장소의 **Settings → Secrets and variables → Actions → Secrets**에서
   `OPENAI_API_KEY`를 repository secret으로 등록합니다. 키를 코드나 채팅에 넣지
   마세요. ChatGPT 로그인 대신 OpenAI API 키를 사용하는 방식입니다.
3. 같은 화면의 **Variables**에 `CODEX_PR_FEEDBACK_ENABLED`를 `true`로 등록합니다.
   값이 없거나 `true`가 아니면 AI 리뷰 job을 건너뛰고 API를 호출하지 않습니다.
4. 선택 사항: `CODEX_REVIEW_AUTHOR`에 대상 GitHub 로그인 하나를 지정합니다.
   기본값은 `yt7good`입니다. `CODEX_REVIEW_MODEL`로 계정에서 사용할 수 있는 모델을
   지정할 수 있습니다. 생략하면 고정된 Codex CLI의 기본 모델을 사용합니다.
5. **Settings → Actions → General**에서 Actions와 이 워크플로가 사용하는 액션을
   허용합니다. 조직 정책에서도 코멘트 작성 권한을 허용해야 합니다.

CLI로 변수만 설정하는 예시 (저장소 이름은 실제 PR 대상에 맞추세요):

```powershell
gh variable set CODEX_PR_FEEDBACK_ENABLED --repo stlim0727/flight3d --body true
gh variable set CODEX_REVIEW_AUTHOR --repo stlim0727/flight3d --body yt7good
gh secret set OPENAI_API_KEY --repo stlim0727/flight3d
```

마지막 명령에서 키는 숨겨진 대화형 입력으로 전달합니다.

`yt7good/flight3d`에서 `stlim0727/flight3d`로 PR을 보내는 경우, 위 설정은
**stlim0727/flight3d**에 필요합니다. Fork에만 키·워크플로를 추가해도 원본 저장소의
PR 이벤트는 처리되지 않습니다. 원본 저장소에 쓰기/관리 권한이 없다면 관리자에게
merge와 설정을 요청하거나, 아래 수동 스킬을 사용하세요.

## 평소 사용법

평소처럼 PR을 만들고 push하면 됩니다. **Actions → PR self-feedback**에서 실행을
확인하고, PR의 **Flight3d PR 자가 피드백** 코멘트를 읽으세요.

- 물리·좌표계·단위, 상태 전이, 테스트 누락과 브라우저 검증 필요성을 검토합니다.
- 문제에는 우선순위, 커밋에 고정된 파일/줄 링크, 발생 조건과 수정 방향을 담습니다.
- 문제가 없어도 검토 범위와 한계를 게시하며 자동 승인하지 않습니다.
- 추가 push에는 같은 bot 코멘트를 갱신합니다. 같은 base/head 쌍의 재실행은
  이미 완료된 코멘트가 있으면 API 호출을 건너뜁니다.
- 실패했다면 실행 로그에서 키·모델 접근·권한을 확인한 뒤 **Re-run failed jobs**를
  사용하세요. 완료된 동일 커밋을 의도적으로 재검토하려면 기존 피드백 코멘트를
  삭제하고 **Re-run all jobs**를 실행합니다.
- 잠시 끄려면 `CODEX_PR_FEEDBACK_ENABLED`를 `false`로 바꿉니다.

설정 후 본인 계정으로 작은 PR을 만들고 코멘트 생성 → 추가 push → 같은 코멘트
갱신을 확인하면 실제 API·GitHub 권한까지 검증할 수 있습니다. 로컬 테스트는 이
외부 연결까지 증명하지 않습니다.

## Codex에서 수동으로 사용하기

스킬은 `.agents/skills/flight3d-pr-feedback/`에 있습니다. 해당 변경이 있는 checkout을
Codex에서 열고 새 세션에서 다음과 같이 요청하세요:

```text
$flight3d-pr-feedback https://github.com/stlim0727/flight3d/pull/123 검토하고 한국어 코멘트 올려줘
```

게시 없이 확인하려면:

```text
$flight3d-pr-feedback 현재 PR을 검토하고 결과만 채팅으로 알려줘
```

자동 리뷰와 달리 수동 사용은 로컬 Codex 로그인과 `gh` 인증을 사용합니다.
게시를 요청했을 때만 본인 계정으로 코멘트를 씁니다. 수동 코멘트도 아래 마커로
시작하고 `<!-- snapshot:BASE_SHA:HEAD_SHA -->`를 포함합니다. 본인 소유 코멘트만
갱신하고 bot이나 다른 사람의 코멘트는 수정하지 않습니다.

```markdown
<!-- flight3d-pr-feedback -->
<!-- snapshot:BASE_SHA:HEAD_SHA -->
## Flight3d PR 자가 피드백

검토 커밋과 기준 커밋, 발견한 문제, 실행한 검증과 한계
```

## 실행 범위와 유지보수

`pull_request_target`으로 fork PR도 처리하되, 두 job 모두 신뢰하는 base SHA만
checkout합니다. PR head는 Git 객체로 가져와 diff와 `git show`로 읽으며 PR 코드·
설치 스크립트·PR이 수정한 지침은 실행하지 않습니다. 리뷰 job의 GitHub 권한은
읽기 전용이며, Codex는 `read-only` sandbox와 `drop-sudo`로 실행됩니다. API 키가
없는 별도 job에서 구조를 검증한 결과만 코멘트로 게시합니다. 게시 직전 PR 상태와
base/head를 다시 확인하여 오래된 실행 결과를 버립니다.

정적 리뷰는 CI 테스트나 브라우저 검증을 실행하지 않습니다. 큰 diff·바이너리 등
충분히 확인하지 못한 내용은 한계로 표시합니다. 워크플로 실패·빈 출력·잘못된 JSON은
검토 성공 코멘트로 바뀌지 않습니다. 입력 파일은 비신뢰 데이터로 다루지만 AI
검토에는 오탐과 누락 가능성이 있으므로 실제 코드와 CI 결과를 함께 확인하세요.

Codex CLI는 `0.163.0`, 외부 Actions는 전체 commit SHA로 고정되어 있습니다.
검토 지침은 스킬의 `SKILL.md`, 응답 구조는 `.github/codex/review-schema.json`,
중복 방지·게시 로직은 `scripts/pr-feedback.mjs`에 있습니다. CLI·모델·지침을 바꾸면
아래 로컬 검증과 작은 실제 PR 검증을 다시 수행하세요.

```sh
node --test tests/prFeedback.test.js
npm run check
npm test
npm run build
```

공식 자료: [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action),
[Skills](https://learn.chatgpt.com/docs/build-skills).

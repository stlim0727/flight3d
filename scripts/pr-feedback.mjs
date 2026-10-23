// Trusted workflow helpers. Never evaluate review text or execute PR source.
export const marker = '<!-- flight3d-pr-feedback -->';
const bot = 'github-actions[bot]';
const snapshot = (base, head) => `<!-- snapshot:${base}:${head} -->`;
const owned = comment => comment.user?.login === bot && comment.user?.type === 'Bot'
  && comment.body?.startsWith(marker);

export async function prepareReview({ github, context, core }) {
  const expected = context.payload.pull_request;
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: expected.number });
  if (pr.state !== 'open' || pr.draft || pr.head.sha !== expected.head.sha
      || pr.base.sha !== expected.base.sha) {
    core.info('Skipping a closed, draft, or superseded PR snapshot.');
    return null;
  }
  const comments = await github.paginate(github.rest.issues.listComments,
    { ...context.repo, issue_number: pr.number, per_page: 100 });
  if (comments.some(comment => owned(comment)
      && comment.body.includes(snapshot(pr.base.sha, pr.head.sha)))) {
    core.info('This base/head pair already has feedback.');
    return null;
  }
  return { number: pr.number, base: pr.base.sha, head: pr.head.sha };
}

export function validateReview(raw) {
  if (typeof raw !== 'string' || raw.length > 40000) throw new Error('Missing or oversized review output');
  const review = JSON.parse(raw);
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (!review || !text(review.summary, 2000) || !Array.isArray(review.findings)
      || review.findings.length > 15 || !Array.isArray(review.limitations)
      || review.limitations.length < 1 || review.limitations.length > 10
      || !review.limitations.every(value => text(value, 500))) throw new Error('Invalid review structure');
  for (const finding of review.findings) {
    if (!finding || !['P1', 'P2', 'P3'].includes(finding.priority)
        || !text(finding.path, 300) || finding.path.startsWith('/')
        || finding.path.includes('\\') || finding.path.split('/').some(part => !part || part === '..' || part === '.')
        || !Number.isSafeInteger(finding.line) || finding.line < 1
        || !text(finding.title, 200) || !text(finding.body, 1500)) throw new Error('Invalid review finding');
  }
  return review;
}

// Prevent hidden HTML markers and unintended mentions in model-generated text.
const safe = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('@', '@\u200b');

export function formatReview(review, { base, head, serverUrl, repo, runId }) {
  const root = `${serverUrl}/${repo.owner}/${repo.repo}`;
  const lines = [marker, snapshot(base, head), '## Flight3d PR 자가 피드백',
    '', `검토 커밋: \`${head}\` · 기준: \`${base}\``, '', safe(review.summary)];
  for (const finding of review.findings) {
    const path = finding.path.split('/').map(encodeURIComponent).join('/');
    lines.push('', `### [${finding.priority}] ${safe(finding.title)}`, '',
      `[${safe(finding.path)}:${finding.line}](${root}/blob/${head}/${path}#L${finding.line})`,
      '', safe(finding.body));
  }
  if (!review.findings.length) lines.push('', '구체적으로 확인된 문제 없음. 자동 승인이나 무결성 보장을 의미하지 않습니다.');
  lines.push('', '### 검증 범위와 한계', '',
    '- 정적 코드 검토만 수행했습니다. 테스트·빌드·브라우저 검증은 이 리뷰에서 실행하지 않았습니다.',
    ...review.limitations.map(value => `- ${safe(value)}`), '',
    `[워크플로 실행](${root}/actions/runs/${runId})`);
  const body = lines.join('\n');
  if (body.length > 60000) throw new Error('Formatted review exceeds comment limit');
  return body;
}

export async function publishReview({ github, context, core, raw }) {
  const review = validateReview(raw); // Fail closed; empty output never earns a clean review.
  const expected = context.payload.pull_request;
  const comments = await github.paginate(github.rest.issues.listComments,
    { ...context.repo, issue_number: expected.number, per_page: 100 });
  // Recheck live state immediately before writing; old runs cannot overwrite new feedback.
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: expected.number });
  if (pr.state !== 'open' || pr.draft || pr.head.sha !== expected.head.sha
      || pr.base.sha !== expected.base.sha) {
    core.info('Discarding feedback for a superseded or closed PR.');
    return;
  }
  if (comments.some(comment => owned(comment)
      && comment.body.includes(snapshot(pr.base.sha, pr.head.sha)))) {
    core.info('Feedback already published for this snapshot.');
    return;
  }
  const body = formatReview(review, { base: pr.base.sha, head: pr.head.sha,
    serverUrl: context.serverUrl, repo: context.repo, runId: context.runId });
  const previous = comments.filter(owned).at(-1);
  if (previous) await github.rest.issues.updateComment({ ...context.repo, comment_id: previous.id, body });
  else await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body });
}

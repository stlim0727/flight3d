import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { marker, prepareReview, publishReview, validateReview, formatReview } from '../scripts/pr-feedback.mjs';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const report = { summary: '착륙 상태 변경 검토', findings: [], limitations: ['브라우저 동작 확인 필요'] };
const raw = JSON.stringify(report);
function harness({ comments = [], pr = {}, expected = {} } = {}) {
  const calls = [];
  const current = { number: 12, state: 'open', draft: false, base: { sha: base }, head: { sha: head }, ...pr };
  const context = { repo: { owner: 'example', repo: 'flight3d' }, serverUrl: 'https://github.com',
    runId: 42, payload: { pull_request: { ...current, ...expected } } };
  const github = {
    paginate: async () => comments,
    rest: {
      pulls: { get: async () => ({ data: current }) },
      issues: { listComments() {}, createComment: async args => calls.push(['create', args]),
        updateComment: async args => calls.push(['update', args]) },
    },
  };
  return { github, context, calls, core: { info() {} }, raw };
}
const botComment = body => ({ id: 7, user: { login: 'github-actions[bot]', type: 'Bot' }, body });
const body = () => formatReview(report, { base, head, serverUrl: 'https://github.com',
  repo: { owner: 'example', repo: 'flight3d' }, runId: 42 });

test('new review posts once; a repeated snapshot skips both inference and publishing', async () => {
  const first = harness();
  assert.deepEqual(await prepareReview(first), { number: 12, base, head });
  await publishReview(first);
  assert.equal(first.calls.length, 1);
  assert.equal(first.calls[0][0], 'create');
  assert.match(first.calls[0][1].body, /정적 코드 검토/);
  const repeated = harness({ comments: [botComment(first.calls[0][1].body)] });
  assert.equal(await prepareReview(repeated), null);
  await publishReview(repeated);
  assert.equal(repeated.calls.length, 0);
});

test('next head updates the bot comment; user marker spoofing is not edited', async () => {
  const userComment = { ...botComment(body()), id: 8, user: { login: 'human', type: 'User' } };
  const next = harness({ comments: [botComment(body()), userComment],
    pr: { head: { sha: 'c'.repeat(40) } } });
  assert.ok(await prepareReview(next));
  await publishReview(next);
  assert.equal(next.calls[0][0], 'update');
  assert.equal(next.calls[0][1].comment_id, 7);
  assert.match(next.calls[0][1].body, new RegExp('c'.repeat(40)));
  const spoof = harness({ comments: [userComment] });
  assert.ok(await prepareReview(spoof));
  await publishReview(spoof);
  assert.equal(spoof.calls[0][0], 'create');
});

test('base changes trigger a new review even if head is unchanged', async () => {
  const next = harness({ comments: [botComment(body())], pr: { base: { sha: 'd'.repeat(40) } } });
  assert.ok(await prepareReview(next));
  await publishReview(next);
  assert.equal(next.calls[0][0], 'update');
});

test('stale head/base, closed and draft PRs cannot publish', async () => {
  for (const options of [
    { expected: { head: { sha: 'c'.repeat(40) } } },
    { expected: { base: { sha: 'd'.repeat(40) } } },
    { pr: { state: 'closed' } }, { pr: { draft: true } },
  ]) {
    const h = harness(options);
    assert.equal(await prepareReview(h), null);
    await publishReview(h);
    assert.equal(h.calls.length, 0);
  }
});

test('malformed, empty and incomplete model outputs fail closed', async () => {
  for (const value of ['', 'null', '{}', 'not JSON', JSON.stringify({ ...report, summary: ' ' }),
    JSON.stringify({ ...report, limitations: [] }), JSON.stringify({ ...report, findings: [{}] })]) {
    assert.throws(() => validateReview(value));
    const h = harness();
    await assert.rejects(publishReview({ ...h, raw: value }));
    assert.equal(h.calls.length, 0);
  }
});

test('findings require safe paths and valid lines, render head permalinks and neutralize mentions/HTML', () => {
  const finding = { priority: 'P2', path: 'src/physics/Engine Model.js', line: 21,
    title: '@someone <test>', body: '역추력 상태에서 힘 방향 확인' };
  const value = { ...report, findings: [finding] };
  assert.deepEqual(validateReview(JSON.stringify(value)), value);
  const rendered = formatReview(value, { base, head, serverUrl: 'https://github.com',
    repo: { owner: 'example', repo: 'flight3d' }, runId: 42 });
  assert.ok(rendered.startsWith(marker));
  assert.ok(rendered.includes(`/blob/${head}/src/physics/Engine%20Model.js#L21`));
  assert.ok(!rendered.includes('@someone'));
  assert.ok(!rendered.includes('<test>'));
  for (const invalid of [{ line: 0 }, { line: 1.5 }, { path: '../secret' },
    { path: '/tmp/x' }, { path: 'C:\\secret' }, { priority: 'PASS' }]) {
    assert.throws(() => validateReview(JSON.stringify({ ...report, findings: [{ ...finding, ...invalid }] })));
  }
});

test('workflow keeps PR head code out of privileged jobs and separates review from publishing', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/pr-feedback.yml', import.meta.url), 'utf8'));
  assert.ok(workflow.on.pull_request_target.types.includes('synchronize'));
  assert.deepEqual(workflow.permissions, {});
  assert.match(workflow.jobs.review.if, /CODEX_PR_FEEDBACK_ENABLED/);
  assert.match(workflow.jobs.review.if, /pull_request.user.login/);
  assert.equal(workflow.jobs.review.permissions['pull-requests'], 'read');
  assert.equal(workflow.jobs.publish.permissions['pull-requests'], 'write');
  // Empty model output must reach validation and fail, rather than silently skip.
  assert.equal(workflow.jobs.publish.if, "needs.review.outputs.publish == 'true'");
  assert.equal(workflow.jobs.review.outputs.publish, '${{ steps.prepare.outputs.run }}');
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps.filter(value => value.uses?.startsWith('actions/checkout@'))) {
      assert.equal(step.with.ref, '${{ github.event.pull_request.base.sha }}');
      assert.equal(step.with['persist-credentials'], false);
    }
  }
  const codex = workflow.jobs.review.steps.at(-1);
  assert.ok(codex.uses.startsWith('openai/codex-action@'));
  assert.equal(codex.with.sandbox, 'read-only');
  assert.equal(codex.with['safety-strategy'], 'drop-sudo');
  assert.ok(!JSON.stringify(workflow.jobs.publish).includes('OPENAI_API_KEY'));
});

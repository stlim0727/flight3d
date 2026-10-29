#!/usr/bin/env node
// One-shot agent workflow helper for worktree creation (wt:new), review inspection (pr:arc), and merge+cleanup (pr:mac).
// Collapses 15-25 individual git/gh shell turns per PR into a single deterministic command.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function tryRun(cmd, args, options = {}) {
  try {
    return { ok: true, out: run(cmd, args, options) };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') || err.message };
  }
}

function getRepoInfo() {
  const nameWithOwner = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const [owner, repo] = nameWithOwner.split('/');
  return { owner, repo, nameWithOwner };
}

function cmdWtNew(branch, customPath) {
  if (!branch) {
    console.error('Usage: npm run wt:new -- <branch-name> [worktree-path]');
    process.exit(1);
  }
  run('git', ['fetch', 'origin', '--prune']);
  const slug = branch.replace(/^[^/]+\//, '');
  const targetPath = resolve(customPath || `/var/shared/repos/flight3d-worktrees/${slug}`);
  if (existsSync(targetPath)) {
    console.log(`Worktree path already exists: ${targetPath}`);
    console.log(run('git', ['-C', targetPath, 'status', '-sb']));
    return;
  }
  run('git', ['worktree', 'add', '-b', branch, targetPath, 'origin/main']);
  console.log(`✔ Created worktree: ${targetPath} (branch: ${branch} from origin/main)`);
}

function cmdPrArc(prArg, extraArgs = []) {
  const resolveIdx = extraArgs.indexOf('--resolve');
  if (resolveIdx !== -1 && extraArgs[resolveIdx + 1]) {
    const threadId = extraArgs[resolveIdx + 1];
    const query = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}`;
    const res = run('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `id=${threadId}`]);
    console.log(`✔ Resolved review thread ${threadId}: ${res}`);
    return;
  }

  const prJson = run('gh', [
    'pr', 'view', ...(prArg ? [prArg] : []),
    '--json', 'number,title,url,state,mergeStateStatus,reviewDecision,headRefName,statusCheckRollup'
  ]);
  const pr = JSON.parse(prJson);
  const { owner, repo } = getRepoInfo();

  const gql = `query($owner:String!, $repo:String!, $num:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$num) {
        reviewThreads(first:50) {
          nodes {
            id
            isResolved
            path
            line
            comments(first:10) {
              nodes { author { login } body createdAt }
            }
          }
        }
        comments(last:20) {
          nodes { author { login } body createdAt }
        }
      }
    }
  }`;
  const data = JSON.parse(run('gh', [
    'api', 'graphql', '-f', `query=${gql}`,
    '-F', `owner=${owner}`, '-F', `repo=${repo}`, '-F', `num=${pr.number}`
  ]));

  const threads = data.data.repository.pullRequest.reviewThreads.nodes;
  const unresolved = threads.filter(t => !t.isResolved);
  const checks = (pr.statusCheckRollup || []).map(c => `${c.name || c.context}: ${c.conclusion || c.status}`);

  console.log(`PR #${pr.number}: ${pr.title} (${pr.url})`);
  console.log(`State: ${pr.state} | MergeState: ${pr.mergeStateStatus} | ReviewDecision: ${pr.reviewDecision || 'NONE'}`);
  console.log(`Checks: ${checks.join(', ') || 'none'}`);
  console.log(`Unresolved review threads: ${unresolved.length} (total: ${threads.length})`);
  for (const t of unresolved) {
    const last = t.comments.nodes.at(-1);
    console.log(`\n- Thread [${t.id}] ${t.path}:${t.line ?? '?'}`);
    console.log(`  @${last?.author?.login}: ${last?.body?.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  const issueComments = data.data.repository.pullRequest.comments.nodes;
  if (issueComments.length > 0) {
    const latest = issueComments.at(-1);
    console.log(`\nLatest PR comment (@${latest.author?.login}, ${latest.createdAt}):`);
    console.log(latest.body.slice(0, 800));
  }
}

function cmdPrMac(prArg) {
  const prJson = run('gh', [
    'pr', 'view', ...(prArg ? [prArg] : []),
    '--json', 'number,title,url,state,mergeStateStatus,headRefName,statusCheckRollup'
  ]);
  const pr = JSON.parse(prJson);
  if (pr.state !== 'OPEN') {
    console.log(`PR #${pr.number} is already ${pr.state}. Proceeding to cleanup.`);
  } else {
    const failing = (pr.statusCheckRollup || []).filter(
      c => c.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion)
    );
    const pending = (pr.statusCheckRollup || []).filter(
      c => !c.conclusion && c.status !== 'COMPLETED'
    );
    if (failing.length > 0 || pending.length > 0) {
      console.error(`✖ Cannot merge PR #${pr.number}: failing=${failing.length}, pending=${pending.length}`);
      process.exit(1);
    }
    run('gh', ['pr', 'merge', String(pr.number), '--merge', '--delete-branch']);
    console.log(`✔ Merged PR #${pr.number} (${pr.headRefName})`);
  }

  // Locate and remove worktree for this branch if present
  const wtList = run('git', ['worktree', 'list', '--porcelain']).split('\n\n');
  const mainCheckout = '/var/shared/repos/flight3d';
  for (const block of wtList) {
    const lines = block.trim().split('\n');
    const wtPath = lines.find(l => l.startsWith('worktree '))?.slice(9);
    const wtBranch = lines.find(l => l.startsWith('branch refs/heads/'))?.slice(18);
    if (wtPath && wtPath !== mainCheckout && wtBranch === pr.headRefName) {
      const status = tryRun('git', ['-C', wtPath, 'status', '--porcelain']);
      if (status.ok && status.out === '') {
        tryRun('git', ['-C', mainCheckout, 'worktree', 'remove', '--force', wtPath]);
        console.log(`✔ Removed worktree: ${wtPath}`);
      } else {
        console.warn(`! Preserved dirty worktree: ${wtPath}`);
      }
    }
  }
  tryRun('git', ['-C', mainCheckout, 'fetch', 'origin', '--prune']);
  tryRun('git', ['-C', mainCheckout, 'branch', '-d', pr.headRefName]);
  const mainStatus = tryRun('git', ['-C', mainCheckout, 'status', '--porcelain']);
  if (mainStatus.ok && mainStatus.out === '') {
    tryRun('git', ['-C', mainCheckout, 'merge', '--ff-only', 'origin/main']);
    console.log(`✔ Fast-forwarded shared checkout (${mainCheckout}) to origin/main`);
  }
}

const [, , action, firstArg, ...rest] = process.argv;
if (action === 'wt:new') cmdWtNew(firstArg, rest[0]);
else if (action === 'pr:arc') cmdPrArc(firstArg?.startsWith('--') ? null : firstArg, firstArg?.startsWith('--') ? [firstArg, ...rest] : rest);
else if (action === 'pr:mac') cmdPrMac(firstArg);
else {
  console.error('Usage: node scripts/agent-workflow.mjs <wt:new|pr:arc|pr:mac> [args]');
  process.exit(1);
}

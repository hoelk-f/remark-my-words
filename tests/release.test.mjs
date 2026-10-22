import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs, chooseVersion, runRelease, waitForRelease, ensureReleaseDraft, MAINTAINER } from '../scripts/release.mjs';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout.trim();
}
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rmw-release-test-'));
  const remote = path.join(dir, 'remote.git'), root = path.join(dir, 'working');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', remote, root);
  git(root, 'config', 'user.name', MAINTAINER.name);
  git(root, 'config', 'user.email', MAINTAINER.email);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0 — prepared for initial release\n\n- Initial features.\n');
  writeFileSync(path.join(root, 'sample.txt'), 'original\n');
  git(root, 'add', '--all'); git(root, 'commit', '-m', 'Initial'); git(root, 'push', 'origin', 'main');
  const initial = git(root, 'rev-parse', 'HEAD'), calls = [];
  const github = { login: MAINTAINER.login, releases: new Map(), commands: [] };
  const io = {
    git: (...args) => git(root, ...args),
    gitRun: (...args) => git(root, ...args),
    gh: (...args) => {
      if (args[0] === 'api' && args[1] === 'user') return JSON.stringify({login: github.login});
      if (args[0] === 'api' && args[1].includes('/releases?')) return JSON.stringify([[...github.releases.values()]]);
      if (args[0] === 'release' && args[1] === 'view') {
        const release = github.releases.get(args[2]);
        return JSON.stringify({author: release.author, isDraft: release.draft});
      }
      throw new Error(`Unexpected GitHub read: ${args}`);
    },
    ghRun: (...args) => {
      assert.equal(args[0], 'release'); assert.equal(args[1], 'create');
      assert.ok(args.includes('--verify-tag') && args.includes('--draft'));
      assert.equal(git(remote, 'rev-parse', `refs/tags/${args[2]}^{commit}`), git(root, 'rev-parse', 'HEAD'), 'A draft is created only after the matching tag is pushed');
      github.commands.push(args);
      github.releases.set(args[2], {tag_name: args[2], draft: true, author: {login: github.login}});
    },
    isAncestor: (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], {cwd: root}).status === 0,
    npm: (...args) => {
      calls.push(args);
      if (args[0] === 'version') {
        const pkg = json(path.join(root, 'package.json')); pkg.version = args[1];
        writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
      }
    },
    log() {},
  };
  const deps = {root, io, expectedOrigin: remote, wait: async (version, sha) => {
    assert.equal(git(remote, 'rev-parse', `refs/tags/${version}^{commit}`), sha);
    assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), sha);
  }};
  return {dir, remote, root, initial, calls, io, deps, github};
}

test('argument parsing and semantic version selection', () => {
  assert.equal(parseArgs([]).version, 'auto');
  assert.equal(parseArgs([], {npm_config_dry_run: 'true'}).dryRun, true);
  assert.equal(parseArgs(['0.1.0'], {npm_config_resume: 'true'}).resume, true);
  assert.equal(parseArgs([], {npm_config_wait: ''}).wait, false);
  assert.throws(() => parseArgs([], {npm_config_resume: 'true'}), /exact version/);
  assert.equal(parseArgs(['minor', '--no-wait']).wait, false);
  assert.equal(parseArgs(['0.1.0', '--resume']).resume, true);
  assert.throws(() => parseArgs(['--resume']), /exact version/);
  assert.throws(() => parseArgs(['v0.1.0']), /Unknown/);
  assert.throws(() => parseArgs(['patch', 'minor']), /Unknown/);
  assert.equal(chooseVersion('0.1.0', 'auto', new Set()), '0.1.0');
  assert.equal(chooseVersion('0.1.0', 'auto', new Set(['0.1.0'])), '0.1.1');
  assert.equal(chooseVersion('1.9.9', 'minor', new Set()), '1.10.0');
  assert.equal(chooseVersion('1.9.9', 'major', new Set()), '2.0.0');
  assert.throws(() => chooseVersion('1.2.0', '1.1.9', new Set()), /lower/);
});

test('dry run leaves local files, refs, index and remote unchanged', async () => {
  const f = fixture();
  writeFileSync(path.join(f.root, 'sample.txt'), 'uncommitted\n');
  const status = git(f.root, 'status', '--porcelain');
  await runRelease(parseArgs(['--dry-run']), f.deps);
  assert.equal(git(f.root, 'status', '--porcelain'), status);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.initial);
  assert.equal(git(f.remote, 'rev-parse', 'main'), f.initial);
  assert.equal(git(f.root, 'tag'), ''); assert.equal(f.calls.length, 0);
  assert.equal(f.github.commands.length, 0, 'Preview never creates a release draft');
});

test('wrong GitHub account or effective Git identity stops before any changes', async () => {
  for (const wrong of ['account', 'author', 'committer']) {
    const f = fixture();
    if (wrong === 'account') f.github.login = 'someone-else';
    else {
      const read = f.io.git;
      f.io.git = (...args) => args[0] === 'var' && args[1] === `GIT_${wrong.toUpperCase()}_IDENT`
        ? 'Unexpected <unexpected@example.invalid> 123456 +0000' : read(...args);
    }
    await assert.rejects(runRelease(parseArgs([]), f.deps), /Sign in|Configure this repository/);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.initial);
    assert.equal(git(f.remote, 'rev-parse', 'main'), f.initial);
    assert.equal(git(f.root, 'status', '--porcelain'), '');
    assert.equal(f.github.commands.length, 0); assert.equal(f.calls.length, 0);
  }
});

test('first release and automatic patch include work and push matching annotated tag', async () => {
  const f = fixture();
  writeFileSync(path.join(f.root, 'sample.txt'), 'ready\n');
  assert.equal((await runRelease(parseArgs([]), f.deps)).version, '0.1.0');
  assert.equal(git(f.root, 'cat-file', '-t', '0.1.0'), 'tag');
  assert.equal(git(f.remote, 'show', 'main:sample.txt'), 'ready');
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(git(f.root, 'log', '-1', '--format=%an <%ae>'), `${MAINTAINER.name} <${MAINTAINER.email}>`);
  assert.equal(f.github.releases.get('0.1.0').author.login, 'hoelk-f');
  assert.deepEqual(f.calls.filter(args => args[0] === 'run').map(args => args[1]), ['lint', 'typecheck', 'test', 'test:release', 'test:browser', 'test:build', 'package:release']);
  assert.match(readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8'), /## 0\.1\.0 — \d{4}-\d{2}-\d{2}/);
  assert.equal((await runRelease(parseArgs([]), f.deps)).version, '0.1.1');
  assert.equal(json(path.join(f.root, 'package.json')).version, '0.1.1');
});

test('draft creation failure preserves the pushed tag and resume creates exactly one maintainer draft', async () => {
  const f = fixture(), create = f.io.ghRun;
  f.io.ghRun = () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(runRelease(parseArgs([]), f.deps), /already pushed.*draft could not be prepared/);
  const sha = git(f.remote, 'rev-parse', 'refs/tags/0.1.0^{commit}');
  f.io.ghRun = create;
  await runRelease(parseArgs(['0.1.0', '--resume']), f.deps);
  await runRelease(parseArgs(['0.1.0', '--resume']), f.deps);
  assert.equal(f.github.commands.length, 1);
  assert.equal(git(f.remote, 'rev-parse', 'refs/tags/0.1.0^{commit}'), sha);
});

test('drafts from another account are rejected and existing public releases stay unchanged', () => {
  const f = fixture();
  const release = {tag_name: '0.1.0', draft: true, author: {login: 'github-actions[bot]'}};
  f.github.releases.set('0.1.0', release);
  assert.throws(() => ensureReleaseDraft('0.1.0', f.io), /belongs to github-actions\[bot\]/);
  release.draft = false;
  ensureReleaseDraft('0.1.0', f.io);
  assert.equal(f.github.commands.length, 0);
});

test('release-list failures never trigger speculative draft creation', () => {
  const f = fixture(), read = f.io.gh;
  f.io.gh = (...args) => { if (args[1].includes('/releases?')) throw new Error('API unavailable'); return read(...args); };
  assert.throws(() => ensureReleaseDraft('0.1.0', f.io), /API unavailable/);
  assert.equal(f.github.commands.length, 0);
});

test('failed checks create no tag and push nothing', async () => {
  const f = fixture(); const npm = f.io.npm;
  f.io.npm = (...args) => { if (args[1] === 'test:browser') throw new Error('Browser failed'); npm(...args); };
  await assert.rejects(runRelease(parseArgs([]), f.deps), /Browser failed/);
  assert.equal(git(f.root, 'tag'), '');
  assert.equal(git(f.remote, 'rev-parse', 'main'), f.initial);
});

test('atomic push rejection preserves remote and supports resume', async () => {
  const f = fixture();
  const hook = path.join(f.remote, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n', {mode: 0o755});
  await assert.rejects(runRelease(parseArgs([]), f.deps), /Push failed/);
  assert.equal(git(f.remote, 'rev-parse', 'main'), f.initial);
  assert.equal(git(f.remote, 'tag'), '');
  assert.equal(git(f.root, 'tag'), '0.1.0');
  unlinkSync(hook);
  assert.equal((await runRelease(parseArgs(['0.1.0', '--resume']), f.deps)).resumed, true);
  await assert.rejects(runRelease(parseArgs(['current']), f.deps), /already exists/);
});

test('remote updates merge without losing either side; conflicts preserve checkpoint', async () => {
  for (const conflict of [false, true]) {
    const f = fixture(); const other = path.join(f.dir, 'other');
    git(f.dir, 'clone', f.remote, other);
    git(other, 'config', 'user.name', 'Other test'); git(other, 'config', 'user.email', 'other@example.invalid');
    writeFileSync(path.join(other, conflict ? 'sample.txt' : 'remote.txt'), 'remote work\n');
    git(other, 'add', '--all'); git(other, 'commit', '-m', 'Remote work'); git(other, 'push', 'origin', 'main');
    const remoteHead = git(f.remote, 'rev-parse', 'main');
    writeFileSync(path.join(f.root, 'sample.txt'), 'local work\n');
    if (conflict) {
      await assert.rejects(runRelease(parseArgs([]), f.deps), /preserved in a checkpoint/);
      assert.equal(git(f.remote, 'rev-parse', 'main'), remoteHead);
      assert.equal(git(f.root, 'tag'), '');
      assert.equal(git(f.root, 'status', '--porcelain'), '');
      assert.equal(readFileSync(path.join(f.root, 'sample.txt'), 'utf8').trim(), 'local work');
    } else {
      await runRelease(parseArgs([]), f.deps);
      assert.equal(git(f.remote, 'show', 'main:sample.txt'), 'local work');
      assert.equal(git(f.remote, 'show', 'main:remote.txt'), 'remote work');
    }
  }
});

test('publication polling requires all uploaded assets, reports failed workflows and timeout', async () => {
  const release = {draft: false, prerelease: false, html_url: 'https://example.invalid/release', assets: ['main.js', 'manifest.json', 'styles.css'].map(name => ({name, state: 'uploaded', size: 10}))};
  let polls = 0;
  const response = body => ({status: 200, ok: true, json: async () => body});
  const published = await waitForRelease('0.1.0', 'sha', {
    fetcher: async url => response(url.includes('/runs?') ? {workflow_runs: []} : ++polls === 1 ? {...release, assets: []} : release),
    sleep: async () => {}, log() {},
  });
  assert.equal(polls, 2); assert.equal(published, release.html_url);
  await assert.rejects(waitForRelease('0.1.0', 'sha', {
    fetcher: async url => url.includes('/runs?') ? response({workflow_runs: [{head_branch: '0.1.0', status: 'completed', conclusion: 'failure', html_url: 'https://example.invalid/run'}]}) : {status: 404},
    sleep: async () => {}, log() {},
  }), /workflow failed/);
  await assert.rejects(waitForRelease('0.1.0', 'sha', {timeout: 0}), /Timed out/);
});


test('missing workflow stops with recovery instructions; manual recovery is recognized', async () => {
  const response = body => ({status: 200, ok: true, json: async () => body});
  await assert.rejects(waitForRelease('0.1.0', 'sha', {
    workflowStartTimeout: 0,
    fetcher: async url => url.includes('/runs?') ? response({workflow_runs: []}) : {status: 404},
    log() {},
  }), /No release workflow started.*Run workflow/);
  await assert.rejects(waitForRelease('0.1.0', 'sha', {
    workflowStartTimeout: 0,
    fetcher: async url => url.includes('/runs?') ? response({workflow_runs: [{event: 'workflow_dispatch', head_branch: 'main', head_sha: 'different-workflow-commit', display_title: 'Publish release 0.1.0', status: 'completed', conclusion: 'failure', html_url: 'https://example.invalid/manual-run'}]}) : {status: 404},
    log() {},
  }), /workflow failed/);
});

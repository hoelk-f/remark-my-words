import { spawnSync } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'hoelk-f/remark-my-words';
export const MAINTAINER = { login: 'hoelk-f', name: 'Florian Hölken', email: 'hoelken.florian@web.de' };
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const assets = ['main.js', 'manifest.json', 'styles.css'];
const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

export function parseArgs(argv, env = {}) {
  const options = { version: 'auto', dryRun: false, resume: false, wait: true, help: false };
  // npm.ps1 can consume flags and expose them as npm_config_* instead.
  options.dryRun = env.npm_config_dry_run === 'true';
  options.resume = env.npm_config_resume === 'true';
  options.help = env.npm_config_help === 'true';
  if (env.npm_config_wait === '' || env.npm_config_wait === 'false') options.wait = false;
  let positional = false;
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--no-wait') options.wait = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!positional && (['auto', 'current', 'patch', 'minor', 'major'].includes(arg) || VERSION.test(arg))) {
      options.version = arg; positional = true;
    } else throw new Error(`Unknown argument: ${arg}. Use npm run release -- --help.`);
  }
  if (options.resume && !VERSION.test(options.version)) throw new Error('--resume requires an exact version, e.g. npm run release -- 0.1.0 --resume');
  return options;
}

export function chooseVersion(current, requested, remoteTags) {
  if (!VERSION.test(current)) throw new Error(`Invalid package version: ${current}`);
  const kind = requested === 'auto' ? (remoteTags.has(current) ? 'patch' : 'current') : requested;
  if (kind === 'current') return current;
  if (VERSION.test(kind)) {
    const previous = current.split('.').map(BigInt), next = kind.split('.').map(BigInt);
    const first = next.findIndex((value, i) => value !== previous[i]);
    if (first >= 0 && next[first] < previous[first]) throw new Error('Release version cannot be lower than the current package version.');
    return kind;
  }
  const numbers = current.split('.').map(BigInt);
  const index = { major: 0, minor: 1, patch: 2 }[kind];
  if (index === undefined) throw new Error(`Invalid version increment: ${kind}`);
  numbers[index]++;
  for (let i = index + 1; i < 3; i++) numbers[i] = 0n;
  return numbers.join('.');
}

function runner(root) {
  function execute(command, args, capture = false, allowed = [0]) {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (!allowed.includes(result.status)) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status}).${capture ? '\n' + (result.stderr || result.stdout || '') : ''}`);
    return capture ? result.stdout.trim() : result.status;
  }
  return {
    git: (...args) => execute('git', args, true),
    gitRun: (...args) => execute('git', args),
    gh: (...args) => execute('gh', args, true),
    ghRun: (...args) => execute('gh', args),
    isAncestor: (first, second) => execute('git', ['merge-base', '--is-ancestor', first, second], false, [0, 1]) === 0,
    npm: (...args) => {
      const cli = process.env.npm_execpath;
      if (!cli) throw new Error('Start this script through npm run release so the npm executable can be located on every platform.');
      execute(process.execPath, [cli, ...args]);
    },
    log: message => console.log(message),
  };
}

export function assertReleaseIdentity(io) {
  const account = JSON.parse(io.gh('api', 'user'));
  if (account.login !== MAINTAINER.login) throw new Error(`Sign in to GitHub CLI as ${MAINTAINER.login} before releasing (current account: ${account.login}).`);
  const expected = `${MAINTAINER.name} <${MAINTAINER.email}> `;
  for (const field of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    if (!io.git('var', field).startsWith(expected)) throw new Error(`Configure this repository's Git name/email as ${MAINTAINER.name} <${MAINTAINER.email}> and remove conflicting author/committer environment overrides before releasing.`);
  }
}

export function ensureReleaseDraft(version, io) {
  // Fetch the list with authentication: it includes drafts and does not confuse
  // authentication/network failures with a release that does not exist.
  const releases = JSON.parse(io.gh('api', `repos/${REPOSITORY}/releases?per_page=100`, '--paginate', '--slurp')).flat();
  const release = releases.find(release => release.tag_name === version);
  if (release) {
    if (release.draft && release.author?.login !== MAINTAINER.login) throw new Error(`The draft for ${version} belongs to ${release.author?.login}, not ${MAINTAINER.login}. Keep the existing tag and correct the draft before retrying.`);
    return;
  }
  assertReleaseIdentity(io);
  io.ghRun('release', 'create', version, '--repo', REPOSITORY, '--verify-tag', '--draft', '--title', `Remark My Words ${version}`, '--generate-notes');
  const created = JSON.parse(io.gh('release', 'view', version, '--repo', REPOSITORY, '--json', 'author,isDraft'));
  if (!created.isDraft || created.author?.login !== MAINTAINER.login) throw new Error(`The release draft must belong to ${MAINTAINER.login}. Publication has not been confirmed.`);
  io.log(`Release draft created by ${MAINTAINER.login}; GitHub Actions will verify and publish its assets.`);
}

function prepareReleaseDraft(version, io) {
  try { ensureReleaseDraft(version, io); }
  catch (error) { throw new Error(`The tag ${version} is already pushed, but its release draft could not be prepared. Keep the tag, fix the cause, and run npm run release -- ${version} --resume. ${error.message}`); }
}

async function assertNoOperation(root, io) {
  if (io.git('diff', '--name-only', '--diff-filter=U')) throw new Error('Resolve existing Git conflicts before releasing.');
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const file = path.resolve(root, io.git('rev-parse', '--git-path', name));
    let present = true;
    try { await access(file); } catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
    if (present) throw new Error(`Finish the existing Git operation (${name}) before releasing.`);
  }
}

async function updateChangelog(root, version) {
  const file = path.join(root, 'CHANGELOG.md');
  let text = await readFile(file, 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  const prepared = `## ${version} — prepared for initial release`;
  if (text.includes(prepared)) {
    text = text.replace(prepared, `## ${version} — ${date}`).replace(/\nThis entry describes the prepared version;[^]*$/, '\n');
  } else if (/^## \[?Unreleased\]?\s*$/m.test(text)) {
    text = text.replace(/^## \[?Unreleased\]?\s*$/m, `## ${version} — ${date}`);
  } else if (!text.includes(`## ${version} `) && !text.includes(`## ${version}\n`)) {
    text = text.replace(/^(# Changelog\r?\n)/, `$1\n## ${version} — ${date}\n\n- See the GitHub release notes for the included changes.\n`);
  }
  await writeFile(file, text);
}

export async function waitForRelease(version, sha, { fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 15 * 60_000, workflowStartTimeout = 3 * 60_000, now = Date.now, log = console.log } = {}) {
  const base = `https://api.github.com/repos/${REPOSITORY}`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'remark-my-words-release' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  async function get(endpoint) {
    const response = await fetcher(base + endpoint, { headers, signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}. Check https://github.com/${REPOSITORY}/actions and resume with npm run release -- ${version} --resume. GH_TOKEN can be used if the anonymous API limit was reached.`);
    return response.json();
  }
  const started = now();
  let attempt = 0;
  while (now() - started < timeout) {
    const release = await get(`/releases/tags/${version}`);
    if (release && !release.draft && !release.prerelease && assets.every(name => release.assets?.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0))) {
      log(`Published: ${release.html_url}`);
      log(`Next: sign in at https://community.obsidian.md, connect GitHub, and submit ${REPOSITORY}.`);
      return release.html_url;
    }
    // Avoid using the public API's hourly allowance on two requests per poll.
    if (attempt++ % 3 === 0) {
      const runs = await get(`/actions/workflows/release.yml/runs?per_page=30`);
      const run = runs?.workflow_runs?.find(run =>
        (run.event === 'workflow_dispatch' && run.display_title === `Publish release ${version}`) ||
        (run.head_branch === version && (!run.head_sha || run.head_sha === sha)));
      if (!run && now() - started >= workflowStartTimeout) throw new Error(`No release workflow started for ${version}. The tag exists, but a tag alone is not a published release. Open https://github.com/${REPOSITORY}/actions/workflows/release.yml, choose Run workflow on main, and enter version ${version}. Keep the existing tag; do not create another version just to retry publication.`);
      if (run?.status === 'completed' && run.conclusion !== 'success') throw new Error(`The release workflow failed (${run.conclusion}): ${run.html_url}. Nothing was reported as published. Fix the failure or rerun the workflow, then use npm run release -- ${version} --resume.`);
    }
    log(`Waiting for GitHub to publish ${version} (checks, build, and asset upload)...`);
    await sleep(30_000);
  }
  throw new Error(`Timed out waiting for ${version}. The push may have succeeded; do not recreate the tag. Check https://github.com/${REPOSITORY}/actions or run npm run release -- ${version} --resume.`);
}

export async function runRelease(options, { root = fileURLToPath(new URL('../', import.meta.url)), io = runner(root), expectedOrigin, wait = waitForRelease } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or later is required.');
  if (io.git('branch', '--show-current') !== 'main') throw new Error('Switch to main before releasing.');
  const remote = io.git('remote', 'get-url', '--push', 'origin');
  const accepted = expectedOrigin ? remote === expectedOrigin : [`https://github.com/${REPOSITORY}.git`, `https://github.com/${REPOSITORY}`, `git@github.com:${REPOSITORY}.git`, `ssh://git@github.com/${REPOSITORY}.git`].includes(remote);
  if (!accepted) throw new Error(`Unexpected origin: ${remote}. Expected the Remark My Words repository.`);
  await assertNoOperation(root, io);
  if (!io.git('config', 'user.name') || !io.git('config', 'user.email')) throw new Error('Configure Git user.name and user.email first.');
  assertReleaseIdentity(io);
  const refs = io.git('ls-remote', '--tags', 'origin');
  const remoteTags = new Set([...refs.matchAll(/refs\/tags\/([^\s^]+)(?:\^\{\})?/g)].map(match => match[1]));
  const pkg = await readJson(path.join(root, 'package.json'));
  let version = options.resume ? options.version : chooseVersion(pkg.version, options.version, remoteTags);
  io.log(`Release ${version} to ${REPOSITORY}. All non-ignored working changes will be included.`);
  if (options.dryRun) {
    io.log(io.git('status', '--short', '--untracked-files=normal'));
    io.log('Plan: verify hoelk-f Git/CLI identity -> fetch -> checkpoint local changes if needed -> merge origin/main -> sync version/changelog -> npm ci -> typecheck/tests/browser tests/build -> commit -> annotated tag -> atomic push of main and tag -> create draft as hoelk-f -> automatic verified publication.');
    io.log('Dry run finished. No files, commits, tags, or remote refs were changed.');
    return { version, dryRun: true };
  }
  // Merge, never force-push or discard remote commits.
  io.gitRun('fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '--tags');
  if (options.resume) {
    if (io.git('status', '--porcelain')) throw new Error('Resume requires a clean working tree. Commit new work separately or publish a new version.');
    const head = io.git('rev-parse', 'HEAD');
    if (io.git('rev-parse', `refs/tags/${version}^{commit}`) !== head || pkg.version !== version) throw new Error('Resume requires HEAD and package.json to match the existing release tag.');
    io.gitRun('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${version}:refs/tags/${version}`);
    prepareReleaseDraft(version, io);
    if (options.wait) await wait(version, head);
    return { version, resumed: true };
  }
  const existingTags = new Set(io.git('tag', '--list').split(/\r?\n/));
  if (remoteTags.has(version) || existingTags.has(version)) throw new Error(`Tag ${version} already exists. Use a new version or npm run release -- ${version} --resume after an interrupted push.`);
  if (!io.isAncestor('origin/main', 'HEAD')) {
    if (io.git('status', '--porcelain')) {
      io.gitRun('add', '--all');
      io.gitRun('commit', '-m', 'Checkpoint local work before release synchronization');
    }
    try { io.gitRun('merge', '--no-edit', 'origin/main'); }
    catch (error) {
      try { io.gitRun('merge', '--abort'); } catch { /* Keep Git's conflict details if abort is unavailable. */ }
      throw new Error(`Could not merge origin/main automatically. Local work is preserved in a checkpoint commit; no release was pushed. Resolve the branch divergence and rerun. ${error.message}`);
    }
    // The merge may have updated the package version.
    version = chooseVersion((await readJson(path.join(root, 'package.json'))).version, options.version, remoteTags);
    if (existingTags.has(version)) throw new Error(`Tag ${version} already exists after synchronization; choose a new version.`);
  }
  io.npm('version', version, '--no-git-tag-version', '--allow-same-version');
  await updateChangelog(root, version);
  io.npm('ci', '--no-audit', '--no-fund');
  for (const script of ['lint', 'typecheck', 'test', 'test:release', 'test:browser', 'test:build', 'package:release']) io.npm('run', script);
  io.gitRun('add', '--all');
  assertReleaseIdentity(io);
  if (io.git('diff', '--cached', '--name-only')) io.gitRun('commit', '-m', `Release ${version}`);
  const sha = io.git('rev-parse', 'HEAD');
  io.gitRun('tag', '-a', version, '-m', `Remark My Words ${version}`);
  try {
    // https://git-scm.com/docs/git-push : either both refs update or neither does.
    io.gitRun('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${version}:refs/tags/${version}`);
  } catch (error) {
    throw new Error(`Push failed. The local commit and tag ${version} were kept. Resolve the push problem, then run npm run release -- ${version} --resume. ${error.message}`);
  }
  io.log(`Pushed ${version}. Workflow: https://github.com/${REPOSITORY}/actions/workflows/release.yml`);
  prepareReleaseDraft(version, io);
  if (options.wait) await wait(version, sha);
  return { version, sha };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), process.env);
    if (options.help) console.log(`Preview: npm run release:preview\nUsage: npm run release -- [auto|current|patch|minor|major|x.y.z] [--dry-run] [--no-wait]\n       npm run release -- x.y.z --resume\n\nDefault: publish the current version if unreleased, otherwise bump patch.\nIncludes all non-ignored changes, creates commits/tags, pushes, creates a draft as hoelk-f, and publishes via GitHub Actions.\nRequires Node 22+, GitHub CLI signed in as hoelk-f, the maintainer Git identity, Git push access, and a Chromium browser.\n--dry-run previews without mutations; --resume retries a push, prepares a missing draft, or waits for an existing tag.`);
    else await runRelease(options);
  } catch (error) { console.error(`\nRelease stopped: ${error.message}`); process.exitCode = 1; }
}

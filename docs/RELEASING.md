# Releasing Remark My Words

## Publish with one command

From the project folder on `main`, run:

```sh
npm run release
```

The first run releases the current version (`0.1.0`). Later runs increment the
patch version if the current version already has a remote tag, for example
`0.1.0` to `0.1.1`. All non-ignored local changes are included in the release
commit, including staged files, new files, and deletions. Review your changes
before running it. A real run publishes the plugin publicly on GitHub.

The script:

1. Checks the branch, repository URL, Git identity, and unfinished Git operations.
2. Fetches the remote. If necessary, checkpoints local work and merges `origin/main`. Conflicts stop the release without pushing; the checkpoint preserves local work.
3. Updates `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and the changelog. Add release details under `## Unreleased` beforehand; otherwise a version entry links readers to the generated GitHub notes.
4. Installs locked dependencies, runs the official Obsidian linter, typechecking, model tests, release integration tests, browser tests, reproducibility tests, and the production build.
5. Commits the result and creates an annotated tag matching the manifest version, with no `v` prefix.
6. Pushes `main` and the tag atomically, so either both remote refs update or neither does.
7. Waits for the **Publish release** GitHub Action to repeat the checks and publish `main.js`, `manifest.json`, and `styles.css`. The Action verifies that the build matches committed main.js, creates GitHub provenance attestations, and uploads and checks all assets before making the release public.
8. Prints the published release URL and the Obsidian Community submission link.

No local GitHub CLI or personal access token is required. Git uses your existing
GitHub authentication; Actions uses its built-in `GITHUB_TOKEN`.

### Prerequisites

- Node.js 22 or newer, npm, and Git with your author name/email configured.
- Push access to `hoelk-f/remark-my-words`, including permission to update workflows. Branch/tag protection must allow this maintainer-driven release flow; the script never force-pushes.
- GitHub Actions enabled for the repository. The workflow requests `contents: write`; organization policies must permit release creation.
- Microsoft Edge on Windows, or a Chromium browser configured through `BROWSER_PATH` for the browser tests. On macOS/Linux, set this to the actual browser executable.
- A public repository for Community installation and anonymous release polling. An optional `GH_TOKEN` can authenticate polling if GitHub's anonymous API limit has been reached.

### Preview and version options

```sh
npm run release:preview
npm run release -- minor
npm run release -- major
npm run release -- 1.0.0
npm run release -- --no-wait
```

`--dry-run` reads Git state and remote tags, then prints the plan. It changes no
files or refs and does not run build checks. A version changed by a subsequent
merge is recalculated during the real run. `--no-wait` exits after pushing;
publication continues in Actions, and that command's success alone does not mean
the release has been published.

### Recover from a failure

- **Checks fail before tagging:** fix the issue and rerun `npm run release`. Version/changelog edits remain available for inspection.
- **Merge conflicts:** the attempted merge is aborted. Your work is retained in a checkpoint commit. Merge `origin/main`, resolve the conflicts, commit, and rerun.
- **Push fails after tagging:** keep the existing tag, resolve authentication or remote divergence, and use the resume command below if HEAD still matches the tag. A changed release commit needs a new version; the script does not move published tags.
- **No release workflow starts:** open **Actions > Publish release > Run workflow**, leave the branch on `main`, and enter the existing tag (for example `0.1.0`). The recovery workflow checks out that exact tag and publishes its assets. Keep the tag unchanged. The script reports a missing workflow after three minutes rather than waiting the full timeout.
- **Actions fails:** inspect the linked workflow run and use GitHub's **Re-run failed jobs** for transient errors. Source fixes require a new release version. Draft assets can be retried; existing public release assets are never overwritten.
- **Polling times out:** the workflow may still succeed. Check Actions or resume waiting with the exact version:

```sh
npm run release -- 0.1.0 --resume
```

Resume requires a clean working tree, HEAD matching the existing tag, and the
same package version. It retries the atomic push and waits; it does not bump the
version, create another commit, or retrigger an already-pushed tag workflow.
Waiting stops after 15 minutes. Test fixtures are isolated in the system temp
folder and never contact the production repository.

## Before the first public release

Test the built plugin in actual Obsidian before running the publication command:

1. Run `npm run package:release` and install only `main.js`, `manifest.json`, and `styles.css` from `dist/remark-my-words/` into a test vault's `.obsidian/plugins/remark-my-words/` folder.
2. Check offline PDF loading, selection, creating/editing/deleting comments, hover previews, both modes, reopening annotations, document notes, multiple views, and disabling/re-enabling the plugin.
3. Check Windows, macOS, and Linux before claiming support for each platform. The minimum Obsidian version is `1.13.7`; browser tests do not certify that minimum in the Obsidian host. Mobile installation is enabled for user testing, with iOS/iPadOS `17.4` or later required by the bundled PDF renderer. Keep the mobile-testing qualification until the native apps have been verified, including text selection, the software keyboard, vault persistence, and touch gestures.
4. Review [Obsidian's developer policies](https://docs.obsidian.md/community-directory/developer-policies) and [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).

The PDF.js worker is bundled inside `main.js` because Obsidian's installer uses
these standard release assets. Keep `remark-my-words` as the stable plugin ID.
If you change the minimum app version, update `manifest.json` before releasing;
the version hook carries that value into `versions.json`.

## Submit to the Obsidian Community directory

The release script publishes on GitHub. It does not submit the Community listing
or bypass Obsidian's review. As checked on 2026-09-18, the documented route is:

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with an Obsidian account.
2. Connect your GitHub account so the directory can verify repository ownership.
3. Add `hoelk-f/remark-my-words`. The directory reads `manifest.json` from the default branch; it must agree with the published release.
4. Resolve automated review feedback. Publish a new version if code changes are required.
5. Complete publication in the directory so users can install the plugin from Obsidian.

After the initial directory publication, future updates use the same
`npm run release` command. You do not need a new initial submission per version.
This is a GitHub plugin release, not an npm package publication.

Official references: [submission walkthrough](https://docs.obsidian.md/plugins/releasing/submit-plugin),
[account setup and GitHub linking](https://docs.obsidian.md/community-directory/set-up-and-claim),
[manifest requirements](https://docs.obsidian.md/Reference/Manifest),
[Git atomic pushes](https://git-scm.com/docs/git-push), and
[GitHub release creation](https://cli.github.com/manual/gh_release_create).

# Backport Tracker

Tampermonkey userscript for GitHub pull requests. It adds a compact backport panel in the PR sidebar so you can quickly see which backport PRs exist, which ones are missing, and which open backports are blocked on CI versus waiting for manager approval.

## Features

- Shows a **Backports** panel on the original PR and an **Original PR** panel on backport PRs.
- Collects backport PRs from labels, comments, timeline cross-references, and a GitHub PR search fallback.
- Distinguishes open backport states as `FAIL`, `RUNNING`, `WAITING MA`, and `PASS`.
- Highlights missing backport PRs for labeled target branches.
- Shows approved / required approvals (for example `1/2`) on each open backport. The required count comes from the PR's "Review required" item and defaults to 2 when GitHub does not report it.
- Clicking the red `FAIL` icon opens a bubble that lists the failed checks, each linking to its CI results, plus a **Re-run failed jobs** button.
- Clicking the `RUNNING` dot opens a bubble that lists the checks still queued or in progress, each linking to its CI results. It does not re-run anything.
- Adds **Copy summary** and **Copy unmerged** actions for quick status sharing.
- Handles GitHub SPA navigation and sidebar re-renders without a full page refresh.

## Install

1. Install the Tampermonkey browser extension.
2. Open the raw script URL below.
3. Confirm installation in Tampermonkey.

Raw install URL:

`https://raw.githubusercontent.com/houmkh/tampermonkey-backport-tracker/master/backport-tracker.user.js`

## Status Meanings

- `FAIL`: at least one non-manager check failed.
- `RUNNING`: non-manager checks are still running.
- `WAITING MA`: all non-manager checks are done, but the manager approval check exists and is not approved yet.
- `PASS`: all required checks passed. If no manager approval check exists, this is also treated as pass.
- `MERGED`: the backport PR is already merged.
- `CLOSED`: the backport PR is closed without merge.
- `MISSING`: a backport label exists for a target branch, but no matching backport PR was found.

## How It Works

For original PRs, the script builds the backport list from multiple sources so it can survive GitHub UI changes and collapsed timeline items:

- sidebar labels such as `backport/...`
- PR links mentioned in comments
- timeline cross-reference events
- a repository PR search fallback

For each open backport PR, the script reads GitHub status checks and turns them into the user-facing states above.

## Copy Actions

- **Copy summary**: copies every discovered backport entry.
- **Copy unmerged**: copies only open backport PRs that are not merged or closed.

Copied lines look like this. Open PRs include approved / required approvals in parentheses:

```text
PR title
[WAITING MA] next/3.11.x (1/2): https://github.com/org/repo/pull/12345
[MERGED] next/3.10.x: https://github.com/org/repo/pull/12340
```

## Scope And Limits

- Works on `https://github.com/*/*/pull/*` pages.
- Does not currently infer whether a PR is still waiting for two code-review approvals.
- Relies on GitHub page markup and the status checks endpoint, so future GitHub UI changes may require script updates.

## Repository Files

- `backport-tracker.user.js`: the userscript itself.
- `backport-tracker-summary.md`: implementation notes and internal behavior summary.

## Release Workflow

This repository includes a manual GitHub Actions workflow named `Release Userscript`.

Use it from the GitHub web UI:

1. Open **Actions**.
2. Select **Release Userscript**.
3. Click **Run workflow** on the default branch.
4. Enter a version like `3.0.1`.
5. Optionally mark it as a prerelease.

The workflow will:

- update `@version` in `backport-tracker.user.js`
- commit the version bump to `master`
- create and push tag `v<version>`
- create a GitHub Release and attach the userscript file

Important:

- Tampermonkey updates are driven by the raw script URL on `master` plus the bumped `@version` value.
- Creating a GitHub Release alone does not update installed userscripts.
- If branch protection prevents GitHub Actions from pushing to `master`, you need to allow workflow pushes or keep the release process manual.

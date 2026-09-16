// ==UserScript==
// @name         Backport Tracker
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Track backport PR status; detect label/PR gaps; copy unmerged
// @author       Stella
// @match        https://github.com/*/*/pull/*
// @connect      github.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/houmkh/tampermonkey-backport-tracker/master/backport-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/houmkh/tampermonkey-backport-tracker/master/backport-tracker.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

GM_registerMenuCommand('Set GitHub PAT for CI restart', () => {
    const pat = prompt('Enter GitHub PAT (actions:write scope):');
    if (pat) GM_setValue('github_pat', pat);
});

(function () {
    'use strict';

    // backportData entries:
    //   { branch, hasLabel, hasPR, id, url, state, merged, closed, ciStatus, tooltip, jumpUrl, missing }
    let backportData = [];
    let lastUrl = "";
    let lastPrState = "";
    let lastPrContext = null;
    let isScanning = false;
    let initRetryTimer = null;
    let needsSectionRestore = false;
    let hovercardFetched = false; // reset on URL change; prevents repeated failing requests
    let lastScanSettled = false;
    const PREFIX = "[Backport Tracker]";
    const DEBUG = false;

    // =====================================================================
    // Icons
    // =====================================================================
    const OCTICONS = {
        check:  `<svg class="octicon color-fg-success" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`,
        x:      `<svg class="octicon color-fg-danger"  viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L9.06 8l3.22 3.22a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`,
        dot:    `<svg class="octicon color-fg-attention" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>`,
        shield: `<svg class="octicon color-fg-attention" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7.467.133a1.748 1.748 0 0 1 1.066 0l5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.13-.935 4.423-.49 1.03-1.151 1.888-1.858 2.534l-.006.006-.007.005a10.339 10.339 0 0 1-4.201 2.031l-.002.001a.752.752 0 0 1-.38 0l-.002-.001a10.339 10.339 0 0 1-4.201-2.03l-.007-.005-.006-.006c-.707-.646-1.368-1.503-1.858-2.534C.32 10.13 0 8.566 0 7V3.48c0-.712.428-1.353 1.083-1.566L6.333.234ZM8.457 1.61 3.207 3.29a.25.25 0 0 0-.154.226V7c0 1.189.24 2.453.758 3.543.376.792.903 1.488 1.516 2.048a9.138 9.138 0 0 0 2.673 1.583 9.138 9.138 0 0 0 2.673-1.583c.613-.56 1.14-1.256 1.516-2.048.518-1.09.758-2.354.758-3.543V3.516a.25.25 0 0 0-.154-.226L8.457 1.61Z"/></svg>`,
        sync:   `<svg class="octicon octicon-sync" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/></svg>`,
        alert:  `<svg class="octicon color-fg-danger" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M6.457 1.047c.659-1.232 2.427-1.232 3.086 0l6.03 11.27c.625 1.17-.221 2.583-1.543 2.583H1.97c-1.322 0-2.168-1.413-1.543-2.583l6.03-11.27zM8 5c-.552 0-1 .448-1 1v2c0 .552.448 1 1 1s1-.448 1-1V6c0-.552-.448-1-1-1zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>`,
        branch: `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" fill="currentColor"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"/></svg>`,
    };

    // =====================================================================
    // Utilities
    // =====================================================================
    function parseGithubUrl(url) {
        try {
            const u = new URL(url);
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length >= 4 && parts[2] === 'pull') {
                return { repo: `${parts[0]}/${parts[1]}`, prNumber: parts[3] };
            }
        } catch (e) {}
        return null;
    }

    function buildPullUrl(repo, prNumber) {
        return `https://github.com/${repo}/pull/${prNumber}`;
    }

    function hasBackportToken(value) {
        return /\bbackport\b/i.test(value || '');
    }

    function isBackportBaseBranch(branchName) {
        return /^next\//i.test(branchName || '') || /^ai-master$/i.test(branchName || '');
    }

    function findBranchNameInJsonScripts(rootDoc, fieldName) {
        for (const script of rootDoc.querySelectorAll('script[type="application/json"]')) {
            if (!script.textContent.includes(fieldName)) continue;
            try {
                const data = JSON.parse(script.textContent);
                let found = null;
                (function search(obj) {
                    if (found || !obj || typeof obj !== 'object') return;
                    if (typeof obj[fieldName] === 'string' && obj[fieldName]) { found = obj[fieldName]; return; }
                    for (const key in obj) {
                        if (Object.prototype.hasOwnProperty.call(obj, key)) search(obj[key]);
                    }
                })(data);
                if (found) return found;
            } catch (_) {}
        }

        return null;
    }

    function findBaseBranchInJsonScripts(rootDoc) {
        return findBranchNameInJsonScripts(rootDoc, 'baseRefName');
    }

    function findHeadBranchInJsonScripts(rootDoc) {
        return findBranchNameInJsonScripts(rootDoc, 'headRefName');
    }

    function findPrStateInJsonScripts(rootDoc, prNumber) {
        for (const script of rootDoc.querySelectorAll('script[type="application/json"]')) {
            if (!script.textContent.includes(prNumber)) continue;
            try {
                const data = JSON.parse(script.textContent);
                let found = null;
                (function search(obj) {
                    if (found || !obj || typeof obj !== 'object') return;
                    if (obj.pullRequest && String(obj.pullRequest.number) === String(prNumber) && obj.pullRequest.state) {
                        found = obj.pullRequest.state.toUpperCase();
                        return;
                    }
                    if (String(obj.number) === String(prNumber) && obj.state && typeof obj.state === 'string') {
                        if (obj.url && obj.url.includes(`/pull/${prNumber}`)) {
                            found = obj.state.toUpperCase();
                        }
                    }
                    for (const key in obj) {
                        if (Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === 'object') search(obj[key]);
                    }
                })(data);
                if (found) return found;
            } catch (_) {}
        }

        return null;
    }

    function findPrTitleInJsonScripts(rootDoc, prNumber) {
        for (const script of rootDoc.querySelectorAll('script[type="application/json"]')) {
            if (!script.textContent.includes(prNumber) || !script.textContent.includes('title')) continue;
            try {
                const data = JSON.parse(script.textContent);
                let found = null;
                (function search(obj) {
                    if (found || !obj || typeof obj !== 'object') return;
                    if (obj.pullRequest && String(obj.pullRequest.number) === String(prNumber) && typeof obj.pullRequest.title === 'string') {
                        found = obj.pullRequest.title.trim();
                        return;
                    }
                    if (String(obj.number) === String(prNumber) && typeof obj.title === 'string') {
                        if (obj.url && obj.url.includes(`/pull/${prNumber}`)) {
                            found = obj.title.trim();
                            return;
                        }
                    }
                    for (const key in obj) {
                        if (Object.prototype.hasOwnProperty.call(obj, key)) search(obj[key]);
                    }
                })(data);
                if (found) return found;
            } catch (_) {}
        }

        return null;
    }

    function findPrBranchInDoc(rootDoc, type) {
        const selector = type === 'base'
            ? '[data-testid="base-ref-name"], .base-ref, .commit-ref[title^="Base:"], .commit-ref[data-ref-type="base"]'
            : '[data-testid="head-ref-name"], .head-ref, .commit-ref[title^="Head:"], .commit-ref[title^="Compare:"], .commit-ref[data-ref-type="head"]';
        let branchEl = rootDoc.querySelector(selector);
        if (!branchEl) {
            const refs = rootDoc.querySelectorAll('.commit-ref');
            if (refs.length >= 2) branchEl = refs[type === 'base' ? 0 : 1];
        }

        if (branchEl) {
            return branchEl.textContent.trim().replace(/^(?:Base|Head|Compare):\s*/i, '');
        }

        return type === 'base' ? findBaseBranchInJsonScripts(rootDoc) : findHeadBranchInJsonScripts(rootDoc);
    }

    function findPrTitleInDoc(rootDoc, prNumber) {
        const titleEl = rootDoc.querySelector('.js-issue-title, [data-testid="issue-title"], .markdown-title');
        if (titleEl) {
            const title = titleEl.textContent.trim();
            if (title) return title;
        }

        return findPrTitleInJsonScripts(rootDoc, prNumber);
    }

    function isBackportPrCandidate(identity) {
        return hasBackportToken(identity?.title)
            || hasBackportToken(identity?.headBranch)
            || isBackportBaseBranch(identity?.baseBranch);
    }

    function getOpenPrStatusLabel(ciStatus) {
        if (ciStatus === 'test_fail') return 'FAIL';
        if (ciStatus === 'pending') return 'RUNNING';
        if (ciStatus === 'ma_pending') return 'WAITING MA';
        if (ciStatus === 'success') return 'PASS';
        if (ciStatus === 'error') return 'ERROR';
        if (ciStatus === 'fetching') return 'LOADING';
        return (ciStatus || 'PENDING').toUpperCase().replace(/_/g, ' ');
    }

    function getOpenPrStatusIcon(ciStatus) {
        if (ciStatus === 'fetching') return OCTICONS.sync.replace('octicon-sync', 'octicon-sync anim-rotate');
        if (ciStatus === 'test_fail') return OCTICONS.x;
        if (ciStatus === 'ma_pending') return OCTICONS.shield;
        if (ciStatus === 'success') return OCTICONS.check;
        if (ciStatus === 'error') return OCTICONS.alert;
        return OCTICONS.dot;
    }

    function getOpenPrStatusBadgeStyle(ciStatus) {
        const base = 'padding:1px 6px;border-radius:2em;font-size:0.85em;white-space:nowrap;';
        if (ciStatus === 'test_fail' || ciStatus === 'error') {
            return `${base}color:var(--color-danger-fg);border:1px solid var(--color-danger-emphasis);background:var(--color-danger-subtle);`;
        }
        if (ciStatus === 'ma_pending' || ciStatus === 'pending') {
            return `${base}color:var(--color-attention-fg);border:1px solid var(--color-attention-emphasis);background:var(--color-attention-subtle);`;
        }
        if (ciStatus === 'success') {
            return `${base}color:var(--color-success-fg);border:1px solid var(--color-success-emphasis);background:var(--color-success-subtle);`;
        }
        return `${base}color:var(--color-fg-muted);border:1px solid var(--color-border-default);background:var(--color-canvas-subtle);`;
    }

    function getPrContext() {
        const currentPr = parseGithubUrl(window.location.href);

        // Scope DOM lookups to the PR header to avoid matching branch refs that
        // appear in timeline events, linked backport PRs, or bot comments.
        const headerContainer = document.querySelector(
            '#partial-discussion-header, .gh-header-meta, ' +
            '[data-testid="pr-header"], [data-testid="base-head-compare"], ' +
            '.js-pull-request-ref-info'
        );
        const scope = headerContainer || document;

        let baseBranchEl = scope.querySelector(
            '[data-testid="base-ref-name"], ' +
            '.base-ref, ' +
            '.commit-ref[title^="Base:"], ' +
            '.commit-ref[data-ref-type="base"]'
        );
        if (!baseBranchEl) {
            // Fallback: GitHub renders base FIRST, head SECOND in the PR header.
            // Only use refs[0] once BOTH refs are present.
            const refs = scope.querySelectorAll('.commit-ref');
            if (refs.length >= 2) baseBranchEl = refs[0];
        }

        let branchName = baseBranchEl
            ? baseBranchEl.textContent.trim().replace(/^Base:\s*/i, '')
            : null;

        // Final fallback: GitHub embeds PR data as JSON in <script type="application/json">.
        // This is the most reliable source when the React UI changes break CSS selectors.
        if (!branchName) {
            for (const script of document.querySelectorAll('script[type="application/json"]')) {
                if (!script.textContent.includes('baseRefName')) continue;
                try {
                    const data = JSON.parse(script.textContent);
                    let found = null;
                    (function search(obj) {
                        if (found || !obj || typeof obj !== 'object') return;
                        if (typeof obj.baseRefName === 'string' && obj.baseRefName) { found = obj.baseRefName; return; }
                        for (const k in obj) {
                            if (Object.prototype.hasOwnProperty.call(obj, k)) search(obj[k]);
                        }
                    })(data);
                    if (found) { branchName = found; break; }
                } catch (_) {}
            }
        }

        if (!branchName) return null;

        const headBranch = findPrBranchInDoc(document, 'head');
        const title = currentPr ? findPrTitleInDoc(document, currentPr.prNumber) : null;
        const isBackport = isBackportPrCandidate({ title, headBranch, baseBranch: branchName });

        if (DEBUG) console.log(`${PREFIX} getPrContext: base="${branchName}" head="${headBranch}" titleHasBackport=${hasBackportToken(title)} headHasBackport=${hasBackportToken(headBranch)} baseIsBackportTarget=${isBackportBaseBranch(branchName)} → isBackport=${isBackport}`);

        return { isBackport, baseBranch: branchName };
    }

    // =====================================================================
    // Hovercard fallback for getPrContext().
    // GitHub's new React UI no longer embeds baseRefName in JSON script tags
    // or uses the old CSS selectors.  The hovercard endpoint always returns
    // a small HTML snippet that contains "{head} into {base}" branch text,
    // which we can parse reliably regardless of UI version.
    // =====================================================================
    async function getPrContextFromHovercard(repo, prNumber) {
        try {
            const resp = await fetch(
                `https://github.com/${repo}/pull/${prNumber}/hovercard`,
                { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
            );
            if (!resp.ok) return null;
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // GitHub hovercards use <bdi> for branch names: "{head} into {base}"
            const bdis = doc.querySelectorAll('bdi');
            let headBranch = bdis.length >= 1 ? bdis[0].textContent.trim() : null;
            let baseBranch = bdis.length >= 2 ? bdis[1].textContent.trim() : null;

            // Plain-text fallback: match " into branch-name"
            if (!headBranch || !baseBranch) {
                const m = doc.body.textContent.match(/\b([\w.\-\/]+)\s+into\s+([\w.\-\/]+)/);
                if (m) {
                    if (!headBranch) headBranch = m[1];
                    if (!baseBranch) baseBranch = m[2];
                }
            }

            // Older hovercard format uses .commit-ref elements
            if (!headBranch || !baseBranch) {
                const refs = doc.querySelectorAll('.commit-ref');
                if (refs.length >= 2) {
                    if (!baseBranch) baseBranch = refs[0].textContent.trim().replace(/^Base:\s*/i, '');
                    if (!headBranch) headBranch = refs[1].textContent.trim().replace(/^(?:Head|Compare):\s*/i, '');
                }
            }

            if (!baseBranch) return null;

            const title = findPrTitleInDoc(document, prNumber);
            const isBackport = isBackportPrCandidate({ title, headBranch, baseBranch });

            if (DEBUG) console.log(`${PREFIX} getPrContext (hovercard): base="${baseBranch}" head="${headBranch}" titleHasBackport=${hasBackportToken(title)} headHasBackport=${hasBackportToken(headBranch)} baseIsBackportTarget=${isBackportBaseBranch(baseBranch)} → isBackport=${isBackport}`);
            return { isBackport, baseBranch };
        } catch (_) {
            return null;
        }
    }

    // Recursively scan a status-check object for any GitHub Actions run ID,
    // regardless of which field it's nested under (targetUrl, detailsUrl, a
    // nested workflow-run object, ...) — GitHub's internal payload shape has
    // shifted across UI versions, so a single fixed field name is not reliable.
    function findWorkflowRunIdsInValue(value, seen = new Set()) {
        const found = [];
        if (typeof value === 'string') {
            const m = value.match(/\/actions\/runs\/(\d+)/);
            if (m) found.push(m[1]);
        } else if (value && typeof value === 'object') {
            if (seen.has(value)) return found;
            seen.add(value);
            for (const key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    found.push(...findWorkflowRunIdsInValue(value[key], seen));
                }
            }
        }
        return found;
    }

    // =====================================================================
    // Fetch PR state + CI status (unchanged from original)
    // =====================================================================
    async function getPrStatus(repo, prNumber) {
        const prUrl = `https://github.com/${repo}/pull/${prNumber}`;
        const isCurrentPage = window.location.pathname.endsWith(`/${repo}/pull/${prNumber}`);

        let doc = document;
        if (!isCurrentPage) {
            try {
                const resp = await fetch(prUrl, { headers: { "Accept": "text/html" } });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const html = await resp.text();
                doc = new DOMParser().parseFromString(html, 'text/html');
            } catch (e) {
                return {
                    state: 'ERROR', ciStatus: 'error', tooltip: `Fetch failed: ${e.message}`, jumpUrl: prUrl,
                    title: null, baseBranch: null, headBranch: null, isBackportPr: false,
                };
            }
        }

        let state = null;
        const title = findPrTitleInDoc(doc, prNumber);
        const baseBranch = findPrBranchInDoc(doc, 'base');
        const headBranch = findPrBranchInDoc(doc, 'head');

        // Extract base branch from the same HTML we already have — no extra fetch needed.
        // Used by callers checking backport PR targets.
        // Priority: DOM element → JSON script data (handles React-fetched HTML where elements may be absent)
        const headerBadge = isCurrentPage
            ? document.querySelector('#partial-discussion-header .State, .gh-header-meta [data-testid="state-badge"], [data-testid="state-badge"]')
            : doc.querySelector('#partial-discussion-header .State, .gh-header-meta [data-testid="state-badge"]');
        if (headerBadge) {
            const text = headerBadge.textContent.toLowerCase();
            if (text.includes('merged')) state = 'MERGED';
            else if (text.includes('closed')) state = 'CLOSED';
            else if (text.includes('open')) state = 'OPEN';
        }

        if (!state) {
            state = findPrStateInJsonScripts(doc, prNumber);
        }

        if (!state && !isCurrentPage) {
            try {
                const resp = await fetch(`${prUrl}/hovercard`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
                if (resp.ok) {
                    const hcHtml = await resp.text();
                    if (/Status:\s*Merged|State--merged|octicon-git-merge/i.test(hcHtml)) state = 'MERGED';
                    else if (/Status:\s*Closed|State--closed|octicon-issue-closed/i.test(hcHtml)) state = 'CLOSED';
                    else state = 'OPEN';
                }
            } catch (e) {}
        }

        if (!state) state = 'OPEN';

        let result = {
            state,
            merged: state === 'MERGED',
            closed: state === 'CLOSED',
            ciStatus: state === 'MERGED' ? 'success' : (state === 'CLOSED' ? 'closed' : 'pending'),
            jumpUrl: prUrl,
            tooltip: state.charAt(0) + state.slice(1).toLowerCase(),
            title,
            baseBranch,
            headBranch,
            isBackportPr: isBackportPrCandidate({ title, baseBranch, headBranch }),
        };

        if (state !== 'OPEN') return result;

        const clientVersionMeta = doc.querySelector('meta[name="expected-client-version"]');
        const clientVersion = clientVersionMeta ? clientVersionMeta.content : "";
        const fetchHeaders = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "github-is-react": "true",
            "github-verified-fetch": "true",
            "X-Requested-With": "XMLHttpRequest",
        };
        if (clientVersion) fetchHeaders["x-github-client-version"] = clientVersion;

        try {
            const apiResp = await fetch(`${prUrl}/page_data/status_checks`, { headers: fetchHeaders });
            if (!apiResp.ok) throw new Error(`HTTP ${apiResp.status}`);

            const jsonData = await apiResp.json();
            let foundChecks = [];
            let workflowRunIds = new Set();

            if (jsonData && Array.isArray(jsonData.statusChecks)) {
                jsonData.statusChecks.forEach(check => {
                    const st = check.conclusion || check.state || "";
                    if (check.displayName && st) {
                        foundChecks.push({ name: check.displayName.toLowerCase(), state: st.toUpperCase(), url: check.targetUrl || null });
                        // Run IDs can show up under different field names across GitHub UI
                        // versions (targetUrl, detailsUrl, nested workflow-run objects, ...),
                        // so scan every string in the check rather than one fixed field.
                        for (const runId of findWorkflowRunIdsInValue(check)) {
                            workflowRunIds.add(runId);
                        }
                    }
                });
            }

            result.workflowRunIds = [...workflowRunIds];

            if (foundChecks.length > 0) {
                let run = 0, fail = 0, pass = 0;
                let hasManagerCheck = false;
                let hasApprovedManagerCheck = false;
                let hasPendingManagerCheck = false;
                let testAttentionUrl = null, mgrJumpUrl = null;
                foundChecks.forEach(c => {
                    const isMgr = c.name.includes("manager approval");
                    const isPass = ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.state);
                    const isFail = ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(c.state);
                    if (isMgr) {
                        hasManagerCheck = true;
                        mgrJumpUrl = c.url || mgrJumpUrl;
                        if (isPass) hasApprovedManagerCheck = true;
                        else hasPendingManagerCheck = true;
                    } else {
                        if (isFail) {
                            fail++;
                            if (!testAttentionUrl && c.url) testAttentionUrl = c.url;
                        } else if (isPass) {
                            pass++;
                        } else {
                            run++;
                            if (!testAttentionUrl && c.url) testAttentionUrl = c.url;
                        }
                    }
                });

                const managerApproved = hasManagerCheck && hasApprovedManagerCheck && !hasPendingManagerCheck;
                const managerStatus = !hasManagerCheck ? 'Not required' : (managerApproved ? 'Approved' : 'Waiting MA');

                if (fail > 0) result.ciStatus = 'test_fail';
                else if (run > 0) result.ciStatus = 'pending';
                else if (hasManagerCheck && !managerApproved) result.ciStatus = 'ma_pending';
                else result.ciStatus = 'success';

                if (testAttentionUrl && testAttentionUrl.startsWith('/')) testAttentionUrl = `https://github.com${testAttentionUrl}`;
                if (mgrJumpUrl && mgrJumpUrl.startsWith('/')) mgrJumpUrl = `https://github.com${mgrJumpUrl}`;

                if (result.ciStatus === 'test_fail' || result.ciStatus === 'pending') {
                    result.jumpUrl = testAttentionUrl || prUrl;
                } else if (result.ciStatus === 'ma_pending') {
                    result.jumpUrl = mgrJumpUrl || prUrl;
                } else {
                    result.jumpUrl = prUrl;
                }

                result.tooltip = `${getOpenPrStatusLabel(result.ciStatus)}\nJobs: ${pass} passed, ${fail} failed, ${run} running\nManager: ${managerStatus}`;
            } else {
                result.ciStatus = 'error';
                result.tooltip = "No CI reported yet (Branch not deployed or Draft).";
            }
        } catch (e) {
            result.ciStatus = 'error';
            result.tooltip = `Failed to fetch CI: ${e.message}`;
        }

        return result;
    }

    // =====================================================================
    // NEW: Parse backport labels from the PR sidebar
    // Matches: backport/3.9.x  backport-4.0  backport:release-3.0
    // =====================================================================
    function getBackportBranchesFromLabels() {
        const names = new Set();
        const sidebar = document.querySelector(SIDEBAR_SEL);
        if (!sidebar) return [];

        // GitHub uses several DOM structures across UI versions; try them all
        const selectors = [
            '[data-testid="sidebar-labels"] a[data-name]',
            '[data-testid="labels-section"] a[data-name]',
            '.sidebar-labels a[data-name]',
            '.js-issue-labels a[data-name]',
            '.IssueLabel[data-name]',
            'a[href*="/labels/backport"]',
        ];

        for (const sel of selectors) {
            sidebar.querySelectorAll(sel).forEach(el => {
                const raw = (el.getAttribute('data-name') || el.textContent || '').trim();
                // Decode URL-encoded names (e.g. backport%2F3.9.x)
                let name = raw;
                try { name = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (_) {}
                // Matches: "backport/3.9.x"  "backport-4.0"  "backport next/3.10.x"  "backport: foo"
                const m = name.match(/^backport[\s\/\-:]+(.+)/i);
                if (m) names.add(m[1].trim());
            });
        }

        return [...names];
    }

    // =====================================================================
    // Collect all backport-related PR links visible on the current page.
    //
    // Returns { id, url, branch } — branch is resolved in this priority:
    //   1. Link text contains "[backport -> branch]" or "[backport: branch]"
    //      e.g. title "[backport -> next/3.11.x.x] fix..." → "next/3.11.x.x"
    //   2. Surrounding comment text matches "backport to X" / "backport PR for X"
    //   3. null — resolved later by fetching the target PR page (baseBranch)
    //
    // Two sources:
    //   1. Comments mentioning "backport"
    //   2. Timeline "mentioned this pull request" / "referenced this pull request" events
    // =====================================================================
    function findLinkedPRsFromPage(originalPrNumber) {
        const seen = new Map();
        const results = [];

        const add = (url, branch, backportHint = false) => {
            const prNum = url.match(/\/pull\/(\d+)/)?.[1];
            if (!prNum || prNum === String(originalPrNumber)) return;

            if (seen.has(url)) {
                const existing = results[seen.get(url)];
                if (existing) {
                    if (!existing.branch && branch) existing.branch = branch;
                    existing.backportHint = existing.backportHint || backportHint || hasBackportToken(branch);
                }
                return;
            }

            seen.set(url, results.length);
            results.push({ id: prNum, url, branch: branch || null, backportHint: backportHint || hasBackportToken(branch) });
        };

        // Extract branch from PR title format: "[backport -> next/3.11.x.x] ..."
        //   also covers: "[backport: next/3.11.x.x]", "[backport → next/3.11.x.x]"
        const BRANCH_FROM_TITLE = /\[backport\s*(?:(?:->|→|:)\s*)?([\w.\-\/]+)\]/i;

        // Extract branch from surrounding text: "backport to X", "backport PR for X", "backport -> X"
        const BRANCH_IN_TEXT = /(?:backport(?:\s+to|\s+pr\s+for|\s*->?|\s*→))\s+([\w.\-\/]+)/i;

        const getLinkText = (link) => [
            link.textContent || '',
            link.getAttribute('title') || '',
            link.getAttribute('aria-label') || '',
        ].join(' ');

        const branchFromLink = (link) => {
            const m = getLinkText(link).match(BRANCH_FROM_TITLE);
            return m ? m[1] : null;
        };

        const linkMentionsBackport = (link) => hasBackportToken(getLinkText(link));

        // Source 1: comments mentioning "backport"
        document.querySelectorAll('.comment-body, [data-testid="markdown-body"]').forEach(comment => {
            if (!/backport/i.test(comment.textContent)) return;
            const textMatch = comment.textContent.match(BRANCH_IN_TEXT);
            const textBranch = (textMatch && !textMatch[1].startsWith('#')) ? textMatch[1] : null;
            comment.querySelectorAll('a[href*="/pull/"]').forEach(link => {
                const branchHint = branchFromLink(link) || textBranch;
                add(link.href, branchHint, linkMentionsBackport(link) || hasBackportToken(branchHint));
            });
        });

        // Source 2: timeline cross-reference events
        // GitHub React uses various class/testid combos across versions; try them all.
        document.querySelectorAll(
            '.js-timeline-item, [data-testid="timeline-item"], ' +
            '[data-testid*="cross-reference"], ' +
            '.TimelineItem, [class*="TimelineItem"]'
        ).forEach(item => {
            const itemText = item.textContent || '';
            if (!/mentioned this|referenced this|was referenced|added a commit/i.test(itemText)) return;
            if (!hasBackportToken(itemText)) return;

            item.querySelectorAll('a[href*="/pull/"]').forEach(link => {
                const branchHint = branchFromLink(link);
                add(link.href, branchHint, linkMentionsBackport(link) || hasBackportToken(branchHint));
            });
        });

        // Source 3: any PR link anywhere on the page whose visible text contains
        // "[backport -> branch]". Catches bot-posted links and collapsed timeline
        // events that Source 2 misses.
        document.querySelectorAll('a[href*="/pull/"]').forEach(link => {
            const b = branchFromLink(link);
            if (linkMentionsBackport(link) || hasBackportToken(b)) add(link.href, b, true);
        });

        return results;
    }

    // =====================================================================
    // Fallback: search the repo's PR list for backport PRs mentioning the
    // original PR number. Used when cross-reference timeline events are
    // paginated/collapsed and therefore absent from the DOM.
    // =====================================================================
    async function fetchBackportPRsFromSearch(repo, originalPrNumber) {
        const BRANCH_FROM_TITLE = /\[backport\s*(?:(?:->|→|:)\s*)?([\w.\-\/]+)\]/i;
        const seen = new Set();
        const results = [];

        const parsePage = (html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            doc.querySelectorAll('a[href*="/pull/"]').forEach(link => {
                const m = link.href.match(/\/pull\/(\d+)/);
                if (!m) return;
                const prNum = m[1];
                if (prNum === String(originalPrNumber) || seen.has(prNum)) return;
                const title = link.textContent.trim();
                seen.add(prNum);
                const bm = title.match(BRANCH_FROM_TITLE);
                try {
                    const u = new URL(link.href);
                    results.push({
                        id: prNum,
                        url: `${u.origin}${u.pathname}`,
                        branch: bm ? bm[1] : null,
                        backportHint: hasBackportToken(title) || hasBackportToken(bm ? bm[1] : null),
                    });
                } catch (_) {}
            });
        };

        const base = `https://github.com/${repo}/pulls?q=is%3Apr+${originalPrNumber}`;
        await Promise.all(['+is%3Aopen', '+is%3Amerged', '+is%3Aclosed'].map(async state => {
            try {
                const resp = await fetch(base + state, { headers: { Accept: 'text/html' } });
                if (resp.ok) parsePage(await resp.text());
            } catch (_) {}
        }));

        if (DEBUG) console.log(`${PREFIX} search fallback found ${results.length} backport PR(s)`);
        return results;
    }

    async function rerunWorkflow(repo, runId, failedOnly = true) {
        const sessionPath = failedOnly ? 'rerun-failed-jobs' : 'rerun';
        const endpoint = failedOnly
        ? `https://api.github.com/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`
        : `https://api.github.com/repos/${repo}/actions/runs/${runId}/rerun`;
        // GitHub session-based fetch (works because you're on github.com)
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        const csrf = csrfMeta ? csrfMeta.content : '';
        const resp = await fetch(`https://github.com/${repo}/actions/runs/${runId}/${sessionPath}`, {
            method: 'POST',
            headers: {
                'Accept': 'text/html',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-Token': csrf,
            },
        });
        if (!resp.ok) {
            // Fallback: use the GitHub API with a PAT if session auth fails
            // You can store a PAT in GM_getValue/GM_setValue
            const token = await GM_getValue('github_pat', '');
            if (!token) throw new Error('No auth available. Set a PAT via script settings.');
            const apiResp = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github+json',
                },
            });
            if (!apiResp.ok) throw new Error(`API returned ${apiResp.status}`);
        }
    }

    function findOriginalPrInCommentRoot(commentRoot, repo, currentPrNumber) {
        if (!commentRoot) return null;

        const candidates = [];
        const seen = new Set();
        const text = commentRoot.textContent || '';

        const addCandidate = (prNumber, url, score) => {
            if (!prNumber || String(prNumber) === String(currentPrNumber)) return;
            const key = `${prNumber}:${url}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ id: String(prNumber), url, score });
        };

        const textPatterns = [
            /backport(?:\s+of|\s+for)?\s+#(\d+)/ig,
            /original\s+pr[:\s]+#(\d+)/ig,
            /cherry[- ]picked\s+from\s+#(\d+)/ig,
            /source\s+pr[:\s]+#(\d+)/ig,
        ];

        for (const pattern of textPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                addCandidate(match[1], buildPullUrl(repo, match[1]), 40);
            }
        }

        commentRoot.querySelectorAll('a[href*="/pull/"]').forEach((link, index) => {
            const parsed = parseGithubUrl(link.href);
            if (!parsed || parsed.repo !== repo) return;

            let score = Math.max(10 - index, 1);
            const linkText = link.textContent.trim();
            if (/^#?\d+$/.test(linkText) || linkText.includes(parsed.prNumber)) score += 5;
            if (/backport of|original pr|cherry[- ]picked from|source pr/i.test(text)) score += 10;

            addCandidate(parsed.prNumber, buildPullUrl(parsed.repo, parsed.prNumber), score);
        });

        candidates.sort((left, right) => right.score - left.score || Number(right.id) - Number(left.id));
        return candidates[0] || null;
    }

    async function findOriginalPrForBackport(repo, currentPrNumber) {
        const firstComment = document.querySelector('.comment-body, [data-testid="markdown-body"]');
        const localCandidate = findOriginalPrInCommentRoot(firstComment, repo, currentPrNumber);
        if (localCandidate) return localCandidate;

        try {
            const resp = await fetch(buildPullUrl(repo, currentPrNumber), { headers: { Accept: 'text/html' } });
            if (!resp.ok) return null;
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const remoteFirstComment = doc.querySelector('.comment-body, [data-testid="markdown-body"]');
            return findOriginalPrInCommentRoot(remoteFirstComment, repo, currentPrNumber);
        } catch (_) {
            return null;
        }
    }

    // Fast state check for the PR we're currently viewing — reads the live DOM
    // directly instead of re-serialising + re-parsing the entire page HTML.
    function getMainPRStateFromDOM() {
        const badge = document.querySelector(
            '#partial-discussion-header .State, ' +
            '[data-testid="state-badge"], ' +
            '.gh-header-meta .State'
        );
        if (!badge) return null;
        const t = badge.textContent.toLowerCase();
        if (t.includes('merged')) return 'MERGED';
        if (t.includes('closed')) return 'CLOSED';
        if (t.includes('open'))   return 'OPEN';
        return null;
    }

    function shouldRunSafetyPoll() {
        return document.visibilityState === 'visible' && !document.hidden;
    }

    function waitBeforeRetry(retryCount) {
        const delay = Math.min(250 * (retryCount + 1), 1500);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    function clearInitRetryTimer() {
        if (!initRetryTimer) return;
        clearTimeout(initRetryTimer);
        initRetryTimer = null;
    }

    function scheduleInitRetry(delay = 250) {
        if (initRetryTimer) return;
        initRetryTimer = setTimeout(() => {
            initRetryTimer = null;
            init();
        }, delay);
    }

    function getStateRank(entry) {
        const state = entry.state || (entry.merged ? 'MERGED' : entry.closed ? 'CLOSED' : 'OPEN');
        if (state === 'MERGED') return 3;
        if (state === 'OPEN') return 2;
        if (state === 'CLOSED') return 1;
        return 0;
    }

    function getPrNumberValue(candidate) {
        return Number.parseInt(candidate?.id, 10) || 0;
    }

    function shouldReplaceBranchEntry(currentEntry, nextInfo, nextCandidate) {
        if (!currentEntry || !currentEntry.hasPR) return true;

        const currentPrNumber = getPrNumberValue(currentEntry);
        const nextPrNumber = getPrNumberValue(nextCandidate);
        if (nextPrNumber === currentPrNumber) return true;

        const currentRank = getStateRank(currentEntry);
        const nextRank = getStateRank(nextInfo);
        if (nextRank !== currentRank) return nextRank > currentRank;

        return nextPrNumber > currentPrNumber;
    }

    function upsertBranchEntry(dataMap, branch, candidate, info) {
        if (!dataMap.has(branch)) {
            dataMap.set(branch, {
                branch, hasLabel: false, hasPR: true, missing: false,
                id: candidate.id, url: candidate.url,
                ...info,
            });
            return;
        }

        const entry = dataMap.get(branch);
        if (!shouldReplaceBranchEntry(entry, info, candidate)) return;

        Object.assign(entry, info, {
            branch,
            id: candidate.id,
            url: candidate.url,
            hasPR: true,
            missing: false,
        });
    }

    function syncRenderableBackportData(dataMap, includeMissing = false, includePendingLabels = false) {
        backportData = [...dataMap.values()].filter(entry => {
            if (entry.hasPR) return true;
            if (!entry.hasLabel || entry.hasPR) return false;
            return includeMissing || includePendingLabels;
        });
    }

    function getBackportDomSignals(prNumber) {
        return {
            labelBranches: getBackportBranchesFromLabels(),
            linked: findLinkedPRsFromPage(prNumber),
        };
    }

    async function waitForBackportDomSignals(prNumber, timeout = 1500) {
        const initial = getBackportDomSignals(prNumber);
        if (initial.labelBranches.length > 0 || initial.linked.length > 0) {
            return initial;
        }

        const roots = [
            document.querySelector(SIDEBAR_SEL),
            document.querySelector('#discussion_bucket, [data-testid="issue-viewer"], [data-testid="issue-body"]'),
        ].filter(Boolean);

        if (roots.length === 0) {
            await waitBeforeRetry(0);
            return getBackportDomSignals(prNumber);
        }

        return new Promise(resolve => {
            let settled = false;
            const observer = new MutationObserver(() => {
                const current = getBackportDomSignals(prNumber);
                if (current.labelBranches.length === 0 && current.linked.length === 0) return;
                finish(current);
            });

            const finish = (result) => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timer);
                resolve(result || getBackportDomSignals(prNumber));
            };

            for (const root of roots) {
                observer.observe(root, { childList: true, subtree: true });
            }

            const timer = setTimeout(() => finish(), timeout);
        });
    }

    // =====================================================================
    // MAIN SCAN: DOM-only, no external API calls
    // =====================================================================
    async function attemptAutoScan(retryCount, prContext, options = {}) {
        const keepExistingUi = options.keepExistingUi === true;
        const currentRepoData = parseGithubUrl(window.location.href);
        if (!currentRepoData) return;

        const { repo, prNumber } = currentRepoData;

        // ── BACKPORT PR view: show the original PR ────────────────────────
        if (prContext.isBackport) {
            lastPrState = "IGNORED";

            const found = [];
            const originalPr = await findOriginalPrForBackport(repo, prNumber);
            if (originalPr && !found.some(f => f.url === originalPr.url)) {
                found.push({ branch: 'Original PR', url: originalPr.url, id: originalPr.id });
            }

            if (found.length > 0) {
                const nextData = found.map(pr => ({
                    ...pr, hasLabel: false, hasPR: true, missing: false,
                    id: parseGithubUrl(pr.url)?.prNumber || '?',
                    ciStatus: 'fetching', merged: false, closed: false,
                    jumpUrl: pr.url, tooltip: "Fetching...",
                }));
                if (!keepExistingUi) {
                    backportData = nextData;
                    renderListUI();
                }

                for (const pr of nextData) {
                    const parsed = parseGithubUrl(pr.url);
                    if (!parsed) continue;
                    const info = await getPrStatus(parsed.repo, parsed.prNumber);
                    Object.assign(pr, { merged: info.merged, closed: info.closed, ciStatus: info.ciStatus, jumpUrl: info.jumpUrl, tooltip: info.tooltip });
                    if (!keepExistingUi) {
                        backportData = nextData;
                        renderListUI();
                    }
                }

                backportData = nextData;
                renderListUI();
            } else if (retryCount < 6) {
                await waitBeforeRetry(retryCount);
                return attemptAutoScan(retryCount + 1, prContext, options);
            } else {
                const root = document.getElementById('backport-ui-root');
                if (root) root.innerHTML = `<div class="color-fg-muted f6">No original PR found.</div>`;
            }
            return;
        }

        // ── MAIN PR view ──────────────────────────────────────────────────

        // 1. Check if main PR is merged — fast DOM read, no HTTP fetch
        const domState = getMainPRStateFromDOM();
        if (domState && domState !== 'MERGED') {
            lastPrState = domState;
            const root = document.getElementById('backport-ui-root');
            if (root) root.innerHTML = `<div class="color-fg-muted f6">PR is ${domState}. Waiting for merge.</div>`;
            return;
        }
        if (!domState) {
            // DOM not ready yet — fall back to fetch (should be rare)
            const mainPrInfo = await getPrStatus(repo, prNumber);
            lastPrState = mainPrInfo.state;
            if (mainPrInfo.state !== 'MERGED') {
                const root = document.getElementById('backport-ui-root');
                if (root) root.innerHTML = `<div class="color-fg-muted f6">PR is ${mainPrInfo.state}. Waiting for merge.</div>`;
                return;
            }
        }
        lastPrState = 'MERGED';

        const searchHitsPromise = fetchBackportPRsFromSearch(repo, prNumber);

        // 2. Get label branches (expected targets) + linked PRs from DOM
        let { labelBranches, linked } = getBackportDomSignals(prNumber);

        // On original PR pages GitHub often renders sidebar labels and timeline
        // links a bit after the sidebar itself. Wait briefly and reactively for
        // those surfaces instead of backing off in multi-second retry steps.
        if (labelBranches.length === 0 && linked.length === 0) {
            ({ labelBranches, linked } = await waitForBackportDomSignals(prNumber));
        }

        // 3. Seed dataMap from labels — all start as "missing" until we find a PR
        const dataMap = new Map();
        for (const branch of labelBranches) {
            dataMap.set(branch, {
                branch, hasLabel: true, hasPR: false, missing: false,
                id: null, url: null, state: null,
                merged: false, closed: false,
                ciStatus: 'fetching', tooltip: 'Looking up...', jumpUrl: null,
            });
        }

        const renderPendingRows = () => {
            if (keepExistingUi) return;
            syncRenderableBackportData(dataMap, false, true);
            if (backportData.length > 0) renderListUI();
        };

        if (labelBranches.length > 0) {
            renderPendingRows();
        }

        // 4. Fetch all linked PRs in parallel — each one updates the UI as it resolves.
        //    Branch: prefer candidate.branch (from comment text), fallback to baseBranch
        //    extracted from fetched HTML. Skip if neither is available.
        await Promise.all(linked.map(async (candidate) => {
            const parsed = parseGithubUrl(candidate.url);
            if (!parsed) return;

            const info   = await getPrStatus(parsed.repo, parsed.prNumber);
            if (!info.isBackportPr) return;
            const branch = candidate.branch || info.baseBranch;

            if (!branch) return; // can't determine branch — skip

            upsertBranchEntry(dataMap, branch, candidate, info);

            if (!keepExistingUi) {
                syncRenderableBackportData(dataMap, false);
                if (backportData.length > 0) renderListUI();
            }
        }));

        // 5. Always run the GitHub PR search fallback.
        //    This catches two cases:
        //    a. Labeled entries whose "referenced this" timeline events are
        //       paginated/collapsed and therefore absent from the DOM.
        //    b. Unlabeled BP branches (e.g. ai-master) that have no label entry
        //       but do have a real backport PR — these would be silently skipped
        //       if we only ran this fallback when labeled entries were missing.
        const searchHits = await searchHitsPromise;

        await Promise.all(searchHits.map(async (candidate) => {
            const parsed = parseGithubUrl(candidate.url);
            if (!parsed) return;
            const info   = await getPrStatus(parsed.repo, parsed.prNumber);
            if (!info.isBackportPr) return;
            const branch = candidate.branch || info.baseBranch;
            if (!branch) return;

            upsertBranchEntry(dataMap, branch, candidate, info);

            if (!keepExistingUi) {
                syncRenderableBackportData(dataMap, false);
                if (backportData.length > 0) renderListUI();
            }
        }));

        if (dataMap.size === 0) {
            const root = document.getElementById('backport-ui-root');
            if (root) root.innerHTML = `<div class="color-fg-muted f6">No backports found.</div>`;
            return;
        }

        // 6. Any label entry still without a PR is genuinely missing
        for (const entry of dataMap.values()) {
            if (!entry.hasPR) {
                entry.missing = true;
                entry.ciStatus = 'missing';
                entry.tooltip  = `No backport PR found for ${entry.branch}`;
            }
        }
        syncRenderableBackportData(dataMap, true);
        renderListUI();
    }

    // =====================================================================
    // RENDER: shows found PRs, missing entries, and two copy buttons
    // =====================================================================
    function renderListUI() {
        const root = document.getElementById('backport-ui-root');
        if (!root) return;
        root.innerHTML = "";

        const list = document.createElement('div');
        list.className = "pb-1";

        backportData.forEach(pr => {
            const row = document.createElement('div');
            row.className = "d-flex flex-items-center mb-2";
            row.setAttribute('title', pr.tooltip || '');

            // Left: PR link (or plain branch name if missing)
            const labelDiv = document.createElement('div');
            labelDiv.className = "flex-auto min-width-0";
            if (!pr.hasPR) {
                const branchSpan = document.createElement('span');
                branchSpan.className = 'color-fg-muted';
                branchSpan.textContent = pr.branch;
                labelDiv.appendChild(branchSpan);
            } else {
                const prLink = document.createElement('a');
                prLink.href = pr.url;
                prLink.className = 'Link--primary text-bold no-underline';
                prLink.target = '_blank';
                prLink.rel = 'noopener noreferrer';
                prLink.textContent = `#${pr.id}`;

                const branchSpan = document.createElement('span');
                branchSpan.className = 'color-fg-muted ml-1';
                branchSpan.textContent = pr.branch;

                labelDiv.appendChild(prLink);
                labelDiv.appendChild(branchSpan);
            }

            // Right: status badge / icon
            const iconDiv = document.createElement('div');
            iconDiv.className = "d-flex flex-items-center";

            if (pr.missing) {
                iconDiv.innerHTML =
                    `<span style="color:var(--color-attention-fg);border:1px solid var(--color-attention-emphasis);padding:1px 5px;border-radius:2em;font-size:0.85em;">Missing</span>`;
            } else if (!pr.hasPR) {
                iconDiv.innerHTML = OCTICONS.sync.replace('octicon-sync', 'octicon-sync anim-rotate');
            } else if (pr.merged) {
                iconDiv.innerHTML =
                    `<span class="Label Label--secondary mr-1" style="background:var(--color-done-subtle);color:var(--color-done-fg);">Merged</span>${OCTICONS.check}`;
            } else if (pr.closed) {
                iconDiv.innerHTML = `<span style="opacity:0.5">${OCTICONS.x}</span>`;
            } else {
                const statusWrap = document.createElement('span');
                statusWrap.className = 'd-flex flex-items-center';
                statusWrap.style.gap = '4px';

                const statusBadge = document.createElement('span');
                statusBadge.textContent = getOpenPrStatusLabel(pr.ciStatus);
                statusBadge.style.cssText = getOpenPrStatusBadgeStyle(pr.ciStatus);

                // The status icon (the red X on failure, the alert triangle on
                // error, the amber dot while pending) doubles as the rerun
                // trigger when we have a workflow run to target — clicking the
                // icon itself reruns it, instead of a separate adjacent button.
                const canRestart = pr.workflowRunIds && pr.workflowRunIds.length > 0 &&
                    (pr.ciStatus === 'test_fail' || pr.ciStatus === 'error' || pr.ciStatus === 'pending');
                const iconLabel = pr.ciStatus === 'test_fail' ? 'Re-run failed jobs' : 'Re-run all jobs';

                const statusIcon = document.createElement(canRestart ? 'button' : 'span');
                statusIcon.className = 'd-flex flex-items-center';
                statusIcon.innerHTML = getOpenPrStatusIcon(pr.ciStatus);

                if (canRestart) {
                    statusIcon.type = 'button';
                    statusIcon.style.cssText = 'background:none;border:none;padding:0;cursor:pointer;line-height:0;';
                    statusIcon.title = iconLabel;
                    statusIcon.addEventListener('click', async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        statusIcon.querySelector('svg').classList.add('anim-rotate');
                        statusIcon.style.pointerEvents = 'none';
                        try {
                            const parsed = parseGithubUrl(pr.url);
                            const repo = parsed ? parsed.repo : '';
                            const failedOnly = pr.ciStatus === 'test_fail';
                            // Rerun the most recent workflow run
                            await rerunWorkflow(repo, pr.workflowRunIds[0], failedOnly);
                            statusIcon.title = 'Triggered!';
                            setTimeout(() => { statusIcon.title = iconLabel; }, 2000);
                        } catch (e) {
                            statusIcon.title = `Failed: ${e.message}`;
                        } finally {
                            statusIcon.querySelector('svg').classList.remove('anim-rotate');
                            statusIcon.style.pointerEvents = '';
                        }
                    });
                }

                statusWrap.appendChild(statusBadge);
                statusWrap.appendChild(statusIcon);
                iconDiv.appendChild(statusWrap);
            }

            row.appendChild(labelDiv);
            row.appendChild(iconDiv);
            list.appendChild(row);
        });

        root.appendChild(list);

        // ── Buttons ────────────────────────────────────────────────────────
        const btnRow = document.createElement('div');
        btnRow.className  = "d-flex mt-1";
        btnRow.style.gap  = "4px";

        const mkBtn = (label, mode) => {
            const b = document.createElement('button');
            b.className  = "btn btn-sm flex-1";
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                copyToClipboard(mode, b);
            });
            return b;
        };

        btnRow.appendChild(mkBtn('Copy summary',  'summary'));
        btnRow.appendChild(mkBtn('Copy unmerged', 'unmerged'));
        root.appendChild(btnRow);
    }

    function renderLoadingListUI(message) {
        const root = document.getElementById('backport-ui-root');
        if (!root) return;

        root.innerHTML = "";

        const list = document.createElement('div');
        list.className = 'pb-1';

        const row = document.createElement('div');
        row.className = 'd-flex flex-items-center mb-2';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'flex-auto min-width-0';

        const label = document.createElement('span');
        label.className = 'color-fg-muted';
        label.textContent = message;
        labelDiv.appendChild(label);

        const iconDiv = document.createElement('div');
        iconDiv.className = 'd-flex flex-items-center';
        iconDiv.innerHTML = OCTICONS.sync.replace('octicon-sync', 'octicon-sync anim-rotate');

        row.appendChild(labelDiv);
        row.appendChild(iconDiv);
        list.appendChild(row);
        root.appendChild(list);
    }

    function setRefreshButtonLoading(isLoading) {
        const refreshBtn = document.getElementById('backport-refresh-btn');
        if (!refreshBtn) return;

        refreshBtn.style.opacity = isLoading ? '0.4' : '';
        refreshBtn.style.pointerEvents = isLoading ? 'none' : '';

        const svg = refreshBtn.querySelector('svg');
        if (svg) svg.classList.toggle('anim-rotate', isLoading);
    }

    // =====================================================================
    // COPY: two modes
    //   summary  – everything (same as before)
    //   unmerged – only open PRs + missing entries (i.e., still pending work)
    // =====================================================================
    function copyToClipboard(mode, btn) {
        const titleElem = document.querySelector('.js-issue-title, .markdown-title');
        const title     = titleElem ? titleElem.innerText.trim() : 'PR';

        let items;
        if (mode === 'unmerged') {
            // Only open PRs (not yet merged or closed) — excludes missing entries
            items = backportData.filter(pr => pr.hasPR && !pr.merged && !pr.closed);
        } else {
            items = backportData;
        }

        if (items.length === 0) {
            if (btn) { btn.textContent = 'None!'; setTimeout(() => { btn.textContent = mode === 'unmerged' ? 'Copy unmerged' : 'Copy summary'; }, 1500); }
            return;
        }

        const lines = items.map(pr => {
            if (pr.missing) return `[MISSING] ${pr.branch}`;
            if (!pr.hasPR) return `[PENDING] ${pr.branch}`;
            const status = pr.merged  ? 'MERGED'
                         : pr.closed  ? 'CLOSED'
                         : getOpenPrStatusLabel(pr.ciStatus);
            return `[${status}] ${pr.branch}: ${pr.url}`;
        });

        const text = mode === 'unmerged'
            ? `${title}\n${lines.join('\n')}`
            : `${title}\n${lines.join('\n')}`;

        navigator.clipboard.writeText(text).then(() => {
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            }
        });
    }

    // =====================================================================
    // UI injection
    // MutationObserver-based startup: fires the moment React renders the
    // sidebar and base-branch elements — no fixed-delay retry loops needed.
    // =====================================================================
    const SIDEBAR_SEL = '.Layout-sidebar, #partial-discussion-sidebar, [id="pr-conversation-sidebar"], [data-testid="sidebar"]';
    let domObserver = null;
    let sidebarObserver = null;

    function clearSidebarObserver() {
        if (!sidebarObserver) return;
        sidebarObserver.disconnect();
        sidebarObserver = null;
    }

    function armSidebarObserver(sidebar) {
        clearSidebarObserver();
        if (!sidebar) return;

        sidebarObserver = new MutationObserver(() => {
            if (document.getElementById('backport-tracker-section')) return;
            if (!lastPrContext) return;

            needsSectionRestore = true;
            if (!isScanning) scheduleInitRetry(0);
        });

        sidebarObserver.observe(sidebar, { childList: true });
    }

    function maybeRestoreTrackerSection() {
        if (!needsSectionRestore) return;
        if (document.getElementById('backport-tracker-section')) {
            needsSectionRestore = false;
            return;
        }

        needsSectionRestore = false;
        scheduleInitRetry(0);
    }

    function armObserver() {
        if (domObserver) return;

        // Immediate check: if sidebar is already in the DOM, call init() now.
        // init() handles prContext detection (DOM, JSON, and hovercard fallback).
        if (document.querySelector(SIDEBAR_SEL)) {
            scheduleInitRetry(0);
            return;
        }

        // Watch for the sidebar to appear, then hand off to init().
        // init() itself handles the prContext check (including hovercard fallback),
        // so we don't gate on getPrContext() here — that would block PRs whose
        // base-branch info only becomes available via the hovercard API.
        domObserver = new MutationObserver(() => {
            if (!document.querySelector(SIDEBAR_SEL)) return;
            domObserver.disconnect();
            domObserver = null;
            scheduleInitRetry(0);
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
    }

    async function init() {
        if (isScanning) return;
        clearInitRetryTimer();

        // Compare pathname only — ignore hash/query so GitHub SPA URL decorations
        // (e.g. #issuecomment-xxx, ?notification_referrer_id=...) don't trigger
        // a spurious section removal and rebuild (which causes the visible flash).
        const currentUrl = window.location.pathname;
        const urlChanged = currentUrl !== lastUrl;

        if (urlChanged) {
            lastUrl = currentUrl; lastPrState = ""; lastPrContext = null; backportData = []; lastScanSettled = false;
            needsSectionRestore = false;
            hovercardFetched = false;
            clearInitRetryTimer();
            // Tear down any pending observer from the previous page
            if (domObserver) { domObserver.disconnect(); domObserver = null; }
            clearSidebarObserver();
            const old = document.getElementById('backport-tracker-section');
            if (old) old.remove();
        }
        const sidebar = document.querySelector(SIDEBAR_SEL);

        // Need a sidebar to prepend into — if not present yet, wait for it
        if (!sidebar) {
            armObserver();
            return;
        }

        if (!urlChanged && document.getElementById('backport-tracker-section')) {
            if (lastPrState === 'OPEN' && lastPrContext && !lastPrContext.isBackport) checkIfMainPrMerged();
            return;
        }

        let prContext = getPrContext();

        // DOM + JSON selectors failed to find base branch (e.g. GitHub's new React
        // UI no longer embeds baseRefName).  Fall back to the hovercard API which
        // always returns a compact HTML snippet with "{head} into {base}" branch text.
        if (!prContext && !hovercardFetched) {
            hovercardFetched = true;
            const rd = parseGithubUrl(window.location.href);
            if (rd) prContext = await getPrContextFromHovercard(rd.repo, rd.prNumber);
        }

        if (!prContext) {
            // Still null — let GitHub finish hydration and retry asynchronously.
            scheduleInitRetry(300);
            return;
        }
        lastPrContext = prContext;

        const shouldKeepRenderedList = !urlChanged && lastScanSettled && backportData.length > 0;

        const sidebarTitle = prContext.isBackport ? "Original PR" : "Backports";

        const section = document.createElement('div');
        section.id = 'backport-tracker-section';
        section.className = 'discussion-sidebar-item';
        section.setAttribute('data-backport-tracker', 'true');
        section.style.cssText = "border-bottom:1px solid var(--color-border-muted);padding-bottom:12px;margin-bottom:4px;";

        const heading = document.createElement('div');
        heading.className = "discussion-sidebar-heading text-bold mb-2 d-flex flex-items-center";

        heading.innerHTML = `${OCTICONS.branch} <span class="ml-1 flex-auto">${sidebarTitle}</span>`;

        const refreshBtn = document.createElement('button');
        refreshBtn.id = "backport-refresh-btn";
        refreshBtn.className = "btn-link color-fg-muted";
        refreshBtn.type = 'button';
        refreshBtn.style.cssText = "background:none;border:none;padding:0;cursor:pointer;line-height:0;";
        refreshBtn.setAttribute('title', 'Refresh');
        refreshBtn.innerHTML = OCTICONS.sync;   // no anim-rotate by default
        refreshBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            refreshScan(prContext);
        });
        heading.appendChild(refreshBtn);

        section.appendChild(heading);

        const uiRoot = document.createElement('div');
        uiRoot.id = "backport-ui-root";
        section.appendChild(uiRoot);
        sidebar.prepend(section);
        needsSectionRestore = false;
        armSidebarObserver(sidebar);

        if (shouldKeepRenderedList) {
            renderListUI();
        } else {
            renderLoadingListUI(prContext.isBackport ? 'Looking up original PR...' : 'Looking up backports...');
        }

        try {
            isScanning = true;
            lastScanSettled = false;
            await attemptAutoScan(0, prContext, { keepExistingUi: shouldKeepRenderedList });
            lastScanSettled = true;
        } finally {
            isScanning = false;
            maybeRestoreTrackerSection();
        }
    }

    // Refresh button handler: reset state and re-run the scan in-place
    // (no page reload, no DOM removal — just clear data and re-scan)
    async function refreshScan(prContext) {
        if (isScanning) return;

        backportData = [];
        lastPrState  = "";
        lastScanSettled = false;

        renderLoadingListUI(prContext.isBackport ? 'Looking up original PR...' : 'Looking up backports...');

        try {
            isScanning = true;
            setRefreshButtonLoading(true);
            await attemptAutoScan(0, prContext);
            lastScanSettled = true;
        } finally {
            setRefreshButtonLoading(false);
            isScanning = false;
            maybeRestoreTrackerSection();
        }
    }

    async function checkIfMainPrMerged() {
        if (isScanning) return;
        try {
            isScanning = true;
            const domState = getMainPRStateFromDOM();
            if (!domState) return;

            if (domState === 'MERGED' && lastPrState !== 'MERGED') {
                if (DEBUG) console.log(`${PREFIX} Main PR dynamically merged! Restarting UI.`);
                const old = document.getElementById('backport-tracker-section');
                if (old) old.remove();
                lastPrState = 'MERGED';
                isScanning = false;
                init();
                return;
            }

            lastPrState = domState;
        } finally {
            isScanning = false;
        }
    }

    init();
    setInterval(() => {
        if (!shouldRunSafetyPoll()) return;
        if (lastPrContext && lastPrContext.isBackport) return;
        init();
    }, 5000); // safety-net poll

    // Fast SPA navigation detection.
    // GitHub uses Turbo — these events fire when React renders new page content.
    // Debounce at 200 ms so multiple rapid events collapse into one init() call.
    //
    // NOTE: We intentionally do NOT patch history.pushState — GitHub calls it
    // repeatedly during page hydration (sometimes dozens of times), which would
    // cause the debounce to keep resetting and delay init() significantly.
    // turbo:load is the reliable "page is ready" signal for SPA navigation.
    let navTimer = null;
    const onNav = () => { clearTimeout(navTimer); navTimer = setTimeout(init, 200); };

    // Turbo events (GitHub's current SPA stack)
    document.addEventListener('turbo:render',  onNav);
    document.addEventListener('turbo:load',    onNav);

    // Legacy pjax (older GitHub versions still used in some paths)
    document.addEventListener('pjax:end',      onNav);

    // Browser back/forward
    window.addEventListener('popstate', onNav);
})();

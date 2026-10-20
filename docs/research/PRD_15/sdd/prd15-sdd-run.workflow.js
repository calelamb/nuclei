export const meta = {
  name: 'prd15-sdd-run',
  description: 'PRD 15 SDD run: parallel unit implementers in own worktrees, paired Opus task reviews, one fix round + scoped re-review',
  phases: [
    { title: 'Implement', detail: 'Sonnet implementer per unit, own worktree' },
    { title: 'Review', detail: 'Opus task review (spec + quality), one reviewer per pair' },
    { title: 'Fix', detail: 'Sonnet fixer per pair (only if findings)' },
    { title: 'Re-review', detail: 'Opus scoped re-review per pair' },
  ],
}

const A = args
const SDD = '/home/calelamb/.claude/plugins/cache/superpowers-marketplace/superpowers/6.4.2/skills/subagent-driven-development/scripts'
const ENV = `
Environment (Linux dev box, Ubuntu 24.04, 16 cores, 62 GB): Node via nvm - run "source ~/.nvm/nvm.sh" in each shell (node 24; node_modules is a symlink to the main PRD 15 worktree's install). Python kernel venv: ./.venv (symlink; python 3.12 with kernel/requirements.txt + pytest, pytest-asyncio, qiskit 1.4.6, qiskit-aer, cirq-core, qdk, stim, sinter, pymatching, pyarrow, duckdb, jsonschema). Use "uv" (~/.local/bin/uv) to create any extra venvs under your own scratch dir. Rust: ~/.cargo/bin (cargo builds use this worktree's own target dir). Check .github/workflows/*.yml for how CI invokes each suite and mirror it.
Rules: never touch ~/.nuclei/runtime, the owner's installed app (/usr/bin/nuclei, ~/.local/share/com.nuclei.app) or running Nuclei processes; never launch /usr/bin/nuclei. Learn mode is being deprecated - no Learn-mode work. Commit on your branch only (conventional commits, NO AI attribution/Co-Authored-By lines); never push, never merge, never touch other worktrees. Never end your turn to wait on a background process - poll actively until it finishes.`

const STATUS_SCHEMA = { type: 'object', properties: {
  status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
  head: { type: 'string', description: 'full SHA of HEAD on your branch after your commits' },
  commits: { type: 'array', items: { type: 'string' } },
  tests: { type: 'string' }, concerns: { type: 'string' } }, required: ['status', 'head', 'tests'] }

const implPrompt = (u) => `You are implementing PRD 15 unit ${u.key} for Nuclei (desktop quantum IDE; PRD 15 = the Quantumness Lab, quantum-ML program ideas 1-8 plus Track R reliability). ${u.context || ''}

## Task Description
Read your task brief first: ${u.brief}
It is your requirements, with the exact values to use verbatim. Follow pointers it gives into docs/research/PRD_15_QUANTUMNESS_LAB.md and docs/research/PRD_15/*.md (read the referenced sections, not whole files unless needed).

## Where you work
Work ONLY in the git worktree ${u.wt} (branch ${u.branch}, base ${A.base}). ${ENV}

## File ownership
Touch ONLY the files your brief's "Owned files" column lists (plus new files clearly inside your owned directories/globs). Other units are editing other files in parallel worktrees right now. If you truly need a change in a file you do not own, do not make it: describe it in your report and return DONE_WITH_CONCERNS.

## Your Job
1. Implement exactly what the brief specifies - nothing more (YAGNI), nothing less.
2. TDD: write the failing tests first (RED, capture the output), then implement (GREEN).
3. Verify: run the focused tests while iterating, and the relevant full suites once before committing (kernel pytest; vitest/tsc/eslint if you touched TS; cargo test if you touched Rust). Test output should be pristine.
4. Commit your work on ${u.branch}.
5. Self-review your own diff (completeness, quality, discipline, testing) and fix what you find.
6. Report.
You cannot ask the controller questions mid-task: when something is ambiguous, choose the option most consistent with the spec documents, record it as a "Decision:" line in your report, and continue. Use BLOCKED only if the task is impossible as specified, NEEDS_CONTEXT only if information is genuinely missing.

## You Do Not Dispatch Subagents
Do all of this work yourself. Never spawn a subagent, and never spawn a reviewer - the controller dispatches the review after you report.

## Code Organization
Follow the plan's file structure; one clear responsibility per file; files 200-400 lines typical, 800 max; functions < 50 lines; immutable patterns; explicit error handling; follow existing codebase patterns. If a file grows beyond the plan's intent, report DONE_WITH_CONCERNS rather than restructuring on your own.

## Report
Write your full report to ${u.report}: what you implemented, TDD evidence (RED command + failing output + why expected; GREEN command + passing output), full-suite results, files changed, Decision: lines, self-review findings, concerns. Then return the structured status (status, head SHA, commits "sha subject", one-line test summary, concerns).`

const REVIEW_SCHEMA = { type: 'object', properties: { units: { type: 'array', items: { type: 'object', properties: {
  key: { type: 'string' }, spec_compliant: { type: 'boolean' }, quality: { type: 'string', enum: ['Approved', 'Needs fixes'] },
  critical: { type: 'array', items: { type: 'string' } }, important: { type: 'array', items: { type: 'string' } },
  minor: { type: 'array', items: { type: 'string' } }, cannot_verify: { type: 'array', items: { type: 'string' } },
  review_file: { type: 'string' } }, required: ['key', 'spec_compliant', 'quality', 'critical', 'important', 'minor'] } } }, required: ['units'] }

const reviewPrompt = (pair) => `You are reviewing ${pair.length} unit implementation(s) for PRD 15 (Nuclei). For EACH unit: first whether it matches its requirements, then whether it is well-built. These are task-scoped gates, not a merge review.

${pair.map(x => `### Unit ${x.u.key}
- Brief (what was requested): ${x.u.brief}
- Implementer report (unverified claims): ${x.u.report}
- Worktree: ${x.u.wt} (branch ${x.u.branch}); Base: ${A.base}; Head: ${x.r.head}
- Generate the review package yourself, then read it ONCE: cd ${x.u.wt} && bash ${SDD}/review-package ${A.plan} ${A.base} ${x.r.head} ${A.ws}/reviews/${x.u.key}-r1.diff
- Write your full review for this unit to ${A.ws}/reviews/${x.u.key}-review-r1.md`).join('\n\n')}

Global constraints that bind every unit:
${A.constraints}

Method: the diff's context lines ARE the changed files - do not Read changed files separately unless a hunk you must judge is cut off. Do not crawl the codebase; inspect code outside the diff only to evaluate a concrete named risk (name the risk and what you checked). Cross-cutting changes (API contracts, shared state, protocol shapes) justify checking call sites. Your review is read-only: never mutate any worktree, index, HEAD or branch (the review-package command only writes the diff file).
Do not trust the report: verify its claims against the diff; design rationales in the report never downgrade a finding. Do not re-run suites; run a single focused test only for a specific doubt no reported run answers. Warnings/noise in reported test output are findings. If the report's test evidence is missing or garbled, report that as a gap.
Spec compliance: Missing / Extra (over-engineering, unrequested features) / Misunderstood, file by file against the brief's owned-files list - a listed file never touched is Missing, and a file touched OUTSIDE the unit's ownership is a finding. Requirements you cannot verify from the diff go in cannot_verify.
Quality: separation of concerns, error handling, DRY, edge cases, tests verify real behaviour (not mocks), file/function size, immutability, follows existing patterns.
Calibration: Critical = broken/unsafe/data loss; Important = this unit cannot be trusted until fixed (incorrect or fragile behaviour, missed requirement, swallowed errors, tests that assert nothing, verbatim duplication); everything else Minor. Plan-mandated defects are Important, labelled plan-mandated.
You do not dispatch subagents. Each finding: file:line, what is wrong, why it matters, how to fix. Return the structured result (one entry per unit, with review_file paths).`

const FIX_SCHEMA = { type: 'object', properties: { units: { type: 'array', items: { type: 'object', properties: {
  key: { type: 'string' }, head: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } },
  not_fixed: { type: 'array', items: { type: 'string' } }, tests: { type: 'string' } }, required: ['key', 'head', 'tests'] } } }, required: ['units'] }

const blocking = (rv) => !rv.spec_compliant || rv.critical.length > 0 || rv.important.length > 0

const results = await pipeline(A.pairs,
  async (pairIdx) => {
    const units = pairIdx.map(i => A.units[i])
    const impl = await parallel(units.map(u => () =>
      agent(implPrompt(u), { label: `impl:${u.key}`, phase: 'Implement', model: 'sonnet', effort: u.effort || 'high', schema: STATUS_SCHEMA })))
    return units.map((u, i) => ({ u, r: impl[i] }))
  },
  async (items) => {
    const ready = items.filter(x => x.r && (x.r.status === 'DONE' || x.r.status === 'DONE_WITH_CONCERNS'))
    if (!ready.length) return { items, review: null }
    const review = await agent(reviewPrompt(ready), { label: `review:${ready.map(x => x.u.key).join('+')}`, phase: 'Review', model: 'opus', effort: 'high', schema: REVIEW_SCHEMA })
    return { items, review }
  },
  async ({ items, review }) => {
    if (!review) return { items, review, fix: null }
    const need = review.units.filter(blocking)
    if (!need.length) return { items, review, fix: null }
    const targets = need.map(rv => ({ rv, x: items.find(x => x.u.key === rv.key) })).filter(t => t.x)
    const fix = await agent(`You are fixing task-review findings for PRD 15 unit(s) ${targets.map(t => t.x.u.key).join(', ')} (Nuclei). For each unit below, work ONLY in its worktree, fix every Critical and Important finding and every spec gap, re-run the tests covering the amended code, commit on that unit's branch, and APPEND a fix report (what changed, covering tests, command, output) to the unit's report file.
${targets.map(t => `### ${t.x.u.key}
- Worktree ${t.x.u.wt} (branch ${t.x.u.branch}); reviewed head ${t.x.r.head}
- Brief: ${t.x.u.brief}
- Report file (append your fix report): ${t.x.u.report}
- Full review: ${t.rv.review_file || '(see findings below)'}
- Findings to fix:
${[...(t.rv.spec_compliant ? [] : ['SPEC: not spec compliant - see review file']), ...t.rv.critical.map(f => 'CRITICAL: ' + f), ...t.rv.important.map(f => 'IMPORTANT: ' + f)].map(f => '  - ' + f).join('\n')}`).join('\n\n')}
${ENV}
File ownership from each brief still applies. If you believe a finding is wrong, do not silently skip it: put it in not_fixed with your reasoning. You do not dispatch subagents. Return per unit: new head SHA, fixed list, not_fixed list (with reasons), test summary.`,
      { label: `fix:${targets.map(t => t.x.u.key).join('+')}`, phase: 'Fix', model: 'sonnet', effort: 'high', schema: FIX_SCHEMA })
    return { items, review, fix, targets }
  },
  async ({ items, review, fix, targets }) => {
    if (!fix) return { items, review, fix, rereview: null }
    const RR_SCHEMA = { type: 'object', properties: { units: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' }, open: { type: 'array', items: { type: 'string' } }, new_breakage: { type: 'array', items: { type: 'string' } },
      out_of_scope: { type: 'array', items: { type: 'string' } } }, required: ['key', 'open', 'new_breakage'] } } }, required: ['units'] }
    const rereview = await agent(`You are re-reviewing a fix round for PRD 15 unit(s) ${targets.map(t => t.x.u.key).join(', ')}. Verdict each finding ADDRESSED / NOT ADDRESSED with file:line evidence ("attempted" is not addressed), and inspect the fix diff for new breakage. Do NOT re-review code the fix did not touch (put such observations in out_of_scope). Read-only: never mutate worktrees/branches.
${targets.map(t => { const f = fix.units.find(z => z.key === t.x.u.key) || {}; return `### ${t.x.u.key}
- Brief: ${t.x.u.brief}; report (fix report appended at end): ${t.x.u.report}
- Fix range: ${t.x.r.head}..${f.head || 'HEAD'} in ${t.x.u.wt}. Generate and read: cd ${t.x.u.wt} && bash ${SDD}/review-package ${A.plan} ${t.x.r.head} ${f.head || 'HEAD'} ${A.ws}/reviews/${t.x.u.key}-r2.diff
- Findings under verification:
${[...t.rv.critical, ...t.rv.important].map(z => '  - ' + z).join('\n')}${t.rv.spec_compliant ? '' : '\n  - SPEC gaps listed in ' + (t.rv.review_file || 'the review')}
- Fixer claims not fixed: ${JSON.stringify(f.not_fixed || [])}` }).join('\n\n')}
Do not re-run suites; confirm the fix report names covering tests with output. You do not dispatch subagents. Return per unit: open findings (verbatim, NOT ADDRESSED ones), new_breakage (Critical/Important only, with file:line), out_of_scope.`,
      { label: `rereview:${targets.map(t => t.x.u.key).join('+')}`, phase: 'Re-review', model: 'opus', effort: 'medium', schema: RR_SCHEMA })
    return { items, review, fix, rereview }
  },
)

return results.filter(Boolean).flatMap(res => res.items.map(x => {
  const rv = res.review && res.review.units.find(z => z.key === x.u.key)
  const fx = res.fix && res.fix.units.find(z => z.key === x.u.key)
  const rr = res.rereview && res.rereview.units.find(z => z.key === x.u.key)
  return { key: x.u.key, impl: x.r, review: rv || null, fix: fx || null, rereview: rr || null,
    final_head: (fx && fx.head) || (x.r && x.r.head) || null }
}))

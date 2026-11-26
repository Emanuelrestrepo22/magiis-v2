# Failure Classification — Complete Reference

Read this when classifying a borderline failure, when the SKILL.md decision tree is ambiguous, when you need the full error-pattern catalogue, or when computing flakiness over historical runs.

Classification dictates release-blocking behavior. A wrong classification either blocks a safe release (false REGRESSION, or a PROD-pre-existing failure vetoed as if it were `INTRODUCIDO`) or ships a bug (false FLAKY). Follow the rules below — do not improvise.

---

## 1. The five categories

| Category | Definition | Release impact | Typical action |
|----------|------------|----------------|----------------|
| **REGRESSION** | Test passed recently, now fails consistently due to a code or data change | HIGH — blocks release only as `REGRESSION · INTRODUCIDO` (or `INDETERMINADO` at cut-off); `PREEXISTENTE` does not block | Set `prod_preexistence` first; `INTRODUCIDO` → open issue, assign, fix, verify, re-run |
| **FLAKY** | Test fails intermittently (> 20% failure rate over last 10 runs) on an unchanged build | MEDIUM — does not block | Quarantine or stabilize next sprint |
| **KNOWN ISSUE** | Failure is tracked by an existing backlog ticket | LOW — documented, does not block | Reference the ticket in the report |
| **ENVIRONMENT** | Failure is caused by infrastructure, network, or external dependency — not the app under test | MEDIUM — does not block | Re-run after infra fix |
| **NEW TEST FAILURE** | First-ever execution, no history to compare against | LOW — needs manual verification | Reproduce manually, then classify |

A failure can only belong to ONE category. When multiple rules match, apply this precedence:

```
KNOWN ISSUE > ENVIRONMENT > NEW TEST > REGRESSION > FLAKY
```

Rationale: if a ticket already tracks the failure, stop looking. If the error is clearly infrastructure, do not blame the code. A test with no history cannot be a regression yet.

**Attribute `prod_preexistence`** (canon: `agentic-qa-core/references/prod-preexistence-doctrine.md`, Part 4 — three-state verdict). Every `REGRESSION` and every `NEW TEST FAILURE` manually confirmed as a genuine product defect carries one of three values, obtained by a read-only verification against PROD (§2 step 5):

| `prod_preexistence` | Meaning | Release impact |
|---|---|---|
| `INTRODUCIDO` | The failing behaviour does not occur in PROD (feature absent there, root cause in the release diff, or PROD returns the expected result) | HIGH — the only value that blocks; file a Defect |
| `PREEXISTENTE` | The same behaviour occurs in PROD today | Does not block; report under "Pre-existing in PROD" with PROD impact; Team Lead decides (a) fix now / (b) `Bug` as technical debt; HIGH/CRITICAL severity forces CAUTION |
| `INDETERMINADO` | Not verifiable without writing to PROD, no conclusive signal, or PROD unreachable | CAUTION with owner + date; still open at the release cut-off → treated as `INTRODUCIDO` |

It is an attribute, not a sixth category: the precedence above is unchanged, and `FLAKY` / `KNOWN ISSUE` / `ENVIRONMENT` / unconfirmed `NEW TEST` never carry it.

---

## 2. Decision algorithm (canonical)

```
Input: one failed test result

1. Is the test's ATC ID or title referenced in any known-issue ticket?
   → YES: classify as KNOWN ISSUE with the ticket URL. STOP.
   → NO: continue.

2. Does the error message match any environment pattern (see §3)?
   → YES and other tests on the same run also failed on the same host: classify as ENVIRONMENT. STOP.
   → YES but this is the only failure in a suite of passing tests on the same host: treat as suspicious — likely REGRESSION disguised as infra. Continue.
   → NO: continue.

3. Is this the test's first recorded execution (no prior Allure history or TMS run records)?
   → YES: classify as NEW TEST FAILURE. STOP.
   → NO: continue.

4. Compute failure rate over the last N runs (N = min(10, available history)).
   → If failure rate > 20% and current build == previous builds (no deploy between them):
     classify as FLAKY. STOP.
   → If failure rate ≤ 20% AND the test passed in at least one of the last 5 runs:
     classify as REGRESSION. Continue to step 5.
   → If insufficient history (N < 5 or no previous passes): mark as REGRESSION (candidate),
     re-verify on next run. Continue to step 5.

5. For every REGRESSION (and every NEW TEST FAILURE once manually confirmed as a genuine
   product defect): run the PROD pre-existence verification, READ-ONLY
   (canon Part 3 — methods M1–M5, timeboxed):
     a. Fix the deployed versions of both sides (release env under test vs PROD).
     b. M1 code compare: PROD ref (main / deployed tag) ↔ release ref — is the root cause in the diff?
     c. M2 PROD read replica, SELECT only — is the symptom already persisted in PROD data?
     d. M3–M5 only if still open (read-only UI, API GET, history).
   → set prod_preexistence = PREEXISTENTE | INTRODUCIDO | INDETERMINADO + methods + confidence. STOP.
   Never write to PROD to obtain the answer.
```

### Parallel classification (default for >10 failures)

When the failure list has more than 10 entries, classifying serially burns the orchestrator's context with raw test logs. Instead we shard. This is the canonical reference for the **Parallel** dispatch declared in `regression-testing/SKILL.md` §"Subagent Dispatch Strategy" → "Classify failures (chunks of ~10 tests each)" row.

**Sharding rule**: split the failure list into chunks of ~10 failures (round up). Cap total subagents at 10 — if there are >100 failures, batches must be larger than 10 each.

**Dispatch (Parallel pattern)** — one briefing per chunk, all dispatched in a single message, following the 6-component format from `agentic-qa-core/references/briefing-template.md`:

```
Goal: Classify <N> test failures in chunk <CHUNK_INDEX>/<TOTAL_CHUNKS> against the rubric.
Context docs:
  - .claude/skills/regression-testing/references/failure-classification.md (rubric)
  - <ARTIFACT_PATH>/allure-results/ (raw failure data)
  - .context/regression-history/known-failures.json (if exists — list of KNOWN failures with their classification)
  - agentic-qa-core/references/prod-preexistence-doctrine.md (Part 3 — read-only methods M1–M5; Part 4 — verdict)
Skills to load: (none)
Exact instructions:
  1. For each failure in the chunk:
     a. Read its allure result + screenshot + trace summary.
     b. Apply the decision tree: REGRESSION / FLAKY / KNOWN / ENVIRONMENT / NEW TEST.
     c. Capture: { test, classification, evidence_paths, confidence: high|low, justification: <50 words }.
        For REGRESSION (and NEW TEST confirmed as a genuine defect) also run §2 step 5 and capture
        prod_preexistence (PREEXISTENTE|INTRODUCIDO|INDETERMINADO), preexistence_methods, preexistence_confidence.
  2. Cross-check against known-failures.json (if present) — KNOWN classifications must match a prior entry.
Report format:
  JSON array: [ { "test": "...", "classification": "...", "evidence_paths": ["..."], "confidence": "...", "justification": "...",
                  "prod_preexistence": "PREEXISTENTE|INTRODUCIDO|INDETERMINADO|null", "preexistence_methods": ["M1","M2"],
                  "preexistence_confidence": "alta|media|baja|null" }, ... ]
  At the end of the array, a summary: { "chunk": <CHUNK_INDEX>, "counts": { "REGRESSION": N, "FLAKY": N, ... },
                                        "prod_preexistence": { "PREEXISTENTE": N, "INTRODUCIDO": N, "INDETERMINADO": N } }
Rules:
  - Do NOT decide GO/NO-GO — that lives in the orchestrator.
  - Do NOT modify known-failures.json — read-only.
  - PROD is READ-ONLY: code compare, read-replica SELECT, read-only UI / API GET, history. Never create or modify PROD data, never payments.
  - If the PROD verification does not close within the timebox, report INDETERMINADO with what was attempted — never guess PREEXISTENTE.
  - If a failure can't be classified with high confidence, mark confidence: low and let the orchestrator escalate.
```

**Aggregation in the main thread**: after all parallel subagents return, the orchestrator merges the JSON arrays, sums the counts, and feeds the totals into the GO/NO-GO decision. Low-confidence classifications get re-reviewed inline by the orchestrator before the verdict is computed — never auto-promoted.

**Fallback to serial**: if the failure count is ≤10, classify inline — the dispatch overhead is not justified. The same decision tree above is applied per failure, just without the fan-out.

---

## 3. Environment error patterns (verbatim matches)

If the error message contains any of the strings below, it is an environment indicator.

### Network / infrastructure
- `ECONNREFUSED`
- `ETIMEDOUT`
- `ECONNRESET`
- `EAI_AGAIN`
- `ENOTFOUND`
- `net::ERR_CONNECTION_REFUSED`
- `net::ERR_NAME_NOT_RESOLVED`
- `net::ERR_INTERNET_DISCONNECTED`
- `context deadline exceeded`

### Gateway / proxy
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`
- `Cloudflare ... Error 1020` (blocked by rules)

### Browser / runtime
- `browserType.launch`
- `Browser has been closed`
- `Target page, context or browser has been closed`
- `Navigation timeout` (usually — see caveat below)

### Caveat: Navigation timeout
`Navigation timeout` on a single page after the app deploys is usually REGRESSION (slow or broken page). `Navigation timeout` across multiple unrelated pages in the same run is usually ENVIRONMENT (infra-wide slowdown). Check the scope before classifying.

---

## 4. Error-pattern → classification quick lookup

| Error pattern | Likely classification | Note |
|---------------|----------------------|------|
| `Element not found` / `locator.click: Target closed` | REGRESSION | UI changed, selector broken |
| `Timeout X ms exceeded waiting for locator` | REGRESSION or FLAKY | Check history |
| `expect(received).toBe(expected)` — assertion mismatch | REGRESSION | Logic or data change |
| `status code 500` / `status code 502` | ENVIRONMENT or REGRESSION | Isolated → REGRESSION; many tests → ENV |
| `ECONNREFUSED` | ENVIRONMENT | App down or port wrong |
| `Navigation timeout` on one page after deploy | REGRESSION | Slow page |
| `Navigation timeout` across many tests | ENVIRONMENT | Infra slowdown |
| Intermittent pass/fail on unchanged build | FLAKY | Same build, different outcomes |
| `Test passed in run #N`, fails in #N+1 with code change between | REGRESSION | Bisect the diff |
| `SyntaxError` / `TypeError` in test file | REGRESSION (test code) | Test code itself broken |
| `No snapshot found` | NEW TEST FAILURE | First run of a visual snapshot |

---

## 5. Computing flakiness (the >20% rule)

A test is FLAKY if its failure rate over the last N runs on unchanged application builds exceeds 20%.

### Algorithm

```
1. Gather results for this test from the last 10 runs of the same workflow + environment.
   (If < 10 available, use what exists but require at least 5.)

2. Exclude runs that were against a different application build
   (different commit SHA on the main branch between runs, or different deploy).
   The goal is "same build, different outcomes" — the signature of flakiness.

3. Among the remaining runs:
   failure_rate = failed_count / total_count

4. Apply threshold:
   - failure_rate > 0.20 → FLAKY
   - 0 < failure_rate ≤ 0.20 → REGRESSION candidate (unless only-in-last-run, then new failure)
   - failure_rate == 0 → not applicable (test is passing — why are you here?)

5. If N < 5: output "INSUFFICIENT HISTORY" — do not guess.
```

### Retry-aware flakiness

Playwright is configured with `retries: 2` in CI. A test that passes on retry is a hidden flake. Check Allure `retriesCount` for each result — a `passed` result with `retriesCount > 0` counts as a flake observation even though the final status is green.

When reporting flakiness rate, include retry-passes in the numerator:
```
effective_failure_rate = (failed + retried_passes) / total
```

### Getting history with gh CLI

```bash
# Last 10 runs
gh run list --workflow=regression.yml --limit=10 --json databaseId,conclusion,createdAt,headSha

# Pair of adjacent runs for comparison
gh run list --workflow=regression.yml --limit=2 --json databaseId,headSha -q '.[] | "\(.databaseId) \(.headSha)"'

# Download artifacts for trend analysis
for RUN_ID in $(gh run list --workflow=regression.yml --limit=10 --json databaseId -q '.[].databaseId'); do
  gh run download $RUN_ID -n merged-allure-results-staging -D ./history/$RUN_ID/ 2>/dev/null || true
done
```

---

## 6. REGRESSION vs FLAKY — the hard cases

The decision is easy when history is clean. The hard cases:

### Case 1: First failure after a green streak
Test passed 5 runs in a row, now fails once.
- If a code change deployed between the last pass and this failure → REGRESSION.
- If no deploy, same commit → FLAKY candidate (monitor next run).

### Case 2: Intermittent pattern matches release cadence
Test fails every Monday morning but passes other days.
- Look at scheduled jobs, cron, maintenance windows → probably ENVIRONMENT (infra cycle).

### Case 3: Passes on retry consistently
Every run shows `failed → passed on retry`.
- This is FLAKY. The user sees green but the underlying test is unstable. Stabilize it.

### Case 4: One assertion flakes within a test with N assertions
The same assertion in a multi-assertion test fails intermittently; others always pass.
- The test itself is FLAKY. Do not mark the entire test REGRESSION. Fix the one assertion (usually a timing issue).

### Case 5: Fails on one browser only
Test passes on chromium + firefox, fails on webkit.
- If the feature uses browser-specific APIs → REGRESSION (browser compat broken).
- If it is visual or layout-sensitive → could be FLAKY on webkit's slower render. Check history per browser.

---

## 7. Severity (orthogonal to classification)

Severity = business impact. A FLAKY test on checkout is still CRITICAL severity.

| Severity | Criteria |
|----------|----------|
| CRITICAL | Core user journey (login, signup, checkout, payment, core search). Any test tagged `@critical`. |
| HIGH | Major feature area (profile, dashboard, primary search filters, account management) |
| MEDIUM | Secondary feature (sorting, preferences, non-primary filters, notifications) |
| LOW | Admin-only, edge case, rare scenario, internal tools |

Severity inputs:
1. Test tags (`@critical`, `@smoke`, `@regression`).
2. Suite name (Auth, Booking, Payment = CRITICAL; Admin, Settings = LOW/MEDIUM).
3. TMS ticket priority if linked.

### Release impact matrix (classification × severity)

|                | CRITICAL | HIGH | MEDIUM | LOW |
|----------------|----------|------|--------|-----|
| **REGRESSION · INTRODUCIDO** | NO-GO | NO-GO | CAUTION | CAUTION |
| **REGRESSION · PREEXISTENTE** | CAUTION (PROD impact analyzed, Team Lead decision) | CAUTION (same) | report under "Pre-existing in PROD" | report under "Pre-existing in PROD" |
| **REGRESSION · INDETERMINADO** | CAUTION (owner + date); NO-GO if open at cut-off | CAUTION; NO-GO if open at cut-off | CAUTION | CAUTION |
| **FLAKY**      | CAUTION + stabilize now | CAUTION | monitor | monitor |
| **KNOWN**      | CAUTION (reassess ticket) | document | document | document |
| **ENV**        | re-run, escalate infra | re-run | re-run | re-run |
| **NEW TEST**   | verify manually before GO | verify | verify | verify |

---

## 8. Classification report sections

Every classified failure needs this evidence block, regardless of category:

```markdown
#### {test_name}
- Test ID: {atc_id}
- Suite: {suite}
- Classification: {REGRESSION / FLAKY / KNOWN / ENVIRONMENT / NEW}
- PROD pre-existence (REGRESSION / confirmed NEW only): {PREEXISTENTE / INTRODUCIDO / INDETERMINADO} — methods {M1..M5} · confidence {alta / media} · versions {release env vs PROD} · PROD evidence {path}
- Severity: {CRITICAL / HIGH / MEDIUM / LOW}
- Run: {run_url}
- Last passed: {date} (run #{run})
- Error:
  ```
  {full_error_message}
  ```
- Probable cause: {one-paragraph analysis}
- Screenshot: {path or url}
- Trace: {path or url}
- Ticket: {created-or-linked-ticket}
```

---

## 9. Anti-patterns

- **Classifying without reading the error.** The error text is usually definitive. Never classify based on test name alone.
- **Calling everything "flaky".** Flaky is a last resort after ruling out REGRESSION and ENVIRONMENT. Lazy flaky-tagging hides real regressions.
- **Calling everything "environment".** If only one test in the suite fails with a network error and that endpoint is hit successfully by other tests in the same run, it is not environment — it is a bug in the code path that test exercises.
- **Marking NEW TEST as REGRESSION.** A first-run failure has no prior pass to regress from. Mark as NEW TEST, verify manually, then reclassify.
- **Vetoing on a REGRESSION without the PROD check.** "Passed in the last 5 runs" proves the failure is new to the suite's history, not to PROD. Without `prod_preexistence` the veto is unfounded; a `PREEXISTENTE` failure is reported apart, never as a release regression. Writing to PROD to settle it is never acceptable — report `INDETERMINADO` instead.
- **Ignoring retry-passes.** A test that passes on retry 2 is unstable. Surface it in the flaky bucket even though Allure shows green.
- **Guessing flakiness with < 5 runs of history.** Not enough data — mark as "insufficient history" and revisit.

---

## 10. Classification flow summary (for report footer)

```
Total failed: X
├── REGRESSION:     X
│   ├── INTRODUCIDO:   X  ← release blockers (sorted by severity DESC)
│   ├── INDETERMINADO: X  ← CAUTION, escalated (owner + date); blocker if open at cut-off
│   └── PREEXISTENTE:  X  ← "Pre-existing in PROD", not blocking; Team Lead decides
├── FLAKY:          X  ← schedule stabilization
├── KNOWN ISSUE:    X  ← documented, not blocking
├── ENVIRONMENT:    X  ← re-run after infra check
└── NEW TEST:       X  ← manual verification required
```

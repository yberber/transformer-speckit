# Quality Gates Checklist: Inside the Transformer

**Purpose**: Final review of the 9 Quality Gates in [the constitution](../../../.specify/memory/constitution.md#quality-gates) (v1.0.0) against the implementation (T142)
**Created**: 2026-10-15
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md)
**Reviewed at**: commit `1fd94d3` (`main`)

**Marker semantics**: `[x]` means the gate was checked against the code and the tests named
under it, and it passes. A gate that fails stays `[ ]`, with the reason.

**About "CI results"**: this repository has no git remote yet, so the GitHub Actions workflows
([frontend.yml](../../../.github/workflows/frontend.yml),
[backend.yml](../../../.github/workflows/backend.yml)) have never run on GitHub. The evidence
below comes from running the same commands locally on macOS on 2026-10-15: in the working tree,
and for T139 in a fresh clone after `npm ci` and `uv sync`. One local difference: Node 26.8.1
instead of the pinned Node 22. Once the repository is pushed, a first green run of both
workflows should confirm this record.

## Gates

- [x] **G1. Verified calculations and model outputs** (Principle II)
  - Parameter, FLOP and KV-cache code ([params.ts](../../../frontend/src/lib/model/params.ts),
    [flops.ts](../../../frontend/src/lib/model/flops.ts),
    [kvcache.ts](../../../frontend/src/lib/model/kvcache.ts)) is tested against hand-computed
    values, with the derivations recorded in
    [gpt2-small.md](../../../frontend/tests/reference/gpt2-small.md):
    `npm run test:unit -- model/` 296 passed (Q4). Config-derived shapes equal the real
    `state_dict` shapes ([param-shapes.json](../../../frontend/tests/reference/param-shapes.json)).
  - Example data matches per-step reference runs within the documented tolerances (probabilities
    1e-4 abs, attention 1e-3 abs, vectors 0.1 % rel):
    [verify_examples.py](../../../backend/tools/verify_examples.py) `PASS`, and `--self-test`
    detects every corruption (Q2).
  - Live output equals example output:
    [test_live_matches_examples.py](../../../backend/tests/integration/test_live_matches_examples.py)
    6 passed (Q6); [fullstack.spec.ts](../../../frontend/tests/e2e/fullstack.spec.ts) 2 passed.
  - The Cost view reads only from the tested modules.

- [x] **G2. No hard-coded architecture numbers; every number traceable** (Principle I)
  - The ESLint `no-restricted-syntax` rule
    ([eslint.config.js](../../../frontend/eslint.config.js)) and
    [no-arch-literals.test.ts](../../../frontend/tests/unit/no-arch-literals.test.ts) reject
    768, 3072, 50257, 1024 and 124439808 outside `tests/reference/` and generated files:
    `npm run lint` clean, unit suite 484 passed.
  - Architecture numbers come from the verbatim bundled
    [gpt2-config.json](../../../frontend/src/generated/gpt2-config.json) through
    [config.ts](../../../frontend/src/lib/model/config.ts). Estimates are labelled
    ([EstimateLabel.svelte](../../../frontend/src/components/EstimateLabel.svelte)) and link to
    their formula in the Method view ([method.spec.ts](../../../frontend/tests/e2e/method.spec.ts),
    [cost.spec.ts](../../../frontend/tests/e2e/cost.spec.ts)).

- [x] **G3. Every user-facing string in Turkish, English and German** (Principle III)
  - [completeness.test.ts](../../../frontend/tests/unit/i18n/completeness.test.ts): every key in
    en, tr and de, with the same `{placeholders}`, and glossaries complete.
    `npm run test:unit -- i18n url palette` 122 passed (Q10).
  - `@i18n` e2e ([i18n.spec.ts](../../../frontend/tests/e2e/i18n.spec.ts)) in all three
    languages: part of the 260 passed for `--grep "@a11y|@keyboard|@i18n|@share"`.

- [x] **G4. No code path stores or logs user input** (Principle IV)
  - Backend canary: [test_canary.py](../../../backend/tests/privacy/test_canary.py) 3 passed
    (Q9). The request log holds only the route template
    ([logging.py](../../../backend/app/logging.py)); errors never echo the input
    ([errors.py](../../../backend/app/errors.py)); uvicorn runs with `--no-access-log`
    ([Dockerfile](../../../backend/Dockerfile), [playwright.config.ts](../../../frontend/playwright.config.ts)).
  - Frontend canary: [privacy.spec.ts](../../../frontend/tests/e2e/privacy.spec.ts) 1 passed. Live
    text never reaches the URL, localStorage, sessionStorage or IndexedDB.
  - Manual Q5 check: after a 65-token request, the service log did not contain the text, and
    the 422 body held only `{limit, actual}`.

- [x] **G5. Example mode works with the service stopped; live failures are contained** (Principle V)
  - `@example-mode` ([example-mode.spec.ts](../../../frontend/tests/e2e/example-mode.spec.ts))
    14 passed, including with the network blocked after load. The default build has no API.
  - `@live` ([live.spec.ts](../../../frontend/tests/e2e/live.spec.ts)) 37 passed: unreachable
    service, rate limit, busy, too long, internal error and waking (with and without CORS) each
    show a translated message and "Back to examples", and the other views keep working.
  - Live mode is a lazy chunk behind its own error boundary
    ([App.svelte](../../../frontend/src/App.svelte)).

- [x] **G6. Keyboard-only use works; zero axe violations on main views** (Principle VI)
  - [a11y.spec.ts](../../../frontend/tests/e2e/a11y.spec.ts): 0 violations (WCAG 2.1 A/AA) on
    all 8 views × light/dark × en/tr/de × chromium/mobile, with details closed and open, and no
    placeholder views left. Live input, waking and error states × theme × language are covered
    too (T130): 114 passed.
  - [keyboard.spec.ts](../../../frontend/tests/e2e/keyboard.spec.ts) (T131): every FR-043
    scenario with the keyboard only, including live mode and live mode with the service
    unavailable, with a visible focus indicator checked at every focus stop: 20 passed.
  - [responsive-motion.spec.ts](../../../frontend/tests/e2e/responsive-motion.spec.ts) (T132):
    no horizontal page scroll at 360 px; with reduced motion, no animations and the same final
    state. 10 passed after two fixes made in T132.

- [x] **G7. Performance budgets met** (Principle VII)
  - `npm run check:budgets` ([check-budgets.mjs](../../../frontend/scripts/check-budgets.mjs)):
    initial load 256,961 B (< 2,000,000 B); 87 data files, largest 196,608 B (< 300,000 B).
  - `npm run lhci` ([lighthouserc.json](../../../frontend/lighthouserc.json), mobile preset, 3 runs,
    median): performance 0.98, LCP 2,111 ms, TBT 0 ms, 224,650 B. Also passes on a build with
    `VITE_API_BASE_URL` set (T133). Re-run in the T139 clean checkout: all assertions passed.
  - No budget was raised.

- [x] **G8. No unjustified dependency or infrastructure** (Principle VIII)
  - Every direct dependency in [package.json](../../../frontend/package.json) (1 runtime, 17
    dev) and [pyproject.toml](../../../backend/pyproject.toml) (7 runtime, 6 dev) has a row in
    [plan.md → Dependency justification](../plan.md#dependency-justification-principle-viii).
    Checked name by name.
  - Runtime components: the static site (GitHub Pages) and one CPU service (Hugging Face Space).
    No database, queue, cache, auth or accounts. The added workflow
    ([space-deploy.yml](../../../.github/workflows/space-deploy.yml)) is deploy automation for
    the existing Space, not a new component.
  - Observation, not a failure: `uvicorn[standard]` also installs uvicorn's optional extras
    (uvloop, httptools, websockets, watchfiles, python-dotenv). plan.md justifies "Uvicorn"
    without naming the extras. Either note them in that row or depend on plain `uvicorn`.

- [x] **G9. Contract tests pass on both sides; README current** (Principle IX)
  - Backend: [test_api_contract.py](../../../backend/tests/contract/test_api_contract.py)
    `uv run pytest tests/contract` 30 passed. Real responses validate against
    [inference-api.openapi.yaml](../../../contracts/inference-api.openapi.yaml).
  - Frontend: `npm run test:contract` 55 passed (fixtures and example data against the schema;
    the client handles every response and error). `npm run check:api-types`: the generated types
    are current.
  - README: [readme-doc-check.test.ts](../../../frontend/tests/unit/readme-doc-check.test.ts)
    covers every npm script, backend tool and entry point, and every quickstart command (T134).
    The final review was done in T138.

## Outside the gates, still open

These release tasks were deliberately not part of this run. Neither changes a gate result.

- **T140**: deploy Pages and the Space, then run quickstart Q8 (wake-up behavior) and record it
  under the R13 open item in [research.md](../research.md).
- **T141**: the SC-005 usability session with 5 or more participants
  (`usability-study.md`).

## Result

All 9 gates pass, based on local runs at `1fd94d3`. A first green GitHub Actions run of both
workflows after the repository is pushed should confirm it, and T140 and T141 remain before
release.

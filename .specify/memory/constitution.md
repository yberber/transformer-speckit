<!--
Sync Impact Report
==================
Version change: (unversioned template) → 1.0.0
Bump rationale: Initial ratification; all placeholders replaced with project principles.

Modified principles (template slot → new title):
  - [PRINCIPLE_1_NAME] → I. Accuracy over Appearance
  - [PRINCIPLE_2_NAME] → II. Verified Calculations
  - [PRINCIPLE_3_NAME] → III. Built for Non-Experts
  - [PRINCIPLE_4_NAME] → IV. Privacy by Default
  - [PRINCIPLE_5_NAME] → V. Always Usable

Added principles:
  - VI. Accessible
  - VII. Performance Budgets
  - VIII. Simplicity
  - IX. Documented Contracts

Added sections:
  - Technical Constraints (template [SECTION_2_NAME])
  - Quality Gates (template [SECTION_3_NAME])

Removed sections: none

Follow-up TODOs:
  - PROJECT_NAME inferred from the repository directory ("transformer-speckit"); rename the
    title if the product gets a different public name (PATCH amendment).
  - RATIFICATION_DATE set to the date of this first adoption (2026-10-14).
-->

# Transformer Speckit Constitution

## Core Principles

### I. Accuracy over Appearance

Every number shown to the user MUST come from exactly one of these sources:

- a real model output (live inference or a recorded reference run);
- a value derived at runtime or build time from the official model config;
- a theoretical estimate that is visibly labelled as an estimate in the UI and links to,
  or shows, its documented formula.

Architecture numbers (layer count, hidden size, head count, vocabulary size, context length,
parameter counts, etc.) MUST NOT be hard-coded in application code or UI text. They MUST be read
from or computed from the official model config. Illustrative or rounded values MUST NOT be
presented as if they were measured.

**Rationale**: The site exists to teach how transformers really work. A plausible-looking but
wrong number does more harm than showing no number at all.

### II. Verified Calculations

- Every FLOP, parameter and memory calculation MUST be covered by automated tests that compare
  its output against hand-computed reference values. The reference values and how they were
  derived MUST be recorded alongside the tests.
- Model outputs shown by the site (including example data) MUST be verified against a reference
  run. The allowed numeric tolerance MUST be documented, and tests MUST fail when it is exceeded.
- A calculation without a passing reference test MUST NOT be shown to users.

**Rationale**: Principle I is only enforceable if correctness is checked mechanically, not by
inspection.

### III. Built for Non-Experts

- Explanations MUST use plain language aimed at readers without a machine-learning background.
- Technical terms (e.g. "attention", "embedding", "token") MUST stay in English in every locale
  and MUST be accompanied by a short plain-language explanation the first time they appear in a
  view.
- Views MUST be simple by default; additional detail MUST be revealed on demand (for example via
  expandable sections or an explicit "show details" control), never forced on first view.
- The entire UI MUST be available in Turkish, English and German. No user-facing string may
  ship in only one or two of these languages.

**Rationale**: The audience is curious non-experts across three language communities; complexity
is opt-in, not the starting point.

### IV. Privacy by Default

User input (such as text entered for tokenization or inference) MUST NOT be stored or logged
anywhere: not in databases, files, server or proxy logs, analytics, or error reports. Input MAY
be held in memory only for the duration of the request that processes it.

**Rationale**: Users may type personal text to try the model. Never retaining it removes the
privacy risk entirely instead of managing it.

### V. Always Usable

- Example mode MUST work entirely without a running server and without downloading any model.
  It MUST be backed by pre-generated example data shipped with the static frontend.
- Any failure of the live mode (server unreachable, timeout, error response, slow model) MUST be
  contained: the affected view shows a clear, translated message and offers example mode, and
  all other parts of the site keep working.

**Rationale**: The site must remain useful for teaching even when the inference service is down,
slow, or not deployed at all.

### VI. Accessible

- Every feature MUST be fully usable with the keyboard alone, including interactive
  visualizations, with a visible focus indicator.
- Automated accessibility checks MUST report zero violations on all main views, and these checks
  MUST run as part of the automated test suite.

**Rationale**: An educational tool must be usable by everyone; automated checks keep
accessibility from regressing silently.

### VII. Performance Budgets

The following budgets are hard limits and MUST be checked automatically:

- Initial page load (all transferred resources needed for first render): under 2 MB.
- Each example data file: under 300 KB.
- Lighthouse performance score in example mode: 90 or higher.

A change that breaks a budget MUST NOT be merged unless this constitution is amended first.

**Rationale**: The site should load quickly on ordinary connections and devices, which also keeps
the architecture honest about what it ships.

### VIII. Simplicity

- The system consists of a static frontend plus one small, CPU-only inference service. No other
  runtime components (databases, queues, caches, GPU services, additional backends) may be added.
- There MUST be no user accounts, authentication or user profiles.
- Every new dependency or piece of infrastructure MUST be justified by a concrete requirement
  that cannot reasonably be met with what already exists; the justification MUST be recorded in
  the feature's plan.

**Rationale**: A small, understandable system is cheaper to run, easier to secure, and easier to
keep correct.

### IX. Documented Contracts

- The API contract between frontend and inference service MUST be documented in a single
  authoritative, versioned location.
- The contract MUST be tested on both sides: the backend verifies it produces conforming
  responses, and the frontend verifies it handles conforming (and error) responses correctly.
- The README MUST explain how to run, test and deploy the project and how to regenerate the
  example data. Any change that affects these steps MUST update the README in the same change.

**Rationale**: Frontend and backend evolve separately; an explicit, tested contract and current
operating instructions prevent silent drift.

## Technical Constraints

- **Architecture**: static frontend + one CPU-only inference service (Principle VIII).
- **Languages**: UI in Turkish, English and German; technical terms in English (Principle III).
- **Data sources for numbers**: model outputs, official model config, or labelled estimates with
  documented formulas only (Principle I).
- **Offline-capable example mode**: no server, no model download (Principle V).
- **Budgets**: initial load < 2 MB; example data file < 300 KB; Lighthouse performance ≥ 90 in
  example mode (Principle VII).
- **Data handling**: user input never persisted or logged (Principle IV).

## Quality Gates

Every feature MUST pass all of the following before it is considered done:

1. Reference tests for all FLOP, parameter and memory calculations pass, and model outputs are
   within the documented tolerance of the reference run (Principle II).
2. No hard-coded architecture numbers; every displayed number is traceable to its source
   (Principle I).
3. All new user-facing strings exist in Turkish, English and German (Principle III).
4. No code path stores or logs user input (Principle IV).
5. Example mode works with the inference service stopped, and live-mode failures are contained
   (Principle V).
6. Keyboard-only use works and automated accessibility checks report zero violations on main
   views (Principle VI).
7. Performance budgets are met (Principle VII).
8. No unjustified new dependency or infrastructure (Principle VIII).
9. API contract tests pass on both sides, and the README is current (Principle IX).

Feature plans MUST include a Constitution Check that addresses each principle; any deviation
MUST be listed explicitly with its justification.

## Governance

- This constitution takes precedence over all other project documents, including specs, plans,
  tasks, README and code comments. Where they conflict, this constitution wins and the
  conflicting document MUST be corrected.
- Any change to this constitution MUST be stated explicitly, together with the reason for the
  change. Implicit or undocumented deviations are not permitted.
- Versioning follows semantic versioning:
  - MAJOR: removal or backward-incompatible redefinition of a principle or governance rule.
  - MINOR: a new principle or section, or materially expanded guidance.
  - PATCH: clarifications, wording or typo fixes with no change in meaning.
- Compliance is reviewed at every planning step (Constitution Check in each plan) and before
  each feature is marked complete (Quality Gates above).

**Version**: 1.0.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-14

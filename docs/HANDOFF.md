# Handoff — Katubaya Solana Bridge (`farmer-core`)

Last updated 2026-10-17, on top of `c0b58c9`. For the next agent; the user writes in Portuguese, so
**answer in Portuguese**. This file carries only what is *not* written down elsewhere in the repo —
everything factual about the program lives in the artifacts in section 2, and every claim here points
at one rather than restating it.

## 1. Status

The roadmap in `docs/DEVELOPMENT_PLAN.md` is **closed**: M0–M6 plus the M6.1 follow-up are delivered on
`main`, and M7 is specified and deliberately deferred (README section 16 holds the decision and the
warning that `LotOffer.pack_ref` is never validated — read it before "finishing" M7).

**No focus is defined for the next session.** The user drives; there is no work in flight, no branch,
no stash, nothing uncommitted, and nothing deployed to any cluster (`declare_id!` is still the local
`target/deploy` keypair). Last verified state: `anchor test` 136 passing, `cargo fmt --check` clean,
`cargo clippy -p farmer-core --all-targets` 0 warnings.

Re-derive the shape of the program instead of trusting a number here:

```bash
python3 -c "import json;i=json.load(open('target/idl/farmer_core.json'));print(len(i['instructions']),'ix',len(i['accounts']),'accounts',len(i['events']),'events',len(i['errors']),'errors')"
git log --oneline            # milestone commits, one per milestone, bodies carry the detail
```

## 2. Read these first (do not re-derive, do not re-explain)

| What | Where |
|---|---|
| Repo rules, conventions, test helpers, **all** environment gotchas and the two numbers you must measure rather than recite | `AGENTS.md` (see "Common Errors and Solutions" and "Measuring, Not Reciting") |
| Product spec: accounts, lifecycle, fees, instruction set, events, security notes, the M7 decision | `README.md` sections 5–12 and 16 |
| Roadmap, definition of done, per-instruction checklist | `docs/DEVELOPMENT_PLAN.md` |
| Behaviour, technical reference and change log, per instruction | `LLM/instructions/<name>/`, three files each |
| What each milestone changed and why | `git log` bodies |

## 3. Working agreement with the user (the one thing written down nowhere else)

1. **Per milestone, in this order**: present a compact spec (accounts table with signer and
   constraints, handler, new errors, events, tests, and numbered "proposals you can veto") → wait for
   "Confirmado" → **tests first** → implementation → `anchor test` green → `cargo fmt` → docs →
   present results → **wait for an explicit go before `git commit`**. Never commit without it.
   Milestones go straight onto `main`, one commit each, message in the style of `git log`.
2. **Ponytail mode is on** (`ponytail:ponytail`, level full): shortest working diff, no speculative
   abstractions, no scaffolding, terse reports. `[lite]` means "build it and name the lazier
   alternative in one line".
3. The user vetoes and redirects freely and wants the trade-off stated, not hidden. When a decision is
   theirs, give a numbered proposal with a recommendation — including the proposal that the work
   should not exist at all, which is how M7 ended up deferred.
4. Two user intentions that the code cannot tell you: unused error variants (`CustomerNotFound`) and
   unused README events (`OrderCanceled`) are kept on purpose ("serão utilizados em breve"), and the
   per-instruction doc folders are expected to be rewritten against current code, not appended to.

Everything else about how to build here — id strategy, gates as `#[account]` constraints, checked
math, the single error enum with variants appended only at the end, the escrow design, the pause
radius — is in `AGENTS.md`. Read it; do not reopen those.

## 4. Settled, with the reason recorded — do not "fix" these

Each is deliberate and documented at the path given.

- A replayed terminal call fails with `AccountNotInitialized`, not `InvalidOrderStatus`, because the
  escrow is closed → `README.md` section 8.7, `LLM/instructions/complete_order/`.
- An order already `InTransit` has no customer-side exit; operator rotation is the recovery path and a
  lost admin key is unmitigated → `LLM/instructions/update_warehouse/HOW_IT_WORKS.md`.
- Only one of the five denied mint extensions is exercised by a test, and `tests/token2022.ts` is the
  negative control → `LLM/instructions/publish_offer/`.
- Surplus tokens in an escrow go to logistics on completion, to the customer on a refund →
  `README.md` section 8.6.
- `pack_ref` is written, never validated, never read → `README.md` section 16.
- Per-instruction compute figures are rounded on purpose → `AGENTS.md` "Measuring, Not Reciting".

## 5. Genuinely open, never ruled on by the user

Raise these as proposals rather than silently fixing them.

- `ZipPrefix.prefix` is not bounded against `len`: `{ prefix: 123456, len: 3 }` passes in both
  `create_warehouse` and `update_warehouse`.
- No `update_config`: `admin`, `logistics_wallet` and `allowed_mints` are frozen after `init_config`,
  so a compromised admin key cannot be rotated.
- No `cancel_order`, although README section 6 says the customer may cancel before transit and the
  `OrderCanceled` event exists and is never emitted.
- No farmer revocation: a farmer removed from a warehouse off-chain is still paid by `complete_order`.
- Codama client generation from the IDL (README section 14, Phase 1) was never done.
- `OfferPublished` carries no `pack_ref`; an indexer must fetch `LotOffer` for it.

## 6. Multi-agent shapes that earned their keep

The user opted into multi-agent work. Scripts live under the session directory and will not survive —
re-author from the pattern, after loading the `workflow-authoring` skill.

1. **Scout before writing**, one agent per external unknown, each forced to *run* something and report
   verified facts, blockers and a paste-ready snippet. This is what proved litesvm viable and settled
   Anchor's exit-serialization behaviour for a CPI-closed token account before a line was written.
2. **Docs as writer + adversarial verifier, one pair per instruction folder**, the verifier instructed
   to assume errors until it has checked each claim against the code and the IDL, and to fix them in
   place. It caught stale account tables, an inverted signer story and invented test claims every run.
3. **Review as dimensions → adversarial verify**, two refuters per finding (one on reachability, one
   on impact), each defaulting to "refuted". Zero M6 findings survived, which was the point: the
   surviving low-severity notes were the real work — a missing discriminating test, a wrong payout
   rule in the README, a duplicated helper.

## 7. Suggested skills

Call these with the Skill tool when the matching work comes up:

- `ponytail:ponytail` — keep the lazy-minimal discipline the user expects; `ponytail:ponytail-review`
  to self-review a milestone diff before presenting it.
- `mattpocock-skills:tdd` — the user mandates tests before code; the house style is in `AGENTS.md`.
- `workflow-authoring` — before writing any multi-agent workflow script (section 6).
- `security-review` and `code-review` — for a milestone diff touching token CPIs, PDA seeds, status
  transitions or arithmetic.
- `mattpocock-skills:diagnosing-bugs` — when `anchor test` goes red for non-obvious reasons (validator
  timing, Anchor constraint order).
- `mattpocock-skills:handoff` — **user-invocable only.** Ask the user to run it; do not imitate it.
  Its default destination is the OS temp directory; this copy lives in the repo because the previous
  one rotted in `/tmp`, at the user's explicit request.

# Contract: Shareable URL State (v1.0.0)

Public interface: links people share must keep working. The site is one `index.html`; state
lives in the query string, formula anchors in the fragment.

```text
https://<host>/<base>/?ex=<id>&view=<view>&layer=<1..L>&head=<1..H>&step=<0..steps>&lang=<en|tr|de>[&mode=live][#formula-id]
```

| Key | Domain | Default | Notes |
|---|---|---|---|
| `mode` | `example`, `live` | `example` | `live` restores live mode with an **empty** text field |
| `ex` | example id from `index.json` | first example | ignored when `mode=live` |
| `view` | `tokens`, `embeddings`, `blocks`, `attention`, `prediction`, `architecture`, `cost`, `method` | `tokens` | `method` = "How we calculate" |
| `layer` | integer 1..`n_layer` | 1 | 1-based, as shown in the UI |
| `head` | integer 1..`n_head` | 1 | 1-based |
| `step` | integer 0..`run.steps` | 0 | |
| `lang` | `en`, `tr`, `de` | see precedence | |
| fragment | formula id (e.g. `#decode-flops`) | — | only meaningful with `view=method` |

## Rules

1. **Never contains user text** (FR-034). There is no key for it; the serializer has no access to
   the live text. In live mode, "Copy link" explains that the text is not included.
2. **Language precedence**: `lang` in URL > stored preference (localStorage) > browser
   `navigator.languages` (first of `tr`/`de`/`en` matched by primary subtag) > `en`.
3. **Normalization**: unknown keys are ignored. Invalid values are replaced: unknown `ex`/`view`/
   `lang` ⇒ default; out-of-range `layer`/`head` ⇒ clamped to the nearest valid value; `step`
   beyond the run ⇒ last valid step; non-integers ⇒ default. If anything was replaced, a one-time
   translated notice says part of the link could not be restored (US7-3). The normalized URL is
   written back with `history.replaceState`.
4. **Serialization**: keys always written in the order above; defaults may be omitted except
   `lang` and `ex`, which are always written so a link is stable regardless of the receiver's
   browser.
5. **History**: changing `view`, `ex` or `mode` uses `pushState` (Back returns to the previous
   view); `layer`, `head`, `step`, `lang` use `replaceState`.
6. **Theme** is not part of the URL.
7. **Round-trip test** (SC-010): for a matrix of example × view × layer × head × step × lang,
   `parse(serialize(state)) == state`, and opening the URL in a fresh browser context renders the
   identical state (e2e).

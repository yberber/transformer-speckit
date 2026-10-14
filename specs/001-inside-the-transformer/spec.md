# Feature Specification: Inside the Transformer

**Feature Branch**: `001-inside-the-transformer` (spec directory; no branch hook configured, work currently on `main`)

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "PART A — Product specification for 'Inside the Transformer': a public website that lets curious non-experts see how a language model (GPT-2 small) turns text into new text, step by step, with real numbers — example mode with six precomputed texts, opt-in live mode, six explore views (tokenization, embeddings, transformer blocks, attention, next-token prediction, architecture), compute-cost statistics, three UI languages, shareable view URLs, accessible and polished visual design." (Full text supplied with the `/speckit-specify` command; every section is reflected below.)

## Clarifications

### Session 2026-10-14

- Q: How closely must the other model values on the site (attention weights, embedding numbers, and the "how much this layer changed each token" summaries) match the reference GPT-2 run? → A: Attention weights within 0.001 (absolute); embedding and other vector values within 0.1% (relative). Probabilities keep 0.0001 (absolute).
- Q: Should the Embeddings view show all 768 numbers of each token's vectors, or only a labelled subset? → A: All values: a compact color strip per vector, with the full number table under "Show details"; embedding data may load when the view is first opened.
- Q: Where should the live-mode input limit be checked: in the visitor's browser before the text is sent, or by the inference service? → A: The service counts tokens exactly before running the model and returns the count in a translated error; the browser applies only a rough character cap. Live-mode limits changed to 64 input tokens and 64 generation steps.
- Q: The long examples are 80–120 tokens, over the new 64-token live input limit. How should the spec resolve this? → A: Shorten the length bands so every example fits the live limit (short about 5–15, medium about 20–35, long about 50–64 tokens); "continue in live mode" re-runs the example's original text.
- Q: How should the Blocks view measure "how strongly the attention part or MLP part changed each token"? → A: Relative size of the change: length of the added update ÷ length of the token's vector before that part, shown as a percentage.

## User Scenarios & Testing *(mandatory)*

Priority mapping: the user's **Must** items are P1, **Should** items are P2, **Could** items are P3.

### User Story 1 - Watch the model continue an example text (Priority: P1)

A curious visitor with no ML background opens the site. They learn in one or two sentences that GPT-2 is a text-completion model (it continues text; it does not answer questions like a chat assistant). They pick one of six built-in example texts. They see the text split into tokens, each with its ID and its own color. They see the model's ten most likely next tokens with their probabilities. They press "Next token" and watch the most likely token get appended, then do it again, one token at a time.

**Why this priority**: This is the core idea of the site: text goes in, tokens come out one at a time. It works without any server, so it is the smallest version of the product that is still useful.

**Independent Test**: With the inference service switched off and the network blocked after the first page load, open the site, choose each of the six examples, step through tokenization and next-token prediction, and generate tokens until the precomputed limit. Every value matches the reference run.

**Acceptance Scenarios**:

1. **Given** a first-time visitor on the landing view, **When** the page loads, **Then** example mode is active, an example is preselected, and a short plain-language note explains that GPT-2 continues text rather than answering questions.
2. **Given** the example picker, **When** the visitor opens it, **Then** six examples are listed and labelled by length (two short, two medium, two long). Every example is written as text to continue, not as a question.
3. **Given** a selected example, **When** the Tokenization view is shown, **Then** the text appears split into tokens, each in a distinct color. "Show details" reveals each token's ID and its exact text, with leading spaces shown visibly.
4. **Given** a selected example at generation step 0, **When** the Prediction view is shown, **Then** the ten most likely next tokens appear with their probabilities, ordered from highest to lowest. The top candidate is marked as the one greedy decoding will pick.
5. **Given** the Prediction view, **When** the visitor activates "Next token", **Then** the top candidate is appended to the text with a new color, the step counter advances by one, and every view now reflects the new step.
6. **Given** generation step k > 0, **When** the visitor steps back, **Then** the views return exactly to step k−1. Results are deterministic, so stepping forward again reproduces the same token.
7. **Given** the last precomputed step of an example, **When** the visitor looks at "Next token", **Then** the control is disabled and a message says the example ends here. If live mode is available, the message offers it as a way to continue: this re-runs the example's original text in live mode, where generation can go up to the live-mode step limit (64).

---

### User Story 2 - Look inside the machine: embeddings, layers and attention (Priority: P1)

The visitor follows their text deeper into the model. They see how every token becomes a list of numbers (a token embedding plus a position embedding). They step through all 12 transformer blocks. In each block they see an attention part (which earlier tokens each token "looks at") and a feed-forward (MLP) part (which reshapes each token's numbers on its own). In the Attention view they choose any layer and any head and see a heatmap of attention weights between tokens.

**Why this priority**: This is the "open up the machine" promise from the vision. Without it, the site would only show input and output.

**Independent Test**: Open any example in example mode. Open the Embeddings view, step from layer 1 to layer 12 in the Blocks view, switch heads in the Attention view, and confirm each value matches the reference run within tolerance. All of this works with the keyboard alone.

**Acceptance Scenarios**:

1. **Given** a selected example, **When** the Embeddings view is shown, **Then** each token's token embedding, position embedding and their sum are shown as compact color strips covering every dimension (the hidden size from the model config). "Show details" reveals the exact numbers for every dimension.
2. **Given** the Blocks view, **When** the visitor moves to the next or previous layer, **Then** the layer indicator updates (layer 1 to 12, counted from the model config) and the view shows that block's attention part and MLP part for the current tokens.
3. **Given** the MLP part of a block, **When** it is shown, **Then** it shows that each token's vector is expanded to a larger hidden size, passed through an activation and compressed back, using sizes read from the model config. It also shows how strongly the MLP changed each token's representation, as a percentage: the length of the MLP's added update divided by the length of the token's vector before the MLP part.
4. **Given** the Attention view, **When** the visitor picks a layer and a head, **Then** a heatmap shows the attention weight from every token (row) to every earlier or same token (column). Future positions are visibly masked, and each row sums to 1 within display rounding.
5. **Given** a heatmap cell or token, **When** the visitor focuses or hovers it, **Then** the two tokens involved are highlighted in their own colors and the exact weight is available on demand.
6. **Given** any generation step, **When** the visitor opens Embeddings, Blocks or Attention, **Then** the data shown covers all tokens up to and including that step.

---

### User Story 3 - Explore the architecture with real numbers (Priority: P1)

A student wants to know how big each part of GPT-2 small is. They open the Architecture view. A diagram shows the whole model: token and position embeddings, 12 repeated blocks (each with layer norms, attention and MLP), a final layer norm and the output (LM head). All sizes come from the official model config. Selecting any weight matrix shows its shape, its parameter count and its share of all parameters.

**Why this priority**: This is a Must item. It is also the main reference for secondary users who want exact numbers.

**Independent Test**: Open the Architecture view and select every weight matrix. Each shape and parameter count matches values computed by hand from the official config. The total equals the reference total, and the shares add up to 100%.

**Acceptance Scenarios**:

1. **Given** the Architecture view, **When** it loads, **Then** the diagram shows every component type, and the repeated block is labelled with the layer count from the config.
2. **Given** a weight matrix or bias in the diagram, **When** the visitor selects it by pointer or keyboard, **Then** a panel shows its name, shape, parameter count, and its share of total parameters as a percentage.
3. **Given** the LM head, **When** it is selected, **Then** the panel explains that it shares its weights with the token embedding and is not counted twice in the total.
4. **Given** the diagram, **When** the visitor activates a component, **Then** they can jump to the explore view that shows that component in action (for example, from an attention block to the Attention view at that layer).

---

### User Story 4 - Understand what one token costs to compute (Priority: P1 for per-token and per-layer statistics; P2 for the context-length chart; P3 for the KV-cache view)

A student wants to know how much computation it takes to produce each token. The Cost view shows estimated FLOPs for processing the input (prefill) and for generating each new token (decode). It breaks these down per layer and per component (QKV projection, attention scores and weighting, output projection, MLP, embeddings, LM head). It shows totals for the current text based on its input and output token counts. A chart shows how cost grows as the context gets longer, and the view shows how much memory the KV cache takes for the current context. Every number is clearly labelled as a theoretical estimate and links to "How we calculate".

**Why this priority**: Per-token and per-layer statistics are Must items. The chart is a Should item and the KV-cache view a Could item, so they can be delivered in later slices.

**Independent Test**: For each example and generation step, compare every displayed estimate with independently hand-computed reference values derived from the model config and the documented formulas.

**Acceptance Scenarios**:

1. **Given** an example at step k, **When** the Cost view is shown, **Then** it shows prefill FLOPs for the input tokens, decode FLOPs for the token at step k, and running totals for input plus all generated tokens so far.
2. **Given** the per-layer breakdown, **When** shown, **Then** every layer appears with its estimate, split into the listed components. Embeddings and LM head appear as separate, non-layer components.
3. **Given** any estimate on screen, **When** the visitor looks at it, **Then** it carries a visible "theoretical estimate" label and a link to the formula on the "How we calculate" page.
4. **Given** the context-length chart, **When** shown, **Then** it plots estimated decode cost per token from context length 1 up to the model's maximum context length from the config, with the current context length marked.
5. **Given** the current context, **When** the KV-cache panel is shown, **Then** it shows the estimated KV-cache memory for the current number of tokens and explains what the KV cache stores.

---

### User Story 5 - Use the site in my own language (Priority: P1)

A visitor whose browser is set to Turkish or German sees the whole interface in that language. Technical terms (token, attention, embedding, layer, and the others in the glossary) stay in English, each with a short plain-language explanation in the visitor's language. The visitor can switch language at any time without losing their place.

**Why this priority**: Three languages are a Must item and a constitutional requirement.

**Independent Test**: Open the site with the browser language set to Turkish, German, English and an unsupported language (e.g. French). Confirm the correct default (unsupported falls back to English). Switch language on every main view and confirm that the view state is kept and no string is untranslated.

**Acceptance Scenarios**:

1. **Given** a browser preferring Turkish or German, **When** the site first loads with no language in the URL, **Then** the UI appears in that language. For any other browser language it appears in English.
2. **Given** any view, **When** the visitor changes the language, **Then** all UI text changes immediately, while the example, layer, head, generation step and theme stay the same.
3. **Given** a technical term's first appearance in a view, **When** it is shown, **Then** the term is in English and an explanation in the current UI language is available next to it.

---

### User Story 6 - Try my own text with live mode (Priority: P2)

A visitor wants to see what GPT-2 does with their own sentence. They switch to live mode, type a text to continue, and run it. The model runs on a small inference service, so nothing is downloaded to their device. All views work exactly as in example mode, including generating one token at a time. If the service is asleep, they see that it is waking up. If it is unavailable, they get a clear message and can go back to the examples, which keep working.

**Why this priority**: Live mode is a Should item. It makes the site personal, but the site is complete for teaching without it.

**Independent Test**: With the service running, enter the exact text of each built-in example in live mode and confirm that tokens match exactly and probabilities match example mode within tolerance. Then stop the service and confirm the error message appears and example mode stays fully usable.

**Acceptance Scenarios**:

1. **Given** example mode, **When** the visitor chooses live mode, **Then** a text field appears with a hint that GPT-2 continues text and works best with English, plus a note that the text is never stored.
2. **Given** a valid text in live mode, **When** the visitor runs it, **Then** all explore views and the Cost view show results for that text and look and behave the same as in example mode.
3. **Given** the text of a built-in example entered in live mode, **When** it is run, **Then** the tokens are identical and every probability is within 0.0001 of example mode.
4. **Given** the inference service is starting up from sleep, **When** the visitor runs a text, **Then** a translated "waking up" status appears with an option to cancel. The request either completes or fails with a clear message within the documented wait limit.
5. **Given** the inference service is unreachable or returns an error, **When** the visitor runs a text, **Then** a translated message explains the problem, offers to return to example mode, and every other part of the site keeps working.
6. **Given** a text that ends with a question mark or reads like a chat request, **When** it is entered, **Then** a gentle tip reminds the visitor that GPT-2 will continue the text rather than answer it. The run is not blocked.

---

### User Story 7 - Share exactly what I'm looking at (Priority: P2)

A teacher finds an interesting attention head in layer 5 at generation step 3 of a long example and wants to send it to students. The page address always reflects the current view (example, view, layer, head, generation step, language). Opening the address restores exactly that view.

**Why this priority**: Shareable URLs are a Should item. They add value for teaching but are not needed for a single visitor's understanding.

**Independent Test**: Set a non-default example, view, layer, head, step and language. Copy the address, open it in a fresh browser session, and confirm that the identical view appears.

**Acceptance Scenarios**:

1. **Given** any example-mode view state, **When** the visitor uses "Copy link" or copies the address, **Then** the link encodes example, view, layer, head, generation step and language.
2. **Given** a shared link, **When** it is opened in a new session, **Then** the site shows exactly that state, and the link's language overrides the browser language.
3. **Given** a link with missing, out-of-range or unknown values, **When** it is opened, **Then** the site falls back to the nearest valid state (e.g. the last valid step or the default head), shows it without errors, and briefly says that part of the link could not be restored.
4. **Given** a live-mode view, **When** the visitor tries to share it, **Then** the site explains that their own text is not included in links, to protect their privacy.

---

### User Story 8 - Learn how the estimates are calculated (Priority: P1 for documented formulas; P3 for interactivity)

A developer wants to check the numbers. The "How we calculate" page documents every formula behind the parameter counts, FLOP estimates and KV-cache memory. It lists the assumptions (counting convention, what is included and excluded, number precision) and the reference values. In its interactive form the visitor can change the context length or token counts and watch the results update.

**Why this priority**: The constitution requires documented formulas, so the static documentation is part of the P1 statistics. The interactive formulas are a Could item.

**Independent Test**: For every estimate shown anywhere on the site, follow its link and recompute the value by hand from the formula on the page. The results match.

**Acceptance Scenarios**:

1. **Given** any estimate in the UI, **When** the visitor follows its "How we calculate" link, **Then** the page opens at the matching formula.
2. **Given** the page, **When** it is read, **Then** each formula names its inputs, which come from the model config or from the current text's token counts, and shows a worked GPT-2 small example.
3. **Given** the interactive version, **When** the visitor changes context length or token counts, **Then** the results recompute immediately using the same calculations as the rest of the site.

---

### Edge Cases

- **Text that is not English** (live mode): GPT-2 was trained mostly on English. Turkish or German input is processed, and the UI explains that such text splits into many small tokens and gives weaker continuations.
- **Characters split across tokens** (emoji, accented letters): a token may hold only part of a character. The token is shown as its byte values with an explanation, not as a broken glyph.
- **Leading spaces and line breaks**: these belong to tokens and are shown visibly (e.g. as a subtle marker), so that splits like " the" make sense.
- **End-of-text token**: if the most likely next token is GPT-2's end-of-text token, it is shown as a labelled marker and generation stops with an explanation.
- **Repetitive output**: greedy decoding often makes GPT-2 repeat itself. When the generated text repeats, a short note explains that this is normal for greedy decoding, not a bug.
- **Live input limits**: empty or whitespace-only input cannot be run. Input longer than 1,000 characters cannot be sent (rough cap in the browser). The inference service counts tokens exactly before running the model: input over 64 tokens is rejected without running the model, and a translated message gives the limit and the actual token count. Generation stops at the generation-step limit or at the model's maximum context length, whichever comes first.
- **Literal special-token text typed by the user** (e.g. "<|endoftext|>"): it is treated as ordinary text so live mode and example mode behave the same; the treatment is documented.
- **Service busy or rate-limited**: the visitor sees a translated "busy, try again shortly" message, and example mode stays available.
- **Slow or dropped connection mid-request**: the request times out with a clear message. A partially received result is never shown as if it were complete.
- **Long contexts on small screens**: if the full attention heatmap would be too small to read, the view switches to a focused mode. The visitor picks one token and sees its attention as a ranked list or a single row, with the same data.
- **Many tokens and colors**: the longest texts have more tokens than there are clearly distinct colors. Colors may repeat, but a token's color never changes between views, and color is never the only way to tell tokens apart; text labels or positions are always present.
- **Reduced motion**: when the visitor's system asks for reduced motion, data-flow animations are replaced by instant state changes with the same information.
- **Precomputed data fails to load** (e.g. a corrupt or missing file): the affected example shows a translated error, and the other examples and views keep working.
- **Language switch during a live request**: the request continues, and its result and any messages appear in the newly selected language.

## Requirements *(mandatory)*

### Functional Requirements

**Model & modes**

- **FR-001**: The site MUST support exactly one model in this version: GPT-2 small. All architecture numbers it shows (layer count, head count, hidden size, MLP size, vocabulary size, maximum context length, parameter counts) MUST be derived from the official model configuration and weights, not entered by hand.
- **FR-002**: The site MUST explain, on first visit and in live mode, that GPT-2 is a text-completion model and not a chat assistant.
- **FR-003**: Example mode MUST be the default. It MUST offer exactly six example texts (two short, two medium, two long), each written as text to continue. Every example's input MUST be within the live-mode input limit (64 tokens), so each can also be run in live mode.
- **FR-004**: All example-mode values MUST be real GPT-2 outputs, precomputed offline and shipped with the site. Example mode MUST work without any server call and without downloading a model.
- **FR-005**: Each example MUST include enough precomputed data to step through every view for its input and for each of its precomputed generation steps.
- **FR-006**: Generation MUST use greedy decoding only: at each step the single most likely token is appended. Results MUST be deterministic.
- **FR-007**: Generation MUST advance by exactly one token per user action. Users MUST be able to step back to any earlier step.
- **FR-008**: Live mode MUST be opt-in. Users MUST be able to type their own text and have it processed by the inference service without downloading the model.
- **FR-009**: Live-mode results MUST be shown with the same views, controls and visual behavior as example mode.
- **FR-010**: For the same input, live mode MUST produce identical tokens to example mode, and probabilities within an absolute difference of 0.0001.
- **FR-011**: If the inference service is waking up, the site MUST show a translated progress status with a cancel option. If the service is unavailable, slow beyond the wait limit, busy or returns an error, the site MUST show a clear translated message and keep example mode fully usable. The site MUST tell "waking up" apart from "unavailable" as follows: if the service's host answers at all (even with a page that is not the service's API, such as a hosting provider's start-up page), the service is treated as waking up until the wait limit runs out; if the host cannot be reached on two checks in a row, the service is treated as unavailable straight away.
- **FR-012**: User-entered text MUST NOT be stored or logged anywhere: not on the service, in logs, analytics, error reports, shared links, or persistent browser storage. It MAY be held only in memory while it is being processed and displayed.
- **FR-013**: Live mode MUST enforce a maximum input length of 64 tokens and a maximum of 64 generation steps, and MUST state both limits in the UI. The inference service is the only place where tokens are counted: it MUST check the exact token count before running the model and return the count when rejecting input. The browser MUST NOT tokenize text itself; it only applies a 1,000-character cap before sending.

**Explore views**

- **FR-014** (Tokenization): The site MUST show how the text is split into tokens, with each token's text (leading spaces and line breaks visible) and, on demand, its token ID.
- **FR-015** (Embeddings): The site MUST show each token's token embedding, position embedding and their combined vector as a compact color strip covering every dimension (hidden size from the model config); no subset or sample of dimensions. Exact values for every dimension MUST be available on demand through "Show details". Embedding data MAY be loaded when the view is first opened rather than with the initial page.
- **FR-016** (Transformer blocks): Users MUST be able to step through every transformer block, one at a time and by direct selection. Each block MUST show its attention part and its MLP part for the current tokens, including for each token a change percentage per part: the length (Euclidean norm) of the update that part adds to the token's vector, divided by the length of the token's vector before that part, × 100.
- **FR-017** (Attention): The site MUST show an attention heatmap for a user-selected layer and head. It MUST cover every layer and every head of the model, with causal masking shown visibly.
- **FR-018** (Prediction): The site MUST show the ten most likely next tokens with their probabilities at the current step. The greedy choice MUST be marked.
- **FR-019** (Architecture): The site MUST show a diagram of the whole model. Every weight matrix and bias in it MUST be selectable, showing its name, shape, parameter count and share of total parameters. Tied weights (LM head and token embedding) MUST be explained and counted once.
- **FR-020**: All views MUST reflect the currently selected example (or live text) and generation step.
- **FR-021**: The views MUST be presented in the order data flows through the model (text → tokens → embeddings → blocks → prediction). A persistent indicator MUST show where the visitor currently is "inside the machine".

**Statistics**

- **FR-022**: The site MUST show estimated FLOPs for prefill (the whole input) and for decode (each generated token at its context length).
- **FR-023**: The site MUST break down estimates per layer and per component: QKV projection, attention scores and attention-weighted values, output projection, MLP, embeddings and LM head.
- **FR-024**: The site MUST show totals for the current text, based on its input and generated token counts.
- **FR-025** (Should): The site MUST show a chart of estimated per-token cost against context length, up to the model's maximum context length, with the current context length marked.
- **FR-026** (Could): The site MUST show estimated KV-cache memory for the current context.
- **FR-027**: Every estimate MUST be visibly labelled as a theoretical estimate and MUST link to its formula on the "How we calculate" page.
- **FR-028**: The "How we calculate" page MUST document every formula, its inputs, its assumptions and a worked GPT-2 small example. (Could) An interactive version MUST let users change inputs and see the results recompute.

**Language & content**

- **FR-029**: The full UI MUST be available in Turkish, English and German. The default MUST follow the browser's preferred language, falling back to English. Users MUST be able to switch language at any time without losing view state.
- **FR-030**: Technical terms (at least token, attention, embedding, layer, head, MLP, logit, probability distribution, prefill, decode, FLOPs, KV cache) MUST stay in English in all languages. Each MUST have a short plain-language explanation in the current language at its first appearance in each view.
- **FR-031**: Each view MUST have a one-sentence plain-language explanation of what it shows.
- **FR-032**: Each view MUST show the main idea first and reveal exact numbers only through a "Show details" control.

**Sharing**

- **FR-033** (Should): The page address MUST encode the current view state (example, view, layer, head, generation step, language). Opening an address MUST restore that state. Invalid parts MUST fall back to valid defaults with a short notice.
- **FR-034**: Shared addresses MUST NOT contain user-entered live-mode text.

**Visual design & accessibility**

- **FR-035**: Each token MUST keep the same color in every view and at every generation step. Color MUST NOT be the only way to identify a token.
- **FR-036**: Animations MUST illustrate the flow of data (e.g. a token moving into embeddings, then through blocks) and MUST be replaced by non-animated equivalents when the user's system asks for reduced motion.
- **FR-037**: The site MUST offer a light and a dark theme, following the system setting by default with a manual switch. All text MUST meet WCAG 2.1 AA contrast in both themes, including text on token colors and heatmap cells.
- **FR-038**: Every feature, including heatmap cells, layer and head selection, diagram components and generation, MUST be fully usable with the keyboard alone, with a visible focus indicator. Visual data (heatmaps, vectors, charts) MUST have an equivalent text or table form for assistive technology.
- **FR-039**: The site MUST be fully usable on mobile phones (from 360 px wide) and on desktops, with no horizontal page scrolling at mobile widths.
- **FR-040**: The visual design MUST feel inviting and polished, like looking inside a machine rather than at a generic dashboard. It MUST use a consistent visual language across views.

**Verification**

- **FR-041**: Precomputed example data MUST be verified against a reference GPT-2 run (Hugging Face transformers): tokens identical, probabilities within an absolute tolerance of 0.0001, attention weights within an absolute tolerance of 0.001, and embedding values and other per-token vector values (including layer-change summaries) within a relative tolerance of 0.1%. The check MUST be repeatable and MUST fail when any tolerance is exceeded.
- **FR-042**: Every parameter, FLOP and memory calculation MUST have automated tests against hand-computed GPT-2 small reference values. The derivation of those values MUST be recorded next to them.
- **FR-043**: End-to-end tests MUST cover: open an example, step through layers, change the attention head, generate the next token, switch language, open a shared link, use live mode, and use live mode with the service unavailable.
- **FR-044**: Automated accessibility checks MUST run on every main view and report zero violations.

### Key Entities

- **Model configuration**: The official GPT-2 small settings: number of layers, attention heads, hidden size, MLP size, vocabulary size, maximum context length, and activation and normalization types. This is the source for every architecture number and estimate.
- **Example**: One of six built-in texts. It has a length category (short, medium or long), a title in each UI language, the original English text, and its precomputed run data for every generation step.
- **Token**: One unit of text. It has its text (possibly part of a character), its ID in the vocabulary, its position in the sequence, an assigned color, and whether it came from the input or was generated.
- **Generation step**: The state after k generated tokens (k = 0 is the input alone). It has the token sequence and the prediction for the next token.
- **Prediction**: The ten most likely next tokens at a step, each with token, ID and probability. The greedy choice is marked.
- **Layer snapshot**: For one transformer block at one step, the attention weights for every head and, for each token, the change percentage of the attention part and of the MLP part (length of the added update ÷ length of the token's vector before that part).
- **Embedding vectors**: For each token, its token embedding, its position embedding and their sum, each with one value per dimension of the hidden size (all dimensions, no subset).
- **Weight matrix**: A named parameter group in the architecture. It has a shape, a parameter count, a share of the total, its location in the model, and whether its weights are shared with another matrix.
- **Cost estimate**: A theoretical value (FLOPs or memory) for a component, layer, step or total. It has its formula, its inputs and a label marking it as an estimate.
- **View state**: Mode (example or live), selected example, active view, layer, head, generation step, language and theme. Everything except live text and theme is shareable.
- **Glossary term**: An English technical term with a short explanation in each UI language.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For all six examples and all of their precomputed steps, 100% of tokens are identical to the reference GPT-2 run, 100% of shown probabilities are within 0.0001 of it, 100% of attention weights are within 0.001 of it, and 100% of embedding and other vector values are within 0.1% (relative) of it.
- **SC-002**: For the text of each of the six examples run in live mode, tokens are 100% identical to example mode, and all probabilities are within 0.0001.
- **SC-003**: Every parameter, FLOP and memory value shown matches its hand-computed reference value. For example, the total parameter count of GPT-2 small, with tied embeddings counted once, equals 124,439,808.
- **SC-004**: With the inference service switched off, 100% of example-mode features work. If the service's host cannot be reached, a live-mode attempt shows a clear "unavailable" message within 10 seconds of starting. If the host answers but the service never becomes ready, the message appears as soon as the 60-second wait limit runs out.
- **SC-005**: In a usability session with at least five participants who have no ML background, at least 4 of 5 complete these tasks unaided within 10 minutes: pick an example, find which earlier token a chosen token attends to most in a given layer and head, generate two tokens, and say in their own words that the model predicts one token at a time.
- **SC-006**: Every main view is reachable and every feature can be operated using only the keyboard; this is verified for all eight end-to-end scenarios.
- **SC-007**: Automated accessibility checks report zero violations on every main view, in both themes and all three languages.
- **SC-008**: 100% of user-facing strings exist in Turkish, English and German. No untranslated string appears in any language.
- **SC-009**: 100% of displayed estimates carry a "theoretical estimate" label and link to a documented formula.
- **SC-010**: Opening a shared link restores the identical view state in 100% of tested combinations of example, view, layer, head, step and language.
- **SC-011**: Example mode reaches a performance score of at least 90 in a standard automated web performance audit (Lighthouse, mobile preset, which simulates a mid-range phone on a 4G connection). In the same audit, the first usable view is visible within 3 seconds (Largest Contentful Paint ≤ 3,000 ms) and responds without long delays (Total Blocking Time ≤ 200 ms).
- **SC-012**: All end-to-end scenarios listed in FR-043 pass in automated runs.

## Assumptions

- **Example language**: All six examples are in English, because GPT-2 was trained mostly on English. Example titles and explanations are translated, but the model input and output stay as they are.
- **Example lengths**: "Short" means about 5–15 input tokens, "medium" about 20–35, and "long" about 50–64 (never more than the 64-token live-mode input limit). Each example includes 20 precomputed generation steps, or fewer if it reaches the end-of-text token first.
- **Live-mode limits**: To keep the service small and responses quick, live input is limited to 64 tokens and up to 64 generation steps (set during clarification; example mode keeps its own 20 precomputed steps). The service wait limit, including wake-up from sleep, is 60 seconds.
- **Probabilities**: Shown probabilities are the model's raw next-token distribution (softmax of the final output, no temperature or other changes). Greedy decoding picks the highest one, with ties broken by the lowest token ID.
- **Special-token text**: Literal special-token text typed by a user is tokenized as ordinary text, in both modes.
- **FLOP counting convention**: Forward pass only. One multiply-add counts as 2 FLOPs. Matrix multiplications are counted, including the attention score and weighting steps. Element-wise operations (layer norm, softmax, activation, residual additions) are small and are left out of the totals; this is stated on "How we calculate". The embedding lookup costs no FLOPs. Adding the position embedding is shown as a small separate item.
- **Prefill vs. decode**: Prefill is the cost of processing all input tokens in one pass. Decode is the cost of one new token at the current context length, assuming a KV cache is used.
- **KV-cache memory**: Calculated for 32-bit values, the precision of the reference model. Other precisions may be mentioned for comparison only.
- **Token colors**: Colors are assigned by position in the sequence and stay fixed for that token across views and steps. The palette may repeat for long texts.
- **Language preference**: The chosen language and theme may be remembered on the visitor's device for convenience. A language in a shared link always takes priority.
- **Sharing in live mode**: Links never include user text (privacy first). Sharing a live view is not supported in this version; the visitor is told why.
- **Privacy scope**: Operational monitoring of the service (request counts, error rates, response times) is allowed as long as it never records input text or model output.
- **Hosting**: The inference service may sleep when idle (hence the "waking up" state). No uptime target is required, because example mode always works.
- **Waking up vs. unavailable**: While a sleeping service starts, its hosting provider may answer with its own start-up page instead of the service's API, and the browser may not be allowed to read that page. Any answer from the host therefore counts as "waking up", and only a host that cannot be reached at all counts as "unavailable" before the wait limit runs out (FR-011).
- **Reference implementation**: The verification reference is GPT-2 small as published with its official weights and run through the Hugging Face transformers library, as named in the user's acceptance criteria.
- **Out of scope**: Training or fine-tuning, any decoding strategy other than greedy, models other than GPT-2 small (including closed models), user accounts, saving or exporting user texts.

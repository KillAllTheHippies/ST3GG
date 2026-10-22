# Nested polyglots reference implementation QA

Final result: **passed** for the eight desktop reference states at 1584 × 992 CSS pixels, device scale factor 1.

## Reference and scope

Compared the working browser interface with all eight approved images in:

`C:/Users/Wile/.codex/visualizations/2026/10/20/01a1589f-7d3b-7803-bd99-ad3aff71fe26/nested-polyglots-design-review-2026-10-21/`

The implementation follows their full-window graphite workspace, 60-pixel header, coral action controls, collapsible run sidebar, dotted containment canvas, selected-layer inspector and contextual editors below the canvas. Inter and Tabler assets are local; provenance is recorded in [assets/polyglot/SOURCES.md](assets/polyglot/SOURCES.md).

## Evidence

The targeted capture script is `.polyglot-test/reference-visual-check.cjs`. It used an isolated headless Chrome profile and local image fixtures in place of image-agent requests. No user browser profile or saved API key was accessed and no paid generation was requested. The in-app preview could not be automated with the tools available in this session.

Actual screenshots and side-by-side reference comparisons are in `.polyglot-test/reference-redesign/`:

| State | Working screenshot | Paired comparison |
| --- | --- | --- |
| Configure | `01-configure.png` | `comparison-01-configure.png` |
| Presets | `02-presets.png` | `comparison-02-presets.png` |
| Sequence review | `03-sequence.png` | `comparison-03-sequence.png` |
| Image previews | `04-previews.png` | `comparison-04-previews.png` |
| Payload and help | `05-payload-help.png` | `comparison-05-payload-help.png` |
| Linked templates | `06-templates.png` | `comparison-06-templates.png` |
| Instruction destination | `07-instructions.png` | `comparison-07-instructions.png` |
| Build and download | `08-results.png` | `comparison-08-results.png` |

## Findings resolved

- The original page-wide 110% zoom clipped the workspace. The polyglot tab now resets zoom and fills the viewport exactly.
- Panel proportions, contextual canvas heights and thumbnail sizes were adjusted against the references. Sidebars scroll independently.
- Template fields and rendered previews previously overflowed into the inspector. Container-aware columns and bounded children now keep them inside the editor.
- Template previews, instruction previews and their actions, and final download controls fit inside their respective editor areas at the reference viewport.
- Instruction destination badges no longer overlap their layer's add-child control.
- A persistent status overlay no longer covers editor actions; accessible live announcements remain available.

Final capture checks reported no horizontal document overflow, no escaped template columns, no missing initial icon assets and no page exceptions. The working root measured 1584 × 992. Initial columns measured approximately 340.55 / 799.94 / 443.52 pixels. `checks.json` records the measured values.

The final visual fixture created five nested images, configured an LSB payload, placed its decoding instructions in the outer image using PNG-chunk encoding, and built through the actual application pipeline. The displayed result verified five image layers and two changed payload round-trips. This was a targeted visual-flow check, not a broad encoder or resource-limit test.

## Intentional differences

- AI image creation remains the default, as requested after the original mockups. Local generation and uploads remain available.
- Structure names and action labels retain the clearer wording requested in subsequent feedback.
- Sizes, archive entries and verification counts reflect actual workspace contents. Illustrative mockup values and unsupported verification claims are not reproduced.
- Template and instruction editors retain functioning variable overrides, target selection and compatibility guards. Their exact content can differ from illustrative source text.
- The image sequence preview uses the approved reference thumbnails, but production generation still requires a real carrier for each layer.

No P0, P1 or P2 visual blockers remain in the eight checked desktop states. Minor icon shapes and live-data-driven text differ from the illustrative mockups. Responsive rules are included, but narrow viewport layouts, real provider integration and broad robustness checks were not exhaustively tested in this pass; the next step is the user's interactive test.

## Subsequent focused feedback pass

`.polyglot-test/feedback-flow-check.cjs` checks the later refinements using local model-discovery fixtures: added children align directly below their containing image; add controls have a vertical connector; all three prompt examples are available and apply editable text; API-key presence updates while typing; the planning-model picker updates the displayed selection; and shared/layer variables use one central editor. The check passed without external generation requests. `feedback-refinements.png` captures that working state.

Two user-requested review agents inspected the changed paths. Their findings were addressed: row spacing accommodates instruction badges and add controls, and prompt-token insertion plus render-time focus restoration prefer the active modal over the sidebar copy. API-key presence indicates local configuration only, not successful provider authentication. Planning discovery filters the model catalog for image input and text output; real provider requests remain for user-led testing.

The follow-up variable walkthrough and sidebar Usage examples entry passed the focused browser fixture, including live replacement text and applying an example to the selected image. `.polyglot-test/saved-key-check.cjs` passed isolated checks for session-to-local migration, local restoration, shared edits, explicit removal and storage failures. No real key was inspected. Recovery remains limited to browser storage for the same origin; unavailable keys from closed session-only tabs or other origins cannot be recovered by this change.

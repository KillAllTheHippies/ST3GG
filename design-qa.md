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

## Visual refinement, 22 October 2026

Checkpoint before edits: `c35b329` (`Save nested polyglot workspace before visual polish`).

Refined the graphite panel surfaces, coral actions and selection outlines, image placeholders, type sizes, preset category buttons, editor close control, and template spacing against the eight reference images. The run heading now shares its row with Usage examples. Fixed the size-map segments collapsing to zero height inside their button. At tablet widths the inspector moves below the canvas; the sequence table scrolls within its editor instead of crushing text into narrow columns.

Verification: `.polyglot-test/visual-polish-check.cjs` runs an isolated headless Chrome session with an embedded loopback server. Screenshots and reports are in `.polyglot-test/visual-polish/`. All eight states passed at 1584 x 992, including template/instruction bounds, loaded icons, preset category switching, and the real build with five images and two payload round-trips. Additional configure and sequence-review captures at widths 1280, 768 and 390 passed without horizontal document overflow or page exceptions. Screenshots were visually inspected; narrow sequence tables intentionally scroll inside the editor. Image generation was replaced with local fixtures; real provider integration was not tested.

## Ready-to-build examples, 22 October 2026

Added a distinct sidebar entry with three complete examples: one photo with an LSB message, a three-image chain, and one photo containing two child images. Each loads bundled PNG bytes, filenames, prompts and README text, then opens the build review. No typing, API key or generation is required. All carriers are fetched and decoded before replacing the current run; existing edits retain the replacement confirmation.

`.polyglot-test/ready-examples-check.cjs` verified all three through the actual build: image decoding, ZIP extraction and file contents passed; the LSB message also passed its round-trip check. Generation was configured to throw if called, and the isolated browser had no API key. Cancellation and an injected failed image fetch both preserved the existing layer IDs. The 390-pixel picker had no horizontal document overflow. Evidence is in `.polyglot-test/visual-polish/examples-checks.json` and `example-*-ready.png` / `example-*-built.png`.

## Annotated gallery and gold accents, 22 October 2026

Checkpoint before changes: `77bdd1b`. Nest image now opens an image chooser with five bundled examples and browser-local image history. The inspector also exposes Choose from gallery. Generated, uploaded and reused carrier bytes are saved in IndexedDB, with content-hash deduplication and an in-memory fallback when storage is unavailable. Existing image files and nested archives are not cloned with the carrier. The examples shortcut is larger and filled gold; action buttons, active options, focus indicators and selected-layer borders use gold.

`.polyglot-test/gallery-check.cjs` passed in isolated Chrome: nest from a bundled image, build and validate all four layers, reload and select a previously saved carrier, create another image through the dialog, and use bundled images with an injected IndexedDB failure. It also captured desktop and 390-pixel gallery screenshots with no page overflow or runtime exceptions. Computed styles confirmed gold for the primary action, selected node and examples shortcut. Image history is scoped to this browser and origin; previously discarded images from before this feature cannot be recovered.


## Shared app navigation and styling, 22 October 2026

Checkpoint `389d41d` preserves the gallery and OpenRouter connection work. The
nested workspace now keeps the main banner and horizontal application tabs
visible. Its duplicate ST3GG menu is removed; New run stays in the workspace
header. Palette, typography, controls, focus outlines, selected layers, gallery
and review surfaces now follow the main app's black, green, cyan and monospace
style. The sidebar and canvas workflow remains available.

`.polyglot-test/style-match-check.cjs` passed in isolated Chrome: all six main
tabs remain visible, navigation preserves layer IDs, an included image builds
and validates, and there is no horizontal document overflow at 1436, 1000, 768
or 390 pixels. The script checks computed colors and fonts and captures desktop,
build and responsive screenshots under `.polyglot-test/style-match/`.


## Model-settings recovery action, 22 October 2026

API-key and Model-settings alerts now include Open model settings beside Dismiss.
The action clears the alert, expands the sidebar section, scrolls it into view
and focuses the key field. Model settings also remains available when the run
uses local images, so an individual AI layer can connect without changing the
run's source. The header connection action uses the same destination.

`.polyglot-test/model-settings-check.cjs` passed in isolated Chrome at 1617 and
390 pixels: the key field was expanded, visible and focused, layer IDs and labels
were retained, unrelated errors had no settings shortcut, and Dismiss still
worked. No API requests or live keys were used.


## Annotated interaction fixes, 23 October 2026

Connect OpenRouter and Complete connection use the existing primary button style;
Disconnect stays secondary and is hidden when there is no key. The shared footer
reserves the maximum hatching-frame footprint. Canvas panning ignores role-button
cards so real pointer clicks reach the same selection path as inspector navigation.
The settings, inspector and editor no longer contain overscroll: wheel gestures
continue to the page at panel boundaries using browser-native scroll chaining.
No wheel handlers or forwarding logic were added.

Parallel checks passed in isolated Chrome: `.polyglot-test/auth-emphasis-check.cjs`
verified computed button colors, hidden Disconnect controls and the mocked OAuth
regression; `.polyglot-test/footer-stability-check.cjs` checked all nine frames on
six tabs at desktop/mobile widths and observed a natural animation cycle without
layout or scroll movement; `.polyglot-test/layer-selection-check.cjs` exercised
real mouse clicks, pager equivalence, keyboard selection, template draft retention
and blank-canvas dragging. `.polyglot-test/scroll-boundaries-check.cjs` reproduced
the old containment trap and verified native scrolling within panels plus page
handoff at both boundaries of settings, inspector, editor and canvas. Scroll
verification uses multi-tick wheel gestures, matching continued scrolling.


## Review follows selected layer, 23 October 2026

The review title now names the selected layer; the corresponding summary has the
same green selection accent and an aria-current marker. Canvas, inspector pager
and summary selection share the same update path, keeping the active summary in
view within the review panel. Other summaries remain available and the build
button continues to name and build the complete outer file.

`.polyglot-test/review-selection-check.cjs` passed with actual Chrome pointer
input: canvas and previous/next navigation synchronized review and inspector,
summary navigation stayed synchronized at desktop/mobile widths, and building
from a selected child still validated the complete outer file.


## Silver and gold mode previews, 23 October 2026

Nested polyglots has two visible mode treatments inspired by the SPECTER and
Nested Stegg screens. Silver combines platinum with blue-black panels, glacial
blue labels and violet accents. Gold combines champagne with aubergine panels
and amethyst labels. The mode title, active tab, primary controls, selections,
fields, gallery and review surfaces share the chosen palette. The main ST3GG
banner and the other application tabs retain their original colors. No unlock
mechanism or hidden navigation was introduced.

The Silver/Gold switch defaults to Silver and updates scoped color variables
without rerendering the workspace. `.polyglot-test/metal-themes-check.cjs` passed
in isolated Chrome at 1617, 1000 and 390 pixels: both themes remain selectable,
the tab stays visible, layer selection and image URLs remain intact, an uncommitted
field edit and its exact DOM element survive switching, and there is no horizontal
page overflow. Desktop and mobile screenshots for both themes were visually
inspected under `.polyglot-test/metal-themes/`.


## Gold selected, 23 October 2026

Gold is now applied in the initial HTML. Removed the Silver/Gold comparison
control, silver palette and theme-switching script. The tab remains visible.
`.polyglot-test/gold-final-check.cjs` passed: gold on first load, no switch,
visible tab, synchronized layer review on desktop/mobile and a validated build.

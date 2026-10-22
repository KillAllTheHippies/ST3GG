---
name: ux-flow
description: Design or improve application workflows so users can understand available actions, retain their work and continue through a task without needing knowledge of the implementation. Use for confusing controls, unclear next steps, overloaded configuration, presets and contextual guidance.
---

# UX-flow

Build a functional path through the task. Users should understand what an action achieves and what they can do next from the controls and the current state. Do not assume knowledge of the application's internal terminology. Use precise, professional language without baby talk, promotional slogans or decorative explanations.

## Establish the user's working context

- Identify the object being edited, the desired output and the actions needed to produce it. In repeated workflows, make the current item and its relationship to other items visible.
- Read the actual screen, available actions and surrounding implementation before changing a flow. Use supplied annotations and screenshots to locate the failure. Preserve unrelated functionality and design unless a redesign is requested.
- Separate prerequisites from optional configuration. Let users return to earlier work and take legitimate alternative paths.

## Make controls explain their outcomes

- Name actions by the result and, where needed, their scope: “Choose an image for layer 2”, “Update 3 linked files”, or “Build and download”. Avoid generic labels whose meaning depends on hidden system knowledge.
- Put essential descriptions beside the relevant control. Explain the effect, destination or consequential tradeoff. Remove text that merely repeats visible state or announces obvious behaviour.
- Show useful empty states with an available action. Distinguish “needs an image”, “image ready” and “output validated”; do not call an unfinished object complete.
- Describe presets by what they create, including their structure or contents. Make presets editable starting points, with a collapsible library when a long list would displace the work.

## Guide through state, not interruptions

- Determine sensible next actions from actual work state. Give the most relevant action restrained visual emphasis near the point of completion. Make the destination clear and clickable.
- For a sequence or tree, provide direct item selection and explicit previous/next controls. Completed and unfinished items must be distinguishable without relying on colour alone.
- Recommendations are optional. Do not auto-advance, open a tour or move focus away while someone edits unless that behaviour is explicitly appropriate to the task.
- Keep files, settings, previews and help accessible within the working context. Preserve drafts and selections across item changes; avoid unnecessary page navigation and blocking dialogs.
- Avoid regenerating, overwriting or charging for completed work when continuing an unfinished run. Batch actions should state which items they affect.

## Disclose detail without hiding capability

- Offer sensible defaults and reveal deeper settings near the feature they configure. A simpler view should retain access to the full capability.
- Where values are reusable, support real variables or templates with discoverable insertion controls, editable values and a resolved preview. Validate unresolved variables before running consequential operations.
- Explain incompatible choices where the user chooses them, and show a practical resolution. Let the application perform verification where it can; show evidence-backed results separately from configuration state.

## Check the changed path

Trace the affected path from entry through one completed item, continuation to another, optional edits and output. Check keyboard access, visible focus, legible descriptions, scrolling and action scope. Scale verification to the user's request; respect an explicit request to do the first interactive test themselves. Report what was actually checked and provide the working preview link when available.

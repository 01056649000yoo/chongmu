# chongmu

Trip Splitter is a static HTML, CSS and JavaScript app. No build step is required.

## UI

The section order, two-column grid, 980px stacking breakpoint and account form
layout are unchanged. Component tokens live in `styles.css`; `ui.js` contains
loading-state and dialog-motion helpers. Motion respects `prefers-reduced-motion`.

The following references are adapted to native HTML/CSS, not installed as React
dependencies:

- [shadcn/ui](https://ui.shadcn.com/docs/components/button): button variants, input borders and focus rings.
- [Arc UI](https://uiarc.dev/components/dialog): focused dialogs and quiet interaction states.
- [affectUI](https://www.affectui.com/components/button): readable pending actions with stable button dimensions.
- [Transitions.dev](https://transitions.dev/): short scale/fade dialog transitions and restrained state motion.

Pretendard Variable is self-hosted in `assets/fonts` under the included SIL Open
Font License. Lucide icons are in `assets/icons` with their ISC license.

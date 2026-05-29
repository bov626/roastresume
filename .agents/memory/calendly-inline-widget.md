---
name: Calendly inline widget auto-loads
description: Calendly widget.js initializes every .calendly-inline-widget on page load regardless of display:none
---

Calendly's `widget.js` scans for every `.calendly-inline-widget` element at load and
creates its iframe (from `data-url`) immediately — even if the element is inside a
`display:none` container.

**Why:** A hidden in-popup Calendly embed on the landing page still loaded the Calendly
iframe on every visit, a needless perf cost. Moving the booking step to a dedicated page
required removing both the widget markup AND the `widget.css`/`widget.js` includes from
the landing page to actually stop the load.

**How to apply:** If a Calendly embed should only load on a specific page/state, put the
`.calendly-inline-widget` markup AND the widget script includes only on that page — do not
rely on `display:none` to defer loading.

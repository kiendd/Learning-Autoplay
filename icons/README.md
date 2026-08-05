# Icons

This extension intentionally ships without icon PNGs. Chrome renders a default
placeholder icon, and the badge text set by `src/background/worker.js` displays
correctly on top of it.

To add real icons later, drop `icon16.png`, `icon48.png`, and `icon128.png` here
and add to `manifest.json`:

    "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }

Also add the same map under the `"action"` key so the toolbar picks them up.

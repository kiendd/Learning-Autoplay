// MV3 content scripts are classic scripts, so the files listed in the manifest
// share state through this global instead of ES module imports.
window.__llAutoResume = window.__llAutoResume || {};

// The web build is served under a path on GitHub Pages (/musette): CI sets
// MUSETTE_BASE_URL. Everything else is in app.json.
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...config.experiments, baseUrl: process.env.MUSETTE_BASE_URL || undefined },
});

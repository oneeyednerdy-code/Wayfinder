export const APP_CONFIG = {
  productName: 'Wayfinder',
  ecosystemName: 'Nerdspace Labs',
  version: 'Alpha 0.5.0',
  tagline: 'Turn your Twitch data into direction.',
  privacyLine: 'CSV files are analyzed locally. Revenue and monetary columns are discarded before analysis and are never stored, exported, logged, or transmitted. Twitch user tokens are transient during OIDC login and are never stored or exposed to client JavaScript.',
  confidence: { high: 12, medium: 6, early: 3 },
  storageKeys: {
    contexts: 'wayfinder.stream-context.v1',
    experiments: 'wayfinder.experiments.v1',
    goal: 'wayfinder.goal.v1',
  },
};

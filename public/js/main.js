import { guardDashboard } from './auth-guard.js';

// Keep this entry point minimal — only the auth check loads up front.
// The rest of the app (Firestore sync, every ui/*.js module) is fetched
// via dynamic import() so an unauthenticated visitor never downloads or
// parses the full dashboard bundle before being redirected to login.html.
guardDashboard(async (user) => {
  const { initApp } = await import('./app.js');
  initApp(user);
});

import { guardDashboard } from './auth-guard.js';

// Keep this entry point minimal — see main.js for why the heavy modules
// (Firestore sync, store, utils, render logic) are deferred to a dynamic
// import() gated behind the auth check.
guardDashboard(async () => {
  const { initEmployeeApp } = await import('./employee-app.js');
  initEmployeeApp();
});

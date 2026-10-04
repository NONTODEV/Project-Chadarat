import { auth } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

export function guardDashboard(onAuthed) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = '/login.html';
      return;
    }
    onAuthed(user);
  });
}

export function initLogout(buttonEl) {
  buttonEl.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = '/';
  });
}

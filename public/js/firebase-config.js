import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// Firestore is deliberately NOT initialized here — the firestore-firestore.js
// SDK chunk is large, and login.html / the auth-guard only need Auth. See
// firebase-db.js, imported only by firestore-service.js (which is itself
// behind a dynamic import gated on a successful login), so an unauthenticated
// visit never downloads the Firestore SDK.
const firebaseConfig = {
  apiKey: "AIzaSyCWLFP1D3oxcABlNpAdObr3fSoT3nuk3yQ",
  authDomain: "project-chadarat.firebaseapp.com",
  projectId: "project-chadarat",
  storageBucket: "project-chadarat.firebasestorage.app",
  messagingSenderId: "144996454439",
  appId: "1:144996454439:web:074c449273bf7b386b3e02",
  measurementId: "G-DK49FFPKDL"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };

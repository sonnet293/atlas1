// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC7IDFzk8T1RhCHY49Kn7L6lb5YQKljHqc",
  authDomain: "atlas-f52d2.firebaseapp.com",
  projectId: "atlas-f52d2",
  storageBucket: "atlas-f52d2.firebasestorage.app",
  messagingSenderId: "27529158192",
  appId: "1:27529158192:web:d310a83b6330154af457f5",
  measurementId: "G-S790TL5507"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
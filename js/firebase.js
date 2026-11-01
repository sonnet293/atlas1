// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDdSa8i3ZXu3tCJaHzdN0L16-A5Ez58mE",
  authDomain: "voyage-55f62.firebaseapp.com",
  projectId: "voyage-55f62",
  storageBucket: "voyage-55f62.firebasestorage.app",
  messagingSenderId: "394527359794",
  appId: "1:394527359794:web:f29daaff5c19c182588d2b",
  measurementId: "G-S790TL5507"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
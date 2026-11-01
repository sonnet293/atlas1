// js/login.js
import { auth } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");

// 이미 로그인되어 있으면 바로 main.html로
onAuthStateChanged(auth, user => {
  if (user) location.href = "main.html";
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  msg.textContent = "";
  const btn = form.querySelector("button");
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
    // 이동은 onAuthStateChanged에서 처리
  } catch (err) {
    msg.textContent = "로그인 실패: 이메일 또는 비밀번호를 확인해주세요.";
    console.error(err);
    btn.disabled = false;
  }
});

// js/login.js — 이메일/비밀번호 로그인. 이미 로그인돼 있으면 바로 main으로.
import { auth } from "./firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const NEXT_PAGE = "main.html";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ERRORS = {
  "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
  "auth/wrong-password": "이메일 또는 비밀번호가 올바르지 않습니다.",
  "auth/user-not-found": "이메일 또는 비밀번호가 올바르지 않습니다.",
  "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
  "auth/user-disabled": "정지된 계정입니다.",
  "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
  "auth/network-request-failed": "네트워크 연결을 확인해주세요.",
};

const $ = (id) => document.getElementById(id);
const form = $("auth-form");
const emailInput = $("email");
const passwordInput = $("password");
const loginBtn = $("login-btn");
const errorEl = $("login-error");

auth.authStateReady().then(() => {
  if (auth.currentUser) location.replace(NEXT_PAGE);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!EMAIL_RE.test(email)) {
    errorEl.textContent = "이메일 형식이 올바르지 않습니다.";
    emailInput.focus();
    return;
  }
  if (!password) {
    errorEl.textContent = "비밀번호를 입력해주세요.";
    passwordInput.focus();
    return;
  }

  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    location.replace(NEXT_PAGE);
  } catch (err) {
    errorEl.textContent = ERRORS[err.code] ?? `로그인 실패 (${err.code ?? "unknown"})`;
    passwordInput.value = "";
    passwordInput.focus();
    loginBtn.disabled = false;
  }
});

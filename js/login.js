// js/login.js
import { auth } from "./firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const NEXT_PAGE = "main.html";
const FADE_MS = 1800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ERRORS = {
  "auth/invalid-credential": "Credentials rejected. Access denied.",
  "auth/wrong-password": "Credentials rejected. Access denied.",
  "auth/user-not-found": "Credentials rejected. Access denied.",
  "auth/invalid-email": "Invalid identifier format.",
  "auth/user-disabled": "Trainer ID suspended. Contact PROJECT LEAD.",
  "auth/too-many-requests": "Too many attempts. Terminal temporarily locked.",
  "auth/network-request-failed": "Relay connection lost. Check network and retry.",
};
const BAD_STATUS = new Set(["MISMATCH", "FAILED", "DENIED", "OFFLINE"]);

const $ = (id) => document.getElementById(id);
const $screen = $("screen");
const $log = $("log");
const $form = $("auth-form");
const $skip = $("skip");

const fields = {
  email: { box: $("field-email"), input: $("email"), mirror: $("email-mirror"), err: $("email-err"), label: "E-MAIL", mask: false },
  password: { box: $("field-password"), input: $("password"), mirror: $("password-mirror"), err: $("password-err"), label: "PASSWORD", mask: true },
};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let speed = 1;            // 모든 대기 시간에 곱해지는 배율
let burst = reduceMotion; // true면 글자 단위 타이핑 없이 한 줄씩 출력
let stage = "boot";       // boot → email → password → busy → done

// ── 유틸 ─────────────────────────────────────

const rand = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms * speed));
const scrollDown = () => { $screen.scrollTop = $screen.scrollHeight; };

function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function restart(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

// ── 터미널 출력 ─────────────────────────────────────

// 한 글자씩 불규칙하게 타이핑
async function typeInto(node, text, min = 6, max = 22) {
  if (burst) {
    node.textContent += text;
    return;
  }
  for (const ch of text) {
    node.textContent += ch;
    let d = rand(min, max);
    if (ch === " ") d *= 0.5;
    else if (ch === ".") d = rand(25, 90);
    if (Math.random() < 0.035) d += rand(90, 320); // 가끔 멈칫
    scrollDown();
    await wait(d);
  }
}

// "[TAG] 메시지" → 태그는 별도 스타일
async function typeTagged(parent, text, min, max) {
  const m = /^\[([A-Z]+)\]/.exec(text);
  if (m) {
    const tag = parent.appendChild(make("span", `tag tag-${m[1].toLowerCase()}`));
    await typeInto(tag, m[0], min, max);
    text = text.slice(m[0].length);
  }
  if (text) await typeInto(parent.appendChild(make("span", "msg")), text, min, max);
}

// 타이핑 커서가 붙은 새 줄
function newRow(cls = "") {
  const row = make("div", `line ${cls}`);
  const cur = make("span", "cur solid");
  row.append(cur);
  $log.append(row);
  scrollDown();
  return { row, cur, put: (node) => row.insertBefore(node, cur), done: () => cur.remove() };
}

const pause = () =>
  wait(burst ? rand(15, 45) : rand(40, 160) + (Math.random() < 0.12 ? rand(200, 520) : 0));

async function line(text, { cls = "", min, max } = {}) {
  const r = newRow(cls);
  await typeTagged(r.put(make("span", "body")), text, min, max);
  r.done();
  await pause();
}

// [TAG] 메시지 ........ STATUS  (status에 Promise를 넘기면 결과가 올 때까지 점이 채워짐)
async function lead(text, status, { hold } = {}) {
  const r = newRow("lead");
  const left = r.put(make("span", "left"));
  await typeTagged(left, text);
  r.done();

  const dots = make("span", "dots", ".".repeat(240));
  const st = make("span", "status");
  r.row.append(dots, st);
  void dots.offsetWidth;

  let value = status;
  if (typeof status?.then === "function") {
    dots.style.transition = `clip-path ${1400 * speed}ms cubic-bezier(.1,.6,.3,1)`;
    dots.style.clipPath = "inset(0 18% 0 0)";
    [value] = await Promise.all([status, wait(700)]);
  }

  const d = burst ? 90 : hold ?? rand(120, 600) * (Math.random() < 0.15 ? 2.5 : 1);
  dots.style.transition = `clip-path ${d * speed}ms linear`;
  dots.style.clipPath = "inset(0)";
  await wait(d);

  st.textContent = value;
  st.classList.add("show", BAD_STATUS.has(value) ? "bad" : "good");
  scrollDown();
  await pause();
  return value;
}

async function rule() {
  const node = make("div", "rule", "─".repeat(240));
  node.style.transitionDuration = `${(burst ? 120 : 380) * speed}ms`;
  $log.append(node);
  scrollDown();
  void node.offsetWidth;
  node.classList.add("drawn");
  await wait(burst ? 40 : 200);
}

function gap() {
  $log.append(make("div", "line"));
  scrollDown();
}

async function cmd(text) {
  const r = newRow("cmd");
  r.put(make("span", "ps", "> "));
  r.cur.classList.remove("solid");
  await wait(burst ? 0 : rand(400, 800));
  r.cur.classList.add("solid");
  await typeInto(r.put(make("span", "msg")), text, 45, 140);
  await wait(burst ? 40 : rand(250, 450));
  r.done();
}

async function banner(text) {
  $log.append(make("div", "banner", text));
  scrollDown();
  await wait(650);
}

// ── 상단 상태바 ─────────────────────────────────────

function setLink(text, mode) {
  $("link-state").textContent = text;
  $("link-led").className = `led ${mode}`;
}

function setSid() {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, "0");
  $("sid").textContent = `${hex()}-${hex()}`;
}

const tick = () => { $("clock").textContent = new Date().toISOString().slice(11, 19); };
tick();
setInterval(tick, 1000);

// ── 시퀀스 ─────────────────────────────────────

async function boot() {
  await line("PROJECT : VOYAGER", { cls: "title", min: 40, max: 110 });
  await line("TRAINER OBSERVATION & SIMULATION NETWORK", { cls: "sub", min: 8, max: 20 });
  gap();
  await line("REMOTE TERMINAL // NODE 03", { cls: "node" });
  await rule();

  await line("[BOOT] Initializing VOYAGER terminal...");
  await lead("[BOOT] Kernel", "READY");
  await lead("[BOOT] Trainer interface", "READY");
  await lead("[BOOT] Battle simulation core", "READY");
  await lead("[BOOT] Telemetry service", "READY");
  gap();

  setLink("SEARCHING", "blink");
  await line("[NET] Searching for VOYAGER network...");
  await wait(rand(300, 700));
  await line("[NET] Relay station detected.");
  await lead("[NET] Establishing encrypted connection", "OK", { hold: 900 });
  await lead("[NET] Latency", `${Math.round(rand(12, 34))}ms`);
  setLink("LINKED", "on");
  gap();

  await lead("[SYNC] Synchronizing system clock", "OK");
  await lead("[SYNC] Synchronizing battle database", "OK");
  await lead("[SYNC] Synchronizing Pokémon database", "OK");
  await lead("[SYNC] Retrieving current project status", "OK");
  gap();

  await rule();
  await line("[SYS] Authentication required.");
  gap();
  await cmd("voyager auth --trainer");
  gap();
  await line("INITIALIZING TRAINER IDENTIFICATION...", { cls: "strong" });
  gap();
  await line("[AUTH] Secure authentication module loaded.");
  await line("[AUTH] Waiting for trainer identifier.");
}

async function success() {
  stage = "done";
  burst = true;
  speed = 1;
  setLink("SECURE", "on");

  await line("[AUTH] Identity confirmed.");
  await rule();
  await banner("TRAINER AUTHENTICATED");
  await rule();
  gap();

  await line("[NET] Opening secure trainer channel...");
  await lead("[NET] Encryption layer", "ACTIVE");
  await lead("[NET] Session key", "GENERATED");
  setSid();
  gap();

  await lead("[SYNC] Retrieving trainer profile", "OK");
  await lead("[SYNC] Retrieving registered Pokémon", "OK");
  await lead("[SYNC] Retrieving battle records", "OK");
  await lead("[SYNC] Retrieving simulation history", "OK");
  gap();

  // 여기서부터 페이드 시작 — 끝까지 보이지 않아도 됨
  document.body.classList.add("leaving");
  setTimeout(() => location.replace(NEXT_PAGE), FADE_MS);

  await lead("[SYS] Checking battle subsystem", "ONLINE");
  await lead("[SYS] Checking matchmaking subsystem", "ONLINE");
  await lead("[SYS] Checking telemetry subsystem", "ONLINE");
  await lead("[SYS] Checking observation subsystem", "ONLINE");
  gap();
  await line("[SYS] Checking experimental subsystem...");
  gap();
  await wait(400);
  await line("...");
  await wait(500);
  gap();
  await lead("[SYS] Experimental subsystem", "ONLINE");
  gap();
  await line("[WARNING] Experimental subsystem is currently enabled.");
  await line("[WARNING] Unexpected behavior may occur.");
  gap();
  await line("[SYS] Disable experimental subsystem? [Y/N]");
  gap();
  burst = false;
  await cmd("N");
  gap();
  await line("[SYS] Input received from PROJECT LEAD.");
}

async function fail(code) {
  gap();
  await line("[AUTH] Identity verification failed.", { cls: "err" });
  await line(`[ERR] ${ERRORS[code] ?? `Unexpected response (${code}).`}`, { cls: "err" });
  gap();
  await line("[AUTH] Waiting for trainer identifier.");

  const { email, password } = fields;
  password.input.value = "";
  sync(password);
  password.input.readOnly = false;
  email.input.readOnly = false;
  stage = "email";
  openField(email); // 이메일은 그대로 남겨 둠 → Enter만 누르면 재입력
}

// ── 입력 필드 ─────────────────────────────────────

function sync(f) {
  const v = f.input.value;
  f.mirror.textContent = f.mask ? "*".repeat(v.length) : v;
}

function openField(f) {
  f.box.hidden = false;
  restart(f.box, "rise");
  f.input.readOnly = false;
  sync(f);
  f.input.focus({ preventScroll: true });
  scrollDown();
}

// 입력이 끝난 필드는 숨기고 로그에 기록으로 남김
function closeField(f, shown) {
  f.box.hidden = true;
  f.err.textContent = "";
  const echo = make("div", "line echo");
  echo.append(make("span", "ps", "> "), make("span", "msg", shown));
  $log.append(make("div", "field-label", f.label), echo);
}

function fieldError(f, msg) {
  f.err.replaceChildren(make("span", "tag tag-err", "[ERR]"), ` ${msg}`);
  restart(f.input.parentElement, "shake");
  scrollDown();
}

function submitEmail() {
  const { email, password } = fields;
  const v = email.input.value.trim();
  if (!v) return fieldError(email, "Trainer identifier required.");
  if (!EMAIL_RE.test(v)) return fieldError(email, "Invalid identifier format.");

  email.input.value = v;
  email.input.readOnly = true;
  closeField(email, v);
  // 키 이벤트 안에서 바로 포커스해야 모바일 키보드가 내려가지 않음
  stage = "password";
  openField(password);
}

async function submitPassword() {
  const { email, password } = fields;
  const pw = password.input.value;
  if (!pw) return fieldError(password, "Access key required.");

  stage = "busy";
  password.input.readOnly = true;
  password.input.blur();
  closeField(password, "********");

  const attempt = signInWithEmailAndPassword(auth, email.input.value, pw)
    .then(() => null, (err) => err.code || "unknown");

  gap();
  await verify(attempt);
}

// 비밀번호 입력 이후의 인증 로그 → 성공/실패 처리
async function verify(attempt) {
  await line("[AUTH] Credential packet received.");
  await lead("[AUTH] Encrypting", "OK");
  await lead("[AUTH] Verifying signature", "OK");
  await lead("[AUTH] Comparing authentication key", attempt.then((code) => (code ? "MISMATCH" : "MATCH")));

  const code = await attempt;
  if (code) await fail(code);
  else await success();
}

function submit() {
  if (stage === "email") submitEmail();
  else if (stage === "password") submitPassword();
}

const LOCKED_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

for (const f of Object.values(fields)) {
  const { input, box } = f;
  // 커서 블록은 항상 끝에 있으므로 캐럿도 끝에 고정
  const pin = () => {
    const n = input.value.length;
    try { input.setSelectionRange(n, n); } catch {}
  };
  let typingTimer;

  input.addEventListener("input", () => {
    sync(f);
    f.err.textContent = "";
    box.classList.add("typing");
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => box.classList.remove("typing"), 500);
    pin();
  });
  input.addEventListener("change", () => sync(f));
  input.addEventListener("keydown", (e) => {
    if (LOCKED_KEYS.has(e.key)) e.preventDefault();
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener("click", pin);
  input.addEventListener("focus", () => {
    box.classList.add("focused");
    requestAnimationFrame(pin);
  });
  input.addEventListener("blur", () => box.classList.remove("focused"));
}

$form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});

// 화면 아무 곳이나 누르면 현재 입력칸으로 포커스
$screen.addEventListener("click", () => {
  if (getSelection().toString()) return;
  fields[stage]?.input.focus({ preventScroll: true });
});

// 부팅 중 키 입력/탭 → 빠르게 넘기기
function skipBoot() {
  if (stage !== "boot") return;
  speed = 0.25;
  burst = true;
  $skip.hidden = true;
}
addEventListener("keydown", skipBoot);
$screen.addEventListener("pointerdown", skipBoot);

// 모바일 가상 키보드가 올라오면 화면 높이를 맞춤
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", `${kb}px`);
    scrollDown();
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
}

// ── 시작 ─────────────────────────────────────

// 화면이 켜지는 연출(power-on: 가운데 가로줄 → 위아래로 펼침)이 끝난 뒤에 타이핑 시작
// (도중에 시작하면 왼쪽 아래 글자가 펼쳐지는 화면에 끌려 위에서 내려오는 것처럼 보임)
function poweredOn() {
  return new Promise((resolve) => {
    if (getComputedStyle($screen).animationName === "none") return resolve();
    const done = (e) => {
      if (e && e.target !== $screen) return;
      $screen.removeEventListener("animationend", done);
      resolve();
    };
    $screen.addEventListener("animationend", done);
    setTimeout(done, 1000); // animationend가 안 오는 경우 대비
  });
}

Promise.all([poweredOn(), auth.authStateReady()]).then(async () => {
  // 이미 로그인된 브라우저 → 부팅·입력 생략하고 인증 로그부터 출력 후 main으로
  if (auth.currentUser) {
    stage = "busy";
    $skip.hidden = true;
    await verify(Promise.resolve(null));
    return;
  }

  await boot();
  speed = 1;
  burst = reduceMotion;
  $skip.hidden = true;
  stage = "email";
  openField(fields.email);
});

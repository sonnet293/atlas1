// js/introFx.js — 인트로용 노이즈/글리치 효과
// intensity(0~1)에 따라 화면 노이즈, 흔들림, RGB 분리, 찢어짐(가로 막대), 반전이 강해진다.

const rand = (a, b) => a + Math.random() * (b - a);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createFx({ canvas, screen, bars }) {
  const ctx = canvas.getContext("2d");
  let img, buf;

  // 저해상도로 그린 뒤 CSS로 늘려서 굵은 노이즈 입자
  function resize() {
    const w = 180;
    const h = Math.max(60, Math.round(w * (innerHeight / Math.max(1, innerWidth))));
    canvas.width = w;
    canvas.height = h;
    img = ctx.createImageData(w, h);
    buf = new Uint32Array(img.data.buffer);
  }
  resize();
  addEventListener("resize", resize);

  let intensity = 0.12;
  let tween = null;   // { from, to, start, dur }
  let spikeUntil = 0;
  let lastGlitch = 0;
  let running = true;

  function level(t) {
    if (tween) {
      const p = Math.min(1, (t - tween.start) / tween.dur);
      intensity = tween.from + (tween.to - tween.from) * p;
      if (p >= 1) tween = null;
    }
    let g = intensity + (t < spikeUntil ? 0.55 : 0);
    if (reduceMotion) g *= 0.4;
    return Math.min(1, g);
  }

  function drawNoise(g) {
    const w = canvas.width;
    // 가끔 밝은 가로 줄(신호 끊김)
    const lineRow = Math.random() < g ? (Math.random() * canvas.height) | 0 : -1;
    for (let i = 0; i < buf.length; i++) {
      let v = (Math.random() * 255) | 0;
      if (lineRow >= 0 && ((i / w) | 0) === lineRow) v = 200 + ((Math.random() * 55) | 0);
      buf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    ctx.putImageData(img, 0, 0);
    canvas.style.opacity = (0.06 + g * 0.42).toFixed(3);
  }

  function glitch(g) {
    const shake = Math.random() < g * 0.7;
    screen.style.transform = shake
      ? `translate(${(rand(-36, 36) * g).toFixed(1)}px, ${(rand(-14, 14) * g).toFixed(1)}px) skewX(${(rand(-10, 10) * g).toFixed(1)}deg)`
      : "";
    screen.style.setProperty("--split", `${(rand(1, 7) * g).toFixed(1)}px`);
    screen.classList.toggle("ix-rgb", Math.random() < g * 1.1);
    screen.classList.toggle("ix-invert", Math.random() < g * g * 0.12);
    screen.classList.toggle("ix-tear", Math.random() < g * 0.5);
    screen.style.setProperty("--tear-y", `${rand(5, 90).toFixed(0)}%`);
    screen.style.setProperty("--tear-x", `${(rand(-60, 60) * g).toFixed(0)}px`);

    for (const bar of bars) {
      if (Math.random() < g * 0.55) {
        bar.style.display = "block";
        bar.style.top = `${rand(0, 100).toFixed(1)}%`;
        bar.style.height = `${rand(1, 4 + 46 * g).toFixed(0)}px`;
        bar.style.transform = `translateX(${(rand(-40, 40) * g).toFixed(0)}px)`;
        bar.style.opacity = rand(0.2, 0.9).toFixed(2);
      } else {
        bar.style.display = "none";
      }
    }
  }

  function frame(t) {
    if (!running) return;
    const g = level(t);
    drawNoise(g);
    // 글리치는 끊기는 느낌이 나도록 50ms 간격으로만 갱신
    if (t - lastGlitch > 50) {
      lastGlitch = t;
      glitch(g);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    set(v) { tween = null; intensity = v; },
    to(v, dur) { tween = { from: intensity, to: v, start: performance.now(), dur }; },
    spike(ms = 250) { spikeUntil = performance.now() + ms; },
    stop() {
      running = false;
      removeEventListener("resize", resize);
      screen.style.transform = "";
      screen.classList.remove("ix-rgb", "ix-invert", "ix-tear");
      bars.forEach((b) => { b.style.display = "none"; });
    },
  };
}

// ── 터미널 출력용 문장 ─────────────────────────────

const hex = (n) => Math.floor(Math.random() * 16 ** n).toString(16).toUpperCase().padStart(n, "0");

const LOG_LINES = [
  "[SIM] Loading battle core",
  "[SIM] Mounting arena geometry",
  "[SIM] Calibrating damage matrix",
  "[SIM] Injecting trainer profiles",
  "[NET] Syncing opponent telemetry",
  "[NET] Packet loss detected",
  "[SYS] Experimental subsystem responding",
  "[SYS] Override request from PROJECT LEAD",
  "[WARN] Signal integrity degraded",
  "[WARN] Safety limiter not responding",
  "[ERR] Checksum mismatch at sector 0x",
  "[ERR] Unexpected interrupt",
];
const STATUS = ["OK", "OK", "OK", "FAIL", "????", "OVERRIDE", "OK"];

// 빠르게 쏟아지는 로그 한 줄
export function spewLine() {
  const r = Math.random();
  if (r < 0.45) {
    const bytes = Array.from({ length: 8 }, () => hex(2)).join(" ");
    return `0x${hex(8)}  ${bytes}  |${hex(4)}..${hex(2)}|`;
  }
  const base = LOG_LINES[(Math.random() * LOG_LINES.length) | 0];
  if (base.endsWith("0x")) return base + hex(4);
  const dots = ".".repeat(Math.max(3, 40 - base.length));
  return `${base}${dots} ${STATUS[(Math.random() * STATUS.length) | 0]}`;
}

// 텍스트가 무작위 문자에서 원래 글자로 맞춰지는 효과
const SCRAMBLE = "!<>-_\\/[]{}=+*^?#01ABCDEFXYZ";
export function scramble(node, text, dur = 700) {
  const chars = [...text];
  const start = performance.now();
  return new Promise((resolve) => {
    function step(t) {
      const p = Math.min(1, (t - start) / dur);
      const fixed = Math.floor(chars.length * p);
      node.textContent = chars
        .map((c, i) => (i < fixed || c === " " ? c : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]))
        .join("");
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

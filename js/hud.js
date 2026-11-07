// js/hud.js — 상단 상태바의 UTC 시계 ([data-clock] 요소마다 1초마다 갱신)
const clocks = document.querySelectorAll("[data-clock]");

function tick() {
    const now = new Date().toISOString().slice(11, 19);
    clocks.forEach((node) => { node.textContent = now; });
}

tick();
setInterval(tick, 1000);

// ── 창밖 배경: <body data-backdrop="사진 경로"> ─────────────────────
// 사진을 아주 작게 줄여 그린 캔버스를 화면 크기로 늘려서(모자이크) 흐리게 → 유리 너머로 멀리 보이는 느낌
const backdropSrc = document.body.dataset.backdrop;

if (backdropSrc) {
    const CELLS = 250; // 가로 칸 수 (작을수록 모자이크가 굵어짐)

    const wrap = document.createElement("div");
    wrap.className = "backdrop";
    wrap.setAttribute("aria-hidden", "true");
    const canvas = document.createElement("canvas");
    canvas.className = "backdrop-mosaic";
    const glass = document.createElement("div");
    glass.className = "backdrop-glass";
    wrap.append(canvas, glass);
    document.body.prepend(wrap);

    const img = new Image();
    img.onload = () => {
        canvas.width = CELLS;
        canvas.height = Math.max(1, Math.round(CELLS * img.naturalHeight / img.naturalWidth));
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high"; // 줄일 때 색을 평균내서 칸마다 뭉개진 색
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        wrap.classList.add("ready");
    };
    img.src = backdropSrc;
}

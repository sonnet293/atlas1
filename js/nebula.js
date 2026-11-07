// js/nebula.js — 방 카드의 성운 배경이 마우스를 따라 부드럽게 일렁이도록
// 각 .room-visual에 --mx, --my(-1 ~ 1)를 넣어 주면 css/main.css가 배경을 반대로 살짝 민다.
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (finePointer && !reduceMotion) {
    const EASE = 0.06; // 작을수록 더 느리게 따라옴 (물결처럼 늦게 따라오는 느낌)
    const state = new WeakMap(); // 요소별 현재 위치 { x, y }
    let px = innerWidth / 2;
    let py = innerHeight / 2;
    let running = false;

    const clamp = (v) => Math.max(-1, Math.min(1, v));

    function frame() {
        let moving = false;
        for (const node of document.querySelectorAll(".room-visual")) {
            const r = node.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight) continue;

            // 카드 중심에서 마우스까지의 거리 (카드에 가까울수록 크게 반응)
            const tx = clamp((px - (r.left + r.width / 2)) / (r.width * 0.9));
            const ty = clamp((py - (r.top + r.height / 2)) / (r.height * 1.6));

            const s = state.get(node) ?? { x: 0, y: 0 };
            s.x += (tx - s.x) * EASE;
            s.y += (ty - s.y) * EASE;
            state.set(node, s);

            node.style.setProperty("--mx", s.x.toFixed(3));
            node.style.setProperty("--my", s.y.toFixed(3));
            if (Math.abs(tx - s.x) > 0.002 || Math.abs(ty - s.y) > 0.002) moving = true;
        }
        // 다 따라왔으면 멈췄다가 마우스가 움직이면 다시 시작
        running = moving;
        if (running) requestAnimationFrame(frame);
    }

    function wake() {
        if (!running) {
            running = true;
            requestAnimationFrame(frame);
        }
    }

    addEventListener("pointermove", (e) => {
        px = e.clientX;
        py = e.clientY;
        wake();
    }, { passive: true });
    addEventListener("scroll", wake, { passive: true });
    document.addEventListener("mouseleave", () => {
        px = innerWidth / 2;
        py = innerHeight / 2;
        wake();
    });
}

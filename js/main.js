// js/main.js — 배틀룸 목록 (rooms 컬렉션을 구독해서 방마다 상태를 실시간 표시)
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ROOMS, roomStatus, roomBgStyle, playerSlots } from "./rooms.js";
import { fillAvatar } from "./avatar.js";

const grid = document.getElementById("room-grid");
const pagerLabel = document.getElementById("pager-label");
const pagerDots = document.getElementById("pager-dots");
const pagerPrev = document.getElementById("pager-prev");
const pagerNext = document.getElementById("pager-next");
const summary = document.getElementById("room-summary");
const cards = new Map(); // roomId -> 카드 요소
let myUid = null;
let unsubRooms = null;

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
};

// 화면에는 방을 3개씩만 보여주고, 옆으로 넘기면 다음 3개 (1~3: 싱글, 4~6: 더블)
const ROOMS_PER_PAGE = 3;
const pages = [];
for (let i = 0; i < ROOMS.length; i += ROOMS_PER_PAGE) {
    const rooms = ROOMS.slice(i, i + ROOMS_PER_PAGE);
    const page = el("div", "room-page");
    page.dataset.label = rooms[0].mode === "double" ? "DOUBLE BATTLE" : "SINGLE BATTLE";
    page.setAttribute("aria-label", `${page.dataset.label} ${rooms[0].no}-${rooms[rooms.length - 1].no}`);
    grid.append(page);
    pages.push(page);
}

// 카드 뼈대는 로그인 확인 전에 먼저 그려둔다
for (const [i, info] of ROOMS.entries()) {
    const card = el("a", "room-card hud");
    card.href = `pages/battleroom${info.no}.html`;
    card.dataset.roomId = info.id;
    card.dataset.mode = info.mode;

    const visual = el("div", "room-visual");
    // CSS 변수 안의 url()은 사용하는 스타일시트(css/) 기준으로 풀리므로 절대 경로로 넘김
    visual.style.setProperty("--room-bg", roomBgStyle(info, new URL("img/", document.baseURI).href) || null);
    visual.append(el("span", "room-no", `ROOM ${String(info.no).padStart(2, "0")}`));
    const pill = el("span", "status-pill");
    pill.append(el("i"), el("span", "status-label", "LOADING"));
    visual.append(pill);
    const mine = el("span", "room-mine", "[ CONNECT ]");
    mine.hidden = true;
    visual.append(mine);

    const body = el("div", "room-body");
    body.append(el("h2", "room-name", info.name));
    const seats = el("div", "room-seats");
    if (info.mode === "double") {
        // 팀 A(P1·P2) vs 팀 B(P3·P4)
        seats.classList.add("double");
        const teamA = el("div", "seat-team");
        teamA.append(makeSeat("P1"), makeSeat("P2"));
        const teamB = el("div", "seat-team");
        teamB.append(makeSeat("P3"), makeSeat("P4"));
        seats.append(teamA, el("span", "room-vs", "VS"), teamB);
        visual.append(el("span", "room-mode", "2 VS 2"));
    } else {
        seats.append(makeSeat("P1"), el("span", "room-vs", "VS"), makeSeat("P2"));
    }
    body.append(seats);
    const foot = el("div", "room-foot");
    foot.append(el("span", "room-watchers", "OBSERVE 0"), el("span", "room-cta", "CONNECT →"));
    body.append(foot);

    card.append(visual, body);
    pages[Math.floor(i / ROOMS_PER_PAGE)].append(card);
    cards.set(info.id, card);
}

// ---- 페이지 넘기기 (터치는 스와이프, 데스크탑은 화살표/점/키보드) ----
let currentPage = 0;

pages.forEach((page, i) => {
    const dot = el("button", "pager-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", page.getAttribute("aria-label"));
    dot.onclick = () => goToPage(i);
    pagerDots.append(dot);
});

// 첫 페이지 기준 스크롤 위치
const pageOffset = (idx) => pages[idx].offsetLeft - pages[0].offsetLeft;

function goToPage(i, smooth = true) {
    const idx = Math.max(0, Math.min(pages.length - 1, i));
    grid.scrollTo({ left: pageOffset(idx), behavior: smooth ? "smooth" : "auto" });
    setPage(idx);
}

function setPage(idx) {
    currentPage = idx;
    pagerLabel.textContent = pages[idx].dataset.label;
    pagerPrev.disabled = idx === 0;
    pagerNext.disabled = idx === pages.length - 1;
    [...pagerDots.children].forEach((d, j) => d.setAttribute("aria-current", String(j === idx)));
    pages.forEach((p, j) => p.inert = j !== idx); // 화면 밖 페이지 카드는 탭 이동 대상에서 제외
    try { sessionStorage.setItem("roomPage", String(idx)); } catch {}
}

pagerPrev.onclick = () => goToPage(currentPage - 1);
pagerNext.onclick = () => goToPage(currentPage + 1);
document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea")) return;
    if (e.key === "ArrowLeft") goToPage(currentPage - 1);
    if (e.key === "ArrowRight") goToPage(currentPage + 1);
});

// 스와이프(스크롤 스냅)로 넘긴 경우 현재 페이지 표시를 따라감
let scrollTimer = null;
grid.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
        let idx = 0;
        pages.forEach((_, j) => {
            if (Math.abs(pageOffset(j) - grid.scrollLeft) < Math.abs(pageOffset(idx) - grid.scrollLeft)) idx = j;
        });
        if (idx !== currentPage) setPage(idx);
    }, 80);
});
window.addEventListener("resize", () => goToPage(currentPage, false));

let savedPage = 0;
try { savedPage = Number(sessionStorage.getItem("roomPage")) || 0; } catch {}
requestAnimationFrame(() => goToPage(savedPage, false));

function makeSeat(label) {
    const seat = el("div", "seat");
    seat.append(el("span", "seat-label", label), el("span", "seat-name", "-"), el("span", "seat-ready"));
    return seat;
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        location.href = "index.html";
        return;
    }
    myUid = user.uid;

    const userSnap = await getDoc(doc(db, "users", myUid));
    const nickname = userSnap.data()?.nickname ?? "TRAINER";
    document.getElementById("trainer-name").textContent = nickname;
    fillAvatar(document.getElementById("trainer-initial"), {
        uid: myUid,
        name: nickname,
        src: userSnap.data()?.profileImage,
    });

    if (!unsubRooms) {
        unsubRooms = onSnapshot(collection(db, "rooms"), (snap) => {
            const rooms = new Map(snap.docs.map((d) => [d.id, d.data()]));
            renderRooms(rooms);
        });
    }
});

document.getElementById("logoutBtn").onclick = () => signOut(auth);

function renderRooms(rooms) {
    const counts = { waiting: 0, playing: 0, ended: 0 };

    for (const info of ROOMS) {
        const room = rooms.get(info.id);
        const status = roomStatus(room);
        if (status.key in counts) counts[status.key]++;
        renderCard(cards.get(info.id), room, status);
    }

    summary.innerHTML = "";
    const labels = { waiting: "STANDBY", playing: "SIMULATING", ended: "COMPLETE" };
    for (const [key, n] of Object.entries(counts)) {
        if (!n) continue;
        const pill = el("span", "status-pill");
        pill.dataset.status = key;
        pill.append(el("i"), `${labels[key]} ${n}`);
        summary.append(pill);
    }
}

function renderCard(card, room, status) {
    card.dataset.status = status.key;
    card.querySelector(".status-label").textContent = status.label;

    const closed = status.key === "closed";
    card.setAttribute("aria-disabled", String(closed));
    card.tabIndex = closed ? -1 : 0;

    const seats = card.querySelectorAll(".seat");
    const slots = playerSlots(card.dataset.roomId);
    slots.forEach((slot, i) => {
        const seat = seats[i];
        const name = room?.[`${slot}_name`];
        const key = `p${i + 1}`;
        // 싱글은 "p1"/"p2", 더블은 팀("t1": P1·P2 / "t2": P3·P4)이 승자로 기록됨
        const won = room?.battle_winner === key || room?.battle_winner === (i < 2 ? "t1" : "t2");
        seat.dataset.empty = String(!name);
        seat.dataset.winner = String(!!name && won);
        seat.querySelector(".seat-name").textContent = name ?? "NO SIGNAL...";

        let tag = "";
        if (status.key === "ended" && won) tag = "WIN";
        else if (status.key === "waiting" && room?.[`${slot}_ready`]) tag = "READY";
        seat.querySelector(".seat-ready").textContent = tag;
    });

    const spectatorCount = room?.spectators?.length ?? 0;
    card.querySelector(".room-watchers").textContent = closed ? "GM이 방을 열면 입장할 수 있어요" : `OBSERVE ${spectatorCount}`;

    const isMine = !!room && !!myUid && (
        slots.some((slot) => room[`${slot}_uid`] === myUid) ||
        (room.spectators ?? []).includes(myUid)
    );
    card.querySelector(".room-mine").hidden = !isMine;

    const seatsFull = slots.every((slot) => !!room?.[`${slot}_uid`]);
    let cta = "CONNECT →";
    if (closed) cta = "";
    else if (isMine) cta = "CONNECT →";
    else if (status.key !== "waiting" || seatsFull) cta = "OBSERVE →";
    card.querySelector(".room-cta").textContent = cta;
}

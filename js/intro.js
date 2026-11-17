// intro.js

import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"
import { doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
import { runSelection } from "./select.js"

// 시작 터치/포켓몬 선택에 참여하는 자리 (p1 -> player1_uid, intro_ready_p1)
const SIDES = ["p1", "p2"]

const BGM_LIST = [
  "../bgm/bgm1.mp3",
  "../bgm/bgm2.mp3",
  "../bgm/bgm3.mp3"
]

export let bgmAudio = null

// 저장된 BGM 음량 (새로고침해도 유지)
const VOLUME_KEY = "bgmVolume"
let bgmVolume = 0.7
try {
  const saved = parseFloat(localStorage.getItem(VOLUME_KEY))
  if (!isNaN(saved)) bgmVolume = Math.min(1, Math.max(0, saved))
} catch {}

export function fadeBgmOut(duration = 2000) {
  if (!bgmAudio) return
  const step = bgmAudio.volume / (duration / 50)
  const timer = setInterval(() => {
    if (bgmAudio.volume > step) {
      bgmAudio.volume = Math.max(0, bgmAudio.volume - step)
    } else {
      bgmAudio.volume = 0
      bgmAudio.pause()
      clearInterval(timer)
    }
  }, 50)
}

function playBgm() {
  if (bgmAudio) return
  const chosen = BGM_LIST[Math.floor(Math.random() * BGM_LIST.length)]
  bgmAudio = new Audio(chosen)
  bgmAudio.loop   = true
  bgmAudio.volume = bgmVolume
  bgmAudio.play().catch(() => {
    // 터치 없이 자동 시작된 경우(관전자) 브라우저가 자동재생을 막음 → 첫 터치 때 재생
    document.addEventListener("pointerdown", () => bgmAudio.play().catch(() => {}), { once: true })
  })
}

const overlay     = document.getElementById("intro-overlay")
const touchPrompt = document.getElementById("touch-prompt")
const readyStatus = document.getElementById("touch-ready-status")
const roomRef     = doc(db, "rooms", ROOM_ID)

const isSpectatorParam = new URLSearchParams(location.search).get("spectator") === "true"

let myUid          = null
let mySlot         = null
let touched        = false
let battleStarting = false

onAuthStateChanged(auth, async (user) => {
  if (!user) return
  myUid = user.uid

  // 게임 시작 직후엔 먼저 포켓몬 선택 화면 (이미 끝났으면 바로 넘어감)
  await runSelection({ roomRef, myUid, spectator: isSpectatorParam })

  const snap = await getDoc(roomRef)
  const room = snap.data()
  if (isSpectatorParam) mySlot = "spectator"
  else mySlot = SIDES.find((k) => room?.[`player${k.slice(1)}_uid`] === myUid) ?? "spectator"

  // 이미 배틀이 시작된 상태 = 게임 도중 새로고침(관전자는 배틀 도중 입장) → 대기 화면 스킵
  if (room?.intro_done) {
    skipIntro()
    return
  }

  // 관전자는 터치 없이, 플레이어가 모두 터치하면 자동으로 시작
  if (mySlot === "spectator") {
    touchPrompt.hidden = true
    readyStatus.innerText = "플레이어를 기다리는 중..."
  } else {
    bindTouch()
  }
  listenReady()
})

function bindTouch() {
  const handler = () => {
    if (touched) return
    touched = true
    document.removeEventListener("click",      handler)
    document.removeEventListener("touchstart", handler)
    onTouched()
  }
  document.addEventListener("click",      handler)
  document.addEventListener("touchstart", handler)
}

async function onTouched() {
  // BGM — 터치 컨텍스트 안에서 바로 재생
  playBgm()
  touchPrompt.hidden = true
  readyStatus.innerText = "상대방을 기다리는 중..."
  await updateDoc(roomRef, { [`intro_ready_${mySlot}`]: true })
}

function listenReady() {
  onSnapshot(roomRef, (snap) => {
    const room = snap.data()
    if (!room) return

    const allReady = SIDES.every((k) => !!room[`intro_ready_${k}`])

    if (mySlot === "spectator") {
      if (room.intro_done) skipIntro()
      else if (allReady) startBattle()
      return
    }

    if (touched && allReady) startBattle()
  })
}

function startBattle() {
  if (battleStarting) return
  battleStarting = true
  if (mySlot === "p1") updateDoc(roomRef, { intro_done: true }).catch(() => {})
  if (mySlot === "spectator") playBgm()
  overlay.classList.add("hidden")
  document.dispatchEvent(new Event("battle:introDone"))
}

function initVolumeSlider() {
  const slider  = document.getElementById("bgm-volume")
  const label   = document.getElementById("bgm-volume-label")
  const muteBtn = document.getElementById("bgm-mute-btn")
  if (!slider) return

  let lastNonZero = bgmVolume > 0 ? bgmVolume : 0.7

  const apply = (v) => {
    bgmVolume = v
    if (v > 0) lastNonZero = v
    if (bgmAudio) bgmAudio.volume = v
    slider.value = v
    label.innerText = Math.round(v * 100) + "%"
    if (muteBtn) muteBtn.innerText = v === 0 ? "🔇" : v < 0.4 ? "🔉" : "🔊"
    try { localStorage.setItem(VOLUME_KEY, String(v)) } catch {}
  }

  slider.addEventListener("input", () => apply(parseFloat(slider.value)))
  muteBtn?.addEventListener("click", () => apply(bgmVolume === 0 ? lastNonZero : 0))
  apply(bgmVolume)
}

initVolumeSlider()

function skipIntro() {
  if (battleStarting) return
  battleStarting = true
  overlay.classList.add("hidden")
  document.dispatchEvent(new Event("battle:introDone"))

  // BGM 복원
  // 모바일은 터치 컨텍스트 안에서 Audio 생성 + play() 해야 함
  // → 토스트 버튼 onclick 안에서 처리
  const chosen = BGM_LIST[Math.floor(Math.random() * BGM_LIST.length)]

  // 데스크탑은 바로 시도
  const testAudio = new Audio(chosen)
  testAudio.loop   = true
  testAudio.volume = bgmVolume
  testAudio.play().then(() => {
    bgmAudio = testAudio  // 성공하면 그대로 사용
  }).catch(() => {
    // 실패하면 토스트 — onclick 안에서 새로 생성
    showBgmToast(chosen)
    setTimeout(() => {
      if (bgmAudio && bgmAudio.paused) showBgmToast(chosen)
    }, 500)
  })

  setTimeout(() => {
    if (!bgmAudio || bgmAudio.paused) showBgmToast(chosen)
  }, 500)
}

function showBgmToast(chosen) {
  if (document.getElementById("bgm-toast")) return

  if (!document.getElementById("bgm-toast-style")) {
    const s = document.createElement("style")
    s.id = "bgm-toast-style"
    s.textContent = `
      #bgm-toast {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.8); color: #fff;
        padding: 12px 24px; border-radius: 999px;
        font-size: 14px; z-index: 9999;
        border: none; cursor: pointer;
        white-space: nowrap;
      }
    `
    document.head.appendChild(s)
  }

  const btn = document.createElement("button")
  btn.id = "bgm-toast"
  btn.innerText = "🎵 탭하여 브금 재생"

  btn.onclick = () => {
    // 터치 컨텍스트 안에서 Audio 새로 생성 + play() → 모바일 정책 우회
    bgmAudio = new Audio(chosen)
    bgmAudio.loop   = true
    bgmAudio.volume = bgmVolume
    bgmAudio.play().catch(() => {})
    btn.remove()
  }

  document.body.appendChild(btn)
  setTimeout(() => btn.remove(), 10000)
}
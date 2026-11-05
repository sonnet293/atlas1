// users/upload.js
// users/users.js의 유저 정보(nickname, entry)를 Firestore users/{uid} 문서에 올리는 로컬 전용 스크립트.
// 웹사이트에서는 절대 불러오지 않는다. (users.js와 서비스 계정 키는 .gitignore로 깃허브에 올라가지 않음)
//
// 준비 (처음 한 번):
//   1) Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성" → 받은 JSON을 users/serviceAccountKey.json 으로 저장
//   2) users 폴더에서 `npm install`
//
// 사용:
//   node upload.js                 users.js의 모든 유저 업로드
//   node upload.js <uid> [<uid>]   지정한 유저만 업로드
//   node upload.js --dry-run       검사만 하고 업로드하지 않음
//
// 업로드는 merge 방식이라 nickname/entry만 덮어쓰고, 같은 문서의 다른 필드(cardSlots, profileImage 등)는 유지된다.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { MOVES } from "../js/moves.js";
import users from "./users.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const KEY_PATH = join(HERE, "serviceAccountKey.json");
const PROJECT_ID = "atlas-f52d2"; // js/firebase.js와 같은 프로젝트

const TYPES = new Set([
  "노말", "불", "물", "전기", "풀", "얼음", "격투", "독", "땅",
  "비행", "에스퍼", "벌레", "바위", "고스트", "드래곤", "악", "강철", "페어리",
]);

// 배틀 엔진이 깨지지 않도록 업로드 전에 엔트리를 검사. 반환: { errors, warnings }
function validateUser(uid, user) {
  const errors = [];
  const warnings = [];
  const where = (i, p) => `${user.nickname ?? uid} / entry[${i}] ${p?.name ?? ""}`;

  if (typeof user.nickname !== "string" || !user.nickname.trim()) errors.push(`${uid}: nickname 없음`);
  if (!Array.isArray(user.entry) || user.entry.length === 0) {
    errors.push(`${uid}: entry가 비어 있음`);
    return { errors, warnings };
  }
  if (user.entry.length > 6) warnings.push(`${user.nickname}: entry가 ${user.entry.length}마리 (6마리 초과)`);

  user.entry.forEach((p, i) => {
    if (!p?.name) errors.push(`${where(i, p)}: name 없음`);
    for (const stat of ["atk", "def", "spd"]) {
      if (!Number.isFinite(p?.[stat])) errors.push(`${where(i, p)}: ${stat}가 숫자가 아님`);
    }
    if (!Number.isFinite(p?.hp) || p.hp <= 0) errors.push(`${where(i, p)}: hp가 없거나 0 이하`);
    if (!Array.isArray(p?.type) || p.type.length === 0) errors.push(`${where(i, p)}: type 없음`);
    else p.type.filter((t) => !TYPES.has(t)).forEach((t) => errors.push(`${where(i, p)}: 알 수 없는 타입 "${t}"`));

    if (!Array.isArray(p?.moves) || p.moves.length === 0) errors.push(`${where(i, p)}: moves 없음`);
    else {
      if (p.moves.length > 4) errors.push(`${where(i, p)}: 기술이 ${p.moves.length}개 (최대 4개)`);
      p.moves.forEach((m) => {
        if (!MOVES[m?.name]) errors.push(`${where(i, p)}: js/moves.js에 없는 기술 "${m?.name}"`);
        if (!Number.isInteger(m?.pp) || m.pp <= 0) errors.push(`${where(i, p)}: ${m?.name}의 pp가 올바르지 않음`);
      });
    }
    if (p?.portrait && !existsSync(join(ROOT, p.portrait))) warnings.push(`${where(i, p)}: 초상화 파일 없음 (${p.portrait})`);
  });
  return { errors, warnings };
}

function initFirestore() {
  if (existsSync(KEY_PATH)) {
    const key = JSON.parse(readFileSync(KEY_PATH, "utf8"));
    if (key.project_id && key.project_id !== PROJECT_ID) {
      throw new Error(`서비스 계정 키의 프로젝트(${key.project_id})가 ${PROJECT_ID}가 아님`);
    }
    initializeApp({ credential: cert(key), projectId: PROJECT_ID });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  } else {
    throw new Error("users/serviceAccountKey.json 이 없음 (파일 맨 위 '준비' 참고)");
  }
  return getFirestore();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyUids = args.filter((a) => !a.startsWith("--"));

  const unknown = onlyUids.filter((uid) => !users[uid]);
  if (unknown.length > 0) throw new Error(`users.js에 없는 uid: ${unknown.join(", ")}`);
  const targets = Object.entries(users).filter(([uid]) => onlyUids.length === 0 || onlyUids.includes(uid));

  let hasError = false;
  for (const [uid, user] of targets) {
    const { errors, warnings } = validateUser(uid, user);
    warnings.forEach((w) => console.warn(`  [경고] ${w}`));
    errors.forEach((e) => console.error(`  [오류] ${e}`));
    if (errors.length > 0) hasError = true;
  }
  if (hasError) throw new Error("오류가 있어 업로드하지 않음");

  if (dryRun) {
    console.log(`검사 통과: ${targets.length}명 (--dry-run이라 업로드하지 않음)`);
    return;
  }

  const db = initFirestore();
  const batch = db.batch();
  for (const [uid, user] of targets) {
    batch.set(db.collection("users").doc(uid), { nickname: user.nickname, entry: user.entry }, { merge: true });
  }
  await batch.commit();
  targets.forEach(([uid, user]) => console.log(`  업로드: ${user.nickname} (${uid}) - 포켓몬 ${user.entry.length}마리`));
  console.log(`완료: ${targets.length}명`);
}

main().catch((err) => {
  console.error(`실패: ${err.message}`);
  process.exit(1);
});

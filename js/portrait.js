// js/portrait.js
// entry[i].portrait 값 -> 실제 이미지 주소.
// - "portrait/루가루암.png" 같은 상대경로는 사이트 루트(이 js 폴더의 상위) 기준으로 바꾼다.
//   (games/battleroom1.html처럼 하위 폴더 페이지에서도 루트의 portrait 폴더를 가리키도록)
// - 예전 방식의 외부 링크(http/https), data:, 절대경로(/...)는 그대로 쓴다.
const SITE_ROOT = new URL("../", import.meta.url);

export function portraitUrl(portrait) {
  if (typeof portrait !== "string" || !portrait.trim()) return null;
  const p = portrait.trim();
  if (/^(https?:|data:|blob:|\/)/i.test(p)) return p;
  return new URL(p.replace(/^\.\//, ""), SITE_ROOT).href;
}

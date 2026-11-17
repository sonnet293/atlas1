// js/room.js
// 모든 방은 1:1 싱글배틀 (player1 vs player2)
export const ROOMS = [
    {
        id: "battleroom1",
        no: 1,
        name: "1번 방",
    },
    {
        id: "battleroom2",
        no: 2,
        name: "2번 방",
    },
    {
        id: "battleroom3",
        no: 3,
        name: "3번 방",
    },
];

export function roomInfo(roomId) {
    return ROOMS.find((r) => r.id === roomId);
}

// 방 문서의 플레이어 자리 이름 (player1_uid, player1_name, player1_ready ...)
export const PLAYER_SLOTS = ["player1", "player2"];

export function roomStatus(room) {
  if (!room) return { key: "closed", label: "닫힘" };
  if (room.battle_winner) return { key: "ended", label: "종료" };
  if (room.game_started) return { key: "playing", label: "배틀 중" };
  return { key: "waiting", label: "대기 중" };
}

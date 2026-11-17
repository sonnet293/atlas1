// js/room.js
// 모든 방은 1:1 싱글배틀 (player1 vs player2)
export const ROOMS = [
    {
        id: "battleroom1",
        no: 1,
        name: "SIM-01",
    },
    {
        id: "battleroom2",
        no: 2,
        name: "SIM-02",
    },
    {
        id: "battleroom3",
        no: 3,
        name: "SIM-03",
    },
];

export function roomInfo(roomId) {
    return ROOMS.find((r) => r.id === roomId);
}

// 방 문서의 플레이어 자리 이름 (player1_uid, player1_name, player1_ready ...)
export const PLAYER_SLOTS = ["player1", "player2"];

export function roomStatus(room) {
  if (!room) return { key: "closed", label: "OFFLINE" };
  if (room.battle_winner) return { key: "ended", label: "COMPLETE" };
  if (room.game_started) return { key: "playing", label: "SIMULATING" };
  return { key: "waiting", label: "STANDBY" };
}

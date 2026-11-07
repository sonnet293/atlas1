// js/room.js
// mode: "single"(1:1, player1~2) | "double"(2:2 팀전, player1~4 — 1·2번 vs 3·4번)
export const ROOMS = [
    {
        id: "battleroom1",
        no: 1,
        name: "SIM-01",
        mode: "single",
        bg: null,
    },
    {
        id: "battleroom2",
        no: 2,
        name: "SIM-02",
        mode: "single",
        bg: null,
    },
    {
        id: "battleroom3",
        no: 3,
        name: "SIM-03",
        mode: "single",
        bg: null,
    },
    {
        id: "battleroom4",
        no: 4,
        name: "DBL-01",
        mode: "double",
        bg: "nebula2.jpg",
    },
    {
        id: "battleroom5",
        no: 5,
        name: "DBL-02",
        mode: "double",
        bg: "nebula2.jpg",
    },
    {
        id: "battleroom6",
        no: 6,
        name: "DBL-03",
        mode: "double",
        bg: "nebula2.jpg",
    },
];

export function roomInfo(roomId) {
    return ROOMS.find((r) => r.id === roomId);
}

export function isDoubleRoom(roomId) {
    return roomInfo(roomId)?.mode === "double";
}

// 방 문서의 플레이어 자리 이름 (player1_uid, player1_name, player1_ready ...)
export function playerSlots(roomId) {
    return isDoubleRoom(roomId)
        ? ["player1", "player2", "player3", "player4"]
        : ["player1", "player2"];
}

export function roomBgStyle(info, imgBase) {
  return info?.bg ? `url("${imgBase}${info.bg}")` : "";
}

export function roomStatus(room) {
  if (!room) return { key: "closed", label: "OFFLINE" };
  if (room.battle_winner) return { key: "ended", label: "COMPLETE" };
  if (room.game_started) return { key: "playing", label: "SIMULATING" };
  return { key: "waiting", label: "STANDBY" };
}

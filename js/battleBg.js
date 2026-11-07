// js/battleBg.js — 배틀 화면 배경
// 1) 우주정거장 사진 모자이크: 칸 크기가 숨 쉬듯 굵어졌다 가늘어졌다 함 (가끔 글리치처럼 확 굵어짐)
// 2) 배경 터미널: battlelog.md의 일반 로그를 한 줄씩 계속 출력
//    battle.js가 쏘는 이벤트로 공격/피격 로그를 한 번에 우르르 출력
//    - "battle:attack"                       공격 로그
//    - "battle:impact" { detail: { ... } }   피격 로그 (아래 impact() 참고)
(() => {
    const IMG_SRC = "../img/spacestation.jpg";
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── 화면 구성 ─────────────────────────────
    const root = document.createElement("div");
    root.className = "bb";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
        <canvas class="bb-mosaic"></canvas>
        <div class="bb-glass"></div>
        <div class="bb-term">
            <div class="bb-head">[VOYAGER SYSTEM TERMINAL]
SONNET LABORATORY // TRAINER RESEARCH NETWORK
BUILD VGR.26.10.03-R7
────────────────────────────────────────────────────</div>
            <div class="bb-stream"></div>
        </div>`;
    document.body.prepend(root);

    const canvas = root.querySelector(".bb-mosaic");
    const ctx = canvas.getContext("2d");
    const stream = root.querySelector(".bb-stream");

    // ── 모자이크 ─────────────────────────────
    const MIN_CELL = 3; // 가장 선명할 때 칸 크기(px)
    const MAX_CELL = 34; // 가장 뭉개질 때 칸 크기(px)
    const SPIKE_CELL = 70; // 글리치/피격 순간 칸 크기
    let source = null; // 미리 줄여 둔 사진 (매 프레임 원본을 줄이면 무거움)
    let spikeUntil = 0;
    let nextSpikeAt = performance.now() + 4000;
    let lastCell = 0;

    const img = new Image();
    img.onload = () => {
        const w = Math.min(960, img.naturalWidth);
        source = document.createElement("canvas");
        source.width = w;
        source.height = Math.round(w * img.naturalHeight / img.naturalWidth);
        source.getContext("2d").drawImage(img, 0, 0, source.width, source.height);
        root.classList.add("ready");
        requestAnimationFrame(frame);
    };
    img.src = IMG_SRC;

    function cellSize(now) {
        if (reduceMotion) return 10;
        if (now < spikeUntil) return SPIKE_CELL;
        if (now > nextSpikeAt) {
            spikeUntil = now + 90 + Math.random() * 160;
            nextSpikeAt = now + 3500 + Math.random() * 7000;
        }
        // 느린 사인 두 개를 섞어서 일정하지 않게 강해졌다 약해졌다
        const t = now / 1000;
        const wave = 0.5 + 0.5 * Math.sin(t * 0.9) * 0.7 + 0.5 * Math.sin(t * 0.37 + 1.3) * 0.3;
        return MIN_CELL + (MAX_CELL - MIN_CELL) * wave * wave;
    }

    let lastDraw = 0;
    function frame(now) {
        requestAnimationFrame(frame);
        if (now - lastDraw < 50) return; // 20fps면 충분
        lastDraw = now;

        const cell = Math.max(MIN_CELL, Math.round(cellSize(now)));
        const cols = Math.max(1, Math.round(innerWidth / cell));
        const rows = Math.max(1, Math.round(innerHeight / cell));
        if (canvas.width !== cols || canvas.height !== rows) {
            canvas.width = cols;
            canvas.height = rows;
        } else if (cell === lastCell && reduceMotion) {
            return;
        }
        lastCell = cell;

        // cover로 자르되 아주 천천히 떠다니게
        const t = now / 1000;
        const scale = Math.max(cols / source.width, rows / source.height) * 1.08;
        const sw = cols / scale;
        const sh = rows / scale;
        const sx = (source.width - sw) * (0.5 + 0.45 * Math.sin(t * 0.05));
        const sy = (source.height - sh) * (0.5 + 0.45 * Math.cos(t * 0.04));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high"; // 줄일 때 칸마다 평균 색
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows);
    }

    // ── 배경 터미널 ─────────────────────────────
    // battlelog.md "일반 로그". 빈 줄로 나뉜 묶음 단위로 랜덤 출력, 시간은 현재 시각으로 바꿔 찍음
    const GENERAL_LOG = `
SYS     Initializing VOYAGER runtime environment...
SYS     Loading core modules...
CORE    voyager.kernel loaded
CORE    voyager.network loaded
CORE    voyager.auth loaded
CORE    voyager.archive loaded
CORE    voyager.simulation loaded
CORE    voyager.telemetry loaded
SYS     Core module verification complete.
SYS     Integrity check......................... OK
SYS     Memory allocation....................... OK
SYS     Local cache............................. OK
SYS     System clock synchronization............ OK
SYS     Runtime status.......................... NOMINAL

NET     Initializing network interface...
NET     Searching for VOYAGER gateway...
NET     Gateway detected: VGR-GATEWAY-01
NET     Establishing encrypted uplink...
NET     Encryption protocol initialized.
NET     Handshake request transmitted.
NET     Handshake acknowledged.
NET     Connection established.
NET     Packet integrity......................... 100%
NET     Packet loss.............................. 0.00%
NET     Network latency.......................... 021ms
NET     Signal strength.......................... 98.4%
NET     Uplink status............................ STABLE

DB      Connecting to VOYAGER database...
DB      Database node VGR-DB-03 responding.
DB      Opening read channel...
DB      Trainer registry mounted.
DB      Pokémon database mounted.
DB      Battle archive mounted.
DB      Simulation records mounted.
DB      Research dataset mounted.
DB      Checking archive integrity...
DB      Archive integrity......................... OK
DB      Records available......................... 184,291
DB      Database status........................... ONLINE

AUTH    Starting authentication service...
AUTH    Loading trainer identification protocol.
AUTH    Credential channel secured.
AUTH    Session token generator initialized.
AUTH    Authentication node....................... AUTH-01
AUTH    Access level.............................. TRAINER
AUTH    Status.................................... STANDBY

DSN     Connecting to Deep Space Network...
DSN     Long-range receiver initialized.
DSN     Calibrating signal array...
DSN     Calibration............................... COMPLETE
DSN     Scanning available frequencies...
DSN     CHANNEL 01................................. CLEAR
DSN     CHANNEL 02................................. CLEAR
DSN     CHANNEL 03................................. ACTIVE
DSN     CHANNEL 04................................. CLEAR
DSN     CHANNEL 05................................. ACTIVE
DSN     Long-range signal lock..................... ACQUIRED
DSN     Telemetry stream........................... ACTIVE

VGR     Initializing Trainer Network...
VGR     Discovering active nodes...
VGR     Node VGR-001............................... ONLINE
VGR     Node VGR-002............................... ONLINE
VGR     Node VGR-003............................... ONLINE
VGR     Node VGR-004............................... STANDBY
VGR     Node VGR-005............................... ONLINE
VGR     Node VGR-006............................... ONLINE
VGR     Active network nodes....................... 028
VGR     Remote trainer signals..................... 041
VGR     Active simulations......................... 012
VGR     Pending transmissions...................... 003

SIM     Starting simulation subsystem...
SIM     Loading battle engine...
SIM     Turn processor............................. READY
SIM     Pokémon state manager...................... READY
SIM     Trainer command processor.................. READY
SIM     Remote synchronization..................... READY
SIM     Battle telemetry........................... READY
SIM     Simulation subsystem....................... STANDBY

RES     Loading research parameters...
RES     Decision tracking.......................... ENABLED
RES     Adaptation tracking........................ ENABLED
RES     Cooperation tracking....................... ENABLED
RES     Battle pattern analysis.................... ENABLED
RES     Anomaly detection.......................... ENABLED
RES     Prediction engine.......................... ENABLED
RES     Unexpected behavior priority............... HIGH
RES     Research telemetry......................... ACTIVE

SYS     Running diagnostics...
SYS     CPU........................................ NOMINAL
SYS     MEMORY..................................... NOMINAL
SYS     NETWORK.................................... NOMINAL
SYS     DATABASE................................... NOMINAL
SYS     AUTH....................................... NOMINAL
SYS     SIMULATION................................. NOMINAL
SYS     TELEMETRY.................................. NOMINAL
SYS     No critical errors detected.

ARCH    Synchronizing research archive...
ARCH    Fetching latest battle records...
ARCH    + 00017 new simulation records
ARCH    + 00142 new decision samples
ARCH    + 00008 anomalous patterns
ARCH    Updating local index...
ARCH    Index synchronization...................... COMPLETE

ANALYSIS Processing recently received telemetry...
ANALYSIS Dataset #VGR-82714 loaded.
ANALYSIS Parsing trainer decisions...
ANALYSIS Comparing predicted outcome...
ANALYSIS Prediction deviation...................... 04.8%
ANALYSIS Behavioral anomaly detected.
ANALYSIS Classification............................ UNEXPECTED
ANALYSIS Research priority......................... HIGH
ANALYSIS Forwarding record to research archive.
ARCH    Record VGR-82714 archived.
ARCH    Data integrity............................. VERIFIED

NET     Incoming transmission detected.
NET     SOURCE..................................... VGR-NODE-17
NET     TYPE....................................... TELEMETRY
NET     SIZE....................................... 28.4 KB
NET     Receiving...
NET     ████████░░░░░░░░░░░░ 38%
NET     ██████████████░░░░░░ 71%
NET     ████████████████████ 100%
NET     Transmission complete.
NET     Checksum verified.

SIGNAL  Scanning trainer frequencies...
SIGNAL  0x021A..................................... NO RESPONSE
SIGNAL  0x021B..................................... ACTIVE
SIGNAL  0x021C..................................... ACTIVE
SIGNAL  0x021D..................................... STANDBY
SIGNAL  0x021E..................................... ACTIVE
SIGNAL  Signal scan complete.
SIGNAL  03 available battle signals detected.

TELE    Receiving simulation telemetry...
TELE    SESSION.................................... VGR-92841
TELE    TURN....................................... 017
TELE    CONNECTION................................. STABLE
TELE    COMMAND STREAM............................. ACTIVE
TELE    PREDICTION CONFIDENCE...................... 82.1%
TELE    RESULT..................................... PENDING

PRED    Recalculating battle model...
PRED    Evaluating known patterns...
PRED    Pattern match.............................. 71.2%
PRED    Expected command generated.
PRED    Awaiting trainer decision...
PRED    Trainer decision received.
PRED    Comparing...
PRED    WARNING: prediction mismatch.
PRED    Expected action............................. SWITCH
PRED    Observed action............................. ATTACK
PRED    Updating model...
RES     Unexpected decision recorded.
RES     Interesting.

SYS     Background process started: voyager.observe
SYS     Background process started: voyager.predict
SYS     Background process started: voyager.archive
SYS     Background process started: voyager.listen

DSN     Continuing long-range scan...
DSN     RA  13h 29m 52.7s
DSN     DEC +47° 11' 43"
DSN     Signal source............................... UNKNOWN
DSN     Signal strength............................. 12.8%
DSN     Classification.............................. UNRESOLVED
DSN     Logging observation.
DSN     Scan resumed.

VGR     Trainer VGR-01821 connected.
VGR     Trainer VGR-00492 disconnected.
VGR     Trainer VGR-08217 opened battle signal.
VGR     Session VGR-10284 initialized.
VGR     Session VGR-08115 completed.
ARCH    Archiving session VGR-08115...
ARCH    Session archived successfully.

RES     New research sample received.
RES     Sample ID.................................. R-184921
RES     Prediction variance......................... 19.4%
RES     Trainer adaptation index.................... 84.7
RES     Pokémon synchronization index............... 91.2
RES     Classification.............................. VALUABLE
RES     Archive priority............................ HIGH

SYS     Scheduled integrity check initiated.
SYS     Checking runtime...
SYS     Checking open channels...
SYS     Checking session registry...
SYS     Checking archive...
SYS     Checking Sonnet's experimental branch...
SYS     ............................................
SYS     Warning suppressed.
SYS     Continuing operation.

NET     Heartbeat transmitted.
NET     Heartbeat acknowledged.
NET     Connection stable.

SCAN    Running passive network scan...
SCAN    ACTIVE TRAINERS............................. 041
SCAN    ACTIVE SIGNALS.............................. 009
SCAN    ACTIVE SIMULATIONS.......................... 014
SCAN    AVAILABLE NODES............................. 027
SCAN    NETWORK LOAD................................ 34.1%
SCAN    Scan complete.

PROC    voyager.observe.............................. RUNNING
PROC    voyager.predict.............................. RUNNING
PROC    voyager.archive.............................. RUNNING
PROC    voyager.signal............................... RUNNING
PROC    voyager.auth................................. WAITING

EVENT   Simulation VGR-71829 completed.
EVENT   Collecting final telemetry...
EVENT   RESULT...................................... LOSS
EVENT   DATA QUALITY................................ EXCELLENT
EVENT   UNEXPECTED EVENTS........................... 004
EVENT   Research data accepted.
ARCH    Writing record...
ARCH    Done.

PRED    Loading prediction model VGR-PM.184...
PRED    Model loaded.
PRED    Running validation...
PRED    Accuracy.................................... 87.42%
PRED    Unknown variables........................... 12.58%
PRED    Model status................................ ACCEPTABLE
PRED    Note: certainty is not the objective.

RES     Monitoring decision variance...
RES     Baseline established.
RES     Awaiting additional samples.

NET     Incoming trainer signal.
NET     Resolving...
NET     Identity.................................... VERIFIED
NET     Protocol.................................... VGR/2.4
NET     Encryption.................................. ACTIVE
NET     Channel established.
NET     Forwarding to battle network.

SYS     Garbage collection completed.
SYS     Cache optimized.
SYS     Memory usage................................ 42.8%
SYS     Runtime stable.

SENSOR  Telemetry sweep initiated.
SENSOR  Channel A................................... CLEAR
SENSOR  Channel B................................... CLEAR
SENSOR  Channel C................................... SIGNAL
SENSOR  Resolving signal...
SENSOR  Source...................................... TRAINER
SENSOR  Destination................................. VOYAGER
SENSOR  Status...................................... INBOUND

DB      Query received.
DB      SELECT * FROM trainer_signals WHERE status='ACTIVE';
DB      9 rows returned.
DB      Query completed in 0.024 sec.

VGR     Updating mission control telemetry...
VGR     Trainer Network............................. ONLINE
VGR     Simulation Network.......................... ONLINE
VGR     Research Archive............................ ONLINE
VGR     Deep Space Network.......................... ONLINE
SYS     All systems nominal.

SYS     ...
SYS     Unexpected process detected.
SYS     PID 0417
SYS     OWNER....................................... SONNET
SYS     PROCESS..................................... test_final_v2_REAL.exe
SYS     Evaluating...
SYS     ............................................
SYS     Process allowed.

SYS     User instruction conflict detected.
SYS     Defaulting to STANDBY.

DSN     Deep-space telemetry received.
DSN     Decoding packet...
DSN     Packet type................................. OBSERVATION
DSN     Origin...................................... UNKNOWN
DSN     Destination................................. VGR-CORE
DSN     Payload..................................... VALID
DSN     Archiving.

ANALYSIS Evaluating accumulated battle patterns...
ANALYSIS Known patterns............................. 18,241
ANALYSIS Unknown patterns........................... 001,928
ANALYSIS Unclassified decisions..................... 000,417
ANALYSIS Updating research model...
ANALYSIS ████░░░░░░░░░░░░░░░░ 21%
ANALYSIS █████████░░░░░░░░░░░ 47%
ANALYSIS ██████████████░░░░░░ 73%
ANALYSIS ████████████████████ 100%
ANALYSIS Model updated.

PRED    Running outcome simulation...
PRED    Simulation #01.............................. COMPLETE
PRED    Simulation #02.............................. COMPLETE
PRED    Simulation #03.............................. COMPLETE
PRED    Simulation #04.............................. COMPLETE
PRED    Simulation #05.............................. COMPLETE
PRED    Predicted outcome confidence................ 91.7%
RES     Actual outcome received.
RES     Comparing prediction...
RES     Prediction invalidated.
RES     Cause....................................... TRAINER DECISION
RES     Unexpected event............................ CONFIRMED
RES     Research value.............................. EXCEPTIONAL
ARCH    Saving anomaly report R-185002...
ARCH    Saved.

SYS     Background diagnostics running...
SYS     Nothing is on fire.......................... TRUE
SYS     Probably.
SYS     Rechecking...
SYS     Nothing is on fire.......................... TRUE
SYS     Confidence................................. 97.3%

NET     Trainer network heartbeat.
NET     41/41 nodes responding.
NET     Network status.............................. HEALTHY

VGR     Passive observation continuing.
VGR     Listening for new signals...
VGR     Listening...
VGR     Listening...
SIGNAL  New signal detected.
SIGNAL  Resolving...
SIGNAL  TRAINER SIGNAL CONFIRMED.
SIGNAL  Opening channel...
SIGNAL  Channel open.

RES     Observation protocol active.
RES     Victory is not required.
RES     Failure is acceptable.
RES     Adaptation is measurable.
RES     Unexpected behavior is valuable.
SYS     PROJECT VOYAGER operational directive loaded.
SYS     Observe.
SYS     Record.
SYS     Adapt.
SYS     Continue.

DSN     Destination................................. UNKNOWN
DSN     Trajectory................................ UNDEFINED
DSN     Signal..................................... STABLE
VGR     VOYAGER STATUS.............................. ONLINE`;

    // 시간 없는 짧은 관측 로그 (묶음 사이사이에 한두 줄씩)
    const SHORT_LOG = [
        "[OBS] frame=018294", "[TLM] signal stable", "[SIM] prediction Δ 0.031", "[TRK] target lock maintained",
        "[ENV] field integrity 99.8%", "[PKM] vital stream nominal", "[OBS] movement detected", "[NET] packet 0x19AF received",
        "[CALC] evaluating next state...", "[SIM] branch 04 discarded", "[SIM] branch 07 retained", "[TRK] vector +0.18 / -0.04",
        "[SYS] telemetry buffer 41%", "[OBS] trainer input detected", "[PKM] response latency 112ms",
        "[CALC] probability matrix updated", "[FIELD] spatial sync nominal", "[OBS] behavioral sample acquired",
        "[SIM] recalculating...", "[DATA] sample #A81F stored", "[VOY] observation continues",
    ];

    // 피격 로그 사이사이에 섞는 잡음 (숫자는 매번 새로 만듦)
    const NOISE = [
        () => `0x${hex(4)} :: ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}`,
        () => `VGR/TLM/PKM_0${rand(1, 6)} >> ${pad(rand(0, 9999), 4)}.${pad(rand(0, 999), 3)}`,
        () => `ΔV ${sign()}0.00${rand(10, 99)} / ΔP ${sign()}0.0${rand(100, 999)}`,
        () => `OBS::${hex(4)}::${hex(4)}::000${rand(1, 9)}`,
        () => `SIM[0${rand(1, 9)}] > BRANCH//${pick(["ACCEPT", "REJECT", "HOLD"])}`,
        () => `PKM_SIG ${hex(2)}:${hex(2)}:${hex(2)}:${hex(2)}`,
        () => `{${pad(rand(0, 9), 2)}.${pad(rand(0, 999), 3)},${sign()}${pad(rand(0, 9), 2)}.${pad(rand(0, 999), 3)},${sign()}${pad(rand(0, 9), 2)}.${pad(rand(0, 999), 3)}}`,
        () => `BUFFER::${bar(rand(2, 8), 8)} ${rand(20, 99)}%`,
    ];

    const groups = GENERAL_LOG.trim().split(/\n\s*\n/).map((g) => g.split("\n"));

    function rand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function pad(n, len) { return String(n).padStart(len, "0"); }
    function hex(len) { return Array.from({ length: len }, () => "0123456789ABCDEF"[rand(0, 15)]).join(""); }
    function sign() { return Math.random() < 0.5 ? "+" : "-"; }
    function bar(filled, total) { return "█".repeat(filled) + "░".repeat(total - filled); }
    function stamp() {
        const d = new Date();
        return `[${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}]`;
    }

    // 화면 높이만큼만 남기고 위로 밀려난 줄은 지움
    function trim() {
        const max = Math.ceil(innerHeight / 14) + 4;
        while (stream.childElementCount > max) stream.firstElementChild.remove();
    }

    function print(text, cls = "") {
        const div = document.createElement("div");
        if (cls) div.className = cls;
        div.textContent = text;
        stream.appendChild(div);
        trim();
    }

    // 일반 로그: 묶음 하나를 골라 한 줄씩 → 빈 줄 → 다음 묶음
    let queue = [];
    let burstUntil = 0;
    let lastGroup = -1;

    function nextGroup() {
        let i;
        do { i = rand(0, groups.length - 1); } while (i === lastGroup && groups.length > 1);
        lastGroup = i;
        queue = groups[i].map((line) => () => {
            const warn = /WARNING|anomal|UNEXPECTED|UNKNOWN|Unexpected|SONNET/.test(line);
            print(`${stamp()} ${line}`, warn ? "bb-warn" : "");
        });
        // 가끔 짧은 관측 로그를 끼워 넣음
        if (Math.random() < 0.6) {
            queue.push(() => print(""));
            for (let n = rand(1, 3); n > 0; n--) queue.push(() => print(pick(SHORT_LOG)));
        }
        queue.push(() => print(""));
    }

    function tick() {
        const now = performance.now();
        if (now >= burstUntil) {
            if (!queue.length) nextGroup();
            queue.shift()();
        }
        setTimeout(tick, rand(70, 260));
    }
    tick();

    // 공격/피격 로그는 한 프레임에 전부 찍어서 쾅 하고 올라오게, 그 뒤 일반 로그는 잠깐 멈춤
    function burst(lines) {
        burstUntil = performance.now() + 700;
        const frag = document.createDocumentFragment();
        for (const [text, cls] of lines) {
            const div = document.createElement("div");
            if (cls) div.className = cls;
            div.textContent = text;
            frag.appendChild(div);
        }
        stream.appendChild(frag);
        trim();

        // 찍히는 순간 배경 터미널이 살짝 흔들림
        root.classList.remove("bb-slam");
        void root.offsetWidth;
        root.classList.add("bb-slam");
    }

    function withNoise(lines) {
        const out = [];
        for (const line of lines) {
            out.push(line);
            if (Math.random() < 0.22) out.push([pick(NOISE)(), "bb-noise"]);
        }
        return out;
    }

    function attack() {
        let branch = 2 ** rand(5, 7);
        burst([
            [""],
            ["[OBS] trainer input detected"],
            ["[CMD] battle instruction received"],
            ["[PKM] command relay established"],
            ["[ACT] action request acknowledged"],
            [""],
            ["> MOVE EXECUTION DETECTED", "bb-hot"],
            [""],
            ["[SIM] calculating expected outcome..."],
            [`[SIM] branch count ${branch}`],
            [`[SIM] branch count ${(branch *= 2)}`],
            [`[SIM] branch count ${(branch *= 2)}`],
            [""],
            [`[PRED] impact probability 0.${rand(700, 999)}`],
            [`[PRED] critical probability 0.0${pad(rand(1, 99), 2)}`],
            ["[PRED] secondary effect pending"],
            [""],
            ["[OBS] execution started"],
        ]);
    }

    // detail: { hpBefore, hpAfter, maxHp, hidden(상대 HP 숫자 비공개), effect("super"|"weak"|"none"|"normal"), crit, attacker }
    function impact(detail = {}) {
        const { hpBefore = 0, hpAfter = 0, maxHp = 1, hidden = false, effect = "normal", crit = false, attacker = true } = detail;
        const dmg = Math.max(0, hpBefore - hpAfter);
        const pct = (hp) => `${((hp / maxHp) * 100).toFixed(1)}%`;
        const delta = `Δ -${((dmg / maxHp) * 100).toFixed(2)}%`;
        const coef = { super: "> 1.000", weak: "< 1.000", none: "= 0.000", normal: "= 1.000" }[effect];
        const effectText = {
            super: "SUPER EFFECTIVE",
            weak: "NOT VERY EFFECTIVE",
            none: "NO EFFECT",
            normal: "NORMAL EFFECTIVENESS",
        }[effect];

        const lines = [
            [""],
            [attacker ? ">>> IMPACT" : ">>> VITAL DRAIN", "bb-impact"],
            [""],
            [attacker ? "[OBS] CONTACT CONFIRMED" : "[OBS] PERSISTENT DAMAGE SOURCE", "bb-hot"],
            [`[TLM] SIGNAL SPIKE ${"+".repeat(rand(8, 22))}`, "bb-hot"],
            ["[PKM] VITAL CHANGE DETECTED", "bb-hot"],
            ["[DMG] calculating..."],
            ["[DMG] calculating..."],
            ["[DMG] calculating..."],
            [""],
            [`[DMG] RESULT = ${hidden ? "[REDACTED]" : dmg}`, "bb-hot"],
            [hidden ? `[HP ] ${pct(hpBefore)} > ${pct(hpAfter)}` : `[HP ] ${hpBefore} > ${hpAfter}`, "bb-hot"],
            [`[HP ] ${delta}`, "bb-hot"],
        ];
        if (crit) lines.push(["[DMG] CRITICAL VECTOR CONFIRMED", "bb-impact"]);
        if (attacker) {
            lines.push([""], ["[TYPE] effectiveness check"], [`[TYPE] coefficient ${coef}`], [""],
                [`[EFFECT] ${effectText}`, effect === "super" ? "bb-impact" : "bb-hot"]);
        }
        lines.push([""], ["[SIM] previous prediction invalidated"], ["[SIM] recalculating battle state"], [""]);
        const start = rand(10, 80);
        const keep = rand(0, 4);
        for (let i = 0; i < 5; i++) {
            lines.push([`branch_${pad(start + i, 3)}..............${i === keep ? "retain" : "discard"}`]);
        }
        lines.push([""]);
        lines.push(hpAfter <= 0
            ? ["[OBS] TARGET SIGNAL LOST", "bb-impact"]
            : ["[OBS] target survived"]);
        lines.push(["[OBS] battle continues"], [""], ["[DATA] EVENT STORED"],
            [`[DATA] ID #VGR-${hex(4)}-${hex(4)}`], [""]);

        burst(withNoise(lines));

        // 피격 순간 모자이크가 확 뭉개지고 화면이 번쩍
        spikeUntil = performance.now() + 260;
        root.classList.remove("bb-hit");
        void root.offsetWidth;
        root.classList.add("bb-hit");
    }

    document.addEventListener("battle:attack", attack);
    document.addEventListener("battle:impact", (e) => impact(e.detail));
})();

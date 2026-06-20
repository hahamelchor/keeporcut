import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Utilities ─────────────────────────────────────────────────────────────────

// Seeded random — same seed always gives same shuffle
function seededRandom(seed) {
  let s = Math.abs(seed) >>> 0;
  return function() {
    s = ((s * 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  const rand = seededRandom(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// URL-safe base64 for p1 results only
function toUrlSafeB64(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromUrlSafeB64(str) {
  const padded = str + "=".repeat((4 - str.length % 4) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

// Game encoded as: SEED~POOLID~TOTAL~KEEP~INFO — tilde is URL-safe and never appears in pool IDs
function encodeGame(seed, config) {
  return [seed, config.poolId, config.totalPlayers, config.keepCount, config.allowInfo ? 1 : 0].join("~");
}
function decodeGame(str) {
  try {
    const parts = str.split("~");
    if (parts.length < 5) return null;
    const [seed, poolId, totalPlayers, keepCount, allowInfo] = parts;
    return { seed: parseInt(seed), config: { poolId, totalPlayers: parseInt(totalPlayers), keepCount: parseInt(keepCount), allowInfo: allowInfo === "1", mode: "challenge" } };
  } catch { return null; }
}

// P1 result encoded as indices into the pool array
function encodeResult(kept, cut, allPlayers) {
  const keptIdx = kept.map(p => allPlayers.findIndex(a => a.name === p.name));
  const cutIdx = cut.map(p => allPlayers.findIndex(a => a.name === p.name));
  return toUrlSafeB64(JSON.stringify({ k: keptIdx, c: cutIdx }));
}
function decodeResult(str, allPlayers) {
  try {
    const { k, c } = JSON.parse(fromUrlSafeB64(str));
    return { kept: k.map(i => allPlayers[i]), cut: c.map(i => allPlayers[i]) };
  } catch { return null; }
}

// Roster Royale: encode/decode a full 10-slot roster for challenge links
function encodeRoster(roster) {
  const compact = {};
  RR_ROSTER_SLOTS.forEach((slot) => {
    const pick = roster[slot];
    compact[slot] = pick ? [pick.value, pick.teamName] : null;
  });
  return toUrlSafeB64(JSON.stringify(compact));
}
function decodeRoster(str) {
  try {
    const compact = JSON.parse(fromUrlSafeB64(str));
    const roster = {};
    RR_ROSTER_SLOTS.forEach((slot) => {
      const entry = compact[slot];
      roster[slot] = entry ? { value: entry[0], teamName: entry[1] } : null;
    });
    return roster;
  } catch { return null; }
}

// Roster Royale: encode/decode the game setup (seed) for challenge links
function encodeRosterRoyaleGame(seed) {
  return `${seed}`;
}
function decodeRosterRoyaleGame(str) {
  const seed = parseInt(str);
  return isNaN(seed) ? null : seed;
}

// Short clean URL: /c/SEED-POOL-N-K-INFO.P1RESULT
function buildChallengeURL(gameCode, p1Code) {
  return `${window.location.origin}/c/${gameCode}.${p1Code}`;
}
function getURLParams() {
  if (typeof window === "undefined") return {};
  const path = window.location.pathname;
  if (path.startsWith("/c/")) {
    const token = path.slice(3);
    const dot = token.indexOf(".");
    if (dot > 0) return { mode: "keep-or-cut", game: token.slice(0, dot), p1result: token.slice(dot + 1) };
  }
  if (path.startsWith("/rr/")) {
    const token = path.slice(4);
    const dot = token.indexOf(".");
    if (dot > 0) return { mode: "roster-royale", rrSeed: token.slice(0, dot), rrP1Roster: token.slice(dot + 1) };
  }
  return {};
}

// ── NFL Player Database — loaded from Google Sheet ───────────────────────────
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbzNQBvJxbUN2NMjC2VvJzCFSE4tevFxrImtWdzf7Pq8XTDEByp-nxOvDnUOgVatO2qS/exec";
const DRAFT_MODE_API_URL = `${SHEET_API_URL}?sheet=${encodeURIComponent("Draft Mode - Teams")}`;

// Convert flat sheet rows into pool-keyed object
function buildPlayerPools(rows) {
  const pools = {};
  pools["all_players"] = [];
  const allPlayersSeen = new Set();

  rows.forEach(row => {
    if (!row.name || !row.pool) return;
    const player = {
      name: String(row.name),
      pos: String(row.pos || ""),
      era: String(row.era || "active"),
      teams: String(row.teams || "").split(",").map(t => t.trim()).filter(Boolean),
      hof: String(row.hof).toUpperCase() === "TRUE",
      fanFave: String(row.fanFave).toUpperCase() === "TRUE",
    };
    if (row.age && String(row.age).trim() !== "") player.age = parseInt(row.age);
    if (row.peak && String(row.peak).trim() !== "") player.peak = String(row.peak);
if (row.stats && String(row.stats).trim() !== "") player.stats = String(row.stats);

    // Add to specific pools from pool column
    const poolIds = String(row.pool).split(",").map(p => p.trim()).filter(Boolean);

    // Add to all_players automatically unless it's a season entry
    const isSeasonEntry = poolIds.some(pid => pid.startsWith("iconic_"));
    if (!allPlayersSeen.has(player.name) && !isSeasonEntry) {
      allPlayersSeen.add(player.name);
      pools["all_players"].push(player);
    }

    poolIds.forEach(pid => {
      if (pid === "all_players") return;
      if (!pools[pid]) pools[pid] = [];
      if (!pools[pid].find(p => p.name === player.name)) {
        pools[pid].push(player);
      }
    });
  });
  return pools;
}

// Fallback minimal pool in case sheet fails
const NFL_PLAYERS_FALLBACK = {
  all_players: [
    { name: "Tom Brady", pos: "QB", era: "retired", teams: ["NE", "TB"], hof: true, peak: "2001–2022" },
    { name: "Jerry Rice", pos: "WR", era: "retired", teams: ["SF"], hof: true, peak: "1986–2002" },
    { name: "Barry Sanders", pos: "RB", era: "retired", teams: ["DET"], hof: true, peak: "1989–1998" },
    { name: "Lawrence Taylor", pos: "LB", era: "retired", teams: ["NYG"], hof: true, peak: "1981–1993" },
    { name: "Patrick Mahomes", pos: "QB", era: "active", teams: ["KC"], age: 29, hof: false },
    { name: "Lamar Jackson", pos: "QB", era: "active", teams: ["BAL"], age: 27, hof: false },
    { name: "Walter Payton", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1975–1987" },
    { name: "Peyton Manning", pos: "QB", era: "retired", teams: ["IND", "DEN"], hof: true, peak: "1998–2015" },
    { name: "Randy Moss", pos: "WR", era: "retired", teams: ["MIN", "NE"], hof: true, peak: "1998–2012" },
    { name: "Reggie White", pos: "DE", era: "retired", teams: ["PHI", "GB"], hof: true, peak: "1985–2000" },
    { name: "Emmitt Smith", pos: "RB", era: "retired", teams: ["DAL"], hof: true, peak: "1990–2004" },
    { name: "Joe Montana", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1979–1994" },
  ],
};

// ── Pool Options ──────────────────────────────────────────────────────────────
const POOL_GROUPS = [
  {
    label: "🌐 General",
    options: [
      { id: "all_players", label: "All Players", desc: "Everybody in the club" },
      { id: "hof_only", label: "Hall of Famers", desc: "Only the immortals" },
      { id: "modern_nfl", label: "Modern NFL", desc: "Players who played into the 2000's - Now" },
      { id: "next_gen", label: "Next Gen", desc: "They got next." },
    ]
  },
    {
    label: "😤 Instant Arguments",
    options: [
      { id: "pretty_okay", label: "Remember that WR?", desc: "For guyknowballogists" },
      { id: "fan_favorites", label: "Fan Favorites", desc: "Beloved & controversial players" },
      { id: "iconic_wr", label: "Iconic WR Seasons", desc: "'87 Rice vs '21 Kupp vs '07 Moss" },
    ]
  },
  {
    label: "📍 Position",
    options: [
      { id: "qbs_only", label: "QBs Only", desc: "Quarterbacks across history" },
      { id: "rbs_only", label: "RBs Only", desc: "Running backs across history" },
      { id: "wrs_only", label: "WRs Only", desc: "Wide receivers across history" },
      { id: "offense_only", label: "All Offense", desc: "All offensive skill positions" },
      { id: "defense_only", label: "All Defense", desc: "All defensive positions" },
    ]
  },
  {
label: "🏟️ By Franchise",
    options: [
      { id: "franchise_cardinals", label: "Arizona Cardinals", desc: "Warner, Fitz & more" },
      { id: "franchise_falcons", label: "Atlanta Falcons", desc: "Vick, Ryan & more" },
      { id: "franchise_ravens", label: "Baltimore Ravens", desc: "Ray Lewis & beyond" },
      { id: "franchise_bills", label: "Buffalo Bills", desc: "Kelly era to present" },
      { id: "franchise_panthers", label: "Carolina Panthers", desc: "Cam, Kuechly & more" },
      { id: "franchise_bears", label: "Chicago Bears", desc: "Monsters of the Midway" },
      { id: "franchise_bengals", label: "Cincinnati Bengals", desc: "Joe, Jamarr & more" },
      { id: "franchise_browns", label: "Cleveland Browns", desc: "Dawg Pound legends" },
      { id: "franchise_cowboys", label: "Dallas Cowboys", desc: "'wE dEM bOyS' 'It'S oUr yEAr'" },
      { id: "franchise_broncos", label: "Denver Broncos", desc: "Elway, Manning & more" },
      { id: "franchise_lions", label: "Detroit Lions", desc: "Calvin, Barry & more" },
      { id: "franchise_packers", label: "Green Bay Packers", desc: "Titletown legends" },
      { id: "franchise_texans", label: "Houston Texans", desc: "JJ Watt era & more" },
      { id: "franchise_colts", label: "Indianapolis Colts", desc: "Manning era & beyond" },
      { id: "franchise_jaguars", label: "Jacksonville Jaguars", desc: "Brunell era & beyond" },
      { id: "franchise_chiefs", label: "Kansas City Chiefs", desc: "From Len Dawson to Mahomes" },
      { id: "franchise_raiders", label: "Las Vegas Raiders", desc: "Silver and Black legends" },
      { id: "franchise_chargers", label: "Los Angeles Chargers", desc: "LT, Rivers & more" },
      { id: "franchise_rams", label: "Los Angeles Rams", desc: "Greatest Show on Turf & beyond" },
      { id: "franchise_dolphins", label: "Miami Dolphins", desc: "Marino & Company" },
      { id: "franchise_vikings", label: "Minnesota Vikings", desc: "Purple People Eaters to present" },
      { id: "franchise_patriots", label: "New England Patriots", desc: "Dynasty era & legends" },
      { id: "franchise_saints", label: "New Orleans Saints", desc: "Brees era & beyond" },
      { id: "franchise_giants", label: "New York Giants", desc: "LT, Eli & franchise greats" },
      { id: "franchise_jets", label: "New York Jets", desc: "Broadway Joe to Revis" },
      { id: "franchise_eagles", label: "Philadelphia Eagles", desc: "GOATS from top to bottom" },
      { id: "franchise_steelers", label: "Pittsburgh Steelers", desc: "Steel Curtain era & more" },
      { id: "franchise_49ers", label: "San Francisco 49ers", desc: "The dynasty & beyond" },
      { id: "franchise_seahawks", label: "Seattle Seahawks", desc: "LOB era & franchise icons" },
      { id: "franchise_buccaneers", label: "Tampa Bay Buccaneers", desc: "Super Bowl eras" },
      { id: "franchise_titans", label: "Tennessee Titans", desc: "McNair, George & beyond" },
      { id: "franchise_washington", label: "Washington Commanders", desc: "Portis, Taylor & more" },
    ]
  }
];

const ALL_POOL_OPTIONS = POOL_GROUPS.flatMap(g => g.options);

const POS_COLORS = {
  QB: "#e53e3e", RB: "#38a169", WR: "#3182ce", TE: "#805ad5",
  DE: "#d69e2e", LB: "#dd6b20", CB: "#319795", S: "#e91e8c",
  OT: "#718096", OG: "#718096", DT: "#4a5568", C: "#718096",
  K: "#a0aec0", KR: "#ed64a6",
};

// ── AI Info Modal ─────────────────────────────────────────────────────────────
function PlayerInfoModal({ player, onClose }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchInfo() {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            system: `You are an NFL historian. Respond ONLY with a JSON object (no markdown, no backticks) with exactly these fields:
{
  "bio": "2-3 sentence career overview",
  "keyStats": ["stat 1", "stat 2", "stat 3", "stat 4"],
  "superBowls": number,
  "proBowls": number,
  "legacy": "1 sentence debate-worthy take on this player"
}`,
            messages: [{ role: "user", content: `NFL player: ${player.name}, pos: ${player.pos}, teams: ${player.teams.join(", ")}, era: ${player.era}${player.peak ? `, peak: ${player.peak}` : ""}${player.age ? `, age: ${player.age}` : ""}${player.fanFave ? ". Note they are a fan favorite." : ""}` }]
          })
        });
        const data = await res.json();
        const text = data.content.map(b => b.text || "").join("");
        setInfo(JSON.parse(text.replace(/```json|```/g, "").trim()));
      } catch {
        setInfo({ bio: `${player.name} is a notable NFL ${player.pos}.`, keyStats: ["Stats unavailable", "Check NFL.com for details"], superBowls: 0, proBowls: 0, legacy: "A player sure to spark debate." });
      }
      setLoading(false);
    }
    fetchInfo();
  }, [player]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: "14px", maxWidth: "380px", width: "100%", padding: "24px", position: "relative" }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: "12px", right: "12px", background: "none", border: "none", color: "#888", fontSize: "20px", cursor: "pointer" }}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div style={{ background: POS_COLORS[player.pos] || "#555", color: "#fff", fontWeight: 900, fontSize: "12px", padding: "4px 8px", borderRadius: "4px", letterSpacing: "1px" }}>{player.pos}</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: "18px" }}>{player.name}</div>
            <div style={{ color: "#888", fontSize: "12px" }}>{player.teams.join(" · ")}{player.fanFave ? " · ⭐ Fan Favorite" : ""}</div>
          </div>
        </div>
        {loading ? (
          <div style={{ color: "#888", textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>⏳</div>Loading player info...
          </div>
        ) : info ? (
          <>
            <p style={{ color: "#ccc", fontSize: "13px", lineHeight: 1.6, marginBottom: "16px" }}>{info.bio}</p>
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              {info.superBowls > 0 && (
                <div style={{ background: "#2a2a4a", borderRadius: "8px", padding: "10px 14px", flex: 1, textAlign: "center" }}>
                  <div style={{ color: "#ffd700", fontSize: "22px", fontWeight: 900 }}>{info.superBowls}</div>
                  <div style={{ color: "#888", fontSize: "11px" }}>Super Bowl{info.superBowls !== 1 ? "s" : ""}</div>
                </div>
              )}
              {info.proBowls > 0 && (
                <div style={{ background: "#2a2a4a", borderRadius: "8px", padding: "10px 14px", flex: 1, textAlign: "center" }}>
                  <div style={{ color: "#60a5fa", fontSize: "22px", fontWeight: 900 }}>{info.proBowls}</div>
                  <div style={{ color: "#888", fontSize: "11px" }}>Pro Bowls</div>
                </div>
              )}
            </div>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ color: "#888", fontSize: "11px", letterSpacing: "1px", marginBottom: "8px", textTransform: "uppercase" }}>Key Stats</div>
              {info.keyStats.map((s, i) => <div key={i} style={{ color: "#ddd", fontSize: "12px", padding: "4px 0", borderBottom: "1px solid #2a2a2a" }}>• {s}</div>)}
            </div>
            <div style={{ background: "linear-gradient(135deg, #1e3a5f, #2a1a4a)", borderRadius: "8px", padding: "12px", color: "#a0c4ff", fontSize: "12px", lineHeight: 1.5, fontStyle: "italic" }}>
              💬 {info.legacy}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Player Card ───────────────────────────────────────────────────────────────
function PlayerCard({ player, onKeep, onCut, showInfo, decision = null, compact = false }) {
  const [showModal, setShowModal] = useState(false);
  const posColor = POS_COLORS[player.pos] || "#555";

  if (compact) {
    return (
      <div style={{ background: decision === "keep" ? "rgba(56,161,105,0.15)" : decision === "cut" ? "rgba(229,62,62,0.15)" : "#1a1a2e", border: `1px solid ${decision === "keep" ? "#38a169" : decision === "cut" ? "#e53e3e" : "#2d2d4a"}`, borderRadius: "8px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ background: posColor, color: "#fff", fontWeight: 900, fontSize: "10px", padding: "2px 6px", borderRadius: "3px" }}>{player.pos}</div>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: "14px", flex: 1 }}>{player.name}</div>
        {player.fanFave && <span style={{ fontSize: "12px" }}>⭐</span>}
        {decision && <div style={{ fontSize: "18px" }}>{decision === "keep" ? "✅" : "❌"}</div>}
      </div>
    );
  }

  return (
    <>
      {showModal && <PlayerInfoModal player={player} onClose={() => setShowModal(false)} />}
      <div style={{ background: "linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)", border: "1px solid #2d2d4a", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "22px", lineHeight: 1.2 }}>{player.name}</div>
            <div style={{ color: "#888", fontSize: "12px", marginTop: "2px" }}>{player.teams.join(" · ")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px" }}>
            <div style={{ background: posColor, color: "#fff", fontWeight: 900, fontSize: "11px", padding: "4px 8px", borderRadius: "4px", letterSpacing: "1px" }}>{player.pos}</div>
            {player.hof && <div style={{ background: "#ffd700", color: "#000", fontWeight: 800, fontSize: "9px", padding: "2px 6px", borderRadius: "3px", letterSpacing: "1px" }}>HOF</div>}
            {player.fanFave && <div style={{ background: "#2d2d4a", color: "#f6c90e", fontWeight: 800, fontSize: "9px", padding: "2px 6px", borderRadius: "3px" }}>⭐ FAN FAV</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {player.stats
              ? <span style={{ background: "#2a2a4a", color: "#a0c4ff", fontSize: "11px", padding: "3px 8px", borderRadius: "4px" }}>{player.stats}</span>
              : <>
                  {player.peak && <span style={{ background: "#2a2a4a", color: "#a0c4ff", fontSize: "11px", padding: "3px 8px", borderRadius: "4px" }}>Peak: {player.peak}</span>}
                  {player.age && <span style={{ background: "#2a2a4a", color: "#a0c4ff", fontSize: "11px", padding: "3px 8px", borderRadius: "4px" }}>Age: {player.age}</span>}
                </>
          }
          <span style={{ background: "#2a2a4a", color: player.era === "active" ? "#68d391" : "#fc8181", fontSize: "11px", padding: "3px 8px", borderRadius: "4px" }}>
            {player.era === "active" ? "Active" : "Retired"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {onKeep && <button onClick={onKeep} style={{ flex: 1, background: "linear-gradient(135deg, #276749, #38a169)", color: "#fff", border: "none", borderRadius: "8px", padding: "13px", fontWeight: 800, fontSize: "15px", cursor: "pointer" }}>✅ KEEP</button>}
          {onCut && <button onClick={onCut} style={{ flex: 1, background: "linear-gradient(135deg, #9b2335, #e53e3e)", color: "#fff", border: "none", borderRadius: "8px", padding: "13px", fontWeight: 800, fontSize: "15px", cursor: "pointer" }}>❌ CUT</button>}
          {showInfo && <button onClick={() => setShowModal(true)} style={{ background: "#2d2d4a", color: "#a0c4ff", border: "1px solid #3d3d6a", borderRadius: "8px", padding: "13px", cursor: "pointer", fontSize: "16px" }} title="Player info">ℹ️</button>}
        </div>
      </div>
    </>
  );
}

// ── Mode Menu Screen ──────────────────────────────────────────────────────────
function ModeMenuScreen({ onSelectMode }) {
  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "13px", letterSpacing: "3px", color: "#e53e3e", fontWeight: 800, textTransform: "uppercase", marginBottom: "8px" }}>NFL</div>
        <h1 style={{ fontSize: "42px", fontWeight: 900, color: "#fff", margin: 0, lineHeight: 1, letterSpacing: "-1px" }}>GAME<br /><span style={{ color: "#e53e3e" }}>MODES</span></h1>
        <p style={{ color: "#888", marginTop: "12px", fontSize: "14px" }}>Pick your game.</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <button onClick={() => onSelectMode("keep-or-cut")} style={{ background: "linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)", border: "2px solid #2d2d4a", borderRadius: "14px", padding: "20px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontSize: "36px" }}>✂️</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "20px" }}>Keep or Cut</div>
            <div style={{ color: "#888", fontSize: "13px", marginTop: "2px" }}>Draft your squad. Spark the debate.</div>
          </div>
        </button>

        <button onClick={() => onSelectMode("roster-royale")} style={{ background: "linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)", border: "2px solid #2d2d4a", borderRadius: "14px", padding: "20px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "16px", position: "relative" }}>
          <div style={{ fontSize: "36px" }}>🏆</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "20px" }}>Roster Royale</div>
            <div style={{ color: "#888", fontSize: "13px", marginTop: "2px" }}>Build a roster from current NFL rosters.</div>
          </div>
        </button>

        <div style={{ background: "transparent", border: "2px dashed #2d2d4a", borderRadius: "14px", padding: "20px", textAlign: "center", color: "#555", fontSize: "13px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>
          🔜 More Game Modes Coming Soon
        </div>
      </div>
    </div>
  );
}

// ── Coming Soon Screen ────────────────────────────────────────────────────────
function ComingSoonScreen({ onBack }) {
  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px", textAlign: "center" }}>
      <div style={{ padding: "60px 20px" }}>
        <div style={{ fontSize: "56px", marginBottom: "16px" }}>🏆</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "28px", marginBottom: "12px" }}>Roster Royale</h2>
        <p style={{ color: "#888", fontSize: "14px", marginBottom: "28px", lineHeight: 1.6 }}>
          Coming soon — draft a 10-man roster from current NFL talent and challenge a friend to build a better team.
        </p>
        <button onClick={onBack} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px 24px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>← Back to Game Modes</button>
      </div>
    </div>
  );
}

// ── Setup Screen ──────────────────────────────────────────────────────────────
function SetupScreen({ onStart, onBack }) {
  const [mode, setMode] = useState("challenge");
  const [poolId, setPoolId] = useState("all_players");
  const [totalPlayers, setTotalPlayers] = useState(8);
  const [keepCount, setKeepCount] = useState(3);
  const [allowInfo, setAllowInfo] = useState(true);
  const [poolOpen, setPoolOpen] = useState(false);

  const selectedPool = ALL_POOL_OPTIONS.find(o => o.id === poolId);
  const maxKeep = totalPlayers - 1;

  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", fontSize: "13px", cursor: "pointer", marginBottom: "16px", padding: 0 }}>← All Games</button>
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "13px", letterSpacing: "3px", color: "#e53e3e", fontWeight: 800, textTransform: "uppercase", marginBottom: "8px" }}>NFL</div>
        <h1 style={{ fontSize: "42px", fontWeight: 900, color: "#fff", margin: 0, lineHeight: 1, letterSpacing: "-1px" }}>KEEP<br /><span style={{ color: "#e53e3e" }}>OR CUT</span></h1>
        <p style={{ color: "#888", marginTop: "12px", fontSize: "14px" }}>Draft your squad. Spark the debate.</p>
      </div>

      {/* Mode */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ color: "#888", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "10px" }}>Mode</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {[
            { id: "solo", label: "🎯 Solo", desc: "Just you" },
            { id: "challenge", label: "📲 Challenge", desc: "Text a friend" }
          ].map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} style={{ background: mode === m.id ? "linear-gradient(135deg, #1e3a5f, #2a4a8f)" : "#1a1a2e", border: `2px solid ${mode === m.id ? "#4a90d9" : "#2d2d4a"}`, borderRadius: "10px", padding: "16px", cursor: "pointer", textAlign: "left" }}>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: "15px" }}>{m.label}</div>
              <div style={{ color: "#888", fontSize: "12px", marginTop: "2px" }}>{m.desc}</div>
            </button>
          ))}
        </div>
        {mode === "challenge" && (
          <div style={{ background: "rgba(74,144,217,0.1)", border: "1px solid rgba(74,144,217,0.3)", borderRadius: "8px", padding: "10px 14px", marginTop: "10px", color: "#a0c4ff", fontSize: "12px", lineHeight: 1.6 }}>
            You draft first, then get a link to text your opponent. They draft the same pool — results are revealed when they finish.
          </div>
        )}
      </div>

      {/* Pool Picker */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ color: "#888", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "10px" }}>Player Pool</label>
        <button onClick={() => setPoolOpen(!poolOpen)} style={{ width: "100%", background: "#1a1a2e", border: "2px solid #4a90d9", borderRadius: "10px", padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "15px" }}>{selectedPool?.label}</div>
            <div style={{ color: "#888", fontSize: "12px" }}>{selectedPool?.desc}</div>
          </div>
          <div style={{ color: "#888", fontSize: "18px" }}>{poolOpen ? "▲" : "▼"}</div>
        </button>
        {poolOpen && (
          <div style={{ background: "#111", border: "1px solid #2d2d4a", borderRadius: "10px", marginTop: "4px", overflow: "hidden", maxHeight: "320px", overflowY: "auto" }}>
            {POOL_GROUPS.map(group => (
              <div key={group.label}>
                <div style={{ padding: "8px 14px", color: "#555", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e", background: "#0d0d1a" }}>{group.label}</div>
                {group.options.map(p => (
                  <button key={p.id} onClick={() => { setPoolId(p.id); setPoolOpen(false); }} style={{ width: "100%", background: poolId === p.id ? "rgba(74,144,217,0.15)" : "transparent", border: "none", borderBottom: "1px solid #1a1a2e", padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}>
                    <span style={{ color: poolId === p.id ? "#60a5fa" : "#ddd", fontWeight: poolId === p.id ? 700 : 400, fontSize: "14px" }}>{p.label}</span>
                    <span style={{ color: "#555", fontSize: "11px" }}>{p.desc}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Players count */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ color: "#888", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "10px" }}>
          Players in Pool: <span style={{ color: "#fff" }}>{totalPlayers}</span>
        </label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[6, 7, 8, 9, 10, 11, 12].map(n => (
            <button key={n} onClick={() => { setTotalPlayers(n); if (keepCount >= n) setKeepCount(n - 1); }} style={{ background: totalPlayers === n ? "#e53e3e" : "#1a1a2e", border: `2px solid ${totalPlayers === n ? "#e53e3e" : "#2d2d4a"}`, color: "#fff", fontWeight: 800, borderRadius: "8px", padding: "8px 14px", cursor: "pointer" }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Keep count */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ color: "#888", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "10px" }}>
          How many to KEEP: <span style={{ color: "#38a169" }}>{keepCount}</span>
          <span style={{ color: "#888", marginLeft: "8px" }}>({totalPlayers - keepCount} cut)</span>
        </label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {Array.from({ length: maxKeep }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => setKeepCount(n)} style={{ background: keepCount === n ? "#38a169" : "#1a1a2e", border: `2px solid ${keepCount === n ? "#38a169" : "#2d2d4a"}`, color: "#fff", fontWeight: 800, borderRadius: "8px", padding: "8px 14px", cursor: "pointer" }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Info toggle */}
      <div style={{ marginBottom: "28px" }}>
        <button onClick={() => setAllowInfo(!allowInfo)} style={{ background: "#1a1a2e", border: `2px solid ${allowInfo ? "#4a90d9" : "#2d2d4a"}`, borderRadius: "8px", padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
          <div style={{ width: "20px", height: "20px", borderRadius: "4px", background: allowInfo ? "#4a90d9" : "transparent", border: "2px solid #4a90d9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {allowInfo && <span style={{ color: "#fff", fontSize: "12px" }}>✓</span>}
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "14px" }}>Enable Player Info Cards</div>
            <div style={{ color: "#888", fontSize: "12px" }}>AI-powered stats & bio for each player</div>
          </div>
        </button>
      </div>

      <button
        onClick={() => mode && onStart({ mode, poolId, totalPlayers, keepCount, allowInfo })}
        disabled={!mode}
        style={{ width: "100%", background: mode ? "linear-gradient(135deg, #c53030, #e53e3e)" : "#333", color: mode ? "#fff" : "#666", border: "none", borderRadius: "10px", padding: "18px", fontWeight: 900, fontSize: "18px", letterSpacing: "1px", cursor: mode ? "pointer" : "not-allowed", textTransform: "uppercase" }}
      >
        {mode === "challenge" ? "📲 Draft & Challenge a Friend" : mode === "solo" ? "🎯 Start Solo" : "Select a Mode"}
      </button>
    </div>
  );
}

// ── Game Screen ───────────────────────────────────────────────────────────────
function GameScreen({ config, playerNum = 1, players, onComplete }) {
  const [index, setIndex] = useState(0);
  const [kept, setKept] = useState([]);
  const [cut, setCut] = useState([]);

  const remaining = config.keepCount - kept.length;
  const cutRemaining = (config.totalPlayers - config.keepCount) - cut.length;
  const current = players[index];

  const handleDecision = useCallback((decision) => {
    const newKept = decision === "keep" ? [...kept, current] : kept;
    const newCut = decision === "cut" ? [...cut, current] : cut;
    const nextIndex = index + 1;
    setKept(newKept);
    setCut(newCut);
    setIndex(nextIndex);

    if (nextIndex >= players.length) {
      onComplete({ kept: newKept, cut: newCut });
      return;
    }
    // Auto-resolve if one bucket is full
    const keepNeeded = config.keepCount - newKept.length;
    const cutNeeded = (config.totalPlayers - config.keepCount) - newCut.length;
    const rest = players.slice(nextIndex);
    if (keepNeeded === 0) { onComplete({ kept: newKept, cut: [...newCut, ...rest] }); }
    else if (cutNeeded === 0) { onComplete({ kept: [...newKept, ...rest], cut: newCut }); }
  }, [kept, cut, current, index, players, config, onComplete]);

  if (!current) return null;

  const forceKeep = cutRemaining === 0;
  const forceCut = remaining === 0;

  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          {config.mode === "challenge" && playerNum === 2 && (
            <div style={{ color: "#4a90d9", fontSize: "12px", fontWeight: 700, marginBottom: "2px" }}>CHALLENGER</div>
          )}
          <div style={{ color: "#888", fontSize: "13px" }}>Player {index + 1} of {players.length}</div>
        </div>
        <div style={{ display: "flex", gap: "14px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#38a169", fontWeight: 900, fontSize: "20px" }}>{kept.length}</div>
            <div style={{ color: "#888", fontSize: "10px" }}>KEPT</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#e53e3e", fontWeight: 900, fontSize: "20px" }}>{cut.length}</div>
            <div style={{ color: "#888", fontSize: "10px" }}>CUT</div>
          </div>
        </div>
      </div>

      <div style={{ background: "#1a1a2e", borderRadius: "4px", height: "4px", marginBottom: "20px", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(90deg, #e53e3e, #4a90d9)", height: "100%", width: `${(index / players.length) * 100}%`, transition: "width 0.3s" }} />
      </div>

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <div style={{ flex: 1, background: "rgba(56,161,105,0.1)", border: "1px solid rgba(56,161,105,0.3)", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
          <div style={{ color: "#38a169", fontWeight: 900, fontSize: "18px" }}>{remaining}</div>
          <div style={{ color: "#888", fontSize: "11px" }}>keep spots left</div>
        </div>
        <div style={{ flex: 1, background: "rgba(229,62,62,0.1)", border: "1px solid rgba(229,62,62,0.3)", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
          <div style={{ color: "#e53e3e", fontWeight: 900, fontSize: "18px" }}>{cutRemaining}</div>
          <div style={{ color: "#888", fontSize: "11px" }}>cut spots left</div>
        </div>
      </div>

      {(forceKeep || forceCut) && (
        <div style={{ background: forceKeep ? "rgba(56,161,105,0.15)" : "rgba(229,62,62,0.15)", border: `1px solid ${forceKeep ? "#38a169" : "#e53e3e"}`, borderRadius: "8px", padding: "10px", marginBottom: "16px", color: forceKeep ? "#68d391" : "#fc8181", fontSize: "13px", textAlign: "center" }}>
          {forceKeep ? "✅ All cuts used — you must KEEP this player" : "❌ All keeps used — you must CUT this player"}
        </div>
      )}

      <PlayerCard
        player={current}
        onKeep={forceCut ? null : () => handleDecision("keep")}
        onCut={forceKeep ? null : () => handleDecision("cut")}
        showInfo={config.allowInfo}
      />

      {(kept.length > 0 || cut.length > 0) && (
        <div style={{ marginTop: "24px" }}>
          {kept.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ color: "#38a169", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", marginBottom: "6px" }}>KEPT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {kept.map((p, i) => <PlayerCard key={i} player={p} decision="keep" compact showInfo={false} />)}
              </div>
            </div>
          )}
          {cut.length > 0 && (
            <div>
              <div style={{ color: "#e53e3e", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", marginBottom: "6px" }}>CUT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {cut.map((p, i) => <PlayerCard key={i} player={p} decision="cut" compact showInfo={false} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Roster Royale Draft Engine ──────────────────────────────────────────────
// Pure logic, no UI. Designed to be dropped into App.jsx once verified.

// The 10 roster slots, in the order they appear on the roster grid/recap.
// Order doesn't affect gameplay — it's just display order.
const ROSTER_SLOTS = [
  "qb", "rb", "wr1", "wr2", "wr3", "te", "oline", "def_base", "def_player", "coach"
];

const SLOT_LABELS = {
  qb: "QB", rb: "RB", wr1: "WR1", wr2: "WR2", wr3: "WR3", te: "TE",
  oline: "O-Line", def_base: "Defense", def_player: "Defensive Player", coach: "Coach",
};

// Each team row from the sheet has: team, qb, rb, wr1, wr2, wr3, te, oline,
// def_base, def1, def2, def3, def4, def5, coach
// This maps a team row into "what can this team offer for each of the 10 slots".
// def_player is special — it returns an array of 5 options instead of one value.
function getTeamOffers(teamRow) {
  return {
    qb: teamRow.qb,
    rb: teamRow.rb,
    wr1: teamRow.wr1,
    wr2: teamRow.wr2,
    wr3: teamRow.wr3,
    te: teamRow.te,
    oline: teamRow.oline,
    def_base: teamRow.def_base,
    def_player: [teamRow.def1, teamRow.def2, teamRow.def3, teamRow.def4, teamRow.def5].filter(Boolean),
    coach: teamRow.coach,
  };
}

// Creates a fresh draft state for a new game.
// teams: array of team row objects from the "Draft Mode - Teams" sheet
// seed: number, used to generate the round sequence (same seed = same sequence for challenges)
function createDraftState(teams, seed) {
  return {
    teams,
    seed,
    round: 0, // 0-indexed, increments after each pick
    roster: ROSTER_SLOTS.reduce((acc, slot) => ({ ...acc, [slot]: null }), {}),
    // roster[slot] will hold { value: string, teamName: string } once filled
    history: [], // log of { round, teamName, slotFilled, value } for recap/debug
  };
}

// Seeded random, consistent with the rest of the app (same algorithm as keep/cut)
function rrseededRandom(seed) {
  let s = Math.abs(seed) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Given a draft state, returns which slots are still open.
function getOpenSlots(state) {
  return ROSTER_SLOTS.filter((slot) => state.roster[slot] === null);
}

// Returns true if the draft is complete (all 10 slots filled).
function isDraftComplete(state) {
  return getOpenSlots(state).length === 0;
}

// Randomizes the next team for the current round.
// Uses state.seed + state.round so the same seed produces the same sequence
// of teams every time (critical for challenge mode — both players see the
// same team sequence, just make different picks).
function getNextTeam(state) {
  const rand = rrseededRandom(state.seed + state.round * 7919); // prime offset avoids correlation between rounds
  const index = Math.floor(rand() * state.teams.length);
  return state.teams[index];
}

// Given the current state and a randomized team, returns the list of
// choices the player can make this round — one entry per still-open slot
// that this team can fill.
// Each choice is { slot, label, value } except for def_player, which is
// { slot, label, options: [...5 names] }.
function getRoundChoices(state, team) {
  const openSlots = getOpenSlots(state);
  const offers = getTeamOffers(team);

  return openSlots
    .map((slot) => {
      if (slot === "def_player") {
        const options = offers.def_player;
        if (!options || options.length === 0) return null;
        return { slot, label: SLOT_LABELS[slot], options };
      }
      const value = offers[slot];
      if (!value) return null;
      return { slot, label: SLOT_LABELS[slot], value };
    })
    .filter(Boolean);
}

// Locks in a pick. Returns a NEW state (does not mutate the original —
// keeps this easy to use with React state).
// slot: the slot being filled (e.g. "wr2" or "def_player")
// value: the name/string to lock in (for def_player, this is the chosen defender's name)
// team: the team object this pick came from (for display/team-color purposes)
function makePick(state, slot, value, team) {
  if (state.roster[slot] !== null) {
    throw new Error(`Slot "${slot}" is already filled.`);
  }

  const newRoster = {
    ...state.roster,
    [slot]: { value, teamName: team.team },
  };

  const newHistoryEntry = {
    round: state.round,
    teamName: team.team,
    slotFilled: slot,
    value,
  };

  return {
    ...state,
    roster: newRoster,
    round: state.round + 1,
    history: [...state.history, newHistoryEntry],
  };
}

function RosterRoyaleLaunchScreen({ teams, onStart, onBack, loading }) {
  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", fontSize: "13px", cursor: "pointer", marginBottom: "16px", padding: 0 }}>← All Games</button>

      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "13px", letterSpacing: "3px", color: "#e53e3e", fontWeight: 800, textTransform: "uppercase", marginBottom: "8px" }}>NFL</div>
        <h1 style={{ fontSize: "38px", fontWeight: 900, color: "#fff", margin: 0, lineHeight: 1, letterSpacing: "-1px" }}>ROSTER<br /><span style={{ color: "#e53e3e" }}>ROYALE</span></h1>
        <p style={{ color: "#888", marginTop: "12px", fontSize: "14px" }}>10 rounds. 32 teams. Build your squad.</p>
      </div>

      <div style={{ background: "rgba(74,144,217,0.1)", border: "1px solid rgba(74,144,217,0.3)", borderRadius: "8px", padding: "14px", marginBottom: "28px", color: "#a0c4ff", fontSize: "12px", lineHeight: 1.6 }}>
        Each round, a random current NFL team is revealed. Pick one of your still-open
        positions from that team's roster. Every team can fill every slot — no
        rerolls, no dead picks. After 10 rounds your roster is complete.
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#555", padding: "20px 0" }}>Loading team data...</div>
      ) : (
        <button
          onClick={onStart}
          disabled={!teams || teams.length === 0}
          style={{
            width: "100%",
            background: teams && teams.length > 0 ? "linear-gradient(135deg, #c53030, #e53e3e)" : "#333",
            color: teams && teams.length > 0 ? "#fff" : "#666",
            border: "none", borderRadius: "10px", padding: "18px", fontWeight: 900, fontSize: "18px",
            letterSpacing: "1px", cursor: teams && teams.length > 0 ? "pointer" : "not-allowed", textTransform: "uppercase",
          }}
        >
          🏆 Start Draft
        </button>
      )}
    </div>
  );
}

const RR_TEAM_COLORS = {
  "Arizona Cardinals": "#97233F",
  "Atlanta Falcons": "#A71930",
  "Baltimore Ravens": "#5B3FA0",
  "Buffalo Bills": "#00338D",
  "Carolina Panthers": "#0085CA",
  "Chicago Bears": "#3C6191",
  "Cincinnati Bengals": "#FB4F14",
  "Cleveland Browns": "#8A6240",
  "Dallas Cowboys": "#3568B5",
  "Denver Broncos": "#FB4F14",
  "Detroit Lions": "#0076B6",
  "Green Bay Packers": "#2E7D52",
  "Houston Texans": "#3D5566",
  "Indianapolis Colts": "#2F5C9C",
  "Jacksonville Jaguars": "#1A8FA3",
  "Kansas City Chiefs": "#E31837",
  "Las Vegas Raiders": "#A5ACAF",
  "Los Angeles Chargers": "#0080C6",
  "Los Angeles Rams": "#3568B5",
  "Miami Dolphins": "#008E97",
  "Minnesota Vikings": "#6A4C9C",
  "New England Patriots": "#3D5170",
  "New Orleans Saints": "#D3BC8D",
  "New York Giants": "#3656A0",
  "New York Jets": "#1F7A5C",
  "Philadelphia Eagles": "#1F6B72",
  "Pittsburgh Steelers": "#FFB612",
  "San Francisco 49ers": "#C2272D",
  "Seattle Seahawks": "#3D5170",
  "Tampa Bay Buccaneers": "#D50A0A",
  "Tennessee Titans": "#4B92DB",
  "Washington Commanders": "#8A3A3A",
};
function getTeamColor(teamName) {
  return RR_TEAM_COLORS[teamName] || "#4a90d9";
}

const RR_ROSTER_SLOTS = [
  "coach", "qb", "rb", "wr1", "wr2", "wr3", "te", "oline", "def_base", "def_player",
];

const RR_SLOT_LABELS = {
  qb: "QB", rb: "RB", wr1: "WR1", wr2: "WR2", wr3: "WR3", te: "TE",
  oline: "O-Line", def_base: "Base Defense", def_player: "Bonus Defender", coach: "Coach",
};

function rrGetTeamOffers(teamRow) {
  return {
    qb: teamRow.qb,
    rb: teamRow.rb,
    wr1: teamRow.wr1,
    wr2: teamRow.wr2,
    wr3: teamRow.wr3,
    te: teamRow.te,
    oline: teamRow.oline,
    def_base: teamRow.def_base,
    def_player: [teamRow.def1, teamRow.def2, teamRow.def3, teamRow.def4, teamRow.def5].filter(Boolean),
    coach: teamRow.coach,
  };
}

function rrCreateDraftState(teams, seed) {
  return {
    teams,
    seed,
    round: 0,
    roster: RR_ROSTER_SLOTS.reduce((acc, slot) => ({ ...acc, [slot]: null }), {}),
    history: [],
  };
}

function rrSeededRandom(seed) {
  let s = Math.abs(seed) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function rrGetOpenSlots(state) {
  return RR_ROSTER_SLOTS.filter((slot) => state.roster[slot] === null);
}

function rrIsDraftComplete(state) {
  return rrGetOpenSlots(state).length === 0;
}

function rrGetNextTeam(state) {
  const rand = rrSeededRandom(state.seed + state.round * 7919);
  const index = Math.floor(rand() * state.teams.length);
  return state.teams[index];
}

function rrGetRoundChoices(state, team) {
  const openSlots = rrGetOpenSlots(state);
  const offers = rrGetTeamOffers(team);

  return openSlots
    .map((slot) => {
      if (slot === "def_player") {
        const options = offers.def_player;
        if (!options || options.length === 0) return null;
        return { slot, label: RR_SLOT_LABELS[slot], options };
      }
      const value = offers[slot];
      if (!value) return null;
      return { slot, label: RR_SLOT_LABELS[slot], value };
    })
    .filter(Boolean);
}

function rrMakePick(state, slot, value, team) {
  if (state.roster[slot] !== null) {
    throw new Error(`Slot "${slot}" is already filled.`);
  }
  const newRoster = { ...state.roster, [slot]: { value, teamName: team.team } };
  const newHistoryEntry = { round: state.round, teamName: team.team, slotFilled: slot, value };
  return {
    ...state,
    roster: newRoster,
    round: state.round + 1,
    history: [...state.history, newHistoryEntry],
  };
}

function abbreviateName(name) {
  if (!name) return "";
  const parts = name.split(" ");
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function RosterGrid({ roster, compact = true }) {
  const gridSlots = RR_ROSTER_SLOTS;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: compact ? "6px" : "10px" }}>
      {gridSlots.map((slot) => {
        const pick = roster[slot];
        return (
          <div key={slot} style={{
            background: pick ? "rgba(74,144,217,0.12)" : "#15152a",
            border: `1px solid ${pick ? "#4a90d9" : "#2d2d4a"}`,
            borderRadius: "8px",
            padding: compact ? "6px 8px" : "12px 10px",
            minHeight: compact ? "auto" : "70px",
          }}>
            <div style={{ color: compact && pick ? getTeamColor(pick.teamName) : "#666", fontSize: compact ? "9px" : "10px", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>
              {RR_SLOT_LABELS[slot]}
            </div>
            <div style={{ color: pick ? "#fff" : "#444", fontSize: compact ? "11px" : "14px", fontWeight: 700, marginTop: "2px", lineHeight: 1.2 }}>
              {pick ? (compact ? abbreviateName(pick.value) : pick.value) : "—"}
            </div>
            {!compact && pick && (
              <div style={{ color: getTeamColor(pick.teamName), fontSize: "10px", marginTop: "2px", fontWeight: 700 }}>{pick.teamName}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RosterRoyaleGameScreen({ teams, seed, playerNum = 1, onComplete }) {
  const [state, setState] = useState(() => rrCreateDraftState(teams, seed));
  const [currentTeam, setCurrentTeam] = useState(() => rrGetNextTeam(rrCreateDraftState(teams, seed)));
  const [defPlayerExpanded, setDefPlayerExpanded] = useState(false);

  const choices = rrGetRoundChoices(state, currentTeam);
  const roundNum = state.round + 1;

 const handlePick = (choice, chosenValue = null) => {
    const value = choice.slot === "def_player" ? chosenValue : choice.value;
    if (choice.slot === "def_player" && !value) {
      setDefPlayerExpanded((prev) => !prev);
      return;
    }

    const newState = rrMakePick(state, choice.slot, value, currentTeam);
    setDefPlayerExpanded(false);

    if (rrIsDraftComplete(newState)) {
      onComplete(newState.roster);
      return;
    }

    setState(newState);
    setCurrentTeam(rrGetNextTeam(newState));
  };

  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          {playerNum === 2 && (
            <div style={{ color: "#4a90d9", fontSize: "12px", fontWeight: 700, marginBottom: "2px" }}>CHALLENGER</div>
          )}
          <div style={{ color: "#888", fontSize: "13px" }}>Round {roundNum} of 10</div>
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <RosterGrid roster={state.roster} compact />
      </div>

      <div style={{ background: "#1a1a2e", borderRadius: "4px", height: "4px", marginBottom: "20px", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(90deg, #e53e3e, #4a90d9)", height: "100%", width: `${(state.round / 10) * 100}%`, transition: "width 0.3s" }} />
      </div>

     <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <div style={{ color: "#888", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" }}>On The Clock</div>
        <div style={{ fontSize: "28px", fontWeight: 900, color: getTeamColor(currentTeam.team) }}>🎲 {currentTeam.team}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {choices.map((choice) => {
          if (choice.slot === "def_player") {
            return (
              <div key={choice.slot}>
                <button
                  onClick={() => handlePick(choice)}
                  style={{
                    width: "100%", background: defPlayerExpanded ? `${getTeamColor(currentTeam.team)}26` : "#1a1a2e",
                    border: `2px solid ${getTeamColor(currentTeam.team)}`, borderRadius: "10px",
                    padding: "14px 16px", cursor: "pointer", textAlign: "left", display: "flex",
                    justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ color: getTeamColor(currentTeam.team), fontSize: "10px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{choice.label}</div>
                    <div style={{ color: "#fff", fontWeight: 700, fontSize: "14px" }}>Choose a defender</div>
                  </div>
                  <div style={{ color: getTeamColor(currentTeam.team), fontSize: "16px" }}>{defPlayerExpanded ? "▲" : "▼"}</div>
                </button>
                {defPlayerExpanded && (
                  <div style={{ background: "#111", border: "1px solid #2d2d4a", borderRadius: "10px", marginTop: "4px", overflow: "hidden" }}>
                    {choice.options.map((name) => (
                      <button
                        key={name}
                        onClick={() => handlePick(choice, name)}
                        style={{
                          width: "100%", background: "transparent", border: "none",
                          borderBottom: "1px solid #1a1a2e", padding: "12px 16px", cursor: "pointer",
                          textAlign: "left", color: "#ddd", fontSize: "14px", fontWeight: 600,
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

         return (
            <button
              key={choice.slot}
              onClick={() => handlePick(choice)}
              style={{
                width: "100%", background: "#1a1a2e", border: `2px solid ${getTeamColor(currentTeam.team)}`, borderRadius: "10px",
                padding: "14px 16px", cursor: "pointer", textAlign: "left", display: "flex",
                justifyContent: "space-between", alignItems: "center",
              }}
            >
              <div>
                <div style={{ color: getTeamColor(currentTeam.team), fontSize: "10px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{choice.label}</div>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: "15px" }}>{choice.value}</div>
              </div>
              <div style={{ color: getTeamColor(currentTeam.team), fontSize: "18px" }}>→</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RosterRoyaleChallengeReceivedScreen({ onStart }) {
  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px", textAlign: "center" }}>
      <div style={{ padding: "40px 20px 20px" }}>
        <div style={{ fontSize: "56px", marginBottom: "12px" }}>⚔️</div>
        <div style={{ color: "#e53e3e", fontSize: "13px", fontWeight: 800, letterSpacing: "2px", marginBottom: "8px" }}>YOU'VE BEEN CHALLENGED</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "28px", marginBottom: "12px" }}>Roster Royale</h2>
        <p style={{ color: "#888", fontSize: "14px", marginBottom: "28px", lineHeight: 1.6 }}>
          Your opponent already drafted their squad. You'll see the same sequence of 10 randomized teams, the order you choose to fill your roster will radically change the look of each team — hit accept to see who is the better GM.
        </p>
        <button onClick={onStart} style={{ width: "100%", background: "linear-gradient(135deg, #c53030, #e53e3e)", color: "#fff", border: "none", borderRadius: "10px", padding: "18px", fontWeight: 900, fontSize: "18px", cursor: "pointer", textTransform: "uppercase" }}>
          Accept Challenge ⚔️
        </button>
      </div>
    </div>
  );
}

function RosterRoyaleChallengeLinkScreen({ seed, roster, onHome, onPlayAgain }) {
  const [copied, setCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);

  const rosterCode = useMemo(() => encodeRoster(roster), [roster]);
  const challengeURL = `${window.location.origin}/rr/${roster._seed}.${encodeRoster(roster)}`;

  const smsBody = `🏆 I just drafted my Roster Royale squad. Think you can build a better one? We'll get the same random teams, in the same order, but the order we choose to fill out our rosters in is up to your own GM skills — let's see who actually knows ball. 👇\n\n${challengeURL}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(challengeURL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const handleTextChallenge = () => {
    navigator.clipboard.writeText(smsBody).then(() => { setTextCopied(true); setTimeout(() => setTextCopied(false), 2000); });
    if (navigator.share) {
      navigator.share({ title: "Roster Royale Challenge", text: smsBody }).catch(() => {});
    }
  };

  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🏆</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "26px", margin: "0 0 8px 0" }}>Your Roster is Locked</h2>
        <p style={{ color: "#888", fontSize: "14px", margin: 0 }}>Send the challenge link — your opponent drafts the same sequence of teams, then you both see the comparison.</p>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
        <div style={{ color: "#888", fontSize: "11px", letterSpacing: "1px", marginBottom: "12px", textTransform: "uppercase" }}>Your Squad</div>
        <RosterGrid roster={roster} compact />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
        <button onClick={handleTextChallenge} style={{ background: "linear-gradient(135deg, #1a5c3a, #2d9e5f)", color: "#fff", border: "none", borderRadius: "10px", padding: "16px", fontWeight: 800, fontSize: "16px", cursor: "pointer" }}>
          {textCopied ? "✅ Copied! Paste in your text app" : "💬 Text the Challenge"}
        </button>
        <button onClick={handleCopyLink} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#a0c4ff", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
          {copied ? "✅ Link Copied!" : "🔗 Copy Challenge Link"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={onPlayAgain} style={{ flex: 1, background: "linear-gradient(135deg, #c53030, #e53e3e)", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: 800, fontSize: "15px", cursor: "pointer" }}>🔄 Run It Back</button>
        <button onClick={onHome} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>🏠 Home</button>
      </div>
    </div>
  );
}

function RosterRoyaleComparisonRows({ p1Roster, p2Roster }) {
  const slotShortLabels = {
    qb: "QB", rb: "RB", wr1: "WR1", wr2: "WR2", wr3: "WR3", te: "TE",
    oline: "OL", def_base: "DEF", def_player: "DEF+", coach: "HC",
  };
  const isUnit = (slot) => slot === "oline" || slot === "def_base";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#2d2d4a", borderRadius: "10px", overflow: "hidden", border: "1px solid #2d2d4a" }}>
      {RR_ROSTER_SLOTS.map((slot) => {
        const p1Pick = p1Roster[slot];
        const p2Pick = p2Roster[slot];
        const fontSize = isUnit(slot) ? "12px" : "13px";
        return (
          <div key={slot} style={{ display: "grid", gridTemplateColumns: "1fr 50px 1fr", alignItems: "center", background: "#16213e" }}>
            <div style={{ padding: "10px 10px", textAlign: "right", fontSize, color: p1Pick ? "#fff" : "#555" }}>
              {p1Pick ? p1Pick.value : "—"}
            </div>
            <div style={{ padding: "8px 0", textAlign: "center", fontSize: "9px", fontWeight: 700, letterSpacing: "0.5px", color: "#888", background: "#1a1a2e" }}>
              {slotShortLabels[slot]}
            </div>
            <div style={{ padding: "10px 10px", textAlign: "left", fontSize, color: p2Pick ? "#fff" : "#555" }}>
              {p2Pick ? p2Pick.value : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RosterRoyaleRecapScreen({ roster, onPlayAgain, onHome, isChallenge = false, p1Roster = null }) {
  const [copied, setCopied] = useState(false);
  const [challengeCopied, setChallengeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const formatRoster = (r) => RR_ROSTER_SLOTS.map((slot) => `${RR_SLOT_LABELS[slot]}: ${r[slot]?.value || "—"}`).join("\n");

  const shareText = isChallenge && p1Roster
    ? `🏆 Roster Royale — Head-to-Head Results! Which player built a better roster?\n\n👤 Player A\n${formatRoster(p1Roster)}\n\n⚔️ Player B\n${formatRoster(roster)}\n\n🎮 Think you can do better? keeporcut.vercel.app`
    : `🏆 Roster Royale — My Squad\n\n${formatRoster(roster)}\n\n🎮 Think you can draft better? keeporcut.vercel.app`;

  const challengeURL = `${window.location.origin}/rr/${roster._seed}.${encodeRoster(roster)}`;
  const smsBody = `🏆 I just drafted my Roster Royale squad. Think you can build a better one? Same 10 rounds, same random teams — let's see who actually knows ball. 👇\n\n${challengeURL}`;

  const handleChallengeFriend = () => {
    if (navigator.share) {
      navigator.share({ title: "Roster Royale Challenge", text: smsBody }).catch(() => {});
    } else {
      navigator.clipboard.writeText(smsBody).then(() => { setChallengeCopied(true); setTimeout(() => setChallengeCopied(false), 2000); });
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(challengeURL).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); });
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        <div style={{ fontSize: "13px", letterSpacing: "3px", color: "#e53e3e", fontWeight: 800, marginBottom: "6px" }}>FINAL ROSTER</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "28px", margin: 0 }}>
          {isChallenge && p1Roster ? "⚔️ Head-to-Head Results" : "🏆 Your Squad"}
        </h2>
      </div>

      {isChallenge && p1Roster ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#4a90d9" }}>👤 Player 1</div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#e53e3e" }}>⚔️ Challenger</div>
          </div>
          <RosterRoyaleComparisonRows p1Roster={p1Roster} p2Roster={roster} />
        </>
      ) : (
        <RosterGrid roster={roster} compact={false} />
      )}

      {!isChallenge && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px" }}>
          <button onClick={handleChallengeFriend} style={{ width: "100%", background: "linear-gradient(135deg, #1a5c3a, #2d9e5f)", color: "#fff", border: "none", borderRadius: "10px", padding: "16px", fontWeight: 800, fontSize: "16px", cursor: "pointer" }}>
            {challengeCopied ? "✅ Copied! Paste in your text app" : "📲 Challenge a Friend"}
          </button>
          <button onClick={handleCopyLink} style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#a0c4ff", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
            {linkCopied ? "✅ Link Copied!" : "🔗 Copy Challenge Link"}
          </button>
        </div>
      )}

      {isChallenge && (
        <div style={{ marginTop: "28px", background: "#1a1a2e", border: "1px solid #2d2d4a", borderRadius: "10px", padding: "16px" }}>
          <div style={{ color: "#888", fontSize: "11px", letterSpacing: "1px", marginBottom: "10px", textTransform: "uppercase" }}>Share & Spark Debate</div>
          <pre style={{ color: "#ccc", fontSize: "12px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "0 0 12px 0" }}>{shareText}</pre>
          <button onClick={() => { navigator.clipboard.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} style={{ background: copied ? "#38a169" : "#2d2d4a", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}>
            {copied ? "✅ Copied!" : "📋 Copy to Share"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
        <button onClick={onPlayAgain} style={{ flex: 1, background: "linear-gradient(135deg, #c53030, #e53e3e)", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: 800, fontSize: "15px", cursor: "pointer" }}>🔄 Draft Again</button>
        <button onClick={onHome} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>🔀 All Games</button>
      </div>
    </div>
  );
}

// ── Challenge Link Screen ─────────────────────────────────────────────────────
function ChallengeLinkScreen({ config, players, p1Result, onHome, onPlayAgain }) {
  const [copied, setCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);

  const gameCode = useMemo(() => encodeGame(config.seed, config), [config]);
  const p1Code = useMemo(() => encodeResult(p1Result.kept, p1Result.cut, players), [p1Result, players]);
  const challengeURL = buildChallengeURL(gameCode, p1Code);

  const smsBody = `🏈 I just locked in my squad. Think you can top it? Same ${config.totalPlayers} players, keep ${config.keepCount}. Let's find out who actually knows ball. 👇\n\n${challengeURL}`;

  const poolLabel = ALL_POOL_OPTIONS.find(o => o.id === config.poolId)?.label || config.poolId;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(challengeURL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const handleTextChallenge = () => {
    navigator.clipboard.writeText(smsBody).then(() => { setTextCopied(true); setTimeout(() => setTextCopied(false), 2000); });
    if (navigator.share) {
      navigator.share({ title: "NFL Keep or Cut Challenge", text: smsBody }).catch(() => {});
    }
  };

  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>📲</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "26px", margin: "0 0 8px 0" }}>Your Draft is Locked</h2>
        <p style={{ color: "#888", fontSize: "14px", margin: 0 }}>Send the challenge link — your opponent drafts the same pool, then you both see the comparison.</p>
      </div>

      {/* P1 results preview */}
      <div style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
        <div style={{ color: "#888", fontSize: "11px", letterSpacing: "1px", marginBottom: "12px", textTransform: "uppercase" }}>Your Draft · {poolLabel}</div>
        <div style={{ marginBottom: "10px" }}>
          <div style={{ color: "#38a169", fontSize: "11px", fontWeight: 700, marginBottom: "6px" }}>✅ KEPT ({p1Result.kept.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {p1Result.kept.map((p, i) => <PlayerCard key={i} player={p} decision="keep" compact showInfo={false} />)}
          </div>
        </div>
        <div>
          <div style={{ color: "#e53e3e", fontSize: "11px", fontWeight: 700, marginBottom: "6px" }}>❌ CUT ({p1Result.cut.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {p1Result.cut.map((p, i) => <PlayerCard key={i} player={p} decision="cut" compact showInfo={false} />)}
          </div>
        </div>
      </div>

      {/* Share buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
        <button onClick={handleTextChallenge} style={{ background: "linear-gradient(135deg, #1a5c3a, #2d9e5f)", color: "#fff", border: "none", borderRadius: "10px", padding: "16px", fontWeight: 800, fontSize: "16px", cursor: "pointer" }}>
          {textCopied ? "✅ Copied! Paste in your text app" : "💬 Text the Challenge"}
        </button>
        <button onClick={handleCopyLink} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#a0c4ff", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
          {copied ? "✅ Link Copied!" : "🔗 Copy Challenge Link"}
        </button>
      </div>

      <div style={{ background: "#111", border: "1px solid #1e1e3a", borderRadius: "8px", padding: "12px", marginBottom: "20px" }}>
        <div style={{ color: "#555", fontSize: "10px", letterSpacing: "1px", marginBottom: "6px" }}>CHALLENGE LINK</div>
        <div style={{ color: "#555", fontSize: "11px", wordBreak: "break-all", lineHeight: 1.5 }}>{challengeURL.slice(0, 80)}...</div>
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={() => onPlayAgain()} style={{ flex: 1, background: "linear-gradient(135deg, #c53030, #e53e3e)", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: 800, fontSize: "15px", cursor: "pointer" }}>🔄 Run It Back</button>
        <button onClick={onHome} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>🏠 Home</button>
      </div>
    </div>
  );
}

// ── Results Screen ────────────────────────────────────────────────────────────
function ResultsScreen({ results, config, onPlayAgain, onHome, isChallenge = false }) {
  const [copied, setCopied] = useState(false);
  const p1 = results[0];
  const p2 = results[1];
  const poolLabel = ALL_POOL_OPTIONS.find(o => o.id === config.poolId)?.label || config.poolId;

  const debateQuestions = [
    "🏆 One game, all else equal, which squad is winning?",
    "✂️ Who was the most disrespectful cut on either roster?",
    "🤦 Which keep was the biggest mistake?",
  ];
  const debateQuestion = debateQuestions[Math.floor(Math.random() * debateQuestions.length)];

  const shareText = isChallenge && p2
    ? `🏈 NFL Keep or Cut — Head-to-Head Results!\n\nPool: ${poolLabel} · Keep ${config.keepCount} of ${config.totalPlayers}\n\n👤 Player 1\n✅ Kept: ${p1.kept.map(p => p.name).join(", ")}\n❌ Cut: ${p1.cut.map(p => p.name).join(", ")}\n\n⚔️ Player 2\n✅ Kept: ${p2.kept.map(p => p.name).join(", ")}\n❌ Cut: ${p2.cut.map(p => p.name).join(", ")}\n\n${debateQuestion}\n\n🎮 Want to play? keeporcut.vercel.app`
    : `🏈 NFL Keep or Cut\n\nPool: ${poolLabel} · Keeping ${config.keepCount} of ${config.totalPlayers}\n\n✅ Kept: ${p1.kept.map(p => p.name).join(", ")}\n❌ Cut: ${p1.cut.map(p => p.name).join(", ")}\n\n${debateQuestion}\n\n🎮 Think you can do better? keeporcut.vercel.app`;  
 
  const ResultPanel = ({ result, label }) => (
    <div style={{ flex: 1, minWidth: "0" }}>
      {label && <div style={{ color: "#4a90d9", fontSize: "12px", fontWeight: 800, letterSpacing: "1px", marginBottom: "10px" }}>{label}</div>}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ color: "#38a169", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", marginBottom: "6px" }}>✅ KEPT ({result.kept.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {result.kept.map((p, i) => <PlayerCard key={i} player={p} decision="keep" compact showInfo={false} />)}
        </div>
      </div>
      <div>
        <div style={{ color: "#e53e3e", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", marginBottom: "6px" }}>❌ CUT ({result.cut.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {result.cut.map((p, i) => <PlayerCard key={i} player={p} decision="cut" compact showInfo={false} />)}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        <div style={{ fontSize: "13px", letterSpacing: "3px", color: "#e53e3e", fontWeight: 800, marginBottom: "6px" }}>FINAL ROSTER</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "28px", margin: 0 }}>
          {isChallenge && p2 ? "⚔️ Head-to-Head Results" : isChallenge ? "⏳ Waiting on Challenger..." : "🎯 Your Squad"}
        </h2>
        <p style={{ color: "#888", fontSize: "13px", marginTop: "6px" }}>{poolLabel} · Keeping {config.keepCount} of {config.totalPlayers}</p>
      </div>

      {isChallenge && p2 ? (
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <ResultPanel result={p1} label="👤 PLAYER 1" />
          <ResultPanel result={p2} label="⚔️ CHALLENGER" />
        </div>
      ) : (
        <ResultPanel result={p1} />
      )}

      <div style={{ marginTop: "28px", background: "#1a1a2e", border: "1px solid #2d2d4a", borderRadius: "10px", padding: "16px" }}>
        <div style={{ color: "#888", fontSize: "11px", letterSpacing: "1px", marginBottom: "10px", textTransform: "uppercase" }}>Share & Spark Debate</div>
        <pre style={{ color: "#ccc", fontSize: "12px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "0 0 12px 0" }}>{shareText}</pre>
        <button onClick={() => { navigator.clipboard.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} style={{ background: copied ? "#38a169" : "#2d2d4a", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}>
          {copied ? "✅ Copied!" : "📋 Copy to Share"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
        <button onClick={onPlayAgain} style={{ flex: 1, background: "linear-gradient(135deg, #c53030, #e53e3e)", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: 800, fontSize: "15px", cursor: "pointer" }}>🔄 Play Again</button>
        <button onClick={onHome} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>🔀 Switch Player Pool</button>
      </div>
    </div>
  );
}

// ── Challenge Received Screen ─────────────────────────────────────────────────
function ChallengeReceivedScreen({ gameData, p1Result, onStart }) {
  const poolLabel = ALL_POOL_OPTIONS.find(o => o.id === gameData.config.poolId)?.label || gameData.config.poolId;
  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px", textAlign: "center" }}>
      <div style={{ padding: "40px 20px 20px" }}>
        <div style={{ fontSize: "56px", marginBottom: "12px" }}>⚔️</div>
        <div style={{ color: "#e53e3e", fontSize: "13px", fontWeight: 800, letterSpacing: "2px", marginBottom: "8px" }}>YOU'VE BEEN CHALLENGED</div>
        <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "28px", marginBottom: "12px" }}>NFL Keep or Cut</h2>
        <div style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", borderRadius: "10px", padding: "16px", marginBottom: "24px", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#888", fontSize: "13px" }}>Pool</span>
            <span style={{ color: "#fff", fontSize: "13px", fontWeight: 700 }}>{poolLabel}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#888", fontSize: "13px" }}>Players</span>
            <span style={{ color: "#fff", fontSize: "13px", fontWeight: 700 }}>{gameData.config.totalPlayers}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#888", fontSize: "13px" }}>Keep</span>
            <span style={{ color: "#38a169", fontSize: "13px", fontWeight: 700 }}>{gameData.config.keepCount} players</span>
          </div>
        </div>
        <p style={{ color: "#888", fontSize: "14px", marginBottom: "28px", lineHeight: 1.6 }}>
          Your opponent already drafted. Draft the same pool — your picks stay hidden until the end.
        </p>
        <button onClick={onStart} style={{ width: "100%", background: "linear-gradient(135deg, #c53030, #e53e3e)", color: "#fff", border: "none", borderRadius: "10px", padding: "18px", fontWeight: 900, fontSize: "18px", cursor: "pointer", textTransform: "uppercase" }}>
          Accept Challenge ⚔️
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("loading");
  const [config, setConfig] = useState(null);
  const [gamePlayers, setGamePlayers] = useState([]);
  const [p1Result, setP1Result] = useState(null);
  const [challengeData, setChallengeData] = useState(null);
  const nflPlayersRef = useRef(NFL_PLAYERS_FALLBACK);
  const [rrTeams, setRrTeams] = useState([]);
  const [rrTeamsLoading, setRrTeamsLoading] = useState(false);
  const [rrSeed, setRrSeed] = useState(null);
  const [rrRoster, setRrRoster] = useState(null);
  const [rrChallengeData, setRrChallengeData] = useState(null);
  const [rrIsChallengeSender, setRrIsChallengeSender] = useState(false);

  // On mount: fetch players from Google Sheet, then check URL
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(SHEET_API_URL);
        const rows = await res.json();
        const pools = buildPlayerPools(rows);
        if (Object.keys(pools).length > 0) {
          nflPlayersRef.current = pools;
        }
      } catch (e) {
        console.warn("Sheet fetch failed, using fallback players", e);
      }

      const params = getURLParams();

      if (params.mode === "keep-or-cut" && params.game && params.p1result) {
        const gameData = decodeGame(params.game);
        if (gameData) {
          const pool = nflPlayersRef.current[gameData.config.poolId] || nflPlayersRef.current.all_time_greats;
          const allPlayers = seededShuffle(pool, gameData.seed).slice(0, gameData.config.totalPlayers);
          const p1 = decodeResult(params.p1result, allPlayers);
          if (p1) {
            setChallengeData({ gameData, p1Result: p1, allPlayers });
            setScreen("challenge-received");
            return;
          }
        }
      }

      if (params.mode === "roster-royale" && params.rrSeed && params.rrP1Roster) {
        const seed = parseInt(params.rrSeed);
        const p1Roster = decodeRoster(params.rrP1Roster);
        if (!isNaN(seed) && p1Roster) {
          try {
            const res = await fetch(DRAFT_MODE_API_URL);
            const rows = await res.json();
            setRrTeams(rows);
            setRrSeed(seed);
            setRrChallengeData({ p1Roster });
            setScreen("roster-royale-challenge-received");
            return;
          } catch (e) {
            console.warn("Failed to load Draft Mode teams for challenge", e);
          }
        }
      }

      setScreen("mode-menu");
    }
    init();
  }, []);

const handleStart = (cfg) => {
  const seed = cfg.seed || (Math.floor(Math.random() * 2147483647) + 1);
  const cfgWithSeed = { ...cfg, seed };
  setConfig(cfgWithSeed);

  const OFFENSE_POS = ["QB", "RB", "WR", "TE", "FB", "OT", "OG", "C", "OL"];
  const DEFENSE_POS = ["DE", "DT", "LB", "CB", "S", "DB", "NT", "DL"];

  const positionPools = {
    qbs_only: ["QB"],
    rbs_only: ["RB", "FB"],
    wrs_only: ["WR"],
    tes_only: ["TE"],
    linemen_only: ["OT", "OG", "C", "OL", "DE", "DT", "DL"],
    offense_only: OFFENSE_POS,
    defense_only: DEFENSE_POS,
  };

  let pool;
  if (positionPools[cfg.poolId]) {
    const positions = positionPools[cfg.poolId];
    const allPlayers = Object.values(nflPlayersRef.current).flat();
    const seen = new Set();
    pool = allPlayers.filter(p => {
      if (positions.includes(p.pos) && !seen.has(p.name)) {
        seen.add(p.name);
        return true;
      }
      return false;
    });
  } else {
    pool = nflPlayersRef.current[cfg.poolId] || nflPlayersRef.current.all_time_greats;
  }

  const selected = seededShuffle(pool, seed).slice(0, cfg.totalPlayers);
  setGamePlayers(selected);
  setP1Result(null);
  clearURLParams();
  setScreen("game-p1");
};

const handleP1Complete = (result) => {
  setP1Result(result);
  if (config.mode === "challenge") {
    setScreen("challenge-link");
  } else {
    setScreen("results");
  }
};

const handleChallengeAccepted = () => {
  const { gameData, allPlayers } = challengeData;
  setConfig({ ...gameData.config, seed: gameData.seed });
  setGamePlayers(allPlayers);
  setScreen("game-p2");
};

  const handleP2Complete = (result) => {
    if (challengeData) {
      setP1Result(challengeData.p1Result);
      setChallengeData(null);
      setScreen("results-challenge");
    } else {
      setScreen("results");
    }
    // Store p2 result for results screen
    setConfig(prev => ({ ...prev, _p2Result: result }));
  };

const handleSelectMode = (mode) => {
  if (mode === "keep-or-cut") {
    setScreen("setup");
  } else {
    setRrTeamsLoading(true);
    fetch(DRAFT_MODE_API_URL)
      .then((res) => res.json())
      .then((rows) => {
        setRrTeams(rows);
        setRrTeamsLoading(false);
        const seed = Math.floor(Math.random() * 2147483647) + 1;
        setRrSeed(seed);
        setRrRoster(null);
        setRrIsChallengeSender(false);
        setScreen("roster-royale-game");
      })
      .catch((e) => {
        console.warn("Failed to load Draft Mode teams", e);
        setRrTeamsLoading(false);
      });
  }
};

  const handleStartRosterRoyale = () => {
  const seed = Math.floor(Math.random() * 2147483647) + 1;
  setRrSeed(seed);
  setRrRoster(null);
  setRrChallengeData(null);
  setScreen("roster-royale-game");
};

  const handleChallengeFriendRosterRoyale = () => {
  setScreen("roster-royale-challenge-link");
};

const handleRosterRoyaleChallengeAccepted = () => {
  setRrRoster(null);
  setScreen("roster-royale-game");
};

const handleRosterRoyaleComplete = (finalRoster) => {
  const rosterWithSeed = { ...finalRoster, _seed: rrSeed };
  setRrRoster(rosterWithSeed);
  setScreen(rrChallengeData ? "roster-royale-recap-challenge" : "roster-royale-recap");
};
  
  const goHome = () => {
    clearURLParams();
    setChallengeData(null);
    setConfig(null);
    setP1Result(null);
    setGamePlayers([]);
    setScreen("setup");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #0a0a1a 0%, #0d0d1f 100%)", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: "#fff" }}>
      {screen === "loading" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#555" }}>Loading...</div>
      )}

      {screen === "mode-menu" && <ModeMenuScreen onSelectMode={handleSelectMode} />}

      {screen === "roster-royale-launch" && (
  <RosterRoyaleLaunchScreen
    teams={rrTeams}
    loading={rrTeamsLoading}
    onStart={handleStartRosterRoyale}
    onBack={() => setScreen("mode-menu")}
  />
)}

{screen === "roster-royale-game" && (
  <RosterRoyaleGameScreen
    teams={rrTeams}
    seed={rrSeed}
    playerNum={rrChallengeData ? 2 : 1}
    onComplete={handleRosterRoyaleComplete}
  />
)}

{screen === "roster-royale-recap" && rrRoster && (
  <RosterRoyaleRecapScreen
    roster={rrRoster}
    onPlayAgain={handleStartRosterRoyale}
    onHome={() => setScreen("mode-menu")}
    onChallengeFriend={handleChallengeFriendRosterRoyale}
  />
)}

{screen === "roster-royale-challenge-link" && (
  <RosterRoyaleChallengeLinkScreen
    seed={rrSeed}
    roster={rrRoster}
    onHome={() => setScreen("mode-menu")}
    onPlayAgain={handleStartRosterRoyale}
  />
)}

{screen === "roster-royale-challenge-received" && rrChallengeData && (
  <RosterRoyaleChallengeReceivedScreen onStart={handleRosterRoyaleChallengeAccepted} />
)}

{screen === "roster-royale-recap-challenge" && rrRoster && rrChallengeData && (
  <RosterRoyaleRecapScreen
    roster={rrRoster}
    p1Roster={rrChallengeData.p1Roster}
    isChallenge={true}
    onPlayAgain={handleStartRosterRoyale}
    onHome={() => setScreen("mode-menu")}
  />
)}

      {screen === "setup" && <SetupScreen onStart={handleStart} onBack={() => setScreen("mode-menu")} />}

      {screen === "game-p1" && (
        <GameScreen config={config} playerNum={1} players={gamePlayers} onComplete={handleP1Complete} />
      )}

      {screen === "challenge-link" && (
        <ChallengeLinkScreen config={config} players={gamePlayers} p1Result={p1Result} onHome={goHome} onPlayAgain={() => handleStart({ ...config, seed: null })} />
      )}

      {screen === "challenge-received" && challengeData && (
        <ChallengeReceivedScreen gameData={challengeData.gameData} p1Result={challengeData.p1Result} onStart={handleChallengeAccepted} />
      )}

      {screen === "game-p2" && (
        <GameScreen config={config} playerNum={2} players={gamePlayers} onComplete={handleP2Complete} />
      )}

      {screen === "results" && p1Result && (
        <ResultsScreen
          results={[p1Result]}
          config={config}
          onPlayAgain={() => handleStart({ ...config, seed: null })}
          onHome={goHome}
          isChallenge={false}
        />
      )}

      {screen === "results-challenge" && p1Result && config?._p2Result && (
        <ResultsScreen
          results={[p1Result, config._p2Result]}
          config={config}
          onPlayAgain={() => handleStart({ ...config, _p2Result: undefined, seed: null })}
          onHome={goHome}
          isChallenge={true}
        />
      )}
    </div>
  );
}

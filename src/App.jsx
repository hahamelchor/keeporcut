import { useState, useEffect, useCallback, useMemo } from "react";

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

// Game is encoded as: SEED-POOLID-TOTAL-KEEP (short, readable)
function encodeGame(seed, config) {
  const poolShort = config.poolId.replace("franchise_", "f_").replace("current_", "c_").replace("all_time_", "at_");
  return `${seed}-${poolShort}-${config.totalPlayers}-${config.keepCount}-${config.allowInfo ? 1 : 0}`;
}
function decodeGame(str) {
  try {
    const parts = str.split("-");
    if (parts.length < 5) return null;
    const seed = parseInt(parts[0]);
    const allowInfo = parts[parts.length - 1] === "1";
    const keepCount = parseInt(parts[parts.length - 2]);
    const totalPlayers = parseInt(parts[parts.length - 3]);
    const poolShort = parts.slice(1, parts.length - 3).join("-");
    const poolId = poolShort.replace("f_", "franchise_").replace("c_", "current_").replace("at_", "all_time_");
    return { seed, config: { poolId, totalPlayers, keepCount, allowInfo, mode: "challenge" } };
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
    if (dot > 0) return { game: token.slice(0, dot), p1result: token.slice(dot + 1) };
  }
  return {};
}
function clearURLParams() {
  window.history.replaceState({}, "", "/");
}

// ── NFL Player Database ───────────────────────────────────────────────────────
const NFL_PLAYERS = {
  all_time_greats: [
    { name: "Jerry Rice", pos: "WR", era: "retired", teams: ["SF"], hof: true, peak: "1986–2002" },
    { name: "Tom Brady", pos: "QB", era: "retired", teams: ["NE","TB"], hof: true, peak: "2001–2022" },
    { name: "Lawrence Taylor", pos: "LB", era: "retired", teams: ["NYG"], hof: true, peak: "1981–1993" },
    { name: "Barry Sanders", pos: "RB", era: "retired", teams: ["DET"], hof: true, peak: "1989–1998" },
    { name: "Peyton Manning", pos: "QB", era: "retired", teams: ["IND","DEN"], hof: true, peak: "1998–2015" },
    { name: "Reggie White", pos: "DE", era: "retired", teams: ["PHI","GB"], hof: true, peak: "1985–2000" },
    { name: "Randy Moss", pos: "WR", era: "retired", teams: ["MIN","NE"], hof: true, peak: "1998–2012" },
    { name: "Deion Sanders", pos: "CB", era: "retired", teams: ["ATL","SF","DAL"], hof: true, peak: "1989–2005" },
    { name: "Walter Payton", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1975–1987" },
    { name: "Emmitt Smith", pos: "RB", era: "retired", teams: ["DAL"], hof: true, peak: "1990–2004" },
    { name: "Jim Brown", pos: "RB", era: "retired", teams: ["CLE"], hof: true, peak: "1957–1965" },
    { name: "Joe Montana", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1979–1994" },
    { name: "Dan Marino", pos: "QB", era: "retired", teams: ["MIA"], hof: true, peak: "1983–1999" },
    { name: "John Elway", pos: "QB", era: "retired", teams: ["DEN"], hof: true, peak: "1983–1998" },
    { name: "Rod Woodson", pos: "CB", era: "retired", teams: ["PIT","BAL"], hof: true, peak: "1987–2003" },
    { name: "Bruce Smith", pos: "DE", era: "retired", teams: ["BUF"], hof: true, peak: "1985–2003" },
    { name: "Dick Butkus", pos: "LB", era: "retired", teams: ["CHI"], hof: true, peak: "1965–1973" },
    { name: "Anthony Munoz", pos: "OT", era: "retired", teams: ["CIN"], hof: true, peak: "1980–1992" },
    { name: "Ronnie Lott", pos: "S", era: "retired", teams: ["SF"], hof: true, peak: "1981–1994" },
    { name: "Patrick Mahomes", pos: "QB", era: "active", teams: ["KC"], age: 29, hof: false },
    { name: "Lamar Jackson", pos: "QB", era: "active", teams: ["BAL"], age: 27, hof: false },
    { name: "Justin Jefferson", pos: "WR", era: "active", teams: ["MIN"], age: 26, hof: false },
    { name: "Travis Kelce", pos: "TE", era: "active", teams: ["KC"], age: 35, hof: false },
    { name: "Micah Parsons", pos: "LB", era: "active", teams: ["DAL"], age: 26, hof: false },
  ],
  current_stars: [
    { name: "Patrick Mahomes", pos: "QB", era: "active", teams: ["KC"], age: 29, hof: false },
    { name: "Lamar Jackson", pos: "QB", era: "active", teams: ["BAL"], age: 27, hof: false },
    { name: "Josh Allen", pos: "QB", era: "active", teams: ["BUF"], age: 29, hof: false },
    { name: "Justin Jefferson", pos: "WR", era: "active", teams: ["MIN"], age: 26, hof: false },
    { name: "Tyreek Hill", pos: "WR", era: "active", teams: ["MIA"], age: 32, hof: false },
    { name: "Travis Kelce", pos: "TE", era: "active", teams: ["KC"], age: 35, hof: false },
    { name: "Christian McCaffrey", pos: "RB", era: "active", teams: ["SF"], age: 28, hof: false },
    { name: "Derrick Henry", pos: "RB", era: "active", teams: ["BAL"], age: 31, hof: false },
    { name: "Micah Parsons", pos: "LB", era: "active", teams: ["DAL"], age: 26, hof: false },
    { name: "Myles Garrett", pos: "DE", era: "active", teams: ["CLE"], age: 29, hof: false },
    { name: "CeeDee Lamb", pos: "WR", era: "active", teams: ["DAL"], age: 26, hof: false },
    { name: "Ja'Marr Chase", pos: "WR", era: "active", teams: ["CIN"], age: 25, hof: false },
    { name: "Jalen Hurts", pos: "QB", era: "active", teams: ["PHI"], age: 27, hof: false },
    { name: "Brock Purdy", pos: "QB", era: "active", teams: ["SF"], age: 25, hof: false },
    { name: "Amon-Ra St. Brown", pos: "WR", era: "active", teams: ["DET"], age: 25, hof: false },
    { name: "Sam LaPorta", pos: "TE", era: "active", teams: ["DET"], age: 24, hof: false },
    { name: "Davante Adams", pos: "WR", era: "active", teams: ["LV"], age: 32, hof: false },
    { name: "DeVonta Smith", pos: "WR", era: "active", teams: ["PHI"], age: 28, hof: false },
    { name: "Dak Prescott", pos: "QB", era: "active", teams: ["DAL"], age: 32, hof: false },
    { name: "Tua Tagovailoa", pos: "QB", era: "active", teams: ["MIA"], age: 27, hof: false },
  ],
  hof_only: [
    { name: "Jerry Rice", pos: "WR", era: "retired", teams: ["SF"], hof: true, peak: "1986–2002" },
    { name: "Tom Brady", pos: "QB", era: "retired", teams: ["NE","TB"], hof: true, peak: "2001–2022" },
    { name: "Lawrence Taylor", pos: "LB", era: "retired", teams: ["NYG"], hof: true, peak: "1981–1993" },
    { name: "Barry Sanders", pos: "RB", era: "retired", teams: ["DET"], hof: true, peak: "1989–1998" },
    { name: "Peyton Manning", pos: "QB", era: "retired", teams: ["IND","DEN"], hof: true, peak: "1998–2015" },
    { name: "Reggie White", pos: "DE", era: "retired", teams: ["PHI","GB"], hof: true, peak: "1985–2000" },
    { name: "Randy Moss", pos: "WR", era: "retired", teams: ["MIN","NE"], hof: true, peak: "1998–2012" },
    { name: "Deion Sanders", pos: "CB", era: "retired", teams: ["ATL","SF","DAL"], hof: true, peak: "1989–2005" },
    { name: "Walter Payton", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1975–1987" },
    { name: "Emmitt Smith", pos: "RB", era: "retired", teams: ["DAL"], hof: true, peak: "1990–2004" },
    { name: "Joe Montana", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1979–1994" },
    { name: "Dan Marino", pos: "QB", era: "retired", teams: ["MIA"], hof: true, peak: "1983–1999" },
    { name: "Jim Brown", pos: "RB", era: "retired", teams: ["CLE"], hof: true, peak: "1957–1965" },
    { name: "John Elway", pos: "QB", era: "retired", teams: ["DEN"], hof: true, peak: "1983–1998" },
    { name: "Dick Butkus", pos: "LB", era: "retired", teams: ["CHI"], hof: true, peak: "1965–1973" },
    { name: "LaDainian Tomlinson", pos: "RB", era: "retired", teams: ["SD"], hof: true, peak: "2001–2011" },
    { name: "Adrian Peterson", pos: "RB", era: "retired", teams: ["MIN"], hof: true, peak: "2007–2018" },
    { name: "Terrell Owens", pos: "WR", era: "retired", teams: ["SF","PHI","DAL"], hof: true, peak: "1996–2010" },
    { name: "Brett Favre", pos: "QB", era: "retired", teams: ["GB"], hof: true, peak: "1992–2007" },
    { name: "Bruce Smith", pos: "DE", era: "retired", teams: ["BUF"], hof: true, peak: "1985–2003" },
  ],
  qbs_only: [
    { name: "Tom Brady", pos: "QB", era: "retired", teams: ["NE","TB"], hof: true, peak: "2001–2022" },
    { name: "Peyton Manning", pos: "QB", era: "retired", teams: ["IND","DEN"], hof: true, peak: "1998–2015" },
    { name: "Joe Montana", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1979–1994" },
    { name: "Dan Marino", pos: "QB", era: "retired", teams: ["MIA"], hof: true, peak: "1983–1999" },
    { name: "John Elway", pos: "QB", era: "retired", teams: ["DEN"], hof: true, peak: "1983–1998" },
    { name: "Brett Favre", pos: "QB", era: "retired", teams: ["GB"], hof: true, peak: "1992–2007" },
    { name: "Patrick Mahomes", pos: "QB", era: "active", teams: ["KC"], age: 29, hof: false },
    { name: "Lamar Jackson", pos: "QB", era: "active", teams: ["BAL"], age: 27, hof: false },
    { name: "Josh Allen", pos: "QB", era: "active", teams: ["BUF"], age: 29, hof: false },
    { name: "Aaron Rodgers", pos: "QB", era: "active", teams: ["GB","NYJ"], age: 42, hof: false },
    { name: "Jalen Hurts", pos: "QB", era: "active", teams: ["PHI"], age: 27, hof: false },
    { name: "Drew Brees", pos: "QB", era: "retired", teams: ["NO","SD"], hof: true, peak: "2001–2020" },
    { name: "Steve Young", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1984–1999" },
    { name: "Brock Purdy", pos: "QB", era: "active", teams: ["SF"], age: 25, hof: false },
    { name: "Dak Prescott", pos: "QB", era: "active", teams: ["DAL"], age: 32, hof: false },
  ],
  rbs_only: [
    { name: "Barry Sanders", pos: "RB", era: "retired", teams: ["DET"], hof: true, peak: "1989–1998" },
    { name: "Walter Payton", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1975–1987" },
    { name: "Emmitt Smith", pos: "RB", era: "retired", teams: ["DAL"], hof: true, peak: "1990–2004" },
    { name: "Jim Brown", pos: "RB", era: "retired", teams: ["CLE"], hof: true, peak: "1957–1965" },
    { name: "Eric Dickerson", pos: "RB", era: "retired", teams: ["LA","IND"], hof: true, peak: "1983–1993" },
    { name: "Earl Campbell", pos: "RB", era: "retired", teams: ["HOU"], hof: true, peak: "1978–1985" },
    { name: "Christian McCaffrey", pos: "RB", era: "active", teams: ["SF"], age: 28, hof: false },
    { name: "Derrick Henry", pos: "RB", era: "active", teams: ["BAL"], age: 31, hof: false },
    { name: "Adrian Peterson", pos: "RB", era: "retired", teams: ["MIN"], hof: true, peak: "2007–2018" },
    { name: "LaDainian Tomlinson", pos: "RB", era: "retired", teams: ["SD"], hof: true, peak: "2001–2011" },
    { name: "Marshall Faulk", pos: "RB", era: "retired", teams: ["IND","STL"], hof: true, peak: "1994–2005" },
    { name: "Gale Sayers", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1965–1971" },
  ],
  wrs_only: [
    { name: "Jerry Rice", pos: "WR", era: "retired", teams: ["SF"], hof: true, peak: "1986–2002" },
    { name: "Randy Moss", pos: "WR", era: "retired", teams: ["MIN","NE"], hof: true, peak: "1998–2012" },
    { name: "Terrell Owens", pos: "WR", era: "retired", teams: ["SF","PHI","DAL"], hof: true, peak: "1996–2010" },
    { name: "Calvin Johnson", pos: "WR", era: "retired", teams: ["DET"], hof: true, peak: "2007–2015" },
    { name: "Justin Jefferson", pos: "WR", era: "active", teams: ["MIN"], age: 26, hof: false },
    { name: "Tyreek Hill", pos: "WR", era: "active", teams: ["MIA"], age: 32, hof: false },
    { name: "Davante Adams", pos: "WR", era: "active", teams: ["LV"], age: 32, hof: false },
    { name: "CeeDee Lamb", pos: "WR", era: "active", teams: ["DAL"], age: 26, hof: false },
    { name: "Ja'Marr Chase", pos: "WR", era: "active", teams: ["CIN"], age: 25, hof: false },
    { name: "Cris Carter", pos: "WR", era: "retired", teams: ["MIN"], hof: true, peak: "1987–2002" },
    { name: "Michael Irvin", pos: "WR", era: "retired", teams: ["DAL"], hof: true, peak: "1988–1999" },
    { name: "Steve Largent", pos: "WR", era: "retired", teams: ["SEA"], hof: true, peak: "1976–1989" },
  ],
  current_over_30: [
    { name: "Travis Kelce", pos: "TE", era: "active", teams: ["KC"], age: 35, hof: false },
    { name: "Tyreek Hill", pos: "WR", era: "active", teams: ["MIA"], age: 32, hof: false },
    { name: "Davante Adams", pos: "WR", era: "active", teams: ["LV"], age: 32, hof: false },
    { name: "Derrick Henry", pos: "RB", era: "active", teams: ["BAL"], age: 31, hof: false },
    { name: "Dak Prescott", pos: "QB", era: "active", teams: ["DAL"], age: 32, hof: false },
    { name: "Aaron Rodgers", pos: "QB", era: "active", teams: ["NYJ"], age: 42, hof: false },
    { name: "DeAndre Hopkins", pos: "WR", era: "active", teams: ["TEN"], age: 33, hof: false },
    { name: "Adam Thielen", pos: "WR", era: "active", teams: ["CAR"], age: 35, hof: false },
    { name: "Zack Martin", pos: "OG", era: "active", teams: ["DAL"], age: 34, hof: false },
    { name: "Matt Ryan", pos: "QB", era: "retired", teams: ["ATL"], age: 39, hof: false },
    { name: "Julio Jones", pos: "WR", era: "retired", teams: ["ATL"], age: 36, hof: false },
    { name: "Jason Kelce", pos: "C", era: "retired", teams: ["PHI"], age: 37, hof: false },
  ],
  fan_favorites: [
    { name: "Nick Foles", pos: "QB", era: "retired", teams: ["PHI","STL","JAX","CHI"], hof: false, peak: "2017–2019", fanFave: true },
    { name: "Tim Tebow", pos: "QB", era: "retired", teams: ["DEN","NYJ"], hof: false, peak: "2010–2012", fanFave: true },
    { name: "Marshawn Lynch", pos: "RB", era: "retired", teams: ["SEA","BUF","OAK"], hof: false, peak: "2011–2015", fanFave: true },
    { name: "Antonio Brown", pos: "WR", era: "retired", teams: ["PIT","OAK","NE","TB"], hof: false, peak: "2013–2019", fanFave: true },
    { name: "Odell Beckham Jr.", pos: "WR", era: "active", teams: ["NYG","CLE","LAR","BAL"], age: 32, hof: false, fanFave: true },
    { name: "Rob Gronkowski", pos: "TE", era: "retired", teams: ["NE","TB"], hof: false, peak: "2010–2021", fanFave: true },
    { name: "Aaron Rodgers", pos: "QB", era: "active", teams: ["GB","NYJ"], age: 42, hof: false, fanFave: true },
    { name: "Bo Jackson", pos: "RB", era: "retired", teams: ["LA Rams"], hof: false, peak: "1987–1990", fanFave: true },
    { name: "Michael Vick", pos: "QB", era: "retired", teams: ["ATL","PHI"], hof: false, peak: "2002–2010", fanFave: true },
    { name: "Baker Mayfield", pos: "QB", era: "active", teams: ["TB","CLE","CAR","LAR"], age: 30, hof: false, fanFave: true },
    { name: "Cam Newton", pos: "QB", era: "retired", teams: ["CAR","NE"], hof: false, peak: "2011–2019", fanFave: true },
    { name: "JJ Watt", pos: "DE", era: "retired", teams: ["HOU","ARI"], hof: false, peak: "2011–2022", fanFave: true },
    { name: "Ray Lewis", pos: "LB", era: "retired", teams: ["BAL"], hof: true, peak: "1996–2012", fanFave: true },
    { name: "Terrell Davis", pos: "RB", era: "retired", teams: ["DEN"], hof: true, peak: "1995–2001", fanFave: true },
    { name: "Steve McNair", pos: "QB", era: "retired", teams: ["TEN","BAL"], hof: false, peak: "1995–2007", fanFave: true },
    { name: "Chad Johnson", pos: "WR", era: "retired", teams: ["CIN","NE"], hof: false, peak: "2003–2011", fanFave: true },
    { name: "Brandon Marshall", pos: "WR", era: "retired", teams: ["DEN","MIA","CHI","NYJ","NYG"], hof: false, peak: "2008–2016", fanFave: true },
    { name: "Eli Manning", pos: "QB", era: "retired", teams: ["NYG"], hof: false, peak: "2004–2019", fanFave: true },
    { name: "Frank Gore", pos: "RB", era: "retired", teams: ["SF","IND","MIA"], hof: false, peak: "2006–2019", fanFave: true },
    { name: "DeSean Jackson", pos: "WR", era: "retired", teams: ["PHI","WAS","TB"], hof: false, peak: "2008–2021", fanFave: true },
  ],
  // ── Franchise All-Time Greats ──
  franchise_cowboys: [
    { name: "Emmitt Smith", pos: "RB", era: "retired", teams: ["DAL"], hof: true, peak: "1990–2002" },
    { name: "Troy Aikman", pos: "QB", era: "retired", teams: ["DAL"], hof: true, peak: "1989–2000" },
    { name: "Michael Irvin", pos: "WR", era: "retired", teams: ["DAL"], hof: true, peak: "1988–1999" },
    { name: "Deion Sanders", pos: "CB", era: "retired", teams: ["DAL"], hof: true, peak: "1995–1999" },
    { name: "Roger Staubach", pos: "QB", era: "retired", teams: ["DAL"], hof: true, peak: "1969–1979" },
    { name: "Bob Lilly", pos: "DT", era: "retired", teams: ["DAL"], hof: true, peak: "1961–1974" },
    { name: "Tony Dorsett", pos: "RB", era: "retired", teams: ["DAL"], hof: true, peak: "1977–1987" },
    { name: "Dak Prescott", pos: "QB", era: "active", teams: ["DAL"], age: 32, hof: false },
    { name: "CeeDee Lamb", pos: "WR", era: "active", teams: ["DAL"], age: 26, hof: false },
    { name: "Micah Parsons", pos: "LB", era: "active", teams: ["DAL"], age: 26, hof: false },
    { name: "Zack Martin", pos: "OG", era: "active", teams: ["DAL"], age: 34, hof: false },
    { name: "DeMarcus Ware", pos: "LB", era: "retired", teams: ["DAL","DEN"], hof: true, peak: "2005–2016" },
  ],
  franchise_patriots: [
    { name: "Tom Brady", pos: "QB", era: "retired", teams: ["NE"], hof: true, peak: "2001–2019" },
    { name: "Rob Gronkowski", pos: "TE", era: "retired", teams: ["NE"], hof: false, peak: "2010–2018" },
    { name: "Randy Moss", pos: "WR", era: "retired", teams: ["NE"], hof: true, peak: "2007–2010" },
    { name: "Ty Law", pos: "CB", era: "retired", teams: ["NE"], hof: true, peak: "1995–2004" },
    { name: "Mike Vrabel", pos: "LB", era: "retired", teams: ["NE"], hof: false, peak: "2001–2008" },
    { name: "Wes Welker", pos: "WR", era: "retired", teams: ["NE"], hof: false, peak: "2007–2012", fanFave: true },
    { name: "Adam Vinatieri", pos: "K", era: "retired", teams: ["NE","IND"], hof: true, peak: "1996–2019" },
    { name: "Richard Seymour", pos: "DT", era: "retired", teams: ["NE"], hof: true, peak: "2001–2008" },
    { name: "Julian Edelman", pos: "WR", era: "retired", teams: ["NE"], hof: false, peak: "2009–2021", fanFave: true },
    { name: "Corey Dillon", pos: "RB", era: "retired", teams: ["NE"], hof: false, peak: "2004–2006", fanFave: true },
    { name: "Logan Mankins", pos: "OG", era: "retired", teams: ["NE"], hof: true, peak: "2005–2013" },
    { name: "Nick Folk", pos: "K", era: "active", teams: ["NE"], age: 39, hof: false, fanFave: true },
  ],
  franchise_49ers: [
    { name: "Jerry Rice", pos: "WR", era: "retired", teams: ["SF"], hof: true, peak: "1986–2000" },
    { name: "Joe Montana", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1979–1992" },
    { name: "Steve Young", pos: "QB", era: "retired", teams: ["SF"], hof: true, peak: "1987–1999" },
    { name: "Ronnie Lott", pos: "S", era: "retired", teams: ["SF"], hof: true, peak: "1981–1990" },
    { name: "Roger Craig", pos: "RB", era: "retired", teams: ["SF"], hof: true, peak: "1983–1990" },
    { name: "Patrick Willis", pos: "LB", era: "retired", teams: ["SF"], hof: true, peak: "2007–2014" },
    { name: "Bryant Young", pos: "DT", era: "retired", teams: ["SF"], hof: true, peak: "1994–2007" },
    { name: "Christian McCaffrey", pos: "RB", era: "active", teams: ["SF"], age: 28, hof: false },
    { name: "Brock Purdy", pos: "QB", era: "active", teams: ["SF"], age: 25, hof: false, fanFave: true },
    { name: "Deebo Samuel", pos: "WR", era: "active", teams: ["SF"], age: 29, hof: false },
    { name: "Fred Warner", pos: "LB", era: "active", teams: ["SF"], age: 28, hof: false },
    { name: "Nick Bosa", pos: "DE", era: "active", teams: ["SF"], age: 27, hof: false },
  ],
  franchise_steelers: [
    { name: "Terry Bradshaw", pos: "QB", era: "retired", teams: ["PIT"], hof: true, peak: "1970–1983" },
    { name: "Franco Harris", pos: "RB", era: "retired", teams: ["PIT"], hof: true, peak: "1972–1984" },
    { name: "Lynn Swann", pos: "WR", era: "retired", teams: ["PIT"], hof: true, peak: "1974–1982" },
    { name: "Mean Joe Greene", pos: "DT", era: "retired", teams: ["PIT"], hof: true, peak: "1969–1981" },
    { name: "Rod Woodson", pos: "CB", era: "retired", teams: ["PIT"], hof: true, peak: "1987–1996" },
    { name: "Jerome Bettis", pos: "RB", era: "retired", teams: ["PIT"], hof: true, peak: "1996–2005", fanFave: true },
    { name: "Hines Ward", pos: "WR", era: "retired", teams: ["PIT"], hof: true, peak: "1998–2011", fanFave: true },
    { name: "Ben Roethlisberger", pos: "QB", era: "retired", teams: ["PIT"], hof: false, peak: "2004–2021" },
    { name: "Antonio Brown", pos: "WR", era: "retired", teams: ["PIT"], hof: false, peak: "2013–2018", fanFave: true },
    { name: "Le'Veon Bell", pos: "RB", era: "retired", teams: ["PIT"], hof: false, peak: "2013–2018", fanFave: true },
    { name: "Troy Polamalu", pos: "S", era: "retired", teams: ["PIT"], hof: true, peak: "2003–2014" },
    { name: "TJ Watt", pos: "LB", era: "active", teams: ["PIT"], age: 30, hof: false },
  ],
  franchise_packers: [
    { name: "Bart Starr", pos: "QB", era: "retired", teams: ["GB"], hof: true, peak: "1956–1971" },
    { name: "Brett Favre", pos: "QB", era: "retired", teams: ["GB"], hof: true, peak: "1992–2007" },
    { name: "Aaron Rodgers", pos: "QB", era: "active", teams: ["GB"], age: 42, hof: false },
    { name: "Reggie White", pos: "DE", era: "retired", teams: ["GB"], hof: true, peak: "1993–1998" },
    { name: "Ray Nitschke", pos: "LB", era: "retired", teams: ["GB"], hof: true, peak: "1958–1972" },
    { name: "Don Hutson", pos: "WR", era: "retired", teams: ["GB"], hof: true, peak: "1935–1945" },
    { name: "Jordy Nelson", pos: "WR", era: "retired", teams: ["GB"], hof: false, peak: "2008–2017", fanFave: true },
    { name: "Davante Adams", pos: "WR", era: "active", teams: ["GB"], age: 32, hof: false },
    { name: "Antonio Freeman", pos: "WR", era: "retired", teams: ["GB"], hof: false, peak: "1995–2002", fanFave: true },
    { name: "AJ Hawk", pos: "LB", era: "retired", teams: ["GB"], hof: false, peak: "2006–2015", fanFave: true },
    { name: "Jordan Love", pos: "QB", era: "active", teams: ["GB"], age: 26, hof: false },
    { name: "Donald Driver", pos: "WR", era: "retired", teams: ["GB"], hof: false, peak: "1999–2012", fanFave: true },
  ],
  franchise_chiefs: [
    { name: "Patrick Mahomes", pos: "QB", era: "active", teams: ["KC"], age: 29, hof: false },
    { name: "Travis Kelce", pos: "TE", era: "active", teams: ["KC"], age: 35, hof: false },
    { name: "Tyreek Hill", pos: "WR", era: "retired", teams: ["KC"], hof: false, peak: "2016–2021", fanFave: true },
    { name: "Len Dawson", pos: "QB", era: "retired", teams: ["KC"], hof: true, peak: "1962–1975" },
    { name: "Derrick Thomas", pos: "LB", era: "retired", teams: ["KC"], hof: true, peak: "1989–1999" },
    { name: "Willie Lanier", pos: "LB", era: "retired", teams: ["KC"], hof: true, peak: "1967–1977" },
    { name: "Tony Gonzalez", pos: "TE", era: "retired", teams: ["KC"], hof: true, peak: "1997–2013" },
    { name: "Christian Okoye", pos: "RB", era: "retired", teams: ["KC"], hof: false, peak: "1987–1992", fanFave: true },
    { name: "Priest Holmes", pos: "RB", era: "retired", teams: ["KC"], hof: false, peak: "2001–2007", fanFave: true },
    { name: "Marcus Allen", pos: "RB", era: "retired", teams: ["KC"], hof: true, peak: "1993–1997" },
    { name: "Jamaal Charles", pos: "RB", era: "retired", teams: ["KC"], hof: false, peak: "2008–2016", fanFave: true },
    { name: "Chris Jones", pos: "DT", era: "active", teams: ["KC"], age: 30, hof: false },
  ],
  franchise_eagles: [
    { name: "Reggie White", pos: "DE", era: "retired", teams: ["PHI"], hof: true, peak: "1985–1992" },
    { name: "Donovan McNabb", pos: "QB", era: "retired", teams: ["PHI"], hof: false, peak: "1999–2009", fanFave: true },
    { name: "Brian Dawkins", pos: "S", era: "retired", teams: ["PHI"], hof: true, peak: "1996–2008", fanFave: true },
    { name: "Nick Foles", pos: "QB", era: "retired", teams: ["PHI"], hof: false, peak: "2017–2018", fanFave: true },
    { name: "Jalen Hurts", pos: "QB", era: "active", teams: ["PHI"], age: 27, hof: false },
    { name: "Jason Kelce", pos: "C", era: "retired", teams: ["PHI"], hof: false, peak: "2011–2023", fanFave: true },
    { name: "DeVonta Smith", pos: "WR", era: "active", teams: ["PHI"], age: 28, hof: false },
    { name: "AJ Brown", pos: "WR", era: "active", teams: ["PHI"], age: 28, hof: false },
    { name: "Harold Carmichael", pos: "WR", era: "retired", teams: ["PHI"], hof: true, peak: "1971–1983" },
    { name: "Chuck Bednarik", pos: "LB", era: "retired", teams: ["PHI"], hof: true, peak: "1949–1962" },
    { name: "Wilbert Montgomery", pos: "RB", era: "retired", teams: ["PHI"], hof: false, peak: "1977–1984", fanFave: true },
    { name: "DeSean Jackson", pos: "WR", era: "retired", teams: ["PHI"], hof: false, peak: "2008–2019", fanFave: true },
  ],
  franchise_ravens: [
    { name: "Ray Lewis", pos: "LB", era: "retired", teams: ["BAL"], hof: true, peak: "1996–2012" },
    { name: "Ed Reed", pos: "S", era: "retired", teams: ["BAL"], hof: true, peak: "2002–2013" },
    { name: "Jonathan Ogden", pos: "OT", era: "retired", teams: ["BAL"], hof: true, peak: "1996–2007" },
    { name: "Lamar Jackson", pos: "QB", era: "active", teams: ["BAL"], age: 27, hof: false },
    { name: "Derrick Henry", pos: "RB", era: "active", teams: ["BAL"], age: 31, hof: false },
    { name: "Terrell Suggs", pos: "LB", era: "retired", teams: ["BAL"], hof: false, peak: "2003–2019", fanFave: true },
    { name: "Todd Heap", pos: "TE", era: "retired", teams: ["BAL"], hof: false, peak: "2001–2010", fanFave: true },
    { name: "Jamal Lewis", pos: "RB", era: "retired", teams: ["BAL"], hof: false, peak: "2000–2006", fanFave: true },
    { name: "Mark Andrews", pos: "TE", era: "active", teams: ["BAL"], age: 29, hof: false },
    { name: "Haloti Ngata", pos: "DT", era: "retired", teams: ["BAL"], hof: true, peak: "2006–2014" },
    { name: "Joe Flacco", pos: "QB", era: "retired", teams: ["BAL"], hof: false, peak: "2008–2018", fanFave: true },
    { name: "Shannon Sharpe", pos: "TE", era: "retired", teams: ["BAL","DEN"], hof: true, peak: "1990–2003" },
  ],
  franchise_seahawks: [
    { name: "Marshawn Lynch", pos: "RB", era: "retired", teams: ["SEA"], hof: false, peak: "2010–2015", fanFave: true },
    { name: "Russell Wilson", pos: "QB", era: "active", teams: ["SEA","DEN","PIT"], age: 36, hof: false },
    { name: "Richard Sherman", pos: "CB", era: "retired", teams: ["SEA"], hof: false, peak: "2011–2017", fanFave: true },
    { name: "Earl Thomas", pos: "S", era: "retired", teams: ["SEA"], hof: false, peak: "2010–2019", fanFave: true },
    { name: "Steve Largent", pos: "WR", era: "retired", teams: ["SEA"], hof: true, peak: "1976–1989" },
    { name: "Kenny Easley", pos: "S", era: "retired", teams: ["SEA"], hof: true, peak: "1981–1987" },
    { name: "Cortez Kennedy", pos: "DT", era: "retired", teams: ["SEA"], hof: true, peak: "1990–2000" },
    { name: "Bobby Wagner", pos: "LB", era: "active", teams: ["SEA"], age: 34, hof: false, fanFave: true },
    { name: "DK Metcalf", pos: "WR", era: "active", teams: ["SEA"], age: 27, hof: false },
    { name: "Walter Jones", pos: "OT", era: "retired", teams: ["SEA"], hof: true, peak: "1997–2008" },
    { name: "Marcus Trufant", pos: "CB", era: "retired", teams: ["SEA"], hof: false, peak: "2003–2012", fanFave: true },
    { name: "Matt Hasselbeck", pos: "QB", era: "retired", teams: ["SEA"], hof: false, peak: "2001–2010", fanFave: true },
  ],
  franchise_bears: [
    { name: "Walter Payton", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1975–1987" },
    { name: "Dick Butkus", pos: "LB", era: "retired", teams: ["CHI"], hof: true, peak: "1965–1973" },
    { name: "Gale Sayers", pos: "RB", era: "retired", teams: ["CHI"], hof: true, peak: "1965–1971" },
    { name: "Mike Singletary", pos: "LB", era: "retired", teams: ["CHI"], hof: true, peak: "1981–1992" },
    { name: "Brian Urlacher", pos: "LB", era: "retired", teams: ["CHI"], hof: true, peak: "2000–2012", fanFave: true },
    { name: "Devin Hester", pos: "KR", era: "retired", teams: ["CHI"], hof: true, peak: "2006–2016", fanFave: true },
    { name: "Sid Luckman", pos: "QB", era: "retired", teams: ["CHI"], hof: true, peak: "1939–1950" },
    { name: "Alshon Jeffery", pos: "WR", era: "retired", teams: ["CHI"], hof: false, peak: "2012–2018", fanFave: true },
    { name: "Jay Cutler", pos: "QB", era: "retired", teams: ["CHI"], hof: false, peak: "2009–2016", fanFave: true },
    { name: "Caleb Williams", pos: "QB", era: "active", teams: ["CHI"], age: 23, hof: false },
    { name: "D.J. Moore", pos: "WR", era: "active", teams: ["CHI"], age: 27, hof: false },
    { name: "Jim McMahon", pos: "QB", era: "retired", teams: ["CHI"], hof: false, peak: "1982–1988", fanFave: true },
  ],
  franchise_broncos: [
    { name: "John Elway", pos: "QB", era: "retired", teams: ["DEN"], hof: true, peak: "1983–1998" },
    { name: "Peyton Manning", pos: "QB", era: "retired", teams: ["DEN"], hof: true, peak: "2012–2015" },
    { name: "Terrell Davis", pos: "RB", era: "retired", teams: ["DEN"], hof: true, peak: "1995–2001", fanFave: true },
    { name: "Shannon Sharpe", pos: "TE", era: "retired", teams: ["DEN"], hof: true, peak: "1990–2003" },
    { name: "Rod Smith", pos: "WR", era: "retired", teams: ["DEN"], hof: false, peak: "1995–2006", fanFave: true },
    { name: "DeMarcus Ware", pos: "LB", era: "retired", teams: ["DEN"], hof: true, peak: "2014–2016" },
    { name: "Von Miller", pos: "LB", era: "active", teams: ["DEN","BUF","LAR"], age: 36, hof: false, fanFave: true },
    { name: "Champ Bailey", pos: "CB", era: "retired", teams: ["DEN"], hof: true, peak: "2004–2013" },
    { name: "Floyd Little", pos: "RB", era: "retired", teams: ["DEN"], hof: true, peak: "1967–1975" },
    { name: "Demaryius Thomas", pos: "WR", era: "retired", teams: ["DEN"], hof: false, peak: "2010–2018", fanFave: true },
    { name: "Tim Tebow", pos: "QB", era: "retired", teams: ["DEN"], hof: false, peak: "2010–2011", fanFave: true },
    { name: "Karl Mecklenburg", pos: "LB", era: "retired", teams: ["DEN"], hof: false, peak: "1983–1994", fanFave: true },
  ],
  franchise_giants: [
    { name: "Lawrence Taylor", pos: "LB", era: "retired", teams: ["NYG"], hof: true, peak: "1981–1993" },
    { name: "Michael Strahan", pos: "DE", era: "retired", teams: ["NYG"], hof: true, peak: "1993–2007", fanFave: true },
    { name: "Eli Manning", pos: "QB", era: "retired", teams: ["NYG"], hof: false, peak: "2004–2019", fanFave: true },
    { name: "Frank Gifford", pos: "RB", era: "retired", teams: ["NYG"], hof: true, peak: "1952–1964" },
    { name: "Sam Huff", pos: "LB", era: "retired", teams: ["NYG"], hof: true, peak: "1956–1964" },
    { name: "Phil Simms", pos: "QB", era: "retired", teams: ["NYG"], hof: false, peak: "1979–1993", fanFave: true },
    { name: "Odell Beckham Jr.", pos: "WR", era: "active", teams: ["NYG","CLE","LAR"], age: 32, hof: false, fanFave: true },
    { name: "Tiki Barber", pos: "RB", era: "retired", teams: ["NYG"], hof: false, peak: "1997–2006", fanFave: true },
    { name: "Carl Banks", pos: "LB", era: "retired", teams: ["NYG"], hof: false, peak: "1984–1995", fanFave: true },
    { name: "Jeremy Shockey", pos: "TE", era: "retired", teams: ["NYG"], hof: false, peak: "2002–2010", fanFave: true },
    { name: "Plaxico Burress", pos: "WR", era: "retired", teams: ["NYG"], hof: false, peak: "2005–2012", fanFave: true },
    { name: "Amani Toomer", pos: "WR", era: "retired", teams: ["NYG"], hof: false, peak: "1996–2007", fanFave: true },
  ],
};

// ── Pool Options ──────────────────────────────────────────────────────────────
const POOL_GROUPS = [
  {
    label: "🌐 General",
    options: [
      { id: "all_time_greats", label: "All-Time Greats", desc: "Legends from every era" },
      { id: "current_stars", label: "Current Stars", desc: "Today's best players" },
      { id: "hof_only", label: "Hall of Famers", desc: "Only the immortals" },
      { id: "fan_favorites", label: "Fan Favorites", desc: "Beloved & controversial players" },
      { id: "current_over_30", label: "Active Over 30", desc: "Veterans still playing" },
    ]
  },
  {
    label: "📍 Position",
    options: [
      { id: "qbs_only", label: "QBs Only", desc: "Quarterbacks across history" },
      { id: "rbs_only", label: "RBs Only", desc: "Running backs across history" },
      { id: "wrs_only", label: "WRs Only", desc: "Wide receivers across history" },
    ]
  },
  {
    label: "🏟️ Franchise All-Time Greats",
    options: [
      { id: "franchise_cowboys", label: "Dallas Cowboys", desc: "America's Team" },
      { id: "franchise_patriots", label: "New England Patriots", desc: "Dynasty era & legends" },
      { id: "franchise_49ers", label: "San Francisco 49ers", desc: "The dynasty & beyond" },
      { id: "franchise_steelers", label: "Pittsburgh Steelers", desc: "Steel Curtain era & more" },
      { id: "franchise_packers", label: "Green Bay Packers", desc: "Titletown legends" },
      { id: "franchise_chiefs", label: "Kansas City Chiefs", desc: "From Len Dawson to Mahomes" },
      { id: "franchise_eagles", label: "Philadelphia Eagles", desc: "From Reggie White to Hurts" },
      { id: "franchise_ravens", label: "Baltimore Ravens", desc: "Ray Lewis & beyond" },
      { id: "franchise_seahawks", label: "Seattle Seahawks", desc: "LOB era & franchise icons" },
      { id: "franchise_bears", label: "Chicago Bears", desc: "Monsters of the Midway" },
      { id: "franchise_broncos", label: "Denver Broncos", desc: "Elway, Manning & more" },
      { id: "franchise_giants", label: "New York Giants", desc: "LT, Eli & franchise greats" },
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
        const res = await fetch("https://api.anthropic.com/v1/messages", {
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
          {player.peak && <span style={{ background: "#2a2a4a", color: "#a0c4ff", fontSize: "11px", padding: "3px 8px", borderRadius: "4px" }}>Peak: {player.peak}</span>}
          {player.age && <span style={{ background: "#2a2a4a", color: "#a0c4ff", fontSize: "11px", padding: "3px 8px", borderRadius: "4px" }}>Age: {player.age}</span>}
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

// ── Setup Screen ──────────────────────────────────────────────────────────────
function SetupScreen({ onStart }) {
  const [mode, setMode] = useState(null);
  const [poolId, setPoolId] = useState("all_time_greats");
  const [totalPlayers, setTotalPlayers] = useState(8);
  const [keepCount, setKeepCount] = useState(3);
  const [allowInfo, setAllowInfo] = useState(true);
  const [poolOpen, setPoolOpen] = useState(false);

  const selectedPool = ALL_POOL_OPTIONS.find(o => o.id === poolId);
  const maxKeep = totalPlayers - 1;

  return (
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px" }}>
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

// ── Challenge Link Screen ─────────────────────────────────────────────────────
function ChallengeLinkScreen({ config, players, p1Result, onHome }) {
  const [copied, setCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);

  const gameCode = useMemo(() => encodeGame(config.seed, config), [config]);
  const p1Code = useMemo(() => encodeResult(p1Result.kept, p1Result.cut, players), [p1Result, players]);
  const challengeURL = buildChallengeURL(gameCode, p1Code);

  const smsBody = `🏈 NFL Keep or Cut — I drafted my squad, now it's your turn!\n\nSame pool of players, keep ${config.keepCount} of ${config.totalPlayers}. Who do YOU keep?\n\n${challengeURL}`;

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

      <button onClick={onHome} style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>🏠 Back to Home</button>
    </div>
  );
}

// ── Results Screen ────────────────────────────────────────────────────────────
function ResultsScreen({ results, config, onPlayAgain, onHome, isChallenge = false }) {
  const [copied, setCopied] = useState(false);
  const p1 = results[0];
  const p2 = results[1];
  const poolLabel = ALL_POOL_OPTIONS.find(o => o.id === config.poolId)?.label || config.poolId;

  const shareText = isChallenge && p2
    ? `🏈 NFL Keep or Cut — Head-to-Head Results!\n\nPool: ${poolLabel} · Keep ${config.keepCount} of ${config.totalPlayers}\n\n👤 Player 1 kept: ${p1.kept.map(p => p.name).join(", ")}\n⚔️ Player 2 kept: ${p2.kept.map(p => p.name).join(", ")}\n\nWho had the better squad? 🔥`
    : `🏈 NFL Keep or Cut\n\nPool: ${poolLabel} · Keeping ${config.keepCount} of ${config.totalPlayers}\n\n✅ Kept: ${p1.kept.map(p => p.name).join(", ")}\n❌ Cut: ${p1.cut.map(p => p.name).join(", ")}\n\nWho would YOU keep? 🔥`;

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
        <button onClick={onHome} style={{ background: "#1a1a2e", border: "1px solid #2d2d4a", color: "#888", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>🏠 Home</button>
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
  const [challengeData, setChallengeData] = useState(null); // { gameData, p1Result }

  // On mount, check URL for challenge
  useEffect(() => {
    const { game, p1result } = getURLParams();
    if (game && p1result) {
      const gameData = decodeGame(game);
      if (gameData) {
        const pool = NFL_PLAYERS[gameData.config.poolId] || NFL_PLAYERS.all_time_greats;
        const allPlayers = seededShuffle(pool, gameData.seed).slice(0, gameData.config.totalPlayers);
        const p1 = decodeResult(p1result, allPlayers);
        if (p1) {
          setChallengeData({ gameData, p1Result: p1, allPlayers });
          setScreen("challenge-received");
          return;
        }
      }
    }
    setScreen("setup");
  }, []);

  const handleStart = (cfg) => {
    const seed = cfg.seed || (Math.floor(Math.random() * 2147483647) + 1);
    const cfgWithSeed = { ...cfg, seed };
    setConfig(cfgWithSeed);
    const pool = NFL_PLAYERS[cfg.poolId] || NFL_PLAYERS.all_time_greats;
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

      {screen === "setup" && <SetupScreen onStart={handleStart} />}

      {screen === "game-p1" && (
        <GameScreen config={config} playerNum={1} players={gamePlayers} onComplete={handleP1Complete} />
      )}

      {screen === "challenge-link" && (
        <ChallengeLinkScreen config={config} players={gamePlayers} p1Result={p1Result} onHome={goHome} />
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
          onPlayAgain={() => handleStart(config)}
          onHome={goHome}
          isChallenge={false}
        />
      )}

      {screen === "results-challenge" && p1Result && config?._p2Result && (
        <ResultsScreen
          results={[p1Result, config._p2Result]}
          config={config}
          onPlayAgain={() => handleStart({ ...config, _p2Result: undefined })}
          onHome={goHome}
          isChallenge={true}
        />
      )}
    </div>
  );
}

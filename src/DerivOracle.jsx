/* eslint-disable */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Area, AreaChart, Cell
} from "recharts";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || "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";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OR_KEY = process.env.REACT_APP_OPENROUTER_KEY || "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";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const OR_MODEL = "deepseek/deepseek-r1:free";

// ── DERIV CONFIG ──────────────────────────────────────────────────────────────
const DERIV_APP_ID = process.env.REACT_APP_DERIV_APP_ID || "1089";
// Token loaded from env — never hardcode a live PAT here
const DERIV_TOKEN_DEFAULT = process.env.REACT_APP_DERIV_TOKEN || "";
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

const SYMBOLS = [
  { id: "R_10",       label: "Volatility 10",    short: "V10"   },
  { id: "R_25",       label: "Volatility 25",    short: "V25"   },
  { id: "R_50",       label: "Volatility 50",    short: "V50"   },
  { id: "R_75",       label: "Volatility 75",    short: "V75"   },
  { id: "R_100",      label: "Volatility 100",   short: "V100"  },
  { id: "1HZ10V",     label: "Volatility 10(1s)",short: "V10s"  },
  { id: "1HZ100V",    label: "Volatility 100(1s)",short:"V100s" },
  { id: "RDBEAR",     label: "Bear Market",      short: "BEAR"  },
  { id: "RDBULL",     label: "Bull Market",      short: "BULL"  },
  { id: "JD10",       label: "Jump 10",          short: "J10"   },
  { id: "JD25",       label: "Jump 25",          short: "J25"   },
  { id: "JD50",       label: "Jump 50",          short: "J50"   },
  { id: "JD75",       label: "Jump 75",          short: "J75"   },
  { id: "JD100",      label: "Jump 100",         short: "J100"  },
];

// ── ANALYSIS HELPERS ──────────────────────────────────────────────────────────
function getLastDigits(ticks) {
  return ticks.map(t => {
    const s = parseFloat(t).toFixed(2);
    return parseInt(s[s.length - 1]);
  });
}
function getDigitFrequency(digits) {
  const freq = Array(10).fill(0);
  digits.forEach(d => freq[d]++);
  return freq.map((count, digit) => ({
    digit, count,
    pct: digits.length ? ((count / digits.length) * 100).toFixed(1) : "0.0",
  }));
}
function getEvenOddStats(digits) {
  const even = digits.filter(d => d % 2 === 0).length;
  const odd = digits.length - even;
  let streak = 0, streakType = null;
  for (let i = digits.length - 1; i >= 0; i--) {
    const type = digits[i] % 2 === 0 ? "EVEN" : "ODD";
    if (!streakType) streakType = type;
    if (type === streakType) streak++; else break;
  }
  return { even, odd, total: digits.length, streakType, streak, evenPct: digits.length ? ((even / digits.length) * 100).toFixed(1) : "0.0" };
}
function getRiseFallStats(ticks) {
  if (ticks.length < 2) return { rises: 0, falls: 0, streak: 0, streakType: null, momentum: [] };
  let rises = 0, falls = 0;
  const momentum = [];
  for (let i = 1; i < ticks.length; i++) {
    const dir = parseFloat(ticks[i]) > parseFloat(ticks[i - 1]) ? "RISE" : "FALL";
    if (dir === "RISE") rises++; else falls++;
    momentum.push({ i, dir, val: ticks[i] });
  }
  let streak = 0, streakType = null;
  for (let i = momentum.length - 1; i >= 0; i--) {
    if (!streakType) streakType = momentum[i].dir;
    if (momentum[i].dir === streakType) streak++; else break;
  }
  return { rises, falls, streak, streakType, momentum };
}
function getOverUnderStats(digits, barrier = 4) {
  const over = digits.filter(d => d > barrier).length;
  const under = digits.filter(d => d < barrier).length;
  const eq = digits.length - over - under;
  return { over, under, eq, barrier, overPct: digits.length ? ((over / digits.length) * 100).toFixed(1) : "0.0", underPct: digits.length ? ((under / digits.length) * 100).toFixed(1) : "0.0" };
}
function getMatchesDiffersStats(digits, target = 5) {
  const matches = digits.filter(d => d === target).length;
  return { matches, differs: digits.length - matches, target, matchPct: digits.length ? ((matches / digits.length) * 100).toFixed(1) : "0.0" };
}
function getHotCold(freq) {
  const sorted = [...freq].sort((a, b) => b.count - a.count);
  return { hot: sorted.slice(0, 3).map(x => x.digit), cold: sorted.slice(-3).map(x => x.digit) };
}

// ── PREDICTION ENGINE HELPERS ─────────────────────────────────────────────────
function getDigitGaps(digits) {
  const gaps = Array(10).fill(null);
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i];
    if (gaps[d] === null) gaps[d] = digits.length - 1 - i;
  }
  return gaps.map((g, i) => ({ digit: i, gap: g === null ? digits.length : g }));
}
function getDigitZScores(digits) {
  const n = digits.length;
  if (n < 10) return Array(10).fill(0).map((_, i) => ({ digit: i, z: 0 }));
  const freq = Array(10).fill(0);
  digits.forEach(d => freq[d]++);
  const expected = n * 0.1;
  const stddev = Math.sqrt(n * 0.1 * 0.9);
  return freq.map((count, digit) => ({ digit, z: parseFloat(((count - expected) / stddev).toFixed(2)) }));
}
function getRecencyScore(digits) {
  const n = digits.length;
  const scores = Array(10).fill(0);
  digits.forEach((d, i) => {
    const age = n - i;
    const weight = age <= 10 ? 3 : age <= 30 ? 2 : 1;
    scores[d] += weight;
  });
  const max = Math.max(...scores, 1);
  return scores.map((s, i) => ({ digit: i, score: parseFloat((s / max * 100).toFixed(1)) }));
}
function getTransitionMatrix(digits) {
  const matrix = Array(10).fill(null).map(() => Array(10).fill(0));
  for (let i = 0; i < digits.length - 1; i++) matrix[digits[i]][digits[i + 1]]++;
  return matrix;
}
function getPredictionScores(digits) {
  // Require at least 50 ticks for meaningful statistics
  if (digits.length < 50) return null;
  const n = digits.length;
  const gaps = getDigitGaps(digits);
  const zScores = getDigitZScores(digits);
  const recency = getRecencyScore(digits);
  const freq = getDigitFrequency(digits);

  // Expected avg gap = n/10 ticks
  const expectedGap = n / 10;

  return Array(10).fill(0).map((_, digit) => {
    const z = zScores[digit].z;
    const gap = gaps[digit].gap;
    const rec = recency[digit].score;
    const actualPct = parseFloat(freq[digit].pct);

    // ── MATCHES signal (bet this digit will appear) ──────────────────────
    // Only meaningful when digit is statistically cold (negative z-score)
    // and gap is significantly above expected
    const gapRatio = gap / expectedGap; // >1 = overdue, <1 = recently seen
    const matchesSignalRaw = (
      Math.max(0, -z) * 20 +          // cold z-score contribution
      Math.max(0, gapRatio - 1) * 25 + // gap above expected contribution
      Math.max(0, 10 - actualPct) * 3  // below expected frequency
    );
    // Cap and honest-scale: max raw ~100 but real edge is tiny
    const matchesConf = Math.min(72, Math.max(5, matchesSignalRaw));

    // ── DIFFERS signal (bet this digit will NOT appear) ──────────────────
    // Stronger signal when digit is HOT (positive z-score)
    const differsSignalRaw = (
      Math.max(0, z) * 20 +             // hot z-score
      Math.max(0, 1 - gapRatio) * 20 +  // recently seen
      Math.max(0, actualPct - 10) * 3   // above expected frequency
    );
    const differsConf = Math.min(72, Math.max(5, differsSignalRaw));

    // ── Honest win probability ───────────────────────────────────────────
    // MATCHES: base 10% + tiny edge from cold status (max ~13%)
    const matchWinProb = Math.min(0.13, 0.10 + Math.max(0, -z) * 0.008 + Math.max(0, gapRatio - 1) * 0.005);
    // DIFFERS: base 90% - slight penalty if digit is cold (it might appear)
    const differsWinProb = Math.min(0.92, 0.90 + Math.max(0, z) * 0.004);

    // ── Recommended bet type ─────────────────────────────────────────────
    // Only recommend MATCHES if gap > 1.5× expected AND z < -1
    // Otherwise recommend DIFFERS (safer, higher win rate)
    const recommendMatches = gap > expectedGap * 1.5 && z < -1.0;
    const betType = recommendMatches ? "MATCHES" : "DIFFERS";
    const confidence = recommendMatches ? matchesConf : differsConf;
    const winProb = recommendMatches ? matchWinProb : differsWinProb;

    // ── Kelly for MATCHES (8:1 payout) ──────────────────────────────────
    const b_match = 8;
    const kelly_match = Math.max(0, (b_match * matchWinProb - (1 - matchWinProb)) / b_match);
    // ── Kelly for DIFFERS (0.95:1 payout typical on Deriv) ──────────────
    const b_differs = 0.95;
    const kelly_differs = Math.max(0, (b_differs * differsWinProb - (1 - differsWinProb)) / b_differs);
    const halfKelly = recommendMatches
      ? parseFloat((kelly_match / 2 * 100).toFixed(1))
      : parseFloat((kelly_differs / 2 * 100).toFixed(1));

    // ── Signal label ─────────────────────────────────────────────────────
    // Only STRONG if multiple signals agree and gap is very large
    const signal = (gap > expectedGap * 2 && z < -1.5 && rec < 30) ? "STRONG"
      : (gap > expectedGap * 1.5 && z < -1.0) ? "MODERATE"
      : betType === "DIFFERS" && z > 1.0 ? "MODERATE"
      : "WEAK";

    return {
      digit,
      betType,          // "MATCHES" or "DIFFERS"
      confidence: parseFloat(confidence.toFixed(1)),
      matchesConf: parseFloat(matchesConf.toFixed(1)),
      differsConf: parseFloat(differsConf.toFixed(1)),
      gap,
      expectedGap: parseFloat(expectedGap.toFixed(1)),
      gapRatio: parseFloat(gapRatio.toFixed(2)),
      z,
      recScore: rec,
      matchWinProb: parseFloat((matchWinProb * 100).toFixed(1)),
      differsWinProb: parseFloat((differsWinProb * 100).toFixed(1)),
      winProb: parseFloat((winProb * 100).toFixed(1)),
      halfKelly,
      signal,
    };
  }).sort((a, b) => b.confidence - a.confidence);
}

// ── MULTI-STRATEGY SIGNAL ENGINE ─────────────────────────────────────────────

// Returns unified signal for all 4 strategies based on current market data
function getAllStrategySignals(digits, ticks, barrier, matchTarget) {
  if (!digits.length || !ticks.length) return null;

  const eo = getEvenOddStats(digits);
  const rf = getRiseFallStats(ticks);
  const ou = getOverUnderStats(digits, barrier);
  const md = getMatchesDiffersStats(digits, matchTarget);
  const n = digits.length;

  // Even/Odd signal
  const eoImbalance = Math.abs(parseFloat(eo.evenPct) - 50);
  const eoStreakRisk = eo.streak >= 5 ? "HIGH" : eo.streak >= 3 ? "MEDIUM" : "LOW";
  const eoConf = Math.min(95, 50 + eoImbalance * 1.5 + (eo.streak >= 4 ? 15 : 0));
  const eoBet = parseFloat(eo.evenPct) < 48 ? "EVEN" : parseFloat(eo.evenPct) > 52 ? "ODD" : eo.streak >= 4 ? (eo.streakType === "EVEN" ? "ODD" : "EVEN") : "WAIT";

  // Rise/Fall signal
  const rfTotal = rf.rises + rf.falls || 1;
  const rfImbalance = Math.abs((rf.rises / rfTotal) - 0.5) * 100;
  const rfConf = Math.min(95, 50 + rfImbalance + (rf.streak >= 4 ? 15 : 0));
  const rfBet = rf.streak >= 5 ? (rf.streakType === "RISE" ? "FALL" : "RISE") :
                rf.rises > rf.falls * 1.1 ? "RISE" : rf.falls > rf.rises * 1.1 ? "FALL" : "WAIT";

  // Over/Under signal
  const ouImbalance = Math.abs(parseFloat(ou.overPct) - 50);
  const ouConf = Math.min(95, 50 + ouImbalance * 1.2);
  const ouBet = parseFloat(ou.overPct) > 58 ? `OVER ${barrier}` : parseFloat(ou.underPct) > 58 ? `UNDER ${barrier}` : "WAIT";

  // Matches/Differs - use top prediction score
  const gaps = getDigitGaps(digits);
  const zscores = getDigitZScores(digits);
  const coldest = gaps.sort((a, b) => b.gap - a.gap)[0];
  const mdConf = Math.min(95, 40 + (coldest.gap / Math.max(n * 0.3, 1)) * 50);
  const mdBet = `MATCHES ${coldest.digit}`;

  const signals = [
    { strategy: "Even/Odd", bet: eoBet, confidence: parseFloat(eoConf.toFixed(1)), streak: eo.streak, streakType: eo.streakType, risk: eoStreakRisk, winProb: parseFloat((0.5 + eoImbalance/200).toFixed(3)) },
    { strategy: "Rise/Fall", bet: rfBet, confidence: parseFloat(rfConf.toFixed(1)), streak: rf.streak, streakType: rf.streakType, risk: rf.streak >= 5 ? "HIGH" : rf.streak >= 3 ? "MEDIUM" : "LOW", winProb: parseFloat((0.5 + rfImbalance/200).toFixed(3)) },
    { strategy: "Over/Under", bet: ouBet, confidence: parseFloat(ouConf.toFixed(1)), streak: 0, streakType: null, risk: "LOW", winProb: parseFloat((0.5 + ouImbalance/200).toFixed(3)) },
    { strategy: "Matches", bet: mdBet, confidence: parseFloat(mdConf.toFixed(1)), streak: coldest.gap, streakType: `digit ${coldest.digit}`, risk: "LOW", winProb: parseFloat((0.10 + mdConf/1000).toFixed(3)) },
  ].sort((a, b) => b.confidence - a.confidence);

  return signals;
}

// Streak alert detector
function getStreakAlerts(digits, ticks, barrier) {
  const alerts = [];
  if (!digits.length) return alerts;
  const eo = getEvenOddStats(digits);
  const rf = getRiseFallStats(ticks);
  const ou = getOverUnderStats(digits, barrier);
  const gaps = getDigitGaps(digits);
  const maxGap = Math.max(...gaps.map(g => g.gap));
  const mostOverdue = gaps.find(g => g.gap === maxGap);

  if (eo.streak >= 6) alerts.push({ level: "CRITICAL", msg: `${eo.streak}× ${eo.streakType} streak — extreme reversal risk`, strategy: "Even/Odd" });
  else if (eo.streak >= 4) alerts.push({ level: "WARNING", msg: `${eo.streak}× ${eo.streakType} streak — watch for reversal`, strategy: "Even/Odd" });

  if (rf.streak >= 6) alerts.push({ level: "CRITICAL", msg: `${rf.streak}× ${rf.streakType} — trend overextended`, strategy: "Rise/Fall" });
  else if (rf.streak >= 4) alerts.push({ level: "WARNING", msg: `${rf.streak}× ${rf.streakType} — strong momentum`, strategy: "Rise/Fall" });

  if (maxGap >= 25) alerts.push({ level: "CRITICAL", msg: `Digit ${mostOverdue.digit} absent for ${maxGap} ticks — strong Matches signal`, strategy: "Matches" });
  else if (maxGap >= 15) alerts.push({ level: "WARNING", msg: `Digit ${mostOverdue.digit} overdue by ${maxGap} ticks`, strategy: "Matches" });

  const overPct = parseFloat(ou.overPct);
  if (overPct > 70 || overPct < 30) alerts.push({ level: "WARNING", msg: `Over/Under heavily skewed: ${ou.overPct}% over barrier ${ou.barrier}`, strategy: "Over/Under" });

  return alerts;
}



// ── AI ANALYSIS ───────────────────────────────────────────────────────────────
async function fetchAIInsight(stats, ticks, symbol) {
  const digits = getLastDigits(ticks.slice(-20));
  const prompt = `You are a professional Deriv synthetic indices trader. Analyze this LIVE market data and give sharp, actionable insights.

SYMBOL: ${symbol} | LIVE TICKS: ${ticks.length} data points
LAST 20 PRICES: ${ticks.slice(-20).map(t => parseFloat(t).toFixed(3)).join(", ")}
LAST 20 DIGITS: ${digits.join(", ")}

LIVE STATS:
- Even/Odd: ${stats.evenOdd.even} even (${stats.evenOdd.evenPct}%), ${stats.evenOdd.odd} odd | Streak: ${stats.evenOdd.streak}× ${stats.evenOdd.streakType}
- Rise/Fall: ${stats.riseFall.rises} rises, ${stats.riseFall.falls} falls | Streak: ${stats.riseFall.streak}× ${stats.riseFall.streakType}
- Over/Under (barrier ${stats.overUnder.barrier}): Over ${stats.overUnder.overPct}%, Under ${stats.overUnder.underPct}%
- Matches/Differs (digit ${stats.matchesDiffers.target}): ${stats.matchesDiffers.matchPct}% match rate
- Hot digits: ${stats.hotCold.hot.join(", ")} | Cold digits: ${stats.hotCold.cold.join(", ")}

Provide 3-4 sentences of sharp analysis:
1. Current market momentum and bias
2. Best trade type RIGHT NOW with confidence level
3. Risk warning if pattern looks unstable
Use trader language. Be direct. No disclaimers.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 350, temperature: 0.7 }),
    });
    if (!res.ok) throw new Error("Groq failed");
    const data = await res.json();
    return data.choices[0].message.content;
  } catch {
    try {
      const res2 = await fetch(OR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OR_KEY}`, "HTTP-Referer": "https://deriv-oracle.vercel.app" },
        body: JSON.stringify({ model: OR_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 350 }),
      });
      const data2 = await res2.json();
      return data2.choices[0].message.content;
    } catch {
      return "⚠️ AI analysis unavailable. Review the digit frequency and streak patterns manually for trade signals.";
    }
  }
}


// ---- LAB: PURE STATISTICS ENGINE ----------------------------------------
// Regularized incomplete gamma (Lanczos logGamma + series/CF)
function logGamma(x) {
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function gammaSeries(a, x) {
  let term = 1 / a, sum = term;
  for (let n = 1; n <= 200; n++) {
    term *= x / (a + n); sum += term;
    if (Math.abs(term) < 1e-8 * Math.abs(sum)) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}
function gammaCF(a, x) {
  let b = x + 1 - a, c = 1 / 1e-30, d = 1 / b, h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-8) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
function chiSqPValue(chiSq, df) {
  if (chiSq <= 0) return 1;
  const a = df / 2, x = chiSq / 2;
  const p = x < a + 1 ? gammaSeries(a, x) : 1 - gammaCF(a, x);
  return Math.max(0, Math.min(1, 1 - p));
}
function labRunChiSquare(digitArr) {
  const n = digitArr.length;
  if (n < 10) return null;
  const freq = Array(10).fill(0);
  digitArr.forEach(d => freq[d]++);
  const expected = n / 10;
  const chiSq = freq.reduce((s, o) => s + Math.pow(o - expected, 2) / expected, 0);
  return {
    chiSq: parseFloat(chiSq.toFixed(4)), df: 9,
    pValue: parseFloat(chiSqPValue(chiSq, 9).toFixed(4)),
    freq, n, expected: parseFloat(expected.toFixed(1))
  };
}
function labBuildTransMatrix(digitArr) {
  const mat = Array.from({length: 10}, () => Array(10).fill(0));
  for (let i = 0; i < digitArr.length - 1; i++) mat[digitArr[i]][digitArr[i+1]]++;
  const rowTests = mat.map((row, from) => {
    const rowN = row.reduce((s, v) => s + v, 0);
    if (rowN < 20) return { from, rowN, chiSq: null, pValue: null };
    const exp = rowN / 10;
    const cs = row.reduce((s, o) => s + Math.pow(o - exp, 2) / exp, 0);
    return { from, rowN, chiSq: parseFloat(cs.toFixed(3)), pValue: parseFloat(chiSqPValue(cs, 9).toFixed(4)) };
  });
  return { mat, rowTests };
}
function labRunPersistence(digitArr) {
  if (digitArr.length < 200) return null;
  const h = Math.floor(digitArr.length / 2);
  const t1 = labRunChiSquare(digitArr.slice(0, h));
  const t2 = labRunChiSquare(digitArr.slice(h));
  const drift = t1 && t2 ? parseFloat(Math.abs(t1.chiSq - t2.chiSq).toFixed(3)) : null;
  return { t1, t2, drift, consistent: drift !== null && drift < 8 };
}
function labComputeVerdict(chi, trans, persist) {
  if (!chi) return null;
  let flags = 0;
  if (chi.pValue < 0.05) flags++;
  if (trans) { const sig = trans.rowTests.filter(r => r.pValue !== null && r.pValue < 0.05); if (sig.length >= 2) flags++; }
  if (persist && !persist.consistent) flags++;
  if (flags === 0) return "CLEAN";
  if (flags === 1) return "MARGINAL";
  return "SIGNAL";
}
// ---- END LAB STATISTICS ENGINE ------------------------------------------

// ── CSS ───────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Rajdhani:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  :root{
    --bg:#060608;--bg2:#0c0c12;--bg3:#12121e;
    --panel:rgba(14,14,24,0.97);--border:#1e1e38;--border2:#2a2a48;
    --green:#00ff88;--green2:#00cc6a;--green-dim:rgba(0,255,136,0.1);
    --orange:#ff6b35;--orange-dim:rgba(255,107,53,0.1);
    --cyan:#00bfff;--cyan-dim:rgba(0,191,255,0.08);
    --yellow:#ffd700;--yellow-dim:rgba(255,215,0,0.08);
    --red:#ff3366;--red-dim:rgba(255,51,102,0.1);
    --text:#c8d0e0;--text-dim:#4a5260;
    --mono:'JetBrains Mono',monospace;--head:'Rajdhani',sans-serif;
  }
  body{background:var(--bg);color:var(--text);font-family:var(--mono);}
  .terminal{min-height:100vh;background:var(--bg);
    background-image:linear-gradient(rgba(0,255,136,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.012) 1px,transparent 1px);
    background-size:40px 40px;}
  .scanlines{position:fixed;top:0;left:0;width:100%;height:100%;
    background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.025) 2px,rgba(0,0,0,0.025) 4px);
    pointer-events:none;z-index:0;}
  .header{background:linear-gradient(180deg,rgba(0,255,136,0.05) 0%,transparent 100%);
    border-bottom:1px solid var(--border2);padding:10px 16px;
    display:flex;align-items:center;justify-content:space-between;position:relative;z-index:10;}
  .logo{display:flex;align-items:center;gap:10px;}
  .logo-mark{width:32px;height:32px;border:1.5px solid var(--green);transform:rotate(45deg);
    display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(0,255,136,0.3);}
  .logo-mark span{transform:rotate(-45deg);font-size:13px;color:var(--green);font-weight:700;}
  .logo-text{font-family:var(--head);font-size:20px;font-weight:700;letter-spacing:4px;
    color:var(--green);text-shadow:0 0 20px rgba(0,255,136,0.35);}
  .logo-sub{font-size:9px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;}
  .header-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end;}
  .status-pill{display:flex;align-items:center;gap:6px;padding:4px 10px;
    border-radius:2px;border:1px solid;font-size:10px;letter-spacing:2px;font-weight:700;}
  .pill-live{border-color:var(--green);color:var(--green);background:var(--green-dim);}
  .pill-demo{border-color:var(--text-dim);color:var(--text-dim);background:transparent;}
  .pill-connecting{border-color:var(--yellow);color:var(--yellow);background:var(--yellow-dim);}
  .pill-error{border-color:var(--red);color:var(--red);background:var(--red-dim);}
  .blink{animation:blink 1s infinite;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
  .pulse{animation:pulse 2s infinite;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  .main{padding:12px;position:relative;z-index:1;}
  /* Symbol Selector */
  .symbol-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:10px;
    background:var(--panel);border:1px solid var(--border);border-radius:4px;align-items:center;}
  .symbol-label{font-size:10px;letter-spacing:2px;color:var(--text-dim);margin-right:4px;}
  .sym-btn{padding:5px 10px;font-family:var(--mono);font-size:10px;letter-spacing:1px;
    border:1px solid var(--border2);background:transparent;color:var(--text-dim);
    border-radius:2px;cursor:pointer;transition:all 0.2s;white-space:nowrap;}
  .sym-btn:hover{border-color:var(--green);color:var(--green);}
  .sym-btn.active{border-color:var(--green);color:var(--green);background:var(--green-dim);
    box-shadow:0 0 8px rgba(0,255,136,0.15);}
  /* Live controls */
  .controls-bar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;}
  .btn{padding:8px 14px;border:none;cursor:pointer;font-family:var(--mono);
    font-size:11px;letter-spacing:1.5px;text-transform:uppercase;border-radius:3px;transition:all 0.2s;}
  .btn-green{background:var(--green-dim);color:var(--green);border:1px solid var(--green);}
  .btn-green:hover{background:rgba(0,255,136,0.18);box-shadow:0 0 12px rgba(0,255,136,0.2);}
  .btn-red{background:var(--red-dim);color:var(--red);border:1px solid var(--red);}
  .btn-red:hover{background:rgba(255,51,102,0.18);}
  .btn-orange{background:var(--orange-dim);color:var(--orange);border:1px solid var(--orange);}
  .btn-orange:hover{background:rgba(255,107,53,0.18);}
  .btn-cyan{background:var(--cyan-dim);color:var(--cyan);border:1px solid var(--cyan);}
  .btn-cyan:hover{background:rgba(0,191,255,0.15);}
  .btn-ghost{background:transparent;color:var(--text-dim);border:1px solid var(--border2);}
  .btn-ghost:hover{border-color:var(--text-dim);color:var(--text);}
  .btn:disabled{opacity:0.35;cursor:not-allowed;}
  /* Grid layouts */
  .grid-top{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
  .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;}
  /* Panel */
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:4px;
    padding:14px;position:relative;overflow:hidden;}
  .panel::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;
    background:linear-gradient(90deg,transparent,var(--green),transparent);opacity:0.25;}
  .panel.accent-orange::before{background:linear-gradient(90deg,transparent,var(--orange),transparent);}
  .panel.accent-cyan::before{background:linear-gradient(90deg,transparent,var(--cyan),transparent);}
  .panel.accent-yellow::before{background:linear-gradient(90deg,transparent,var(--yellow),transparent);}
  .panel.accent-red::before{background:linear-gradient(90deg,transparent,var(--red),transparent);}
  .panel-title{font-family:var(--head);font-size:11px;letter-spacing:3px;color:var(--text-dim);
    text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
  .dot{width:5px;height:5px;border-radius:50%;}
  .dot-green{background:var(--green);box-shadow:0 0 6px var(--green);}
  .dot-orange{background:var(--orange);box-shadow:0 0 6px var(--orange);}
  .dot-cyan{background:var(--cyan);box-shadow:0 0 6px var(--cyan);}
  .dot-yellow{background:var(--yellow);box-shadow:0 0 6px var(--yellow);}
  .dot-red{background:var(--red);box-shadow:0 0 6px var(--red);}
  /* Stats */
  .stat-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
  .stat-label{font-size:11px;color:var(--text-dim);letter-spacing:1px;}
  .stat-val{font-size:13px;font-weight:700;}
  .green{color:var(--green)!important;} .orange{color:var(--orange)!important;}
  .cyan{color:var(--cyan)!important;} .yellow{color:var(--yellow)!important;}
  .red{color:var(--red)!important;} .dim{color:var(--text-dim)!important;}
  /* Bar */
  .bar-track{background:var(--border);height:5px;border-radius:2px;overflow:hidden;margin:3px 0 8px;}
  .bar-fill{height:100%;border-radius:2px;transition:width 0.6s ease;}
  /* Digit frequency */
  .digit-freq-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:3px;}
  .digit-cell{display:flex;flex-direction:column;align-items:center;padding:6px 2px;
    border-radius:3px;border:1px solid var(--border);transition:all 0.3s;}
  .digit-cell.hot{border-color:var(--orange);background:var(--orange-dim);}
  .digit-cell.cold{border-color:rgba(0,191,255,0.2);background:rgba(0,191,255,0.03);}
  .digit-num{font-size:13px;font-weight:700;margin-bottom:2px;}
  .digit-pct{font-size:9px;color:var(--text-dim);}
  /* Streak badge */
  .streak-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;
    border-radius:2px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}
  .streak-rise{background:var(--green-dim);border:1px solid var(--green);color:var(--green);}
  .streak-fall{background:var(--red-dim);border:1px solid var(--red);color:var(--red);}
  .streak-even{background:var(--cyan-dim);border:1px solid var(--cyan);color:var(--cyan);}
  .streak-odd{background:var(--yellow-dim);border:1px solid var(--yellow);color:var(--yellow);}
  /* AI */
  .ai-text{font-size:12px;line-height:1.9;color:var(--text);background:#05050a;
    border:1px solid var(--border);padding:14px;border-radius:3px;min-height:80px;white-space:pre-wrap;}
  /* Tick tape */
  .tick-tape{overflow-x:auto;white-space:nowrap;padding:6px 0;font-size:11px;
    color:var(--text-dim);letter-spacing:1px;scrollbar-width:none;}
  .tick-tape::-webkit-scrollbar{display:none;}
  .tick-item{display:inline-block;margin-right:8px;}
  .tick-item.up{color:var(--green);} .tick-item.dn{color:var(--red);}
  /* Signal box */
  .signal-box{display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:12px;border-radius:3px;text-align:center;min-height:76px;}
  .signal-label{font-size:9px;letter-spacing:3px;color:var(--text-dim);text-transform:uppercase;margin-bottom:5px;}
  .signal-val{font-size:20px;font-weight:700;font-family:var(--head);letter-spacing:2px;}
  .signal-conf{font-size:10px;color:var(--text-dim);margin-top:3px;}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .three-col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
  .divider{border:none;border-top:1px solid var(--border);margin:10px 0;}
  /* Tabs - grouped nav */
  .tabs-wrapper{margin-bottom:12px;}
  .tabs-row{display:flex;gap:0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
  .tab-group{display:flex;gap:1px;padding:0 6px 0 0;margin-right:6px;border-right:1px solid var(--border2);}
  .tab-group:last-child{border-right:none;margin-right:0;padding-right:0;}
  .tab-group-badge{font-size:7px;letter-spacing:2px;color:var(--text-dim);padding:2px 4px;
    font-family:var(--head);opacity:0.45;align-self:center;margin-right:2px;white-space:nowrap;}
  .tab{padding:7px 10px;font-family:var(--head);font-size:10px;letter-spacing:1.5px;
    text-transform:uppercase;cursor:pointer;border:none;background:transparent;
    color:var(--text-dim);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.2s;white-space:nowrap;}
  .tab.active{color:var(--green);border-bottom-color:var(--green);}
  .tab:hover:not(.active){color:var(--text);}
  .tab-mobile-select{display:none;width:100%;background:var(--bg2);border:1px solid var(--border);
    color:var(--green);font-family:var(--head);font-size:11px;letter-spacing:1px;
    padding:9px 12px;border-radius:3px;margin-bottom:10px;cursor:pointer;
    -webkit-appearance:none;appearance:none;}
  /* Chips */
  .last-digits-row{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;}
  .ld-chip{width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    border-radius:3px;font-size:12px;font-weight:700;border:1px solid var(--border);}
  /* Barrier buttons */
  .barrier-row{display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap;}
  .barrier-btn{padding:4px 9px;font-family:var(--mono);font-size:11px;
    border:1px solid var(--border2);background:transparent;color:var(--text-dim);
    border-radius:2px;cursor:pointer;transition:all 0.2s;}
  .barrier-btn.active{border-color:var(--cyan);color:var(--cyan);background:var(--cyan-dim);}
  /* MD target */
  .md-target-row{display:flex;gap:8px;align-items:center;margin-bottom:12px;}
  .md-target-row input{width:56px;background:#05050a;border:1px solid var(--border2);
    color:var(--green);font-family:var(--mono);font-size:14px;
    padding:5px 8px;border-radius:3px;outline:none;text-align:center;}
  .md-target-row input:focus{border-color:var(--green);}
  /* Live stats bar */
  .live-stats{display:flex;gap:16px;padding:8px 14px;background:var(--panel);
    border:1px solid var(--border);border-radius:4px;margin-bottom:12px;flex-wrap:wrap;align-items:center;}
  .live-stat{display:flex;flex-direction:column;}
  .live-stat-label{font-size:9px;letter-spacing:2px;color:var(--text-dim);}
  .live-stat-val{font-size:14px;font-weight:700;font-family:var(--head);}
  /* Phase 2 banner */
  .phase2-banner{border:1px dashed #222238;border-radius:4px;padding:10px 16px;
    text-align:center;margin-top:12px;background:linear-gradient(135deg,rgba(0,191,255,0.02),rgba(255,215,0,0.02));}
  .phase2-title{font-family:var(--head);font-size:12px;letter-spacing:3px;color:#2a2a48;margin-bottom:2px;}
  .phase2-sub{font-size:10px;color:#1e1e30;letter-spacing:1px;}
  /* Empty state */
  .empty-state{text-align:center;padding:40px 20px;color:var(--text-dim);font-size:12px;letter-spacing:2px;}
  /* Balance bar */
  .balance-bar{display:flex;gap:12px;align-items:center;}
  .balance-val{font-size:16px;font-weight:700;color:var(--green);font-family:var(--head);}
  .balance-currency{font-size:10px;color:var(--text-dim);letter-spacing:2px;}
  /* Connection log */
  .conn-log{font-size:10px;color:var(--text-dim);margin-top:8px;height:18px;overflow:hidden;}

  /* Paper Trading */
  .pt-table{width:100%;border-collapse:collapse;font-size:11px;}
  .pt-table th{color:var(--text-dim);letter-spacing:2px;font-size:9px;text-transform:uppercase;
    padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;}
  .pt-table td{padding:6px 8px;border-bottom:1px solid var(--border);font-family:var(--mono);}
  .pt-win{color:var(--green);} .pt-loss{color:var(--red);} .pt-pending{color:var(--yellow);}
  .pred-card{padding:10px 8px;border:1px solid var(--border);border-radius:3px;
    display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;
    transition:all 0.2s;position:relative;}
  .pred-card:hover{border-color:var(--green);background:var(--green-dim);}
  .pred-card.top-pick{border-color:var(--green);background:var(--green-dim);
    box-shadow:0 0 12px rgba(0,255,136,0.2);}
  .pred-card.strong{border-color:var(--orange);background:var(--orange-dim);}
  .pred-card.avoid{opacity:0.4;}
  .pred-digit{font-size:22px;font-weight:700;font-family:var(--head);}
  .pred-conf{font-size:10px;font-weight:700;letter-spacing:1px;}
  .pred-gap{font-size:9px;color:var(--text-dim);}
  .pred-signal{font-size:8px;letter-spacing:2px;padding:2px 6px;border-radius:2px;text-transform:uppercase;}
  .sig-strong{background:var(--green-dim);color:var(--green);border:1px solid var(--green);}
  .sig-moderate{background:var(--orange-dim);color:var(--orange);border:1px solid var(--orange);}
  .sig-weak{background:var(--yellow-dim);color:var(--yellow);border:1px solid var(--yellow);}
  .sig-avoid{background:var(--red-dim);color:var(--red);border:1px solid var(--red);}
  .matrix-grid{display:grid;grid-template-columns:repeat(11,1fr);gap:2px;font-size:9px;}
  .matrix-cell{padding:4px 2px;text-align:center;border-radius:2px;}
  .matrix-header{color:var(--text-dim);font-weight:700;}
  .progress-ring{display:flex;flex-direction:column;align-items:center;gap:4px;}
  .target-bar{height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin:4px 0;}
  .target-fill{height:100%;border-radius:4px;transition:width 0.6s ease;
    background:linear-gradient(90deg,var(--orange),var(--green));}
  .kelly-input{width:80px;background:#05050a;border:1px solid var(--border2);
    color:var(--green);font-family:var(--mono);font-size:13px;
    padding:5px 8px;border-radius:3px;outline:none;text-align:center;}
  .kelly-input:focus{border-color:var(--green);}
  .pnl-positive{color:var(--green);font-weight:700;}
  .pnl-negative{color:var(--red);font-weight:700;}


  /* Multi-strategy signals */
  .strategy-card{padding:12px 14px;border:1px solid var(--border);border-radius:4px;
    display:flex;align-items:center;justify-content:space-between;gap:8px;
    transition:all 0.3s;margin-bottom:6px;}
  .strategy-card.top{border-color:var(--green);background:rgba(0,255,136,0.04);}
  .strategy-card.good{border-color:var(--orange);background:rgba(255,107,53,0.04);}
  .strategy-card.wait{opacity:0.5;}
  .sc-left{display:flex;align-items:center;gap:12px;}
  .sc-name{font-family:var(--head);font-size:13px;letter-spacing:2px;font-weight:700;min-width:90px;}
  .sc-bet{font-size:12px;font-weight:700;letter-spacing:1px;padding:3px 10px;
    border-radius:2px;background:var(--green-dim);border:1px solid var(--green);color:var(--green);}
  .sc-bet.wait{background:transparent;border-color:var(--border2);color:var(--text-dim);}
  .sc-right{display:flex;align-items:center;gap:16px;}
  .sc-conf{font-size:18px;font-weight:700;font-family:var(--head);}
  .sc-streak{font-size:10px;color:var(--text-dim);letter-spacing:1px;}
  .sc-bar{width:80px;height:5px;background:var(--border);border-radius:3px;overflow:hidden;}
  .sc-bar-fill{height:100%;border-radius:3px;transition:width 0.5s ease;}
  .sc-rank{font-size:10px;color:var(--text-dim);width:20px;text-align:center;}
  /* Alerts */
  .alert-item{display:flex;align-items:center;gap:10px;padding:8px 12px;
    border-radius:3px;margin-bottom:6px;font-size:11px;}
  .alert-critical{background:var(--red-dim);border:1px solid var(--red);}
  .alert-warning{background:var(--yellow-dim);border:1px solid var(--yellow);}
  .alert-ok{background:var(--green-dim);border:1px solid var(--green);}
  .alert-icon{font-size:14px;min-width:20px;}
  .alert-strategy{font-size:9px;letter-spacing:2px;padding:2px 6px;border-radius:2px;
    background:var(--border);color:var(--text-dim);white-space:nowrap;}
  /* Win rate chart */
  .winrate-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;}
  .execWR-stat{padding:10px;border:1px solid var(--border);border-radius:3px;text-align:center;}
  .execWR-stat-val{font-size:20px;font-weight:700;font-family:var(--head);}
  .execWR-stat-label{font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-top:2px;}
  /* Best strategy badge */
  @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
  .bot-ai-output{animation:fadeIn 0.3s ease;}
  .bot-xml-preview{animation:fadeIn 0.3s ease;}
  .conn-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .best-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;
    border:1px solid var(--green);border-radius:3px;background:var(--green-dim);
    font-size:11px;font-weight:700;letter-spacing:2px;color:var(--green);}


  /* ── PHASE 4 — EXECUTE TAB ─────────────────────────────────────────── */
  .execute-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;}
  .arm-btn{width:100%;padding:16px;font-family:var(--head);font-size:13px;letter-spacing:3px;
    border:2px solid var(--border);background:transparent;color:var(--text-dim);
    cursor:pointer;border-radius:4px;transition:all 0.3s;position:relative;overflow:hidden;}
  .arm-btn.armed{border-color:var(--green);color:var(--green);background:rgba(0,255,136,0.06);
    box-shadow:0 0 20px rgba(0,255,136,0.15);}
  .arm-btn.armed::before{content:"";position:absolute;top:0;left:-100%;width:100%;height:100%;
    background:linear-gradient(90deg,transparent,rgba(0,255,136,0.1),transparent);
    animation:sweep 2s infinite;}
  @keyframes sweep{to{left:100%;}}
  .arm-btn.firing{border-color:var(--orange);color:var(--orange);background:rgba(255,165,0,0.06);
    animation:pulse-border 0.5s infinite;}
  @keyframes pulse-border{0%,100%{box-shadow:0 0 8px rgba(255,165,0,0.3);}50%{box-shadow:0 0 24px rgba(255,165,0,0.7);}}
  .signal-live{border:1px solid var(--border);border-radius:4px;padding:12px;
    background:rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:6px;}
  .signal-live.hot{border-color:var(--green);background:rgba(0,255,136,0.04);}
  .signal-live-label{font-size:8px;letter-spacing:3px;color:var(--text-dim);}
  .signal-live-val{font-size:28px;font-weight:900;font-family:var(--head);line-height:1;}
  .execute-log{background:#03030a;border:1px solid var(--border);border-radius:4px;
    max-height:280px;overflow-y:auto;font-family:var(--mono);font-size:10px;}
  .execute-log-row{display:grid;grid-template-columns:80px 60px 55px 55px 60px 1fr;
    gap:6px;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.03);align-items:center;}
  .execute-log-row.win{border-left:2px solid var(--green);}
  .execute-log-row.loss{border-left:2px solid var(--red);}
  .execute-log-row.pending{border-left:2px solid var(--yellow);animation:fadeIn 0.3s ease;}
  .exec-pnl-pos{color:var(--green);font-weight:700;}
  .exec-pnl-neg{color:var(--red);font-weight:700;}
  .exec-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;}
  .exec-stat{background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:3px;
    padding:8px 10px;text-align:center;}
  .exec-stat-val{font-size:18px;font-weight:700;font-family:var(--head);}
  .exec-stat-label{font-size:8px;letter-spacing:2px;color:var(--text-dim);margin-top:2px;}
  .stake-input{background:rgba(0,0,0,0.4);border:1px solid var(--border2);border-radius:3px;
    padding:8px 12px;color:var(--text);font-family:var(--mono);font-size:14px;
    width:100%;outline:none;transition:border-color 0.2s;}
  .stake-input:focus{border-color:var(--cyan);}
  .latency-bar{display:flex;align-items:center;gap:8px;padding:5px 10px;
    background:rgba(0,0,0,0.3);border-radius:3px;border:1px solid var(--border);}
  .latency-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
  .latency-good{background:var(--green);box-shadow:0 0 6px var(--green);}
  .latency-ok{background:var(--yellow);box-shadow:0 0 6px var(--yellow);}
  .latency-bad{background:var(--red);box-shadow:0 0 6px var(--red);}
  .confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999;
    display:flex;align-items:center;justify-content:center;}
  .confirm-box{background:#0a0a14;border:1px solid var(--orange);border-radius:6px;
    padding:28px;max-width:380px;width:90%;text-align:center;}

    /* ── MOBILE RESPONSIVE ─────────────────────────────── */
  @media(max-width:900px){
    .grid-top,.grid-2,.grid-3{grid-template-columns:1fr;}
    .symbol-bar{gap:4px;}
  }
  /* Under 5 Predictor Tab */
  .u5-stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;}
  .u5-stat{text-align:center;padding:8px;border:1px solid var(--border);border-radius:3px;background:var(--bg2);}
  .u5-stat-val{font-size:18px;font-weight:700;font-family:var(--head);}
  .u5-stat-label{font-size:8px;letter-spacing:2px;color:var(--text-dim);margin-top:2px;}
  .u5-panel{border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:10px;background:var(--bg2);}
  .u5-signal-box{text-align:center;padding:20px 14px;border-radius:4px;margin-bottom:10px;border:1px solid var(--border);}
  .u5-signal-box.enter{border-color:var(--green);background:rgba(0,255,136,0.06);}
  .u5-signal-box.wait{border-color:var(--red);background:rgba(255,50,50,0.06);}
  .u5-signal-box.caution{border-color:var(--yellow);background:rgba(255,220,0,0.04);}
  .u5-verdict{font-size:22px;font-weight:900;font-family:var(--head);letter-spacing:4px;margin-bottom:6px;}
  .u5-digit-big{font-size:64px;font-weight:900;font-family:var(--head);line-height:1;color:var(--cyan);}
  .u5-digit-label{font-size:9px;letter-spacing:3px;color:var(--text-dim);margin-top:4px;}
  .u5-factors{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px;}
  .u5-factor{padding:8px 10px;border-radius:3px;border:1px solid var(--border);background:var(--bg2);}
  .u5-factor-label{font-size:8px;letter-spacing:2px;color:var(--text-dim);margin-bottom:3px;}
  .u5-factor-val{font-size:13px;font-weight:700;font-family:var(--head);}
  .u5-factor.bullish{border-color:var(--green);}
  .u5-factor.bearish{border-color:var(--red);}
  .u5-factor.neutral{border-color:var(--border);}
  .u5-history{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:10px;}
  .u5-digit-pill{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;
    justify-content:center;font-size:11px;font-weight:700;font-family:var(--head);}
  .u5-digit-pill.under{background:rgba(0,255,136,0.15);border:1px solid var(--green);color:var(--green);}
  .u5-digit-pill.over{background:rgba(255,50,50,0.10);border:1px solid var(--red);color:var(--red);}
  .u5-predict-btn{width:100%;padding:14px;font-family:var(--head);font-size:13px;
    letter-spacing:3px;text-transform:uppercase;background:transparent;
    border:1px solid var(--cyan);color:var(--cyan);border-radius:3px;cursor:pointer;
    transition:all 0.2s;margin-bottom:10px;}
  .u5-predict-btn:hover{background:rgba(0,191,255,0.12);box-shadow:0 0 20px rgba(0,191,255,0.2);}
  .u5-predict-btn:disabled{opacity:0.4;cursor:not-allowed;}
  .u5-predict-btn.analysing{border-color:var(--yellow);color:var(--yellow);}
  .u5-analysis-log{background:#03030a;border:1px solid var(--border);border-radius:3px;
    padding:10px;font-family:var(--mono);font-size:9px;color:var(--text-dim);
    max-height:160px;overflow-y:auto;line-height:1.8;white-space:pre-wrap;}
  @media(max-width:700px){

    .tabs-row{flex-wrap:wrap;}
    .tab-group{flex-wrap:wrap;border-right:none;padding-right:0;margin-right:0;}
    .tab{font-size:9px;padding:7px 9px;letter-spacing:1px;}
    .bot-tabs{overflow-x:auto;flex-wrap:nowrap;}
    .bot-tab{white-space:nowrap;font-size:9px;padding:5px 10px;}
    .live-stats{flex-wrap:wrap;gap:8px;padding:8px 10px;}
    .live-stat{min-width:calc(50% - 8px);flex:1;}
    .live-stat-val{font-size:13px;}
    .conn-bar,.header-controls{flex-wrap:wrap;gap:6px;}
    .symbol-bar{gap:3px;padding:8px;}
    .sym-btn{padding:4px 8px;font-size:9px;}
    .panel{padding:10px;}
    .panel-title{font-size:10px;letter-spacing:2px;}
    .bot-params{grid-template-columns:repeat(2,1fr);}
    .bot-param-val{font-size:12px;}
    .winrate-stats{grid-template-columns:repeat(2,1fr);}
    .execWR-stat-val{font-size:16px;}
    .digit-freq-grid{grid-template-columns:repeat(5,1fr);}
    .signal-box{padding:8px 6px;}
    .signal-val{font-size:22px;}
    .sc-bar{width:50px;}
    .sc-conf{font-size:15px;}
    .bot-match-score{flex-direction:column;gap:6px;}
    .bot-match-pct{font-size:16px;}
    .kelly-input{width:65px;}
    .two-col{grid-template-columns:1fr 1fr;}
    .matrix-cell{font-size:8px;padding:3px;}
    .predict-card{padding:10px;}
  }
  @media(max-width:480px){
    .tab-mobile-select{display:block;}
    .tabs-row{display:none;}
    .tab{font-size:8px;padding:6px 8px;}
    .live-stat{min-width:100%;flex:auto;}
    .bot-params{grid-template-columns:1fr 1fr;}
    .digit-freq-grid{grid-template-columns:repeat(5,1fr);}
    .winrate-stats{grid-template-columns:repeat(2,1fr);}
    .phase2-banner{padding:10px;}
    .phase2-title{font-size:8px;}
    .phase2-sub{font-size:8px;}
  }
`;


// ── BOT XML PARSER ────────────────────────────────────────────────────────────
function parseBotXML(xmlString) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    const getAttr = (tag, attr) => {
      const el = doc.querySelector(tag);
      return el ? el.getAttribute(attr) : null;
    };
    const getField = (tag) => {
      const el = doc.querySelector(tag);
      return el ? el.textContent.trim() : null;
    };
    // Contract type detection
    const contractType = getAttr("trade_type", "type") ||
      getField("contract_type") ||
      (xmlString.includes("DIGITDIFF") ? "DIGITDIFF" :
       xmlString.includes("DIGITMATCH") ? "DIGITMATCH" :
       xmlString.includes("CALL") ? "CALL" :
       xmlString.includes("PUT") ? "PUT" :
       xmlString.includes("EVEN") ? "EVEN" :
       xmlString.includes("ODD") ? "ODD" : "UNKNOWN");
    // Extract key parameters using regex for Deriv XML bot format
    const extract = (key) => {
      const m = xmlString.match(new RegExp(key + '[^>]*>([^<]+)<', 'i')) ||
                xmlString.match(new RegExp('"' + key + '"[^>]*value="([^"]+)"', 'i')) ||
                xmlString.match(new RegExp(key + '"\s*:\s*"?([\d.]+)', 'i'));
      return m ? m[1].trim() : null;
    };
    const stake = extract("initial_stake") || extract("amount") || extract("stake") || "?";
    const martingale = extract("martingale_factor") || extract("multiplier") || "1.0";
    const maxStake = extract("max_stake") || extract("maximum_stake") || "?";
    const stopLoss = extract("stop_loss") || extract("loss_threshold") || null;
    const takeProfit = extract("take_profit") || extract("profit_threshold") || null;
    const targetDigit = extract("prediction") || extract("digit") || extract("barrier") || null;
    const duration = extract("duration") || extract("ticks") || "1";
    const symbol = xmlString.match(/R_\d+|1HZ\d+V|JD\d+/)?.[0] || "R_50";
    // Strategy classification
    const strategy = contractType.includes("DIFF") ? "DIFFERS" :
                     contractType.includes("MATCH") ? "MATCHES" :
                     contractType.includes("CALL") ? "RISE" :
                     contractType.includes("PUT") ? "FALL" :
                     contractType.includes("EVEN") ? "EVEN" :
                     contractType.includes("ODD") ? "ODD" : "UNKNOWN";
    return {
      contractType, strategy, stake, martingale: parseFloat(martingale) || 1.0,
      maxStake, stopLoss, takeProfit, targetDigit, duration, symbol,
      raw: xmlString,
    };
  } catch(e) {
    return { contractType: "PARSE_ERROR", strategy: "UNKNOWN", raw: xmlString, error: e.message };
  }
}

// ── BOT HEALTH CHECKER ────────────────────────────────────────────────────────
function checkBotHealth(botData, liveStats) {
  const issues = [];
  const score = { points: 0, max: 0 };
  const add = (ok, msg, severity) => {
    issues.push({ ok, msg, severity });
    score.max += 2;
    if (ok) score.points += severity === "critical" ? 2 : 1;
  };
  // Stop-loss check
  add(!!botData.stopLoss, botData.stopLoss ? "Stop-loss set: $" + botData.stopLoss : "No stop-loss — unlimited downside risk!", "critical");
  // Take-profit check
  add(!!botData.takeProfit, botData.takeProfit ? "Take-profit set: $" + botData.takeProfit : "No take-profit — profits unprotected", "warn");
  // Martingale check
  const mg = parseFloat(botData.martingale) || 1;
  add(mg <= 2.0, mg <= 1.0 ? "No martingale — safe flat stake" : mg <= 2.0 ? "Martingale x" + mg + " — moderate risk" : "Martingale x" + mg + " — HIGH blow-up risk!", mg > 2 ? "critical" : "warn");
  // Strategy vs market fit
  if (liveStats && liveStats.differsWR !== "—") {
    const dwr = parseFloat(liveStats.differsWR);
    const isFit = (botData.strategy === "DIFFERS" && dwr >= 47.4) ||
                  (botData.strategy === "MATCHES" && dwr < 15) ||
                  (botData.strategy !== "DIFFERS" && botData.strategy !== "MATCHES");
    add(isFit, isFit ? "Strategy fits current market conditions" : "Strategy may not fit current market conditions", "warn");
  }
  // Stake sanity
  const st = parseFloat(botData.stake);
  add(!st || st <= 100, !st ? "Stake undetected" : st <= 10 ? "Conservative stake: $" + st : st <= 100 ? "Moderate stake: $" + st : "High stake: $" + st + " — risky for testing!", st > 100 ? "critical" : "warn");
  const pct = Math.round((score.points / score.max) * 100);
  const health = pct >= 80 ? "OK" : pct >= 50 ? "WARN" : "CRITICAL";
  return { issues, health, score: pct };
}

// ── MARKET MATCH SCORE ─────────────────────────────────────────────────────────
function getBotMarketMatch(botData, digits, ticks, liveStats) {
  if (!digits || digits.length < 20) return { score: 0, reason: "Need 20+ ticks for market match" };
  let score = 0; const notes = [];
  const freq = getDigitFrequency(digits);
  const hotColdData = getHotCold(freq);
  if (botData.strategy === "DIFFERS") {
    const dwr = liveStats ? parseFloat(liveStats.differsWR) : 90;
    if (dwr >= 80) { score += 40; notes.push("DIFFERS win rate " + dwr + "% — excellent fit"); }
    else if (dwr >= 47.4) { score += 25; notes.push("DIFFERS win rate " + dwr + "% — profitable"); }
    else { score += 5; notes.push("DIFFERS win rate " + dwr + "% — below break-even"); }
    if (botData.targetDigit !== null) {
      const td = parseInt(botData.targetDigit);
      const isCold = hotColdData.cold.includes(td);
      if (isCold) { score += 30; notes.push("Target digit " + td + " is COLD — ideal for DIFFERS"); }
      else { score += 10; notes.push("Target digit " + td + " not cold — consider cold digit"); }
    } else { score += 20; notes.push("No fixed digit target — flexible"); }
    score += 30;
  } else if (botData.strategy === "MATCHES") {
    const matchEntry = freq.find(f => f.digit === parseInt(botData.targetDigit));
    if (matchEntry && parseFloat(matchEntry.pct) >= 15) { score += 40; notes.push("Target digit " + botData.targetDigit + " appearing " + matchEntry.pct + "% — hot!"); }
    else { score += 10; notes.push("Target digit not hot — poor MATCHES fit"); }
  }
  return { score: Math.min(100, score), notes };
}

// ── AI CONFIG: OpenRouter multi-key rotation + Groq fallback ─────────────────
const OR_BOT_KEYS = [
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
];
// Primary: DeepSeek R1 (best reasoning for analysis+XML)
// Fallback 1: Qwen3 235B (best XML/code generation)
// Fallback 2: Llama 4 Maverick (1M context, reliable)
const OR_BOT_MODELS = [
  "deepseek/deepseek-r1-0528:free",
  "qwen/qwen3-235b-a22b:free",
  "meta-llama/llama-4-maverick:free",
];
const GROQ_BOT_MODEL = "llama-3.3-70b-versatile";

let _orKeyIdx = 0;
let _orModelIdx = 0;
function getNextORKey() {
  const key = OR_BOT_KEYS[_orKeyIdx % OR_BOT_KEYS.length];
  _orKeyIdx++;
  return key;
}
function getNextORModel() {
  const model = OR_BOT_MODELS[_orModelIdx % OR_BOT_MODELS.length];
  _orModelIdx++;
  return model;
}

// ── GENERATE IMPROVED BOT XML ─────────────────────────────────────────────────
async function generateImprovedBot(originalXml, marketContext, analysisReport) {
  // Truncate XML to avoid 413 / context overflow — keep first 2500 chars
  const xmlSnippet = originalXml.length > 2500
    ? originalXml.slice(0, 2500) + "\n<!-- ...truncated for brevity -->"
    : originalXml;
  // Compact market report
  const reportSnippet = analysisReport.length > 1200
    ? analysisReport.slice(0, 1200) + "..."
    : analysisReport;
  const ctxStr = JSON.stringify({
    symbol: marketContext.symbol,
    hotDigits: marketContext.hotDigits,
    coldDigits: marketContext.coldDigits,
    differsWinRate: marketContext.differsWinRate,
    totalTrades: marketContext.totalTrades,
    botHealth: marketContext.botHealth,
    recommendedSymbol: "1HZ100V",
    recommendedStrategy: "DIGITDIFF on coldest digit",
    validatedFormats: ["DIGITDIFF","DIGITOVER","DIGITUNDER","CALL","PUT"],
    requiredBlocks: ["trade","before_purchase","after_purchase"],
    rootElement: "xml xmlns=http://www.w3.org/1999/xhtml collection=false",
  });

  // Single combined prompt — format-educated with real Deriv DBot structure
  const FORMAT_GUIDE = [
    '<xml xmlns="http://www.w3.org/1999/xhtml" collection="false">',
    '  <variables>',
    '    <variable type="" id="VAR1">STOP_LOSS</variable>',
    '    <variable type="" id="VAR2">TARGET_PROFIT</variable>',
    '    <variable type="" id="VAR3">INITIAL_STAKE</variable>',
    '    <variable type="" id="VAR4">MARTINGALE</variable>',
    '    <variable type="" id="VAR5">PREDICTION</variable>',
    '  </variables>',
    '  <block type="trade" id="TRADE1" x="0" y="0">',
    '    <field name="MARKET_LIST">synthetic_index</field>',
    '    <field name="SUBMARKET_LIST">random_index</field>',
    '    <field name="SYMBOL_LIST">1HZ100V</field>',
    '    <field name="TRADETYPECAT_LIST">digits</field>',
    '    <field name="TRADETYPE_LIST">matchesdiffers</field>',
    '    <field name="TYPE_LIST">DIGITDIFF</field>',
    '    <field name="CANDLEINTERVAL_LIST">60</field>',
    '    <field name="TIME_MACHINE_ENABLED">FALSE</field>',
    '    <field name="RESTARTONERROR">TRUE</field>',
    '    <statement name="INITIALIZATION">',
    '      <!-- variables_set blocks for each parameter go here -->',
    '    </statement>',
    '    <statement name="SUBMARKET">',
    '      <block type="controls_whileUntil" id="LOOP1">',
    '        <field name="MODE">WHILE</field>',
    '        <value name="BOOL"><block type="logic_boolean" id="B1"><field name="BOOL">TRUE</field></block></value>',
    '        <statement name="DO">',
    '          <!-- trade conditions and tradeOptions block go here -->',
    '        </statement>',
    '      </block>',
    '    </statement>',
    '  </block>',
    '  <block type="before_purchase" id="BEFORE1" x="0" y="820">',
    '    <statement name="BEFOREPURCHASE_STACK">',
    '      <block type="purchase" id="P1"><field name="PURCHASE_LIST">DIGITDIFF</field></block>',
    '    </statement>',
    '  </block>',
    '  <block type="after_purchase" id="AFTER1" x="0" y="900">',
    '    <statement name="AFTERPURCHASE_STACK">',
    '      <!-- if win: reset stake, trade_again. if loss: martingale or stop -->',
    '    </statement>',
    '  </block>',
    '</xml>',
  ].join("\n");

  const RULES = [
    "Root: <xml xmlns=\"http://www.w3.org/1999/xhtml\" collection=\"false\"> (NO <?xml ?> header)",
    "Required blocks: trade, before_purchase (with purchase child), after_purchase",
    "Every <block> needs unique id= attribute",
    "Variables declared in <variables> with matching variabletype= references",
    "No markdown, no code fences — raw XML only",
    "Symbol: 1HZ100V, TRADETYPE_LIST: matchesdiffers, TYPE_LIST: DIGITDIFF",
    "PURCHASE_LIST: DIGITDIFF in before_purchase block",
    "Use <!-- comment --> to explain each improvement made",
  ].join("\n");

  const fullPrompt = "You are a Deriv DBot XML expert. Output ONLY a complete valid Deriv DBot XML."
    + "\n\n=== MANDATORY FORMAT RULES ===\n" + RULES
    + "\n\n=== VALID STRUCTURE SKELETON ===\n" + FORMAT_GUIDE
    + "\n\n=== ORIGINAL BOT XML (excerpt) ===\n" + xmlSnippet
    + "\n\n=== LIVE MARKET DATA ===\n" + reportSnippet
    + "\n\n=== MARKET STATS ===\n" + ctxStr
    + "\n\nIMPROVEMENT TASKS: flat $10 stake, no martingale, stop_loss=$50, take_profit=$100,"
    + " PREDICTION=coldest digit from hot/cold data, symbol=1HZ100V."
    + "\n\nOutput the complete improved XML now (start with <xml):";



  const makeORRequest = async (key, model) => {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "HTTP-Referer": "https://deriv-oracle.vercel.app",
        "X-Title": "ROMANS 8:28 ORACLE",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1800,
        temperature: 0.15,
        messages: [{ role: "user", content: fullPrompt }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || data?.error || resp.statusText;
      throw new Error("OR-" + resp.status + " [" + model.split("/").pop() + "]: " + msg);
    }
    const text = data.choices?.[0]?.message?.content || "";
    if (!text || text.length < 40) throw new Error("Empty response from " + model);
    return { text, model };
  };

  const makeGroqRequest = async () => {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (process.env.REACT_APP_GROQ_API_KEY || "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"),
      },
      body: JSON.stringify({
        model: GROQ_BOT_MODEL,
        max_tokens: 1800,
        temperature: 0.15,
        messages: [{ role: "user", content: fullPrompt }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error("Groq-" + resp.status + ": " + (data?.error?.message || "unknown"));
    const text = data.choices?.[0]?.message?.content || "";
    if (!text || text.length < 40) throw new Error("Groq empty response");
    return { text, model: GROQ_BOT_MODEL };
  };

  // Rotate across keys and models — 8 OR attempts then Groq
  const orAttempts = [
    [0, 0], [1, 1], [2, 2], [3, 0], [4, 1], [5, 2], [6, 0], [7, 1],
  ];
  const errors = [];
  for (const [ki, mi] of orAttempts) {
    try {
      const { text, model } = await makeORRequest(OR_BOT_KEYS[ki], OR_BOT_MODELS[mi]);
      return { text, model, engine: "OpenRouter" };
    } catch(e) {
      errors.push(e.message);
    }
  }
  // Final fallback: Groq
  try {
    const { text, model } = await makeGroqRequest();
    return { text, model, engine: "Groq" };
  } catch(e) {
    errors.push("Groq: " + e.message);
  }
  return { text: null, model: null, engine: null, errors };
}

// ── BOT ANALYSIS REPORT BUILDER ───────────────────────────────────────────────
function buildAnalysisReport(digits, ticks, liveStats, symbol) {
  if (!digits || digits.length < 10) return "Insufficient data — need 20+ ticks";
  const freq = getDigitFrequency(digits);
  const hotColdData = getHotCold(freq);
  const eo = getEvenOddStats(digits);
  const rf = ticks.length > 1 ? getRiseFallStats(ticks) : null;
  const ou = getOverUnderStats(digits, 4);
  const lines = [
    "=== ROMANS 8:28 ORACLE — LIVE MARKET ANALYSIS ===",
    "Symbol: " + symbol + " | Ticks Analyzed: " + digits.length,
    "",
    "DIGIT FREQUENCY:",
    freq.map(f => "  Digit " + f.digit + ": " + f.pct + "% (" + f.count + " hits) " + (hotColdData.hot.includes(f.digit) ? "[HOT]" : hotColdData.cold.includes(f.digit) ? "[COLD]" : "")).join("\n"),
    "",
    "HOT DIGITS (overdue to NOT appear — ideal DIFFERS targets): " + hotColdData.hot.join(", "),
    "COLD DIGITS (underrepresented — poor DIFFERS targets): " + hotColdData.cold.join(", "),
    "",
    "EVEN/ODD: " + eo.evenPct + "% Even | Current streak: " + eo.streak + "x " + eo.streakType,
    rf ? "RISE/FALL: " + ((rf.rises/(rf.rises+rf.falls||1))*100).toFixed(1) + "% Rise | Streak: " + rf.streak + "x " + rf.streakType : "",
    "OVER/UNDER 4: " + ou.overPct + "% Over | " + ou.underPct + "% Under",
    "",
    "PAPER TRADE STATS:",
    liveStats ? "  DIFFERS win rate: " + liveStats.differsWR + "% (" + liveStats.differsTotal + " trades)" : "  No paper trades yet",
    liveStats ? "  MATCHES win rate: " + liveStats.matchWR + "% (" + liveStats.matchTotal + " trades)" : "",
    liveStats ? "  Total P&L: $" + liveStats.totalPnl : "",
    "",
    "RECOMMENDATION: " + (hotColdData.hot.length > 0 ? "DIFFERS on digit " + hotColdData.hot[0] + " (hottest — most likely NOT to appear next)" : "Monitor for hot digit before betting"),
  ];
  return lines.join("\n");
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0c0c18", border: "1px solid #1e1e38", padding: "8px 12px", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
      <div style={{ color: "#5a6070" }}>Digit {label}</div>
      <div style={{ color: "#00ff88" }}>{payload[0].value}×</div>
    </div>
  );
};

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function DerivOracle() {
  const [ticks, setTicks] = useState([]);
  const [digits, setDigits] = useState([]);
  const [symbol, setSymbol] = useState("R_50");
  const [wsStatus, setWsStatus] = useState("idle"); // idle | connecting | live | error | demo
  const [connLog, setConnLog] = useState("");
  const [balance, setBalance] = useState(null);
  const [currency, setCurrency] = useState("USD");
  const [activeTab, setActiveTab] = useState("overview");
  const [barrier, setBarrier] = useState(4);
  const [matchTarget, setMatchTarget] = useState(5);
  const [aiInsight, setAiInsight] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [autoAI, setAutoAI] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [winRateHistory, setWinRateHistory] = useState([]); // [{trade: N, winRate: X, pnl: Y}]
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [bestTradeType, setBestTradeType] = useState("MATCHES"); // track which type wins more



  // ── AUTH + ACCOUNT STATE ──────────────────────────────────────────────────
  const [derivToken, setDerivToken] = useState(DERIV_TOKEN_DEFAULT);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenValid, setTokenValid] = useState(false);  // true only after successful auth
  const [tokenError, setTokenError] = useState("");
  const [accountList, setAccountList] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [showTokenSetup, setShowTokenSetup] = useState(true); // always show token panel

  // ── PHASE 4: EXECUTE STATE ───────────────────────────────────────────────
  const tradeWsRef = useRef(null);          // dedicated trade WebSocket
  const tradeReqIdRef = useRef(1);          // incrementing request IDs
  const pendingProposalRef = useRef(null);  // proposal awaiting confirmation
  const [execArmed, setExecArmed] = useState(false);
  const [execStake, setExecStake] = useState("10");
  const [execMode, setExecMode] = useState("demo"); // "demo" | "real"
  const [execTrades, setExecTrades] = useState([]);
  const [u5Predicting, setU5Predicting] = useState(false);
  const [u5Result, setU5Result] = useState(null);
  const [execFiring, setExecFiring] = useState(false);
  const [execLog, setExecLog] = useState("");
  const [latencyMs, setLatencyMs] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingExecSignal, setPendingExecSignal] = useState(null);
  const [execSessionPnl, setExecSessionPnl] = useState(0);
  const execTradesRef = useRef([]);
  const lastExecTickRef = useRef(0);        // prevent double-firing on same tick

  // ── BOT ANALYZER STATE (Phase 3) ─────────────────────────────────────────
  const [botSubTab, setBotSubTab] = useState("upload");
  const [uploadedBots, setUploadedBots] = useState([]);
  const [selectedBotIdx, setSelectedBotIdx] = useState(null);
  const [storedBots, setStoredBots] = useState([]);
  const [botLoading, setBotLoading] = useState(false);
  const [botAiOutput, setBotAiOutput] = useState("");
  const [improvedXml, setImprovedXml] = useState("");
  const [storageStatus, setStorageStatus] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  // ── PAPER TRADING STATE ───────────────────────────────────────────────────
  const [paperTrades, setPaperTrades] = useState([]);
  const [pendingTrade, setPendingTrade] = useState(null); // { digit, confidence, tickIndex }
  const [paperBalance, setPaperBalance] = useState(1000); // virtual $1000
  const [paperStake, setPaperStake] = useState(10);
  const paperPayout = 8; // 8:1 for Matches - fixed payout ratio
  const paperTradesRef = useRef([]);
  const pendingTradeRef = useRef(null);
  const tickIndexRef = useRef(0);

  // ---- LAB: Signal Detection State ----
  const [labStats, setLabStats] = useState(null);
  const [labRunning, setLabRunning] = useState(false);
  const [labTickTotal, setLabTickTotal] = useState(0);
  const labTickBufferRef = useRef([]);
  const labAutoCounterRef = useRef(0);
  const runLabAnalysisRef = useRef(null);
  const saveLabRef = useRef(null);

  const wsRef = useRef(null);
  const ticksRef = useRef([]);
  const autoAIRef = useRef(false);
  const aiCounterRef = useRef(0);
  const triggerAIRef = useRef(null);
  const wsStatusRef = useRef("idle");

  // Keep refs in sync
  useEffect(() => { ticksRef.current = ticks; }, [ticks]);
  useEffect(() => { autoAIRef.current = autoAI; }, [autoAI]);

  // Derived stats
  const freqData = digits.length ? getDigitFrequency(digits) : [];
  const evenOdd = digits.length ? getEvenOddStats(digits) : null;
  const riseFall = ticks.length > 1 ? getRiseFallStats(ticks) : null;
  const overUnder = digits.length ? getOverUnderStats(digits, barrier) : null;
  const matchesDiffers = digits.length ? getMatchesDiffersStats(digits, matchTarget) : null;
  const hotCold = freqData.length ? getHotCold(freqData) : { hot: [], cold: [] };
  const maxFreq = freqData.length ? Math.max(...freqData.map(d => d.count), 1) : 1;

  // ── AI TRIGGER — defined first so connectWS can reference it via ref ─────
  const triggerAI = useCallback(async (tickData) => {
    const t = tickData || ticksRef.current;
    if (!t || !t.length) return;
    setIsAnalyzing(true);
    const d = getLastDigits(t);
    const stats = {
      evenOdd: getEvenOddStats(d),
      riseFall: getRiseFallStats(t),
      overUnder: getOverUnderStats(d, barrier),
      matchesDiffers: getMatchesDiffersStats(d, matchTarget),
      hotCold: getHotCold(getDigitFrequency(d)),
    };
    const result = await fetchAIInsight(stats, t, symbol);
    setAiInsight(result);
    setIsAnalyzing(false);
  }, [barrier, matchTarget, symbol]);

  // Keep triggerAI ref current so WebSocket closure always has latest version
  useEffect(() => { triggerAIRef.current = triggerAI; }, [triggerAI]);

  // ── WEBSOCKET CONNECTION ──────────────────────────────────────────────────

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — TRADE EXECUTION ENGINE
  // Dedicated WS for trading — NEVER shares the data stream.
  // Flow: connectTradeWS → authorize → proposal → buy → track result
  // Latency target: < 100ms proposal→buy round trip
  // ══════════════════════════════════════════════════════════════════════════

  const connectTradeWS = useCallback(() => {
    if (tradeWsRef.current && tradeWsRef.current.readyState <= 1) return;
    const ws = new WebSocket(DERIV_WS_URL);
    ws.binaryType = "arraybuffer"; // fastest parse mode
    tradeWsRef.current = ws;

    ws.onopen = () => {
      setExecLog("Trade WS open — authorizing...");
      const authToken = activeAccount?.token || derivToken || DERIV_TOKEN_DEFAULT;
      if (!authToken) { setExecLog("⚠ No token set. Enter your Deriv API token below."); ws.close(); return; }
      ws.send(JSON.stringify({ authorize: authToken, req_id: 1 }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(
        typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)
      );

      if (msg.msg_type === "authorize") {
        if (msg.error) {
          setTokenValid(false);
          setTokenError(msg.error.message);
          setExecLog("✗ Auth failed: " + msg.error.message + " — paste a fresh token below.");
          return;
        }
        setTokenValid(true);
        setTokenError("");
        setExecLog("✓ Authorized — " + (msg.authorize?.loginid || "") + " · " + (msg.authorize?.is_virtual ? "DEMO" : "REAL") + " — ready to trade.");
        // Request account list for switcher
        tradeWsRef.current.send(JSON.stringify({ account_list: 1, req_id: ++tradeReqIdRef.current }));
      }

      if (msg.msg_type === "account_list" && msg.account_list) {
        const accounts = msg.account_list.map(a => ({
          loginid: a.loginid,
          is_virtual: a.is_virtual,
          currency: a.currency || "USD",
          token: a.token,
          label: (a.is_virtual ? "🎮 DEMO" : "💰 REAL") + " · " + a.loginid + " · " + (a.currency || "USD"),
        }));
        setAccountList(accounts);
        // Select based on pre-connect mode toggle (demo/real)
        if (!activeAccount) {
          const demo = accounts.find(a => a.is_virtual);
          const real = accounts.find(a => !a.is_virtual);
          // Default to demo regardless of execMode — safety first
          const pick = demo || accounts[0];
          if (pick) {
            setActiveAccount(pick);
            setDerivToken(pick.token);
            setExecLog("✓ Accounts loaded · " + accounts.length + " account(s) · " + pick.label + " selected — switch anytime above.");
          }
        }
      }

      if (msg.msg_type === "proposal") {
        if (msg.error) {
          setExecFiring(false);
          setExecLog("✗ Proposal error: " + msg.error.message);
          pendingProposalRef.current = null;
          return;
        }
        // Immediately buy — this is the hot path, minimize object creation
        const proposalId = msg.proposal.id;
        const price = msg.proposal.ask_price;
        const payout = msg.proposal.payout;
        const t1 = Date.now();
        pendingProposalRef.current = { proposalId, price, payout, t1 };
        ws.send(JSON.stringify({ buy: proposalId, price, req_id: ++tradeReqIdRef.current }));
        setExecLog("⚡ Proposal $" + price + " → Buying instantly...");
      }

      if (msg.msg_type === "buy") {
        if (msg.error) {
          setExecFiring(false);
          setExecLog("✗ Buy error: " + msg.error.message);
          pendingProposalRef.current = null;
          return;
        }
        const rtt = pendingProposalRef.current ? Date.now() - pendingProposalRef.current.t1 : null;
        if (rtt !== null) setLatencyMs(rtt);
        const contract = msg.buy;
        setExecLog("✓ Contract " + contract.contract_id + " purchased · RTT " + (rtt || "?") + "ms");
        // Subscribe to contract updates
        ws.send(JSON.stringify({
          proposal_open_contracts: 1,
          contract_id: contract.contract_id,
          subscribe: 1,
          req_id: ++tradeReqIdRef.current,
        }));
        // Add pending row to trade log
        const newTrade = {
          id: contract.contract_id,
          time: new Date().toLocaleTimeString(),
          digit: pendingProposalRef.current?.digit || "?",
          stake: pendingProposalRef.current?.stake || execStake,
          status: "PENDING",
          pnl: null,
          entrySpot: contract.entry_spot || "?",
        };
        execTradesRef.current = [newTrade, ...execTradesRef.current.slice(0, 99)];
        setExecTrades([...execTradesRef.current]);
        pendingProposalRef.current = null;
        setExecFiring(false);
      }

      if (msg.msg_type === "proposal_open_contracts") {
        const c = msg.proposal_open_contracts;
        if (!c || c.is_sold !== 1) return; // not settled yet
        const profit = parseFloat(c.profit) || 0;
        const won = profit > 0;
        const exitSpot = c.exit_tick_display_value || c.sell_spot || "?";
        // Update the matching trade row
        execTradesRef.current = execTradesRef.current.map(t =>
          t.id === c.contract_id
            ? { ...t, status: won ? "WIN" : "LOSS", pnl: profit, exitSpot }
            : t
        );
        setExecTrades([...execTradesRef.current]);
        setExecSessionPnl(prev => parseFloat((prev + profit).toFixed(2)));
        setExecLog((won ? "✓ WIN" : "✗ LOSS") + " — P&L: " + (profit >= 0 ? "+" : "") + profit.toFixed(2) + " USD · exit " + exitSpot);
        // Update real balance
        if (tradeWsRef.current?.readyState === 1) {
          tradeWsRef.current.send(JSON.stringify({ balance: 1, req_id: ++tradeReqIdRef.current }));
        }
      }

      if (msg.msg_type === "balance" && msg.balance?.balance !== undefined) {
        setBalance(parseFloat(msg.balance.balance).toFixed(2));
      }
    };

    ws.onerror = () => setExecLog("⚠ Trade WS error — reconnecting...");
    ws.onclose = () => setExecLog("Trade WS closed.");
  }, [execStake]);

  const disconnectTradeWS = useCallback(() => {
    if (tradeWsRef.current) {
      tradeWsRef.current.onclose = null;
      tradeWsRef.current.close();
      tradeWsRef.current = null;
    }
  }, []);

  // ── FIRE TRADE ─────────────────────────────────────────────────────────────
  // Called on every live tick when armed. Uses coldest digit as prediction.
  // Guards: not already firing, min 20 ticks, armed, trade WS open.
  const fireTrade = useCallback((currentDigits, currentTick) => {
    if (!execArmed) return;
    if (execFiring) return;
    if (currentDigits.length < 20) return;
    if (currentTick === lastExecTickRef.current) return; // same tick guard
    const ws = tradeWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setExecLog("⚠ Trade WS not open — reconnecting...");
      connectTradeWS();
      return;
    }
    const stake = parseFloat(execStake);
    if (!stake || stake <= 0) { setExecLog("⚠ Invalid stake."); return; }

    // Get coldest digit (best DIFFERS target) from live heatmap
    const freq = getDigitFrequency(currentDigits);
    const hc = getHotCold(freq);
    const coldDigit = hc.cold.length > 0 ? hc.cold[0] : 5;

    lastExecTickRef.current = currentTick;
    setExecFiring(true);
    setExecLog("⟳ Sending proposal — DIGITDIFF digit " + coldDigit + " stake $" + stake + "...");

    const t0 = Date.now();
    pendingProposalRef.current = { digit: coldDigit, stake, t0 };

    ws.send(JSON.stringify({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type: "DIGITDIFF",
      currency: "USD",
      duration: 1,
      duration_unit: "t",
      symbol: symbol,
      barrier: String(coldDigit),
      req_id: ++tradeReqIdRef.current,
    }));
  }, [execArmed, execFiring, execStake, symbol, connectTradeWS]);

  // Cleanup trade WS on unmount
  useEffect(() => { return () => disconnectTradeWS(); }, [disconnectTradeWS]);


  // ── SWITCH ACCOUNT (demo ↔ real) ─────────────────────────────────────────
  const switchAccount = useCallback((account) => {
    if (!account) return;
    // Disarm first — never switch accounts mid-trade
    setExecArmed(false);
    setExecFiring(false);
    setTokenValid(false);
    setActiveAccount(account);
    setDerivToken(account.token);
    setExecLog("Switching to " + account.label + " — re-authorizing...");

    // Close and reopen trade WS with the new token
    if (tradeWsRef.current) {
      tradeWsRef.current.onclose = null;
      tradeWsRef.current.close();
      tradeWsRef.current = null;
    }
    // Small delay to ensure WS is fully closed before reopening
    setTimeout(() => {
      const ws = new WebSocket(DERIV_WS_URL);
      ws.binaryType = "arraybuffer";
      tradeWsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ authorize: account.token, req_id: ++tradeReqIdRef.current }));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
        if (msg.msg_type === "authorize") {
          if (msg.error) {
            setTokenValid(false);
            setTokenError(msg.error.message);
            setExecLog("✗ Switch failed: " + msg.error.message);
            return;
          }
          setTokenValid(true);
          setTokenError("");
          setBalance(parseFloat(msg.authorize?.balance || 0).toFixed(2));
          setExecLog("✓ Switched to " + account.label + " · Balance: " + (msg.authorize?.balance || "?") + " " + (account.currency || "USD"));
        }
        if (msg.msg_type === "proposal") {
          if (msg.error) { setExecFiring(false); setExecLog("✗ Proposal: " + msg.error.message); return; }
          const proposalId = msg.proposal.id;
          const price = msg.proposal.ask_price;
          pendingProposalRef.current = { ...pendingProposalRef.current, proposalId, price };
          ws.send(JSON.stringify({ buy: proposalId, price, req_id: ++tradeReqIdRef.current }));
        }
        if (msg.msg_type === "buy") {
          if (msg.error) { setExecFiring(false); setExecLog("✗ Buy: " + msg.error.message); return; }
          const rtt = pendingProposalRef.current ? Date.now() - pendingProposalRef.current.t1 : null;
          if (rtt) setLatencyMs(rtt);
          ws.send(JSON.stringify({ proposal_open_contracts: 1, contract_id: msg.buy.contract_id, subscribe: 1, req_id: ++tradeReqIdRef.current }));
          const newTrade = { id: msg.buy.contract_id, time: new Date().toLocaleTimeString(), digit: pendingProposalRef.current?.digit || "?", stake: pendingProposalRef.current?.stake || execStake, status: "PENDING", pnl: null, entrySpot: msg.buy.entry_spot || "?" };
          execTradesRef.current = [newTrade, ...execTradesRef.current.slice(0, 99)];
          setExecTrades([...execTradesRef.current]);
          pendingProposalRef.current = null;
          setExecFiring(false);
        }
        if (msg.msg_type === "proposal_open_contracts") {
          const c = msg.proposal_open_contracts;
          if (!c || c.is_sold !== 1) return;
          const profit = parseFloat(c.profit) || 0;
          const won = profit > 0;
          execTradesRef.current = execTradesRef.current.map(t => t.id === c.contract_id ? { ...t, status: won ? "WIN" : "LOSS", pnl: profit, exitSpot: c.exit_tick_display_value || "?" } : t);
          setExecTrades([...execTradesRef.current]);
          setExecSessionPnl(prev => parseFloat((prev + profit).toFixed(2)));
          setExecLog((won ? "✓ WIN" : "✗ LOSS") + " P&L: " + (profit >= 0 ? "+" : "") + profit.toFixed(2) + " USD");
        }
        if (msg.msg_type === "balance") setBalance(parseFloat(msg.balance?.balance || 0).toFixed(2));
      };
      ws.onerror = () => setExecLog("⚠ WS error after account switch.");
      ws.onclose = () => setExecLog("Trade WS closed.");
    }, 200);

    // Re-authorize data WS for correct balance display
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ authorize: account.token }));
    }
  }, [execStake]);

  // Under 5 Predictor Engine - 7-factor analysis
  const runUnder5Analysis = async () => {
    if (digits.length < 30) {
      setU5Result({ verdict:"WAIT", confidence:0, recommendedDigit:null, signal:"red",
        factors:[], analysisLog:"Need at least 30 live ticks.\nCurrently have " + digits.length + " ticks." });
      return;
    }
    setU5Predicting(true);
    setU5Result(null);
    const last50 = digits.slice(-50);
    const under5Count = last50.filter(d => d < 5).length;
    const under5Rate = (under5Count / last50.length) * 100;
    const f1Score = under5Rate >= 55 ? 2 : under5Rate >= 50 ? 1 : under5Rate >= 45 ? 0 : -1;
    const f1Note = "Under-5 rate (last 50): " + under5Rate.toFixed(1) + "% " + (f1Score >= 1 ? "BULLISH" : f1Score === 0 ? "NEUTRAL" : "BEARISH");
    const last2Under = digits.slice(-2).every(d => d < 5);
    const f2Score = last2Under ? 2 : 0;
    const f2Note = "Last 2 ticks: " + digits.slice(-2).join(", ") + " -> " + (last2Under ? "BOTH UNDER 5 (bot signal)" : "NOT both under 5");
    const prev5Under = digits.slice(-10,-5).filter(d => d < 5).length;
    const last5Under = digits.slice(-5).filter(d => d < 5).length;
    const momentumDiff = last5Under - prev5Under;
    const f3Score = momentumDiff > 0 ? 2 : momentumDiff === 0 ? 1 : 0;
    const f3Note = "Momentum: prev5=" + prev5Under + "/5 -> last5=" + last5Under + "/5 " + (f3Score === 2 ? "GAINING" : f3Score === 1 ? "FLAT" : "LOSING");
    let streak = 0; let streakType = null;
    for (let i = digits.length - 1; i >= 0; i--) {
      const isUnder = digits[i] < 5;
      if (streakType === null) { streakType = isUnder ? "UNDER" : "OVER"; streak = 1; }
      else if ((isUnder && streakType === "UNDER") || (!isUnder && streakType === "OVER")) streak++;
      else break;
    }
    const f4Score = (streakType === "UNDER" && streak <= 3) ? 2 : (streakType === "UNDER" && streak <= 5) ? 1 : (streakType === "OVER" && streak >= 3) ? 2 : 0;
    const f4Note = "Streak: " + streak + "x " + streakType + " " + (f4Score === 2 ? "FAVORABLE" : f4Score === 1 ? "OK" : "RISKY");
    const freq = [0,1,2,3,4].map(d => ({ digit:d, count: last50.filter(x => x === d).length })).sort((a,b) => a.count - b.count);
    const coldestUnder5 = freq[0];
    const f5Score = coldestUnder5.count < 4 ? 2 : coldestUnder5.count < 6 ? 1 : 0;
    const f5Note = "Coldest under-5: digit " + coldestUnder5.digit + " (" + coldestUnder5.count + "/50) " + (f5Score >= 1 ? "COLD (due)" : "WARM");
    let gapSinceLast = 0;
    for (let i = digits.length - 1; i >= 0; i--) { if (digits[i] < 5) break; gapSinceLast++; }
    const f6Score = gapSinceLast >= 3 ? 2 : gapSinceLast >= 1 ? 1 : 0;
    const f6Note = "Gap since last under-5: " + gapSinceLast + " ticks " + (f6Score === 2 ? "OVERDUE" : f6Score === 1 ? "RECENT" : "JUST HAPPENED");
    const last10 = digits.slice(-10);
    const last10Under = last10.filter(d => d < 5).length;
    const f7Score = last10Under >= 6 ? 2 : last10Under >= 4 ? 1 : last10Under >= 2 ? 0 : -1;
    const f7Note = "Last 10 digits: " + last10Under + "/10 under 5";
    const scores = [f1Score, f2Score, f3Score, f4Score, f5Score, f6Score, f7Score];
    const totalScore = scores.reduce((a,b) => a+b, 0);
    const maxScore = 14;
    const rawConf = Math.round(((totalScore + maxScore/2) / (maxScore * 1.5)) * 100);
    const confidence = Math.min(Math.max(rawConf, 5), 94);
    const verdict = confidence >= 65 ? "ENTER" : confidence >= 50 ? "CAUTION" : "WAIT";
    const signal = confidence >= 65 ? "green" : confidence >= 50 ? "yellow" : "red";
    const recommendedDigit = confidence >= 55 ? coldestUnder5.digit : null;
    const analysisLog = [
      "=== ROMANS 8:28 ORACLE -- UNDER 5 ANALYSIS ===",
      "Ticks: " + digits.length + " | Symbol: " + symbol + " | " + new Date().toLocaleTimeString(),
      "",
      "F1 Base rate:  " + f1Note,
      "F2 Bot signal: " + f2Note,
      "F3 Momentum:   " + f3Note,
      "F4 Streak:     " + f4Note,
      "F5 Cold digit: " + f5Note,
      "F6 Gap:        " + f6Note,
      "F7 Recent:     " + f7Note,
      "",
      "SCORE: " + totalScore + "/" + (maxScore/2) + " -> Confidence: " + confidence + "%",
      "VERDICT: " + verdict + (recommendedDigit !== null ? " -> Set prediction = " + recommendedDigit : ""),
    ].join("\n");
    const factors = [
      { label:"UNDER-5 RATE", value: under5Rate.toFixed(1) + "%", score: f1Score },
      { label:"BOT SIGNAL (2x U5)", value: last2Under ? "YES" : "NO", score: f2Score },
      { label:"MOMENTUM", value: momentumDiff > 0 ? "GAINING" : momentumDiff === 0 ? "FLAT" : "LOSING", score: f3Score },
      { label:"STREAK", value: streak + "x " + streakType, score: f4Score },
      { label:"COLDEST U5 DIGIT", value: "Digit " + coldestUnder5.digit + " (" + coldestUnder5.count + "/50)", score: f5Score },
      { label:"GAP SINCE U5", value: gapSinceLast + " ticks", score: f6Score },
      { label:"LAST 10 RATE", value: last10Under + "/10", score: f7Score },
      { label:"CONFIDENCE", value: confidence + "%", score: confidence >= 65 ? 2 : confidence >= 50 ? 1 : -1 },
    ];
    await new Promise(r => setTimeout(r, 600));
    setU5Result({ verdict, confidence, recommendedDigit, signal, factors, analysisLog });
    setU5Predicting(false);
  };

  const connectWS = useCallback((sym) => {

    // Close existing connection cleanly
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent stale close handler firing
      wsRef.current.close();
      wsRef.current = null;
    }

    setWsStatus("connecting");
    setConnLog(`Connecting to Deriv WebSocket for ${sym}...`);
    setTicks([]);
    setDigits([]);
    ticksRef.current = [];
    aiCounterRef.current = 0;
    setAiInsight("");

    const ws = new WebSocket(DERIV_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnLog("WebSocket open — authorizing...");
      ws.send(JSON.stringify({ authorize: derivToken || DERIV_TOKEN_DEFAULT }));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      // Auth response
      if (msg.msg_type === "authorize") {
        if (msg.error) {
          // Auth failed but public tick data still works — continue anyway
          setConnLog(`Note: ${msg.error.message} — using public data feed.`);
          ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
          ws.send(JSON.stringify({ ticks_history: sym, adjust_start_time: 1, count: 100, end: "latest", style: "ticks" }));
          return;
        }
        const acc = msg.authorize;
        if (acc?.balance !== undefined) {
          setBalance(parseFloat(acc.balance).toFixed(2));
          setCurrency(acc.currency || "USD");
        }
        setConnLog(`Authorized ✓ ${acc?.loginid || ""} — loading accounts...`);
        ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
        ws.send(JSON.stringify({ ticks_history: sym, adjust_start_time: 1, count: 100, end: "latest", style: "ticks" }));
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        // Request account list so user can switch between demo/real
        ws.send(JSON.stringify({ account_list: 1 }));
      }

      // Historical ticks pre-fill
      if (msg.msg_type === "history" && msg.history?.prices) {
        const prices = msg.history.prices.map(p => parseFloat(p));
        ticksRef.current = prices;
        setTicks([...prices]);
        setDigits(getLastDigits(prices));
        setTickCount(prices.length);
        setWsStatus("live");
        setConnLog(`✓ ${prices.length} historical ticks loaded. Live stream active.`);
      }

      // Live tick stream
      if (msg.msg_type === "tick" && msg.tick?.quote) {
        const price = parseFloat(msg.tick.quote);
        const updated = [...ticksRef.current.slice(-299), price];
        ticksRef.current = updated;
        setTicks([...updated]);
        setDigits(getLastDigits(updated));
        setTickCount(c => c + 1);
        tickIndexRef.current += 1;
        setWsStatus("live");

        // ── PAPER TRADE RESOLVER ──────────────────────────────────────────
        if (pendingTradeRef.current) {
          const pt = pendingTradeRef.current;
          const actualDigit = parseInt(parseFloat(price).toFixed(2).slice(-1));
          const won = pt.betType === "DIFFERS"
            ? actualDigit !== pt.digit   // DIFFERS wins when digit does NOT match
            : actualDigit === pt.digit;  // MATCHES wins when digit matches
          const pnl = won ? parseFloat((pt.stake * pt.payout).toFixed(2)) : -pt.stake;
          const resolved = { ...pt, result: won ? "WIN" : "LOSS", actualDigit, pnl, resolvedAt: tickIndexRef.current };
          const updatedTrades = [...paperTradesRef.current, resolved];
          paperTradesRef.current = updatedTrades;
          setPaperTrades([...updatedTrades]);
          setPaperBalance(b => parseFloat((b + pnl).toFixed(2)));
          // Track consecutive losses
          setConsecutiveLosses(prev => won ? 0 : prev + 1);
          // Track which bet type performs better
          setBestTradeType(prev => {
            const all = [...paperTradesRef.current];
            const matchWins = all.filter(t => t.betType === "MATCHES" && t.result === "WIN").length;
            const matchTotal = all.filter(t => t.betType === "MATCHES").length || 1;
            const diffWins = all.filter(t => t.betType === "DIFFERS" && t.result === "WIN").length;
            const diffTotal = all.filter(t => t.betType === "DIFFERS").length || 1;
            return (matchWins/matchTotal) >= (diffWins/diffTotal) ? "MATCHES" : "DIFFERS";
          });
          // Track win rate over time for chart
          setWinRateHistory(prev => {
            const resolved2 = [...paperTradesRef.current];
            const wins2 = resolved2.filter(t => t.result === "WIN").length;
            const execWR = resolved2.length ? parseFloat(((wins2 / resolved2.length) * 100).toFixed(1)) : 0;
            const totalPnl2 = resolved2.reduce((s, t) => s + t.pnl, 0);
            return [...prev.slice(-99), { trade: resolved2.length, winRate: execWR, pnl: parseFloat(totalPnl2.toFixed(2)) }];
          });
          pendingTradeRef.current = null;
          setPendingTrade(null);
        }

        // ── PHASE 4: Fire live trade on each tick when armed ──────────────
        if (execArmed && !execFiring) {
          fireTrade(getLastDigits(updated), tickIndexRef.current);
        }

        // ── PHASE 4: Fire live trade on each tick when armed ────────────
        if (execArmed && !execFiring) {
          fireTrade(getLastDigits(updated), tickIndexRef.current);
        }

        // ── PHASE 4: Fire live trade on each tick when armed ────────────
        if (execArmed && !execFiring) {
          fireTrade(getLastDigits(updated), tickIndexRef.current);
        }

        // ── PHASE 4: Fire live trade on each tick when armed ────
        if (execArmed && !execFiring) {
          fireTrade(getLastDigits(updated), tickIndexRef.current);
        }

  // Auto AI every 25 new ticks
        aiCounterRef.current += 1;
        if (autoAIRef.current && aiCounterRef.current % 25 === 0) {
          triggerAIRef.current && triggerAIRef.current(updated);
        }
        // ---- LAB: accumulate digit on every live tick ----
        const labNewDigit = parseInt(parseFloat(price).toFixed(2).slice(-1));
        labTickBufferRef.current = [...labTickBufferRef.current.slice(-99999), labNewDigit];
        labAutoCounterRef.current += 1;
        setLabTickTotal(labTickBufferRef.current.length);
        if (labAutoCounterRef.current % 500 === 0) {
          saveLabRef.current && saveLabRef.current(sym, labTickBufferRef.current);
          if (runLabAnalysisRef.current && labTickBufferRef.current.length >= 1000) {
            runLabAnalysisRef.current();
          }
        }
      }

      // Account list — populate demo/real switcher
      if (msg.msg_type === "account_list" && msg.account_list) {
        const accounts = msg.account_list.map(a => ({
          loginid: a.loginid,
          is_virtual: a.is_virtual,
          currency: a.currency || "USD",
          token: a.token,
          label: (a.is_virtual ? "🎮 DEMO" : "💰 REAL") + " · " + a.loginid + " · " + (a.currency || "USD"),
        }));
        setAccountList(accounts);
        // Auto-select virtual (demo) account if none selected yet
        const demo = accounts.find(a => a.is_virtual);
        if (!activeAccount && demo) {
          setActiveAccount(demo);
          setConnLog("✓ Accounts loaded — demo account selected by default. Switch in Execute tab.");
        }
      }

      // Live balance update
      if (msg.msg_type === "balance" && msg.balance?.balance !== undefined) {
        setBalance(parseFloat(msg.balance.balance).toFixed(2));
        setCurrency(msg.balance.currency || "USD");
      }

      // Surface non-auth errors in log
      if (msg.error && msg.msg_type !== "authorize") {
        setConnLog(`⚠ ${msg.error.message}`);
      }
    };

    ws.onerror = () => {
      setWsStatus("error");
      setConnLog("⚠ WebSocket connection error. Check network or try again.");
    };

    ws.onclose = (ev) => {
      // Only log if this was an unexpected close (not triggered by disconnectWS)
      if (wsRef.current === ws) {
        setConnLog(`Connection closed (code ${ev.code}). Click Connect to reconnect.`);
        setWsStatus("idle");
      }
    };
  }, []); // intentionally empty — uses refs for dynamic values

  const disconnectWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null; // suppress the onclose handler
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsStatus("idle");
    setConnLog("Disconnected.");
  }, []);

  // Load demo data
  const loadDemo = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    const demo = [];
    let v = 1000 + Math.random() * 500;
    for (let i = 0; i < 100; i++) { v += (Math.random() - 0.49) * 2.5; demo.push(parseFloat(v.toFixed(3))); }
    ticksRef.current = demo;
    setTicks(demo);
    setDigits(getLastDigits(demo));
    setTickCount(demo.length);
    setWsStatus("demo");
    setConnLog("Demo mode — 100 synthetic ticks loaded. Click '⚡ Connect Live' for real data.");
  }, []);

  // Symbol change — reconnect if already live
  useEffect(() => { wsStatusRef.current = wsStatus; }, [wsStatus]);
  useEffect(() => { paperTradesRef.current = paperTrades; }, [paperTrades]);
  useEffect(() => { pendingTradeRef.current = pendingTrade; }, [pendingTrade]);

  // ---- LAB: persist buffer to window.storage ----
  const saveLabToStorage = useCallback(async (sym, buf) => {
    try { await window.storage.set("ticklab-" + sym, JSON.stringify(buf.slice(-100000))); } catch(e) {}
  }, []);
  useEffect(() => { saveLabRef.current = saveLabToStorage; }, [saveLabToStorage]);

  // ---- LAB: run all statistical tests on buffered digits ----
  const runLabAnalysis = useCallback(() => {
    const buf = labTickBufferRef.current;
    if (buf.length < 100) return;
    setLabRunning(true);
    setTimeout(() => {
      try {
        const chi = labRunChiSquare(buf);
        const trans = buf.length >= 200 ? labBuildTransMatrix(buf) : null;
        const persist = buf.length >= 5000 ? labRunPersistence(buf) : null;
        const verdict = labComputeVerdict(chi, trans, persist);
        setLabStats({ chi, trans, persist, verdict, n: buf.length, ts: Date.now() });
      } catch(e) {}
      setLabRunning(false);
    }, 50);
  }, []);
  useEffect(() => { runLabAnalysisRef.current = runLabAnalysis; }, [runLabAnalysis]);

  // ---- LAB: clear all stored data for active symbol ----
  const clearLabData = useCallback(async () => {
    labTickBufferRef.current = [];
    labAutoCounterRef.current = 0;
    setLabTickTotal(0);
    setLabStats(null);
    try { await window.storage.delete("ticklab-" + symbol); } catch(e) {}
  }, [symbol]);

  // ---- LAB: load stored ticks from storage when symbol changes ----
  useEffect(() => {
    labTickBufferRef.current = [];
    labAutoCounterRef.current = 0;
    setLabTickTotal(0);
    setLabStats(null);
    (async () => {
      try {
        const stored = await window.storage.get("ticklab-" + symbol);
        if (stored && stored.value) {
          const arr = JSON.parse(stored.value);
          if (Array.isArray(arr) && arr.length > 0) {
            labTickBufferRef.current = arr;
            setLabTickTotal(arr.length);
          }
        }
      } catch(e) {}
    })();
  }, [symbol]);

  // ── PAPER TRADE LOGGER ────────────────────────────────────────────────────
  const logPaperTrade = useCallback((digit, confidence, winProb, halfKelly, betType) => {
    if (pendingTradeRef.current) return; // one trade at a time
    const autoStake = parseFloat((paperBalance * halfKelly / 100).toFixed(2));
    const stake = Math.max(1, Math.min(autoStake, paperBalance * 0.2)); // cap at 20% bankroll
    const trade = {
      id: Date.now(),
      digit,
      betType: betType || "MATCHES",
      confidence,
      winProb,
      stake: parseFloat(paperStake || stake),
      payout: betType === "DIFFERS" ? 0.95 : paperPayout,
      symbol,
      placedAt: tickIndexRef.current,
      result: "PENDING",
      actualDigit: null,
      pnl: 0,
    };
    pendingTradeRef.current = trade;
    setPendingTrade(trade);
  }, [paperBalance, paperStake, paperPayout, symbol]);

  // Paper trading computed stats
  const ptStats = (() => {
    const resolved = paperTrades.filter(t => t.result !== "PENDING");
    const wins = resolved.filter(t => t.result === "WIN");
    const totalPnl = resolved.reduce((s, t) => s + t.pnl, 0);
    const winRate = resolved.length ? ((wins.length / resolved.length) * 100).toFixed(1) : "0.0";
    const avgConf = resolved.length ? (resolved.reduce((s, t) => s + t.confidence, 0) / resolved.length).toFixed(1) : "0.0";
    const targetMet = resolved.length >= 200 && parseFloat(winRate) >= 12;
    // Break down by bet type
    const matchTrades = resolved.filter(t => t.betType === "MATCHES");
    const matchWins = matchTrades.filter(t => t.result === "WIN");
    const differsTrades = resolved.filter(t => t.betType === "DIFFERS" || !t.betType);
    const differsWins = differsTrades.filter(t => t.result === "WIN");
    const matchWR = matchTrades.length ? ((matchWins.length / matchTrades.length) * 100).toFixed(1) : "—";
    const differsWR = differsTrades.length ? ((differsWins.length / differsTrades.length) * 100).toFixed(1) : "—";
    return {
      total: resolved.length, wins: wins.length,
      losses: resolved.length - wins.length, winRate,
      totalPnl: totalPnl.toFixed(2), avgConf, targetMet,
      matchWR, differsWR,
      matchTotal: matchTrades.length, differsTotal: differsTrades.length,
    };
  })();

  // Multi-strategy signals + alerts (computed every render with latest data)
  const allSignals = (digits.length >= 20 && ticks.length > 1)
    ? getAllStrategySignals(digits, ticks, barrier, matchTarget) : null;
  const streakAlerts = digits.length >= 10
    ? getStreakAlerts(digits, ticks, barrier) : [];
  const bestSignal = allSignals ? allSignals[0] : null;

  // Predict tab derived values (computed here to avoid IIFE in JSX)
  const predictScores = digits.length >= 20 ? (getPredictionScores(digits) || []) : [];
  const predictTopPick = predictScores[0] || null;
  const predictMatrix = digits.length >= 20 ? getTransitionMatrix(digits) : null;
  const predictLastDigit = digits.length > 0 ? digits[digits.length - 1] : null;


  // ---- Lab tab computed vars (all above return -- no IIFE in JSX) ----
  const labN = labTickTotal;
  const labUnlockChi = labN >= 1000;
  const labUnlockPersistence = labN >= 5000;
  const labUnlockVerdict = labN >= 50000;
  const labChiPct = Math.min(100, Math.round((labN / 1000) * 100));
  const labPersPct = Math.min(100, Math.round((labN / 5000) * 100));
  const labVerdictPct = Math.min(100, Math.round((labN / 50000) * 100));
  const labVerdictColor = !labStats ? "var(--text-dim)" : labStats.verdict === "CLEAN" ? "var(--green)" : labStats.verdict === "SIGNAL" ? "var(--cyan)" : "var(--orange)";
  const labVerdictText = !labStats ? "AWAITING ANALYSIS" : labStats.verdict === "CLEAN" ? "NO SIGNAL DETECTED" : labStats.verdict === "SIGNAL" ? "SIGNAL DETECTED" : "MARGINAL -- COLLECT MORE DATA";
  const labVerdictDesc = !labStats ? "Collect 1,000+ ticks then click Run Analysis." : labStats.verdict === "CLEAN" ? "All tests pass randomness. Any predictor built on this data amplifies noise. Base rate is your only edge." : labStats.verdict === "SIGNAL" ? "Statistically significant deviation found. See test details below before acting." : "One test flagged weakly. Continue collecting data before drawing conclusions.";
  const labChiColor = !labStats || !labStats.chi ? "var(--text-dim)" : labStats.chi.pValue > 0.05 ? "var(--green)" : labStats.chi.pValue > 0.01 ? "var(--orange)" : "var(--red)";
  const labChiVerdict = !labStats || !labStats.chi ? "--" : labStats.chi.pValue > 0.05 ? "UNIFORM (p=" + labStats.chi.pValue + ")" : labStats.chi.pValue > 0.01 ? "WEAK BIAS (p=" + labStats.chi.pValue + ")" : "BIAS DETECTED (p=" + labStats.chi.pValue + ")";
  const labTransSigRows = labStats && labStats.trans ? labStats.trans.rowTests.filter(r => r.pValue !== null && r.pValue < 0.05) : [];
  const labTransColor = !labStats || !labStats.trans ? "var(--text-dim)" : labTransSigRows.length === 0 ? "var(--green)" : labTransSigRows.length <= 2 ? "var(--orange)" : "var(--red)";
  const labTransVerdict = !labStats || !labStats.trans ? "--" : labTransSigRows.length === 0 ? "INDEPENDENT" : labTransSigRows.length + " row(s) flagged (p < 0.05)";
  const labPersColor = !labStats || !labStats.persist ? "var(--text-dim)" : labStats.persist.consistent ? "var(--green)" : "var(--orange)";
  const labPersVerdict = !labStats || !labStats.persist ? "--" : labStats.persist.consistent ? "CONSISTENT (drift=" + labStats.persist.drift + ")" : "INCONSISTENT (drift=" + labStats.persist.drift + ")";
  const labLastTs = labStats ? new Date(labStats.ts).toLocaleTimeString() : "never";
  const labFreqBars = labStats && labStats.chi ? labStats.chi.freq.map((count, d) => {
    const pct = parseFloat(((count / labStats.chi.n) * 100).toFixed(1));
    const dev = parseFloat((pct - 10.0).toFixed(1));
    const barW = Math.round((count / Math.max(...labStats.chi.freq, 1)) * 100);
    const col = pct > 11.5 ? "var(--orange)" : pct < 8.5 ? "var(--cyan)" : "var(--green)";
    return { d, count, pct, dev, barW, col };
  }) : [];

  // ── BOT STORAGE HANDLERS ─────────────────────────────────────────────────
  const saveBotToStorage = async (botData, improvedXmlStr) => {
    try {
      const id = "bot-" + Date.now();
      const entry = {
        id, name: botData.contractType + "-" + botData.strategy + "-" + id.slice(-6),
        strategy: botData.strategy, contractType: botData.contractType,
        stake: botData.stake, martingale: botData.martingale,
        stopLoss: botData.stopLoss, takeProfit: botData.takeProfit,
        symbol: botData.symbol, targetDigit: botData.targetDigit,
        originalXml: botData.raw, improvedXml: improvedXmlStr || null,
        savedAt: new Date().toISOString(), symbol: symbol,
      };
      await window.storage.set(id, JSON.stringify(entry));
      // Update index
      let indexRaw = null;
      try { indexRaw = await window.storage.get("bot-index"); } catch(e) {}
      const index = indexRaw ? JSON.parse(indexRaw.value) : [];
      index.push({ id, name: entry.name, savedAt: entry.savedAt, strategy: entry.strategy });
      await window.storage.set("bot-index", JSON.stringify(index));
      setStorageStatus("✓ Bot saved — ID: " + id.slice(-8));
      loadStoredBots();
    } catch(e) {
      setStorageStatus("Storage error: " + e.message);
    }
  };

  const loadStoredBots = async () => {
    try {
      let indexRaw = null;
      try { indexRaw = await window.storage.get("bot-index"); } catch(e) {}
      if (!indexRaw) { setStoredBots([]); return; }
      const index = JSON.parse(indexRaw.value);
      const bots = [];
      for (const entry of index) {
        try {
          const raw = await window.storage.get(entry.id);
          if (raw) bots.push(JSON.parse(raw.value));
        } catch(e) {}
      }
      setStoredBots(bots);
    } catch(e) {
      setStorageStatus("Load error: " + e.message);
    }
  };

  const deleteStoredBot = async (botId) => {
    try {
      await window.storage.delete(botId);
      let indexRaw = null;
      try { indexRaw = await window.storage.get("bot-index"); } catch(e) {}
      if (indexRaw) {
        const index = JSON.parse(indexRaw.value).filter(e => e.id !== botId);
        await window.storage.set("bot-index", JSON.stringify(index));
      }
      setStorageStatus("Bot deleted.");
      loadStoredBots();
    } catch(e) {
      setStorageStatus("Delete error: " + e.message);
    }
  };

  const handleBotFileUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const xmlStr = e.target.result;
      const parsed = parseBotXML(xmlStr);
      setUploadedBots(prev => [...prev, parsed]);
      setSelectedBotIdx(prev => (uploadedBots.length));
      setBotAiOutput("");
      setImprovedXml("");
    };
    reader.readAsText(file);
  };

  const [generatingModel, setGeneratingModel] = useState("");

  const handleGenerateBot = async () => {
    const bot = uploadedBots[selectedBotIdx];
    if (!bot) return;
    setBotLoading(true);
    setGeneratingModel("DeepSeek R1");
    setBotAiOutput("⟳ Step 1/3: Building market analysis report...");
    setImprovedXml("");
    const health = checkBotHealth(bot, ptStats);
    const match = getBotMarketMatch(bot, digits, ticks, ptStats);
    const report = buildAnalysisReport(digits, ticks, ptStats, symbol);
    setBotAiOutput("⟳ Step 2/3: Packaging context — " + (bot.raw ? bot.raw.length : 0) + " XML chars, " + digits.length + " ticks, " + (ptStats.total || 0) + " paper trades...");
    const marketCtx = {
      symbol, tickCount: digits.length,
      hotDigits: hotCold.hot, coldDigits: hotCold.cold,
      differsWinRate: ptStats.differsWR, matchesWinRate: ptStats.matchWR,
      totalTrades: ptStats.total, currentBalance: balance,
      botHealth: health.health, botScore: health.score,
      marketMatch: match.score,
    };
    setBotAiOutput("⟳ Step 3/3: Sending to AI — trying DeepSeek R1 → Qwen3 235B → Llama 4 → Groq...");
    const result = await generateImprovedBot(bot.raw, marketCtx, report);
    if (!result.text) {
      const errList = (result.errors || []).join("\n");
      setBotAiOutput("✗ All AI engines failed.\n\nErrors:\n" + errList + "\n\nTip: Connect live data and run a few paper trades first to provide richer market context.");
    } else {
      const xmlText = result.text;
      const isXml = xmlText.trim().startsWith("<?xml") || xmlText.trim().startsWith("<xml") || xmlText.trim().startsWith("<strategy") || xmlText.includes("<strategy") || xmlText.includes("trade_type");
      const cleanXml = xmlText.replace(/^```xml\n?|^```\n?|\n?```$/g, "").trim();
      setImprovedXml(cleanXml);
      setGeneratingModel(result.model || "");
      setBotAiOutput("✓ Generated by: " + result.model + " [" + result.engine + "]\n\nBot improved successfully. Key changes applied based on:\n· Symbol: " + symbol + "\n· Hot digits: " + (hotCold.hot.join(", ")||"none") + "\n· Cold digits (DIFFERS targets): " + (hotCold.cold.join(", ")||"none") + "\n· DIFFERS win rate: " + ptStats.differsWR + "%\n\nReview the XML below, then download or save to cloud storage.");
    }
    setBotLoading(false);
  };


  // ── SEED EXAMPLE BOTS TO STORAGE (runs once on mount) ───────────────────
  useEffect(() => {
    const seedExampleBots = async () => {
      try {
        let indexRaw = null;
        try { indexRaw = await window.storage.get("bot-index"); } catch(e) {}
        if (indexRaw) return; // Already seeded
        // Seed the 4 validated Deriv bot XML files as reference bots
        const exampleBots = [
          { id: "bot-example-digitdiff", name: "DIGITDIFF-DIFFERS-example", strategy: "DIFFERS", contractType: "DIGITDIFF", stake: "10", martingale: 1, stopLoss: "50", takeProfit: "100", symbol: "1HZ100V", targetDigit: null, originalXml: "<!-- REPETEWIN DIGITDIFF bot — uploaded by user, validated on Deriv -->", improvedXml: null, savedAt: "2025-01-01T00:00:00.000Z", isExample: true },
          { id: "bot-example-differs2", name: "123DIFFER-DIFFERS-example", strategy: "DIFFERS", contractType: "DIGITDIFF", stake: "1", martingale: 1, stopLoss: "500", takeProfit: "500", symbol: "R_50", targetDigit: null, originalXml: "<!-- 123Differ_2 bot — uploaded by user, validated on Deriv -->", improvedXml: null, savedAt: "2025-01-01T00:00:01.000Z", isExample: true },
          { id: "bot-example-digitdiff-p", name: "DIGITDIFF-P-DIFFERS-example", strategy: "DIFFERS", contractType: "DIGITDIFF", stake: "2.5", martingale: 1, stopLoss: null, takeProfit: null, symbol: "R_100", targetDigit: null, originalXml: "<!-- Bot_DIGITDIFF_P — uploaded by user, validated on Deriv -->", improvedXml: null, savedAt: "2025-01-01T00:00:02.000Z", isExample: true },
          { id: "bot-example-overprofit", name: "DIGITOVER-OVER-example", strategy: "OVER", contractType: "DIGITOVER", stake: "0.5", martingale: 1.5, stopLoss: "50", takeProfit: "5", symbol: "R_10", targetDigit: null, originalXml: "<!-- BINARY_BOT_OVER_PROFIT — uploaded by user, validated on Deriv -->", improvedXml: null, savedAt: "2025-01-01T00:00:03.000Z", isExample: true },
        ];
        const index = [];
        for (const bot of exampleBots) {
          await window.storage.set(bot.id, JSON.stringify(bot));
          index.push({ id: bot.id, name: bot.name, savedAt: bot.savedAt, strategy: bot.strategy });
        }
        await window.storage.set("bot-index", JSON.stringify(index));
        // Also store format knowledge for AI
        const formatDoc = {
          version: "1.0",
          validatedFormats: ["DIGITDIFF","DIGITMATCH","DIGITOVER","DIGITUNDER","CALL","PUT","EVEN","ODD"],
          requiredBlocks: ["trade","before_purchase","after_purchase"],
          rootElement: '<xml xmlns="http://www.w3.org/1999/xhtml" collection="false">',
          symbolMap: { "1HZ100V": "Volatility 100 (1s)", "R_50": "Volatility 50", "R_100": "Volatility 100", "R_10": "Volatility 10", "JD10": "Jump 10" },
          tradeTypesForDIFFERS: { TRADETYPECAT_LIST: "digits", TRADETYPE_LIST: "matchesdiffers", TYPE_LIST: "DIGITDIFF", PURCHASE_LIST: "DIGITDIFF" },
          validatedBotIds: ["bot-example-digitdiff","bot-example-differs2","bot-example-digitdiff-p","bot-example-overprofit"],
          note: "These 4 bots were successfully uploaded to Deriv without errors — use their structure as reference.",
        };
        await window.storage.set("deriv-bot-format-doc", JSON.stringify(formatDoc));
      } catch(e) {
        // Silent fail — storage seeding is non-critical
      }
    };
    seedExampleBots();
  }, []);

  const handleSymbolChange = useCallback((sym) => {
    setSymbol(sym);
    if (wsStatusRef.current === "live" || wsStatusRef.current === "connecting") {
      connectWS(sym);
    }
  }, [connectWS]);

  // Cleanup WebSocket on component unmount
  useEffect(() => () => {
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
  }, []);

  const statusClass = { idle: "pill-demo", connecting: "pill-connecting", live: "pill-live", error: "pill-error", demo: "pill-demo" };
  const statusLabel = { idle: "OFFLINE", connecting: "CONNECTING...", live: "● LIVE", error: "ERROR", demo: "DEMO MODE" };

  // Under 5 tab live computed vars
  const u5Last30 = digits.slice(-30);
  const u5Rate30 = u5Last30.length > 0 ? Math.round((u5Last30.filter(d => d < 5).length / u5Last30.length) * 100) : 0;
  const u5Last10 = digits.slice(-10);
  const u5Rate10 = u5Last10.length > 0 ? Math.round((u5Last10.filter(d => d < 5).length / u5Last10.length) * 100) : 0;
  let u5CurrentStreak = 0; let u5StreakType = "--";
  for (let _u5i = digits.length - 1; _u5i >= 0; _u5i--) {
    const _isU5 = digits[_u5i] < 5;
    if (u5StreakType === "--") { u5StreakType = _isU5 ? "UNDER" : "OVER"; u5CurrentStreak = 1; }
    else if ((_isU5 && u5StreakType === "UNDER") || (!_isU5 && u5StreakType === "OVER")) u5CurrentStreak++;
    else break;
  }
  let u5GapSinceLast = 0;
  for (let _u5j = digits.length - 1; _u5j >= 0; _u5j--) { if (digits[_u5j] < 5) break; u5GapSinceLast++; }

    // Execute tab computed vars (extracted from JSX IIFE -- keep before return)
  const execColdDigit = hotCold.cold.length > 0 ? hotCold.cold[0] : null;
  const execHotDigit  = hotCold.hot.length  > 0 ? hotCold.hot[0]  : null;
  const execWins   = execTradesRef.current.filter(t => t.status === "WIN").length;
  const execLosses = execTradesRef.current.filter(t => t.status === "LOSS").length;
  const execTotal  = execWins + execLosses;
  const execWR     = execTotal > 0 ? ((execWins / execTotal) * 100).toFixed(1) : "--";
  const execLatClass = latencyMs === null ? "latency-ok" : latencyMs < 80 ? "latency-good" : latencyMs < 200 ? "latency-ok" : "latency-bad";

  return (
    <>
      <style>{css}</style>
      <div className="terminal">
        <div className="scanlines" />

        {/* HEADER */}
        <div className="header">
          <div className="logo">
            <div className="logo-mark"><span>R</span></div>
            <div>
              <div className="logo-text">ROMANS 8:28 ORACLE</div>
              <div className="logo-sub">And we know that in all things God works for the good · v3.0</div>
            </div>
          </div>
          <div className="header-right">
            {balance && (
              <div className="balance-bar">
                <div className="balance-currency">{currency}</div>
                <div className="balance-val">{balance}</div>
              </div>
            )}
            <div className={`status-pill ${statusClass[wsStatus]}`}>
              {wsStatus === "live" && <span className="blink" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />}
              {statusLabel[wsStatus]}
            </div>
            {ticks.length > 0 && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{ticks.length} TICKS</div>}
          </div>
        </div>

        <div className="main">

          {/* SYMBOL SELECTOR */}
          <div className="symbol-bar">
            <span className="symbol-label">INDEX:</span>
            {SYMBOLS.map(s => (
              <button key={s.id} className={`sym-btn ${symbol === s.id ? "active" : ""}`} onClick={() => handleSymbolChange(s.id)} title={s.label}>
                {s.short}
              </button>
            ))}
          </div>

          {/* CONTROLS */}
          <div className="controls-bar">
            <button className="btn btn-green" onClick={() => connectWS(symbol)} disabled={wsStatus === "connecting"}>
              {wsStatus === "connecting" ? "⟳ Connecting..." : "⚡ Connect Live"}
            </button>
            {(wsStatus === "live" || wsStatus === "connecting") && (
              <button className="btn btn-red" onClick={disconnectWS}>■ Disconnect</button>
            )}
            <button className="btn btn-ghost" onClick={loadDemo}>Demo Data</button>
            {ticks.length > 0 && (
              <button className="btn btn-orange" onClick={() => triggerAI()} disabled={isAnalyzing}>
                {isAnalyzing ? "⟳ Analyzing..." : "🧠 AI Insights"}
              </button>
            )}
            {ticks.length > 0 && (
              <button className={`btn ${autoAI ? "btn-cyan" : "btn-ghost"}`} onClick={() => setAutoAI(a => !a)}>
                {autoAI ? "✓ Auto-AI ON" : "Auto-AI OFF"}
              </button>
            )}
            <div className="conn-log">{connLog}</div>
          </div>

          {/* LIVE STATS BAR */}
          {ticks.length > 0 && evenOdd && riseFall && (
            <div className="live-stats">
              <div className="live-stat">
                <span className="live-stat-label">SYMBOL</span>
                <span className="live-stat-val green">{symbol}</span>
              </div>
              <div className="live-stat">
                <span className="live-stat-label">LAST PRICE</span>
                <span className="live-stat-val" style={{ color: "var(--cyan)" }}>{parseFloat(ticks[ticks.length - 1]).toFixed(3)}</span>
              </div>
              <div className="live-stat">
                <span className="live-stat-label">LAST DIGIT</span>
                <span className="live-stat-val" style={{ color: "var(--yellow)" }}>{digits[digits.length - 1]}</span>
              </div>
              <div className="live-stat">
                <span className="live-stat-label">MOMENTUM</span>
                <span className={`live-stat-val ${riseFall.streakType === "RISE" ? "green" : "red"}`}>
                  {riseFall.streak}× {riseFall.streakType}
                </span>
              </div>
              <div className="live-stat">
                <span className="live-stat-label">E/O STREAK</span>
                <span className={`live-stat-val ${evenOdd.streakType === "EVEN" ? "cyan" : "yellow"}`}>
                  {evenOdd.streak}× {evenOdd.streakType}
                </span>
              </div>
              <div className="live-stat">
                <span className="live-stat-label">HOT DIGITS</span>
                <span className="live-stat-val orange">{hotCold.hot.join(" · ")}</span>
              </div>
              <div className="live-stat">
                <span className="live-stat-label">TICKS RX</span>
                <span className="live-stat-val dim">{tickCount}</span>
              </div>
            </div>
          )}

          {/* DIGIT FREQUENCY -- always visible when data loaded */}
          {digits.length > 0 && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-title"><span className="dot dot-orange" />Last Digit Frequency — {symbol}</div>
              <div className="digit-freq-grid">
                {freqData.map(({ digit, count, pct }) => {
                  const isHot = hotCold.hot.includes(digit);
                  const isCold = hotCold.cold.includes(digit);
                  return (
                    <div key={digit} className={`digit-cell ${isHot ? "hot" : isCold ? "cold" : ""}`}>
                      <div className={`digit-num ${isHot ? "orange" : isCold ? "cyan" : "green"}`}>{digit}</div>
                      <div className="digit-pct">{pct}%</div>
                      <div style={{ width: "100%", marginTop: 3 }}>
                        <div className="bar-track" style={{ height: 3 }}>
                          <div className="bar-fill" style={{ width: `${(count / maxFreq) * 100}%`, background: isHot ? "var(--orange)" : isCold ? "var(--cyan)" : "var(--green)" }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <span style={{ fontSize: 10, color: "var(--orange)" }}>🔥 HOT: {hotCold.hot.join(", ")}</span>
                <span style={{ fontSize: 10, color: "var(--cyan)" }}>❄ COLD: {hotCold.cold.join(", ")}</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>{digits.length} digits analyzed</span>
              </div>
            </div>
          )}

          {/* TABS - grouped nav + mobile dropdown */}
          {ticks.length > 0 && (
            <div className="tabs-wrapper">
              <select className="tab-mobile-select" value={activeTab} onChange={e => setActiveTab(e.target.value)}>
                <optgroup label="-- ANALYSIS --">
                  <option value="overview">Overview</option>
                  <option value="evenodd">Even/Odd</option>
                  <option value="risefall">Rise/Fall</option>
                  <option value="matchdiffer">Matches/Differs</option>
                  <option value="overunder">Over/Under</option>
                </optgroup>
                <optgroup label="-- TOOLS --">
                  <option value="signals">Signals</option>
                  <option value="predict">Predict</option>
                  <option value="under5">Under 5</option>
                  <option value="lab">Lab</option>
                </optgroup>
                <optgroup label="-- TRADE --">
                  <option value="papertrade">Paper Trade</option>
                  <option value="bots">Bots</option>
                  <option value="execute">Execute</option>
                </optgroup>
              </select>
              <div className="tabs-row">
                <div className="tab-group">
                  <span className="tab-group-badge">ANALYSIS</span>
                  {[["overview","Overview"],["evenodd","Even/Odd"],["risefall","Rise/Fall"],["matchdiffer","Matches/Differs"],["overunder","Over/Under"]].map(([id,label]) => (
                    <button key={id} className={"tab"+(activeTab===id?" active":"")} onClick={()=>setActiveTab(id)}>{label}</button>
                  ))}
                </div>
                <div className="tab-group">
                  <span className="tab-group-badge">TOOLS</span>
                  {[["signals","Signals"],["predict","Predict"],["under5","Under 5"],["lab","Lab"]].map(([id,label]) => (
                    <button key={id} className={"tab"+(activeTab===id?" active":"")} onClick={()=>setActiveTab(id)}>{label}</button>
                  ))}
                </div>
                <div className="tab-group">
                  <span className="tab-group-badge">TRADE</span>
                  {[["papertrade","Paper Trade"],["bots","Bots"],["execute","Execute"]].map(([id,label]) => (
                    <button key={id} className={"tab"+(activeTab===id?" active":"")} onClick={()=>setActiveTab(id)}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---- OVERVIEW TAB ---- */}
          {activeTab === "overview" && ticks.length > 0 && (
            <>
              <div className="grid-3">
                {/* Even/Odd */}
                <div className="panel accent-cyan">
                  <div className="panel-title"><span className="dot dot-cyan" />Even / Odd</div>
                  {evenOdd && <>
                    <div className="two-col" style={{ marginBottom: 10 }}>
                      <div className="signal-box" style={{ background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.2)" }}>
                        <div className="signal-label">Even</div>
                        <div className="signal-val cyan">{evenOdd.evenPct}%</div>
                        <div className="signal-conf">{evenOdd.even} ticks</div>
                      </div>
                      <div className="signal-box" style={{ background: "var(--yellow-dim)", border: "1px solid rgba(255,215,0,0.2)" }}>
                        <div className="signal-label">Odd</div>
                        <div className="signal-val yellow">{(100 - parseFloat(evenOdd.evenPct)).toFixed(1)}%</div>
                        <div className="signal-conf">{evenOdd.odd} ticks</div>
                      </div>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${evenOdd.evenPct}%`, background: "linear-gradient(90deg,var(--cyan),var(--yellow))" }} /></div>
                    <div className="stat-row" style={{ marginTop: 8 }}>
                      <span className="stat-label">Streak</span>
                      <span className={`streak-badge streak-${evenOdd.streakType?.toLowerCase()}`}>{evenOdd.streak}× {evenOdd.streakType}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Signal</span>
                      <span className="stat-val" style={{ color: "var(--green)", fontSize: 11 }}>
                        {evenOdd.streak >= 4 ? `→ BET ${evenOdd.streakType === "EVEN" ? "ODD" : "EVEN"}` : `→ RIDE ${evenOdd.streakType}`}
                      </span>
                    </div>
                  </>}
                </div>

                {/* Rise/Fall */}
                <div className="panel accent-orange">
                  <div className="panel-title"><span className="dot dot-orange" />Rise / Fall</div>
                  {riseFall && <>
                    <div className="two-col" style={{ marginBottom: 10 }}>
                      <div className="signal-box" style={{ background: "var(--green-dim)", border: "1px solid rgba(0,255,136,0.2)" }}>
                        <div className="signal-label">Rise</div>
                        <div className="signal-val green">{((riseFall.rises / (riseFall.rises + riseFall.falls || 1)) * 100).toFixed(1)}%</div>
                        <div className="signal-conf">{riseFall.rises}</div>
                      </div>
                      <div className="signal-box" style={{ background: "var(--red-dim)", border: "1px solid rgba(255,51,102,0.2)" }}>
                        <div className="signal-label">Fall</div>
                        <div className="signal-val red">{((riseFall.falls / (riseFall.rises + riseFall.falls || 1)) * 100).toFixed(1)}%</div>
                        <div className="signal-conf">{riseFall.falls}</div>
                      </div>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(riseFall.rises / (riseFall.rises + riseFall.falls || 1)) * 100}%`, background: "linear-gradient(90deg,var(--green),var(--red))" }} /></div>
                    <div className="stat-row" style={{ marginTop: 8 }}>
                      <span className="stat-label">Streak</span>
                      <span className={`streak-badge streak-${riseFall.streakType?.toLowerCase()}`}>{riseFall.streak}× {riseFall.streakType}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Signal</span>
                      <span className="stat-val" style={{ color: "var(--green)", fontSize: 11 }}>
                        {riseFall.streak >= 5 ? `→ FADE ${riseFall.streakType}` : `→ RIDE ${riseFall.streakType}`}
                      </span>
                    </div>
                  </>}
                </div>

                {/* Over/Under */}
                <div className="panel accent-yellow">
                  <div className="panel-title"><span className="dot dot-yellow" />Over / Under {barrier}</div>
                  {overUnder && <>
                    <div className="two-col" style={{ marginBottom: 10 }}>
                      <div className="signal-box" style={{ background: "var(--yellow-dim)", border: "1px solid rgba(255,215,0,0.2)" }}>
                        <div className="signal-label">Over {barrier}</div>
                        <div className="signal-val yellow">{overUnder.overPct}%</div>
                        <div className="signal-conf">{overUnder.over}</div>
                      </div>
                      <div className="signal-box" style={{ background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.2)" }}>
                        <div className="signal-label">Under {barrier}</div>
                        <div className="signal-val cyan">{overUnder.underPct}%</div>
                        <div className="signal-conf">{overUnder.under}</div>
                      </div>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${overUnder.overPct}%`, background: "var(--yellow)" }} /></div>
                    <div className="stat-row" style={{ marginTop: 8 }}>
                      <span className="stat-label">Signal</span>
                      <span className="stat-val" style={{ color: "var(--green)", fontSize: 11 }}>
                        {parseFloat(overUnder.overPct) > 58 ? `→ OVER ${barrier}` : parseFloat(overUnder.underPct) > 58 ? `→ UNDER ${barrier}` : "→ WAIT"}
                      </span>
                    </div>
                  </>}
                </div>
              </div>

              {/* AI Panel */}
              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="panel-title" style={{ justifyContent: "space-between" }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="dot dot-green" />AI Market Intelligence
                    <span style={{ color: "var(--green)", fontSize: 9 }}>GROQ · LLAMA-3.3-70B</span>
                    {wsStatus === "live" && <span style={{ fontSize: 9, color: "var(--text-dim)" }}>AUTO-UPDATES EVERY 25 TICKS</span>}
                  </span>
                  <button className="btn btn-green" onClick={() => triggerAI()} disabled={isAnalyzing} style={{ padding: "4px 12px" }}>
                    {isAnalyzing ? "⟳ Analyzing..." : "⚡ Run"}
                  </button>
                </div>
                <div className="ai-text" style={{ color: aiInsight ? "var(--text)" : "var(--text-dim)", fontStyle: aiInsight ? "normal" : "italic" }}>
                  {isAnalyzing ? "⟳ Processing live market patterns through neural analysis engine..." : aiInsight || `Connect live or load demo data, then click '⚡ Run' for AI market commentary on ${symbol}.`}
                </div>
              </div>

              {/* Price chart */}
              <div className="panel">
                <div className="panel-title"><span className="dot dot-orange" />Price Chart — {symbol} · Last {Math.min(ticks.length, 100)} Ticks {wsStatus === "live" && <span className="blink" style={{ color: "var(--green)", fontSize: 9 }}>● LIVE</span>}</div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={ticks.slice(-100).map((t, i) => ({ i, val: parseFloat(t) }))}>
                    <defs>
                      <linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ff88" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="i" hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fill: "#4a5260", fontSize: 10 }} width={55} />
                    <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }} formatter={v => [parseFloat(v).toFixed(3), "Price"]} />
                    <Area type="monotone" dataKey="val" stroke="#00ff88" strokeWidth={1.5} fill="url(#gGreen)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                {/* Tick tape */}
                <div className="tick-tape" style={{ marginTop: 8 }}>
                  {ticks.slice(-40).map((t, i, arr) => {
                    const up = i > 0 ? parseFloat(t) >= parseFloat(arr[i - 1]) : true;
                    return <span key={i} className={`tick-item ${up ? "up" : "dn"}`}>{parseFloat(t).toFixed(2)}{up ? "▲" : "▼"} </span>;
                  })}
                </div>
              </div>
            </>
          )}

          {/* ---- EVEN/ODD TAB ---- */}
          {activeTab === "evenodd" && evenOdd && (
            <div className="grid-2">
              <div className="panel accent-cyan">
                <div className="panel-title"><span className="dot dot-cyan" />Even/Odd Deep Analysis</div>
                <div className="two-col" style={{ marginBottom: 14 }}>
                  <div className="signal-box" style={{ background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.25)" }}>
                    <div className="signal-label">Even Count</div>
                    <div className="signal-val cyan">{evenOdd.even}</div>
                    <div className="signal-conf">{evenOdd.evenPct}%</div>
                  </div>
                  <div className="signal-box" style={{ background: "var(--yellow-dim)", border: "1px solid rgba(255,215,0,0.25)" }}>
                    <div className="signal-label">Odd Count</div>
                    <div className="signal-val yellow">{evenOdd.odd}</div>
                    <div className="signal-conf">{(100 - parseFloat(evenOdd.evenPct)).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="stat-row"><span className="stat-label">Bias</span><span className="stat-val" style={{ color: parseFloat(evenOdd.evenPct) > 52 ? "var(--cyan)" : parseFloat(evenOdd.evenPct) < 48 ? "var(--yellow)" : "var(--text-dim)" }}>{parseFloat(evenOdd.evenPct) > 52 ? "EVEN BIAS" : parseFloat(evenOdd.evenPct) < 48 ? "ODD BIAS" : "BALANCED"}</span></div>
                <div className="stat-row"><span className="stat-label">Current Streak</span><span className={`streak-badge streak-${evenOdd.streakType?.toLowerCase()}`}>{evenOdd.streak}× {evenOdd.streakType}</span></div>
                <div className="stat-row"><span className="stat-label">Risk Level</span><span className="stat-val" style={{ color: evenOdd.streak >= 5 ? "var(--red)" : evenOdd.streak >= 3 ? "var(--orange)" : "var(--green)" }}>{evenOdd.streak >= 5 ? "⚠ HIGH — REVERSAL LIKELY" : evenOdd.streak >= 3 ? "MODERATE" : "LOW"}</span></div>
                <hr className="divider" />
                <div className="stat-row"><span className="stat-label">Recommended</span><span className="stat-val green" style={{ fontSize: 12 }}>{evenOdd.streak >= 4 ? `BET ${evenOdd.streakType === "EVEN" ? "ODD" : "EVEN"} (REVERSAL)` : `RIDE ${evenOdd.streakType} (MOMENTUM)`}</span></div>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-cyan" />Last 20 Digits</div>
                <div className="last-digits-row">
                  {digits.slice(-20).map((d, i) => (
                    <div key={i} className="ld-chip" style={{ background: d % 2 === 0 ? "var(--cyan-dim)" : "var(--yellow-dim)", borderColor: d % 2 === 0 ? "rgba(0,191,255,0.3)" : "rgba(255,215,0,0.3)", color: d % 2 === 0 ? "var(--cyan)" : "var(--yellow)" }}>{d}</div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-cyan" />Even vs Odd Distribution</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={[{ name: "EVEN", count: evenOdd.even }, { name: "ODD", count: evenOdd.odd }]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="name" tick={{ fill: "#4a5260", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#4a5260", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      <Cell key="even" fill="var(--cyan)" /><Cell key="odd" fill="var(--yellow)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-green" />Per-Digit (Even=Cyan, Odd=Yellow)</div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={freqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="digit" tick={{ fill: "#4a5260", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#4a5260", fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {freqData.map((d, i) => <Cell key={i} fill={d.digit % 2 === 0 ? "var(--cyan)" : "var(--yellow)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ---- RISE/FALL TAB ---- */}
          {activeTab === "risefall" && riseFall && (
            <div className="grid-2">
              <div className="panel accent-orange">
                <div className="panel-title"><span className="dot dot-orange" />Rise/Fall Analysis</div>
                <div className="two-col" style={{ marginBottom: 14 }}>
                  <div className="signal-box" style={{ background: "var(--green-dim)", border: "1px solid rgba(0,255,136,0.25)" }}>
                    <div className="signal-label">Total Rises</div>
                    <div className="signal-val green">{riseFall.rises}</div>
                    <div className="signal-conf">{((riseFall.rises / (riseFall.rises + riseFall.falls || 1)) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="signal-box" style={{ background: "var(--red-dim)", border: "1px solid rgba(255,51,102,0.25)" }}>
                    <div className="signal-label">Total Falls</div>
                    <div className="signal-val red">{riseFall.falls}</div>
                    <div className="signal-conf">{((riseFall.falls / (riseFall.rises + riseFall.falls || 1)) * 100).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="stat-row"><span className="stat-label">Direction</span><span className="stat-val" style={{ color: riseFall.rises > riseFall.falls ? "var(--green)" : "var(--red)" }}>{riseFall.rises > riseFall.falls ? "↑ BULLISH" : "↓ BEARISH"}</span></div>
                <div className="stat-row"><span className="stat-label">Streak</span><span className={`streak-badge streak-${riseFall.streakType?.toLowerCase()}`}>{riseFall.streak}× {riseFall.streakType}</span></div>
                <div className="stat-row"><span className="stat-label">Momentum</span><span className="stat-val" style={{ color: riseFall.streak >= 6 ? "var(--red)" : riseFall.streak >= 4 ? "var(--orange)" : "var(--green)" }}>{riseFall.streak >= 6 ? "OVEREXTENDED" : riseFall.streak >= 4 ? "STRONG TREND" : "DEVELOPING"}</span></div>
                <hr className="divider" />
                <div className="stat-row"><span className="stat-label">Signal</span><span className="stat-val green" style={{ fontSize: 12 }}>{riseFall.streak >= 5 ? `ENTER ${riseFall.streakType === "RISE" ? "FALL" : "RISE"} (FADE)` : `RIDE ${riseFall.streakType}`}</span></div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-orange" />Full Price Chart</div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={ticks.map((t, i) => ({ i, val: parseFloat(t) }))}>
                    <defs>
                      <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff6b35" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#ff6b35" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="i" hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fill: "#4a5260", fontSize: 10 }} width={55} />
                    <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }} formatter={v => [parseFloat(v).toFixed(3)]} />
                    <Area type="monotone" dataKey="val" stroke="#ff6b35" strokeWidth={1.5} fill="url(#gOrange)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ---- MATCHES/DIFFERS TAB ---- */}
          {activeTab === "matchdiffer" && matchesDiffers && (
            <div className="grid-2">
              <div className="panel accent-orange">
                <div className="panel-title"><span className="dot dot-orange" />Matches / Differs</div>
                <div className="md-target-row">
                  <span className="stat-label">Target Digit:</span>
                  <input type="number" min="0" max="9" value={matchTarget} onChange={e => setMatchTarget(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))} />
                </div>
                <div className="two-col" style={{ marginBottom: 14 }}>
                  <div className="signal-box" style={{ background: "var(--orange-dim)", border: "1px solid rgba(255,107,53,0.25)" }}>
                    <div className="signal-label">Matches</div>
                    <div className="signal-val orange">{matchesDiffers.matches}</div>
                    <div className="signal-conf">{matchesDiffers.matchPct}%</div>
                  </div>
                  <div className="signal-box" style={{ background: "var(--green-dim)", border: "1px solid rgba(0,255,136,0.2)" }}>
                    <div className="signal-label">Differs</div>
                    <div className="signal-val green">{matchesDiffers.differs}</div>
                    <div className="signal-conf">{(100 - parseFloat(matchesDiffers.matchPct)).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="stat-row"><span className="stat-label">Expected rate</span><span className="stat-val dim">~10.0%</span></div>
                <div className="stat-row"><span className="stat-label">Actual rate</span><span className="stat-val" style={{ color: parseFloat(matchesDiffers.matchPct) > 12 ? "var(--orange)" : "var(--green)" }}>{matchesDiffers.matchPct}%</span></div>
                <div className="stat-row"><span className="stat-label">Deviation</span><span className="stat-val yellow">{(parseFloat(matchesDiffers.matchPct) - 10).toFixed(1)}%</span></div>
                <hr className="divider" />
                <div className="stat-row"><span className="stat-label">Signal</span><span className="stat-val green" style={{ fontSize: 12 }}>{parseFloat(matchesDiffers.matchPct) > 13 ? "MATCHES (HOT)" : "DIFFERS (DOMINANT)"}</span></div>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-green" />Last 20 Digits</div>
                <div className="last-digits-row">
                  {digits.slice(-20).map((d, i) => (
                    <div key={i} className="ld-chip" style={{ background: d === matchTarget ? "var(--orange-dim)" : "transparent", borderColor: d === matchTarget ? "var(--orange)" : "var(--border)", color: d === matchTarget ? "var(--orange)" : "var(--text-dim)" }}>{d}</div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-orange" />Digit Frequencies vs Target {matchTarget}</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={freqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="digit" tick={{ fill: "#4a5260", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#4a5260", fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {freqData.map((d, i) => <Cell key={i} fill={d.digit === matchTarget ? "var(--orange)" : "var(--border2)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ---- OVER/UNDER TAB ---- */}
          {activeTab === "overunder" && overUnder && (
            <div className="grid-2">
              <div className="panel accent-yellow">
                <div className="panel-title"><span className="dot dot-yellow" />Over / Under Analysis</div>
                <div className="barrier-row">
                  <span className="stat-label">Barrier:</span>
                  {[1,2,3,4,5,6,7,8].map(b => (
                    <button key={b} className={`barrier-btn ${barrier === b ? "active" : ""}`} onClick={() => setBarrier(b)}>{b}</button>
                  ))}
                </div>
                <div className="two-col" style={{ marginBottom: 14 }}>
                  <div className="signal-box" style={{ background: "var(--yellow-dim)", border: "1px solid rgba(255,215,0,0.25)" }}>
                    <div className="signal-label">Over {barrier}</div>
                    <div className="signal-val yellow">{overUnder.overPct}%</div>
                    <div className="signal-conf">{overUnder.over}</div>
                  </div>
                  <div className="signal-box" style={{ background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.25)" }}>
                    <div className="signal-label">Under {barrier}</div>
                    <div className="signal-val cyan">{overUnder.underPct}%</div>
                    <div className="signal-conf">{overUnder.under}</div>
                  </div>
                </div>
                <div className="stat-row"><span className="stat-label">Equal to {barrier}</span><span className="stat-val dim">{overUnder.eq}</span></div>
                <div className="stat-row"><span className="stat-label">Dominant</span><span className="stat-val" style={{ color: parseFloat(overUnder.overPct) > parseFloat(overUnder.underPct) ? "var(--yellow)" : "var(--cyan)" }}>{parseFloat(overUnder.overPct) > parseFloat(overUnder.underPct) ? `OVER ${barrier}` : `UNDER ${barrier}`}</span></div>
                <hr className="divider" />
                <div className="stat-row"><span className="stat-label">Signal</span><span className="stat-val green" style={{ fontSize: 12 }}>{parseFloat(overUnder.overPct) > 58 ? `→ OVER ${barrier}` : parseFloat(overUnder.underPct) > 58 ? `→ UNDER ${barrier}` : "→ WAIT — BALANCED"}</span></div>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-yellow" />Last 20 Digits</div>
                <div className="last-digits-row">
                  {digits.slice(-20).map((d, i) => (
                    <div key={i} className="ld-chip" style={{ background: d > barrier ? "var(--yellow-dim)" : d < barrier ? "var(--cyan-dim)" : "var(--border)", borderColor: d > barrier ? "rgba(255,215,0,0.3)" : d < barrier ? "rgba(0,191,255,0.3)" : "var(--border2)", color: d > barrier ? "var(--yellow)" : d < barrier ? "var(--cyan)" : "var(--text-dim)" }}>{d}</div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-yellow" />Distribution vs Barrier {barrier}</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={freqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="digit" tick={{ fill: "#4a5260", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#4a5260", fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {freqData.map((d, i) => <Cell key={i} fill={d.digit > barrier ? "var(--yellow)" : d.digit < barrier ? "var(--cyan)" : "var(--orange)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}



          {/* ---- SIGNALS TAB ---- */}
          {activeTab === "signals" && (
            <>
              {!allSignals ? (
                <div className="panel"><div className="empty-state">Connect live or load demo data to generate signals.</div></div>
              ) : (
                <>
                  {/* ALERT BAR */}
                  {streakAlerts.length > 0 && (
                    <div className="panel" style={{ marginBottom: 12 }}>
                      <div className="panel-title"><span className="dot dot-red" />⚠ Live Alerts — {streakAlerts.length} active</div>
                      {streakAlerts.map((a, i) => (
                        <div key={i} className={`alert-item alert-${a.level.toLowerCase()}`}>
                          <span className="alert-icon">{a.level === "CRITICAL" ? "🔴" : "🟡"}</span>
                          <span style={{ flex: 1 }}>{a.msg}</span>
                          <span className="alert-strategy">{a.strategy}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {streakAlerts.length === 0 && (
                    <div className="panel" style={{ marginBottom: 12 }}>
                      <div className="alert-item alert-ok">
                        <span className="alert-icon">🟢</span>
                        <span>No alerts — market conditions are normal across all strategies</span>
                      </div>
                    </div>
                  )}

                  {/* BEST STRATEGY BANNER */}
                  <div className="panel" style={{ marginBottom: 12, border: "1px solid var(--green)", background: "rgba(0,255,136,0.03)" }}>
                    <div className="panel-title"><span className="dot dot-green" />Best Strategy Right Now</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>STRATEGY</div>
                        <div className="best-badge">⚡ {bestSignal.strategy}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>BET</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--green)", fontFamily: "var(--head)" }}>{bestSignal.bet}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>CONFIDENCE</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--orange)" }}>{bestSignal.confidence}%</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>EST. WIN PROB</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cyan)" }}>{(bestSignal.winProb * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ marginLeft: "auto" }}>
                        <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>CURRENT STREAK</div>
                        <div className={`streak-badge ${bestSignal.streakType ? (bestSignal.strategy === "Rise/Fall" ? (bestSignal.streakType === "RISE" ? "streak-rise" : "streak-fall") : "streak-even") : ""}`}>
                          {bestSignal.streak > 0 ? `${bestSignal.streak}× ${bestSignal.streakType}` : "—"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ALL STRATEGY RANKINGS */}
                  <div className="panel" style={{ marginBottom: 12 }}>
                    <div className="panel-title"><span className="dot dot-orange" />All Strategy Rankings — Sorted by Signal Strength</div>
                    {allSignals.map((sig, rank) => (
                      <div key={sig.strategy} className={`strategy-card ${rank === 0 ? "top" : rank === 1 ? "good" : sig.bet === "WAIT" ? "wait" : ""}`}>
                        <div className="sc-left">
                          <span className="sc-rank" style={{ color: rank === 0 ? "var(--green)" : "var(--text-dim)" }}>#{rank + 1}</span>
                          <span className="sc-name" style={{ color: rank === 0 ? "var(--green)" : rank === 1 ? "var(--orange)" : "var(--text-dim)" }}>{sig.strategy}</span>
                          <span className={`sc-bet ${sig.bet === "WAIT" ? "wait" : ""}`} style={{ borderColor: rank === 0 ? "var(--green)" : rank === 1 ? "var(--orange)" : "var(--border2)", color: rank === 0 ? "var(--green)" : rank === 1 ? "var(--orange)" : "var(--text-dim)", background: rank === 0 ? "var(--green-dim)" : rank === 1 ? "var(--orange-dim)" : "transparent" }}>
                            {sig.bet}
                          </span>
                          {sig.streak > 0 && (
                            <span className="sc-streak">{sig.streak}× {sig.streakType}</span>
                          )}
                        </div>
                        <div className="sc-right">
                          <div>
                            <div className="sc-bar">
                              <div className="sc-bar-fill" style={{ width: `${sig.confidence}%`, background: rank === 0 ? "var(--green)" : rank === 1 ? "var(--orange)" : "var(--border2)" }} />
                            </div>
                          </div>
                          <div className={`sc-conf ${rank === 0 ? "green" : rank === 1 ? "orange" : "dim"}`}>{sig.confidence}%</div>
                          <div style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "right" }}>
                            <div>win: {(sig.winProb * 100).toFixed(1)}%</div>
                            <div style={{ color: sig.risk === "HIGH" ? "var(--red)" : sig.risk === "MEDIUM" ? "var(--yellow)" : "var(--green)" }}>risk: {sig.risk}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* WIN RATE HISTORY CHART */}
                  {winRateHistory.length >= 3 && (
                    <div className="panel" style={{ marginBottom: 12 }}>
                      <div className="panel-title"><span className="dot dot-cyan" />Win Rate Over Time — Paper Trading Performance</div>
                      <div className="winrate-stats">
                        <div className="execWR-stat">
                          <div className={`execWR-stat-val ${parseFloat(ptStats.winRate) >= 12 ? "green" : parseFloat(ptStats.winRate) >= 10 ? "yellow" : "red"}`}>{ptStats.winRate}%</div>
                          <div className="execWR-stat-label">WIN RATE</div>
                        </div>
                        <div className="execWR-stat">
                          <div className={`execWR-stat-val ${parseFloat(ptStats.totalPnl) >= 0 ? "green" : "red"}`}>{parseFloat(ptStats.totalPnl) >= 0 ? "+" : ""}${ptStats.totalPnl}</div>
                          <div className="execWR-stat-label">TOTAL P&L</div>
                        </div>
                        <div className="execWR-stat">
                          <div className="execWR-stat-val cyan">{ptStats.wins}W / {ptStats.losses}L</div>
                          <div className="execWR-stat-label">WIN / LOSS</div>
                        </div>
                        <div className="execWR-stat">
                          <div className={`execWR-stat-val ${ptStats.targetMet ? "green" : "yellow"}`}>{ptStats.total}/200</div>
                          <div className="execWR-stat-label">TRADES DONE</div>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={winRateHistory} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="gWR" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#00bfff" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#00bfff" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                          <XAxis dataKey="trade" tick={{ fill: "#4a5260", fontSize: 9 }} label={{ value: "trades", position: "insideBottomRight", fill: "#4a5260", fontSize: 9 }} />
                          <YAxis tick={{ fill: "#4a5260", fontSize: 9 }} domain={[0, 30]} unit="%" width={35} />
                          <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }}
                            formatter={(v, n) => [n === "winRate" ? `${v}%` : `$${v}`, n === "winRate" ? "Win Rate" : "P&L"]} />
                          <Area type="monotone" dataKey="winRate" stroke="#00bfff" strokeWidth={2} fill="url(#gWR)" dot={false} isAnimationActive={false} />
                          {/* Break-even reference line at 11.1% */}
                          <Area type="monotone" dataKey={() => 11.1} stroke="#ff3366" strokeWidth={1} strokeDasharray="4 4" fill="none" dot={false} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div style={{ fontSize: 10, color: "var(--red)", marginTop: 4 }}>— Break-even line (11.1% win rate). Stay above this to be profitable.</div>
                    </div>
                  )}

                  {/* MARKET SNAPSHOT */}
                  <div className="panel">
                    <div className="panel-title"><span className="dot dot-yellow" />Live Market Snapshot — {symbol}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      {evenOdd && (
                        <div style={{ padding: "10px", background: "var(--bg2)", borderRadius: 3, border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>EVEN/ODD</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cyan)" }}>{evenOdd.evenPct}% E</div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{evenOdd.streak}× {evenOdd.streakType}</div>
                        </div>
                      )}
                      {riseFall && (
                        <div style={{ padding: "10px", background: "var(--bg2)", borderRadius: 3, border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>RISE/FALL</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: riseFall.streakType === "RISE" ? "var(--green)" : "var(--red)" }}>
                            {riseFall.streak}× {riseFall.streakType}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{((riseFall.rises/(riseFall.rises+riseFall.falls||1))*100).toFixed(0)}% rises</div>
                        </div>
                      )}
                      {overUnder && (
                        <div style={{ padding: "10px", background: "var(--bg2)", borderRadius: 3, border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>OVER/UNDER {barrier}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--yellow)" }}>{overUnder.overPct}% O</div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{overUnder.underPct}% under</div>
                        </div>
                      )}
                      {predictTopPick && (
                        <div style={{ padding: "10px", background: "var(--bg2)", borderRadius: 3, border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>TOP DIGIT</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--green)", fontFamily: "var(--head)" }}>{predictTopPick.digit}</div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>gap: {predictTopPick.gap} ticks</div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ---- PREDICT TAB ---- */}
          {activeTab === "predict" && digits.length >= 50 && predictTopPick && (
            <>
                {/* TOP PICK BANNER */}
                <div className="panel" style={{ marginBottom: 12, border: "1px solid var(--green)", background: "rgba(0,255,136,0.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <div className="panel-title" style={{ marginBottom: 4 }}><span className="dot dot-green" />Top Prediction — Matches</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                        <span style={{ fontSize: 56, fontWeight: 700, color: "var(--green)", fontFamily: "var(--head)", lineHeight: 1 }}>{predictTopPick?.digit}</span>
                        <div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>CONFIDENCE</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--green)" }}>{predictTopPick?.confidence}%</div>
                          <div className={`pred-signal sig-${predictTopPick?.signal?.toLowerCase()}`}>{predictTopPick?.signal}</div>
                        </div>
                        <div style={{ marginLeft: 16 }}>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>GAP (ticks since seen)</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--yellow)" }}>{predictTopPick?.gap}</div>
                          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Z-SCORE: {predictTopPick?.z}</div>
                        </div>
                        <div style={{ marginLeft: 16 }}>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>BET TYPE</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: predictTopPick?.betType === "MATCHES" ? "var(--orange)" : "var(--cyan)" }}>
                            {predictTopPick?.betType}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                            WIN PROB: {predictTopPick?.betType === "MATCHES" ? predictTopPick?.matchWinProb : predictTopPick?.differsWinProb}%
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>KELLY STAKE (half-Kelly)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--orange)" }}>{predictTopPick?.halfKelly}% of bankroll</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Balance $</span>
                        <input className="kelly-input" type="number" value={paperBalance} readOnly />
                        <span style={{ fontSize: 13, color: "var(--green)" }}>→ ${(paperBalance * (predictTopPick?.halfKelly || 0) / 100).toFixed(2)}</span>
                      </div>
                      <button className="btn btn-green" style={{ marginTop: 8 }}
                        onClick={() => { setActiveTab("papertrade"); logPaperTrade(predictTopPick.digit, predictTopPick.confidence, predictTopPick.winProb, predictTopPick.halfKelly, predictTopPick.betType); }}>
                        📋 Log {predictTopPick?.betType} Trade
                      </button>
                    </div>
                  </div>
                </div>

                {/* ALL DIGIT SCORES */}
                <div className="panel" style={{ marginBottom: 12 }}>
                  <div className="panel-title"><span className="dot dot-green" />All Digit Confidence Scores — Click Any to Log Paper Trade</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6 }}>
                    {predictScores.map((s, rank) => (
                      <div key={s.digit}
                        className={`pred-card ${rank === 0 ? "top-pick" : s.signal === "STRONG" ? "strong" : s.signal === "AVOID" ? "avoid" : ""}`}
                        onClick={() => { setActiveTab("papertrade"); logPaperTrade(s.digit, s.confidence, s.winProb, s.halfKelly, s.betType); }}>
                        {rank === 0 && <div style={{ position: "absolute", top: 3, right: 3, fontSize: 8, color: "var(--green)" }}>★TOP</div>}
                        <div className={`pred-digit ${rank === 0 ? "green" : s.signal === "STRONG" ? "orange" : s.signal === "AVOID" ? "red" : "yellow"}`}>{s.digit}</div>
                        <div className={`pred-conf ${rank === 0 ? "green" : "dim"}`}>{s.confidence}%</div>
                        <div className="pred-gap">gap:{s.gap}/{s.expectedGap}</div>
                        <div className="pred-gap" style={{ color: s.betType === "MATCHES" ? "var(--orange)" : "var(--cyan)", fontSize: 8, fontWeight: 700 }}>{s.betType}</div>
                        <div className={`pred-signal sig-${s.signal.toLowerCase()}`}>{s.signal}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TRANSITION MATRIX */}
                <div className="panel">
                  <div className="panel-title"><span className="dot dot-cyan" />Transition Matrix — After digit X, what comes next? (last digit: <span className="green">{predictLastDigit}</span>)</div>
                  <div className="matrix-grid" style={{ overflowX: "auto" }}>
                    <div className="matrix-cell matrix-header">→</div>
                    {[0,1,2,3,4,5,6,7,8,9].map(d => <div key={d} className="matrix-cell matrix-header" style={{ color: "var(--cyan)" }}>{d}</div>)}
                    {[0,1,2,3,4,5,6,7,8,9].map(from => {
                      const rowTotal = predictMatrix[from].reduce((s,v) => s+v, 0) || 1;
                      return [
                        <div key={`h${from}`} className="matrix-cell matrix-header" style={{ color: "var(--orange)" }}>{from}</div>,
                        ...predictMatrix[from].map((count, to) => {
                          const pct = Math.round((count / rowTotal) * 100);
                          const intensity = Math.min(1, pct / 25);
                          const bg = from === predictLastDigit
                            ? `rgba(0,255,136,${intensity * 0.6})`
                            : `rgba(0,191,255,${intensity * 0.3})`;
                          return <div key={`${from}-${to}`} className="matrix-cell" style={{ background: bg, color: pct > 15 ? "var(--green)" : "var(--text-dim)", fontSize: 9 }}>{pct}%</div>;
                        })
                      ];
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 8 }}>
                    Highlighted row = after last digit {predictLastDigit}. Brighter cell = higher transition probability.
                  </div>
                </div>
            </>
          )}
          {activeTab === "predict" && digits.length < 50 && (
            <div className="panel"><div className="empty-state">Need at least 50 ticks for reliable predictions. {digits.length}/50 loaded. Connect live — historical data loads automatically.</div></div>
          )}

          {/* ---- PAPER TRADE TAB ---- */}
          {activeTab === "papertrade" && (
            <>
              {/* Summary stats */}
              <div className="grid-3" style={{ marginBottom: 12 }}>
                <div className="panel">
                  <div className="panel-title"><span className="dot dot-green" />Session P&amp;L</div>
                  <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "var(--head)" }} className={parseFloat(ptStats.totalPnl) >= 0 ? "pnl-positive" : "pnl-negative"}>
                    {parseFloat(ptStats.totalPnl) >= 0 ? "+" : ""}${ptStats.totalPnl}
                  </div>
                  <div className="stat-row" style={{ marginTop: 8 }}>
                    <span className="stat-label">Virtual Balance</span>
                    <span className="stat-val green">${paperBalance.toFixed(2)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Started With</span>
                    <span className="stat-val dim">$1000.00</span>
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-title"><span className="dot dot-cyan" />Win Rate Tracker</div>
                  <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "var(--head)" }} className={parseFloat(ptStats.winRate) >= 12 ? "green" : parseFloat(ptStats.winRate) >= 10 ? "yellow" : "red"}>
                    {ptStats.winRate}%
                  </div>
                  <div className="stat-row" style={{ marginTop: 8 }}>
                    <span className="stat-label">Target</span>
                    <span className="stat-val cyan">&gt;12% over 200 trades</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Trades</span>
                    <span className="stat-val">{ptStats.wins}W / {ptStats.losses}L / {ptStats.total} total</span>
                  </div>
                  {pendingTrade && (
                    <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--yellow-dim)", border: "1px solid var(--yellow)", borderRadius: 3, fontSize: 11 }}>
                      <span className="yellow">⏳ PENDING: Digit {pendingTrade.digit} | ${pendingTrade.stake} stake</span>
                    </div>
                  )}
                </div>
                <div className="panel">
                  <div className="panel-title"><span className="dot dot-orange" />Go-Live Target Progress</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>200 trades at &gt;12% win rate</div>
                  <div className="target-bar">
                    <div className="target-fill" style={{ width: `${Math.min(100, (ptStats.total / 200) * 100)}%` }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{ptStats.total}/200 trades</div>
                  <div className="target-bar" style={{ marginTop: 8 }}>
                    <div className="target-fill" style={{ width: `${Math.min(100, (parseFloat(ptStats.winRate) / 12) * 100)}%`, background: parseFloat(ptStats.winRate) >= 12 ? "var(--green)" : "var(--orange)" }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{ptStats.winRate}% / 12% target win rate</div>
                  {ptStats.targetMet && (
                    <div style={{ marginTop: 8, padding: "8px", background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: 3, fontSize: 11, color: "var(--green)", textAlign: "center", letterSpacing: 2 }}>
                      🟢 TARGET MET — READY FOR LIVE TRADING
                    </div>
                  )}
                </div>
              </div>

              {/* Stake config */}
              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="panel-title"><span className="dot dot-yellow" />Paper Trade Settings</div>
                <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>STAKE PER TRADE ($)</div>
                    <input className="kelly-input" type="number" min="1" max="200" value={paperStake}
                      onChange={e => setPaperStake(parseFloat(e.target.value) || 10)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>PAYOUT RATIO</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--green)" }}>8 : 1</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>BREAK-EVEN WIN RATE</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--orange)" }}>11.1%</div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn btn-cyan" onClick={() => setActiveTab("predict")}>🎯 Go to Predict</button>
                    <button className="btn btn-ghost" onClick={() => { setPaperTrades([]); paperTradesRef.current = []; setPaperBalance(1000); setPendingTrade(null); pendingTradeRef.current = null; }}>↺ Reset</button>
                    <button className="btn btn-orange" onClick={() => {
                      const csv = ["ID,Digit,Confidence,WinProb,Stake,Result,ActualDigit,PnL,Symbol",
                        ...paperTrades.map(t => `${t.id},${t.digit},${t.confidence},${t.winProb},${t.stake},${t.result},${t.actualDigit},${t.pnl},${t.symbol}`)
                      ].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
                      a.download = `paper_trades_${symbol}_${Date.now()}.csv`; a.click();
                    }}>⬇ Export CSV</button>
                  </div>
                </div>
              </div>

              {/* Loss streak warning */}
              {consecutiveLosses >= 5 && (
                <div className="panel" style={{ marginBottom: 12, border: "1px solid var(--red)", background: "var(--red-dim)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                    <span style={{ fontSize: 20 }}>🛑</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--red)", fontFamily: "var(--head)", letterSpacing: 2 }}>
                        {consecutiveLosses} CONSECUTIVE LOSSES — STOP TRADING
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                        Switch index, wait for more ticks, or review your signal threshold. Never chase losses.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bet type performance breakdown */}
              {ptStats.total >= 5 && (
                <div className="panel" style={{ marginBottom: 12 }}>
                  <div className="panel-title"><span className="dot dot-cyan" />Performance by Bet Type</div>
                  <div className="two-col">
                    <div style={{ padding: "12px", background: "var(--orange-dim)", border: "1px solid rgba(255,107,53,0.3)", borderRadius: 3, textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>MATCHES TRADES</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--orange)", fontFamily: "var(--head)" }}>{ptStats.matchWR}%</div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{ptStats.matchTotal} trades · need &gt;11.1%</div>
                      <div style={{ fontSize: 10, marginTop: 4, color: parseFloat(ptStats.matchWR) >= 11.1 ? "var(--green)" : "var(--red)" }}>
                        {parseFloat(ptStats.matchWR) >= 11.1 ? "✅ PROFITABLE" : "❌ BELOW BREAK-EVEN"}
                      </div>
                    </div>
                    <div style={{ padding: "12px", background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.3)", borderRadius: 3, textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>DIFFERS TRADES</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--cyan)", fontFamily: "var(--head)" }}>{ptStats.differsWR}%</div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{ptStats.differsTotal} trades · need &gt;47.4%</div>
                      <div style={{ fontSize: 10, marginTop: 4, color: parseFloat(ptStats.differsWR) >= 47.4 ? "var(--green)" : "var(--red)" }}>
                        {parseFloat(ptStats.differsWR) >= 47.4 ? "✅ PROFITABLE" : "❌ BELOW BREAK-EVEN"}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 8 }}>
                    Best performing type: <span style={{ color: "var(--green)", fontWeight: 700 }}>{bestTradeType}</span> — system will prioritize this going forward
                  </div>
                </div>
              )}

              {/* Trade log */}
              <div className="panel">
                <div className="panel-title"><span className="dot dot-orange" />Trade Log — {paperTrades.length} entries</div>
                {paperTrades.length === 0 ? (
                  <div className="empty-state" style={{ padding: "24px" }}>
                    No paper trades yet. Go to <span className="green">🎯 Predict</span> tab and click a digit card to log a trade.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
                    <table className="pt-table">
                      <thead>
                        <tr>
                          <th>#</th><th>DIGIT</th><th>TYPE</th><th>CONF%</th>
                          <th>STAKE</th><th>RESULT</th><th>ACTUAL</th><th>P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...paperTrades].reverse().map((t, i) => (
                          <tr key={t.id}>
                            <td className="dim">{paperTrades.length - i}</td>
                            <td style={{ color: "var(--cyan)", fontWeight: 700 }}>{t.digit}</td>
                            <td style={{ color: t.betType === "MATCHES" ? "var(--orange)" : "var(--cyan)", fontSize: 9, letterSpacing: 1 }}>{t.betType || "MATCHES"}</td>
                            <td className="yellow">{t.confidence}%</td>
                            <td>${t.stake}</td>
                            <td className={t.result === "WIN" ? "pt-win" : t.result === "LOSS" ? "pt-loss" : "pt-pending"}>
                              {t.result === "WIN" ? "✓ WIN" : t.result === "LOSS" ? "✗ LOSS" : "⏳ PENDING"}
                            </td>
                            <td style={{ color: "var(--text-dim)" }}>{t.actualDigit ?? "—"}</td>
                            <td className={t.pnl > 0 ? "pnl-positive" : t.pnl < 0 ? "pnl-negative" : "dim"}>
                              {t.pnl > 0 ? "+" : ""}{t.pnl !== 0 ? `$${t.pnl.toFixed(2)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* EMPTY STATE */}
          {ticks.length === 0 && (
            <div className="panel">
              <div className="empty-state">
                <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
                <div style={{ color: "var(--green)", marginBottom: 8, fontSize: 14, fontFamily: "var(--head)", letterSpacing: 3 }}>DERIV·ORACLE READY</div>
                <div style={{ marginBottom: 16 }}>Click <span style={{ color: "var(--green)" }}>⚡ Connect Live</span> to stream real Deriv tick data</div>
                <div style={{ marginBottom: 8 }}>or</div>
                <div>Click <span style={{ color: "var(--text)" }}>Demo Data</span> to test with synthetic ticks</div>
              </div>
            </div>
          )}


          {/* ----  BOTS TAB ---- */}
          {activeTab === "bots" && (
            <div>
              {/* Sub-tabs */}
              <div className="bot-tabs">
                {[["upload","⬆ Upload & Analyze"],["stored","🗄 Stored Bots"],["generate","✨ AI Generator"]].map(([id,label]) => (
                  <button key={id} className={"bot-tab" + (botSubTab===id?" active":"")} onClick={() => { setBotSubTab(id); if(id==="stored") loadStoredBots(); }}>{label}</button>
                ))}
              </div>

              {/* UPLOAD SUB-TAB */}
              {botSubTab === "upload" && (
                <div>
                  <div className="panel">
                    <div className="panel-title"><span className="dot dot-cyan"/>Upload Deriv Bot XML</div>
                    <div
                      className={"bot-drop-zone" + (isDragOver ? " drag-over" : "")}
                      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if(f) handleBotFileUpload(f); }}
                      onClick={() => { const inp = document.createElement("input"); inp.type="file"; inp.accept=".xml"; inp.onchange=ev=>handleBotFileUpload(ev.target.files[0]); inp.click(); }}
                    >
                      <div className="bot-drop-zone-icon">🤖</div>
                      <div style={{ color: "var(--cyan)", fontFamily: "var(--head)", fontSize: 12, letterSpacing: 2, marginBottom: 6 }}>DROP DERIV BOT XML HERE</div>
                      <div className="bot-drop-zone-text">or click to browse · .xml files only</div>
                      <div className="bot-drop-zone-text" style={{ marginTop: 6, fontSize: 9 }}>Bot will be parsed, health-checked &amp; matched to live market conditions</div>
                    </div>
                  </div>

                  {uploadedBots.length > 0 && (
                    <div className="panel">
                      <div className="panel-title"><span className="dot dot-orange"/>Uploaded Bots ({uploadedBots.length})</div>
                      {uploadedBots.map((bot, idx) => {
                        const health = checkBotHealth(bot, ptStats);
                        const match = getBotMarketMatch(bot, digits, ticks, ptStats);
                        const healthClass = health.health === "OK" ? "bot-health-ok" : health.health === "WARN" ? "bot-health-warn" : "bot-health-critical";
                        return (
                          <div key={idx} className={"bot-card" + (selectedBotIdx===idx?" selected":"")} onClick={() => setSelectedBotIdx(idx)}>
                            <div className="bot-card-header">
                              <span className="bot-name">🤖 {bot.contractType} — {bot.strategy}</span>
                              <span className={"bot-health-badge " + healthClass}>{health.health} · {health.score}%</span>
                            </div>
                            <div className="bot-params">
                              <div className="bot-param"><div className="bot-param-val">{bot.stake !== "?" ? "$" + bot.stake : "?"}</div><div className="bot-param-label">STAKE</div></div>
                              <div className="bot-param"><div className="bot-param-val">{bot.martingale}×</div><div className="bot-param-label">MARTINGALE</div></div>
                              <div className="bot-param"><div className="bot-param-val">{bot.stopLoss ? "$"+bot.stopLoss : "—"}</div><div className="bot-param-label">STOP LOSS</div></div>
                              <div className="bot-param"><div className="bot-param-val">{bot.takeProfit ? "$"+bot.takeProfit : "—"}</div><div className="bot-param-label">TAKE PROFIT</div></div>
                              <div className="bot-param"><div className="bot-param-val">{bot.targetDigit !== null ? bot.targetDigit : "—"}</div><div className="bot-param-label">TARGET DIGIT</div></div>
                              <div className="bot-param"><div className="bot-param-val">{bot.symbol || "?"}</div><div className="bot-param-label">SYMBOL</div></div>
                            </div>
                            <div className="bot-match-score">
                              <div>
                                <div className={"bot-match-pct"} style={{ color: match.score >= 70 ? "var(--green)" : match.score >= 40 ? "var(--yellow)" : "var(--red)" }}>{match.score}%</div>
                                <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 1 }}>MARKET MATCH</div>
                              </div>
                              <div style={{ flex: 1 }}>
                                {(match.notes || []).map((n,i) => <div key={i} style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 2 }}>· {n}</div>)}
                              </div>
                            </div>
                            <div className="bot-issues">
                              {health.issues.map((issue, i) => (
                                <div key={i} className={"bot-issue-item " + (issue.ok ? "bot-issue-ok" : issue.severity==="critical" ? "bot-issue-critical" : "bot-issue-warn")}>
                                  <span>{issue.ok ? "✓" : issue.severity==="critical" ? "✗" : "⚠"}</span>
                                  <span>{issue.msg}</span>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                              <button className="btn btn-green" style={{ fontSize: 10, padding: "5px 12px" }} onClick={e => { e.stopPropagation(); setBotSubTab("generate"); setSelectedBotIdx(idx); }}>✨ AI Improve</button>
                              <button className="btn" style={{ fontSize: 10, padding: "5px 12px" }} onClick={e => { e.stopPropagation(); saveBotToStorage(bot, null); }}>💾 Save Original</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* STORED BOTS SUB-TAB */}
              {botSubTab === "stored" && (
                <div className="panel">
                  <div className="panel-title" style={{ justifyContent: "space-between" }}>
                    <span><span className="dot dot-cyan"/>Stored Bots ({storedBots.length})</span>
                    <button className="btn" style={{ fontSize: 10, padding: "4px 10px" }} onClick={loadStoredBots}>↺ Refresh</button>
                  </div>
                  {storageStatus && <div style={{ fontSize: 10, color: "var(--green)", marginBottom: 8 }}>{storageStatus}</div>}
                  {storedBots.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: 11, textAlign: "center", padding: "20px 0" }}>
                      No bots stored yet. Upload and save a bot first.
                    </div>
                  ) : (
                    <div className="bot-stored-list">
                      {storedBots.map((bot, idx) => (
                        <div key={bot.id} className="bot-stored-item">
                          <div>
                            <div style={{ fontSize: 12, color: "var(--cyan)", fontFamily: "var(--head)", letterSpacing: 1 }}>🤖 {bot.name}</div>
                            <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 3 }}>
                              {bot.strategy} · Stake ${bot.stake} · Martingale {bot.martingale}× · Saved {bot.savedAt ? bot.savedAt.slice(0,10) : "?"}
                            </div>
                            {bot.improvedXml && <div style={{ fontSize: 9, color: "var(--green)", marginTop: 2 }}>✨ AI-improved version available</div>}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-green" style={{ fontSize: 9, padding: "3px 8px" }} onClick={() => { setImprovedXml(bot.improvedXml || bot.originalXml || ""); setBotSubTab("generate"); }}>View XML</button>
                            <button className="btn" style={{ fontSize: 9, padding: "3px 8px", color: "var(--red)", borderColor: "var(--red)" }} onClick={() => deleteStoredBot(bot.id)}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* AI GENERATOR SUB-TAB */}
              {botSubTab === "generate" && (
                <div>
                  <div className="panel">
                    <div className="panel-title" style={{ justifyContent: "space-between" }}>
                      <span><span className="dot dot-green"/>AI Bot Generator</span>
                      <span style={{ fontSize: 9, color: "var(--green)", letterSpacing: 1 }}>DEEPSEEK R1 → QWEN3 235B → LLAMA 4 · OPENROUTER · AUTO-ROTATE</span>
                    </div>
                    {uploadedBots.length === 0 ? (
                      <div style={{ color: "var(--text-dim)", fontSize: 11, padding: "16px 0" }}>
                        Upload a bot XML first, then come here to generate an improved version.
                        <br/><br/>
                        <button className="btn btn-green" onClick={() => setBotSubTab("upload")}>⬆ Go to Upload</button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6, letterSpacing: 1 }}>SELECT BOT TO IMPROVE</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {uploadedBots.map((bot, idx) => (
                              <button key={idx} className={"btn" + (selectedBotIdx===idx?" btn-green":"")} style={{ fontSize: 10, padding: "4px 10px" }} onClick={() => { setSelectedBotIdx(idx); setBotAiOutput(""); setImprovedXml(""); }}>
                                Bot {idx+1}: {bot.strategy}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, padding: 10, marginBottom: 10 }}>
                          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>MARKET CONTEXT BEING SENT TO AI</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                            {[["Symbol", symbol],["Ticks", digits.length],["Hot Digits", hotCold.hot.join(", ")||"—"],["Cold Digits", hotCold.cold.join(", ")||"—"],["DIFFERS WR", ptStats.differsWR+"%"],["MATCHES WR", ptStats.matchWR+"%"]].map(([label,val]) => (
                              <div key={label} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: 3, padding: "5px 8px" }}>
                                <div style={{ fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)" }}>{val}</div>
                                <div style={{ fontSize: 8, color: "var(--text-dim)", letterSpacing: 1 }}>{label}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <button className="btn btn-green" style={{ width: "100%", padding: "10px", fontSize: 12, letterSpacing: 2, position: "relative" }} onClick={handleGenerateBot} disabled={botLoading || selectedBotIdx===null}>
                          {botLoading
                            ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 14 }}>⟳</span>
                                <span>ANALYZING — {generatingModel || "AI"}</span>
                              </span>
                            : "✨ GENERATE IMPROVED BOT"}
                        </button>
                        {botAiOutput && botAiOutput.startsWith("✗") && (
                          <button className="btn btn-orange" style={{ width: "100%", padding: "7px", fontSize: 10, letterSpacing: 1, marginTop: 6 }} onClick={handleGenerateBot} disabled={botLoading}>
                            ↺ RETRY WITH NEXT AI ENGINE
                          </button>
                        )}
                        {botAiOutput && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2 }}>AI STATUS</span>
                              {botAiOutput.startsWith("✓") && <span style={{ fontSize: 9, color: "var(--green)", background: "var(--green-dim)", border: "1px solid var(--green)", padding: "2px 8px", borderRadius: 2 }}>SUCCESS</span>}
                              {botAiOutput.startsWith("✗") && <span style={{ fontSize: 9, color: "var(--red)", background: "var(--red-dim)", border: "1px solid var(--red)", padding: "2px 8px", borderRadius: 2 }}>FAILED</span>}
                              {botAiOutput.startsWith("⟳") && <span style={{ fontSize: 9, color: "var(--yellow)", background: "var(--yellow-dim)", border: "1px solid var(--yellow)", padding: "2px 8px", borderRadius: 2 }}>WORKING...</span>}
                            </div>
                            <div className="bot-ai-output" style={{ color: botAiOutput.startsWith("✓") ? "var(--green)" : botAiOutput.startsWith("✗") ? "var(--red)" : "var(--yellow)" }}>{botAiOutput}</div>
                          </div>
                        )}
                        {improvedXml && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <div style={{ fontSize: 9, color: "var(--green)", letterSpacing: 2 }}>✨ IMPROVED BOT XML</div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn btn-green" style={{ fontSize: 9, padding: "3px 10px" }} onClick={() => { const bl = new Blob([improvedXml], {type:"text/xml"}); const a=document.createElement("a"); a.href=URL.createObjectURL(bl); a.download="improved-bot.xml"; a.click(); }}>⬇ Download XML</button>
                                <button className="btn" style={{ fontSize: 9, padding: "3px 10px" }} onClick={() => { if(uploadedBots[selectedBotIdx]) saveBotToStorage(uploadedBots[selectedBotIdx], improvedXml); }}>💾 Save to Storage</button>
                              </div>
                            </div>
                            <div className="bot-xml-preview">{improvedXml}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {storageStatus && <div style={{ fontSize: 10, color: "var(--green)", padding: "6px 0" }}>{storageStatus}</div>}
                </div>
              )}
            </div>
          )}


          {/* ----  EXECUTE TAB -- PHASE 4 ---- */}
          {activeTab === "execute" && (
              <div>
                {/* ---- TOKEN SETUP -- always visible ---- */}
                <div style={{ border:"1px solid " + (tokenValid ? "var(--green)" : tokenError ? "var(--red)" : "var(--border)"),
                  borderRadius:4, padding:14, marginBottom:10,
                  background: tokenValid ? "rgba(0,255,136,0.04)" : tokenError ? "rgba(255,50,50,0.06)" : "rgba(0,0,0,0.3)" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                    <div style={{ fontSize:10, letterSpacing:2,
                      color: tokenValid ? "var(--green)" : tokenError ? "var(--red)" : "var(--text-dim)" }}>
                      🔑 DERIV API TOKEN
                    </div>
                    <div style={{ fontSize:9, letterSpacing:1,
                      color: tokenValid ? "var(--green)" : tokenError ? "var(--red)" : "var(--yellow)" }}>
                      {tokenValid ? "✓ VALID" : tokenError ? "✗ INVALID" : "⚪ NOT VERIFIED"}
                    </div>
                  </div>

                  {tokenError && (
                    <div style={{ fontSize:10, color:"var(--red)", background:"rgba(255,50,50,0.08)",
                      border:"1px solid var(--red)", borderRadius:3, padding:"6px 10px", marginBottom:8 }}>
                      ✗ {tokenError}
                    </div>
                  )}

                  <div style={{ fontSize:9, color:"var(--text-dim)", marginBottom:8, lineHeight:1.6 }}>
                    Get your token: <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer"
                      style={{ color:"var(--cyan)" }}>app.deriv.com → API Token ↗</a>
                    {" "}· Requires <strong style={{color:"var(--text)"}}>Read + Trade</strong> scope
                  </div>

                  <div style={{ display:"flex", gap:8 }}>
                    <input className="stake-input"
                      placeholder={derivToken ? "paste new token to replace current..." : "paste your Deriv API token here..."}
                      value={tokenInput}
                      onChange={e => setTokenInput(e.target.value)}
                      onKeyDown={e => { if(e.key === "Enter" && tokenInput.trim()) {
                        setDerivToken(tokenInput.trim()); setTokenValid(false); setTokenError("");
                        setTokenInput(""); setAccountList([]); setActiveAccount(null);
                      }}}
                      style={{ flex:1, fontSize:11 }}
                      type="password"
                      autoComplete="off"
                    />
                    <button className={"btn" + (tokenInput.trim() ? " btn-green" : "")}
                      style={{ fontSize:10, padding:"8px 14px", whiteSpace:"nowrap" }}
                      onClick={() => {
                        if(tokenInput.trim()) {
                          setDerivToken(tokenInput.trim());
                          setTokenValid(false);
                          setTokenError("");
                          setTokenInput("");
                          setAccountList([]);
                          setActiveAccount(null);
                          setExecLog("Token saved — click Connect Trade WS to verify.");
                        }
                      }}>
                      Save &amp; Use
                    </button>
                  </div>

                  {derivToken && !tokenInput && (
                    <div style={{ fontSize:9, color:"var(--text-dim)", marginTop:6 }}>
                      Token set {tokenValid ? "and verified ✓" : "— connect to verify"}
                      {" · "}<span style={{ cursor:"pointer", color:"var(--red)", textDecoration:"underline" }}
                        onClick={() => { setDerivToken(""); setTokenValid(false); setTokenError(""); setAccountList([]); setActiveAccount(null); }}>
                        clear
                      </span>
                    </div>
                  )}
                </div>

                {/* ---- ACCOUNT SWITCHER ---- */}
                {/* ---- ACCOUNT SWITCHER -- always visible ---- */}
                <div style={{ border:"1px solid var(--border)", borderRadius:4, padding:14, marginBottom:10,
                  background:"rgba(0,0,0,0.3)" }}>
                  <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:2, marginBottom:10 }}>
                    ACCOUNT MODE
                  </div>

                  {/* Connected: show real account buttons */}
                  {accountList.length > 0 ? (
                    <div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                        {accountList.map(acc => (
                          <button key={acc.loginid}
                            className={"btn" + (activeAccount?.loginid === acc.loginid
                              ? (acc.is_virtual ? " btn-green" : " btn-orange") : "")}
                            style={{ fontSize:11, padding:"8px 16px",
                              borderColor: acc.is_virtual ? "var(--green)" : "var(--orange)",
                              fontFamily:"var(--head)", letterSpacing:1 }}
                            onClick={() => switchAccount(acc)}>
                            {acc.label}
                          </button>
                        ))}
                      </div>
                      {activeAccount && (
                        <div style={{ fontSize:10, padding:"8px 12px", borderRadius:3,
                          background: activeAccount.is_virtual ? "rgba(0,255,136,0.06)" : "rgba(255,80,80,0.08)",
                          border:"2px solid " + (activeAccount.is_virtual ? "var(--green)" : "var(--red)"),
                          color: activeAccount.is_virtual ? "var(--green)" : "var(--red)",
                          letterSpacing:1, lineHeight:1.7 }}>
                          {activeAccount.is_virtual ? (
                            <span>🎮 <strong>DEMO MODE ACTIVE</strong> — {activeAccount.loginid}<br/>
                            <span style={{fontSize:9, opacity:0.8}}>Virtual funds only · results mirror real account · safe to test strategy</span></span>
                          ) : (
                            <span>⚠ <strong>REAL ACCOUNT ACTIVE</strong> — {activeAccount.loginid}<br/>
                            <span style={{fontSize:9, opacity:0.8}}>Every trade uses real money · confirm strategy on demo first</span></span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Not connected yet — show pre-connect toggle */
                    <div>
                      <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                        <button className={"btn" + (execMode === "demo" ? " btn-green" : "")}
                          style={{ flex:1, padding:"10px", fontSize:11, letterSpacing:1,
                            borderColor:"var(--green)", fontFamily:"var(--head)" }}
                          onClick={() => setExecMode("demo")}>
                          🎮 DEMO
                        </button>
                        <button className={"btn" + (execMode === "real" ? " btn-orange" : "")}
                          style={{ flex:1, padding:"10px", fontSize:11, letterSpacing:1,
                            borderColor:"var(--orange)", fontFamily:"var(--head)" }}
                          onClick={() => setExecMode("real")}>
                          💰 REAL
                        </button>
                      </div>
                      <div style={{ fontSize:9, padding:"6px 10px", borderRadius:3,
                        background: execMode === "demo" ? "rgba(0,255,136,0.04)" : "rgba(255,80,80,0.06)",
                        border:"1px solid " + (execMode === "demo" ? "var(--green)" : "var(--red)"),
                        color: execMode === "demo" ? "var(--green)" : "var(--red)", lineHeight:1.6 }}>
                        {execMode === "demo"
                          ? "🎮 DEMO selected — after connecting, demo account will be used automatically"
                          : "⚠ REAL selected — after connecting, real account will be used · test on demo first"}
                      </div>
                    </div>
                  )}
                </div>

                {/* ---- WARNING BANNER ---- */}
                <div style={{ background: activeAccount?.is_virtual ? "rgba(0,255,136,0.04)" : "rgba(255,165,0,0.08)",
                  border:"1px solid " + (activeAccount?.is_virtual ? "var(--green)" : "var(--orange)"),
                  borderRadius:4, padding:"8px 14px", marginBottom:10, fontSize:10,
                  color: activeAccount?.is_virtual ? "var(--green)" : "var(--orange)", letterSpacing:1, lineHeight:1.6 }}>
                  {activeAccount?.is_virtual
                    ? "🎮 DEMO — virtual funds · DIFFERS on " + symbol + " · prediction updates every tick"
                    : "⚠ REAL ACCOUNT — DIFFERS on " + symbol + " · Start with $0.35 minimum stake · " + (activeAccount?.loginid || "")}
                </div>

                {/* ---- LIVE SIGNAL DISPLAY ---- */}
                <div className="execute-grid" style={{ marginBottom:10 }}>
                  <div className={"signal-live" + (coldDigit !== null ? " hot" : "")}>
                    <div className="signal-live-label">⚡ DIFFERS TARGET · COLDEST DIGIT</div>
                    <div className="signal-live-val" style={{ color:"var(--green)" }}>
                      {execColdDigit !== null ? execColdDigit : "—"}
                    </div>
                    <div style={{ fontSize:9, color:"var(--text-dim)" }}>
                      {execColdDigit !== null ? "Least frequent — best DIFFERS prediction" : "Need 20+ ticks"}
                    </div>
                  </div>
                  <div className="signal-live">
                    <div className="signal-live-label">🔥 HOT DIGIT · MOST FREQUENT</div>
                    <div className="signal-live-val" style={{ color:"var(--orange)" }}>
                      {execHotDigit !== null ? execHotDigit : "—"}
                    </div>
                    <div style={{ fontSize:9, color:"var(--text-dim)" }}>Appearing most — avoid as DIFFERS target</div>
                  </div>
                </div>

                {/* ---- SESSION STATS ---- */}
                <div className="exec-stat-row">
                  {[
                    [total || "0", "TRADES", "var(--cyan)"],
                    [wins, "WINS", "var(--green)"],
                    [losses, "LOSSES", "var(--red)"],
                    [execWR === "—" ? "—" : execWR + "%", "WIN RATE", execWR !== "—" && parseFloat(execWR) >= 47.4 ? "var(--green)" : "var(--yellow)"],
                  ].map(([val,label,color]) => (
                    <div key={label} className="exec-stat">
                      <div className="exec-stat-val" style={{ color }}>{val}</div>
                      <div className="exec-stat-label">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="exec-stat-row">
                  {[
                    [(execSessionPnl >= 0 ? "+" : "") + execSessionPnl.toFixed(2), "SESSION P&L USD", execSessionPnl >= 0 ? "var(--green)" : "var(--red)"],
                    [balance ? "$" + balance : "—", "ACCOUNT BALANCE", "var(--cyan)"],
                    [latencyMs !== null ? latencyMs + "ms" : "—", "LAST RTT", latencyMs !== null && latencyMs < 80 ? "var(--green)" : "var(--yellow)"],
                    [symbol, "INDEX", "var(--text)"],
                  ].map(([val,label,color]) => (
                    <div key={label} className="exec-stat">
                      <div className="exec-stat-val" style={{ color, fontSize:14 }}>{val}</div>
                      <div className="exec-stat-label">{label}</div>
                    </div>
                  ))}
                </div>

                {/* ---- CONTROLS ---- */}
                <div className="panel" style={{ marginBottom:10 }}>
                  <div className="panel-title"><span className="dot dot-orange"/>Trade Controls</div>

                  {/* Stake + WS Connect row */}
                  <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:120 }}>
                      <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:2, marginBottom:4 }}>STAKE (USD)</div>
                      <input
                        className="stake-input"
                        type="number" min="0.35" step="0.5"
                        value={execStake}
                        onChange={e => setExecStake(e.target.value)}
                        disabled={execArmed}
                      />
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:4, justifyContent:"flex-end" }}>
                      <button className="btn btn-green" style={{ fontSize:10, padding:"7px 14px", whiteSpace:"nowrap" }}
                        onClick={connectTradeWS}>
                        ⚡ Connect Trade WS
                      </button>
                      <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer"
                        style={{ fontSize:9, color:"var(--cyan)", textDecoration:"none", letterSpacing:1,
                          padding:"4px 8px", border:"1px solid var(--border)", borderRadius:3, whiteSpace:"nowrap" }}>
                        🔑 Get API Token ↗
                      </a>
                      <div className="latency-bar">
                        <div className={"latency-dot " + latClass}/>
                        <span style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:1 }}>
                          {latencyMs !== null ? "RTT " + latencyMs + "ms" : "not measured"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Log line */}
                  {execLog && (
                    <div style={{ fontFamily:"var(--mono)", fontSize:10, color: execLog.startsWith("✓") ? "var(--green)" : execLog.startsWith("✗") ? "var(--red)" : execLog.startsWith("⚠") ? "var(--yellow)" : "var(--text-dim)", padding:"6px 8px", background:"rgba(0,0,0,0.3)", borderRadius:3, marginBottom:10, whiteSpace:"pre-wrap" }}>
                      {execLog}
                    </div>
                  )}

                  {/* ARM / DISARM button */}
                  <button
                    className={"arm-btn" + (execArmed ? (execFiring ? " firing" : " armed") : "")}
                    onClick={() => {
                      if (!execArmed) {
                        if (digits.length < 20) { setExecLog("⚠ Need 20+ live ticks before arming."); return; }
                        if (!tradeWsRef.current || tradeWsRef.current.readyState !== WebSocket.OPEN) {
                          setExecLog("⚠ Connect Trade WS first."); return;
                        }
                        setShowConfirm(true);
                      } else {
                        setExecArmed(false);
                        setExecFiring(false);
                        setExecLog("⬛ Disarmed — no more trades will fire.");
                      }
                    }}
                  >
                    {execArmed ? (execFiring ? "⟳ FIRING TRADE..." : "🟢 ARMED · CLICK TO DISARM") : "▶ ARM — START TRADING"}
                  </button>

                  {execArmed && (
                    <div style={{ fontSize:9, color: activeAccount?.is_virtual ? "var(--green)" : "var(--orange)",
                      textAlign:"center", marginTop:6, letterSpacing:1,
                      padding:"5px 10px", borderRadius:3,
                      background: activeAccount?.is_virtual ? "rgba(0,255,136,0.06)" : "rgba(255,165,0,0.08)" }}>
                      {activeAccount?.is_virtual ? "🎮 DEMO" : "⚠ REAL"} · DIGITDIFF DIFFERS · digit updates live · ${execStake} stake · {symbol}
                    </div>
                  )}
                </div>

                {/* ---- TRADE LOG ---- */}
                <div className="panel">
                  <div className="panel-title" style={{ justifyContent:"space-between" }}>
                    <span><span className="dot dot-green"/>Live Trade Log ({execTradesRef.current.length})</span>
                    <button className="btn" style={{ fontSize:9, padding:"3px 8px" }}
                      onClick={() => { execTradesRef.current = []; setExecTrades([]); setExecSessionPnl(0); }}>
                      Clear
                    </button>
                  </div>
                  {execTradesRef.current.length === 0 ? (
                    <div style={{ color:"var(--text-dim)", fontSize:11, textAlign:"center", padding:"20px 0" }}>
                      No trades yet. Connect Trade WS → Arm → trades appear here.
                    </div>
                  ) : (
                    <div className="execute-log">
                      <div className="execute-log-row" style={{ color:"var(--text-dim)", fontSize:8, letterSpacing:1, borderBottom:"1px solid var(--border2)" }}>
                        <span>TIME</span><span>DIGIT</span><span>STAKE</span><span>STATUS</span><span>P&amp;L</span><span>EXIT</span>
                      </div>
                      {execTrades.map((t, i) => (
                        <div key={t.id || i} className={"execute-log-row " + (t.status === "WIN" ? "win" : t.status === "LOSS" ? "loss" : "pending")}>
                          <span style={{ color:"var(--text-dim)" }}>{t.time}</span>
                          <span style={{ color:"var(--cyan)" }}>≠{t.digit}</span>
                          <span>${t.stake}</span>
                          <span style={{ color: t.status === "WIN" ? "var(--green)" : t.status === "LOSS" ? "var(--red)" : "var(--yellow)" }}>
                            {t.status}
                          </span>
                          <span className={t.pnl === null ? "" : t.pnl >= 0 ? "exec-pnl-pos" : "exec-pnl-neg"}>
                            {t.pnl === null ? "..." : (t.pnl >= 0 ? "+" : "") + t.pnl.toFixed(2)}
                          </span>
                          <span style={{ color:"var(--text-dim)", fontSize:9 }}>{t.exitSpot || "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
          )}

          {activeTab === "under5" && (
            <div>
              <div className="u5-stats-grid">
                {[
                  [u5Rate30 + "%", "U5 RATE (30T)", u5Rate30 >= 55 ? "var(--green)" : u5Rate30 >= 45 ? "var(--yellow)" : "var(--red)"],
                  [u5Rate10 + "%", "U5 RATE (10T)", u5Rate10 >= 60 ? "var(--green)" : u5Rate10 >= 40 ? "var(--yellow)" : "var(--red)"],
                  [u5CurrentStreak + "x " + u5StreakType, "STREAK", u5StreakType === "UNDER" ? "var(--green)" : "var(--red)"],
                  [u5GapSinceLast + " ticks", "GAP SINCE U5", u5GapSinceLast >= 3 ? "var(--green)" : u5GapSinceLast >= 1 ? "var(--yellow)" : "var(--text-dim)"],
                ].map(([val, label, color]) => (
                  <div key={label} className="u5-stat">
                    <div className="u5-stat-val" style={{ color }}>{val}</div>
                    <div className="u5-stat-label">{label}</div>
                  </div>
                ))}
              </div>

              <div className="u5-panel">
                <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:2, marginBottom:8 }}>
                  LAST 30 DIGITS - GREEN = UNDER 5 - RED = 5 OR ABOVE
                </div>
                <div className="u5-history">
                  {digits.slice(-30).map((d, i) => (
                    <div key={i} className={"u5-digit-pill " + (d < 5 ? "under" : "over")}>{d}</div>
                  ))}
                  {digits.length < 30 && (
                    <div style={{ fontSize:10, color:"var(--text-dim)", padding:"4px 8px" }}>
                      {30 - digits.length} more ticks needed...
                    </div>
                  )}
                </div>
                <div style={{ fontSize:9, color:"var(--text-dim)", marginTop:6 }}>
                  Under 5: {u5Last30.filter(d => d < 5).length}/30 ({u5Rate30}%) - Over 4: {u5Last30.filter(d => d >= 5).length}/30
                </div>
              </div>

              <button
                className={"u5-predict-btn" + (u5Predicting ? " analysing" : "")}
                onClick={runUnder5Analysis}
                disabled={u5Predicting || digits.length < 30}
              >
                {u5Predicting
                  ? "Analysing " + digits.length + " ticks..."
                  : digits.length < 30
                  ? "Need " + (30 - digits.length) + " more ticks to predict"
                  : "PREDICT NEXT UNDER 5 DIGIT"}
              </button>

              {u5Result && (
                <div style={{ marginTop:10 }}>
                  <div className={"u5-signal-box " + (u5Result.signal === "green" ? "enter" : u5Result.signal === "yellow" ? "caution" : "wait")}>
                    <div className="u5-verdict" style={{ color: u5Result.signal === "green" ? "var(--green)" : u5Result.signal === "yellow" ? "var(--yellow)" : "var(--red)" }}>
                      {u5Result.verdict === "ENTER" ? "ENTER TRADE" : u5Result.verdict === "CAUTION" ? "CAUTION" : "WAIT"}
                    </div>
                    <div style={{ fontSize:11, color:"var(--text-dim)", marginBottom:10 }}>
                      Confidence: {u5Result.confidence}% - DIGITUNDER on {symbol}
                    </div>
                    {u5Result.recommendedDigit !== null ? (
                      <div>
                        <div className="u5-digit-big">{u5Result.recommendedDigit}</div>
                        <div className="u5-digit-label">SET THIS AS PREDICTION IN YOUR BOT</div>
                        <div style={{ fontSize:9, color:"var(--text-dim)", marginTop:8 }}>
                          Digit {u5Result.recommendedDigit} is coldest under-5 - least appeared, most likely due
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:8 }}>
                        {u5Result.verdict === "WAIT"
                          ? "Conditions not aligned. Wait for momentum + gap signal."
                          : "Borderline -- watch for gap 3+ before entering."}
                      </div>
                    )}
                  </div>

                  <div className="u5-factors">
                    {u5Result.factors.map((f, fi) => (
                      <div key={fi} className={"u5-factor " + (f.score >= 2 ? "bullish" : f.score <= 0 ? "bearish" : "neutral")}>
                        <div className="u5-factor-label">{f.label}</div>
                        <div className="u5-factor-val" style={{ color: f.score >= 2 ? "var(--green)" : f.score <= 0 ? "var(--red)" : "var(--yellow)" }}>
                          {f.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="u5-panel">
                    <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:2, marginBottom:6 }}>ANALYSIS LOG</div>
                    <div className="u5-analysis-log">{u5Result.analysisLog}</div>
                  </div>

                  {u5Result.verdict === "ENTER" && u5Result.recommendedDigit !== null && (
                    <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid var(--green)",
                      borderRadius:4, padding:"12px 14px", fontSize:10, lineHeight:1.7 }}>
                      <div style={{ color:"var(--green)", fontFamily:"var(--head)", letterSpacing:2, marginBottom:6 }}>
                        BOT INSTRUCTIONS
                      </div>
                      <div style={{ color:"var(--text)" }}>
                        1. Open your ROMANS 8:28 Oracle Under 5 bot on Deriv<br/>
                        2. Set Prediction = <strong style={{ color:"var(--cyan)" }}>{u5Result.recommendedDigit}</strong> in the bot<br/>
                        3. Verify symbol = <strong style={{ color:"var(--cyan)" }}>{symbol}</strong><br/>
                        4. Click Run -- bot will execute DIGITUNDER trades<br/>
                        5. Stop when Take Profit or Stop Loss is reached
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!u5Result && (
                <div style={{ fontSize:9, color:"var(--text-dim)", padding:"12px 0", lineHeight:1.8, textAlign:"center" }}>
                  Analyses 7 factors: under-5 base rate, bot entry signal (2 consecutive under-5),<br/>
                  momentum, streak status, coldest digit, gap analysis, recent rate<br/>
                  Returns confidence score, ENTER/WAIT verdict, and digit to set in your bot
                </div>
              )}
            </div>
          )}

          {/* ---- LAB TAB: SIGNAL DETECTION ENGINE ---- */}
          {activeTab === "lab" && (
            <div className="panel" style={{ marginBottom: 16 }}>

              {/* ---- panel title ---- */}
              <div className="panel-title" style={{ marginBottom: 12 }}>
                <span className="dot" style={{ background: "var(--cyan)", boxShadow: "0 0 6px var(--cyan)", marginRight: 6 }} />
                SIGNAL DETECTION LAB
                <span style={{ marginLeft: 10, fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: 1 }}>
                  {symbol} -- {labN.toLocaleString()} ticks banked
                </span>
              </div>

              {/* ---- scientific disclaimer ---- */}
              <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 14, padding: "8px 10px",
                background: "var(--bg2)", borderRadius: 3, borderLeft: "2px solid var(--text-dim)" }}>
                Passive tick accumulator + rigorous statistical tests. No trading recommendations attached.
                A confirmed signal requires p &lt; 0.05 across multiple tests at n &gt;= 50,000 ticks.
                If tests return clean, no predictor can add edge beyond the base rate.
              </div>

              {/* ---- collection progress bars ---- */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
                  COLLECTION THRESHOLDS
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 4 }}>
                    <span style={{ color: labUnlockChi ? "var(--green)" : "var(--text-dim)" }}>TEST 1 -- Chi-Square Uniformity</span>
                    <span style={{ color: labUnlockChi ? "var(--green)" : "var(--text-dim)", fontFamily: "var(--mono)" }}>
                      {labN.toLocaleString()} / 1,000 {labUnlockChi ? "UNLOCKED" : "collecting"}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg3)", borderRadius: 2 }}>
                    <div style={{ width: labChiPct + "%", height: "100%", background: labUnlockChi ? "var(--green)" : "var(--text-dim)", borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 4 }}>
                    <span style={{ color: labUnlockPersistence ? "var(--green)" : "var(--text-dim)" }}>TEST 3 -- Persistence Check</span>
                    <span style={{ color: labUnlockPersistence ? "var(--green)" : "var(--text-dim)", fontFamily: "var(--mono)" }}>
                      {labN.toLocaleString()} / 5,000 {labUnlockPersistence ? "UNLOCKED" : ""}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg3)", borderRadius: 2 }}>
                    <div style={{ width: labPersPct + "%", height: "100%", background: labUnlockPersistence ? "var(--green)" : "var(--border2)", borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                </div>

                <div style={{ marginBottom: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 4 }}>
                    <span style={{ color: labUnlockVerdict ? "var(--cyan)" : "var(--text-dim)" }}>FINAL VERDICT (reliable at this threshold)</span>
                    <span style={{ color: labUnlockVerdict ? "var(--cyan)" : "var(--text-dim)", fontFamily: "var(--mono)" }}>
                      {labN.toLocaleString()} / 50,000 {labUnlockVerdict ? "RELIABLE" : ""}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg3)", borderRadius: 2 }}>
                    <div style={{ width: labVerdictPct + "%", height: "100%", background: labUnlockVerdict ? "var(--cyan)" : "var(--border)", borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                </div>
              </div>

              {/* ---- controls ---- */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button className="btn btn-green" style={{ flex: 1, fontSize: 10, letterSpacing: 2, padding: "8px" }}
                  onClick={runLabAnalysis} disabled={labRunning || labN < 100}>
                  {labRunning ? "RUNNING..." : "RUN ANALYSIS NOW"}
                </button>
                <button className="btn" style={{ fontSize: 10, letterSpacing: 1, padding: "8px 16px" }}
                  onClick={clearLabData}>
                  CLEAR
                </button>
              </div>

              {/* ---- verdict banner ---- */}
              <div style={{ border: "1px solid " + labVerdictColor, borderRadius: 4, padding: "12px 14px",
                marginBottom: 16, background: "var(--bg2)" }}>
                <div style={{ fontFamily: "var(--head)", fontSize: 14, letterSpacing: 3, color: labVerdictColor, marginBottom: 6 }}>
                  {labVerdictText}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.6 }}>
                  {labVerdictDesc}
                </div>
                {labStats && (
                  <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 6, fontFamily: "var(--mono)" }}>
                    last run: {labLastTs} on {labStats.n.toLocaleString()} ticks
                  </div>
                )}
              </div>

              {/* ---- test 1: digit uniformity ---- */}
              <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--bg2)", borderRadius: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, textTransform: "uppercase" }}>
                    TEST 1 -- DIGIT UNIFORMITY (CHI-SQUARE)
                  </div>
                  {labUnlockChi && labStats && labStats.chi ? (
                    <span style={{ fontSize: 9, color: labChiColor, fontFamily: "var(--mono)", letterSpacing: 1 }}>{labChiVerdict}</span>
                  ) : (
                    <span style={{ fontSize: 9, color: "var(--text-dim)" }}>need 1,000 ticks</span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 8 }}>
                  Are all 10 digits appearing equally? Expected: each 10.0%.
                  Chi-square tests whether observed counts deviate significantly from uniform distribution.
                </div>
                {labStats && labStats.chi && (
                  <>
                    <div style={{ fontSize: 9, color: "var(--text)", marginBottom: 10, fontFamily: "var(--mono)", lineHeight: 1.8 }}>
                      chi-sq = {labStats.chi.chiSq} | df = 9 | p = {labStats.chi.pValue} | n = {labStats.chi.n.toLocaleString()}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4 }}>
                      {labFreqBars.map(f => (
                        <div key={f.d} style={{ background: "var(--bg3)", borderRadius: 3, padding: "6px 8px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
                            <span style={{ color: f.col, fontWeight: 700, fontFamily: "var(--mono)" }}>{f.d}</span>
                            <span style={{ color: f.col, fontFamily: "var(--mono)" }}>{f.pct}%</span>
                          </div>
                          <div style={{ height: 3, background: "var(--bg2)", borderRadius: 2 }}>
                            <div style={{ width: f.barW + "%", height: "100%", background: f.col, borderRadius: 2 }} />
                          </div>
                          <div style={{ fontSize: 8, color: "var(--text-dim)", marginTop: 2, fontFamily: "var(--mono)" }}>
                            {f.dev > 0 ? "+" : ""}{f.dev}pp
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* ---- test 2: serial dependence (transition matrix) ---- */}
              <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--bg2)", borderRadius: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, textTransform: "uppercase" }}>
                    TEST 2 -- SERIAL DEPENDENCE (TRANSITION MATRIX)
                  </div>
                  <span style={{ fontSize: 9, color: labTransColor, fontFamily: "var(--mono)", letterSpacing: 1 }}>{labTransVerdict}</span>
                </div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", lineHeight: 1.7 }}>
                  Builds 10x10 matrix of P(next digit | current digit). Chi-square tests each row.
                  A significant row means knowing that digit helps predict the next -- serial dependence.
                </div>
                {labStats && labStats.trans && labTransSigRows.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 9, color: "var(--orange)", marginBottom: 4, letterSpacing: 1 }}>FLAGGED ROWS (p &lt; 0.05):</div>
                    {labTransSigRows.map(r => (
                      <div key={r.from} style={{ fontSize: 9, fontFamily: "var(--mono)", color: "var(--text)", padding: "2px 0", lineHeight: 1.8 }}>
                        after digit {r.from}: chi-sq = {r.chiSq}, p = {r.pValue} ({r.rowN} obs)
                      </div>
                    ))}
                  </div>
                )}
                {labStats && labStats.trans && labTransSigRows.length === 0 && (
                  <div style={{ fontSize: 9, color: "var(--green)", marginTop: 6 }}>
                    No rows flagged. Serial independence confirmed at p &gt; 0.05 across all digits.
                  </div>
                )}
                {(!labStats || !labStats.trans) && labN < 200 && (
                  <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 6 }}>Requires 200+ ticks and Run Analysis.</div>
                )}
              </div>

              {/* ---- test 3: pattern persistence ---- */}
              <div style={{ padding: "10px 12px", background: "var(--bg2)", borderRadius: 4, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, textTransform: "uppercase" }}>
                    TEST 3 -- PATTERN PERSISTENCE
                  </div>
                  {labUnlockPersistence ? (
                    <span style={{ fontSize: 9, color: labPersColor, fontFamily: "var(--mono)", letterSpacing: 1 }}>{labPersVerdict}</span>
                  ) : (
                    <span style={{ fontSize: 9, color: "var(--text-dim)" }}>need 5,000 ticks</span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", lineHeight: 1.7 }}>
                  Splits stored ticks in half and runs chi-square on each half independently.
                  A pattern that only appears in one half is noise. Drift below 8 = consistent across halves.
                </div>
                {labStats && labStats.persist && (
                  <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 9, lineHeight: 1.9 }}>
                    <div style={{ color: "var(--text)" }}>
                      first half: chi-sq = {labStats.persist.t1 ? labStats.persist.t1.chiSq : "--"},
                      p = {labStats.persist.t1 ? labStats.persist.t1.pValue : "--"}
                    </div>
                    <div style={{ color: "var(--text)" }}>
                      second half: chi-sq = {labStats.persist.t2 ? labStats.persist.t2.chiSq : "--"},
                      p = {labStats.persist.t2 ? labStats.persist.t2.pValue : "--"}
                    </div>
                    <div style={{ color: labPersColor }}>
                      drift = {labStats.persist.drift} -- {labStats.persist.consistent ? "consistent across halves" : "patterns differ between halves -- likely noise"}
                    </div>
                  </div>
                )}
              </div>

              {/* ---- footer note ---- */}
              <div style={{ fontSize: 9, color: "var(--text-dim)", lineHeight: 1.8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                Auto-saves every 500 ticks -- data persists across sessions per symbol --
                currently collecting for {symbol}
              </div>
            </div>
          )}

          {/* PHASE 2 TEASER */}
          <div className="phase2-banner">
            <div className="phase2-title">⚙ PHASE 3 ✅ · PHASE 4 ✅ — LIVE TRADE EXECUTION ACTIVE · PHASE 5 — AUTO STAKE MANAGER [COMING SOON]</div>
            <div className="phase2-sub">Upload Deriv bot XML files · Auto-detect strategy · Bot health check · Buy contracts directly from dashboard</div>
          </div>

        </div>
      </div>

      {/* ---- CONFIRM ARM OVERLAY ---- */}
      {showConfirm && (
        <div className="confirm-overlay" onClick={() => setShowConfirm(false)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:28, marginBottom:12 }}>⚡</div>
            <div style={{ fontFamily:"var(--head)", fontSize:14, letterSpacing:3, color:"var(--orange)", marginBottom:8 }}>
              ARM LIVE TRADING?
            </div>
            <div style={{ fontSize:11, color:"var(--text-dim)", lineHeight:1.7, marginBottom:20 }}>
              This will execute trades on your
              <strong style={{ color: activeAccount?.is_virtual ? "var(--green)" : "var(--orange)" }}>
                {activeAccount?.is_virtual ? " DEMO (virtual funds)" : " REAL account"}
              </strong>.
              Each tick will place a DIGITDIFF DIFFERS contract on <strong style={{ color:"var(--cyan)" }}>{symbol}</strong> at
              <strong style={{ color:"var(--green)" }}> ${execStake}</strong> stake using the live coldest digit.
              <br/><br/>
              <span style={{ color:"var(--orange)" }}>Romans 8:28 — all things work together for good.</span>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button className="btn" style={{ flex:1, padding:"10px", fontSize:11 }}
                onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-green" style={{ flex:1, padding:"10px", fontSize:11, letterSpacing:2 }}
                onClick={() => {
                  setShowConfirm(false);
                  setExecArmed(true);
                  setExecLog("🟢 ARMED — trading DIGITDIFF DIFFERS on " + symbol + " at $" + execStake + " per tick.");
                }}>
                ARM &amp; TRADE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
const DERIV_TOKEN = process.env.REACT_APP_DERIV_TOKEN || "pat_d543aaa32d719ba935cf22a3e338be020f50c2fa901e1751c27497b247752189";
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
  /* Tabs */
  .tabs{display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
  .tab{padding:8px 12px;font-family:var(--head);font-size:11px;letter-spacing:2px;
    text-transform:uppercase;cursor:pointer;border:none;background:transparent;
    color:var(--text-dim);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.2s;}
  .tab.active{color:var(--green);border-bottom-color:var(--green);}
  .tab:hover:not(.active){color:var(--text);}
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
  .wr-stat{padding:10px;border:1px solid var(--border);border-radius:3px;text-align:center;}
  .wr-stat-val{font-size:20px;font-weight:700;font-family:var(--head);}
  .wr-stat-label{font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-top:2px;}
  /* Best strategy badge */
  @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
  .bot-ai-output{animation:fadeIn 0.3s ease;}
  .bot-xml-preview{animation:fadeIn 0.3s ease;}
  .conn-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .best-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;
    border:1px solid var(--green);border-radius:3px;background:var(--green-dim);
    font-size:11px;font-weight:700;letter-spacing:2px;color:var(--green);}

    /* ── MOBILE RESPONSIVE ─────────────────────────────── */
  @media(max-width:900px){
    .grid-top,.grid-2,.grid-3{grid-template-columns:1fr;}
    .symbol-bar{gap:4px;}
  }
  @media(max-width:700px){
    .tabs{overflow-x:auto;flex-wrap:nowrap;padding-bottom:2px;-webkit-overflow-scrolling:touch;}
    .tabs::-webkit-scrollbar{height:2px;}
    .tabs::-webkit-scrollbar-thumb{background:var(--border2);}
    .tab{white-space:nowrap;font-size:9px;padding:7px 10px;letter-spacing:1px;}
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
    .wr-stat-val{font-size:16px;}
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
    .tabs{gap:1px;}
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
  const FORMAT_GUIDE = '<xml xmlns=\\"http://www.w3.org/1999/xhtml\\" collection=\\"false\\">\\n  <variables>\\n    <variable type=\\"\\" id=\\"VAR_ID_1\\">STOP_LOSS</variable>\\n    <variable type=\\"\\" id=\\"VAR_ID_2\\">TARGET_PROFIT</variable>\\n    <variable type=\\"\\" id=\\"VAR_ID_3\\">INITIAL_STAKE</variable>\\n    <variable type=\\"\\" id=\\"VAR_ID_4\\">MARTINGALE</variable>\\n    <variable type=\\"\\" id=\\"VAR_ID_5\\">PREDICTION</variable>\\n  </variables>\\n  <block type=\\"trade\\" id=\\"TRADE_ID\\" x=\\"0\\" y=\\"0\\">\\n    <field name=\\"MARKET_LIST\\">synthetic_index</field>\\n    <field name=\\"SUBMARKET_LIST\\">random_index</field>\\n    <field name=\\"SYMBOL_LIST\\">R_100</field>\\n    <field name=\\"TRADETYPECAT_LIST\\">digits</field>\\n    <field name=\\"TRADETYPE_LIST\\">matchesdiffers</field>\\n    <field name=\\"TYPE_LIST\\">DIGITDIFF</field>\\n    <field name=\\"CANDLEINTERVAL_LIST\\">60</field>\\n    <field name=\\"TIME_MACHINE_ENABLED\\">FALSE</field>\\n    <field name=\\"RESTARTONERROR\\">TRUE</field>\\n    <statement name=\\"INITIALIZATION\\">\\n      <!-- variables_set blocks for each parameter -->\\n    </statement>\\n    <statement name=\\"SUBMARKET\\">\\n      <block type=\\"controls_whileUntil\\" id=\\"LOOP_ID\\">\\n        <field name=\\"MODE\\">WHILE</field>\\n        <value name=\\"BOOL\\"><block type=\\"logic_boolean\\" id=\\"B1\\"><field name=\\"BOOL\\">TRUE</field></block></value>\\n        <statement name=\\"DO\\">\\n          <!-- tick analysis and trade logic goes here -->\\n        </statement>\\n      </block>\\n    </statement>\\n  </block>\\n  <block type=\\"before_purchase\\" id=\\"BEFORE_ID\\" x=\\"0\\" y=\\"820\\">\\n    <statement name=\\"BEFOREPURCHASE_STACK\\">\\n      <block type=\\"purchase\\" id=\\"P1\\"><field name=\\"PURCHASE_LIST\\">DIGITDIFF</field></block>\\n    </statement>\\n  </block>\\n  <block type=\\"after_purchase\\" id=\\"AFTER_ID\\" x=\\"0\\" y=\\"900\\">\\n    <statement name=\\"AFTERPURCHASE_STACK\\">\\n      <!-- win/loss logic: contract_check_result, trade_again, stop conditions -->\\n    </statement>\\n  </block>\\n</xml>';

  const fullPrompt = "You are a Deriv DBot XML expert. Your ONLY output must be a complete, valid Deriv DBot XML file that can be imported into bot.deriv.com without errors.\\n\\nCRITICAL FORMAT RULES (violation = bot breaks on import):\\n1. Root element MUST be: <xml xmlns=\\"http://www.w3.org/1999/xhtml\\" collection=\\"false\\">\\n2. REQUIRED top-level blocks (all must be present):\\n   - <block type=\\"trade\\"> — main trade loop\\n   - <block type=\\"before_purchase\\"> — must contain <block type=\\"purchase\\">\\n   - <block type=\\"after_purchase\\"> — win/loss handling\\n3. Every <block> must have a unique id=\\\"...\\\" attribute\\n4. Variables must be declared in <variables> section with matching id references\\n5. NO <?xml ?> processing instruction — start directly with <xml\\n6. NO markdown, NO code fences, NO explanations outside XML comments\\n7. Use <!-- comment --> to explain improvements\\n\\n=== VALID FORMAT SKELETON (follow this structure exactly) ===\\n" + FORMAT_GUIDE + "\\n\\n=== ORIGINAL BOT XML (excerpt to improve) ===\\n" + xmlSnippet + "\\n\\n=== LIVE MARKET ANALYSIS ===\\n" + reportSnippet + "\\n\\n=== MARKET STATS ===\\n" + ctxStr + "\\n\\nIMPROVEMENT INSTRUCTIONS:\\n- Symbol: use 1HZ100V (Volatility 100 1s) for best DIFFERS edge\\n- TRADETYPE_LIST: matchesdiffers, TYPE_LIST: DIGITDIFF, PURCHASE_LIST: DIGITDIFF\\n- Initial stake: $10 (flat, no martingale for validation phase)\\n- PREDICTION: use coldest digit from market data (least frequent = best DIFFERS target)\\n- Stop loss: $50, Take profit: $100\\n- Add after_purchase logic: check contract_check_result win/loss, call trade_again or stop\\n- All block id values must be unique strings\\n\\nOutput the complete improved XML now:";

  const makeORRequest = async (key, model) => {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "HTTP-Referer": "https://deriv-oracle.vercel.app",
        "X-Title": "DERIV-ORACLE",
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
    "=== DERIV-ORACLE LIVE MARKET ANALYSIS ===",
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
      ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
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
        setConnLog(`Authorized ✓ ${acc?.loginid || ""} — subscribing to ${sym}...`);
        ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
        ws.send(JSON.stringify({ ticks_history: sym, adjust_start_time: 1, count: 100, end: "latest", style: "ticks" }));
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
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
            const wr = resolved2.length ? parseFloat(((wins2 / resolved2.length) * 100).toFixed(1)) : 0;
            const totalPnl2 = resolved2.reduce((s, t) => s + t.pnl, 0);
            return [...prev.slice(-99), { trade: resolved2.length, winRate: wr, pnl: parseFloat(totalPnl2.toFixed(2)) }];
          });
          pendingTradeRef.current = null;
          setPendingTrade(null);
        }

        // Auto AI every 25 new ticks
        aiCounterRef.current += 1;
        if (autoAIRef.current && aiCounterRef.current % 25 === 0) {
          triggerAIRef.current && triggerAIRef.current(updated);
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

  return (
    <>
      <style>{css}</style>
      <div className="terminal">
        <div className="scanlines" />

        {/* HEADER */}
        <div className="header">
          <div className="logo">
            <div className="logo-mark"><span>D</span></div>
            <div>
              <div className="logo-text">DERIV·ORACLE</div>
              <div className="logo-sub">Synthetic Indices Analysis Terminal v2.0</div>
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

          {/* DIGIT FREQUENCY — always visible when data loaded */}
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

          {/* TABS */}
          {ticks.length > 0 && (
            <div className="tabs">
              {[["overview","Overview"],["evenodd","Even/Odd"],["risefall","Rise/Fall"],["matchdiffer","Matches/Differs"],["overunder","Over/Under"],["signals","⚡ Signals"],["predict","🎯 Predict"],["papertrade","📋 Paper Trade"],["bots","🤖 Bots"]].map(([id, label]) => (
                <button key={id} className={`tab ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>{label}</button>
              ))}
            </div>
          )}

          {/* ── OVERVIEW TAB ── */}
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

          {/* ── EVEN/ODD TAB ── */}
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

          {/* ── RISE/FALL TAB ── */}
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

          {/* ── MATCHES/DIFFERS TAB ── */}
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

          {/* ── OVER/UNDER TAB ── */}
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



          {/* ── SIGNALS TAB ── */}
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
                        <div className="wr-stat">
                          <div className={`wr-stat-val ${parseFloat(ptStats.winRate) >= 12 ? "green" : parseFloat(ptStats.winRate) >= 10 ? "yellow" : "red"}`}>{ptStats.winRate}%</div>
                          <div className="wr-stat-label">WIN RATE</div>
                        </div>
                        <div className="wr-stat">
                          <div className={`wr-stat-val ${parseFloat(ptStats.totalPnl) >= 0 ? "green" : "red"}`}>{parseFloat(ptStats.totalPnl) >= 0 ? "+" : ""}${ptStats.totalPnl}</div>
                          <div className="wr-stat-label">TOTAL P&L</div>
                        </div>
                        <div className="wr-stat">
                          <div className="wr-stat-val cyan">{ptStats.wins}W / {ptStats.losses}L</div>
                          <div className="wr-stat-label">WIN / LOSS</div>
                        </div>
                        <div className="wr-stat">
                          <div className={`wr-stat-val ${ptStats.targetMet ? "green" : "yellow"}`}>{ptStats.total}/200</div>
                          <div className="wr-stat-label">TRADES DONE</div>
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

          {/* ── PREDICT TAB ── */}
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

          {/* ── PAPER TRADE TAB ── */}
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


          {/* ── 🤖 BOTS TAB ── */}
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

          {/* PHASE 2 TEASER */}
          <div className="phase2-banner">
            <div className="phase2-title">⚙ PHASE 3 ✅ — XML BOT ANALYZER + AI BOT GENERATOR ACTIVE · PHASE 4 — ONE-CLICK TRADE EXECUTION [COMING SOON]</div>
            <div className="phase2-sub">Upload Deriv bot XML files · Auto-detect strategy · Bot health check · Buy contracts directly from dashboard</div>
          </div>

        </div>
      </div>
    </>
  );
}

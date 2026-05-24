import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Area, AreaChart, Cell
} from "recharts";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// Fallback: OpenRouter
const OR_KEY = process.env.REACT_APP_OPENROUTER_KEY;
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const OR_MODEL = "deepseek/deepseek-r1:free";

// ── DEMO DATA GENERATOR ───────────────────────────────────────────────────────
function genDemoTicks(n = 80) {
  const ticks = [];
  let v = 1000 + Math.random() * 500;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.49) * 2.5;
    ticks.push(parseFloat(v.toFixed(3)));
  }
  return ticks;
}

// ── ANALYSIS HELPERS ──────────────────────────────────────────────────────────
function getLastDigits(ticks) {
  return ticks.map(t => {
    const s = t.toFixed(2);
    return parseInt(s[s.length - 1]);
  });
}

function getDigitFrequency(digits) {
  const freq = Array(10).fill(0);
  digits.forEach(d => freq[d]++);
  return freq.map((count, digit) => ({
    digit,
    count,
    pct: digits.length ? ((count / digits.length) * 100).toFixed(1) : 0,
  }));
}

function getEvenOddStats(digits) {
  const even = digits.filter(d => d % 2 === 0).length;
  const odd = digits.length - even;
  // streak
  let streak = 0, streakType = null;
  for (let i = digits.length - 1; i >= 0; i--) {
    const type = digits[i] % 2 === 0 ? "EVEN" : "ODD";
    if (streakType === null) streakType = type;
    if (type === streakType) streak++;
    else break;
  }
  return { even, odd, total: digits.length, streakType, streak, evenPct: digits.length ? ((even / digits.length) * 100).toFixed(1) : 0 };
}

function getRiseFallStats(ticks) {
  if (ticks.length < 2) return { rises: 0, falls: 0, streak: 0, streakType: null, momentum: [] };
  let rises = 0, falls = 0;
  const momentum = [];
  for (let i = 1; i < ticks.length; i++) {
    const dir = ticks[i] > ticks[i - 1] ? "RISE" : "FALL";
    if (dir === "RISE") rises++; else falls++;
    momentum.push({ i, dir, val: ticks[i] });
  }
  let streak = 0, streakType = null;
  for (let i = momentum.length - 1; i >= 0; i--) {
    if (streakType === null) streakType = momentum[i].dir;
    if (momentum[i].dir === streakType) streak++;
    else break;
  }
  return { rises, falls, streak, streakType, momentum };
}

function getOverUnderStats(digits, barrier = 4) {
  const over = digits.filter(d => d > barrier).length;
  const under = digits.filter(d => d < barrier).length;
  const eq = digits.length - over - under;
  return { over, under, eq, barrier, overPct: digits.length ? ((over / digits.length) * 100).toFixed(1) : 0, underPct: digits.length ? ((under / digits.length) * 100).toFixed(1) : 0 };
}

function getMatchesDiffersStats(digits, target = 5) {
  const matches = digits.filter(d => d === target).length;
  const differs = digits.length - matches;
  return { matches, differs, target, matchPct: digits.length ? ((matches / digits.length) * 100).toFixed(1) : 0 };
}

function getHotCold(freq) {
  const sorted = [...freq].sort((a, b) => b.count - a.count);
  return { hot: sorted.slice(0, 3).map(x => x.digit), cold: sorted.slice(-3).map(x => x.digit) };
}

// ── AI ANALYSIS ───────────────────────────────────────────────────────────────
async function fetchAIInsight(stats, ticks) {
  const prompt = `You are a professional binary options and synthetic indices trader specializing in Deriv platform analysis. Analyze this market data and provide sharp, actionable insights.

TICK DATA (last ${ticks.length} ticks): ${ticks.slice(-20).join(", ")}
LAST DIGITS: ${getLastDigits(ticks.slice(-20)).join(", ")}

STATS:
- Even/Odd: ${stats.evenOdd.even} even (${stats.evenOdd.evenPct}%), ${stats.evenOdd.odd} odd | Current streak: ${stats.evenOdd.streak}x ${stats.evenOdd.streakType}
- Rise/Fall: ${stats.riseFall.rises} rises, ${stats.riseFall.falls} falls | Streak: ${stats.riseFall.streak}x ${stats.riseFall.streakType}
- Over/Under (barrier ${stats.overUnder.barrier}): Over ${stats.overUnder.overPct}%, Under ${stats.overUnder.underPct}%
- Matches/Differs (digit ${stats.matchesDiffers.target}): ${stats.matchesDiffers.matchPct}% match rate
- Hot digits: ${stats.hotCold.hot.join(", ")} | Cold digits: ${stats.hotCold.cold.join(", ")}

Provide a concise market analysis (3-4 sentences) covering:
1. Current market bias and momentum
2. Best trade type recommendation with reasoning
3. Risk warning if any pattern looks unstable
Use trader jargon. Be direct and confident. No disclaimers.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY || GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 300, temperature: 0.7 }),
    });
    if (!res.ok) throw new Error("Groq failed");
    const data = await res.json();
    return data.choices[0].message.content;
  } catch {
    // Fallback to OpenRouter
    try {
      const res2 = await fetch(OR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OR_KEY}`, "HTTP-Referer": "https://claude.ai" },
        body: JSON.stringify({ model: OR_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 300 }),
      });
      const data2 = await res2.json();
      return data2.choices[0].message.content;
    } catch (e) {
      return "⚠️ AI analysis unavailable. Check API connectivity. Manual pattern analysis: review digit frequency and streak data above for trade signals.";
    }
  }
}

// ── GROQ KEY (allow runtime override) ────────────────────────────────────────
let GROQ_KEY = GROQ_API_KEY;

// ── STYLED COMPONENTS (inline CSS) ───────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Rajdhani:wght@300;400;500;600;700&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #060608;
    --bg2: #0c0c12;
    --bg3: #12121e;
    --panel: rgba(16,16,28,0.95);
    --border: #1e1e38;
    --border2: #2a2a48;
    --green: #00ff88;
    --green2: #00cc6a;
    --green-dim: rgba(0,255,136,0.12);
    --orange: #ff6b35;
    --orange-dim: rgba(255,107,53,0.12);
    --cyan: #00bfff;
    --cyan-dim: rgba(0,191,255,0.1);
    --yellow: #ffd700;
    --yellow-dim: rgba(255,215,0,0.1);
    --red: #ff3366;
    --red-dim: rgba(255,51,102,0.12);
    --text: #c8d0e0;
    --text-dim: #5a6070;
    --mono: 'JetBrains Mono', monospace;
    --head: 'Rajdhani', sans-serif;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--mono); }

  .terminal {
    min-height: 100vh;
    background: var(--bg);
    background-image:
      linear-gradient(rgba(0,255,136,0.015) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,255,136,0.015) 1px, transparent 1px);
    background-size: 40px 40px;
    padding: 0;
    position: relative;
    overflow: hidden;
  }

  .scanlines {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
    pointer-events: none; z-index: 0;
  }

  .header {
    background: linear-gradient(180deg, rgba(0,255,136,0.06) 0%, transparent 100%);
    border-bottom: 1px solid var(--border2);
    padding: 12px 20px;
    display: flex; align-items: center; justify-content: space-between;
    position: relative; z-index: 10;
  }

  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-mark {
    width: 36px; height: 36px;
    border: 1.5px solid var(--green);
    transform: rotate(45deg);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 12px rgba(0,255,136,0.3);
  }
  .logo-mark span { transform: rotate(-45deg); font-size: 14px; color: var(--green); font-weight: 700; }
  .logo-text { font-family: var(--head); font-size: 22px; font-weight: 700; letter-spacing: 4px; color: var(--green); text-shadow: 0 0 20px rgba(0,255,136,0.4); }
  .logo-sub { font-size: 9px; letter-spacing: 3px; color: var(--text-dim); text-transform: uppercase; }

  .header-right { display: flex; align-items: center; gap: 16px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .status-text { font-size: 11px; color: var(--green); letter-spacing: 2px; }
  .tick-count { font-size: 11px; color: var(--text-dim); }

  .main { padding: 16px; position: relative; z-index: 1; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .grid-top { display: grid; grid-template-columns: 340px 1fr; gap: 12px; margin-bottom: 12px; }

  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 14px;
    position: relative;
    overflow: hidden;
  }
  .panel::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--green), transparent);
    opacity: 0.3;
  }
  .panel.accent-orange::before { background: linear-gradient(90deg, transparent, var(--orange), transparent); }
  .panel.accent-cyan::before { background: linear-gradient(90deg, transparent, var(--cyan), transparent); }
  .panel.accent-yellow::before { background: linear-gradient(90deg, transparent, var(--yellow), transparent); }
  .panel.accent-red::before { background: linear-gradient(90deg, transparent, var(--red), transparent); }

  .panel-title {
    font-family: var(--head);
    font-size: 11px;
    letter-spacing: 3px;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-bottom: 12px;
    display: flex; align-items: center; gap: 8px;
  }
  .panel-title .dot { width: 5px; height: 5px; border-radius: 50%; }
  .dot-green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot-orange { background: var(--orange); box-shadow: 0 0 6px var(--orange); }
  .dot-cyan { background: var(--cyan); box-shadow: 0 0 6px var(--cyan); }
  .dot-yellow { background: var(--yellow); box-shadow: 0 0 6px var(--yellow); }
  .dot-red { background: var(--red); box-shadow: 0 0 6px var(--red); }

  .stat-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .stat-label { font-size: 11px; color: var(--text-dim); letter-spacing: 1px; }
  .stat-val { font-size: 13px; font-weight: 700; }
  .green { color: var(--green); }
  .orange { color: var(--orange); }
  .cyan { color: var(--cyan); }
  .yellow { color: var(--yellow); }
  .red { color: var(--red); }
  .dim { color: var(--text-dim); }

  .big-num { font-size: 28px; font-weight: 700; line-height: 1; }
  .big-sub { font-size: 10px; letter-spacing: 2px; color: var(--text-dim); margin-top: 2px; }

  /* Progress bar */
  .bar-track { background: var(--border); height: 6px; border-radius: 2px; overflow: hidden; margin: 4px 0 8px; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }

  /* Tick input */
  textarea {
    width: 100%; background: #08080f; border: 1px solid var(--border2);
    color: var(--green); font-family: var(--mono); font-size: 11px;
    padding: 10px; border-radius: 3px; resize: vertical; outline: none;
    line-height: 1.6;
  }
  textarea:focus { border-color: var(--green); box-shadow: 0 0 8px rgba(0,255,136,0.1); }
  textarea::placeholder { color: var(--text-dim); }

  .btn {
    padding: 8px 16px; border: none; cursor: pointer; font-family: var(--mono);
    font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
    border-radius: 3px; transition: all 0.2s;
  }
  .btn-green { background: var(--green-dim); color: var(--green); border: 1px solid var(--green); }
  .btn-green:hover { background: rgba(0,255,136,0.2); box-shadow: 0 0 12px rgba(0,255,136,0.2); }
  .btn-orange { background: var(--orange-dim); color: var(--orange); border: 1px solid var(--orange); }
  .btn-orange:hover { background: rgba(255,107,53,0.2); }
  .btn-cyan { background: var(--cyan-dim); color: var(--cyan); border: 1px solid var(--cyan); }
  .btn-cyan:hover { background: rgba(0,191,255,0.2); }
  .btn-ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border2); }
  .btn-ghost:hover { border-color: var(--text-dim); color: var(--text); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

  /* Digit frequency */
  .digit-freq-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
  .digit-cell {
    display: flex; flex-direction: column; align-items: center;
    padding: 6px 2px; border-radius: 3px; border: 1px solid var(--border);
    transition: all 0.3s;
  }
  .digit-cell.hot { border-color: var(--orange); background: var(--orange-dim); }
  .digit-cell.cold { border-color: var(--cyan-dim); background: rgba(0,191,255,0.04); }
  .digit-num { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
  .digit-pct { font-size: 9px; color: var(--text-dim); }
  .digit-bar { width: 100%; margin-top: 4px; }

  /* Streak badge */
  .streak-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 2px; font-size: 11px; font-weight: 700;
    letter-spacing: 2px; text-transform: uppercase;
  }
  .streak-rise { background: var(--green-dim); border: 1px solid var(--green); color: var(--green); }
  .streak-fall { background: var(--red-dim); border: 1px solid var(--red); color: var(--red); }
  .streak-even { background: var(--cyan-dim); border: 1px solid var(--cyan); color: var(--cyan); }
  .streak-odd { background: var(--yellow-dim); border: 1px solid var(--yellow); color: var(--yellow); }

  /* AI Panel */
  .ai-text {
    font-size: 12px; line-height: 1.9; color: var(--text);
    background: #06060c; border: 1px solid var(--border);
    padding: 14px; border-radius: 3px; min-height: 80px;
    white-space: pre-wrap;
  }
  .ai-loading { color: var(--text-dim); font-style: italic; }

  /* Probability gauge */
  .gauge-wrap { display: flex; flex-direction: column; align-items: center; }
  .gauge-label { font-size: 11px; color: var(--text-dim); letter-spacing: 2px; margin-bottom: 4px; }
  .gauge-val { font-size: 22px; font-weight: 700; }
  .gauge-bar-wrap { width: 100%; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin: 6px 0 2px; }
  .gauge-bar-inner { height: 100%; border-radius: 4px; transition: width 0.6s cubic-bezier(.23,1,.32,1); }

  /* Tabs */
  .tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 0; }
  .tab {
    padding: 8px 14px; font-family: var(--head); font-size: 12px; letter-spacing: 2px;
    text-transform: uppercase; cursor: pointer; border: none; background: transparent;
    color: var(--text-dim); border-bottom: 2px solid transparent; margin-bottom: -1px;
    transition: all 0.2s;
  }
  .tab.active { color: var(--green); border-bottom-color: var(--green); }
  .tab:hover:not(.active) { color: var(--text); }

  /* Tick tape */
  .tick-tape {
    overflow-x: auto; white-space: nowrap; padding: 8px 0;
    font-size: 11px; color: var(--text-dim); letter-spacing: 1px;
  }
  .tick-item { display: inline-block; margin-right: 10px; }
  .tick-item.up { color: var(--green); }
  .tick-item.dn { color: var(--red); }

  /* Matches/Differs grid */
  .md-target-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  .md-target-row input {
    width: 60px; background: #08080f; border: 1px solid var(--border2);
    color: var(--green); font-family: var(--mono); font-size: 14px;
    padding: 6px 10px; border-radius: 3px; outline: none; text-align: center;
  }
  .md-target-row input:focus { border-color: var(--green); }

  /* Over/Under barrier */
  .barrier-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .barrier-btn {
    padding: 4px 10px; font-family: var(--mono); font-size: 12px;
    border: 1px solid var(--border2); background: transparent; color: var(--text-dim);
    border-radius: 2px; cursor: pointer; transition: all 0.2s;
  }
  .barrier-btn.active { border-color: var(--cyan); color: var(--cyan); background: var(--cyan-dim); }

  .last-digits-row {
    display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px;
  }
  .ld-chip {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    border-radius: 3px; font-size: 12px; font-weight: 700; border: 1px solid var(--border);
  }

  .signal-box {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 14px; border-radius: 3px; text-align: center; min-height: 80px;
  }
  .signal-label { font-size: 9px; letter-spacing: 3px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px; }
  .signal-val { font-size: 20px; font-weight: 700; font-family: var(--head); letter-spacing: 2px; }
  .signal-conf { font-size: 10px; color: var(--text-dim); margin-top: 4px; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

  .divider { border: none; border-top: 1px solid var(--border); margin: 10px 0; }

  .phase2-banner {
    border: 1px dashed #2a2a48; border-radius: 4px; padding: 12px 16px;
    text-align: center; margin-top: 12px;
    background: linear-gradient(135deg, rgba(0,191,255,0.03), rgba(255,215,0,0.03));
  }
  .phase2-title { font-family: var(--head); font-size: 13px; letter-spacing: 3px; color: var(--text-dim); margin-bottom: 4px; }
  .phase2-sub { font-size: 10px; color: #2a2a48; letter-spacing: 1px; }

  .row { display: flex; gap: 8px; align-items: flex-start; }
  .col { display: flex; flex-direction: column; gap: 8px; }
  .w-full { width: 100%; }

  @media (max-width: 900px) {
    .grid-2, .grid-3, .grid-top { grid-template-columns: 1fr; }
  }
`;

// ── CUSTOM TOOLTIP ─────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0c0c18", border: "1px solid #1e1e38", padding: "8px 12px", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
      <div style={{ color: "#5a6070" }}>Digit {label}</div>
      <div style={{ color: "#00ff88" }}>{payload[0].value} times</div>
    </div>
  );
};

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function DerivAnalysisTool() {
  const [rawInput, setRawInput] = useState("");
  const [ticks, setTicks] = useState([]);
  const [digits, setDigits] = useState([]);
  const [aiInsight, setAiInsight] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [barrier, setBarrier] = useState(4);
  const [matchTarget, setMatchTarget] = useState(5);
  const [lastUpdated, setLastUpdated] = useState(null);

  const freqData = digits.length ? getDigitFrequency(digits) : [];
  const evenOdd = digits.length ? getEvenOddStats(digits) : null;
  const riseFall = ticks.length > 1 ? getRiseFallStats(ticks) : null;
  const overUnder = digits.length ? getOverUnderStats(digits, barrier) : null;
  const matchesDiffers = digits.length ? getMatchesDiffersStats(digits, matchTarget) : null;
  const hotCold = freqData.length ? getHotCold(freqData) : { hot: [], cold: [] };

  const parseTicks = useCallback((input) => {
    const nums = input
      .split(/[\s,;\n]+/)
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n) && n > 0);
    if (nums.length < 5) return null;
    return nums;
  }, []);

  const handleAnalyze = useCallback(() => {
    const parsed = parseTicks(rawInput);
    if (!parsed) return;
    setTicks(parsed);
    setDigits(getLastDigits(parsed));
    setLastUpdated(new Date().toLocaleTimeString());
  }, [rawInput, parseTicks]);

  const handleDemo = useCallback(() => {
    const demo = genDemoTicks(100);
    setTicks(demo);
    setDigits(getLastDigits(demo));
    setRawInput(demo.map(t => t.toFixed(3)).join(", "));
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const handleAIAnalysis = useCallback(async () => {
    if (!ticks.length) return;
    setIsAnalyzing(true);
    setAiInsight("");
    const stats = { evenOdd, riseFall, overUnder, matchesDiffers, hotCold };
    const result = await fetchAIInsight(stats, ticks);
    setAiInsight(result);
    setIsAnalyzing(false);
  }, [ticks, evenOdd, riseFall, overUnder, matchesDiffers, hotCold]);

  const maxFreq = freqData.length ? Math.max(...freqData.map(d => d.count)) : 1;

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
              <div className="logo-sub">Synthetic Indices Analysis Terminal v1.0</div>
            </div>
          </div>
          <div className="header-right">
            <div style={{ textAlign: "right" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className={`status-dot ${ticks.length ? "" : ""}`} style={{ background: ticks.length ? "var(--green)" : "var(--text-dim)", boxShadow: ticks.length ? "0 0 8px var(--green)" : "none" }} />
                <span className="status-text">{ticks.length ? "DATA LOADED" : "AWAITING DATA"}</span>
              </div>
              {lastUpdated && <div className="tick-count">LAST: {lastUpdated} · {ticks.length} TICKS</div>}
            </div>
          </div>
        </div>

        <div className="main">
          {/* TOP ROW: input + freq */}
          <div className="grid-top">
            {/* Tick Input */}
            <div className="panel">
              <div className="panel-title"><span className="dot dot-green" />Tick Data Input</div>
              <textarea
                rows={6}
                placeholder={"Paste Deriv tick data here...\nExample: 1234.56, 1234.78, 1234.55\n\nOr click DEMO DATA to load sample data."}
                value={rawInput}
                onChange={e => setRawInput(e.target.value)}
              />
              <div className="btn-row">
                <button className="btn btn-green" onClick={handleAnalyze}>▶ Analyze</button>
                <button className="btn btn-ghost" onClick={handleDemo}>Demo Data</button>
                {ticks.length > 0 && (
                  <button className="btn btn-cyan" onClick={handleAIAnalysis} disabled={isAnalyzing}>
                    {isAnalyzing ? "⟳ Thinking..." : "⚡ AI Insights"}
                  </button>
                )}
              </div>

              {/* Tick tape */}
              {ticks.length > 0 && (
                <div className="tick-tape" style={{ marginTop: 10 }}>
                  {ticks.slice(-30).map((t, i, arr) => {
                    const up = i > 0 ? t >= arr[i - 1] : true;
                    return <span key={i} className={`tick-item ${up ? "up" : "dn"}`}>{t.toFixed(2)}{up ? "▲" : "▼"} </span>;
                  })}
                </div>
              )}
            </div>

            {/* Digit Frequency */}
            <div className="panel">
              <div className="panel-title"><span className="dot dot-orange" />Last Digit Frequency</div>
              {digits.length > 0 ? (
                <>
                  <div className="digit-freq-grid">
                    {freqData.map(({ digit, count, pct }) => {
                      const isHot = hotCold.hot.includes(digit);
                      const isCold = hotCold.cold.includes(digit);
                      return (
                        <div key={digit} className={`digit-cell ${isHot ? "hot" : isCold ? "cold" : ""}`}>
                          <div className={`digit-num ${isHot ? "orange" : isCold ? "cyan" : "green"}`}>{digit}</div>
                          <div className="digit-pct">{pct}%</div>
                          <div className="digit-bar">
                            <div className="bar-track" style={{ height: 4 }}>
                              <div className="bar-fill" style={{
                                width: `${(count / (maxFreq || 1)) * 100}%`,
                                background: isHot ? "var(--orange)" : isCold ? "var(--cyan)" : "var(--green)"
                              }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                    <span style={{ fontSize: 10, color: "var(--orange)" }}>🔥 HOT: {hotCold.hot.join(", ")}</span>
                    <span style={{ fontSize: 10, color: "var(--cyan)" }}>❄ COLD: {hotCold.cold.join(", ")}</span>
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--text-dim)", fontSize: 12, textAlign: "center", padding: "30px 0" }}>
                  Load tick data to see digit frequency analysis
                </div>
              )}
            </div>
          </div>

          {/* TABS */}
          <div className="tabs">
            {[["overview", "Overview"], ["evenodd", "Even/Odd"], ["risefall", "Rise/Fall"], ["matchdiffer", "Matches/Differs"], ["overunder", "Over/Under"]].map(([id, label]) => (
              <button key={id} className={`tab ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>{label}</button>
            ))}
          </div>

          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <>
              <div className="grid-3">
                {/* Even/Odd */}
                <div className="panel">
                  <div className="panel-title"><span className="dot dot-cyan" />Even / Odd</div>
                  {evenOdd ? (
                    <>
                      <div className="two-col" style={{ marginBottom: 10 }}>
                        <div className="signal-box" style={{ background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.2)" }}>
                          <div className="signal-label">Even</div>
                          <div className="signal-val cyan">{evenOdd.evenPct}%</div>
                          <div className="signal-conf">{evenOdd.even} ticks</div>
                        </div>
                        <div className="signal-box" style={{ background: "var(--yellow-dim)", border: "1px solid rgba(255,215,0,0.2)" }}>
                          <div className="signal-label">Odd</div>
                          <div className="signal-val yellow">{(100 - evenOdd.evenPct).toFixed(1)}%</div>
                          <div className="signal-conf">{evenOdd.odd} ticks</div>
                        </div>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${evenOdd.evenPct}%`, background: "linear-gradient(90deg, var(--cyan), var(--yellow))" }} />
                      </div>
                      <div className="stat-row" style={{ marginTop: 8 }}>
                        <span className="stat-label">Current Streak</span>
                        <span className={`streak-badge streak-${evenOdd.streakType?.toLowerCase()}`}>{evenOdd.streak}× {evenOdd.streakType}</span>
                      </div>
                    </>
                  ) : <div className="dim" style={{ fontSize: 11, padding: "20px 0", textAlign: "center" }}>No data</div>}
                </div>

                {/* Rise/Fall */}
                <div className="panel accent-orange">
                  <div className="panel-title"><span className="dot dot-orange" />Rise / Fall</div>
                  {riseFall ? (
                    <>
                      <div className="two-col" style={{ marginBottom: 10 }}>
                        <div className="signal-box" style={{ background: "var(--green-dim)", border: "1px solid rgba(0,255,136,0.2)" }}>
                          <div className="signal-label">Rise</div>
                          <div className="signal-val green">{((riseFall.rises / (riseFall.rises + riseFall.falls)) * 100).toFixed(1)}%</div>
                          <div className="signal-conf">{riseFall.rises} ticks</div>
                        </div>
                        <div className="signal-box" style={{ background: "var(--red-dim)", border: "1px solid rgba(255,51,102,0.2)" }}>
                          <div className="signal-label">Fall</div>
                          <div className="signal-val red">{((riseFall.falls / (riseFall.rises + riseFall.falls)) * 100).toFixed(1)}%</div>
                          <div className="signal-conf">{riseFall.falls} ticks</div>
                        </div>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(riseFall.rises / (riseFall.rises + riseFall.falls)) * 100}%`, background: "linear-gradient(90deg, var(--green), var(--red))" }} />
                      </div>
                      <div className="stat-row" style={{ marginTop: 8 }}>
                        <span className="stat-label">Current Streak</span>
                        <span className={`streak-badge streak-${riseFall.streakType?.toLowerCase()}`}>{riseFall.streak}× {riseFall.streakType}</span>
                      </div>
                    </>
                  ) : <div className="dim" style={{ fontSize: 11, padding: "20px 0", textAlign: "center" }}>No data</div>}
                </div>

                {/* Over/Under + Matches */}
                <div className="panel accent-yellow">
                  <div className="panel-title"><span className="dot dot-yellow" />Over/Under & Matches</div>
                  {overUnder && matchesDiffers ? (
                    <>
                      <div className="stat-row">
                        <span className="stat-label">Over {barrier}</span>
                        <span className="stat-val yellow">{overUnder.overPct}%</span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${overUnder.overPct}%`, background: "var(--yellow)" }} />
                      </div>
                      <div className="stat-row">
                        <span className="stat-label">Under {barrier}</span>
                        <span className="stat-val cyan">{overUnder.underPct}%</span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${overUnder.underPct}%`, background: "var(--cyan)" }} />
                      </div>
                      <hr className="divider" />
                      <div className="stat-row">
                        <span className="stat-label">Matches digit {matchTarget}</span>
                        <span className="stat-val orange">{matchesDiffers.matchPct}%</span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${matchesDiffers.matchPct}%`, background: "var(--orange)" }} />
                      </div>
                    </>
                  ) : <div className="dim" style={{ fontSize: 11, padding: "20px 0", textAlign: "center" }}>No data</div>}
                </div>
              </div>

              {/* AI Panel */}
              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="panel-title" style={{ justifyContent: "space-between" }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="dot dot-green" />AI Market Intelligence <span style={{ color: "var(--green)", fontSize: 9 }}>POWERED BY GROQ · LLAMA-3.3-70B</span></span>
                  {ticks.length > 0 && <button className="btn btn-green" onClick={handleAIAnalysis} disabled={isAnalyzing} style={{ padding: "4px 12px" }}>{isAnalyzing ? "⟳ Analyzing..." : "⚡ Run Analysis"}</button>}
                </div>
                <div className={`ai-text ${!aiInsight && "ai-loading"}`}>
                  {isAnalyzing ? "⟳ Processing market patterns through neural analysis engine..." : aiInsight || "Load tick data and click 'AI Insights' or 'Run Analysis' to receive AI-powered market commentary, trade recommendations, and pattern analysis."}
                </div>
              </div>

              {/* Momentum chart */}
              {riseFall && riseFall.momentum.length > 0 && (
                <div className="panel">
                  <div className="panel-title"><span className="dot dot-orange" />Price Momentum — Last {Math.min(ticks.length, 50)} Ticks</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={ticks.slice(-50).map((t, i) => ({ i, val: t }))} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00ff88" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                      <XAxis dataKey="i" hide />
                      <YAxis domain={["auto", "auto"]} tick={{ fill: "#5a6070", fontSize: 10 }} width={55} />
                      <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }} />
                      <Area type="monotone" dataKey="val" stroke="#00ff88" strokeWidth={1.5} fill="url(#gGreen)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}

          {/* EVEN/ODD TAB */}
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
                <div className="stat-row">
                  <span className="stat-label">Bias Indicator</span>
                  <span className="stat-val" style={{ color: parseFloat(evenOdd.evenPct) > 52 ? "var(--cyan)" : parseFloat(evenOdd.evenPct) < 48 ? "var(--yellow)" : "var(--text-dim)" }}>
                    {parseFloat(evenOdd.evenPct) > 52 ? "EVEN BIAS" : parseFloat(evenOdd.evenPct) < 48 ? "ODD BIAS" : "BALANCED"}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Current Streak</span>
                  <span className={`streak-badge streak-${evenOdd.streakType?.toLowerCase()}`}>{evenOdd.streak}× {evenOdd.streakType}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Streak Risk</span>
                  <span className="stat-val" style={{ color: evenOdd.streak >= 5 ? "var(--red)" : evenOdd.streak >= 3 ? "var(--orange)" : "var(--green)" }}>
                    {evenOdd.streak >= 5 ? "⚠ HIGH — MEAN REVERSION LIKELY" : evenOdd.streak >= 3 ? "MODERATE" : "LOW"}
                  </span>
                </div>
                <hr className="divider" />
                <div className="stat-row">
                  <span className="stat-label">Recommended Trade</span>
                  <span className="stat-val" style={{ color: "var(--green)" }}>
                    {evenOdd.streak >= 4
                      ? `BET ${evenOdd.streakType === "EVEN" ? "ODD" : "EVEN"} (REVERSAL)`
                      : `FOLLOW ${evenOdd.streakType} (MOMENTUM)`}
                  </span>
                </div>
                <hr className="divider" />
                <div className="panel-title" style={{ marginTop: 6 }}><span className="dot dot-cyan" />Last 20 Digits</div>
                <div className="last-digits-row">
                  {digits.slice(-20).map((d, i) => (
                    <div key={i} className="ld-chip" style={{
                      background: d % 2 === 0 ? "var(--cyan-dim)" : "var(--yellow-dim)",
                      borderColor: d % 2 === 0 ? "rgba(0,191,255,0.3)" : "rgba(255,215,0,0.3)",
                      color: d % 2 === 0 ? "var(--cyan)" : "var(--yellow)"
                    }}>{d}</div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-cyan" />Even vs Odd — Bar Chart</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={[{ name: "EVEN", count: evenOdd.even }, { name: "ODD", count: evenOdd.odd }]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="name" tick={{ fill: "#5a6070", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      <Cell fill="var(--cyan)" />
                      <Cell fill="var(--yellow)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-green" />Even/Odd Frequency by Digit</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={freqData.map(d => ({ ...d, type: d.digit % 2 === 0 ? "E" : "O" }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="digit" tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {freqData.map((d, i) => <Cell key={i} fill={d.digit % 2 === 0 ? "var(--cyan)" : "var(--yellow)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* RISE/FALL TAB */}
          {activeTab === "risefall" && riseFall && (
            <div className="grid-2">
              <div className="panel accent-orange">
                <div className="panel-title"><span className="dot dot-orange" />Rise/Fall Analysis</div>
                <div className="two-col" style={{ marginBottom: 14 }}>
                  <div className="signal-box" style={{ background: "var(--green-dim)", border: "1px solid rgba(0,255,136,0.25)" }}>
                    <div className="signal-label">Total Rises</div>
                    <div className="signal-val green">{riseFall.rises}</div>
                    <div className="signal-conf">{((riseFall.rises / (riseFall.rises + riseFall.falls)) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="signal-box" style={{ background: "var(--red-dim)", border: "1px solid rgba(255,51,102,0.25)" }}>
                    <div className="signal-label">Total Falls</div>
                    <div className="signal-val red">{riseFall.falls}</div>
                    <div className="signal-conf">{((riseFall.falls / (riseFall.rises + riseFall.falls)) * 100).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Market Direction</span>
                  <span className="stat-val" style={{ color: riseFall.rises > riseFall.falls ? "var(--green)" : "var(--red)" }}>
                    {riseFall.rises > riseFall.falls ? "↑ BULLISH BIAS" : riseFall.falls > riseFall.rises ? "↓ BEARISH BIAS" : "NEUTRAL"}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Current Streak</span>
                  <span className={`streak-badge streak-${riseFall.streakType?.toLowerCase()}`}>{riseFall.streak}× {riseFall.streakType}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Momentum Signal</span>
                  <span className="stat-val" style={{ color: riseFall.streak >= 4 ? "var(--orange)" : "var(--green)" }}>
                    {riseFall.streak >= 6 ? "OVEREXTENDED" : riseFall.streak >= 4 ? "STRONG TREND" : riseFall.streak >= 2 ? "DEVELOPING" : "MIXED"}
                  </span>
                </div>
                <hr className="divider" />
                <div className="stat-row">
                  <span className="stat-label">Signal</span>
                  <span className="stat-val green">
                    {riseFall.streak >= 5
                      ? `ENTER ${riseFall.streakType === "RISE" ? "FALL" : "RISE"} (FADE)`
                      : `RIDE ${riseFall.streakType} MOMENTUM`}
                  </span>
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-orange" />Price Chart — All Ticks</div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={ticks.map((t, i) => ({ i, val: t }))}>
                    <defs>
                      <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff6b35" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#ff6b35" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="i" hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fill: "#5a6070", fontSize: 10 }} width={55} />
                    <Tooltip contentStyle={{ background: "#0c0c18", border: "1px solid #1e1e38", fontSize: 11 }} />
                    <Area type="monotone" dataKey="val" stroke="#ff6b35" strokeWidth={1.5} fill="url(#gOrange)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-green" />Rise/Fall Distribution</div>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={[{ name: "RISE", count: riseFall.rises }, { name: "FALL", count: riseFall.falls }]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="name" tick={{ fill: "#5a6070", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      <Cell fill="var(--green)" />
                      <Cell fill="var(--red)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* MATCHES/DIFFERS TAB */}
          {activeTab === "matchdiffer" && matchesDiffers && (
            <div className="grid-2">
              <div className="panel accent-orange">
                <div className="panel-title"><span className="dot dot-orange" />Matches / Differs</div>
                <div className="md-target-row">
                  <span className="stat-label">Target Digit:</span>
                  <input type="number" min="0" max="9" value={matchTarget} onChange={e => setMatchTarget(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))} />
                  <span className="stat-label" style={{ color: "var(--text-dim)" }}>( 0 – 9 )</span>
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
                <div className="stat-row">
                  <span className="stat-label">Expected hit rate</span>
                  <span className="stat-val dim">~10.0%</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Actual hit rate</span>
                  <span className="stat-val" style={{ color: parseFloat(matchesDiffers.matchPct) > 12 ? "var(--orange)" : "var(--green)" }}>{matchesDiffers.matchPct}%</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Deviation</span>
                  <span className="stat-val" style={{ color: "var(--yellow)" }}>{(parseFloat(matchesDiffers.matchPct) - 10).toFixed(1)}%</span>
                </div>
                <hr className="divider" />
                <div className="stat-row">
                  <span className="stat-label">Recommended</span>
                  <span className="stat-val green">
                    {parseFloat(matchesDiffers.matchPct) > 13 ? "MATCHES (HOT DIGIT)" : "DIFFERS (DOMINANT)"}
                  </span>
                </div>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-green" />Last 20 Digits</div>
                <div className="last-digits-row">
                  {digits.slice(-20).map((d, i) => (
                    <div key={i} className="ld-chip" style={{
                      background: d === matchTarget ? "var(--orange-dim)" : "transparent",
                      borderColor: d === matchTarget ? "var(--orange)" : "var(--border)",
                      color: d === matchTarget ? "var(--orange)" : "var(--text-dim)"
                    }}>{d}</div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-orange" />All Digit Frequencies vs Target</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={freqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="digit" tick={{ fill: "#5a6070", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {freqData.map((d, i) => <Cell key={i} fill={d.digit === matchTarget ? "var(--orange)" : "var(--border2)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-orange" />Matches vs Differs</div>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={[{ name: `MATCH (${matchTarget})`, count: matchesDiffers.matches }, { name: "DIFFERS", count: matchesDiffers.differs }]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="name" tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      <Cell fill="var(--orange)" />
                      <Cell fill="var(--green)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* OVER/UNDER TAB */}
          {activeTab === "overunder" && overUnder && (
            <div className="grid-2">
              <div className="panel accent-yellow">
                <div className="panel-title"><span className="dot dot-yellow" />Over / Under Analysis</div>
                <div className="barrier-row">
                  <span className="stat-label">Barrier:</span>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(b => (
                    <button key={b} className={`barrier-btn ${barrier === b ? "active" : ""}`} onClick={() => setBarrier(b)}>{b}</button>
                  ))}
                </div>
                <div className="two-col" style={{ marginBottom: 14 }}>
                  <div className="signal-box" style={{ background: "var(--yellow-dim)", border: "1px solid rgba(255,215,0,0.25)" }}>
                    <div className="signal-label">Over {barrier}</div>
                    <div className="signal-val yellow">{overUnder.overPct}%</div>
                    <div className="signal-conf">{overUnder.over} ticks</div>
                  </div>
                  <div className="signal-box" style={{ background: "var(--cyan-dim)", border: "1px solid rgba(0,191,255,0.25)" }}>
                    <div className="signal-label">Under {barrier}</div>
                    <div className="signal-val cyan">{overUnder.underPct}%</div>
                    <div className="signal-conf">{overUnder.under} ticks</div>
                  </div>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Equal to {barrier}</span>
                  <span className="stat-val dim">{overUnder.eq} ticks</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Dominant Side</span>
                  <span className="stat-val" style={{ color: parseFloat(overUnder.overPct) > parseFloat(overUnder.underPct) ? "var(--yellow)" : "var(--cyan)" }}>
                    {parseFloat(overUnder.overPct) > parseFloat(overUnder.underPct) ? `OVER ${barrier}` : `UNDER ${barrier}`}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Imbalance</span>
                  <span className="stat-val orange">{Math.abs(parseFloat(overUnder.overPct) - parseFloat(overUnder.underPct)).toFixed(1)}%</span>
                </div>
                <hr className="divider" />
                <div className="stat-row">
                  <span className="stat-label">Recommended</span>
                  <span className="stat-val green">
                    {parseFloat(overUnder.overPct) > 58
                      ? `OVER ${barrier} (DOMINANT)`
                      : parseFloat(overUnder.underPct) > 58
                      ? `UNDER ${barrier} (DOMINANT)`
                      : "WAIT — BALANCED MARKET"}
                  </span>
                </div>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-yellow" />Last 20 Digits</div>
                <div className="last-digits-row">
                  {digits.slice(-20).map((d, i) => (
                    <div key={i} className="ld-chip" style={{
                      background: d > barrier ? "var(--yellow-dim)" : d < barrier ? "var(--cyan-dim)" : "var(--border)",
                      borderColor: d > barrier ? "rgba(255,215,0,0.3)" : d < barrier ? "rgba(0,191,255,0.3)" : "var(--border2)",
                      color: d > barrier ? "var(--yellow)" : d < barrier ? "var(--cyan)" : "var(--text-dim)"
                    }}>{d}</div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><span className="dot dot-yellow" />Digit Distribution vs Barrier {barrier}</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={freqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="digit" tick={{ fill: "#5a6070", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {freqData.map((d, i) => (
                        <Cell key={i} fill={d.digit > barrier ? "var(--yellow)" : d.digit < barrier ? "var(--cyan)" : "var(--orange)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="panel-title" style={{ marginTop: 12 }}><span className="dot dot-yellow" />Over vs Under vs Equal</div>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={[
                    { name: `OVER ${barrier}`, count: overUnder.over },
                    { name: `EQUAL`, count: overUnder.eq },
                    { name: `UNDER ${barrier}`, count: overUnder.under }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="name" tick={{ fill: "#5a6070", fontSize: 9 }} />
                    <YAxis tick={{ fill: "#5a6070", fontSize: 10 }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      <Cell fill="var(--yellow)" />
                      <Cell fill="var(--orange)" />
                      <Cell fill="var(--cyan)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* No data state */}
          {(activeTab !== "overview") && digits.length === 0 && (
            <div className="panel" style={{ textAlign: "center", padding: "40px" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
              <div style={{ color: "var(--text-dim)", fontSize: 13, letterSpacing: 2 }}>PASTE TICK DATA OR LOAD DEMO DATA TO BEGIN ANALYSIS</div>
            </div>
          )}

          {/* PHASE 2 TEASER */}
          <div className="phase2-banner">
            <div className="phase2-title">⚙ PHASE 2 — XML BOT ANALYZER [COMING SOON]</div>
            <div className="phase2-sub">Upload Deriv bot XML files · Strategy matching · Bot health checker · Auto-optimization</div>
          </div>
        </div>
      </div>
    </>
  );
}

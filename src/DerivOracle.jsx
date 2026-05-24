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
  *{box-sizing:border-box;margin:0;padding:0;}
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
  .tabs{display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid var(--border);}
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
  @media(max-width:900px){
    .grid-top,.grid-2,.grid-3{grid-template-columns:1fr;}
    .symbol-bar{gap:4px;}
  }
`;

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
        setWsStatus("live");

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
              {[["overview","Overview"],["evenodd","Even/Odd"],["risefall","Rise/Fall"],["matchdiffer","Matches/Differs"],["overunder","Over/Under"]].map(([id, label]) => (
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
                      <Cell fill="var(--cyan)" /><Cell fill="var(--yellow)" />
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

          {/* PHASE 2 TEASER */}
          <div className="phase2-banner">
            <div className="phase2-title">⚙ PHASE 3 — ONE-CLICK TRADE EXECUTION + XML BOT ANALYZER [COMING SOON]</div>
            <div className="phase2-sub">Buy contracts directly · Upload Deriv bot XML files · Strategy matching · Bot health checker</div>
          </div>

        </div>
      </div>
    </>
  );
}

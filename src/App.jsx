import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import "./App.css";

// Public API Gateway endpoint. No AWS credentials belong in this frontend.
const API_URL =
  "https://gmy2vap70a.execute-api.ap-south-1.amazonaws.com/dev/readings";

const DEVICE_ID = "esp32-anomaly-01";
const TEMP_THRESHOLD = 35;
const HUM_THRESHOLD = 80;
const OFFLINE_AFTER_MS = 30000;
const HISTORY_POINTS = 30;
const REFRESH_INTERVAL_MS = 10000;

const RULES = {
  TEMP_HIGH: { id: "R-001", name: "Temperature above limit" },
  HUMIDITY_HIGH: { id: "R-002", name: "Humidity above limit" },
  TEMP_AND_HUMIDITY_HIGH: { id: "R-003", name: "Temperature and humidity above limit" },
};

const PRESETS = [
  { label: "Normal", t: 25, h: 50 },
  { label: "High temperature", t: 42, h: 55 },
  { label: "High humidity", t: 28, h: 92 },
  { label: "Critical", t: 48, h: 95 },
];

// Same detection rule as the device thresholds.
const detect = (t, h) => {
  const tHigh = t > TEMP_THRESHOLD;
  const hHigh = h > HUM_THRESHOLD;
  return {
    anomaly: tHigh || hHigh,
    reason:
      tHigh && hHigh ? "TEMP_AND_HUMIDITY_HIGH" : tHigh ? "TEMP_HIGH" : hHigh ? "HUMIDITY_HIGH" : "NONE",
  };
};

const severity = (r) => {
  if (!r.anomaly) return { key: "info", label: "Info" };
  if (r.reason === "TEMP_AND_HUMIDITY_HIGH") return { key: "critical", label: "Critical" };
  if (r.temperature > TEMP_THRESHOLD + 5 || r.humidity > HUM_THRESHOLD + 10)
    return { key: "high", label: "High" };
  return { key: "medium", label: "Medium" };
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
const formatTime = (s) => new Date(s * 1000).toLocaleTimeString();
const formatDateTime = (s) => new Date(s * 1000).toLocaleString();
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const rowKey = (r) => `${r.deviceId}-${r.timestamp}-${r.id ?? ""}`;

function SeverityBadge({ reading }) {
  const sev = severity(reading);
  return <span className={`sev sev-${sev.key}`}>{sev.label}</span>;
}

function HistoryChart({ title, data, dataKey, unit, color, threshold }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="chip">Limit {threshold}{unit}</span>
      </div>
      {data.length === 0 ? (
        <p className="empty">Waiting for sensor readings...</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="#1e2a42" strokeDasharray="3 3" />
            <XAxis dataKey="time" minTickGap={34} tick={{ fill: "#7f8ea8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis unit={unit} domain={["auto", "auto"]} tick={{ fill: "#7f8ea8", fontSize: 11 }} axisLine={false} tickLine={false} width={54} />
            <Tooltip
              contentStyle={{ background: "#0e1626", border: "1px solid #2a3a5a", borderRadius: 6, color: "#d6deeb", fontSize: 12 }}
              labelStyle={{ color: "#7f8ea8" }}
            />
            <ReferenceLine
              y={threshold}
              stroke="#ff4d4f"
              strokeDasharray="5 4"
              label={{ value: `Limit ${threshold}${unit}`, fill: "#ff7875", position: "insideTopRight", fontSize: 11 }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke={color}
              strokeWidth={2}
              isAnimationActive={false}
              dot={({ cx, cy, payload, index }) =>
                payload.anomaly ? (
                  <circle key={`d${index}`} cx={cx} cy={cy} r={4.5} fill="#ff4d4f" stroke="#0b1220" strokeWidth={1.5} />
                ) : (
                  <g key={`d${index}`} />
                )
              }
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

export default function App() {
  const [live, setLive] = useState([]);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Simulation (browser only — the API stays read-only)
  const [sim, setSim] = useState([]);
  const [simT, setSimT] = useState(25);
  const [simH, setSimH] = useState(50);
  const [streaming, setStreaming] = useState(false);
  const [onlySim, setOnlySim] = useState(false);

  // Filtros do histórico
  const [query, setQuery] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const idRef = useRef(0);
  const valuesRef = useRef({ t: 25, h: 50 });
  valuesRef.current = { t: simT, h: simH };

  const inject = (t, h) => {
    const temperature = Math.round(clamp(t, 0, 70) * 10) / 10;
    const humidity = Math.round(clamp(h, 0, 100) * 10) / 10;
    const id = ++idRef.current;
    setSim((prev) =>
      [
        ...prev,
        {
          id,
          deviceId: DEVICE_ID,
          temperature,
          humidity,
          ...detect(temperature, humidity),
          timestamp: Math.floor(Date.now() / 1000),
          simulated: true,
        },
      ].slice(-200)
    );
  };

  useEffect(() => {
    let active = true;

    async function fetchReadings() {
      try {
        const response = await fetch(API_URL, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.readings)) {
          throw new Error("The API response does not contain a readings array.");
        }
        if (active) {
          setLive(payload.readings);
          setLastFetchAt(Date.now());
          setError("");
        }
      } catch (err) {
        console.error("Unable to retrieve sensor readings:", err);
        if (active) setError(err.message || "Unable to connect to the API.");
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchReadings();
    const refreshTimer = window.setInterval(fetchReadings, REFRESH_INTERVAL_MS);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  // Continuous stream: injects one reading every 2 s with small jitter
  useEffect(() => {
    if (!streaming) return undefined;
    const timer = window.setInterval(() => {
      const { t, h } = valuesRef.current;
      inject(t + (Math.random() - 0.5), h + (Math.random() - 0.5) * 2);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const readings = useMemo(() => (onlySim ? sim : [...live, ...sim]), [live, sim, onlySim]);

  const sorted = useMemo(
    () =>
      [...readings]
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
        .map((r) => ({
          ...r,
          temperature: Number(r.temperature),
          humidity: Number(r.humidity),
          time: formatTime(Number(r.timestamp)),
        })),
    [readings]
  );

  const latest = sorted.length ? sorted[sorted.length - 1] : null;

  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() + 59999 : null; // inclui o minuto final
  const hasFilter = Boolean(query.trim() || sevFilter !== "all" || from || to);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sorted.filter((r) => {
      const ms = Number(r.timestamp) * 1000;
      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;
      if (sevFilter !== "all" && severity(r).key !== sevFilter) return false;
      if (!needle) return true;
      const text = [
        formatDateTime(Number(r.timestamp)),
        new Date(ms).toISOString(),
        r.temperature,
        r.humidity,
        r.reason,
        RULES[r.reason]?.name,
        severity(r).label,
        r.simulated ? "simulated" : "sensor",
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(needle);
    });
  }, [sorted, query, sevFilter, fromMs, toMs]);

  // Sem filtro: gráficos mostram os últimos pontos. Com filtro: todo o intervalo filtrado.
  const chartData = hasFilter ? filtered : filtered.slice(-HISTORY_POINTS);
  const allAnomalies = useMemo(() => filtered.filter((r) => r.anomaly === true).reverse(), [filtered]);
  const logs = useMemo(() => [...filtered].reverse(), [filtered]);

  const deviceOnline = latest ? now - Number(latest.timestamp) * 1000 < OFFLINE_AFTER_MS : false;
  const latestIsAnomaly = latest?.anomaly === true;
  const latestRule = latest ? RULES[latest.reason] : null;
  const anomalyRate = filtered.length ? Math.round((allAnomalies.length / filtered.length) * 100) : 0;

  const preview = detect(simT, simH);
  const previewReading = { ...preview, temperature: simT, humidity: simH };
  const pct = (v, limit) => `${Math.min(100, Math.max(0, ((v || 0) / limit) * 100))}%`;

  return (
    <div className="siem">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">IoT</div>
          <div>
            <strong>IoT SIEM</strong>
            <span>Anomaly detection</span>
          </div>
        </div>
        <nav>
          <a href="#painel">Dashboard</a>
          <a href="#alertas">Alerts <b>{sorted.filter((r) => r.anomaly === true).length}</b></a>
          <a href="#eventos">Raw events</a>
          <a href="#simulador">Simulator</a>
        </nav>
        <div className="side-foot">
          <span>Device</span>
          <strong>{DEVICE_ID}</strong>
          <span>Pipeline</span>
          <small>ESP8266 → IoT Core → DynamoDB → Lambda → API Gateway</small>
        </div>
      </aside>

      <main className="main" id="painel">
        <header className="topbar">
          <div>
            <h1>Security overview</h1>
            <p>Live environmental telemetry and anomaly events</p>
          </div>
          <div className="top-right">
            {sim.length > 0 && <span className="pill sim">Simulation active</span>}
            <span className="pill range">
              {hasFilter ? `${filtered.length} of ${sorted.length} events` : `Last ${chartData.length} events`}
            </span>
            <span className={`pill ${deviceOnline ? "ok" : "off"}`}>
              <i className="dot" />
              {deviceOnline ? "Device online" : "Device offline"}
            </span>
          </div>
        </header>

        {error && (
          <div className="banner banner-error">
            <strong>Unable to load sensor data</strong>
            <span>{error}. Check that the API is deployed and allows browser requests through CORS.</span>
          </div>
        )}

        {latestIsAnomaly && (
          <div className={`banner banner-${severity(latest).key}`}>
            <SeverityBadge reading={latest} />
            <strong>{latestRule?.name || "Anomaly detected"}</strong>
            <span>
              {latest.temperature.toFixed(1)} °C · {latest.humidity.toFixed(1)} % ·{" "}
              {formatDateTime(Number(latest.timestamp))}
              {latest.simulated ? " · simulated event" : ""}
            </span>
          </div>
        )}

        <section className="filters" aria-label="History filters">
          <label className="grow">
            <span>Search</span>
            <input
              type="search"
              placeholder="Time, date, value, rule or source"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span>From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            <span>Severity</span>
            <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="info">Info (normal)</option>
            </select>
          </label>
          <div className="quick">
            {[["Last 15 min", 15], ["Last hour", 60], ["Last 24 h", 1440]].map(([label, min]) => (
              <button
                key={label}
                type="button"
                className="btn ghost"
                onClick={() => { setFrom(toLocalInput(new Date(Date.now() - min * 60000))); setTo(""); }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="btn ghost"
              disabled={!hasFilter}
              onClick={() => { setQuery(""); setFrom(""); setTo(""); setSevFilter("all"); }}
            >
              Clear filters
            </button>
          </div>
        </section>

        <section className="kpis">
          <article className={`kpi ${latest && latest.temperature > TEMP_THRESHOLD ? "over" : ""}`}>
            <span className="kpi-label">Temperature</span>
            <div className="kpi-value">{latest ? `${latest.temperature.toFixed(1)} °C` : "--"}</div>
            <div className="bar"><span style={{ width: pct(latest?.temperature, TEMP_THRESHOLD) }} /></div>
            <small>Limit {TEMP_THRESHOLD} °C</small>
          </article>
          <article className={`kpi ${latest && latest.humidity > HUM_THRESHOLD ? "over" : ""}`}>
            <span className="kpi-label">Humidity</span>
            <div className="kpi-value">{latest ? `${latest.humidity.toFixed(1)} %` : "--"}</div>
            <div className="bar"><span style={{ width: pct(latest?.humidity, HUM_THRESHOLD) }} /></div>
            <small>Limit {HUM_THRESHOLD} %</small>
          </article>
          <article className={`kpi status-${latest ? severity(latest).key : "info"}`}>
            <span className="kpi-label">Current state</span>
            <div className="kpi-value">{latest ? (latestIsAnomaly ? "Anomaly" : "Normal") : "--"}</div>
            <div>{latest && <SeverityBadge reading={latest} />}</div>
            <small>{latestRule?.name || "Within configured limits"}</small>
          </article>
          <article className="kpi">
            <span className="kpi-label">Alerts in period</span>
            <div className="kpi-value">{allAnomalies.length}</div>
            <div className="bar"><span style={{ width: `${anomalyRate}%` }} /></div>
            <small>{anomalyRate}% of {filtered.length} events</small>
          </article>
        </section>

        <div className="grid-2">
          <HistoryChart title="Temperature" data={chartData} dataKey="temperature" unit="°C" color="#fb923c" threshold={TEMP_THRESHOLD} />
          <HistoryChart title="Humidity" data={chartData} dataKey="humidity" unit="%" color="#38bdf8" threshold={HUM_THRESHOLD} />
        </div>

        <div className="grid-split">
          <section className="panel" id="alertas">
            <div className="panel-head">
              <h2>Recent alerts</h2>
              <span className="chip">{allAnomalies.length} alerts</span>
            </div>
            {allAnomalies.length === 0 ? (
              <p className="empty">
                {hasFilter
                  ? "No alerts match the current filters."
                  : "No alerts. All readings are within thresholds. Use the simulator to generate one."}
              </p>
            ) : (
              <div className="table-wrap scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Time</th>
                      <th>Rule</th>
                      <th>Temp.</th>
                      <th>Hum.</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allAnomalies.map((r) => (
                      <tr key={rowKey(r)}>
                        <td><SeverityBadge reading={r} /></td>
                        <td className="mono">{formatDateTime(Number(r.timestamp))}</td>
                        <td>
                          <span className="mono rule-id">{RULES[r.reason]?.id || "R-???"}</span>{" "}
                          {RULES[r.reason]?.name || r.reason || "Unknown"}
                        </td>
                        <td className="mono">{Number(r.temperature).toFixed(1)} °C</td>
                        <td className="mono">{Number(r.humidity).toFixed(1)} %</td>
                        <td>{r.simulated ? <span className="tag-sim">Simulated</span> : "Sensor"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel sim-panel" id="simulador">
            <div className="panel-head">
              <h2>Reading simulator</h2>
              <span className="chip">Browser only</span>
            </div>
            <p className="hint">
              Adjust the values and inject a reading to test detection. Nothing is written to AWS.
            </p>

            <label className="field">
              <span>Temperature <b>{simT.toFixed(1)} °C</b></span>
              <input type="range" min="0" max="70" step="0.5" value={simT} onChange={(e) => setSimT(clamp(e.target.value, 0, 70))} />
              <input type="number" min="0" max="70" step="0.5" value={simT} onChange={(e) => setSimT(clamp(e.target.value, 0, 70))} />
            </label>
            <label className="field">
              <span>Humidity <b>{simH.toFixed(1)} %</b></span>
              <input type="range" min="0" max="100" step="0.5" value={simH} onChange={(e) => setSimH(clamp(e.target.value, 0, 100))} />
              <input type="number" min="0" max="100" step="0.5" value={simH} onChange={(e) => setSimH(clamp(e.target.value, 0, 100))} />
            </label>

            <div className={`preview preview-${severity(previewReading).key}`}>
              <SeverityBadge reading={previewReading} />
              <span>
                {preview.anomaly
                  ? `Will trigger alert: ${RULES[preview.reason].name}`
                  : "Normal reading, no alert"}
              </span>
            </div>

            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" className="btn ghost" onClick={() => { setSimT(p.t); setSimH(p.h); }}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="actions">
              <button type="button" className="btn primary" onClick={() => inject(simT, simH)}>
                Inject reading
              </button>
              <button type="button" className="btn ghost" onClick={() => { setSim([]); setStreaming(false); }} disabled={sim.length === 0}>
                Clear simulation
              </button>
            </div>

            <label className="check">
              <input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />
              Continuous stream (1 reading every 2 s)
            </label>
            <label className="check">
              <input type="checkbox" checked={onlySim} onChange={(e) => setOnlySim(e.target.checked)} />
              Hide real sensor data
            </label>
            <small className="hint">{sim.length} simulated readings this session</small>
          </section>
        </div>

        <section className="panel" id="eventos">
          <div className="panel-head">
            <h2>Raw events</h2>
            <span className="chip">
              {logs.length} events · refreshes every 10 s · {loading ? "connecting..." : lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : "--"}
            </span>
          </div>
          {logs.length === 0 ? (
            <p className="empty">{hasFilter ? "No events match the current filters." : "No events received yet."}</p>
          ) : (
            <div className="log">
              {logs.map((r) => (
                <div key={rowKey(r)} className={`log-line ${r.anomaly ? "is-alert" : ""}`}>
                  <span className="log-time">{new Date(Number(r.timestamp) * 1000).toISOString()}</span>
                  <span className={`log-level lvl-${severity(r).key}`}>{r.anomaly ? "ALERT" : "INFO"}</span>
                  <span>
                    device={r.deviceId || DEVICE_ID} temp={r.temperature.toFixed(1)} hum={r.humidity.toFixed(1)} anomaly=
                    {String(r.anomaly === true)} reason={r.reason || "NONE"}
                    {r.simulated ? " src=simulation" : " src=sensor"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

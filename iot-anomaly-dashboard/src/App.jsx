import React, { useEffect, useMemo, useState } from "react";
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
const ANOMALY_ROWS = 10;
const REFRESH_INTERVAL_MS = 10000;

const REASONS = {
  TEMP_HIGH: "High temperature",
  HUMIDITY_HIGH: "High humidity",
  TEMP_AND_HUMIDITY_HIGH: "High temperature and humidity",
  NONE: "None",
};

const formatTime = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleTimeString();

const formatDateTime = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleString();

function HistoryChart({ title, data, dataKey, unit, color, threshold }) {
  return (
    <section className="card chart-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SENSOR TELEMETRY</p>
          <h2>{title}</h2>
        </div>
        <span className="limit-label">Threshold: {threshold}{unit}</span>
      </div>

      {data.length === 0 ? (
        <p className="empty-state">Waiting for sensor readings...</p>
      ) : (
        <ResponsiveContainer width="100%" height={270}>
          <LineChart
            data={data}
            margin={{ top: 12, right: 18, left: 2, bottom: 4 }}
          >
            <CartesianGrid stroke="#e8edf4" strokeDasharray="4 4" />
            <XAxis
              dataKey="time"
              minTickGap={28}
              tick={{ fill: "#7b8798", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              unit={unit}
              domain={["auto", "auto"]}
              tick={{ fill: "#7b8798", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={58}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 10,
                border: "1px solid #e4eaf2",
                boxShadow: "0 8px 24px rgba(20,35,60,.10)",
              }}
            />
            <ReferenceLine
              y={threshold}
              stroke="#dc5353"
              strokeDasharray="5 5"
              label={{
                value: `Limit ${threshold}${unit}`,
                fill: "#c34444",
                position: "insideTopRight",
                fontSize: 11,
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke={color}
              dot={false}
              strokeWidth={2.5}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

export default function App() {
  const [readings, setReadings] = useState([]);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function fetchReadings() {
      try {
        const response = await fetch(API_URL, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`API returned HTTP ${response.status}`);
        }

        const payload = await response.json();

        if (!Array.isArray(payload.readings)) {
          throw new Error("The API response does not contain a readings array.");
        }

        if (active) {
          setReadings(payload.readings);
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

  const history = useMemo(() => {
    return [...readings]
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      .slice(-HISTORY_POINTS)
      .map((reading) => ({
        ...reading,
        temperature: Number(reading.temperature),
        humidity: Number(reading.humidity),
        time: formatTime(Number(reading.timestamp)),
      }));
  }, [readings]);

  const latest = history.length ? history[history.length - 1] : null;

  const anomalies = useMemo(() => {
    return readings
      .filter((reading) => reading.anomaly === true)
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      .slice(0, ANOMALY_ROWS);
  }, [readings]);

  // DynamoDB timestamp values are Unix seconds, while Date.now() is milliseconds.
  const latestTimestampMs = latest ? Number(latest.timestamp) * 1000 : 0;
  const deviceOnline = latest
    ? now - latestTimestampMs < OFFLINE_AFTER_MS
    : false;
  const latestIsAnomaly = latest?.anomaly === true;

  return (
    <main className="app-shell">
      <div className="container">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">IoT</div>
            <div>
              <p className="eyebrow">MONITORING PLATFORM</p>
              <h1>IoT Anomaly Detection</h1>
            </div>
          </div>
          <div className={`connection-pill ${deviceOnline ? "online" : "offline"}`}>
            <span className="connection-dot" />
            {deviceOnline ? "Device online" : "Device offline"}
          </div>
        </header>

        <section className="intro-row">
          <div>
            <h2>Environmental overview</h2>
            <p>Live temperature, humidity and anomaly monitoring.</p>
          </div>
          <div className="device-meta">
            <span>DEVICE</span>
            <strong>{DEVICE_ID}</strong>
          </div>
        </section>

        {error && (
          <section className="alert error-alert">
            <strong>Unable to load sensor data</strong>
            <span>{error}</span>
            <small>
              Check that the API is deployed and allows browser requests through CORS.
            </small>
          </section>
        )}

        <section className="metrics-grid">
          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">Temperature</span>
              <span className="metric-icon temperature-icon">°C</span>
            </div>
            <div className="metric-value">
              {latest ? `${latest.temperature.toFixed(1)}°` : "--"}
            </div>
            <div className="metric-foot">
              <span>Threshold</span>
              <strong>{TEMP_THRESHOLD} °C</strong>
            </div>
            <div className="metric-track">
              <span
                className="metric-fill temp-fill"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, ((latest?.temperature || 0) / TEMP_THRESHOLD) * 100)
                  )}%`,
                }}
              />
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">Humidity</span>
              <span className="metric-icon humidity-icon">%</span>
            </div>
            <div className="metric-value">
              {latest ? `${latest.humidity.toFixed(1)}%` : "--"}
            </div>
            <div className="metric-foot">
              <span>Threshold</span>
              <strong>{HUM_THRESHOLD} %</strong>
            </div>
            <div className="metric-track">
              <span
                className="metric-fill humidity-fill"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, ((latest?.humidity || 0) / HUM_THRESHOLD) * 100)
                  )}%`,
                }}
              />
            </div>
          </article>

          <article className={`metric-card status-card ${latestIsAnomaly ? "status-danger" : ""}`}>
            <div className="metric-top">
              <span className="metric-label">Anomaly status</span>
              <span className={`status-symbol ${latestIsAnomaly ? "danger" : "safe"}`}>
                {latestIsAnomaly ? "!" : "✓"}
              </span>
            </div>
            <div className="metric-value status-value">
              {latest ? (latestIsAnomaly ? "ANOMALY" : "NORMAL") : "--"}
            </div>
            <div className="metric-foot">
              <span>Latest sensor state</span>
              <strong>{latest?.reason || "Waiting"}</strong>
            </div>
          </article>
        </section>

        <section className="info-strip">
          <div>
            <span className="info-label">Last sensor reading</span>
            <strong>{latest ? formatDateTime(Number(latest.timestamp)) : "No data yet"}</strong>
          </div>
          <div>
            <span className="info-label">API connection</span>
            <strong className={error ? "text-danger" : "text-success"}>
              {error ? "Error" : loading ? "Connecting..." : "Available"}
            </strong>
          </div>
          <div>
            <span className="info-label">Last API refresh</span>
            <strong>{lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : "--"}</strong>
          </div>
        </section>

        <div className="charts-grid">
          <HistoryChart
            title="Temperature history"
            data={history}
            dataKey="temperature"
            unit="°C"
            color="#e4773f"
            threshold={TEMP_THRESHOLD}
          />
          <HistoryChart
            title="Humidity history"
            data={history}
            dataKey="humidity"
            unit="%"
            color="#3986c9"
            threshold={HUM_THRESHOLD}
          />
        </div>

        <section className="card events-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">EVENT LOG</p>
              <h2>Recent anomaly events</h2>
            </div>
            <span className="event-count">{anomalies.length} events</span>
          </div>

          {anomalies.length === 0 ? (
            <div className="empty-state">
              <span className="empty-check">✓</span>
              <strong>No anomalies recorded</strong>
              <span>All readings in the returned history are within configured thresholds.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Temperature</th>
                    <th>Humidity</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((reading) => (
                    <tr key={`${reading.deviceId}-${reading.timestamp}`}>
                      <td>{formatDateTime(Number(reading.timestamp))}</td>
                      <td>{Number(reading.temperature).toFixed(1)} °C</td>
                      <td>{Number(reading.humidity).toFixed(1)} %</td>
                      <td>
                        <span className="anomaly-tag">
                          {REASONS[reading.reason] || reading.reason || "Unknown"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>Data pipeline: ESP8266 → AWS IoT Core → DynamoDB → Lambda → API Gateway</span>
          <span>Auto-refresh: 10 seconds</span>
        </footer>
      </div>
    </main>
  );
}

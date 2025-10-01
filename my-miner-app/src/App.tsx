import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

interface StatsPoint {
  time: string;
  hashrate: number;
  temp: number;
}

const App: React.FC = () => {
  const [wallet, setWallet] = useState("nqtsq5g59fu9g23fkdgfmxpsatwekq6wv6wmn66g20srq2dk");
  const [worker, setWorker] = useState("4070");
  const [status, setStatus] = useState("stopped");
  const [history, setHistory] = useState<StatsPoint[]>([]);

  const startMiner = async () => {
    try {
      const res = await window.electron.invoke("start-miner", wallet, worker);
      setStatus(res);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  const stopMiner = async () => {
    try {
      const res = await window.electron.invoke("stop-miner");
      setStatus(res);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch("http://127.0.0.1:4067/summary");
      const data = await res.json();

      if (data?.gpus?.[0]) {
        const point: StatsPoint = {
          time: new Date().toLocaleTimeString(),
          hashrate: data.gpus[0].hashrate / 1e6, // H/s -> MH/s
          temp: data.gpus[0].temperature
        };
        setHistory((prev) => [...prev.slice(-20), point]);
      }
    } catch (err) {
      // Якщо майнер ще не стартував, нічого страшного
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>LOL Miner Nexa Dashboard</h1>
      <div style={{ margin: "10px 0" }}>
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Wallet"
          style={{ marginRight: 10 }}
        />
        <input
          value={worker}
          onChange={(e) => setWorker(e.target.value)}
          placeholder="Worker"
          style={{ marginRight: 10 }}
        />
        <button onClick={startMiner} style={{ marginRight: 5 }}>Start Miner</button>
        <button onClick={stopMiner}>Stop Miner</button>
        <p>Status: {status}</p>
      </div>

      {history.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis yAxisId="left" label={{ value: "MH/s", angle: -90, position: "insideLeft" }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: "°C", angle: -90, position: "insideRight" }} />
            <Tooltip />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="hashrate" stroke="#4ade80" name="Hashrate (MH/s)" />
            <Line yAxisId="right" type="monotone" dataKey="temp" stroke="#f87171" name="Temp (°C)" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default App;

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
import { minerApiClient, minerWsClient, MinerUser } from "./services/minerApi";

interface StatsPoint {
  time: string;
  hashrate: number;
  temp: number;
  tokensEarned?: number;
}

const App: React.FC = () => {
  const [wallet, setWallet] = useState("nexa:nqtsq5g59fu9g23fkdgfmxpsatwekq6wv6wmn66g20srq2dk");
  const [worker, setWorker] = useState("4070");
  const [status, setStatus] = useState("stopped");
  const [history, setHistory] = useState<StatsPoint[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<MinerUser | null>(null);
  const [miningSessionId, setMiningSessionId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [miningStartTime, setMiningStartTime] = useState<number | null>(null);

  const addLog = (message: string) => {
    setLog(prev => [...prev.slice(-100), `${new Date().toLocaleTimeString()} - ${message}`]);
  };

  const checkBackendConnection = async () => {
    try {
      // Try Electron IPC first (more reliable)
      if (window.electron) {
        const result = await window.electron.invoke("test-backend");
        return result.success && result.data?.status === 'OK';
      }
      
      // Fallback to direct fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('http://localhost:3001/health', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        return data.status === 'OK';
      }
      return false;
    } catch (error) {
      console.error('Backend connection check failed:', error);
      return false;
    }
  };

  const authenticateUser = async () => {
    try {
      // First check if backend is running
      const backendConnected = await checkBackendConnection();
      if (!backendConnected) {
        addLog("❌ Backend server not running!");
        addLog("💡 Please start backend: cd backend && npm run dev");
        return false;
      }

      if (!currentUser) {
        addLog("Authenticating user...");
        const authResponse = await minerApiClient.authenticate(wallet);
        setCurrentUser(authResponse.user);
        
        // Get balance
        const balanceResponse = await minerApiClient.getWalletBalance(authResponse.user.id);
        const userBalance = parseFloat(balanceResponse.virtualBalance);
        setBalance(userBalance);
        
        addLog(`Authenticated as ${authResponse.user.username}`);
        addLog(`Current balance: ${userBalance.toFixed(2)} BMT`);
        return true;
      }
      return true;
    } catch (error) {
      addLog(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(error);
      return false;
    }
  };

  const startMiner = async () => {
    try {
      addLog("Starting miner...");
      
      // First authenticate
      const authSuccess = await authenticateUser();
      if (!authSuccess || !currentUser) {
        addLog("Cannot start mining without authentication");
        return;
      }

      // Start the actual miner process
      addLog("Starting mining process...");
      const res = await window.electron.invoke("start-miner", wallet, worker);
      setStatus("running");
      
      // Start mining session in backend
      addLog("Creating mining session...");
      const sessionResponse = await minerApiClient.startMiningSession(
        currentUser.id,
        'NEXA',
        'medium',
        `GPU: ${worker}`
      );
      
      setMiningSessionId(sessionResponse.sessionId);
      setMiningStartTime(Date.now());
      addLog("Miner started successfully!");
      addLog(`Session ID: ${sessionResponse.sessionId}`);
    } catch (err) {
      console.error(err);
      setStatus("error");
      addLog("Error starting miner");
    }
  };

  const stopMiner = async () => {
    try {
      const res = await window.electron.invoke("stop-miner");
      setStatus("stopped");
      
      // Stop mining session in backend
      if (miningSessionId && currentUser) {
        await minerApiClient.stopMiningSession(miningSessionId);
        
        // Refresh balance
        const balanceResponse = await minerApiClient.getWalletBalance(currentUser.id);
        const newBalance = parseFloat(balanceResponse.virtualBalance);
        setBalance(newBalance);
        
        addLog(`Final balance: ${newBalance.toFixed(2)} BMT`);
        setMiningSessionId(null);
        setMiningStartTime(null);
      }
      
      addLog("Miner stopped");
    } catch (err) {
      console.error(err);
      setStatus("error");
      addLog("Error stopping miner");
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch("http://127.0.0.1:4067/summary");
      const data = await res.json();

      if (data?.gpus?.[0]) {
        const hashrate = data.gpus[0].hashrate / 1e6; // H/s -> MH/s
        const temp = data.gpus[0].temperature;
        
        const point: StatsPoint = {
          time: new Date().toLocaleTimeString(),
          hashrate,
          temp
        };
        
        setHistory(prev => [...prev.slice(-20), point]);
        addLog(`Miner: ${hashrate.toFixed(2)} MH/s, Temp: ${temp}°C`);
        
        // Update mining session with current stats
        if (miningSessionId && currentUser && miningStartTime) {
          try {
            const duration = Math.floor((Date.now() - miningStartTime) / 1000);
            await minerApiClient.updateMiningSession(miningSessionId, hashrate * 1e6, duration);
            
            // Send real-time stats via WebSocket
            minerWsClient.sendMiningStats({
              userId: currentUser.id,
              sessionId: miningSessionId,
              hashRate: hashrate * 1e6,
              temperature: temp,
              power: 0 // Could be extracted from miner API if available
            });
          } catch (error) {
            console.error('Failed to update mining session:', error);
            // Don't log this error as it would spam the logs
          }
        }
      }
    } catch {
      // Only log waiting message occasionally to avoid spam
      if (Math.random() < 0.1) { // 10% chance to log
        addLog("Waiting for miner stats...");
      }
    }
  };

  const fetchPoolStats = async () => {
    try {
      const res = await fetch(`https://api.2miners.com/v2/nexa/miner/${wallet}`);
      const data = await res.json();

      if (data?.stats) {
        addLog(`Pool Stats - Hashrate: ${(data.stats.hashrate / 1e6).toFixed(2)} MH/s, Paid: ${(data.paid / 1e6).toFixed(6)} NEXA`);
      }
    } catch {
      addLog("Error fetching pool stats");
    }
  };

  const updateBackendStatus = async () => {
    const connected = await checkBackendConnection();
    const statusElement = document.getElementById('backend-status');
    if (statusElement) {
      statusElement.textContent = connected ? 'Connected' : 'Disconnected';
      statusElement.style.color = connected ? '#4ade80' : '#f87171';
    }
  };

  useEffect(() => {
    // Check backend status immediately and then every 10 seconds
    updateBackendStatus();
    const backendCheckInterval = setInterval(updateBackendStatus, 10000);
    
    // Connect to WebSocket when we have a user
    if (currentUser) {
      minerWsClient.connect();
    }
    
    const minerInterval = setInterval(fetchStats, 5000);
    const poolInterval = setInterval(fetchPoolStats, 15000);
    
    return () => {
      clearInterval(backendCheckInterval);
      clearInterval(minerInterval);
      clearInterval(poolInterval);
      if (currentUser) {
        minerWsClient.disconnect();
      }
    };
  }, [wallet, miningSessionId, currentUser]);

  return (
    <div style={{ padding: 20 }}>
      <h1>LOL Miner Nexa Dashboard</h1>

      <div style={{ margin: "10px 0" }}>
        <input
          value={wallet}
          onChange={e => setWallet(e.target.value)}
          placeholder="Wallet"
          style={{ marginRight: 10 }}
        />
        <input
          value={worker}
          onChange={e => setWorker(e.target.value)}
          placeholder="Worker"
          style={{ marginRight: 10 }}
        />
        <button onClick={startMiner} style={{ marginRight: 5 }}>Start Miner</button>
        <button onClick={stopMiner} style={{ marginRight: 10 }}>Stop Miner</button>
        <button 
          onClick={authenticateUser} 
          style={{ 
            background: currentUser ? '#4ade80' : '#f59e0b', 
            color: 'black',
            marginRight: 5 
          }}
        >
          {currentUser ? 'Authenticated' : 'Authenticate'}
        </button>
        <p>Status: {status}</p>
        
        {/* Backend Connection Status */}
        <div style={{
          background: '#1a1a1a',
          padding: '10px',
          borderRadius: '4px',
          margin: '10px 0',
          fontSize: '0.9rem'
        }}>
          <p><strong>Backend Status:</strong> 
            <span id="backend-status"> Checking...</span>
          </p>
          <p><strong>Tip:</strong> Make sure backend is running: <code>cd backend && npm run dev</code></p>
        </div>
        
        {/* User Info and Balance */}
        {currentUser && (
          <div style={{ 
            background: '#2a2a2a', 
            padding: '15px', 
            borderRadius: '8px', 
            margin: '10px 0' 
          }}>
            <h3>Miner Profile</h3>
            <p><strong>User:</strong> {currentUser.username}</p>
            <p><strong>Wallet:</strong> {currentUser.walletAddress.slice(0, 16)}...</p>
            <p><strong>BMT Balance:</strong> {balance.toFixed(6)} BMT</p>
            <p><strong>Total Mined:</strong> {parseFloat(currentUser.totalMined.toString()).toFixed(6)} NEXA</p>
            {miningSessionId && (
              <p><strong>Session ID:</strong> {miningSessionId}</p>
            )}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis
              yAxisId="left"
              label={{ value: "MH/s", angle: -90, position: "insideLeft" }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              label={{ value: "°C", angle: -90, position: "insideRight" }}
            />
            <Tooltip />
            <Legend />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="hashrate"
              stroke="#4ade80"
              name="Hashrate (MH/s)"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="temp"
              stroke="#f87171"
              name="Temp (°C)"
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Withdrawal Section */}
      {currentUser && balance >= 100 && (
        <div style={{ 
          background: '#1a3a1a', 
          padding: '15px', 
          borderRadius: '8px', 
          margin: '10px 0' 
        }}>
          <h3>Withdraw BMT Tokens</h3>
          <p>Minimum withdrawal: 100 BMT</p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              placeholder="Amount (BMT)"
              style={{ padding: '5px' }}
              min="100"
              max={balance}
            />
            <input
              type="text"
              placeholder="Solana wallet address"
              style={{ padding: '5px', width: '300px' }}
            />
            <button 
              style={{ 
                background: '#4ade80', 
                color: 'black', 
                padding: '5px 15px',
                border: 'none',
                borderRadius: '4px'
              }}
              onClick={() => {
                addLog("Withdrawal feature will be implemented in production");
                addLog("For now, tokens are safely stored in your virtual wallet");
              }}
            >
              Withdraw
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 20,
          height: 200,
          overflowY: "auto",
          backgroundColor: "#111",
          color: "#0f0",
          padding: 10,
          fontFamily: "monospace"
        }}
      >
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
};

export default App;

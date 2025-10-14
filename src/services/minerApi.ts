// API configuration for the miner app
const API_BASE_URL = 'http://localhost:3001/api';

// API client class for miner
class MinerApiClient {
  private baseURL: string;
  private token: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.token = localStorage.getItem('miner_auth_token');
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Auth methods
  async authenticate(walletAddress: string, username?: string) {
    const data = await this.request('/users/auth', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, username }),
    });

    this.token = data.token;
    localStorage.setItem('miner_auth_token', data.token);
    return data;
  }

  // Mining methods
  async startMiningSession(userId: string, algorithm: string, difficulty: string, gpuInfo?: string) {
    return this.request('/mining/start', {
      method: 'POST',
      body: JSON.stringify({ userId, algorithm, difficulty, gpuInfo }),
    });
  }

  async updateMiningSession(sessionId: string, hashRate: number, duration: number) {
    return this.request(`/mining/update/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ hashRate, duration }),
    });
  }

  async stopMiningSession(sessionId: string) {
    return this.request(`/mining/stop/${sessionId}`, {
      method: 'POST',
    });
  }

  async getMiningHistory(userId: string, page = 1, limit = 20) {
    return this.request(`/mining/history/${userId}?page=${page}&limit=${limit}`);
  }

  async getMiningLeaderboard() {
    return this.request('/mining/leaderboard');
  }

  // Wallet methods
  async getWalletBalance(userId: string) {
    return this.request(`/wallet/balance/${userId}`);
  }

  async requestWithdrawal(userId: string, amount: number, toAddress: string) {
    return this.request('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ userId, amount, toAddress }),
    });
  }
}

// WebSocket client for real-time mining stats
class MinerWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number = 5000;
  private messageHandlers: Map<string, (payload: any) => void> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('Miner WebSocket connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message.payload);
          }
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Miner WebSocket disconnected');
        setTimeout(() => this.connect(), this.reconnectInterval);
      };

      this.ws.onerror = (error) => {
        console.error('Miner WebSocket error:', error);
      };
    } catch (error) {
      console.error('Miner WebSocket connection error:', error);
    }
  }

  send(type: string, payload: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  sendMiningStats(stats: MiningStats) {
    this.send('mining_stats', stats);
  }

  on(messageType: string, handler: (payload: any) => void) {
    this.messageHandlers.set(messageType, handler);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Types
export interface MiningStats {
  userId: string;
  sessionId: string;
  hashRate: number;
  temperature: number;
  power: number;
}

export interface MinerUser {
  id: string;
  walletAddress: string;
  username: string;
  virtualBalance: number;
  totalMined: number;
}

// Create singleton instances
export const minerApiClient = new MinerApiClient(API_BASE_URL);
export const minerWsClient = new MinerWebSocketClient('ws://localhost:3001');
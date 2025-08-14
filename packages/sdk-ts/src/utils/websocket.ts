import { ConnectionState } from '../types';

export interface WebSocketManagerConfig {
  url: string;
  reconnectAttempts: number;
  reconnectDelay: number;
  heartbeatInterval: number;
  debug: boolean;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: WebSocketManagerConfig;
  private reconnectCount = 0;
  private isReconnecting = false;
  private heartbeatTimer: number | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  
  // 事件监听器
  private listeners: Record<string, Function[]> = {};

  constructor(config: WebSocketManagerConfig) {
    this.config = config;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.setConnectionState(ConnectionState.CONNECTING);
        
        // 创建WebSocket连接
        this.ws = new WebSocket(this.config.url);
        
        this.ws.onopen = () => {
          this.log('WebSocket connected');
          this.setConnectionState(ConnectionState.CONNECTED);
          this.reconnectCount = 0;
          this.isReconnecting = false;
          this.startHeartbeat();
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.ws.onclose = (event) => {
          this.log('WebSocket disconnected:', event.code, event.reason);
          this.setConnectionState(ConnectionState.DISCONNECTED);
          this.stopHeartbeat();
          this.handleDisconnection();
        };
        
        this.ws.onerror = (error) => {
          this.log('WebSocket error:', error);
          this.setConnectionState(ConnectionState.ERROR);
          this.emit('error', error);
          reject(error);
        };
        
        // 连接超时
        setTimeout(() => {
          if (this.connectionState === ConnectionState.CONNECTING) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  public disconnect(): void {
    this.isReconnecting = false;
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
    
    this.setConnectionState(ConnectionState.DISCONNECTED);
  }

  public send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(message);
      this.log('Sent:', message);
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED ||
           this.connectionState === ConnectionState.AUTHENTICATED;
  }

  // 事件监听器管理
  public on(event: string, listener: Function): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  public off(event: string, listener: Function): void {
    if (this.listeners[event]) {
      const index = this.listeners[event].indexOf(listener);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }

  public emit(event: string, data?: any): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      this.log('Received:', message);
      this.emit('message', message);
    } catch (error) {
      this.log('Failed to parse message:', data);
    }
  }

  private handleDisconnection(): void {
    if (!this.isReconnecting && this.reconnectCount < this.config.reconnectAttempts) {
      this.attemptReconnect();
    } else if (this.reconnectCount >= this.config.reconnectAttempts) {
      this.log('Max reconnect attempts reached');
      this.emit('reconnectFailed');
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) return;
    
    this.isReconnecting = true;
    this.reconnectCount++;
    this.setConnectionState(ConnectionState.RECONNECTING);
    
    this.log(`Attempting to reconnect (${this.reconnectCount}/${this.config.reconnectAttempts})`);
    
    // 等待重连延迟
    await new Promise(resolve => setTimeout(resolve, this.config.reconnectDelay));
    
    try {
      await this.connect();
      this.emit('reconnected');
    } catch (error) {
      this.log('Reconnection failed:', error);
      this.handleDisconnection();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({
          requestId: `ping_${Date.now()}`,
          type: 'ping',
          payload: { timestamp: Date.now() }
        });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionStateChanged', state);
    }
  }

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[WebSocketManager]', ...args);
    }
  }
}
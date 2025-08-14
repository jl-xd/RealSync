import {
  RealSyncConfig,
  CreateRoomParams,
  JoinRoomParams,
  Room,
  ConnectionState,
  EventListener,
  RealSyncError,
  StateChangeEvent,
  PlayerJoinedEvent,
  PlayerLeftEvent,
  RoomUpdatedEvent
} from './types';
import { WebSocketManager } from './utils/websocket';
import { RoomInstance } from './services/room';

/**
 * RealSync客户端
 * 主要的SDK入口类
 */
export class RealSyncClient {
  private config: RealSyncConfig;
  private ws: WebSocketManager;
  private isAuthenticated = false;
  private currentRoom: RoomInstance | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: number;
  }> = new Map();

  constructor(config: RealSyncConfig) {
    this.config = {
      serverUrl: 'wss://connect.realsync.io',
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      debug: false,
      ...config
    };

    this.ws = new WebSocketManager({
      url: this.config.serverUrl!,
      reconnectAttempts: this.config.reconnectAttempts!,
      reconnectDelay: this.config.reconnectDelay!,
      heartbeatInterval: this.config.heartbeatInterval!,
      debug: this.config.debug!
    });

    this.setupWebSocketHandlers();
  }

  /**
   * 连接到服务器并认证
   */
  public async connect(): Promise<void> {
    try {
      // 连接WebSocket
      await this.ws.connect();
      
      // 进行认证
      await this.authenticate();
      
    } catch (error) {
      throw new Error(`Failed to connect: ${error}`);
    }
  }

  /**
   * 断开连接
   */
  public disconnect(): void {
    this.isAuthenticated = false;
    this.currentRoom = null;
    this.ws.disconnect();
  }

  /**
   * 获取连接状态
   */
  public getConnectionState(): ConnectionState {
    return this.ws.getConnectionState();
  }

  /**
   * 检查是否已连接并认证
   */
  public isConnected(): boolean {
    return this.isAuthenticated && this.ws.isConnected();
  }

  /**
   * 创建房间
   */
  public async createRoom(params: CreateRoomParams): Promise<RoomInstance> {
    if (!this.isConnected()) {
      throw new Error('Not connected to server');
    }

    const response = await this.sendRequest('create_room', params);
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to create room');
    }

    // 创建房间实例
    this.currentRoom = new RoomInstance(
      response.room.roomId,
      response.room,
      response.player,
      [response.player], // 创建者是唯一的玩家
      {}, // 初始状态为空
      this.sendRequest.bind(this)
    );

    return this.currentRoom;
  }

  /**
   * 加入房间
   */
  public async joinRoom(params: JoinRoomParams): Promise<RoomInstance> {
    if (!this.isConnected()) {
      throw new Error('Not connected to server');
    }

    const response = await this.sendRequest('join_room', params);
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to join room');
    }

    // 创建房间实例
    this.currentRoom = new RoomInstance(
      response.room.roomId,
      response.room,
      response.player,
      response.allPlayers,
      response.currentState,
      this.sendRequest.bind(this)
    );

    return this.currentRoom;
  }

  /**
   * 离开当前房间
   */
  public async leaveRoom(): Promise<void> {
    if (!this.currentRoom) {
      throw new Error('Not in a room');
    }

    await this.sendRequest('leave_room', {});
    this.currentRoom = null;
  }

  /**
   * 获取当前房间
   */
  public getCurrentRoom(): RoomInstance | null {
    return this.currentRoom;
  }

  /**
   * 列出可用房间
   */
  public async listRooms(options: {
    gameMode?: string;
    visibility?: 'PRIVATE' | 'PUBLIC';
    limit?: number;
  } = {}): Promise<Room[]> {
    if (!this.isConnected()) {
      throw new Error('Not connected to server');
    }

    const response = await this.sendRequest('list_rooms', options);
    return response.rooms || [];
  }

  /**
   * 监听连接状态变化
   */
  public onConnectionStateChanged(listener: EventListener<ConnectionState>): () => void {
    this.ws.on('connectionStateChanged', listener);
    return () => this.ws.off('connectionStateChanged', listener);
  }

  /**
   * 监听错误事件
   */
  public onError(listener: EventListener<RealSyncError>): () => void {
    this.ws.on('error', listener);
    return () => this.ws.off('error', listener);
  }

  /**
   * 监听重连成功事件
   */
  public onReconnected(listener: EventListener<void>): () => void {
    const wrappedListener = async () => {
      try {
        // 重新认证
        await this.authenticate();
        listener();
      } catch (error) {
        console.error('Failed to re-authenticate after reconnection:', error);
      }
    };
    
    this.ws.on('reconnected', wrappedListener);
    return () => this.ws.off('reconnected', wrappedListener);
  }

  // 私有方法

  private setupWebSocketHandlers(): void {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('connectionStateChanged', (state: ConnectionState) => {
      if (state === ConnectionState.DISCONNECTED) {
        this.isAuthenticated = false;
      }
    });
  }

  private async authenticate(): Promise<void> {
    try {
      const userToken = await this.config.tokenProvider();
      
      const response = await this.sendRequest('auth', {
        apiKey: this.config.apiKey,
        userToken
      }, 10000); // 10秒认证超时

      if (!response.success) {
        throw new Error(response.error_message || 'Authentication failed');
      }

      this.isAuthenticated = true;
      
      if (this.config.debug) {
        console.log('Authentication successful');
      }
      
    } catch (error) {
      this.isAuthenticated = false;
      throw error;
    }
  }

  private async sendRequest(type: string, payload: any, timeout = 5000): Promise<any> {
    if (!this.ws.isConnected() && type !== 'auth') {
      throw new Error('WebSocket not connected');
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeout);

      // 保存请求
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId
      });

      // 发送请求
      try {
        this.ws.send({
          requestId,
          type,
          payload
        });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  private handleMessage(message: any): void {
    const { requestId, type, payload } = message;

    // 处理响应消息
    if (requestId && this.pendingRequests.has(requestId)) {
      const { resolve, timeout } = this.pendingRequests.get(requestId)!;
      this.pendingRequests.delete(requestId);
      clearTimeout(timeout);
      
      if (type === 'error') {
        const error = new Error(payload.message);
        (error as any).code = payload.code;
        resolve({ success: false, error });
      } else {
        resolve(payload);
      }
      return;
    }

    // 处理事件消息
    if (type === 'event' && this.currentRoom) {
      this.handleRoomEvent(message.event);
    }

    // 处理心跳响应
    if (type === 'pong') {
      // 心跳响应，不需要特殊处理
      return;
    }
  }

  private handleRoomEvent(event: any): void {
    if (!this.currentRoom) return;

    switch (event.type) {
      case 'state_change':
        this.currentRoom.handleStateChangeEvent(event as StateChangeEvent);
        break;
      
      case 'player_joined':
        this.currentRoom.handlePlayerJoinedEvent(event as PlayerJoinedEvent);
        break;
      
      case 'player_left':
        this.currentRoom.handlePlayerLeftEvent(event as PlayerLeftEvent);
        break;
      
      case 'room_updated':
        this.currentRoom.handleRoomUpdatedEvent(event as RoomUpdatedEvent);
        break;
      
      default:
        if (this.config.debug) {
          console.log('Unknown room event:', event.type);
        }
    }
  }
}
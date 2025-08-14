import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import { ClientSession, GatewayConfig } from '../types';
import { RedisService } from './redis.service';
import { RoomService } from './room.service';
import { GameSessionService, StatePatch } from './game-session.service';
import { generateSessionId } from '../utils/redis-keys';

export class GatewayService {
  private wss: WebSocketServer;
  private redis: RedisService;
  private roomService: RoomService;
  private gameService: GameSessionService;
  private config: GatewayConfig;
  private sessions: Map<string, ClientSession> = new Map();

  constructor(config: GatewayConfig) {
    this.config = config;
    this.redis = RedisService.getInstance(config.redisUrl);
    this.roomService = new RoomService(this.redis);
    this.gameService = new GameSessionService(this.redis);
    
    this.wss = new WebSocketServer({ port: config.port });
    this.setupWebSocketServer();
  }

  public async start(): Promise<void> {
    await this.redis.connect();
    console.log(`Gateway server started on port ${this.config.port}`);
    
    // 启动心跳检测
    this.startHeartbeatCheck();
  }

  public async stop(): Promise<void> {
    this.wss.close();
    await this.redis.disconnect();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleNewConnection(ws, request);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  private handleNewConnection(ws: WebSocket, request: IncomingMessage): void {
    const sessionId = generateSessionId();
    console.log(`New connection: ${sessionId}`);

    // 创建会话
    const session: ClientSession = {
      id: sessionId,
      ws,
      appId: '',
      openId: '',
      authenticated: false,
      lastHeartbeat: Date.now()
    };

    this.sessions.set(sessionId, session);

    // 设置WebSocket事件处理
    ws.on('message', async (data: Buffer) => {
      try {
        await this.handleMessage(session, data);
      } catch (error) {
        console.error(`Error handling message from ${sessionId}:`, error);
        this.sendError(session, 'INTERNAL_ERROR', 'Internal server error');
      }
    });

    ws.on('close', () => {
      this.handleDisconnection(session);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${sessionId}:`, error);
      this.handleDisconnection(session);
    });

    // 设置连接超时
    setTimeout(() => {
      if (!session.authenticated) {
        console.log(`Authentication timeout for ${sessionId}`);
        ws.close(1008, 'Authentication timeout');
      }
    }, 30000); // 30秒认证超时
  }

  private async handleMessage(session: ClientSession, data: Buffer): Promise<void> {
    let message: any;
    
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      this.sendError(session, 'INVALID_MESSAGE', 'Invalid JSON message');
      return;
    }

    const { requestId, type, payload } = message;

    if (!requestId || !type) {
      this.sendError(session, 'INVALID_MESSAGE', 'Missing requestId or type');
      return;
    }

    // 更新心跳
    session.lastHeartbeat = Date.now();

    try {
      switch (type) {
        case 'auth':
          await this.handleAuth(session, requestId, payload);
          break;
        
        case 'create_room':
          await this.handleCreateRoom(session, requestId, payload);
          break;
        
        case 'join_room':
          await this.handleJoinRoom(session, requestId, payload);
          break;
        
        case 'leave_room':
          await this.handleLeaveRoom(session, requestId, payload);
          break;
        
        case 'list_rooms':
          await this.handleListRooms(session, requestId, payload);
          break;
        
        case 'update_state':
          await this.handleUpdateState(session, requestId, payload);
          break;
        
        case 'get_state':
          await this.handleGetState(session, requestId, payload);
          break;
        
        case 'ping':
          await this.handlePing(session, requestId, payload);
          break;
        
        default:
          this.sendError(session, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${type}`, requestId);
      }
    } catch (error) {
      console.error(`Error handling ${type} message:`, error);
      this.sendError(session, 'INTERNAL_ERROR', 'Internal server error', requestId);
    }
  }

  private async handleAuth(session: ClientSession, requestId: string, payload: any): Promise<void> {
    const { apiKey, userToken } = payload;

    if (!apiKey || !userToken) {
      this.sendError(session, 'INVALID_AUTH', 'Missing apiKey or userToken', requestId);
      return;
    }

    try {
      // 验证JWT token
      const decoded = jwt.verify(userToken, this.config.jwtSecret) as any;
      const openId = decoded.openId || decoded.sub;

      if (!openId) {
        this.sendError(session, 'INVALID_TOKEN', 'Token missing openId', requestId);
        return;
      }

      // 提取appId（简化版本：从apiKey中提取）
      const appId = this.extractAppId(apiKey);
      if (!appId) {
        this.sendError(session, 'INVALID_API_KEY', 'Invalid API key', requestId);
        return;
      }

      // 更新会话
      session.appId = appId;
      session.openId = openId;
      session.authenticated = true;

      // 发送认证成功响应
      this.sendResponse(session, requestId, 'auth', {
        success: true,
        sessionId: session.id
      });

      console.log(`User authenticated: ${openId} for app: ${appId}`);
    } catch (error) {
      console.error('Auth error:', error);
      this.sendError(session, 'INVALID_TOKEN', 'Invalid or expired token', requestId);
    }
  }

  private async handleCreateRoom(session: ClientSession, requestId: string, payload: any): Promise<void> {
    if (!session.authenticated) {
      this.sendError(session, 'NOT_AUTHENTICATED', 'Authentication required', requestId);
      return;
    }

    const { name, gameMode, maxPlayers, visibility, customData } = payload;

    if (!name || !gameMode || !maxPlayers) {
      this.sendError(session, 'INVALID_PARAMS', 'Missing required parameters', requestId);
      return;
    }

    try {
      const room = await this.roomService.createRoom(session.appId, session.openId, {
        name,
        gameMode,
        maxPlayers,
        visibility: visibility || 'PUBLIC',
        customData
      });

      // 更新会话信息
      session.currentRoomId = room.roomId;
      session.playerId = 1; // 创建者总是1号玩家

      // 订阅房间状态变更
      await this.subscribeToRoomEvents(session, room.roomId);

      this.sendResponse(session, requestId, 'create_room', {
        success: true,
        room: this.serializeRoom(room),
        player: room.players[1]
      });

    } catch (error) {
      console.error('Create room error:', error);
      this.sendError(session, 'CREATE_ROOM_FAILED', 'Failed to create room', requestId);
    }
  }

  private async handleJoinRoom(session: ClientSession, requestId: string, payload: any): Promise<void> {
    if (!session.authenticated) {
      this.sendError(session, 'NOT_AUTHENTICATED', 'Authentication required', requestId);
      return;
    }

    const { roomId, displayName, playerMetadata } = payload;

    if (!roomId || !displayName) {
      this.sendError(session, 'INVALID_PARAMS', 'Missing roomId or displayName', requestId);
      return;
    }

    try {
      const result = await this.roomService.joinRoom(
        session.appId,
        roomId,
        session.openId,
        displayName,
        playerMetadata
      );

      if (!result.success) {
        this.sendError(session, 'JOIN_ROOM_FAILED', result.error!, requestId);
        return;
      }

      // 更新会话信息
      session.currentRoomId = roomId;
      session.playerId = result.playerId;

      // 订阅房间状态变更
      await this.subscribeToRoomEvents(session, roomId);

      // 获取当前游戏状态
      const gameState = await this.gameService.getGameState(session.appId, roomId);

      this.sendResponse(session, requestId, 'join_room', {
        success: true,
        room: this.serializeRoom(result.room!),
        player: result.room!.players[result.playerId!],
        allPlayers: Object.values(result.room!.players),
        currentState: gameState
      });

      // 通知房间内其他玩家
      await this.broadcastToRoom(session.appId, roomId, {
        type: 'player_joined',
        player: result.room!.players[result.playerId!],
        timestamp: Date.now()
      }, session.id);

    } catch (error) {
      console.error('Join room error:', error);
      this.sendError(session, 'JOIN_ROOM_FAILED', 'Failed to join room', requestId);
    }
  }

  private async handleLeaveRoom(session: ClientSession, requestId: string, payload: any): Promise<void> {
    if (!session.authenticated || !session.currentRoomId) {
      this.sendError(session, 'NOT_IN_ROOM', 'Not in a room', requestId);
      return;
    }

    try {
      const result = await this.roomService.leaveRoom(
        session.appId,
        session.currentRoomId,
        session.openId
      );

      if (result.success) {
        // 通知房间内其他玩家
        await this.broadcastToRoom(session.appId, session.currentRoomId, {
          type: 'player_left',
          playerId: session.playerId,
          timestamp: Date.now()
        }, session.id);

        // 取消订阅
        await this.unsubscribeFromRoomEvents(session, session.currentRoomId);

        // 清除会话信息
        session.currentRoomId = undefined;
        session.playerId = undefined;

        this.sendResponse(session, requestId, 'leave_room', {
          success: true
        });
      } else {
        this.sendError(session, 'LEAVE_ROOM_FAILED', result.error!, requestId);
      }
    } catch (error) {
      console.error('Leave room error:', error);
      this.sendError(session, 'LEAVE_ROOM_FAILED', 'Failed to leave room', requestId);
    }
  }

  private async handleListRooms(session: ClientSession, requestId: string, payload: any): Promise<void> {
    if (!session.authenticated) {
      this.sendError(session, 'NOT_AUTHENTICATED', 'Authentication required', requestId);
      return;
    }

    try {
      const { gameMode, visibility, limit } = payload || {};
      const rooms = await this.roomService.listRooms(session.appId, {
        gameMode,
        visibility,
        limit
      });

      this.sendResponse(session, requestId, 'list_rooms', {
        rooms: rooms.map(room => this.serializeRoom(room))
      });
    } catch (error) {
      console.error('List rooms error:', error);
      this.sendError(session, 'LIST_ROOMS_FAILED', 'Failed to list rooms', requestId);
    }
  }

  private async handleUpdateState(session: ClientSession, requestId: string, payload: any): Promise<void> {
    if (!session.authenticated || !session.currentRoomId || !session.playerId) {
      this.sendError(session, 'NOT_IN_ROOM', 'Not in a room', requestId);
      return;
    }

    const { patches } = payload;
    if (!patches || !Array.isArray(patches)) {
      this.sendError(session, 'INVALID_PARAMS', 'Missing or invalid patches', requestId);
      return;
    }

    try {
      const result = await this.gameService.updateGameState(
        session.appId,
        session.currentRoomId,
        patches,
        session.playerId
      );

      this.sendResponse(session, requestId, 'update_state', {
        success: result.success,
        appliedPatches: result.appliedPatches,
        error: result.error
      });
    } catch (error) {
      console.error('Update state error:', error);
      this.sendError(session, 'UPDATE_STATE_FAILED', 'Failed to update state', requestId);
    }
  }

  private async handleGetState(session: ClientSession, requestId: string, payload: any): Promise<void> {
    if (!session.authenticated || !session.currentRoomId) {
      this.sendError(session, 'NOT_IN_ROOM', 'Not in a room', requestId);
      return;
    }

    try {
      const { keys } = payload || {};
      const state = await this.gameService.getGameState(
        session.appId,
        session.currentRoomId,
        keys
      );

      this.sendResponse(session, requestId, 'get_state', {
        state
      });
    } catch (error) {
      console.error('Get state error:', error);
      this.sendError(session, 'GET_STATE_FAILED', 'Failed to get state', requestId);
    }
  }

  private async handlePing(session: ClientSession, requestId: string, payload: any): Promise<void> {
    const { timestamp } = payload || {};
    this.sendResponse(session, requestId, 'pong', {
      timestamp,
      serverTime: Date.now()
    });
  }

  private handleDisconnection(session: ClientSession): void {
    console.log(`Connection closed: ${session.id}`);
    
    // 如果玩家在房间中，自动离开
    if (session.currentRoomId && session.authenticated) {
      this.roomService.leaveRoom(session.appId, session.currentRoomId, session.openId)
        .then(() => {
          if (session.currentRoomId) {
            this.broadcastToRoom(session.appId, session.currentRoomId, {
              type: 'player_left',
              playerId: session.playerId,
              timestamp: Date.now()
            }, session.id);
          }
        })
        .catch(error => {
          console.error('Error during auto-leave:', error);
        });
    }

    this.sessions.delete(session.id);
  }

  private async subscribeToRoomEvents(session: ClientSession, roomId: string): Promise<void> {
    await this.gameService.subscribeToRoom(session.appId, roomId, (event) => {
      if (session.ws.readyState === WebSocket.OPEN) {
        this.sendEvent(session, 'state_change', event);
      }
    });
  }

  private async unsubscribeFromRoomEvents(session: ClientSession, roomId: string): Promise<void> {
    await this.gameService.unsubscribeFromRoom(session.appId, roomId);
  }

  private async broadcastToRoom(
    appId: string,
    roomId: string,
    event: any,
    excludeSessionId?: string
  ): Promise<void> {
    const message = {
      type: 'event',
      event
    };

    for (const session of this.sessions.values()) {
      if (
        session.authenticated &&
        session.appId === appId &&
        session.currentRoomId === roomId &&
        session.id !== excludeSessionId &&
        session.ws.readyState === WebSocket.OPEN
      ) {
        session.ws.send(JSON.stringify(message));
      }
    }
  }

  private sendResponse(session: ClientSession, requestId: string, type: string, payload: any): void {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        requestId,
        type,
        payload
      }));
    }
  }

  private sendEvent(session: ClientSession, type: string, payload: any): void {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'event',
        event: {
          type,
          ...payload
        }
      }));
    }
  }

  private sendError(session: ClientSession, code: string, message: string, requestId?: string): void {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        requestId,
        type: 'error',
        payload: {
          code,
          message
        }
      }));
    }
  }

  private extractAppId(apiKey: string): string | null {
    // 简化的API密钥验证
    // 实际项目中应该查询数据库验证
    if (apiKey.startsWith('ak_') && apiKey.length === 26) {
      return apiKey.substring(3, 13); // 提取app ID部分
    }
    return null;
  }

  private serializeRoom(room: any): any {
    return {
      roomId: room.roomId,
      name: room.metadata.name,
      gameMode: room.metadata.gameMode,
      maxPlayers: room.metadata.maxPlayers,
      currentPlayers: room.metadata.currentPlayers,
      visibility: room.metadata.visibility,
      status: room.metadata.status,
      createdAt: room.metadata.createdAt,
      customData: room.metadata.customData
    };
  }

  private startHeartbeatCheck(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 2;

      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastHeartbeat > timeout) {
          console.log(`Heartbeat timeout for session: ${sessionId}`);
          session.ws.close(1000, 'Heartbeat timeout');
        }
      }
    }, this.config.heartbeatInterval);
  }

  public getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    activeRooms: number;
  } {
    let authenticatedCount = 0;
    const roomIds = new Set<string>();

    for (const session of this.sessions.values()) {
      if (session.authenticated) {
        authenticatedCount++;
        if (session.currentRoomId) {
          roomIds.add(`${session.appId}:${session.currentRoomId}`);
        }
      }
    }

    return {
      totalConnections: this.sessions.size,
      authenticatedConnections: authenticatedCount,
      activeRooms: roomIds.size
    };
  }
}
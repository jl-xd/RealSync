import { WebSocket } from 'ws';

export interface ClientSession {
  id: string;
  ws: WebSocket;
  appId: string;
  openId: string;
  currentRoomId?: string;
  playerId?: number;
  authenticated: boolean;
  lastHeartbeat: number;
}

export interface GatewayConfig {
  port: number;
  redisUrl: string;
  jwtSecret: string;
  heartbeatInterval: number;
  maxConnections: number;
}

export interface RoomState {
  roomId: string;
  appId: string;
  metadata: {
    name: string;
    gameMode: string;
    maxPlayers: number;
    currentPlayers: number;
    visibility: 'PRIVATE' | 'PUBLIC';
    status: 'WAITING' | 'PLAYING' | 'ENDED';
    createdAt: number;
    updatedAt: number;
    customData: Record<string, any>;
  };
  players: Record<number, {
    playerId: number;
    openId: string;
    displayName: string;
    isHost: boolean;
    joinedAt: number;
    metadata: Record<string, any>;
  }>;
  gameState: Record<string, any>;
}

export interface RedisKeys {
  // Room Service Keys
  roomMetadata: (appId: string, roomId: string) => string;
  roomPlayers: (appId: string, roomId: string) => string;
  roomIndex: (appId: string) => string;
  playerRoomMapping: (appId: string, openId: string) => string;
  
  // Game Session Keys
  gameState: (appId: string, roomId: string) => string;
  stateChannel: (appId: string, roomId: string) => string;
  playerIdMapping: (appId: string, roomId: string) => string;
}
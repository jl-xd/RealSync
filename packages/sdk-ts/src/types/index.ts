// SDK配置接口
export interface RealSyncConfig {
  apiKey: string;
  serverUrl?: string;
  tokenProvider: () => Promise<string>;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
  debug?: boolean;
}

// 房间可见性
export enum RoomVisibility {
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC'
}

// 房间状态
export enum RoomStatus {
  WAITING = 'WAITING',
  PLAYING = 'PLAYING',
  ENDED = 'ENDED'
}

// 玩家信息
export interface Player {
  playerId: number;
  displayName: string;
  isHost: boolean;
  joinedAt: number;
  metadata: Record<string, any>;
}

// 房间信息
export interface Room {
  roomId: string;
  name: string;
  gameMode: string;
  maxPlayers: number;
  currentPlayers: number;
  visibility: RoomVisibility;
  status: RoomStatus;
  createdAt: number;
  customData: Record<string, any>;
}

// 创建房间参数
export interface CreateRoomParams {
  name: string;
  gameMode: string;
  maxPlayers: number;
  visibility?: RoomVisibility;
  customData?: Record<string, any>;
}

// 加入房间参数
export interface JoinRoomParams {
  roomId: string;
  displayName: string;
  playerMetadata?: Record<string, any>;
}

// 状态补丁
export interface StatePatch {
  path: string;
  value: any;
  op: 'SET' | 'DELETE' | 'INCREMENT' | 'APPEND';
}

// 事件类型
export interface StateChangeEvent {
  roomId: string;
  fromPlayerId: number;
  patches: StatePatch[];
  timestamp: number;
}

export interface PlayerJoinedEvent {
  player: Player;
  timestamp: number;
}

export interface PlayerLeftEvent {
  playerId: number;
  timestamp: number;
}

export interface RoomUpdatedEvent {
  room: Room;
  timestamp: number;
}

// 错误类型
export interface RealSyncError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

// 连接状态
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  AUTHENTICATED = 'AUTHENTICATED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

// 事件监听器类型
export type EventListener<T = any> = (data: T) => void;

// 状态更新选项
export interface StateUpdateOptions {
  skipOptimisticUpdate?: boolean;
  timeout?: number;
}
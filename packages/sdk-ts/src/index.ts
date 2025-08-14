// 主客户端类
export { RealSyncClient } from './client';

// 服务类
export { RoomInstance } from './services/room';
export { RoomState } from './services/room-state';

// 类型定义
export type {
  RealSyncConfig,
  CreateRoomParams,
  JoinRoomParams,
  Room,
  Player,
  StatePatch,
  StateChangeEvent,
  PlayerJoinedEvent,
  PlayerLeftEvent,
  RoomUpdatedEvent,
  RealSyncError,
  EventListener,
  StateUpdateOptions
} from './types';

export {
  RoomVisibility,
  RoomStatus,
  ConnectionState
} from './types';

// 版本信息
export const VERSION = '1.0.0';
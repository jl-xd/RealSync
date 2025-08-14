import { RedisKeys } from '../types';

/**
 * Redis键名生成器
 * 基于文档中的设计原则：
 * - 使用哈希标签 {appId:roomId} 确保数据局部性
 * - app:{appId}: 前缀实现多租户隔离
 */
export const redisKeys: RedisKeys = {
  // === 房间服务键 ===
  roomMetadata: (appId: string, roomId: string) => 
    `app:${appId}:room:metadata:{${appId}:${roomId}}`,
  
  roomPlayers: (appId: string, roomId: string) => 
    `app:${appId}:room:members:{${appId}:${roomId}}`,
  
  roomIndex: (appId: string) => 
    `app:${appId}:rooms:index`,
  
  playerRoomMapping: (appId: string, openId: string) => 
    `app:${appId}:player:${openId}:room`,
  
  // === 游戏会话键 ===
  gameState: (appId: string, roomId: string) => 
    `app:${appId}:game:state:{${appId}:${roomId}}`,
  
  stateChannel: (appId: string, roomId: string) => 
    `app:${appId}:game:events:{${appId}:${roomId}}`,
  
  playerIdMapping: (appId: string, roomId: string) => 
    `app:${appId}:game:player_ids:{${appId}:${roomId}}`
};

/**
 * 从键名中提取应用ID和房间ID
 */
export function extractIdsFromKey(key: string): { appId?: string; roomId?: string } {
  const appMatch = key.match(/app:([^:]+):/);
  const roomMatch = key.match(/\{[^:]+:([^}]+)\}/);
  
  return {
    appId: appMatch ? appMatch[1] : undefined,
    roomId: roomMatch ? roomMatch[1] : undefined
  };
}

/**
 * 生成房间ID
 */
export function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * 生成会话ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
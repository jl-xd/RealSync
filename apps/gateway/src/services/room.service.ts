import { RedisService } from './redis.service';
import { redisKeys, generateRoomId } from '../utils/redis-keys';
import { RoomState } from '../types';

export class RoomService {
  private redis: RedisService;

  constructor(redis: RedisService) {
    this.redis = redis;
  }

  /**
   * 创建新房间
   */
  public async createRoom(
    appId: string,
    hostOpenId: string,
    roomData: {
      name: string;
      gameMode: string;
      maxPlayers: number;
      visibility: 'PRIVATE' | 'PUBLIC';
      customData?: Record<string, any>;
    }
  ): Promise<RoomState> {
    const roomId = generateRoomId();
    const now = Date.now();

    const roomState: RoomState = {
      roomId,
      appId,
      metadata: {
        name: roomData.name,
        gameMode: roomData.gameMode,
        maxPlayers: roomData.maxPlayers,
        currentPlayers: 1,
        visibility: roomData.visibility,
        status: 'WAITING',
        createdAt: now,
        updatedAt: now,
        customData: roomData.customData || {}
      },
      players: {
        1: {
          playerId: 1,
          openId: hostOpenId,
          displayName: 'Host', // 将在加入时设置真实名称
          isHost: true,
          joinedAt: now,
          metadata: {}
        }
      },
      gameState: {}
    };

    // 使用事务确保原子性
    await this.redis.multi([
      // 保存房间元数据
      () => this.redis.hmset(
        redisKeys.roomMetadata(appId, roomId),
        this.serializeRoomMetadata(roomState.metadata)
      ),
      
      // 保存玩家信息
      () => this.redis.hmset(
        redisKeys.roomPlayers(appId, roomId),
        this.serializePlayers(roomState.players)
      ),
      
      // 添加到房间索引
      () => this.redis.zadd(
        redisKeys.roomIndex(appId),
        now,
        roomId
      ),
      
      // 设置玩家-房间映射
      () => this.redis.set(
        redisKeys.playerRoomMapping(appId, hostOpenId),
        roomId
      ),
      
      // 初始化游戏状态
      () => this.redis.hmset(
        redisKeys.gameState(appId, roomId),
        {}
      ),
      
      // 设置玩家ID映射
      () => this.redis.hset(
        redisKeys.playerIdMapping(appId, roomId),
        hostOpenId,
        '1'
      )
    ]);

    return roomState;
  }

  /**
   * 玩家加入房间
   */
  public async joinRoom(
    appId: string,
    roomId: string,
    openId: string,
    displayName: string,
    playerMetadata: Record<string, any> = {}
  ): Promise<{
    success: boolean;
    room?: RoomState;
    playerId?: number;
    error?: string;
  }> {
    // 检查房间是否存在
    const roomExists = await this.redis.exists(redisKeys.roomMetadata(appId, roomId));
    if (!roomExists) {
      return { success: false, error: 'Room not found' };
    }

    // 获取房间信息
    const room = await this.getRoomState(appId, roomId);
    if (!room) {
      return { success: false, error: 'Failed to load room' };
    }

    // 检查房间是否已满
    if (room.metadata.currentPlayers >= room.metadata.maxPlayers) {
      return { success: false, error: 'Room is full' };
    }

    // 检查玩家是否已在房间中
    const existingPlayerId = await this.redis.hget(
      redisKeys.playerIdMapping(appId, roomId),
      openId
    );
    if (existingPlayerId) {
      return { success: false, error: 'Player already in room' };
    }

    // 分配新的玩家ID
    const newPlayerId = room.metadata.currentPlayers + 1;
    const now = Date.now();

    const newPlayer = {
      playerId: newPlayerId,
      openId,
      displayName,
      isHost: false,
      joinedAt: now,
      metadata: playerMetadata
    };

    // 更新房间状态
    room.players[newPlayerId] = newPlayer;
    room.metadata.currentPlayers++;
    room.metadata.updatedAt = now;

    // 使用事务更新数据
    await this.redis.multi([
      // 更新房间元数据
      () => this.redis.hmset(
        redisKeys.roomMetadata(appId, roomId),
        this.serializeRoomMetadata(room.metadata)
      ),
      
      // 更新玩家信息
      () => this.redis.hmset(
        redisKeys.roomPlayers(appId, roomId),
        this.serializePlayers(room.players)
      ),
      
      // 设置玩家-房间映射
      () => this.redis.set(
        redisKeys.playerRoomMapping(appId, openId),
        roomId
      ),
      
      // 更新玩家ID映射
      () => this.redis.hset(
        redisKeys.playerIdMapping(appId, roomId),
        openId,
        newPlayerId.toString()
      )
    ]);

    return {
      success: true,
      room,
      playerId: newPlayerId
    };
  }

  /**
   * 玩家离开房间
   */
  public async leaveRoom(
    appId: string,
    roomId: string,
    openId: string
  ): Promise<{ success: boolean; error?: string }> {
    const room = await this.getRoomState(appId, roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // 找到玩家
    const playerId = await this.redis.hget(
      redisKeys.playerIdMapping(appId, roomId),
      openId
    );

    if (!playerId || !room.players[parseInt(playerId)]) {
      return { success: false, error: 'Player not in room' };
    }

    const player = room.players[parseInt(playerId)];
    const wasHost = player.isHost;

    // 移除玩家
    delete room.players[parseInt(playerId)];
    room.metadata.currentPlayers--;
    room.metadata.updatedAt = Date.now();

    // 如果房间空了，删除房间
    if (room.metadata.currentPlayers === 0) {
      await this.deleteRoom(appId, roomId);
      return { success: true };
    }

    // 如果房主离开，转让房主给下一个玩家
    if (wasHost) {
      const nextPlayer = Object.values(room.players)[0];
      if (nextPlayer) {
        nextPlayer.isHost = true;
      }
    }

    // 更新数据
    await this.redis.multi([
      // 更新房间元数据
      () => this.redis.hmset(
        redisKeys.roomMetadata(appId, roomId),
        this.serializeRoomMetadata(room.metadata)
      ),
      
      // 更新玩家信息
      () => this.redis.hmset(
        redisKeys.roomPlayers(appId, roomId),
        this.serializePlayers(room.players)
      ),
      
      // 删除玩家-房间映射
      () => this.redis.del(
        redisKeys.playerRoomMapping(appId, openId)
      ),
      
      // 删除玩家ID映射
      () => this.redis.hdel(
        redisKeys.playerIdMapping(appId, roomId),
        openId
      )
    ]);

    return { success: true };
  }

  /**
   * 获取房间状态
   */
  public async getRoomState(appId: string, roomId: string): Promise<RoomState | null> {
    const [metadata, players] = await Promise.all([
      this.redis.hgetall(redisKeys.roomMetadata(appId, roomId)),
      this.redis.hgetall(redisKeys.roomPlayers(appId, roomId))
    ]);

    if (Object.keys(metadata).length === 0) {
      return null;
    }

    return {
      roomId,
      appId,
      metadata: this.deserializeRoomMetadata(metadata),
      players: this.deserializePlayers(players),
      gameState: {} // 游戏状态由GameSessionService管理
    };
  }

  /**
   * 列出房间
   */
  public async listRooms(
    appId: string,
    options: {
      gameMode?: string;
      visibility?: 'PRIVATE' | 'PUBLIC';
      limit?: number;
    } = {}
  ): Promise<RoomState[]> {
    const { limit = 50 } = options;
    
    // 获取房间ID列表（按创建时间排序）
    const roomIds = await this.redis.zrange(
      redisKeys.roomIndex(appId),
      -limit,
      -1
    );

    if (roomIds.length === 0) {
      return [];
    }

    // 批量获取房间信息
    const rooms = await Promise.all(
      roomIds.map(roomId => this.getRoomState(appId, roomId))
    );

    // 过滤和筛选
    return rooms
      .filter((room): room is RoomState => room !== null)
      .filter(room => {
        if (options.gameMode && room.metadata.gameMode !== options.gameMode) {
          return false;
        }
        if (options.visibility && room.metadata.visibility !== options.visibility) {
          return false;
        }
        return true;
      })
      .reverse(); // 最新的在前面
  }

  /**
   * 删除房间
   */
  private async deleteRoom(appId: string, roomId: string): Promise<void> {
    await this.redis.multi([
      () => this.redis.del(redisKeys.roomMetadata(appId, roomId)),
      () => this.redis.del(redisKeys.roomPlayers(appId, roomId)),
      () => this.redis.del(redisKeys.gameState(appId, roomId)),
      () => this.redis.del(redisKeys.playerIdMapping(appId, roomId)),
      () => this.redis.zrem(redisKeys.roomIndex(appId), roomId)
    ]);
  }

  // === 序列化/反序列化辅助函数 ===

  private serializeRoomMetadata(metadata: RoomState['metadata']): Record<string, string> {
    return {
      name: metadata.name,
      gameMode: metadata.gameMode,
      maxPlayers: metadata.maxPlayers.toString(),
      currentPlayers: metadata.currentPlayers.toString(),
      visibility: metadata.visibility,
      status: metadata.status,
      createdAt: metadata.createdAt.toString(),
      updatedAt: metadata.updatedAt.toString(),
      customData: JSON.stringify(metadata.customData)
    };
  }

  private deserializeRoomMetadata(data: Record<string, string>): RoomState['metadata'] {
    return {
      name: data.name,
      gameMode: data.gameMode,
      maxPlayers: parseInt(data.maxPlayers),
      currentPlayers: parseInt(data.currentPlayers),
      visibility: data.visibility as 'PRIVATE' | 'PUBLIC',
      status: data.status as 'WAITING' | 'PLAYING' | 'ENDED',
      createdAt: parseInt(data.createdAt),
      updatedAt: parseInt(data.updatedAt),
      customData: JSON.parse(data.customData || '{}')
    };
  }

  private serializePlayers(players: RoomState['players']): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [playerId, player] of Object.entries(players)) {
      result[`player_${playerId}`] = JSON.stringify(player);
    }
    return result;
  }

  private deserializePlayers(data: Record<string, string>): RoomState['players'] {
    const result: RoomState['players'] = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('player_')) {
        const player = JSON.parse(value);
        result[player.playerId] = player;
      }
    }
    return result;
  }
}
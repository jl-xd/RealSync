import { RedisService } from './redis.service';
import { redisKeys } from '../utils/redis-keys';

export interface StatePatch {
  path: string;
  value: any;
  op: 'SET' | 'DELETE' | 'INCREMENT' | 'APPEND';
}

export class GameSessionService {
  private redis: RedisService;

  constructor(redis: RedisService) {
    this.redis = redis;
  }

  /**
   * 获取房间的游戏状态
   */
  public async getGameState(
    appId: string,
    roomId: string,
    keys?: string[]
  ): Promise<Record<string, any>> {
    const stateKey = redisKeys.gameState(appId, roomId);
    
    if (keys && keys.length > 0) {
      // 获取指定键的值
      const values = await Promise.all(
        keys.map(key => this.redis.hget(stateKey, key))
      );
      
      const result: Record<string, any> = {};
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== null) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        }
      });
      
      return result;
    } else {
      // 获取所有状态
      const rawState = await this.redis.hgetall(stateKey);
      const result: Record<string, any> = {};
      
      for (const [key, value] of Object.entries(rawState)) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
      
      return result;
    }
  }

  /**
   * 更新游戏状态
   */
  public async updateGameState(
    appId: string,
    roomId: string,
    patches: StatePatch[],
    fromPlayerId: number
  ): Promise<{ success: boolean; appliedPatches: StatePatch[]; error?: string }> {
    const stateKey = redisKeys.gameState(appId, roomId);
    const channelKey = redisKeys.stateChannel(appId, roomId);
    
    try {
      // 验证房间存在
      const roomExists = await this.redis.exists(redisKeys.roomMetadata(appId, roomId));
      if (!roomExists) {
        return { success: false, appliedPatches: [], error: 'Room not found' };
      }

      const appliedPatches: StatePatch[] = [];
      const updates: Record<string, string> = {};
      const deletions: string[] = [];

      // 处理每个补丁
      for (const patch of patches) {
        try {
          const processedPatch = await this.processPatch(stateKey, patch);
          if (processedPatch) {
            appliedPatches.push(processedPatch);
            
            if (processedPatch.op === 'DELETE') {
              deletions.push(processedPatch.path);
            } else {
              updates[processedPatch.path] = JSON.stringify(processedPatch.value);
            }
          }
        } catch (error) {
          console.error(`Failed to process patch ${patch.path}:`, error);
          // 继续处理其他补丁
        }
      }

      // 批量应用更新
      if (Object.keys(updates).length > 0 || deletions.length > 0) {
        const commands: Array<() => Promise<any>> = [];
        
        if (Object.keys(updates).length > 0) {
          commands.push(() => this.redis.hmset(stateKey, updates));
        }
        
        for (const key of deletions) {
          commands.push(() => this.redis.hdel(stateKey, key));
        }
        
        await this.redis.multi(commands);
      }

      // 发布状态变更事件
      if (appliedPatches.length > 0) {
        const event = {
          roomId,
          fromPlayerId,
          patches: appliedPatches,
          timestamp: Date.now()
        };
        
        await this.redis.publish(channelKey, JSON.stringify(event));
      }

      return { success: true, appliedPatches };
    } catch (error) {
      console.error('Failed to update game state:', error);
      return { 
        success: false, 
        appliedPatches: [], 
        error: 'Internal server error' 
      };
    }
  }

  /**
   * 订阅房间状态变更
   */
  public async subscribeToRoom(
    appId: string,
    roomId: string,
    callback: (event: {
      roomId: string;
      fromPlayerId: number;
      patches: StatePatch[];
      timestamp: number;
    }) => void
  ): Promise<void> {
    const channelKey = redisKeys.stateChannel(appId, roomId);
    
    await this.redis.subscribe(channelKey, (message) => {
      try {
        const event = JSON.parse(message);
        callback(event);
      } catch (error) {
        console.error('Failed to parse state change event:', error);
      }
    });
  }

  /**
   * 取消订阅房间状态变更
   */
  public async unsubscribeFromRoom(
    appId: string,
    roomId: string
  ): Promise<void> {
    const channelKey = redisKeys.stateChannel(appId, roomId);
    await this.redis.unsubscribe(channelKey);
  }

  /**
   * 清空房间游戏状态
   */
  public async clearGameState(appId: string, roomId: string): Promise<void> {
    const stateKey = redisKeys.gameState(appId, roomId);
    await this.redis.del(stateKey);
  }

  /**
   * 处理单个状态补丁
   */
  private async processPatch(
    stateKey: string,
    patch: StatePatch
  ): Promise<StatePatch | null> {
    const { path, value, op } = patch;
    
    switch (op) {
      case 'SET':
        return { path, value, op };
        
      case 'DELETE':
        return { path, value: null, op };
        
      case 'INCREMENT':
        if (typeof value !== 'number') {
          throw new Error('INCREMENT operation requires numeric value');
        }
        
        // 获取当前值
        const currentValue = await this.redis.hget(stateKey, path);
        let newValue = value;
        
        if (currentValue !== null) {
          try {
            const current = JSON.parse(currentValue);
            if (typeof current === 'number') {
              newValue = current + value;
            }
          } catch {
            // 如果解析失败，使用传入的值
          }
        }
        
        return { path, value: newValue, op: 'SET' };
        
      case 'APPEND':
        if (!Array.isArray(value)) {
          throw new Error('APPEND operation requires array value');
        }
        
        // 获取当前数组
        const currentArray = await this.redis.hget(stateKey, path);
        let newArray = [...value];
        
        if (currentArray !== null) {
          try {
            const current = JSON.parse(currentArray);
            if (Array.isArray(current)) {
              newArray = [...current, ...value];
            }
          } catch {
            // 如果解析失败，使用传入的值
          }
        }
        
        return { path, value: newArray, op: 'SET' };
        
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  }

  /**
   * 批量获取多个房间的状态（用于调试）
   */
  public async getRoomsState(
    appId: string,
    roomIds: string[]
  ): Promise<Record<string, Record<string, any>>> {
    const results = await Promise.all(
      roomIds.map(async (roomId) => {
        const state = await this.getGameState(appId, roomId);
        return { roomId, state };
      })
    );

    const stateMap: Record<string, Record<string, any>> = {};
    results.forEach(({ roomId, state }) => {
      stateMap[roomId] = state;
    });

    return stateMap;
  }

  /**
   * 获取房间状态统计信息
   */
  public async getStateStats(
    appId: string,
    roomId: string
  ): Promise<{
    totalKeys: number;
    totalSize: number; // 估计的数据大小（字节）
  }> {
    const stateKey = redisKeys.gameState(appId, roomId);
    const totalKeys = await this.redis.hlen(stateKey);
    
    // 估算数据大小（这是一个粗略的估计）
    const allData = await this.redis.hgetall(stateKey);
    const totalSize = Object.entries(allData)
      .reduce((size, [key, value]) => {
        return size + key.length + value.length;
      }, 0);

    return { totalKeys, totalSize };
  }
}
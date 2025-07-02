# Redis 数据结构设计

本文档是 RealSync Redis 数据结构设计的总览，包含共同的设计原则、架构基础，以及业务具体实现的导航。

为了便于理解和维护，具体的业务实现按照职责分为以下两个部分：

---

## 📑 业务实现文档

### 🎮 [游戏局 Redis 设计](./redis-game-session.md) 
**游戏内实时状态同步**

- 🎯 实时游戏状态存储
- 👥 玩家会话和ID映射
- 📡 实时消息通道 (Pub/Sub)
- ⚛️ 原子性操作和事务
- 🔄 冲突处理机制

### 🏛️ [房间服务 Redis 设计](./redis-room-service.md)
**游戏大厅和房间管理**

- 📋 房间列表索引
- 🔍 多维度查询和搜索
- 📊 房间状态管理
- 🎪 游戏大厅功能
- 📈 统计和分析

---

## 🎯 设计理念

### 业务分离的优势

**清晰的职责边界**: 游戏局专注于高频实时同步，房间服务专注于查询和管理

**独立的演进路径**: 未来可以灵活替换游戏局的存储方案（如自建状态同步服务），而不影响房间管理

**便于理解和维护**: 开发者可以根据需要专注于特定的业务领域

**性能优化针对性**: 不同业务场景可以采用不同的优化策略

### 技术架构统一

虽然业务分离，但技术架构保持统一：

- **🔥 联合哈希标签**: `{appId:roomId}` 确保数据局部性和多租户负载均衡
- **🔐 应用隔离**: `app:{appId}:` 前缀实现完全的多租户数据隔离
- **⚛️ 原子性操作**: Lua脚本和Redis事务保证数据一致性
- **📊 性能优化**: 批量操作、读写分离、缓存策略

---

## 架构概览

RealSync 使用 **Redis 集群** 作为核心数据存储和消息队列，支持高并发的实时状态同步和房间管理。

### 🔥 Redis 哈希标签机制

RealSync 大量使用 **Redis 哈希标签 (Hash Tags)** 来优化集群性能：

```redis
# ✅ 使用联合哈希标签 - 同一房间数据在同一节点，不同应用分散
app:game123:room:state:{game123:room456}      # 房间状态
app:game123:room:members:{game123:room456}    # 房间成员  
app:game123:room:metadata:{game123:room456}   # 房间元数据

# ❌ 不使用哈希标签 - 数据可能分散到不同节点
app:game123:room:state:room456        # 可能在节点A
app:game123:room:members:room456      # 可能在节点B
app:game123:room:metadata:room456     # 可能在节点C
```

**哈希标签的关键优势:**
- 🎯 **数据局部性**: 确保同一房间的所有相关数据存储在同一个Redis节点
- ⚡ **性能优化**: 避免跨节点查询，减少网络延迟
- 🔒 **原子性操作**: 支持MULTI/EXEC事务和Lua脚本的原子性
- 📊 **批量操作**: 可以在单个节点上执行复杂的批量操作

#### 哈希标签工作原理

```typescript
// Redis 计算哈希槽的逻辑
function getHashSlot(key: string): number {
  const hashtagMatch = key.match(/\{([^}]*)\}/);
  const effectiveKey = hashtagMatch ? hashtagMatch[1] : key;
  return crc16(effectiveKey) % 16384;
}

// 示例计算
getHashSlot('app:game123:room:state:{game123:room456}');     // 基于 'game123:room456' 计算
getHashSlot('app:game123:room:members:{game123:room456}');   // 基于 'game123:room456' 计算 (相同!)
getHashSlot('app:game123:room:state:room456');               // 基于整个key计算 (不同!)
```

#### 原子性操作示例

```redis
# ✅ 可以使用事务 - 所有key在同一节点（联合哈希标签）
MULTI
  HSET app:game123:room:state:{game123:room456} "player_count" "4"
  SADD app:game123:room:members:{game123:room456} "4" 
  HSET app:game123:room:metadata:{game123:room456} "status" "full"
EXEC

# ❌ 无法使用事务 - key可能在不同节点
MULTI
  HSET app:game123:room:state:room456 "player_count" "4"    # 节点A
  SADD app:game123:room:members:room789 "1"                 # 节点B
EXEC  # 会报错: CROSSSLOT Keys in request don't hash to the same slot
```

### 数据存储职责

```
┌─────────────────────────────────────────────────────────────┐
│                     Redis 集群架构                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  │
│  │   主节点 #1     │  │   主节点 #2     │  │  主节点 #N   │  │
│  │  (房间数据)     │  │  (用户数据)     │  │ (索引数据)   │  │
│  └─────────────────┘  └─────────────────┘  └──────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  │
│  │   从节点 #1     │  │   从节点 #2     │  │  从节点 #N   │  │
│  │  (读副本)       │  │  (读副本)       │  │ (读副本)     │  │
│  └─────────────────┘  └─────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 核心功能

- **房间状态存储**: 实时游戏状态的持久化
- **玩家会话管理**: 在线玩家和房间成员关系
- **房间列表索引**: 高效的房间查询和过滤
- **消息发布订阅**: 实时状态更新广播
- **缓存层**: 热点数据的快速访问

---

## 多租户设计

RealSync 支持多个游戏应用共享同一个Redis集群，通过 **应用维度隔离** 确保数据安全和管理便利。

### 🔐 设计原则

**完全隔离**: 不同应用的数据完全隔离，无法相互访问  
**命名空间**: 使用 `app:{appId}:` 作为统一的命名空间前缀  
**权限控制**: SDK层面强制应用只能访问自己的命名空间  
**运维友好**: 支持按应用维度进行监控、统计、清理

### 🏗️ 命名空间设计

#### 核心格式
```redis
# 原格式: room:state:{roomId}
# 新格式: app:{appId}:room:state:{roomId}

# 示例
app:game123:room:state:{game123:room456}           # 游戏123的房间456状态
app:game123:room:metadata:{game123:room456}        # 游戏123的房间456元数据
app:game123:rooms:status:waiting                   # 游戏123的等待中房间列表
app:game789:room:state:{game789:room101}           # 游戏789的房间101状态 (完全隔离)
```

#### 哈希标签策略：应用+房间联合哈希标签

RealSync 采用 **联合哈希标签策略**，确保同应用同房间数据的局部性，同时实现不同应用间的负载分散：

```redis
# ✅ 同应用同房间数据在同一节点，不同应用分散到不同节点
app:game123:room:state:{game123:room456}     # 哈希基于 "game123:room456" → 节点A
app:game123:room:members:{game123:room456}   # 哈希基于 "game123:room456" → 节点A (相同!)
app:game123:room:metadata:{game123:room456} # 哈希基于 "game123:room456" → 节点A (相同!)

# 不同应用的相同房间ID会分布到不同节点，避免热点集中
app:game123:room:state:{game123:room999}    # 哈希基于 "game123:room999" → 节点A  
app:game789:room:state:{game789:room999}    # 哈希基于 "game789:room999" → 节点B (不同!)
```

**策略优势:**
- **数据局部性**: 同房间所有数据在同一节点，支持原子事务
- **负载均衡**: 不同应用数据分散到不同节点，避免热点
- **应用隔离**: 天然的应用级数据分离
- **可扩展性**: 支持大规模多租户部署

#### 🔧 技术实现细节

**Redis哈希槽计算验证:**
```typescript
// 联合哈希标签 - 不同应用分散到不同节点
console.log(crc16('game123:room999') % 16384);  // 例如: 槽位 8234
console.log(crc16('game789:room999') % 16384);  // 例如: 槽位 12567 ✅不同节点

// 验证相同应用同房间在同一节点
console.log(crc16('game123:room456') % 16384);  // 例如: 槽位 3421
console.log(crc16('game123:room456') % 16384);  // 例如: 槽位 3421 ✅同一节点
```

**实现代码示例:**
```typescript
class RedisKeyManager {
  // 构建房间状态Key
  buildRoomStateKey(appId: string, roomId: string): string {
    return `app:${appId}:room:state:{${appId}:${roomId}}`;
  }
  
  // 批量操作时确保相关key使用相同联合哈希标签
  buildRoomKeys(appId: string, roomId: string) {
    const hashTag = `${appId}:${roomId}`;
    return {
      state: `app:${appId}:room:state:{${hashTag}}`,
      members: `app:${appId}:room:members:{${hashTag}}`,
      metadata: `app:${appId}:room:metadata:{${hashTag}}`,
      info: `app:${appId}:room:info:{${hashTag}}`,
      openidMapping: `app:${appId}:room:openid_mapping:{${hashTag}}`,
      playerMapping: `app:${appId}:room:player_mapping:{${hashTag}}`,
      joinTime: `app:${appId}:room:join_time:{${hashTag}}`,
      playerCounter: `app:${appId}:room:player_counter:{${hashTag}}`,
      channel: `app:${appId}:room:channel:{${hashTag}}`
    };
  }
  
  // 原子操作验证：确保所有相关key在同一节点
  validateSameSlot(appId: string, roomId: string): boolean {
    const keys = this.buildRoomKeys(appId, roomId);
    const slots = Object.values(keys).map(key => {
      const hashtagMatch = key.match(/\{([^}]*)\}/);
      const effectiveKey = hashtagMatch ? hashtagMatch[1] : key;
      return crc16(effectiveKey) % 16384;
    });
    
    return slots.every(slot => slot === slots[0]); // 所有key必须在同一槽位
  }
}
```

### 📊 应用管理

#### 应用注册与元数据
```redis
# 应用基本信息
# 数据结构: HASH
# Key: app:registry:{appId}
HSET app:registry:game123
  "name" "Epic Battle Arena"
  "owner" "company_xyz"
  "created_at" "1640995200"
  "status" "active"
  "api_key_hash" "sha256_hash_of_api_key"
  "quota_rooms" "1000"
  "quota_players" "10000"
  "region" "us-west"
  "version" "1.0"

# 应用列表索引
# 数据结构: SET
SADD apps:active "game123" "game456" "game789"
SADD apps:by_owner:company_xyz "game123" "game456"
SADD apps:by_region:us_west "game123" "game789"
```

#### 应用配额监控
```redis
# 应用资源使用统计
# 数据结构: HASH
# Key: app:stats:{appId}
HSET app:stats:game123
  "room_count" "145"
  "player_count" "678"
  "daily_requests" "45000"
  "peak_rooms" "200"
  "peak_players" "1200"
  "last_activity" "1640995800"

# 全局应用统计
# 数据结构: ZSET (按使用量排序)
ZADD apps:by_room_count 145 "game123"
ZADD apps:by_room_count 89 "game456"  
ZADD apps:by_player_count 678 "game123"
ZADD apps:by_player_count 234 "game456"
```

### 🔒 权限控制

#### API密钥管理
```redis
# API密钥到应用ID的映射
# 数据结构: HASH
# Key: auth:api_keys
HSET auth:api_keys
  "ak_1a2b3c4d5e6f7g8h9i0j" "game123"
  "ak_9z8y7x6w5v4u3t2s1r0q" "game456"

# 应用权限配置
# 数据结构: HASH  
# Key: app:permissions:{appId}
HSET app:permissions:game123
  "max_room_size" "8"
  "max_concurrent_rooms" "500"
  "regions_allowed" "us-west,us-east"
  "features_enabled" "voice_chat,screen_share"
  "rate_limit_rps" "1000"
```

#### SDK层权限验证
```typescript
class AppIsolationMiddleware {
  private async validateAppAccess(apiKey: string, requestedResource: string): Promise<string> {
    // 1. 验证API密钥
    const appId = await redis.hget('auth:api_keys', apiKey);
    if (!appId) throw new Error('Invalid API key');
    
    // 2. 验证应用状态
    const appStatus = await redis.hget(`app:registry:${appId}`, 'status');
    if (appStatus !== 'active') throw new Error('Application suspended');
    
    // 3. 验证资源访问权限
    const expectedPrefix = `app:${appId}:`;
    if (!requestedResource.startsWith(expectedPrefix)) {
      throw new Error('Access denied: Resource not owned by application');
    }
    
    return appId;
  }
  
  async createRoom(apiKey: string, roomId: string, roomData: any) {
    const appId = await this.validateAppAccess(apiKey, `app:${appId}:room:state:${roomId}`);
    
    // 执行房间创建操作，使用联合哈希标签确保数据局部性和应用隔离
    const namespacedRoomId = `app:${appId}:room:state:{${appId}:${roomId}}`;
    await redis.hset(namespacedRoomId, roomData);
  }
}
```

---

## 设计原则

### 1. **数据局部性原则**
- 相关数据尽量存储在相同的Redis节点
- 减少跨节点查询的网络开销
- 使用一致性哈希保证数据分布均匀

### 2. **读写分离原则**  
- 高频读操作使用专门的索引结构
- 写操作同时更新主数据和索引
- 利用Redis从节点分担读压力

### 3. **过期清理原则**
- 为临时数据设置合理的TTL
- 实现自动过期清理机制
- 避免内存无限增长

### 4. **原子性保证原则**
- 使用Redis事务或Lua脚本保证操作原子性
- 避免数据不一致状态
- 设计幂等操作处理重试场景

---

## 性能优化

### 1. 内存使用优化

#### 数据压缩策略
```redis
# 使用Redis的内置压缩
CONFIG SET hash-max-ziplist-entries 512
CONFIG SET hash-max-ziplist-value 64
CONFIG SET zset-max-ziplist-entries 128
CONFIG SET zset-max-ziplist-value 64
```

#### 过期策略
```redis
# 为临时数据设置TTL
SETEX player:session:alice 3600 "room123"  # 1小时过期

# 为已结束的房间设置过期时间（应用隔离）
EXPIRE app:game123:room:state:{game123:room456} 86400  # 24小时后清理
EXPIRE app:game123:room:metadata:{game123:room456} 86400
EXPIRE app:game123:room:members:{game123:room456} 86400
```

### 2. 读写性能优化

#### 批量操作
```redis
# 使用Pipeline批量获取房间信息（应用隔离 + 联合哈希标签）
PIPELINE
  HGETALL app:game123:room:info:{game123:room456}
  HGETALL app:game123:room:info:{game123:room457}  
  HGETALL app:game123:room:info:{game123:room458}
EXEC
```

#### 读写分离
```redis
# 写操作发送到主节点（应用隔离 + 联合哈希标签）
redis_master.hset("app:game123:room:state:{game123:room456}", "score", "100")

# 读操作从从节点读取
redis_slave.hget("app:game123:room:state:{game123:room456}", "score")
```

### 3. 网络优化

#### 连接池管理
```typescript
// Redis连接池配置
const redis = new Redis.Cluster([
  {
    host: 'redis-node1.example.com',
    port: 6379,
  },
  {
    host: 'redis-node2.example.com', 
    port: 6379,
  }
], {
  redisOptions: {
    password: 'your-password',
    maxRetriesPerRequest: 3,
  },
  poolSize: 20,  // 连接池大小
  lazyConnect: true,
});
```

#### 请求合并
```typescript
// 将多个小请求合并为批量操作（应用隔离 + 联合哈希标签）
const pipeline = redis.pipeline();
pipeline.hget('app:game123:room:info:{game123:room456}', 'name');
pipeline.hget('app:game123:room:info:{game123:room456}', 'status');
pipeline.scard('app:game123:room:members:{game123:room456}');
const results = await pipeline.exec();
```

### 4. 缓存策略

#### 本地缓存
```typescript
// 在应用层缓存热点数据
class RoomInfoCache {
  private cache = new Map<string, RoomInfo>();
  private ttl = 60000; // 1分钟TTL
  
  constructor(private appId: string) {}
  
  async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const cached = this.cache.get(roomId);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    
    const data = await redis.hgetall(`app:${this.appId}:room:info:{${this.appId}:${roomId}}`);
    this.cache.set(roomId, { data, timestamp: Date.now() });
    return data;
  }
}
```

#### Redis缓存层
```redis
# 为频繁查询的数据设置短TTL缓存
SETEX cache:room_list:public:waiting:page1 30 '[{"roomId":"room123",...}]'
```

---

## 运维与监控

### 1. 关键指标监控

#### 性能指标
```bash
# Redis性能监控
redis-cli --latency -h redis-server -p 6379
redis-cli --latency-history -h redis-server -p 6379

# 内存使用监控  
redis-cli info memory

# 连接数监控
redis-cli info clients

# 操作统计
redis-cli info stats
```

### 2. 数据备份策略

#### 定期备份
```bash
# RDB快照备份
redis-cli --rdb /backup/dump-$(date +%Y%m%d-%H%M%S).rdb

# AOF备份
redis-cli config set appendonly yes
redis-cli bgrewriteaof
```

#### 主从同步监控
```bash
# 检查主从延迟
redis-cli -h slave-server info replication

# 监控同步状态
redis-cli -h master-server info replication
```

### 3. 故障恢复

#### 集群故障转移
```bash
# 手动触发故障转移
redis-cli -c -h cluster-node cluster failover

# 检查集群状态
redis-cli -c cluster nodes
redis-cli -c cluster info
```

#### 数据恢复
```bash
# 从RDB文件恢复
redis-server --dbfilename dump.rdb --dir /backup/

# 从AOF文件恢复  
redis-server --appendonly yes --appendfilename appendonly.aof
```

---

## 扩展性考虑

### 1. 水平扩展

#### Redis Cluster 自动分片

RealSync 使用 **Redis Cluster + ioredis**，无需手动分片：

```typescript
// Redis Cluster 配置 - 自动分片
const redis = new Redis.Cluster([
  { host: 'redis-cluster-node1', port: 6379 },
  { host: 'redis-cluster-node2', port: 6379 },
  { host: 'redis-cluster-node3', port: 6379 },
  { host: 'redis-cluster-node4', port: 6379 },
  { host: 'redis-cluster-node5', port: 6379 },
  { host: 'redis-cluster-node6', port: 6379 }
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
  },
  enableReadyCheck: true,
  maxRedirections: 6,
  retryDelayOnFailover: 100,
  enableOfflineQueue: false
});
```

---

## 最佳实践总结

### 1. 命名规范
- 使用冒号分隔的层次化命名: `app:{appId}:service:type:{hashTag}`
- 统一的前缀: `app:{appId}:` 进行应用隔离
- 避免过长的key名称影响内存使用

### 2. 数据结构选择
- **HASH**: 适用于对象数据，支持字段级更新
- **SET**: 适用于成员关系，支持集合运算
- **ZSET**: 适用于需要排序的列表数据
- **STRING**: 适用于简单值和计数器

### 3. 过期策略
- 临时会话数据: 1-4小时TTL
- 已结束房间: 24小时TTL  
- 历史数据: 7天TTL
- 缓存数据: 30秒-5分钟TTL

### 4. 监控告警
- 内存使用率 > 80%
- 连接数 > 1000
- 平均延迟 > 10ms
- 主从同步延迟 > 1秒

---

## 🚀 快速导航

### 新手入门
1. 📖 先阅读本文档了解基础概念和架构设计
2. 🎮 根据需求选择 [游戏局设计](./redis-game-session.md) 或 [房间服务设计](./redis-room-service.md)

### 开发者指南
- **实现游戏内同步** → [游戏局 Redis 设计](./redis-game-session.md)
- **构建游戏大厅** → [房间服务 Redis 设计](./redis-room-service.md)
- **系统架构设计** → 本文档的架构概览部分

### 运维人员
- **性能监控** → 本文档的 [运维与监控](#运维与监控) 部分
- **扩展规划** → 本文档的 [扩展性考虑](#扩展性考虑) 部分
- **故障排查** → 各子文档的监控指标部分

---

## 🔗 相关文档

- **[架构设计](./architecture.md)** - RealSync 整体架构
- **[协议设计](./protocol-design.md)** - 通信协议规范

---

> **💡 提示**: 本设计支持大规模多租户部署，单个Redis集群可服务数千个游戏应用，每个应用的数据完全隔离且性能优化。

通过这套完整的Redis设计框架，RealSync能够支持大规模的实时多人游戏场景，提供低延迟、高可用的数据服务。
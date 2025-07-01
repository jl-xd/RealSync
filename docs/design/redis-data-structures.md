# RealSync Redis 数据结构设计文档

版本: 1.0  
更新时间: 2024-01-01

## 📋 目录

- [架构概览](#架构概览)
- [设计原则](#设计原则)
- [核心数据结构](#核心数据结构)
- [房间索引系统](#房间索引系统)
- [数据一致性策略](#数据一致性策略)
- [性能优化](#性能优化)
- [运维与监控](#运维与监控)
- [扩展性考虑](#扩展性考虑)

---

## 架构概览

RealSync 使用 **Redis 集群** 作为核心数据存储和消息队列，支持高并发的实时状态同步和房间管理。

### 🔥 Redis 哈希标签机制

RealSync 大量使用 **Redis 哈希标签 (Hash Tags)** 来优化集群性能：

```redis
# ✅ 使用哈希标签 - 同一房间数据在同一节点
room:state:{room123}      # 房间状态
room:members:{room123}    # 房间成员  
room:metadata:{room123}   # 房间元数据

# ❌ 不使用哈希标签 - 数据可能分散到不同节点
room:state:room123        # 可能在节点A
room:members:room123      # 可能在节点B
room:metadata:room123     # 可能在节点C
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
getHashSlot('room:state:{room123}');     // 基于 'room123' 计算
getHashSlot('room:members:{room123}');   // 基于 'room123' 计算 (相同!)
getHashSlot('room:state:room123');       // 基于整个key计算 (不同!)
```

#### 原子性操作示例

```redis
# ✅ 可以使用事务 - 所有key在同一节点
MULTI
  HSET room:state:{room123} "player_count" "4"
  SADD room:members:{room123} "4" 
  HSET room:metadata:{room123} "status" "full"
EXEC

# ❌ 无法使用事务 - key可能在不同节点
MULTI
  HSET room:state:room123 "player_count" "4"    # 节点A
  SADD room:members:room456 "1"                  # 节点B
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

## 核心数据结构

> **🔥 重要：Redis 哈希标签机制**: 
> - `{roomId}` 是 **Redis Cluster 哈希标签**，不是占位符！
> - 哈希标签确保同一房间的所有数据存储在同一个Redis节点
> - 实际使用：`room:state:{room123}` （保留大括号）
> - 这是Redis集群数据局部性和原子性操作的关键机制

### 房间核心数据

房间相关的数据是系统的核心，设计了多层次的存储结构：

#### 1. 房间状态 (Room State)

```redis
# 数据结构: HASH
# Key: room:state:{roomId} - 使用哈希标签确保数据局部性
# 用途: 存储房间内的所有游戏状态 (使用短playerId)

HSET room:state:{room123} 
  "player_1_position" '{"x":100,"y":200,"timestamp":1640995200000}'
  "player_2_health" "85"
  "player_3_score" "250"
  "game_phase" "combat"
  "round_timer" "60"
  "score_red_team" "150"
  "score_blue_team" "120"
  "leaderboard" '[{"playerId":1,"score":250},{"playerId":2,"score":180},{"playerId":3,"score":120}]'
```

**玩家状态命名规范:**
```redis
# 玩家相关状态使用 player_{playerId}_{属性} 格式
"player_1_position"     # 玩家1的位置
"player_1_health"       # 玩家1的血量
"player_1_inventory"    # 玩家1的道具
"player_2_position"     # 玩家2的位置
"player_2_health"       # 玩家2的血量
```

**设计要点:**
- **使用短ID**: 状态键使用playerId而非openid，节省存储空间
- **隐私保护**: 状态数据不包含任何敏感的用户信息
- **独立更新**: 每个字段支持原子更新，减少并发冲突
- **类型支持**: 支持数字、字符串、JSON对象、数组等任意数据类型
- **开发友好**: 使用简单的数字ID，便于开发者处理和调试

#### 2. 房间成员与玩家映射 (Room Members & Player Mapping)

```redis
# 房间成员列表 (使用短playerId + 哈希标签)
# 数据结构: SET
# Key: room:members:{roomId} - {roomId}是哈希标签，保持原样
SADD room:members:{room123} 1 2 3

# 玩家ID计数器
# 数据结构: STRING
# Key: room:player_counter:{roomId}
SET room:player_counter:{room123} 3

# OpenID到PlayerId的映射
# 数据结构: HASH
# Key: room:openid_mapping:{roomId}
HSET room:openid_mapping:{room123}
  "oX8Tj5JbPZz9X2k1nQlR5rVv8Hc4M9BgWhFt3Ys7Kp2vN8mL6qE1rTz4" "1"
  "oY9Uk6LcQZa8Y3l2oRmS6sWx9Id5N0ChXhGu4Zt8Lq3wO9nM7rF2sTa5" "2"
  "oZ0Vl7MdRab9Z4m3pSnT7tXy0Je6O1DiYiHv5Au9Mr4xP0oN8sG3tUb6" "3"

# PlayerId到OpenID的反向映射
# 数据结构: HASH
# Key: room:player_mapping:{roomId}
HSET room:player_mapping:{room123}
  "1" "oX8Tj5JbPZz9X2k1nQlR5rVv8Hc4M9BgWhFt3Ys7Kp2vN8mL6qE1rTz4"
  "2" "oY9Uk6LcQZa8Y3l2oRmS6sWx9Id5N0ChXhGu4Zt8Lq3wO9nM7rF2sTa5"
  "3" "oZ0Vl7MdRab9Z4m3pSnT7tXy0Je6O1DiYiHv5Au9Mr4xP0oN8sG3tUb6"

# 玩家加入时间 (使用短playerId)
# 数据结构: HASH
# Key: room:join_time:{roomId}
HSET room:join_time:{room123}
  "1" "1640995200"
  "2" "1640995210" 
  "3" "1640995220"
```

**操作示例:**
```redis
# 检查PlayerId是否在房间
SISMEMBER room:members:{room123} 1  # 返回: 1

# 获取房间所有PlayerId
SMEMBERS room:members:{room123}  # 返回: ["1", "2", "3"]

# 获取房间玩家数量
SCARD room:members:{room123}  # 返回: 3

# 通过OpenID获取PlayerId
HGET room:openid_mapping:{room123} "oX8Tj5JbPZz9X2k1nQlR5rVv8Hc4M9BgWhFt3Ys7Kp2vN8mL6qE1rTz4"  # 返回: "1"

# 通过PlayerId获取OpenID (内部验证使用)
HGET room:player_mapping:{room123} "1"  # 返回: "oX8Tj5JbPZz9X2k1nQlR5rVv8Hc4M9BgWhFt3Ys7Kp2vN8mL6qE1rTz4"
```

**设计要点:**
- **存储优化**: 使用4字节数字ID替代58字节字符串，节省93%存储空间
- **隐私保护**: 开发者API只暴露PlayerId，无法获取OpenID
- **双向映射**: 支持PlayerId↔OpenID的快速转换
- **临时性**: PlayerId仅在房间内有效，离开后失效
- **原子分配**: 使用Redis INCR确保PlayerId唯一性

#### 3. 房间元数据 (Room Metadata)

```redis
# 数据结构: HASH
# Key: room:metadata:{roomId} - 哈希标签确保与房间状态在同一节点
# 用途: 存储房间的配置和管理信息

HSET room:metadata:{room123}
  "name" "Epic Battle Arena"
  "game_mode" "battle"
  "max_players" "4"
  "owner_id" "alice"
  "status" "playing"
  "visibility" "public" 
  "created_at" "1640995200"
  "invite_code" "ABC123"
  "region" "us-west"
  "version" "1.0"
```

**设计要点:**
- 存储房间管理所需的元信息
- 支持部分字段更新（如状态变更）
- 包含创建时间、版本等审计信息
- 为私有房间存储邀请码

#### 4. 实时消息通道 (Real-time Channels)

```redis
# 数据结构: Pub/Sub Channel
# Key: room:channel:{roomId}  
# 用途: 房间内实时消息广播 (使用短playerId)

# 发布状态更新 (服务器操作)
PUBLISH room:channel:{room123} '{
  "type": "state_update",
  "source_player_id": 1, 
  "patches": {
    "player_1_position": {"x": 120, "y": 250}
  },
  "timestamp": 1640995300
}'

# 发布玩家加入消息
PUBLISH room:channel:{room123} '{
  "type": "player_joined",
  "player_info": {
    "playerId": 4,
    "nickname": "NewPlayer",
    "joined_at": 1640995400
  },
  "room_info": {
    "player_count": 4,
    "status": "waiting"
  }
}'

# 发布玩家离开消息
PUBLISH room:channel:{room123} '{
  "type": "player_left", 
  "player_id": 2,
  "room_info": {
    "player_count": 3,
    "status": "waiting"
  }
}'

# 订阅房间消息 (网关服务器操作)
SUBSCRIBE room:channel:{room123}
```

**设计要点:**
- **隐私保护**: 消息中使用playerId，不暴露openid
- **轻量消息**: 使用4字节数字ID，减少消息大小
- **实时广播**: 利用Redis Pub/Sub实现毫秒级消息分发
- **多实例同步**: 支持多网关服务器实例间的消息同步
- **消息结构化**: 统一消息格式，包含类型、来源、时间戳等元信息

---

## 房间索引系统

为了支持高效的房间查询、过滤和排序，设计了完整的索引体系：

### 1. 房间基本信息索引

```redis
# 数据结构: HASH
# Key: room:info:{roomId}
# 用途: 房间列表查询的快速索引

HSET room:info:{room123}
  "name" "Epic Battle Arena"
  "status" "waiting"
  "visibility" "public"
  "player_count" "2"
  "max_players" "4"
  "game_mode" "battle"
  "owner_id" "alice"
  "created_at" "1640995200"
  "last_activity_at" "1640995800"
  "region" "us-west"
  "ping" "45"
```

**设计理念:**
- 专门为房间列表查询优化
- 包含UI显示所需的所有信息
- 避免每次查询都读取完整元数据
- 支持批量获取多个房间信息

### 2. 状态分类索引

```redis
# 数据结构: ZSET (Sorted Set)
# Score: timestamp (用于排序)
# Member: roomId

# 等待中的房间 (按创建时间排序)
ZADD rooms:status:waiting 1640995200 "room123"
ZADD rooms:status:waiting 1640995250 "room124"
ZADD rooms:status:waiting 1640995300 "room125"

# 游戏中的房间 (按开始时间排序)  
ZADD rooms:status:playing 1640995400 "room126"
ZADD rooms:status:playing 1640995450 "room127"

# 已结束的房间 (按结束时间排序)
ZADD rooms:status:finished 1640995600 "room128"
```

**查询示例:**
```redis
# 获取最新的10个等待中的房间
ZREVRANGE rooms:status:waiting 0 9 WITHSCORES

# 获取特定时间范围的房间
ZRANGEBYSCORE rooms:status:waiting 1640995200 1640995400

# 获取房间总数
ZCARD rooms:status:waiting
```

### 3. 可见性分类索引

```redis
# 公开且等待中的房间
ZADD rooms:public:waiting 1640995200 "room123"
ZADD rooms:public:waiting 1640995250 "room124"

# 公开且游戏中的房间
ZADD rooms:public:playing 1640995400 "room126"

# 私有房间集合 (不需要排序)
SADD rooms:private "room129" "room130" "room131"
```

### 4. 游戏模式分类索引

```redis
# 按游戏模式分类的等待中房间
ZADD rooms:gamemode:battle:waiting 1640995200 "room123"
ZADD rooms:gamemode:battle:waiting 1640995250 "room124"

ZADD rooms:gamemode:racing:waiting 1640995300 "room125"
ZADD rooms:gamemode:racing:waiting 1640995350 "room126"

# 按游戏模式分类的游戏中房间
ZADD rooms:gamemode:battle:playing 1640995400 "room127"
ZADD rooms:gamemode:racing:playing 1640995450 "room128"
```

### 5. 全局索引

```redis
# 所有活跃房间 (按最后活动时间排序)
ZADD rooms:all 1640995800 "room123"
ZADD rooms:all 1640995850 "room124"
ZADD rooms:all 1640995900 "room125"

# 按创建者分类
SADD rooms:by_owner:alice "room123" "room129"
SADD rooms:by_owner:bob "room124" "room130"

# 按地理区域分类
ZADD rooms:region:us-west 1640995200 "room123"
ZADD rooms:region:us-east 1640995250 "room124"
ZADD rooms:region:eu-west 1640995300 "room125"
```

### 6. 复合查询支持

```redis
# 使用Lua脚本进行复合查询
local script = [[
  local status_filter = ARGV[1]
  local gamemode_filter = ARGV[2]
  local page = tonumber(ARGV[3])
  local page_size = tonumber(ARGV[4])
  
  -- 构建查询key
  local query_key = "rooms:gamemode:" .. gamemode_filter .. ":" .. status_filter
  
  -- 分页查询
  local start_idx = (page - 1) * page_size
  local end_idx = start_idx + page_size - 1
  
  -- 获取房间ID列表
  local room_ids = redis.call('ZREVRANGE', query_key, start_idx, end_idx)
  
  -- 批量获取房间信息
  local room_infos = {}
  for i, room_id in ipairs(room_ids) do
    local info_key = "room:info:{" .. room_id .. "}"
    local room_info = redis.call('HGETALL', info_key)
    table.insert(room_infos, room_info)
  end
  
  return room_infos
]]

# 执行复合查询
EVAL script 0 "waiting" "battle" "1" "10"
```

---

## 数据一致性策略

### 1. 事务性更新

使用Redis事务确保相关数据的原子性更新：

```redis
# 房间状态变更的原子操作
MULTI
  # 更新房间状态
  HSET room:metadata:{room123} "status" "playing"
  HSET room:info:{room123} "status" "playing"
  
  # 更新索引
  ZREM rooms:status:waiting "room123"
  ZREM rooms:public:waiting "room123"
  ZADD rooms:status:playing 1640995400 "room123"
  ZADD rooms:public:playing 1640995400 "room123"
  
  # 更新活跃时间
  ZADD rooms:all 1640995400 "room123"
EXEC
```

### 2. Lua脚本保证一致性

对于复杂的多步操作，使用Lua脚本确保原子性：

```lua
-- 玩家加入房间的原子操作 (支持playerId分配)
local join_room_script = [[
  local room_id = ARGV[1]
  local openid = ARGV[2]
  local max_players = tonumber(ARGV[3])
  
  -- 检查房间是否存在
  local room_exists = redis.call('EXISTS', 'room:metadata:{' .. room_id .. '}')
  if room_exists == 0 then
    return {err = 'ROOM_NOT_FOUND'}
  end
  
  -- 检查玩家是否已在房间中
  local existing_player_id = redis.call('HGET', 'room:openid_mapping:{' .. room_id .. '}', openid)
  if existing_player_id then
    return {ok = 'ALREADY_IN_ROOM', player_id = tonumber(existing_player_id)}
  end
  
  -- 检查房间是否已满
  local current_count = redis.call('SCARD', 'room:members:{' .. room_id .. '}')
  if current_count >= max_players then
    return {err = 'ROOM_FULL'}
  end
  
  -- 分配新的playerId
  local player_id = redis.call('INCR', 'room:player_counter:{' .. room_id .. '}')
  
  -- 建立双向映射
  redis.call('HSET', 'room:openid_mapping:{' .. room_id .. '}', openid, player_id)
  redis.call('HSET', 'room:player_mapping:{' .. room_id .. '}', player_id, openid)
  
  -- 添加到成员列表
  redis.call('SADD', 'room:members:{' .. room_id .. '}', player_id)
  
  -- 记录加入时间
  local timestamp = redis.call('TIME')[1]
  redis.call('HSET', 'room:join_time:{' .. room_id .. '}', player_id, timestamp)
  
  -- 更新房间信息
  local new_count = current_count + 1
  redis.call('HSET', 'room:info:{' .. room_id .. '}', 'player_count', new_count)
  redis.call('HSET', 'room:metadata:{' .. room_id .. '}', 'player_count', new_count)
  redis.call('HSET', 'room:info:{' .. room_id .. '}', 'last_activity_at', timestamp)
  redis.call('ZADD', 'rooms:all', timestamp, room_id)
  
  return {ok = 'SUCCESS', player_id = player_id, player_count = new_count}
]]

-- 玩家离开房间的原子操作
local leave_room_script = [[
  local room_id = ARGV[1]
  local player_id = tonumber(ARGV[2])
  
  -- 检查玩家是否在房间中
  local is_member = redis.call('SISMEMBER', 'room:members:{' .. room_id .. '}', player_id)
  if is_member == 0 then
    return {err = 'PLAYER_NOT_IN_ROOM'}
  end
  
  -- 获取OpenID用于清理映射
  local openid = redis.call('HGET', 'room:player_mapping:{' .. room_id .. '}', player_id)
  
  -- 清理映射关系
  redis.call('HDEL', 'room:openid_mapping:{' .. room_id .. '}', openid)
  redis.call('HDEL', 'room:player_mapping:{' .. room_id .. '}', player_id)
  redis.call('SREM', 'room:members:{' .. room_id .. '}', player_id)
  
  -- 记录离开时间
  local timestamp = redis.call('TIME')[1]
  redis.call('HSET', 'room:leave_time:{' .. room_id .. '}', player_id, timestamp)
  
  -- 更新房间信息
  local new_count = redis.call('SCARD', 'room:members:{' .. room_id .. '}')
  redis.call('HSET', 'room:info:{' .. room_id .. '}', 'player_count', new_count)
  redis.call('HSET', 'room:metadata:{' .. room_id .. '}', 'player_count', new_count)
  redis.call('HSET', 'room:info:{' .. room_id .. '}', 'last_activity_at', timestamp)
  redis.call('ZADD', 'rooms:all', timestamp, room_id)
  
  return {ok = 'SUCCESS', player_count = new_count}
]]
```

### 3. 数据修复机制

定期执行数据一致性检查和修复：

```redis
# 数据修复脚本示例
local repair_script = [[
  -- 修复房间计数不一致问题
  local room_ids = redis.call('ZRANGE', 'rooms:all', 0, -1)
  
  for i, room_id in ipairs(room_ids) do
    -- 重新计算房间人数
    local actual_count = redis.call('SCARD', 'room:members:{' .. room_id .. '}')
    
    -- 更新信息中的人数
    redis.call('HSET', 'room:info:{' .. room_id .. '}', 'player_count', actual_count)
    redis.call('HSET', 'room:metadata:{' .. room_id .. '}', 'player_count', actual_count)
  end
  
  return 'REPAIR_COMPLETED'
]]
```

### 4. 冲突解决策略

**乐观锁机制:**
```redis
# 使用版本号避免并发冲突
WATCH room:metadata:{room123}

# 检查版本号
version = HGET room:metadata:{room123} "version"
if version != expected_version:
    UNWATCH
    return "CONFLICT"

# 执行更新
MULTI
  HSET room:metadata:{room123} "status" "playing"
  HINCRBY room:metadata:{room123} "version" 1
EXEC
```

**最后写入获胜 (Last Write Wins):**
```redis
# 对于状态更新，总是接受最新的写入
HSET room:state:{room123} "player_alice_position" '{"x":120,"y":250,"timestamp":1640995400}'
```

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

# 为已结束的房间设置过期时间
EXPIRE room:state:{room123} 86400  # 24小时后清理
EXPIRE room:metadata:{room123} 86400
EXPIRE room:members:{room123} 86400
```

### 2. 读写性能优化

#### 批量操作
```redis
# 使用Pipeline批量获取房间信息
PIPELINE
  HGETALL room:info:{room123}
  HGETALL room:info:{room124}  
  HGETALL room:info:{room125}
EXEC
```

#### 读写分离
```redis
# 写操作发送到主节点
redis_master.hset("room:state:{room123}", "score", "100")

# 读操作从从节点读取
redis_slave.hget("room:state:{room123}", "score")
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
// 将多个小请求合并为批量操作
const pipeline = redis.pipeline();
pipeline.hget('room:info:{room123}', 'name');
pipeline.hget('room:info:{room123}', 'status');
pipeline.scard('room:members:{room123}');
const results = await pipeline.exec();
```

### 4. 缓存策略

#### 本地缓存
```typescript
// 在应用层缓存热点数据
class RoomInfoCache {
  private cache = new Map<string, RoomInfo>();
  private ttl = 60000; // 1分钟TTL
  
  async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const cached = this.cache.get(roomId);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    
    const data = await redis.hgetall(`room:info:{${roomId}}`);
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

#### 业务指标
```redis
# 房间数量统计
SCRIPT LOAD "
  local total_rooms = redis.call('ZCARD', 'rooms:all')
  local waiting_rooms = redis.call('ZCARD', 'rooms:status:waiting') 
  local playing_rooms = redis.call('ZCARD', 'rooms:status:playing')
  return {total_rooms, waiting_rooms, playing_rooms}
"

# 在线玩家统计
SCRIPT LOAD "
  local total_players = 0
  local room_ids = redis.call('ZRANGE', 'rooms:all', 0, -1)
  for i, room_id in ipairs(room_ids) do
    total_players = total_players + redis.call('SCARD', 'room:members:' .. room_id)
  end
  return total_players
"
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

// 直接使用，Redis Cluster自动处理分片
class RoomManager {
  async createRoom(roomId: string, roomData: any) {
    // 自动路由到正确的节点，无需手动分片逻辑
    await redis.hset(`room:state:${roomId}`, roomData);
    await redis.zadd('rooms:all', Date.now(), roomId);
  }
  
  async getRoomState(roomId: string) {
    // Redis根据key的hash slot自动路由
    return await redis.hgetall(`room:state:${roomId}`);
  }
}
```

#### 集群扩容

Redis Cluster 支持动态扩容：

```bash
# 添加新节点到集群
redis-cli --cluster add-node new-node-ip:6379 existing-node-ip:6379

# 重新分片，迁移部分hash slot到新节点
redis-cli --cluster reshard existing-node-ip:6379 \
  --cluster-from source-node-id \
  --cluster-to target-node-id \
  --cluster-slots 1000

# 检查集群状态
redis-cli --cluster check existing-node-ip:6379
```

**扩容优势:**
- **零停机**: 扩容过程中服务不中断
- **自动迁移**: Redis自动迁移数据到新节点
- **负载均衡**: 自动重新分布hash slot

### 2. 读写分离扩展

```typescript
// 主从读写分离
class RedisCluster {
  private masterNodes: Redis[];
  private slaveNodes: Redis[];
  
  async write(key: string, value: string): Promise<void> {
    const master = this.getMasterForKey(key);
    await master.set(key, value);
  }
  
  async read(key: string): Promise<string> {
    const slave = this.getSlaveForKey(key);
    return await slave.get(key);
  }
}
```

### 3. 数据分层存储

```typescript
// 热温冷数据分层
class TieredStorage {
  private hotRedis: Redis;      // 热数据: 当前活跃房间
  private warmRedis: Redis;     // 温数据: 近期房间
  private coldStorage: Database; // 冷数据: 历史房间
  
  async getRoomData(roomId: string): Promise<RoomData> {
    // 先从热数据查找
    let data = await this.hotRedis.hgetall(`room:state:${roomId}`);
    if (data) return data;
    
    // 再从温数据查找
    data = await this.warmRedis.hgetall(`room:state:${roomId}`);
    if (data) {
      // 提升到热数据
      await this.hotRedis.hset(`room:state:${roomId}`, data);
      return data;
    }
    
    // 最后从冷存储查找
    return await this.coldStorage.getRoomData(roomId);
  }
}
```

### 4. 多地域部署

```typescript
// 多地域Redis集群
class MultiRegionRedis {
  private regions: Map<string, Redis>;
  
  constructor() {
    this.regions.set('us-west', new Redis({host: 'redis-us-west.example.com'}));
    this.regions.set('us-east', new Redis({host: 'redis-us-east.example.com'}));
    this.regions.set('eu-west', new Redis({host: 'redis-eu-west.example.com'}));
  }
  
  getRegionalRedis(region: string): Redis {
    return this.regions.get(region) || this.regions.get('us-west');
  }
  
  // 跨地域数据同步
  async syncToAllRegions(key: string, value: string): Promise<void> {
    const promises = Array.from(this.regions.values()).map(redis => 
      redis.set(key, value)
    );
    await Promise.all(promises);
  }
}
```

### 5. 未来应用层分片考虑

> **注意**: 当前使用 Redis Cluster 自动分片已足够。以下场景仅在超大规模或特殊需求下考虑应用层分片。

#### 可能需要手动分片的场景

**1. 地理分片 (Multi-Region)**
- **触发条件**: 全球用户 > 100万，跨大洲延迟 > 100ms
- **策略**: 按地理位置将房间分布到就近的Redis集群
- **实现**: 
  ```typescript
  class GeoSharding {
    getClusterForUser(userLocation: string): string {
      if (userLocation.startsWith('US')) return 'us-cluster';
      if (userLocation.startsWith('EU')) return 'eu-cluster';
      if (userLocation.startsWith('AS')) return 'asia-cluster';
      return 'global-cluster';
    }
  }
  ```

**2. 业务垂直分片**
- **触发条件**: 不同游戏模式负载特征差异巨大
- **策略**: 按游戏类型分配到专用Redis集群
- **示例**: 
  - 实时竞技游戏 → 高性能SSD集群 
  - 回合制游戏 → 普通性能集群
  - 大型MMO → 专用集群

**3. 热点数据分离**
- **触发条件**: 个别房间QPS > 10000 或连接数 > 1000
- **策略**: 热点房间迁移到专用高性能集群
- **动态检测**: 基于访问频率自动识别热点

#### 预留的分片扩展接口

```typescript
// 分片策略接口
interface ShardingStrategy {
  getClusterForRoom(roomId: string, metadata?: any): string;
  getClusterForUser(userId: string, userInfo?: any): string;
  getClusterForQuery(queryType: string, filters: any): string[];
}

// 默认实现 - 单集群 (当前)
class DefaultSharding implements ShardingStrategy {
  getClusterForRoom(): string { return 'main'; }
  getClusterForUser(): string { return 'main'; }
  getClusterForQuery(): string[] { return ['main']; }
}

// 地理分片实现 (未来)
class GeoSharding implements ShardingStrategy {
  getClusterForRoom(roomId: string, metadata: any): string {
    return metadata?.region || 'us-west';
  }
  
  getClusterForUser(userId: string, userInfo: any): string {
    return this.getRegionByLocation(userInfo?.location);
  }
  
  getClusterForQuery(queryType: string, filters: any): string[] {
    if (filters?.region) return [filters.region];
    return ['us-west', 'us-east', 'eu-west', 'asia-east']; // 需要聚合查询
  }
}

// 可插拔的分片管理器
class ShardedRoomManager {
  constructor(
    private sharding: ShardingStrategy = new DefaultSharding(),
    private clusters: Map<string, Redis> = new Map([['main', redis]])
  ) {}
  
  async createRoom(roomId: string, roomData: any) {
    const clusterName = this.sharding.getClusterForRoom(roomId, roomData);
    const redis = this.clusters.get(clusterName);
    if (!redis) throw new Error(`Cluster ${clusterName} not found`);
    
    await redis.hset(`room:state:${roomId}`, roomData);
    await redis.zadd('rooms:all', Date.now(), roomId);
  }
  
  async getRoomList(filters: any): Promise<RoomInfo[]> {
    const clusterNames = this.sharding.getClusterForQuery('room_list', filters);
    const promises = clusterNames.map(async (clusterName) => {
      const redis = this.clusters.get(clusterName);
      return await this.queryRoomListFromCluster(redis, filters);
    });
    
    const results = await Promise.all(promises);
    return this.mergeAndSortResults(results.flat(), filters.sort);
  }
}
```

#### 分片迁移策略

```typescript
// 热点检测和迁移
class HotspotDetector {
  async detectAndMigrate(): Promise<void> {
    const hotRooms = await this.detectHotRooms();
    
    for (const roomId of hotRooms) {
      await this.migrateRoomToHotCluster(roomId);
    }
  }
  
  private async detectHotRooms(): Promise<string[]> {
    // 基于访问频率、连接数等指标检测热点
    const roomStats = await redis.eval(`
      local hot_rooms = {}
      local room_ids = redis.call('ZRANGE', 'rooms:all', 0, -1)
      
      for i, room_id in ipairs(room_ids) do
        local qps = redis.call('HGET', 'room:stats:' .. room_id, 'qps') or 0
        local connections = redis.call('SCARD', 'room:members:' .. room_id) or 0
        
        if tonumber(qps) > 1000 or tonumber(connections) > 100 then
          table.insert(hot_rooms, room_id)
        end
      end
      
      return hot_rooms
    `);
    
    return roomStats as string[];
  }
}
```

---

## 最佳实践总结

### 1. 命名规范
- 使用冒号分隔的层次化命名: `room:state:{roomId}`
- 统一的前缀: `room:`, `player:`, `game:`
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

通过这套完整的Redis数据结构设计，RealSync能够支持大规模的实时多人游戏场景，提供低延迟、高可用的数据服务。 
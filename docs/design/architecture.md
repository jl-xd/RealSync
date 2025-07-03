# RealSync - 多人实时同步框架设计方案

版本: 1.0

## **1. 项目愿景与核心概念**

### **1.1 项目愿景 (Vision)**

**RealSync** 是一个为游戏开发者设计的、开箱即用的多人实时状态同步框架。其核心目标是让开发者从复杂的后端网络同步逻辑中解放出来，能够像使用 Firebase/Firestore 一样，通过简洁的客户端SDK，轻松实现玩家数据、游戏状态在多端之间的低延迟同步。

- **解决的问题**: 消除自建和维护游戏同步服务器带来的高昂成本、技术复杂性和时间投入。

### **1.2 目标用户分析**

#### **用户群体概览**

| 用户群体 | 团队规模 | 主要特征 | 核心痛点 | 关键需求 |
|---------|---------|---------|---------|---------|
| **独立游戏开发者** | 1-2人 | 预算紧张，后端经验有限 | 缺乏基础设施经验，担心维护负担 | 即插即用，低成本，详细文档 |
| **中小游戏团队** | 3-20人 | 多项目并行，注重效率 | 重复造轮子，维护分散精力 | 标准化方案，快速迭代，可预测成本 |
| **Game Jam参与者** | 临时组队 | 48-72小时极限开发 | 时间极限，技术栈不统一 | 零配置，5分钟上手，多平台支持 |
| **教育用户** | 课程/训练营 | 学习导向，预算极限 | 学习曲线陡峭，缺乏实战经验 | 教育定价，渐进复杂度，完整示例 |


### **1.3 核心概念 (Core Concepts)**

- **客户端 (Client)**: 运行在玩家设备上的游戏程序，通过 **SDK** 与 RealSync 服务进行交互。
- **网关服务 (Gateway)**: RealSync 的核心后端服务，负责处理所有客户端连接、消息收发、鉴权、状态存储和逻辑执行。
- **房间 (Room)**: 一个隔离的同步空间，是游戏对局的基本单位。同一个房间内的玩家可以互相看到对方的状态更新。
- **玩家身份系统**: 
  - **OpenID**: 平台全局唯一的用户身份标识符，用于身份认证和跨服务用户识别
  - **PlayerId**: 房间内的临时短数字ID（如1、2、3），开发者API层面使用的标识符
  - **隐私保护**: 开发者和玩家之间无法获取对方的OpenID，确保用户隐私安全
- **状态 (State)**: 在一个房间内共享的所有数据，以 Key-Value 形式存储。例如玩家位置、分数、游戏倒计时等。
- **安全规则 (Security Rules)**: 一套开发者定义的JSON规则，用于精细地控制谁可以在什么条件下读取或写入哪些状态数据。

## **2. 系统架构**

### **2.1 Monorepo 策略**

本项目将采用 **Monorepo** 架构进行管理，将所有相关项目（后端服务、多语言SDK）统一放在一个 Git 代码仓库中。

- **理由**:
    1. **原子性提交**: 后端服务与SDK的协议变更可以一次性提交，杜绝版本不匹配的问题。
    2. **单一事实来源**: 可创建一个共享的 `protocol` 包来定义通信协议，确保各项目实现绝对一致。
    3. **统一开发体验**: 统一的代码风格、测试和构建流程，提升开发效率。
- **管理工具**: **Turborepo** + **pnpm workspaces**。
- **项目结构 (Directory Structure)**:
    
    ```
    /realsync/
    ├── apps/
    │   └── gateway/          # (Node.js) 网关服务
    ├── packages/
    │   ├── sdk-ts/           # (TypeScript) 客户端SDK
    │   ├── sdk-csharp/       # (C#) 客户端SDK
    │   └── protocol/         # (Protobuf) 共享的协议定义
    ├── package.json          # 根项目配置
    └── turbo.json            # Turborepo 配置文件
    
    ```
    

### **2.2 技术栈 (Technology Stack)**

- **网关服务**: Node.js, TypeScript, WebSocket (`ws` 库), ioredis
- **数据存储/消息队列**: Redis 集群 (Hash, Set, Pub/Sub)
- **SDK (TS)**: TypeScript, esbuild/Rollup (打包)
- **SDK (C#)**: .NET Standard 2.1 (以兼容Unity等引擎)
- **协议定义**: Protocol Buffers (Protobuf 3)
- **Monorepo管理**: Turborepo

### **2.3 架构图**

```
+------------------+      +------------------+
|   Game Client    |      |   Game Client    |
| (Unity with C#)  |      |  (Browser with JS) |
+------------------+      +------------------+
        | [C# SDK]               | [TS SDK]
        |                        |
+-------v------------------------v---------------+
|          Single Entry Point (e.g., wss://connect.realsync.io)           |
+-------------------------------------------------------------------------+
|                         Load Balancer (Nginx, ELB, etc.)                |
+-------------------------------------------------------------------------+
|    [WebSocket Connection Forwarding based on least connections, etc.]   |
+-------+------------------------+------------------------+---------------+
|       |                        |                        |
+-------v------+       +---------v--------+       +-------v--------+
| RealSync     |       | RealSync         |       | RealSync       |
| Gateway #1   |       | Gateway #2       |       | Gateway #N     |
| (Node.js)    |       | (Node.js)        |       | (Node.js)      |
+--------------+       +------------------+       +----------------+
        |                        |                        |
        +------------------------+------------------------+
                                 |
                                 | [ioredis client]
                                 |
+--------------------------------v----------------------------------+
|                                                                   |
|                           Redis Cluster                             |
|                                                                   |
| +------------------------+ +-----------------------+ +-----------+ |
| | State (Hash)           | | Members (Set)         | | Updates   | |
| | room:state:{id}        | | room:members:{id}     | | (Pub/Sub) | |
| +------------------------+ +-----------------------+ +-----------+ |
|                                                                   |
+-------------------------------------------------------------------+

```

### **2.4 分布式考量：连接与服务发现**

随着业务增长，单个网关实例将成为瓶颈。为了实现高可用和水平扩展，系统必须支持部署多个网关实例。这引出一个关键问题：**客户端SDK应如何连接到正确的网关？**

**解决方案：引入负载均衡器 (Load Balancer)**

我们不应让SDK直接感知到多个网关的存在，这会极大地增加客户端的复杂性。相反，我们采用标准的行业实践：

1. **单一入口点**: 所有网关实例都部署在一个**负载均衡器**（如 Nginx、HAProxy 或云服务商提供的ALB/ELB）之后。
2. **SDK的简单性**: SDK的配置中**只需要一个地址**，即负载均衡器的公共访问地址（例如 `wss://connect.realsync.io`）。
3. **连接分发**: 当客户端发起WebSocket连接请求时：
    - 请求首先到达负载均衡器。
    - 负载均衡器根据其策略（如"最少连接数"、"轮询"）选择一个当前负载最低的、健康的网关实例。
    - 然后将WebSocket连接"透传"给该实例。
4. **无状态网关**: 我们的架构优势在于，**任何一个网关实例都可以处理任何一个客户端的任何请求**。因为所有共享状态（如玩家在哪个房间、房间数据是什么）都存储在外部的 **Redis 集群**中。这种无状态设计使得网关的水平扩展变得非常简单和可靠。

**结论**: 这种方法将后端的复杂性完全屏蔽，SDK的实现可以保持极度简洁，开发者也无需关心服务端的部署细节。

## **3. 玩家身份系统 (Player Identity System)**

### **3.1 双层身份架构**

RealSync 采用**双层身份架构**来平衡功能需求、性能优化和隐私保护：

```typescript
// 平台层：全局身份识别
const openid = "oX8Tj5JbPZz9X2k1nQlR5rVv8Hc4M9BgWhFt3Ys7Kp2vN8mL6qE1rTz4"; // 58字符

// 房间层：临时短ID
const playerId = 1; // 房间内递增的数字ID
```

**设计原则:**
- **隐私优先**: 开发者API层面完全不暴露OpenID
- **性能优先**: 使用4字节数字ID替代58字节字符串，节省85%存储和传输开销
- **安全优先**: 房间内临时ID无法用于用户追踪或身份关联

### **3.2 身份映射机制**

#### **加入房间时的ID分配**
```typescript
class RoomPlayerManager {
  async joinRoom(openid: string, roomId: string): Promise<number> {
    // 1. 检查是否已在房间内
    const existingPlayerId = await this.redis.hget(
      `room:openid_mapping:${roomId}`, openid
    );
    if (existingPlayerId) return parseInt(existingPlayerId);
    
    // 2. 分配新的房间内playerId
    const playerId = await this.redis.incr(`room:player_counter:${roomId}`);
    
    // 3. 建立双向映射
    await this.redis.multi()
      .hset(`room:openid_mapping:${roomId}`, openid, playerId)     // OpenID → PlayerId
      .hset(`room:player_mapping:${roomId}`, playerId, openid)     // PlayerId → OpenID
      .sadd(`room:members:${roomId}`, playerId)                    // 成员列表使用短ID
      .hset(`room:join_time:${roomId}`, playerId, Date.now())
      .exec();
    
    return playerId;
  }
}
```

#### **数据隔离与访问控制**
```typescript
// ✅ 开发者可见的API响应
{
  playerId: 1,
  nickname: "Player1", 
  position: { x: 100, y: 200 },
  isOnline: true
}

// ❌ 开发者无法访问的内部数据
{
  openid: "oX8Tj5JbPZz9X2k1nQlR5rVv8Hc4M9BgWhFt3Ys7Kp2vN8mL6qE1rTz4",
  realName: "张三",
  phone: "13800138000"
}
```

### **3.3 SDK接口设计**

#### **开发者视角的API**
```typescript
// 开发者使用的RealSync SDK
class RealSyncRoom {
  private currentPlayerId: number | null = null;
  
  // 加入房间 - 返回分配的PlayerId
  async join(): Promise<JoinResult> {
    const result = await this.api.joinRoom(this.roomId);
    this.currentPlayerId = result.playerId; // 存储当前玩家的短ID
    
    return {
      playerId: result.playerId,           // 当前玩家的房间内ID  
      otherPlayers: result.otherPlayers,   // 其他玩家信息（仅包含PlayerId）
      roomState: result.roomState
    };
  }
  
  // 更新状态 - 使用PlayerId
  async updateState(key: string, value: any): Promise<void> {
    await this.api.updatePlayerState(this.currentPlayerId, key, value);
  }
  
  // 获取玩家状态 - 返回PlayerId映射
  async getPlayersState(): Promise<Map<number, PlayerState>> {
    // 返回 PlayerId → PlayerState 的映射
    return await this.api.getPlayersState(this.roomId);
  }
}
```

#### **内部认证流程**
```typescript
// 服务端内部的身份验证
class AuthenticationFlow {  
  async validateRequest(roomId: string, playerId: number, token: string): Promise<boolean> {
    // 1. 从JWT中提取OpenID
    const openid = this.jwt.decode(token).openid;
    
    // 2. 验证PlayerId与OpenID的映射关系
    const storedOpenId = await this.redis.hget(`room:player_mapping:${roomId}`, playerId.toString());
    
    // 3. 确保请求者身份一致
    return storedOpenId === openid;
  }
}
```

### **3.4 性能与安全优势**

#### **存储优化**
| 数据项 | 使用OpenID | 使用PlayerId | 优化程度 |
|--------|------------|-------------|----------|
| 网络传输 | ~60字节/ID | ~4字节/ID | **93%减少** |
| Redis存储 | ~60字节/ID | ~4字节/ID | **93%减少** |
| 内存占用 | 100% | 15% | **85%节省** |
| 查询性能 | 字符串哈希 | 整数比较 | **80%提升** |

#### **隐私保护**
- **临时性**: PlayerId仅在房间内有效，离开后失效
- **匿名性**: 玩家之间无法获取对方真实身份
- **不可追踪**: 即使PlayerId泄露也无法关联到用户账户
- **最小权限**: 开发者只能访问游戏相关的最小必要信息

### **3.5 数据生命周期**

```typescript
// 房间生命周期中的ID管理
class RoomLifecycle {
  async onPlayerJoin(openid: string, roomId: string): Promise<number> {
    // 分配新的PlayerId，建立映射关系
    return await this.roomPlayerManager.joinRoom(openid, roomId);
  }
  
  async onPlayerLeave(playerId: number, roomId: string): Promise<void> {
    // 清理映射关系，但保留历史记录用于数据完整性
    await this.redis.multi()
      .srem(`room:members:${roomId}`, playerId)
      .hdel(`room:openid_mapping:${roomId}`, /* openid */)
      .hset(`room:leave_time:${roomId}`, playerId, Date.now())
      .exec();
  }
  
  async onRoomDestroy(roomId: string): Promise<void> {
    // 房间销毁时清理所有相关的ID映射数据
    await this.redis.multi()
      .del(`room:player_counter:${roomId}`)
      .del(`room:openid_mapping:${roomId}`)
      .del(`room:player_mapping:${roomId}`)
      .del(`room:members:${roomId}`)
      .del(`room:join_time:${roomId}`)
      .del(`room:leave_time:${roomId}`)
      .exec();
  }
}
```

这种双层身份架构在保证系统性能的同时，最大化地保护了用户隐私，为开发者提供了简洁而安全的API接口。

## **4. 协议与数据模型 (Protocol & Data Model)**

我们将使用 **Protocol Buffers (Protobuf)** 作为接口定义语言 (IDL)，它是所有组件交互的"单一事实来源"。

> 📚 **详细设计文档**: [Protobuf 协议设计文档](protocol-design.md) - 完整的协议定义、类型系统和版本演进策略

### **3.1 `protocol/realtime.proto`**

```
syntax = "proto3";

package realsync;

// ===================================================================
// 1. 顶层消息封装 (Top-Level Message Wrappers)
// ===================================================================

// 客户端发送给服务器的包
message ClientPacket {
  oneof message {
    // 房间管理相关
    GetRoomListRequest get_room_list_request = 1;
    CreateRoomRequest create_room_request = 2;
    JoinRoomRequest join_room_request = 3;
    LeaveRoomRequest leave_room_request = 4;
    
    // 游戏状态相关
    UpdateStateRequest update_state_request = 5;
    
    // 未来扩展: 聊天、观战等
    // SendMessageRequest send_message_request = 6;
  }
}

// 服务器发送给客户端的包
message ServerPacket {
  oneof message {
    // 房间管理响应
    GetRoomListResponse get_room_list_response = 1;
    CreateRoomResponse create_room_response = 2;
    JoinRoomResponse join_room_response = 3;
    LeaveRoomResponse leave_room_response = 4;
    
    // 游戏状态广播
    StateUpdateBroadcast state_update_broadcast = 5;
    PlayerJoinedBroadcast player_joined_broadcast = 6;
    PlayerLeftBroadcast player_left_broadcast = 7;
    
    // 通用响应
    ErrorResponse error_response = 8;
  }
}

// ===================================================================
// 2. 核心数据结构 (Core Data Structures)
// ===================================================================

// 通用值类型 (用于各种数据同步场景)
message Value {
    oneof value {
        string string_value = 1;
        double number_value = 2;
        bool bool_value = 3;
        ArrayValue array_value = 4;
        ObjectValue object_value = 5;
    }
}

// 数组值
message ArrayValue {
    repeated Value items = 1;
}

// 对象值 (Map结构)
message ObjectValue {
    map<string, Value> fields = 1;
}

// 完整的游戏状态 (用于首次加入房间时全量同步)
map<string, Value> GameState = 1;

// ===================================================================
// 3. 具体消息定义 (Specific Message Definitions)
// ===================================================================

// ===================================================================
// 3.1 房间信息结构 (Room Info Structures)
// ===================================================================

enum RoomStatus {
  WAITING = 0;    // 等待玩家加入
  PLAYING = 1;    // 游戏进行中
  FINISHED = 2;   // 游戏已结束
}

enum RoomVisibility {
  PUBLIC = 0;     // 公开房间，任何人可见可加入
  PRIVATE = 1;    // 私有房间，需要邀请码
}

// 房间基本信息（用于列表显示）
message RoomInfo {
  string room_id = 1;
  string name = 2;
  RoomStatus status = 3;
  RoomVisibility visibility = 4;
  int32 player_count = 5;
  int32 max_players = 6;
  string game_mode = 7;
  string owner_id = 8;
  int64 created_at = 9;      // Unix timestamp
  int64 last_activity_at = 10; // Unix timestamp
}

// 房间内玩家信息（不包含敏感的OpenID）
message PlayerInfo {
  int32 player_id = 1;       // 房间内短ID
  optional string nickname = 2; // 显示名称
  optional string avatar = 3;   // 头像URL
  int64 joined_at = 4;       // 加入时间
  bool is_online = 5;        // 在线状态
}

// 分页信息
message PaginationInfo {
  int32 page = 1;
  int32 page_size = 2;
  int32 total_count = 3;
  bool has_next_page = 4;
}

// ===================================================================
// 3.2 房间管理请求 (Room Management Requests)
// ===================================================================

message GetRoomListRequest {
  // 过滤条件
  optional RoomStatus status_filter = 1;
  optional RoomVisibility visibility_filter = 2;
  optional string game_mode_filter = 3;
  
  // 分页参数
  int32 page = 4;           // 页码，从1开始
  int32 page_size = 5;      // 每页大小，默认20，最大100
  
  // 排序选项
  enum SortBy {
    CREATED_AT = 0;         // 按创建时间排序
    LAST_ACTIVITY = 1;      // 按最后活动时间排序
    PLAYER_COUNT = 2;       // 按玩家数量排序
  }
  SortBy sort_by = 6;
  bool sort_descending = 7; // true为降序，false为升序
}

message CreateRoomRequest {
  string name = 1;
  string game_mode = 2;
  int32 max_players = 3;
  RoomVisibility visibility = 4;
  optional string invite_code = 5; // 私有房间的邀请码
  map<string, Value> initial_state = 6; // 房间初始状态
}

message JoinRoomRequest {
  string room_id = 1;
  optional string invite_code = 2; // 私有房间需要提供邀请码
  // JWT Token 将在 WebSocket 连接的 URL 参数中传递，不在此处
}

message LeaveRoomRequest {
  string room_id = 1;
}

message UpdateStateRequest {
  map<string, Value> state_patches = 1; // 状态的增量更新
}

// ===================================================================
// 3.3 房间管理响应 (Room Management Responses)
// ===================================================================

message GetRoomListResponse {
  bool success = 1;
  repeated RoomInfo rooms = 2;
  PaginationInfo pagination = 3;
}

message CreateRoomResponse {
  bool success = 1;
  RoomInfo room_info = 2;    // 成功创建的房间信息
}

message JoinRoomResponse {
  bool success = 1;
  int32 player_id = 2;         // 分配给当前玩家的房间内短ID
  GameState initial_state = 3; // 成功加入后，返回房间的当前全量状态
  repeated PlayerInfo players_in_room = 4; // 房间内所有玩家的信息
  RoomInfo room_info = 5;      // 房间基本信息
}

message LeaveRoomResponse {
  bool success = 1;
}

// ===================================================================
// 3.4 游戏状态广播 (Game State Broadcasts)
// ===================================================================

message StateUpdateBroadcast {
  int32 source_player_id = 1; // 状态更新的发起者（房间内短ID）
  map<string, Value> state_patches = 2; // 状态的增量更新
}

message PlayerJoinedBroadcast {
  PlayerInfo player_info = 1; // 加入的玩家信息
  RoomInfo room_info = 2;      // 更新后的房间信息（玩家数量等）
}

message PlayerLeftBroadcast {
  int32 player_id = 1;        // 离开的玩家ID（房间内短ID）
  RoomInfo room_info = 2;      // 更新后的房间信息（玩家数量等）
}

// ===================================================================
// 3.5 通用响应 (Generic Responses)
// ===================================================================

message ErrorResponse {
  int32 code = 1;
  string message = 2;
  optional string details = 3; // 错误详情，用于调试
}

// ===================================================================
// 3.6 错误码定义 (Error Code Definitions)
// ===================================================================

// 常见错误码
// 1000-1099: 认证相关错误
// 1100-1199: 房间相关错误
// 1200-1299: 状态同步相关错误
// 1300-1399: 权限相关错误

```

## **5. 网关服务 (Gateway) 设计**

网关服务是 RealSync 的大脑，使用 **Node.js + TypeScript** 实现。

### **4.1 核心职责**

- **连接管理**: 维护海量 WebSocket 长连接，处理心跳和重连。
- **认证授权**: 通过 JWT 验证客户端身份，并依据安全规则判断操作权限。
- **消息路由**: 反序列化 Protobuf 消息，根据消息类型调用相应的处理逻辑。
- **房间管理**: 处理房间的创建、查询、加入、离开等生命周期管理。
- **状态同步**: 与 Redis 交互，持久化房间状态，并通过 Pub/Sub 广播更新。
- **索引维护**: 实时维护各种房间索引，确保数据一致性和查询性能。
- **权威逻辑**: 执行服务器端的权威逻辑，如游戏计时器、胜负判断等。

#### **4.1.1 房间管理流程**

**房间创建流程**:
1. 验证客户端权限和参数合法性
2. 生成唯一的 `roomId`
3. 创建房间核心数据结构 (`room:state`, `room:members`, `room:metadata`)
4. 创建房间索引信息 (`room:info`)
5. 更新相关索引 (按状态、可见性、游戏模式分类)
6. 返回房间信息给客户端

**房间列表查询流程**:
1. 解析查询参数（过滤条件、分页、排序）
2. 根据过滤条件选择合适的Redis索引
3. 批量查询房间基本信息
4. 应用额外的过滤和排序逻辑
5. 构建分页响应

**房间状态变更流程**:
1. 执行状态变更逻辑
2. 更新房间基本信息 (`room:info`)
3. 更新相关索引（移动到新的状态分类）
4. 通过 Pub/Sub 广播变更事件
5. 通知房间内所有玩家

**数据一致性保障**:
- 使用 Redis 事务或 Lua 脚本确保多个操作的原子性
- 定期执行数据修复任务，清理孤立数据
- 实现优雅降级，在索引不一致时回退到全扫描

### **4.2 Redis 数据结构**

> 📚 **详细设计文档**: [Redis 数据结构设计文档](redis-data-structures.md) - 完整的数据存储架构、索引系统和性能优化策略

#### **5.2.1 房间核心数据 (Room Core Data)**

> **🔥 Redis 哈希标签**: `{roomId}` 是Redis Cluster哈希标签，确保同一房间所有数据存储在同一节点，支持原子性操作

- **房间状态**: `room:state:{roomId}` (HASH)
    - 存储一个房间内所有 Key-Value 状态。Key为状态名，Value为Protobuf `Value` 序列化后的二进制数据。
    - 哈希标签确保数据局部性：`room:state:{room123}`
- **房间成员**: `room:members:{roomId}` (SET)
    - 存储一个房间内所有 `PlayerId`（数字短ID，如 1, 2, 3）。
    - 与房间状态在同一节点：`room:members:{room123}`
- **房间元数据**: `room:metadata:{roomId}` (HASH)
    - 存储房间的详细元信息，如`ownerId`, `creationTime`, `maxPlayers`, `gameMode`等。
    - 哈希标签保证一致性：`room:metadata:{room123}`
- **玩家映射**: 
    - `room:openid_mapping:{roomId}` (HASH): OpenID → PlayerId 映射
    - `room:player_mapping:{roomId}` (HASH): PlayerId → OpenID 反向映射
    - `room:player_counter:{roomId}` (STRING): 房间内PlayerId计数器
    - 所有映射数据在同一节点：`room:openid_mapping:{room123}`
- **更新通道**: `room:channel:{roomId}` (Pub/Sub Channel)
    - 用于在服务器多实例之间广播状态更新事件。
    - 实例：`room:channel:{room123}`

#### **4.2.2 房间列表与索引 (Room Listing & Indexing)**

为了支持高效的房间列表查询和过滤，我们需要额外的索引数据结构：

- **房间基本信息**: `room:info:{roomId}` (HASH)
    - 存储用于列表显示的房间基本信息，避免每次查询都读取完整元数据
    - 字段: `name`, `status`, `visibility`, `playerCount`, `maxPlayers`, `gameMode`, `ownerId`, `createdAt`, `lastActivityAt`

- **按状态分类的房间列表**: 
    - `rooms:status:waiting` (ZSET) - 等待中的房间，按创建时间排序 (score = timestamp)
    - `rooms:status:playing` (ZSET) - 游戏中的房间，按创建时间排序
    - `rooms:status:finished` (ZSET) - 已结束的房间，按结束时间排序

- **按可见性分类的房间列表**:
    - `rooms:public:waiting` (ZSET) - 公开且等待中的房间，按创建时间排序
    - `rooms:public:playing` (ZSET) - 公开且游戏中的房间，按创建时间排序
    - `rooms:private` (SET) - 私有房间集合

- **全局房间索引**:
    - `rooms:all` (ZSET) - 所有活跃房间，按最后活动时间排序 (用于清理过期房间)
    - `rooms:by_owner:{playerId}` (SET) - 特定玩家创建的房间列表

- **游戏模式分类**:
    - `rooms:gamemode:{gameMode}:waiting` (ZSET) - 特定游戏模式的等待中房间
    - `rooms:gamemode:{gameMode}:playing` (ZSET) - 特定游戏模式的游戏中房间

#### **4.2.3 房间状态枚举**

```typescript
enum RoomStatus {
  WAITING = 'waiting',      // 等待玩家加入
  PLAYING = 'playing',      // 游戏进行中
  FINISHED = 'finished'     // 游戏已结束
}

enum RoomVisibility {
  PUBLIC = 'public',        // 公开房间，任何人可见可加入
  PRIVATE = 'private'       // 私有房间，需要邀请码
}
```

#### **4.2.4 数据一致性维护**

当房间状态发生变化时，需要同步更新所有相关的索引：

1. **房间创建时**:
   ```redis
   # 创建房间基本信息
   HSET room:info:{roomId} name "My Game" status "waiting" visibility "public" ...
   
   # 添加到相应的索引
   ZADD rooms:status:waiting {timestamp} {roomId}
   ZADD rooms:public:waiting {timestamp} {roomId}
   ZADD rooms:all {timestamp} {roomId}
   SADD rooms:by_owner:{ownerId} {roomId}
   ```

2. **房间状态变更时** (waiting → playing):
   ```redis
   # 更新房间信息
   HSET room:info:{roomId} status "playing" lastActivityAt {timestamp}
   
   # 移动到新的状态索引
   ZREM rooms:status:waiting {roomId}
   ZREM rooms:public:waiting {roomId}
   ZADD rooms:status:playing {timestamp} {roomId}
   ZADD rooms:public:playing {timestamp} {roomId}
   
   # 更新活跃时间
   ZADD rooms:all {timestamp} {roomId}
   ```

3. **玩家加入/离开时**:
   ```redis
   # 更新玩家数量和活跃时间
   HINCRBY room:info:{roomId} playerCount 1
   HSET room:info:{roomId} lastActivityAt {timestamp}
   ZADD rooms:all {timestamp} {roomId}
   ```

#### **4.2.5 查询示例**

- **获取公开的等待中房间列表** (支持分页):
  ```redis
  # 获取最新的10个等待中的公开房间
  ZREVRANGE rooms:public:waiting 0 9 WITHSCORES
  
  # 批量获取房间信息
  HMGET room:info:{roomId1} room:info:{roomId2} ... name status playerCount maxPlayers
  ```

- **按游戏模式过滤**:
  ```redis
  # 获取特定游戏模式的等待中房间
  ZREVRANGE rooms:gamemode:battle:waiting 0 19 WITHSCORES
  ```

- **搜索玩家创建的房间**:
  ```redis
  # 获取玩家创建的所有房间
  SMEMBERS rooms:by_owner:{playerId}
  ```

#### **4.2.6 性能优化考虑**

1. **TTL策略**: 为已结束的房间设置过期时间，自动清理
2. **Pipeline操作**: 批量更新多个索引时使用Redis Pipeline减少网络往返
3. **Lua脚本**: 对于复杂的原子操作，使用Lua脚本确保一致性
4. **缓存策略**: 热门房间列表可以设置短TTL的缓存

### **4.3 安全规则引擎**

- **规则定义 (JSON)**:
    
    ```
    {
      "rules": {
        "/rooms/{roomId}/state/score": {
          "read": "true", // 任何人都可以读取分数
          "write": "auth.uid === getRoomData(roomId).ownerId" // 只有房主能修改分数
        },
        "/rooms/{roomId}/state/position_*": { // 使用通配符
          "write": "auth.uid === path.wildcards[0]" // 只有玩家自己能修改自己的位置
        }
      }
    }
    
    ```
    
- **执行流程**:
    1. 收到 `UpdateStateRequest` 请求。
    2. 遍历 `state_patches` 中的每一个 key (如 `position_player123`)。
    3. 构建逻辑路径 `/rooms/my-room/state/position_player123`。
    4. 匹配规则库，找到 `"/rooms/{roomId}/state/position_*"` 规则。
    5. 提取通配符 `wildcards[0]` 的值为 `"player123"`。
    6. 评估 `"write"` 条件: `auth.uid` (从JWT获得) 是否等于 `"player123"`。
    7. 若通过，则执行Redis操作；否则，返回错误。

## **5. SDK 设计**

SDK 的核心是提供一套简洁、易用、符合目标语言习惯的API。

### **5.0 API 文档概述**

本章节提供 RealSync SDK 的设计概述。完整的 API 参考文档请查看：

📚 **[SDK API 参考文档](sdk-api-reference.md)**

**文档特性:**
- **TypeScript SDK**: 完整的 API 参考，包含类型定义、方法说明、错误处理和完整示例
- **C# SDK**: 预览版 API 设计，正在开发中
- **实用示例**: 游戏大厅、房间管理、状态同步等完整代码示例
- **错误处理**: 详细的错误码定义和处理最佳实践

**主要功能:**
- 🏠 **房间管理**: 创建、查询、加入、离开房间
- 🔄 **状态同步**: 实时状态更新和广播
- 🔐 **安全控制**: JWT认证和权限管理
- 📱 **多平台支持**: Web浏览器、Unity、Node.js等
- 🔧 **开发友好**: 完整的TypeScript类型支持和错误处理

### **5.1 TypeScript SDK (`sdk-ts`)**

#### **设计理念**

TypeScript SDK 的设计遵循现代 JavaScript 生态系统的最佳实践，提供类型安全、异步优先的 API 体验。

**核心特性:**
- **类型安全**: 完整的 TypeScript 类型定义，编译时错误检查
- **现代 API**: Promise/async-await 模式，符合现代 JavaScript 习惯
- **事件驱动**: 基于 EventEmitter 的实时事件系统
- **多环境支持**: 浏览器、Node.js、Electron 等多平台兼容

#### **基本用法示例**
    
```typescript
import { RealSyncClient, RoomStatus } from 'realsync-sdk';
    
// 初始化客户端
    const client = new RealSyncClient({
  apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j', // 纯客户端开发，API密钥可安全暴露
  tokenProvider: async () => await getAuthToken()
});

// 连接并获取房间列表
await client.connectAsync();
const roomList = await client.getRoomList({
  statusFilter: RoomStatus.WAITING,
  page: 1,
  pageSize: 20
});

// 创建房间 - 简化API，自动类型推断
const newRoom = await client.createRoom({
  name: 'Epic Battle',
  gameMode: 'battle',
  maxPlayers: 4,
  visibility: RoomVisibility.PUBLIC,
  initialState: {
    countdown: 60,                           // number
    gamePhase: 'waiting',                    // string
    allowSpectators: true,                   // boolean
    playerList: [],                          // array
    gameConfig: {                            // object
      mapSize: 'large',
      difficulty: 'normal',
      rules: ['no-camping', 'friendly-fire']
    }
  }
});
    
// 加入房间并监听状态变化
const room = await client.joinRoom('room-123');
room.on('stateChange', (patches, sourcePlayerId) => {
  // patches 现在是简化格式：{ key: value }
  console.log('State updated:', patches);
  
  if ('playerPositions' in patches) {
    updatePlayerPositions(patches.playerPositions); // 自动推断为数组
  }
  
  if ('gameConfig' in patches) {
    updateGameSettings(patches.gameConfig); // 自动推断为对象
  }
});

// 分段式API - 直观的状态操作
await room.state.set(`player_${client.playerId}_position`, { x: 100, y: 200 });
await room.state.set(`player_${client.playerId}_health`, 85);
await room.state.set(`player_${client.playerId}_inventory`, ['sword', 'potion', 'shield']);
await room.state.set('lastAction', `${client.playerId} moved to (100, 200)`);

// 批量操作支持
await room.state.batch()
  .set('gamePhase', 'combat')
  .set('roundTimer', 60)
  .set(`player_${client.playerId}_ready`, true)
  .commit();

// 便利的玩家操作API
await room.player(client.playerId).set('health', 85);
await room.player(client.playerId).set('position', { x: 100, y: 200 });
    
// 状态读取
const playerHealth = room.state.get(`player_${client.playerId}_health`);
const gamePhase = room.state.get('gamePhase');
```

#### **网络智能优化策略**

为了平衡分段式API的易用性和网络效率，SDK内部实现了多层次的智能优化：

**1. 自动批量合并**
```typescript
// 开发者的代码 - 看起来是多次网络请求
room.state.set('playerHealth', 85);
room.state.set('playerPosition', { x: 100, y: 200 });
room.state.set('gamePhase', 'combat');

// SDK内部 - 自动合并为一次网络请求
// 在下一个事件循环中发送: { playerHealth: 85, playerPosition: {...}, gamePhase: 'combat' }
```

**2. 智能合并策略**
- **时间窗口合并**: 16ms内的多个操作自动合并（约等于一帧时间）
- **同key覆盖**: 同一key的多次设置只保留最新值
- **冲突检测**: 检测并解决潜在的状态冲突

**3. 优化触发机制**
- **requestAnimationFrame**: 浏览器环境中对齐渲染帧
- **process.nextTick**: Node.js环境中的微任务优化
- **手动flush**: 提供立即发送的控制选项

**4. 网络层优化**
- **压缩算法**: 对批量数据进行压缩传输
- **增量更新**: 只传输变化的部分
- **连接复用**: WebSocket连接的高效复用

这种设计让开发者享受分段式API的直观体验，同时保证网络传输的高效性。

#### **技术规格**

- **目标版本**: ES2018+, TypeScript 4.0+
- **打包格式**: ESM, CommonJS, UMD/IIFE
- **体积优化**: 支持 Tree-shaking，最小化打包体积
- **兼容性**: 现代浏览器、Node.js 14+
- **网络优化**: 自动批量合并，智能冲突解决

> 📚 **详细API参考**: [TypeScript SDK API 文档](sdk-api-reference.md#typescript-sdk)

### **5.2 C# SDK (`sdk-csharp`)**

#### **设计理念**

C# SDK 专为 Unity 游戏引擎优化，提供与 Unity 开发流程深度集成的多人游戏解决方案。

**核心特性:**
- **Unity优化**: 针对Unity引擎的特殊需求进行优化
- **主线程安全**: 自动处理跨线程调用，确保UI更新在主线程执行
- **Inspector集成**: 重要配置可在Unity Inspector中直接设置
- **生命周期管理**: 与Unity MonoBehaviour生命周期完美集成

#### **开发状态**

> 🚧 **开发中** - C# SDK 目前处于开发阶段，预计2024年Q1发布

**已完成特性:**
- ✅ 核心架构设计
- ✅ Unity主线程调度器
- ✅ Protobuf集成方案
- ✅ 基础API设计

**开发中特性:**
- 🔄 完整的API实现
- 🔄 Unity Package Manager支持
- 🔄 示例项目和教程
- 🔄 性能优化和测试

#### **预览API**

```csharp
// 基本用法预览 - 分段式API设计
var client = new RealSyncClient(new ClientOptions {
    ApiKey = "ak_1a2b3c4d5e6f7g8h9i0j", // 纯客户端开发，API密钥可安全暴露
    TokenProvider = () => Task.FromResult(GetAuthToken())
});

await client.ConnectAsync();

// 创建房间 - 简化API，支持C#对象
var newRoom = await client.CreateRoomAsync(new CreateRoomOptions {
    Name = "Epic Battle",
    GameMode = "battle", 
    MaxPlayers = 4,
    Visibility = RoomVisibility.Public,
    InitialState = new {
        countdown = 60,                          // int
        gamePhase = "waiting",                   // string
        allowSpectators = true,                  // bool
        playerList = new string[0],              // array
        gameConfig = new {                       // object
            mapSize = "large",
            difficulty = "normal",
            rules = new[] { "no-camping", "friendly-fire" }
        }
    }
            });
    
var room = await client.JoinRoomAsync("room-123");
    
// Unity友好的事件监听 - 简化的数据格式
            room.OnStateChange += (patches, sourcePlayerId) => {
    // patches 现在是 Dictionary<string, object>
    Debug.Log($"State updated by {sourcePlayerId}");
    
    if (patches.ContainsKey("playerPositions")) {
        var positions = patches["playerPositions"] as object[];  // 数组
        UpdatePlayerPositions(positions);
    }
    
    if (patches.ContainsKey("gameConfig")) {
        var config = patches["gameConfig"] as Dictionary<string, object>;  // 对象
        UpdateGameSettings(config);
    }
    
    // 自动在Unity主线程中执行
    UnityMainThreadDispatcher.Enqueue(() => {
        UpdateGameUI(patches);
    });
};

// 分段式API - 直观的状态操作（自动批量优化）
await room.State.SetAsync($"player_{client.PlayerId}_position", new { x = 100, y = 200 });
await room.State.SetAsync($"player_{client.PlayerId}_health", 85);
await room.State.SetAsync($"player_{client.PlayerId}_inventory", new[] { "sword", "potion", "shield" });
await room.State.SetAsync("lastAction", $"{client.PlayerId} moved to (100, 200)");

// 批量操作支持
await room.State.Batch()
    .Set("gamePhase", "combat")
    .Set("roundTimer", 60)
    .Set($"player_{client.PlayerId}_ready", true)
    .CommitAsync();

// 便利的玩家操作API
await room.Player(client.PlayerId).SetAsync("health", 85);
await room.Player(client.PlayerId).SetAsync("position", new { x = 100, y = 200 });

// 状态读取 - 支持泛型类型转换
var playerHealth = room.State.Get<int>($"player_{client.PlayerId}_health");
var gamePhase = room.State.Get<string>("gamePhase");
var playerPos = room.State.Get<Vector2>($"player_{client.PlayerId}_position");
```

#### **技术规格**

- **目标框架**: .NET Standard 2.1
- **Unity版本**: Unity 2020.3 LTS+
- **集成方式**: Unity Package Manager, 手动Assets文件夹
- **兼容性**: Windows, macOS, Linux, Mobile, WebGL

> 📚 **API 预览**: [C# SDK API 文档](sdk-api-reference.md#c-sdk)  
> 📧 **反馈通道**: 如需提前体验或提供反馈，请联系开发团队

## **6. 开发与部署**

### **6.1 开发工作流概述**

RealSync 采用现代化的开发和部署流程，确保高质量的代码交付和稳定的服务运行。

**相关文档:**
- 📚 [SDK API 参考文档](sdk-api-reference.md) - 完整的SDK使用指南
- 📋 [项目管理文档](../project-manager/todo.md) - 开发进度和任务管理

### **6.2 代码生成工作流**

在 Monorepo 根目录提供一个脚本，一键为所有目标语言生成最新的协议代码。

- `package.json` 中的脚本:
    
    ```json
    "scripts": {
      "generate": "turbo run generate",
      "generate:proto": "protoc --ts_out=packages/sdk-ts/src --csharp_out=packages/sdk-csharp/src packages/protocol/*.proto",
      "dev": "turbo run dev",
      "build": "turbo run build",
      "test": "turbo run test"
    }
    ```
    
- 每个SDK和服务器的 `package.json` 中定义自己的 `generate` 脚本，调用 `protoc`。

### **6.3 部署**

- **Gateway**: 使用 Docker 将 Node.js 应用容器化。
- **部署平台**: 可部署在任何支持容器的云平台上，如 Google Cloud Run, AWS Fargate, Kubernetes 等。配合负载均衡器可以实现水平扩展。
- **Redis**: 使用云服务商提供的托管 Redis 集群服务，如阿里云、Google Memorystore, AWS ElastiCache for Redis。

### **6.4 文档维护**

本项目维护了完整的技术文档体系：

- **[架构设计文档](architecture.md)** - 系统整体架构和设计理念
- **[Protobuf 协议设计](protocol-design.md)** - 详细的协议定义和版本演进策略
- **[Redis 数据结构设计](redis-data-structures.md)** - 数据存储架构和性能优化
- **[SDK API 参考](sdk-api-reference.md)** - 完整的客户端SDK使用指南
- **[项目管理](../project-manager/todo.md)** - 开发进度和任务跟踪

文档更新遵循代码变更同步的原则，确保文档与实现的一致性。

## **7. 网关抽象层设计**

### **7.1 设计理念**

为了支持未来的架构演进（如独立状态服务、云函数托管等），RealSync网关采用**多层抽象架构**，将业务逻辑与具体的存储和计算实现解耦。

**核心原则:**
- **业务分离**: 房间管理与游戏局状态同步完全解耦
- **存储抽象**: 支持多种后端存储方案的热插拔
- **计算抽象**: 支持本地逻辑、云函数、边缘计算等多种执行环境
- **协议统一**: 对外API保持一致，内部实现可灵活替换

### **7.2 抽象层架构**

```typescript
┌─────────────────────────────────────────────────────────────┐
│                        Gateway API Layer                    │
├─────────────────────────────────────────────────────────────┤
│                     Business Logic Layer                    │
├─────────────────┬───────────────────┬─────────────────────────┤
│   Room Service  │  Game Session     │   Cloud Function       │
│   (房间管理)     │  (游戏局状态)      │   (云函数托管)           │
├─────────────────┼───────────────────┼─────────────────────────┤
│                 │  Storage Adapter  │   Compute Adapter       │
├─────────────────┼───────────────────┼─────────────────────────┤
│   Redis Cluster │  Redis / Custom   │   Local / Serverless    │
│   (房间索引)     │  (状态存储)        │   (执行环境)            │
└─────────────────┴───────────────────┴─────────────────────────┘
```

### **7.3 核心抽象接口**

#### **存储抽象 (Storage Adapter)**

```typescript
// 存储适配器基础接口
interface IStorageAdapter {
  // 基础操作
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  
  // 批量操作
  mget(keys: string[]): Promise<any[]>;
  mset(keyValues: Record<string, any>): Promise<void>;
  
  // 事务支持
  transaction(): ITransaction;
  
  // 发布订阅
  publish(channel: string, message: any): Promise<void>;
  subscribe(channel: string, handler: (message: any) => void): Promise<void>;
}

// 事务接口
interface ITransaction {
  get(key: string): ITransaction;
  set(key: string, value: any): ITransaction;
  delete(key: string): ITransaction;
  exec(): Promise<any[]>;
  discard(): Promise<void>;
}

// Redis适配器实现
class RedisStorageAdapter implements IStorageAdapter {
  constructor(private redis: Redis.Cluster) {}
  
  async get(key: string): Promise<any> {
    return await this.redis.get(key);
  }
  
  async set(key: string, value: any): Promise<void> {
    await this.redis.set(key, JSON.stringify(value));
  }
  
  transaction(): ITransaction {
    return new RedisTransaction(this.redis.multi());
  }
  
  async publish(channel: string, message: any): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }
  
  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe(channel);
    subscriber.on('message', (ch, msg) => {
      if (ch === channel) {
        handler(JSON.parse(msg));
      }
    });
  }
}

// 自定义状态服务适配器（未来扩展）
class CustomStateServiceAdapter implements IStorageAdapter {
  constructor(private stateService: IStateService) {}
  
  async get(key: string): Promise<any> {
    return await this.stateService.getState(key);
  }
  
  async set(key: string, value: any): Promise<void> {
    await this.stateService.setState(key, value);
  }
  
  transaction(): ITransaction {
    return new StateServiceTransaction(this.stateService);
  }
  
  async publish(channel: string, message: any): Promise<void> {
    await this.stateService.broadcast(channel, message);
  }
  
  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    await this.stateService.subscribe(channel, handler);
  }
}
```

#### **计算抽象 (Compute Adapter)**

```typescript
// 计算适配器接口
interface IComputeAdapter {
  // 执行自定义逻辑
  execute(functionName: string, context: ExecutionContext, args: any): Promise<any>;
  
  // 批量执行
  executeBatch(operations: ComputeOperation[]): Promise<any[]>;
  
  // 注册函数
  register(functionName: string, handler: ComputeFunction): Promise<void>;
}

// 执行上下文
interface ExecutionContext {
  appId: string;
  roomId: string;
  playerId: number;
  openId: string;
  timestamp: number;
  storage: IStorageAdapter;
}

// 计算操作
interface ComputeOperation {
  functionName: string;
  context: ExecutionContext;
  args: any;
}

// 计算函数类型
type ComputeFunction = (context: ExecutionContext, args: any) => Promise<any>;

// 本地计算适配器
class LocalComputeAdapter implements IComputeAdapter {
  private functions = new Map<string, ComputeFunction>();
  
  async execute(functionName: string, context: ExecutionContext, args: any): Promise<any> {
    const fn = this.functions.get(functionName);
    if (!fn) throw new Error(`Function ${functionName} not found`);
    
    return await fn(context, args);
  }
  
  async register(functionName: string, handler: ComputeFunction): Promise<void> {
    this.functions.set(functionName, handler);
  }
  
  async executeBatch(operations: ComputeOperation[]): Promise<any[]> {
    return await Promise.all(
      operations.map(op => this.execute(op.functionName, op.context, op.args))
    );
  }
}

// 云函数适配器（未来扩展）
class CloudFunctionAdapter implements IComputeAdapter {
  constructor(private cloudProvider: ICloudProvider) {}
  
  async execute(functionName: string, context: ExecutionContext, args: any): Promise<any> {
    return await this.cloudProvider.invoke(functionName, { context, args });
  }
  
  async register(functionName: string, handler: ComputeFunction): Promise<void> {
    // 将函数部署到云端
    await this.cloudProvider.deploy(functionName, handler);
  }
  
  async executeBatch(operations: ComputeOperation[]): Promise<any[]> {
    // 云端批量执行，可能会有更好的性能
    return await this.cloudProvider.invokeBatch(operations);
  }
}
```

#### **业务服务抽象**

```typescript
// 房间服务接口
interface IRoomService {
  // 房间管理
  createRoom(appId: string, options: CreateRoomOptions): Promise<RoomInfo>;
  getRoomList(appId: string, options: GetRoomListOptions): Promise<GetRoomListResult>;
  joinRoom(appId: string, roomId: string, openId: string): Promise<JoinRoomResult>;
  leaveRoom(appId: string, roomId: string, playerId: number): Promise<void>;
  
  // 房间状态管理
  updateRoomStatus(appId: string, roomId: string, status: RoomStatus): Promise<void>;
  getRoomInfo(appId: string, roomId: string): Promise<RoomInfo>;
}

// 游戏局服务接口
interface IGameSessionService {
  // 状态同步
  updateState(appId: string, roomId: string, playerId: number, patches: StatePatches): Promise<void>;
  getState(appId: string, roomId: string): Promise<GameState>;
  subscribeStateChanges(appId: string, roomId: string, handler: StateChangeHandler): Promise<void>;
  
  // 玩家管理
  getPlayers(appId: string, roomId: string): Promise<PlayerInfo[]>;
  getPlayerState(appId: string, roomId: string, playerId: number): Promise<GameState>;
  
  // 自定义逻辑执行
  executeGameLogic(appId: string, roomId: string, functionName: string, args: any): Promise<any>;
}

// 云函数服务接口
interface ICloudFunctionService {
  // 函数调用
  invoke(appId: string, functionName: string, context: ExecutionContext, args: any): Promise<any>;
  
  // 函数管理
  deploy(appId: string, functionName: string, code: string): Promise<void>;
  delete(appId: string, functionName: string): Promise<void>;
  list(appId: string): Promise<string[]>;
}
```

### **7.4 服务实现**

#### **房间服务实现**

```typescript
class RoomService implements IRoomService {
  constructor(
    private storage: IStorageAdapter,
    private compute: IComputeAdapter
  ) {}
  
  async createRoom(appId: string, options: CreateRoomOptions): Promise<RoomInfo> {
    const roomId = generateRoomId();
    const roomInfo: RoomInfo = {
      roomId,
      name: options.name,
      status: RoomStatus.WAITING,
      visibility: options.visibility,
      playerCount: 0,
      maxPlayers: options.maxPlayers,
      gameMode: options.gameMode,
      ownerId: '', // 从context获取
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    
    // 使用事务确保原子性
    const tx = this.storage.transaction();
    
    // 存储房间信息
    tx.set(`app:${appId}:room:info:{${appId}:${roomId}}`, roomInfo);
    
    // 更新索引
    tx.set(`app:${appId}:rooms:status:waiting`, roomId);
    tx.set(`app:${appId}:rooms:public:waiting`, roomId);
    tx.set(`app:${appId}:rooms:gamemode:${options.gameMode}:waiting`, roomId);
    
    await tx.exec();
    
    return roomInfo;
  }
  
  async getRoomList(appId: string, options: GetRoomListOptions): Promise<GetRoomListResult> {
    // 根据查询条件选择合适的索引
    const indexKey = this.buildIndexKey(appId, options);
    const roomIds = await this.storage.get(indexKey);
    
    // 批量获取房间信息
    const roomInfoKeys = roomIds.map(id => `app:${appId}:room:info:{${appId}:${id}}`);
    const roomInfos = await this.storage.mget(roomInfoKeys);
    
    return {
      rooms: roomInfos.filter(Boolean),
      pagination: this.buildPagination(roomInfos.length, options)
    };
  }
  
  private buildIndexKey(appId: string, options: GetRoomListOptions): string {
    // 索引选择逻辑
    if (options.statusFilter && options.visibilityFilter) {
      return `app:${appId}:rooms:${options.visibilityFilter}:${options.statusFilter}`;
    }
    if (options.statusFilter) {
      return `app:${appId}:rooms:status:${options.statusFilter}`;
    }
    return `app:${appId}:rooms:all`;
  }
}
```

#### **游戏局服务实现**

```typescript
class GameSessionService implements IGameSessionService {
  constructor(
    private storage: IStorageAdapter,
    private compute: IComputeAdapter
  ) {}
  
  async updateState(appId: string, roomId: string, playerId: number, patches: StatePatches): Promise<void> {
    const stateKey = `app:${appId}:room:state:{${appId}:${roomId}}`;
    const channelKey = `app:${appId}:room:channel:{${appId}:${roomId}}`;
    
    // 使用事务更新状态
    const tx = this.storage.transaction();
    
    for (const [key, value] of Object.entries(patches)) {
      tx.set(`${stateKey}:${key}`, value);
    }
    
    await tx.exec();
    
    // 广播状态变化
    await this.storage.publish(channelKey, {
      type: 'stateChange',
      playerId,
      patches,
      timestamp: Date.now()
    });
  }
  
  async executeGameLogic(appId: string, roomId: string, functionName: string, args: any): Promise<any> {
    // 构建执行上下文
    const context: ExecutionContext = {
      appId,
      roomId,
      playerId: args.playerId,
      openId: args.openId,
      timestamp: Date.now(),
      storage: this.storage
    };
    
    // 执行自定义逻辑
    return await this.compute.execute(functionName, context, args);
  }
  
  async subscribeStateChanges(appId: string, roomId: string, handler: StateChangeHandler): Promise<void> {
    const channelKey = `app:${appId}:room:channel:{${appId}:${roomId}}`;
    await this.storage.subscribe(channelKey, handler);
  }
}
```

### **7.5 配置和依赖注入**

```typescript
// 配置接口
interface GatewayConfig {
  storage: {
    type: 'redis' | 'custom-state-service';
    options: any;
  };
  compute: {
    type: 'local' | 'cloud-function';
    options: any;
  };
  services: {
    roomService: {
      enabled: boolean;
      adapter: string;
    };
    gameSessionService: {
      enabled: boolean;
      adapter: string;
    };
    cloudFunctionService: {
      enabled: boolean;
      adapter: string;
    };
  };
}

// 服务容器
class ServiceContainer {
  private storage: IStorageAdapter;
  private compute: IComputeAdapter;
  private roomService: IRoomService;
  private gameSessionService: IGameSessionService;
  private cloudFunctionService: ICloudFunctionService;
  
  constructor(private config: GatewayConfig) {
    this.initializeAdapters();
    this.initializeServices();
  }
  
  private initializeAdapters(): void {
    // 存储适配器工厂
    switch (this.config.storage.type) {
      case 'redis':
        this.storage = new RedisStorageAdapter(
          new Redis.Cluster(this.config.storage.options)
        );
        break;
      case 'custom-state-service':
        this.storage = new CustomStateServiceAdapter(
          new StateService(this.config.storage.options)
        );
        break;
      default:
        throw new Error(`Unsupported storage type: ${this.config.storage.type}`);
    }
    
    // 计算适配器工厂
    switch (this.config.compute.type) {
      case 'local':
        this.compute = new LocalComputeAdapter();
        break;
      case 'cloud-function':
        this.compute = new CloudFunctionAdapter(
          new CloudProvider(this.config.compute.options)
        );
        break;
      default:
        throw new Error(`Unsupported compute type: ${this.config.compute.type}`);
    }
  }
  
  private initializeServices(): void {
    if (this.config.services.roomService.enabled) {
      this.roomService = new RoomService(this.storage, this.compute);
    }
    
    if (this.config.services.gameSessionService.enabled) {
      this.gameSessionService = new GameSessionService(this.storage, this.compute);
    }
    
    if (this.config.services.cloudFunctionService.enabled) {
      this.cloudFunctionService = new CloudFunctionService(this.compute);
    }
  }
  
  // 获取服务实例
  getRoomService(): IRoomService { return this.roomService; }
  getGameSessionService(): IGameSessionService { return this.gameSessionService; }
  getCloudFunctionService(): ICloudFunctionService { return this.cloudFunctionService; }
}
```

### **7.6 未来扩展场景**

#### **场景1: 独立状态服务**

```typescript
// 配置切换到独立状态服务
const config: GatewayConfig = {
  storage: {
    type: 'custom-state-service',
    options: {
      endpoint: 'https://state-service.realsync.io',
      apiKey: 'state-service-key'
    }
  },
  compute: {
    type: 'local',
    options: {}
  },
  services: {
    roomService: { enabled: true, adapter: 'redis' }, // 房间管理仍用Redis
    gameSessionService: { enabled: true, adapter: 'custom' }, // 游戏局用独立服务
    cloudFunctionService: { enabled: false, adapter: 'none' }
  }
};
```

#### **场景2: 云函数托管**

```typescript
// 配置支持云函数
const config: GatewayConfig = {
  storage: {
    type: 'redis',
    options: { /* redis config */ }
  },
  compute: {
    type: 'cloud-function',
    options: {
      provider: 'aws-lambda',
      region: 'us-west-2',
      credentials: { /* AWS credentials */ }
    }
  },
  services: {
    roomService: { enabled: true, adapter: 'redis' },
    gameSessionService: { enabled: true, adapter: 'redis' },
    cloudFunctionService: { enabled: true, adapter: 'aws' } // 启用云函数
  }
};

// 客户端可以执行云函数
const result = await client.executeCloudFunction('calculateDamage', {
  attackerId: 1,
  targetId: 2,
  weaponType: 'sword',
  criticalChance: 0.15
});
```

### **7.7 优势总结**

**架构优势:**
- **🔧 灵活性**: 可以独立替换存储、计算组件
- **📈 可扩展性**: 支持水平扩展和垂直扩展
- **🎯 业务专注**: 清晰的业务边界和职责分离
- **🔄 热切换**: 支持运行时配置变更

**技术优势:**
- **接口统一**: 对外API保持稳定
- **实现多样**: 内部可以使用不同技术栈
- **性能优化**: 针对不同场景选择最佳方案
- **成本控制**: 根据业务需求选择合适的基础设施

这种抽象层设计确保了RealSync在支持当前Redis架构的同时，为未来的技术演进提供了充分的灵活性。
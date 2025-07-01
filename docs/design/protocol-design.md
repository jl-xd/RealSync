# RealSync 协议设计文档

版本: 1.0  
更新时间: 2024-01-01

## 📋 目录

- [协议概览](#协议概览)
- [设计原则](#设计原则)  
- [核心数据类型](#核心数据类型)
- [消息定义](#消息定义)
- [房间管理协议](#房间管理协议)
- [状态同步协议](#状态同步协议)
- [错误处理协议](#错误处理协议)
- [扩展性设计](#扩展性设计)
- [版本演进策略](#版本演进策略)

---

## 协议概览

RealSync 使用 **Protocol Buffers (Protobuf) 3** 作为通信协议的定义语言，确保跨语言的类型安全和高效序列化。

### 协议特点

- **类型安全**: 强类型定义，编译时错误检查
- **向后兼容**: 支持协议演进而不破坏现有客户端
- **高效编码**: 二进制序列化，减少网络传输开销
- **跨语言**: 自动生成多语言SDK代码
- **可扩展**: 预留扩展字段，支持功能迭代

### 架构层次

```
┌─────────────────────────────────────────┐
│           Application Layer             │
│        (Game Logic & UI)                │
├─────────────────────────────────────────┤
│             SDK Layer                   │
│     (TypeScript/C# Auto-generated)     │
├─────────────────────────────────────────┤
│          Protocol Layer                 │
│         (Protobuf Messages)             │
├─────────────────────────────────────────┤
│         Transport Layer                 │
│       (WebSocket + Binary)              │
└─────────────────────────────────────────┘
```

---

## 设计原则

### 1. **简洁性原则**
- 尽量使用最简单的数据结构表达复杂语义
- 避免冗余字段和嵌套过深的结构
- 提供合理的默认值

### 2. **扩展性原则**
- 使用 `oneof` 支持多种消息类型
- 预留字段编号范围用于未来扩展
- 采用可选字段(`optional`)支持渐进式功能

### 3. **一致性原则**
- 统一的命名规范 (snake_case)
- 一致的错误处理模式
- 统一的时间戳格式 (Unix timestamp)

### 4. **性能原则**
- 避免过大的消息体
- 支持增量更新而非全量同步
- 合理使用字段类型 (int32 vs int64)

---

## 核心数据类型

### Value 类型系统

RealSync 设计了一套灵活的值类型系统，支持游戏中常见的所有数据类型：

```protobuf
// 通用值类型 - 支持所有游戏数据
message Value {
    oneof value {
        string string_value = 1;      // 字符串: 玩家名称、游戏状态等
        double number_value = 2;      // 数字: 分数、位置坐标、血量等
        bool bool_value = 3;          // 布尔: 游戏设置、玩家状态等
        ArrayValue array_value = 4;   // 数组: 玩家列表、物品清单等
        ObjectValue object_value = 5; // 对象: 复杂配置、嵌套数据等
    }
}

// 数组值 - 支持任意类型元素
message ArrayValue {
    repeated Value items = 1;
}

// 对象值 - 支持嵌套结构
message ObjectValue {
    map<string, Value> fields = 1;
}
```

### 设计理念

**为什么不直接使用JSON？**
- **类型安全**: Protobuf在编译时就能发现类型错误
- **性能优势**: 二进制编码比JSON文本更高效
- **Schema演进**: 支持字段增删而不破坏兼容性
- **跨语言**: 自动生成强类型的SDK代码

**为什么使用 `oneof` 而不是多个可选字段？**
- **内存效率**: 只存储实际使用的类型
- **类型明确**: 避免同时设置多个值的歧义
- **解析高效**: 减少条件判断的开销

### 类型推断与转换

SDK会自动处理类型推断，让开发者可以直接使用原生类型：

```typescript
// 开发者代码 - 直接使用原生类型
await room.state.set('playerHealth', 85);                    // number
await room.state.set('playerName', 'Alice');                 // string
await room.state.set('isReady', true);                       // boolean
await room.state.set('inventory', ['sword', 'potion']);      // array
await room.state.set('position', { x: 100, y: 200 });       // object

// SDK内部转换 - 自动转换为Protobuf格式
{
  playerHealth: { number_value: 85 },
  playerName: { string_value: 'Alice' },
  isReady: { bool_value: true },
  inventory: { 
    array_value: { 
      items: [
        { string_value: 'sword' },
        { string_value: 'potion' }
      ]
    }
  },
  position: {
    object_value: {
      fields: {
        x: { number_value: 100 },
        y: { number_value: 200 }
      }
    }
  }
}
```

---

## 消息定义

### 消息封装架构

采用顶层消息封装模式，所有通信都通过两个根消息类型：

```protobuf
// 客户端 → 服务器
message ClientPacket {
  oneof message {
    // 房间管理类
    GetRoomListRequest get_room_list_request = 1;
    CreateRoomRequest create_room_request = 2;
    JoinRoomRequest join_room_request = 3;
    LeaveRoomRequest leave_room_request = 4;
    
    // 状态同步类
    UpdateStateRequest update_state_request = 5;
    
    // 预留扩展空间 (6-10)
    // SendMessageRequest send_message_request = 6;
    // SpectateRoomRequest spectate_room_request = 7;
    // ReportPlayerRequest report_player_request = 8;
  }
}

// 服务器 → 客户端  
message ServerPacket {
  oneof message {
    // 请求响应类
    GetRoomListResponse get_room_list_response = 1;
    CreateRoomResponse create_room_response = 2;
    JoinRoomResponse join_room_response = 3;
    LeaveRoomResponse leave_room_response = 4;
    
    // 事件广播类
    StateUpdateBroadcast state_update_broadcast = 5;
    PlayerJoinedBroadcast player_joined_broadcast = 6;
    PlayerLeftBroadcast player_left_broadcast = 7;
    
    // 错误处理
    ErrorResponse error_response = 8;
    
    // 预留扩展空间 (9-15)
    // MessageBroadcast message_broadcast = 9;
    // PlayerKickedBroadcast player_kicked_broadcast = 10;
  }
}
```

### 消息分类

| 消息类型 | 用途 | 特点 |
|---------|------|------|
| **Request/Response** | 客户端请求，服务器响应 | 一对一，有状态 |
| **Broadcast** | 服务器主动推送 | 一对多，事件驱动 |
| **Error** | 错误通知 | 统一错误处理 |

---

## 房间管理协议

### 房间信息结构

```protobuf
// 房间状态枚举
enum RoomStatus {
  ROOM_STATUS_UNSPECIFIED = 0;  // 避免零值歧义
  ROOM_STATUS_WAITING = 1;      // 等待玩家加入
  ROOM_STATUS_PLAYING = 2;      // 游戏进行中  
  ROOM_STATUS_FINISHED = 3;     // 游戏已结束
}

// 房间可见性枚举
enum RoomVisibility {
  ROOM_VISIBILITY_UNSPECIFIED = 0; // 避免零值歧义
  ROOM_VISIBILITY_PUBLIC = 1;       // 公开房间
  ROOM_VISIBILITY_PRIVATE = 2;      // 私有房间
}

// 房间基本信息
message RoomInfo {
  string room_id = 1;              // 全局唯一的房间ID
  string name = 2;                 // 房间显示名称
  RoomStatus status = 3;           // 房间当前状态
  RoomVisibility visibility = 4;   // 房间可见性
  int32 player_count = 5;          // 当前玩家数量
  int32 max_players = 6;           // 最大玩家数量
  string game_mode = 7;            // 游戏模式标识
  string owner_id = 8;             // 房主玩家ID
  int64 created_at = 9;            // 创建时间 (Unix时间戳)
  int64 last_activity_at = 10;     // 最后活动时间
  
  // 可选的扩展信息
  optional string description = 11; // 房间描述
  optional string region = 12;      // 地理区域
  optional int32 ping = 13;         // 估算延迟(ms)
}

// 分页信息
message PaginationInfo {
  int32 page = 1;                  // 当前页码 (从1开始)
  int32 page_size = 2;             // 每页大小
  int32 total_count = 3;           // 总记录数
  bool has_next_page = 4;          // 是否有下一页
  bool has_prev_page = 5;          // 是否有上一页
}
```

### 房间管理请求

#### 获取房间列表

```protobuf
message GetRoomListRequest {
  // 过滤条件
  optional RoomStatus status_filter = 1;      // 按状态过滤
  optional RoomVisibility visibility_filter = 2; // 按可见性过滤  
  optional string game_mode_filter = 3;       // 按游戏模式过滤
  optional string region_filter = 4;          // 按地理区域过滤
  
  // 分页参数
  int32 page = 5;                            // 页码，默认1
  int32 page_size = 6;                       // 每页大小，默认20，最大100
  
  // 排序选项
  enum SortBy {
    SORT_BY_UNSPECIFIED = 0;
    SORT_BY_CREATED_AT = 1;         // 按创建时间排序
    SORT_BY_LAST_ACTIVITY = 2;      // 按最后活动时间排序
    SORT_BY_PLAYER_COUNT = 3;       // 按玩家数量排序
    SORT_BY_NAME = 4;               // 按房间名称排序
  }
  SortBy sort_by = 7;               // 排序字段
  bool sort_descending = 8;         // 是否降序 (默认true)
  
  // 搜索条件
  optional string search_query = 9;  // 房间名称搜索关键词
}

message GetRoomListResponse {
  bool success = 1;                 // 操作是否成功
  repeated RoomInfo rooms = 2;      // 房间列表
  PaginationInfo pagination = 3;    // 分页信息
  
  // 可选的额外信息
  optional int32 total_online_players = 4; // 全服在线玩家数
  optional string server_region = 5;       // 服务器区域
}
```

#### 创建房间

```protobuf
message CreateRoomRequest {
  string name = 1;                          // 房间名称 (1-50字符)
  string game_mode = 2;                     // 游戏模式 (如 "battle", "racing")
  int32 max_players = 3;                    // 最大玩家数 (2-100)
  RoomVisibility visibility = 4;            // 房间可见性
  
  // 私有房间选项
  optional string invite_code = 5;          // 私有房间邀请码 (6-12字符)
  
  // 房间初始配置
  map<string, Value> initial_state = 6;     // 房间初始状态
  
  // 可选配置
  optional string description = 7;          // 房间描述 (最大200字符)
  optional string password = 8;             // 房间密码 (6-20字符)
  optional int32 spectator_limit = 9;       // 观战者数量限制
  
  // 游戏特定配置
  map<string, Value> game_config = 10;      // 游戏模式特定配置
}

message CreateRoomResponse {
  bool success = 1;                         // 创建是否成功
  optional RoomInfo room_info = 2;          // 创建的房间信息
  optional string invite_url = 3;           // 邀请链接 (私有房间)
}
```

#### 加入房间

```protobuf
message JoinRoomRequest {
  string room_id = 1;                       // 要加入的房间ID
  optional string invite_code = 2;          // 私有房间邀请码
  optional string password = 3;             // 房间密码
  optional bool as_spectator = 4;           // 是否以观战者身份加入
}

message JoinRoomResponse {
  bool success = 1;                         // 加入是否成功
  optional GameState initial_state = 2;     // 房间当前完整状态
  repeated string players_in_room = 3;      // 房间内所有玩家ID
  optional RoomInfo room_info = 4;          // 房间基本信息
  repeated string spectators = 5;           // 观战者列表
  
  // 加入者信息
  bool is_spectator = 6;                    // 是否以观战者身份加入
  bool is_rejoining = 7;                    // 是否为重新加入
}
```

#### 离开房间

```protobuf
message LeaveRoomRequest {
  string room_id = 1;                       // 要离开的房间ID
  optional string reason = 2;               // 离开原因 (可选)
}

message LeaveRoomResponse {
  bool success = 1;                         // 离开是否成功
  optional string new_owner_id = 2;         // 新房主ID (如果原房主离开)
}
```

---

## 状态同步协议

### 状态更新机制

RealSync 使用**增量更新**机制，只传输发生变化的状态数据：

```protobuf
// 状态更新请求 (客户端 → 服务器)
message UpdateStateRequest {
  map<string, Value> state_patches = 1;    // 状态增量更新
  optional string transaction_id = 2;      // 事务ID (用于去重)
  optional bool force_update = 3;          // 强制更新 (忽略冲突检测)
  
  // 条件更新 (乐观锁)
  map<string, string> expected_versions = 4; // 期望的状态版本号
}

// 状态更新广播 (服务器 → 所有客户端)
message StateUpdateBroadcast {
  string source_player_id = 1;             // 状态更新的发起者
  map<string, Value> state_patches = 2;    // 状态增量更新
  int64 timestamp = 3;                     // 服务器时间戳
  optional string transaction_id = 4;      // 事务ID
  
  // 版本信息
  map<string, string> state_versions = 5;  // 更新后的状态版本号
}
```

### 游戏状态定义

```protobuf
// 完整游戏状态 (用于首次同步)
message GameState {
  map<string, Value> state = 1;            // 所有状态键值对
  int64 last_updated = 2;                  // 最后更新时间
  string version = 3;                      // 状态版本号
  
  // 元数据
  repeated string active_players = 4;      // 活跃玩家列表
  repeated string spectators = 5;          // 观战者列表
  RoomInfo room_info = 6;                  // 房间信息快照
}
```

### 状态同步示例

**玩家位置更新流程:**

1. **客户端发送更新**:
```protobuf
UpdateStateRequest {
  state_patches: {
    "player_alice_position": {
      object_value: {
        fields: {
          "x": { number_value: 100.5 },
          "y": { number_value: 200.3 },
          "timestamp": { number_value: 1640995200000 }
        }
      }
    }
  },
  transaction_id: "txn_alice_move_001"
}
```

2. **服务器广播给其他玩家**:
```protobuf
StateUpdateBroadcast {
  source_player_id: "alice",
  state_patches: {
    "player_alice_position": {
      object_value: {
        fields: {
          "x": { number_value: 100.5 },
          "y": { number_value: 200.3 },
          "timestamp": { number_value: 1640995200000 }
        }
      }
    }
  },
  timestamp: 1640995200123,
  transaction_id: "txn_alice_move_001"
}
```

---

## 错误处理协议

### 统一错误响应

```protobuf
message ErrorResponse {
  int32 code = 1;                          // 错误码
  string message = 2;                      // 错误消息 (用户友好)
  optional string details = 3;             // 错误详情 (调试用)
  optional string request_id = 4;          // 请求ID (用于追踪)
  
  // 错误上下文
  map<string, string> context = 5;         // 错误相关的上下文信息
  
  // 恢复建议
  optional string recovery_action = 6;     // 建议的恢复操作
  optional int32 retry_after = 7;          // 建议重试间隔 (秒)
}
```

### 错误码体系

| 错误码范围 | 类别 | 说明 | 示例 |
|-----------|------|------|------|
| 1000-1099 | 认证相关 | JWT验证、权限等问题 | 1001: 无效Token |
| 1100-1199 | 房间相关 | 房间不存在、已满等问题 | 1101: 房间不存在 |
| 1200-1299 | 状态同步 | 状态更新、权限等问题 | 1201: 无权限更新 |
| 1300-1399 | 网络相关 | 连接、超时等问题 | 1301: 连接超时 |

### 详细错误定义

```protobuf
// 错误码枚举
enum ErrorCode {
  ERROR_CODE_UNSPECIFIED = 0;
  
  // 认证相关 (1000-1099)
  ERROR_CODE_INVALID_TOKEN = 1001;         // 无效的JWT Token
  ERROR_CODE_EXPIRED_TOKEN = 1002;         // Token已过期
  ERROR_CODE_INSUFFICIENT_PERMISSIONS = 1003; // 权限不足
  
  // 房间相关 (1100-1199)  
  ERROR_CODE_ROOM_NOT_FOUND = 1101;        // 房间不存在
  ERROR_CODE_ROOM_FULL = 1102;             // 房间已满
  ERROR_CODE_INVALID_INVITE_CODE = 1103;   // 邀请码无效
  ERROR_CODE_ROOM_ALREADY_STARTED = 1104;  // 房间已开始游戏
  ERROR_CODE_PLAYER_ALREADY_IN_ROOM = 1105; // 玩家已在房间中
  
  // 状态同步相关 (1200-1299)
  ERROR_CODE_INVALID_STATE_UPDATE = 1201;  // 状态更新无效
  ERROR_CODE_STATE_CONFLICT = 1202;        // 状态冲突
  ERROR_CODE_TRANSACTION_FAILED = 1203;    // 事务执行失败
  
  // 网络相关 (1300-1399)
  ERROR_CODE_CONNECTION_TIMEOUT = 1301;    // 连接超时
  ERROR_CODE_NETWORK_ERROR = 1302;         // 网络错误
  ERROR_CODE_MESSAGE_TOO_LARGE = 1303;     // 消息过大
}
```

---

## 扩展性设计

### 向后兼容性

**字段编号管理:**
- 核心字段: 1-50
- 扩展字段: 51-100  
- 实验性字段: 101-150
- 预留字段: 151-200

**新功能添加策略:**
```protobuf
message CreateRoomRequest {
  // 核心字段 (稳定)
  string name = 1;
  string game_mode = 2;
  int32 max_players = 3;
  
  // 扩展字段 (渐进添加)
  optional string description = 51;
  optional bool enable_spectators = 52;
  
  // 实验性字段 (可能变更)
  optional AdvancedGameConfig advanced_config = 101;
}
```

### 功能扩展点

**预留的消息类型:**
- 聊天系统: `SendMessageRequest`, `MessageBroadcast`
- 观战功能: `SpectateRequest`, `SpectatorUpdate`  
- 匹配系统: `FindMatchRequest`, `MatchFoundNotification`
- 录像回放: `RecordingRequest`, `ReplayData`

**预留的Value类型:**
```protobuf
message Value {
    oneof value {
        // 现有类型
        string string_value = 1;
        double number_value = 2;
        bool bool_value = 3;
        ArrayValue array_value = 4;
        ObjectValue object_value = 5;
        
        // 预留扩展类型
        // BinaryValue binary_value = 6;      // 二进制数据
        // TimestampValue timestamp_value = 7; // 时间戳类型
        // GeoPointValue geopoint_value = 8;   // 地理位置
    }
}
```

---

## 版本演进策略

### 协议版本管理

```protobuf
// 在每个包中添加版本信息
message ClientPacket {
  string protocol_version = 1;     // 协议版本 (如 "1.0", "1.1")
  oneof message {
    // ... 具体消息
  }
}
```

### 兼容性策略

**版本兼容性矩阵:**

| 客户端版本 | 服务器版本 | 兼容性 | 说明 |
|-----------|-----------|--------|------|
| 1.0 | 1.0 | ✅ 完全兼容 | 基础功能 |
| 1.0 | 1.1 | ✅ 向前兼容 | 新功能对老客户端透明 |
| 1.1 | 1.0 | ⚠️ 有限兼容 | 新功能不可用 |
| 1.x | 2.0 | ❌ 不兼容 | 需要升级客户端 |

### 迁移策略

**渐进式迁移:**
1. 添加新字段时使用 `optional` 修饰符
2. 废弃旧字段时先标记为 `deprecated`
3. 提供迁移工具自动转换数据格式
4. 在文档中明确标注兼容性要求

**示例迁移:**
```protobuf
message PlayerInfo {
  string name = 1;
  
  // v1.0 字段 (已废弃)
  int32 level = 2 [deprecated = true];
  
  // v1.1 新字段
  optional PlayerLevel player_level = 3;  
  optional PlayerStats stats = 4;
}
```

---

## 开发工具与最佳实践

### 代码生成

**自动生成脚本:**
```bash
# 生成所有语言的代码
./scripts/generate-proto.sh

# 单独生成TypeScript
protoc --ts_out=packages/sdk-ts/src packages/protocol/*.proto

# 单独生成C#
protoc --csharp_out=packages/sdk-csharp/src packages/protocol/*.proto
```

### 测试策略

**协议测试覆盖:**
- 消息序列化/反序列化测试
- 向后兼容性测试  
- 错误场景测试
- 性能基准测试

### 文档同步

所有协议变更必须同步更新：
- 本设计文档
- SDK API文档
- 示例代码
- 变更日志 
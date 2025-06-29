# RealSync - 多人实时同步框架设计方案

版本: 1.0

## **1. 项目愿景与核心概念**

### **1.1 项目愿景 (Vision)**

**RealSync** 是一个为游戏开发者设计的、开箱即用的多人实时状态同步框架。其核心目标是让开发者从复杂的后端网络同步逻辑中解放出来，能够像使用 Firebase/Firestore 一样，通过简洁的客户端SDK，轻松实现玩家数据、游戏状态在多端之间的低延迟同步。

- **目标用户**: 独立游戏开发者、中小型游戏团队、Game Jam参与者、以及需要快速实现联机功能原型的开发者。
- **解决的问题**: 消除自建和维护游戏同步服务器带来的高昂成本、技术复杂性和时间投入。

### **1.2 核心概念 (Core Concepts)**

- **客户端 (Client)**: 运行在玩家设备上的游戏程序，通过 **SDK** 与 RealSync 服务进行交互。
- **网关服务 (Gateway)**: RealSync 的核心后端服务，负责处理所有客户端连接、消息收发、鉴权、状态存储和逻辑执行。
- **房间 (Room)**: 一个隔离的同步空间，是游戏对局的基本单位。同一个房间内的玩家可以互相看到对方的状态更新。
- **玩家 (Player)**: 参与游戏对局的实体，由唯一的 `PlayerID` 标识。
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
    - 负载均衡器根据其策略（如“最少连接数”、“轮询”）选择一个当前负载最低的、健康的网关实例。
    - 然后将WebSocket连接“透传”给该实例。
4. **无状态网关**: 我们的架构优势在于，**任何一个网关实例都可以处理任何一个客户端的任何请求**。因为所有共享状态（如玩家在哪个房间、房间数据是什么）都存储在外部的 **Redis 集群**中。这种无状态设计使得网关的水平扩展变得非常简单和可靠。

**结论**: 这种方法将后端的复杂性完全屏蔽，SDK的实现可以保持极度简洁，开发者也无需关心服务端的部署细节。

## **3. 协议与数据模型 (Protocol & Data Model)**

我们将使用 **Protocol Buffers (Protobuf)** 作为接口定义语言 (IDL)，它是所有组件交互的“单一事实来源”。

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
    JoinRoomRequest join_room_request = 1;
    UpdateStateRequest update_state_request = 2;
    // ... 未来可扩展其他请求, e.g., SendMessageRequest
  }
}

// 服务器发送给客户端的包
message ServerPacket {
  oneof message {
    JoinRoomResponse join_room_response = 1;
    StateUpdateBroadcast state_update_broadcast = 2;
    PlayerJoinedBroadcast player_joined_broadcast = 3;
    PlayerLeftBroadcast player_left_broadcast = 4;
    ErrorResponse error_response = 5;
  }
}

// ===================================================================
// 2. 核心数据结构 (Core Data Structures)
// ===================================================================

// 任意状态值 (用于实现 key-value 状态)
message StateValue {
    oneof value {
        string string_value = 1;
        double number_value = 2;
        bool bool_value = 3;
        // 可以根据需要添加 bytes 等类型
    }
}

// 完整的游戏状态 (用于首次加入房间时全量同步)
map<string, StateValue> GameState = 1;

// ===================================================================
// 3. 具体消息定义 (Specific Message Definitions)
// ===================================================================

// -- 请求 (Requests) --

message JoinRoomRequest {
  string room_id = 1;
  // JWT Token 将在 WebSocket 连接的 URL 参数中传递，不在此处
}

message UpdateStateRequest {
  map<string, StateValue> state_patches = 1; // 状态的增量更新
}

// -- 响应 (Responses) & 广播 (Broadcasts) --

message JoinRoomResponse {
  bool success = 1;
  GameState initial_state = 2; // 成功加入后，返回房间的当前全量状态
  repeated string players_in_room = 3; // 房间内所有玩家的ID
}

message ErrorResponse {
    int32 code = 1;
    string message = 2;
}

message StateUpdateBroadcast {
  string source_player_id = 1; // 状态更新的发起者
  map<string, StateValue> state_patches = 2; // 状态的增量更新
}

message PlayerJoinedBroadcast {
  string player_id = 1;
}

message PlayerLeftBroadcast {
  string player_id = 1;
}

```

## **4. 网关服务 (Gateway) 设计**

网关服务是 RealSync 的大脑，使用 **Node.js + TypeScript** 实现。

### **4.1 核心职责**

- **连接管理**: 维护海量 WebSocket 长连接，处理心跳和重连。
- **认证授权**: 通过 JWT 验证客户端身份，并依据安全规则判断操作权限。
- **消息路由**: 反序列化 Protobuf 消息，根据消息类型调用相应的处理逻辑。
- **状态同步**: 与 Redis 交互，持久化房间状态，并通过 Pub/Sub 广播更新。
- **权威逻辑**: 执行服务器端的权威逻辑，如游戏计时器、胜负判断等。

### **4.2 Redis 数据结构**

- **房间状态**: `room:state:{roomId}` (HASH)
    - 存储一个房间内所有 Key-Value 状态。Key为状态名，Value为Protobuf `StateValue` 序列化后的二进制数据。
- **房间成员**: `room:members:{roomId}` (SET)
    - 存储一个房间内所有 `PlayerID`。
- **房间元数据**: `room:metadata:{roomId}` (HASH)
    - 存储房间的元信息，如`ownerId`, `creationTime`等。
- **更新通道**: `room:channel:{roomId}` (Pub/Sub Channel)
    - 用于在服务器多实例之间广播状态更新事件。

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

### **5.1 TypeScript SDK (`sdk-ts`)**

- **API 设计**:
    
    ```
    import { RealSyncClient } from 'realsync-sdk';
    
    const client = new RealSyncClient({
      tokenProvider: async () => 'YOUR_JWT_TOKEN',
    });
    
    const room = await client.joinRoom('room-123');
    
    // 监听状态变化
    room.on('stateChange', (patches, sourcePlayerId) => {
      console.log(`Player ${sourcePlayerId} updated state:`, patches);
      // Update local game UI
    });
    
    room.on('playerJoined', (playerId) => { /* ... */ });
    room.on('playerLeft', (playerId) => { /* ... */ });
    
    // 更新自己的状态
    function onPlayerMove(newPos) {
      room.updateState({
        [`position_${client.getPlayerId()}`]: { numberValue: newPos.x }
      });
    }
    
    ```
    
- **打包**: 使用 `esbuild` 或 `Rollup` 打包成多种格式 (ESM, CJS, UMD/IIFE) 以适应不同环境。

### **5.2 C# SDK (`sdk-csharp`)**

- **API 设计 (面向 Unity)**:
    
    ```
    using RealSync;
    using System.Threading.Tasks;
    
    public class GameManager : MonoBehaviour
    {
        private IRoom room;
        private IRealSyncClient client;
    
        async void Start()
        {
            client = new RealSyncClient(new ClientOptions {
                TokenProvider = () => Task.FromResult("YOUR_JWT_TOKEN")
            });
    
            room = await client.JoinRoomAsync("room-123");
    
            room.OnStateChange += (patches, sourcePlayerId) => {
                Debug.Log($"Player {sourcePlayerId} updated state.");
                // 在Unity主线程中更新UI
            };
    
            room.OnPlayerJoined += (playerId) => { /* ... */ };
            room.OnPlayerLeft += (playerId) => { /* ... */ };
        }
    
        public void OnPlayerMove(Vector2 newPos)
        {
            var patch = new Dictionary<string, StateValue> {
                [$"position_{client.PlayerId}"] = new StateValue { NumberValue = newPos.x }
            };
            room.UpdateStateAsync(patch);
        }
    }
    
    ```
    
- **集成**: 目标为 .NET Standard 2.1，以最大化兼容性。使用 `protoc` 生成C#代码，配合 WebSocket 客户端库，可以直接集成到 Unity 项目的 `Assets` 文件夹中。

## **6. 开发与部署**

### **6.1 代码生成工作流**

在 Monorepo 根目录提供一个脚本，一键为所有目标语言生成最新的协议代码。

- `package.json` 中的脚本:
    
    ```
    "scripts": {
      "generate": "turbo run generate"
    }
    
    ```
    
- 每个SDK和服务器的 `package.json` 中定义自己的 `generate` 脚本，调用 `protoc`。

### **6.2 部署**

- **Gateway**: 使用 Docker 将 Node.js 应用容器化。
- **部署平台**: 可部署在任何支持容器的云平台上，如 Google Cloud Run, AWS Fargate, Kubernetes 等。配合负载均衡器可以实现水平扩展。
- **Redis**: 使用云服务商提供的托管 Redis 集群服务，如 Google Memorystore, AWS ElastiCache for Redis。
# RealSync SDK API 参考文档

版本: 1.0  
更新时间: 2024-01-01

## 📋 目录

- [TypeScript SDK](#typescript-sdk)
  - [安装与初始化](#安装与初始化)
  - [核心类](#核心类)
  - [接口定义](#接口定义)
  - [类型定义](#类型定义)
  - [错误处理](#错误处理)
  - [完整示例](#完整示例)
- [C# SDK](#c-sdk) (TODO)

---

## TypeScript SDK

### 安装与初始化

#### 安装

```bash
npm install realsync-sdk
# 或
yarn add realsync-sdk
```

#### 基本初始化

```typescript
import { RealSyncClient } from 'realsync-sdk';

const client = new RealSyncClient({
  // 🔑 必需：应用API密钥（用于多租户隔离）
  apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j', // 从RealSync控制台获取
  
  // 🌐 可选：服务器地址（默认为官方服务）
  serverUrl: 'wss://connect.realsync.io',
  
  // 🔐 必需：用户身份令牌提供者
  tokenProvider: async () => {
    // 返回用户的JWT token（包含OpenID）
    return await getAuthToken();
  },
  
  // ⚙️ 可选配置
  reconnectAttempts: 5,
  reconnectDelay: 1000,
  heartbeatInterval: 30000,
  debug: false
});
```

#### API密钥 (apiKey) 详解

##### 🔑 获取API密钥

API密钥是您的应用在RealSync平台的唯一标识，用于：
- **应用隔离**: 确保不同应用的数据完全隔离
- **权限控制**: 限制应用只能访问自己的数据
- **配额管理**: 监控和管理应用的资源使用

**获取步骤：**
1. 访问 [RealSync 开发者控制台](https://console.realsync.io)
2. 创建新应用或选择现有应用
3. 在应用设置页面复制API密钥

**API密钥格式：**
```
ak_1a2b3c4d5e6f7g8h9i0j  # 以 'ak_' 开头的26字符字符串
```

##### 🌟 纯客户端开发特性

> ✨ **RealSync 核心优势**: API密钥设计为**客户端安全**，支持纯前端开发，无需后端服务！

API密钥的安全设计原则（类似 Firebase）：
- **🔓 客户端友好**: 可以安全地暴露在前端代码中
- **🛡️ 权限隔离**: 每个应用的API密钥只能访问自己的数据
- **🚫 无敏感操作**: 不包含删除应用、修改配额等管理权限
- **🔍 透明可控**: 可在控制台随时查看和重置

**✅ 推荐做法 - 纯客户端开发:**
```typescript
// 前端游戏客户端 - 完全可以直接使用
const client = new RealSyncClient({
  apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j', // ✅ 完全安全，可以暴露
  tokenProvider: async () => {
    // 用户认证token（如Firebase Auth、Auth0等）
    return await getUserAuthToken(); 
  }
});

// 直接在客户端创建房间
const room = await client.createRoom({
  name: 'My Game Room',
  gameMode: 'battle',
  maxPlayers: 4,
  visibility: RoomVisibility.PUBLIC
});
```

**🎯 与传统方案对比:**
```typescript
// ❌ 传统方案：需要复杂的后端架构
// Backend API + 客户端代理 = 开发复杂度 ↑↑↑

// ✅ RealSync：纯客户端开发
// 直接调用SDK = 开发复杂度 ↓↓↓
const client = new RealSyncClient({ 
  apiKey: 'ak_xxx' // 像Firebase一样简单
});
```

##### 📱 多平台纯客户端示例

```typescript
// 🌐 Web浏览器游戏
const webClient = new RealSyncClient({
  apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j',
  tokenProvider: async () => {
    // 使用Firebase Auth
    const user = firebase.auth().currentUser;
    return await user.getIdToken();
  }
});

// 📱 React Native手机游戏
const mobileClient = new RealSyncClient({
  apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j',
  tokenProvider: async () => {
    // 使用任何认证服务
    return await AsyncStorage.getItem('userToken');
  }
});

// 🎮 微信小游戏
const wxClient = new RealSyncClient({
  apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j',
  tokenProvider: async () => {
    // 使用微信登录
    return await wx.getStorageSync('sessionToken');
  }
});
```

##### 🔧 配置管理最佳实践

**开发环境配置:**
```typescript
// config/realsync.ts
interface RealSyncConfig {
  apiKey: string;
  serverUrl?: string;
  debug: boolean;
}

const configs: Record<string, RealSyncConfig> = {
  development: {
    apiKey: 'ak_dev_1a2b3c4d5e6f7g8h9i0j',  // 开发环境密钥
    serverUrl: 'wss://dev.realsync.io',      // 开发服务器
    debug: true
  },
  production: {
    apiKey: 'ak_prod_9z8y7x6w5v4u3t2s',     // 生产环境密钥  
    serverUrl: 'wss://connect.realsync.io',  // 生产服务器
    debug: false
  }
};

export const getRealSyncConfig = (): RealSyncConfig => {
  const env = process.env.NODE_ENV || 'development';
  return configs[env];
};

// 使用配置
const config = getRealSyncConfig();
const client = new RealSyncClient({
  ...config,
  tokenProvider: async () => await getAuthToken()
});
```

**条件编译优化（Webpack/Vite）:**
```typescript
// 使用构建工具的环境变量替换
const client = new RealSyncClient({
  apiKey: process.env.VITE_REALSYNC_API_KEY,  // Vite
  // apiKey: process.env.REACT_APP_REALSYNC_API_KEY,  // Create React App
  tokenProvider: async () => await getAuthToken()
});
```

**动态配置加载:**
```typescript
// 从远程配置服务加载（可选）
class RealSyncManager {
  private client: RealSyncClient | null = null;
  
  async initialize() {
    // 从你的配置API加载
    const config = await fetch('/api/game-config').then(r => r.json());
    
    this.client = new RealSyncClient({
      apiKey: config.realSyncApiKey,
      tokenProvider: async () => await this.getPlayerToken()
    });
    
    await this.client.connectAsync();
  }
  
  private async getPlayerToken(): Promise<string> {
    // 获取当前玩家的认证token
    return await getCurrentUserToken();
  }
}
```

---

### 核心类

#### `RealSyncClient`

RealSync客户端的主要入口类，负责连接管理和房间操作。

##### 构造函数

```typescript
constructor(options: ClientOptions)
```

**参数:**
- `options: ClientOptions` - 客户端配置选项

##### 方法

###### `connectAsync(): Promise<void>`

连接到RealSync服务器。

```typescript
await client.connectAsync();
```

**返回值:** `Promise<void>`

**抛出异常:**
- `ConnectionError` - 连接失败时抛出

---

###### `disconnectAsync(): Promise<void>`

断开与服务器的连接。

```typescript
await client.disconnectAsync();
```

**返回值:** `Promise<void>`

---

###### `getRoomList(request: GetRoomListOptions): Promise<GetRoomListResult>`

获取房间列表。

```typescript
const roomList = await client.getRoomList({
  statusFilter: RoomStatus.WAITING,
  visibilityFilter: RoomVisibility.PUBLIC,
  gameModeFilter: 'battle',
  page: 1,
  pageSize: 20,
  sortBy: 'CREATED_AT',
  sortDescending: true
});
```

**参数:**
- `request: GetRoomListOptions` - 查询选项

**返回值:** `Promise<GetRoomListResult>`

**示例响应:**
```typescript
{
  rooms: [
    {
      roomId: 'room-123',
      name: 'Epic Battle Arena',
      status: RoomStatus.WAITING,
      visibility: RoomVisibility.PUBLIC,
      playerCount: 2,
      maxPlayers: 4,
      gameMode: 'battle',
      ownerId: 'player-456',
      createdAt: 1640995200000,
      lastActivityAt: 1640995800000
    }
  ],
  pagination: {
    page: 1,
    pageSize: 20,
    totalCount: 45,
    hasNextPage: true
  }
}
```

---

###### `createRoom(request: CreateRoomOptions): Promise<CreateRoomResult>`

创建新房间。

```typescript
const result = await client.createRoom({
  name: 'My Game Room',
  gameMode: 'battle',
  maxPlayers: 4,
  visibility: RoomVisibility.PUBLIC,
  initialState: {
    // 简化API - 自动类型推断
    countdown: 60,                           // number
    gamePhase: 'waiting',                    // string
    allowSpectators: true,                   // boolean
    playerList: [],                          // array
    gameConfig: {                            // object
      mapSize: 'large',
      difficulty: 'normal',
      gameRules: ['no-camping', 'friendly-fire'],
      teamSettings: {
        maxTeamSize: 4,
        autoBalance: true
      }
    },
    leaderboard: [                           // object array
      { rank: 1, name: 'Pro Player', score: 2500 },
      { rank: 2, name: 'Skilled Gamer', score: 2200 }
    ]
  }
});
```

**参数:**
- `request: CreateRoomOptions` - 房间创建选项

**返回值:** `Promise<CreateRoomResult>`

---

###### `joinRoom(roomId: string, inviteCode?: string): Promise<JoinRoomResult>`

加入指定房间。

```typescript
const result = await client.joinRoom('room-123');
console.log('我的PlayerId:', result.playerId);  // 房间内的短ID，如: 1
console.log('其他玩家:', result.otherPlayers); // 不包含OpenID的玩家信息

// 私有房间
const privateResult = await client.joinRoom('private-room-456', 'invite-code-123');
```

**参数:**
- `roomId: string` - 房间ID
- `inviteCode?: string` - 私有房间的邀请码（可选）

**返回值:** `Promise<JoinRoomResult>`

**示例响应:**
```typescript
{
  playerId: 1,                    // 分配给当前玩家的房间内短ID
  room: Room,                     // 房间实例
  otherPlayers: [                 // 房间内其他玩家（隐私保护）
    {
      playerId: 2,
      nickname: "Player2",
      joinedAt: 1640995210000,
      isOnline: true
    },
    {
      playerId: 3,
      nickname: "Player3", 
      joinedAt: 1640995220000,
      isOnline: true
    }
  ],
  roomState: {                    // 当前房间状态
    countdown: 60,
    gamePhase: 'waiting',
    player_1_ready: true,
    player_2_ready: false
  }
}
```

**抛出异常:**
- `RoomNotFoundError` - 房间不存在
- `RoomFullError` - 房间已满
- `InvalidInviteCodeError` - 邀请码无效

---

##### 属性

###### `currentPlayerId: number | null` (只读)

当前玩家在房间内的短ID，未加入房间时为null。

```typescript
const playerId = client.currentPlayerId;  // 例如: 1, 2, 3
if (playerId !== null) {
  console.log(`我是房间内的玩家${playerId}`);
}
```

**注意:** 
- 这是房间内的临时数字ID，不是全局用户标识
- 仅在房间内有效，离开房间后失效  
- 不同房间会分配不同的PlayerId

###### `isConnected: boolean` (只读)

连接状态。

```typescript
if (client.isConnected) {
  console.log('已连接到服务器');
}
```

##### 事件

###### `connected`

连接成功时触发。

```typescript
client.on('connected', () => {
  console.log('Connected to RealSync');
});
```

###### `disconnected`

连接断开时触发。

```typescript
client.on('disconnected', (reason: string) => {
  console.log('Disconnected:', reason);
});
```

###### `reconnecting`

重连尝试时触发。

```typescript
client.on('reconnecting', (attempt: number) => {
  console.log(`Reconnecting attempt ${attempt}`);
});
```

###### `error`

发生错误时触发。

```typescript
client.on('error', (error: ErrorResponse) => {
  console.error('RealSync error:', error.code, error.message);
});
```

---

#### `Room`

表示一个已加入的房间，用于状态同步和房间内交互。采用分段式API设计，提供直观的状态操作体验。

##### 属性

###### `state: StateManager` (只读)

状态管理器，提供分段式的状态操作API。

##### 方法

###### `state.set(key: string, value: Value): Promise<void>`

设置单个状态值。SDK内部会自动进行批量优化，多个连续的set操作会合并为一次网络请求。

```typescript
// 基础类型 - 自动推断和转换
await room.state.set('playerScore', 1500);                    // 数字
await room.state.set('playerName', 'John');                   // 字符串  
await room.state.set('isAlive', true);                        // 布尔值

// 复杂类型 - 自动处理
await room.state.set('position', { x: 100, y: 200 });        // 对象
await room.state.set('inventory', ['sword', 'shield']);       // 数组
await room.state.set('gameConfig', {                          // 嵌套对象
  difficulty: 'hard',
  teamSettings: { maxSize: 4, autoBalance: true }
});

// 动态key支持 (使用房间内的playerId)
const myPlayerId = client.currentPlayerId; // 例如: 1
await room.state.set(`player_${myPlayerId}_health`, 85); // "player_1_health"
```

**参数:**
- `key: string` - 状态键名
- `value: Value` - 状态值，支持自动类型推断

**返回值:** `Promise<void>`

---

###### `state.get(key: string): Value | undefined`

获取单个状态值。

```typescript
const playerScore = room.state.get('playerScore');           // number | undefined
const gameConfig = room.state.get('gameConfig');            // object | undefined
const inventory = room.state.get('inventory');              // array | undefined
```

**参数:**
- `key: string` - 状态键名

**返回值:** `Value | undefined`

---

###### `state.has(key: string): boolean`

检查状态是否存在。

```typescript
if (room.state.has('playerReady')) {
  console.log('Player ready state exists');
}
```

---

###### `state.delete(key: string): Promise<void>`

删除状态。

```typescript
await room.state.delete('temporaryData');
```

---

###### `state.batch(): BatchStateManager`

创建批量状态管理器，用于原子性的多状态更新。

```typescript
await room.state.batch()
  .set('gamePhase', 'combat')
  .set('roundTimer', 60)
  .set(`player_${playerId}_ready`, true)
  .delete('temporaryFlag')
  .commit();
```

**返回值:** `BatchStateManager` - 支持链式调用的批量管理器

---

###### `state.flush(): Promise<void>`

立即发送所有待处理的状态更新，而不等待自动批量优化。

```typescript
await room.state.set('urgentData', importantValue);
await room.state.flush(); // 立即发送，不等待批量优化
```

---

###### `player(playerId: number): PlayerStateManager`

获取特定玩家的状态管理器，提供便利的玩家相关操作。

```typescript
// 操作自己的状态
const myPlayerId = client.currentPlayerId; // 例如: 1
await room.player(myPlayerId).set('health', 85);
await room.player(myPlayerId).set('position', { x: 100, y: 200 });
await room.player(myPlayerId).update({
  health: 85,
  weapon: 'sword',
  level: 10
});

// 读取其他玩家状态
const player2Health = room.player(2).get('health');
const player3Position = room.player(3).get('position');

// 批量操作
await room.player(myPlayerId).batch()
  .set('health', 100)
  .set('mana', 50)
  .set('ready', true)
  .commit();
```

**参数:**
- `playerId: number` - 房间内的玩家ID（1, 2, 3...）

**返回值:** `PlayerStateManager` - 玩家状态管理器

---

##### 网络优化特性

**自动批量合并**: 在16ms时间窗口内的多个`set`操作会自动合并为一次网络请求。

```typescript
// 这四个操作会自动合并为一次网络请求
await room.state.set('a', 1);
await room.state.set('b', 2);  
await room.state.set('c', 3);
await room.state.set('d', 4);
```

**智能冲突解决**: 同一key的多次设置只保留最新值。

```typescript
// 只有最后的值(100)会被发送
await room.state.set('score', 50);
await room.state.set('score', 75);
await room.state.set('score', 100);
```

---

###### `leave(): Promise<void>`

离开房间。

```typescript
await room.leave();
```

**返回值:** `Promise<void>`

---

###### `getState(): GameState`

获取当前房间的完整状态。

```typescript
const currentState = room.getState();
console.log('Current countdown:', currentState['countdown']?.numberValue);
```

**返回值:** `GameState`

---

###### `getPlayerState(playerId: string): Partial<GameState>`

获取指定玩家的状态。

```typescript
const playerState = room.getPlayerState('player-123');
```

**参数:**
- `playerId: string` - 玩家ID

**返回值:** `Partial<GameState>`

---

##### 属性

###### `roomId: string` (只读)

房间ID。

###### `roomInfo: RoomInfo` (只读)

房间基本信息。

###### `playersInRoom: PlayerInfo[]` (只读)

房间内所有玩家的信息列表（不包含敏感的OpenID）。

```typescript
console.log(`房间内有 ${room.playersInRoom.length} 位玩家`);

// 遍历所有玩家
room.playersInRoom.forEach(player => {
  console.log(`玩家${player.playerId}: ${player.nickname}, 在线: ${player.isOnline}`);
});

// 获取特定玩家信息
const targetPlayer = room.playersInRoom.find(p => p.playerId === 2);
if (targetPlayer) {
  console.log(`玩家2的昵称: ${targetPlayer.nickname}`);
}
```

##### 事件

###### `stateChange`

房间状态发生变化时触发。

```typescript
room.on('stateChange', (patches: StatePatches, sourcePlayerId: number) => {
  console.log(`玩家${sourcePlayerId}更新了状态:`, patches);
  
  // 处理特定状态更新
  if (patches['countdown']) {
    updateCountdownUI(patches['countdown']);
  }
});
```

**回调参数:**
- `patches: StatePatches` - 状态变更补丁
- `sourcePlayerId: string` - 触发更新的玩家ID

###### `playerJoined`

玩家加入房间时触发。

```typescript
room.on('playerJoined', (playerId: string, roomInfo: RoomInfo) => {
  console.log(`${playerId} joined. Room now has ${roomInfo.playerCount} players`);
});
```

**回调参数:**
- `playerId: string` - 加入的玩家ID
- `roomInfo: RoomInfo` - 更新后的房间信息

###### `playerLeft`

玩家离开房间时触发。

```typescript
room.on('playerLeft', (playerId: string, roomInfo: RoomInfo) => {
  console.log(`${playerId} left. Room now has ${roomInfo.playerCount} players`);
});
```

**回调参数:**
- `playerId: string` - 离开的玩家ID
- `roomInfo: RoomInfo` - 更新后的房间信息

---

### 接口定义

#### `ClientOptions`

客户端配置选项。

```typescript
interface ClientOptions {
  /** 🔑 应用API密钥，用于多租户隔离（必需） */
  apiKey: string;
  
  /** 🌐 服务器WebSocket URL，默认: 'wss://connect.realsync.io' */
  serverUrl?: string;
  
  /** 🔐 Token提供函数，用于用户身份验证（必需） */
  tokenProvider: () => Promise<string>;
  
  /** ⚙️ 重连尝试次数，默认: 5 */
  reconnectAttempts?: number;
  
  /** ⚙️ 重连延迟（毫秒），默认: 1000 */
  reconnectDelay?: number;
  
  /** ⚙️ 心跳间隔（毫秒），默认: 30000 */
  heartbeatInterval?: number;
  
  /** 🐛 启用调试日志，默认: false */
  debug?: boolean;
}
```

#### `GetRoomListOptions`

房间列表查询选项。

```typescript
interface GetRoomListOptions {
  /** 按房间状态过滤 */
  statusFilter?: RoomStatus;
  
  /** 按可见性过滤 */
  visibilityFilter?: RoomVisibility;
  
  /** 按游戏模式过滤 */
  gameModeFilter?: string;
  
  /** 页码，从1开始，默认: 1 */
  page?: number;
  
  /** 每页大小，默认: 20，最大: 100 */
  pageSize?: number;
  
  /** 排序字段 */
  sortBy?: 'CREATED_AT' | 'LAST_ACTIVITY' | 'PLAYER_COUNT';
  
  /** 是否降序排列，默认: true */
  sortDescending?: boolean;
}
```

#### `CreateRoomOptions`

房间创建选项。

```typescript
interface CreateRoomOptions {
  /** 房间名称 */
  name: string;
  
  /** 游戏模式 */
  gameMode: string;
  
  /** 最大玩家数 */
  maxPlayers: number;
  
  /** 房间可见性 */
  visibility: RoomVisibility;
  
  /** 私有房间邀请码（仅私有房间需要） */
  inviteCode?: string;
  
  /** 房间初始状态 - 支持任意类型值 */
  initialState?: Record<string, Value>;
}
```

#### `GetRoomListResult`

房间列表查询结果。

```typescript
interface GetRoomListResult {
  /** 房间列表 */
  rooms: RoomInfo[];
  
  /** 分页信息 */
  pagination: PaginationInfo;
}
```

#### `CreateRoomResult`

房间创建结果。

```typescript
interface CreateRoomResult {
  /** 创建的房间信息 */
  roomInfo: RoomInfo;
}
```

#### `JoinRoomResult`

加入房间结果。

```typescript
interface JoinRoomResult {
  /** 分配给当前玩家的房间内短ID */
  playerId: number;
  
  /** 房间实例 */
  room: Room;
  
  /** 房间内其他玩家信息（不包含OpenID） */
  otherPlayers: PlayerInfo[];
  
  /** 当前房间状态 */
  roomState: GameState;
}
```

#### `PlayerInfo`

房间内玩家信息（隐私保护版本）。

```typescript
interface PlayerInfo {
  /** 房间内的短ID */
  playerId: number;
  
  /** 显示名称（可选） */
  nickname?: string;
  
  /** 头像URL（可选） */
  avatar?: string;
  
  /** 加入时间（Unix时间戳） */
  joinedAt: number;
  
  /** 在线状态 */
  isOnline: boolean;
}
```

---

### 类型定义

#### 枚举类型

##### `RoomStatus`

房间状态枚举。

```typescript
enum RoomStatus {
  WAITING = 'waiting',    // 等待玩家加入
  PLAYING = 'playing',    // 游戏进行中
  FINISHED = 'finished'   // 游戏已结束
}
```

##### `RoomVisibility`

房间可见性枚举。

```typescript
enum RoomVisibility {
  PUBLIC = 'public',      // 公开房间
  PRIVATE = 'private'     // 私有房间
}
```

#### 数据结构

##### `RoomInfo`

房间基本信息。

```typescript
interface RoomInfo {
  /** 房间ID */
  roomId: string;
  
  /** 房间名称 */
  name: string;
  
  /** 房间状态 */
  status: RoomStatus;
  
  /** 房间可见性 */
  visibility: RoomVisibility;
  
  /** 当前玩家数 */
  playerCount: number;
  
  /** 最大玩家数 */
  maxPlayers: number;
  
  /** 游戏模式 */
  gameMode: string;
  
  /** 房主ID */
  ownerId: string;
  
  /** 创建时间（Unix时间戳） */
  createdAt: number;
  
  /** 最后活动时间（Unix时间戳） */
  lastActivityAt: number;
}
```

##### `PaginationInfo`

分页信息。

```typescript
interface PaginationInfo {
  /** 当前页码 */
  page: number;
  
  /** 每页大小 */
  pageSize: number;
  
  /** 总记录数 */
  totalCount: number;
  
  /** 是否有下一页 */
  hasNextPage: boolean;
}
```

##### `Value`

通用值类型，支持基础类型、数组和对象。SDK会自动进行类型推断和转换。

```typescript
type Value = string | number | boolean | Value[] | { [key: string]: Value };
```

**支持的类型:**
- **基础类型**: `string`, `number`, `boolean`
- **数组类型**: `Value[]` - 支持任意元素类型的数组
- **对象类型**: `{ [key: string]: Value }` - 支持嵌套对象结构

**类型推断示例:**
```typescript
// 自动推断为各种类型
const gameState = {
  score: 100,                    // number
  playerName: 'Alice',           // string  
  isWinner: true,                // boolean
  inventory: ['sword', 'potion'], // string[]
  position: { x: 10, y: 20 },    // object
  history: [                     // object[]
    { action: 'move', time: 1000 },
    { action: 'attack', time: 2000 }
  ],
  nested: {                      // nested object
    config: {
      difficulty: 'hard',
      settings: [1, 2, 3]
    }
  }
};
```

##### `StatePatches`

状态更新补丁，使用简化的值类型。

```typescript
type StatePatches = Record<string, Value>;
```

##### `GameState`

完整游戏状态，使用简化的值类型。

```typescript
type GameState = Record<string, Value>;
```

##### 分段式API接口

```typescript
/** 状态管理器 - 提供分段式状态操作API */
interface StateManager {
  /** 设置单个状态值，支持自动批量优化 */
  set(key: string, value: Value): Promise<void>;
  
  /** 获取单个状态值 */
  get(key: string): Value | undefined;
  
  /** 检查状态是否存在 */
  has(key: string): boolean;
  
  /** 删除状态 */
  delete(key: string): Promise<void>;
  
  /** 创建批量状态管理器 */
  batch(): BatchStateManager;
  
  /** 立即发送所有待处理的更新 */
  flush(): Promise<void>;
}

/** 批量状态管理器 - 支持原子性的多状态更新 */
interface BatchStateManager {
  /** 添加设置操作到批次 */
  set(key: string, value: Value): BatchStateManager;
  
  /** 添加删除操作到批次 */
  delete(key: string): BatchStateManager;
  
  /** 提交所有批量操作 */
  commit(): Promise<void>;
  
  /** 回滚所有批量操作 */
  rollback(): void;
}

/** 玩家状态管理器 - 提供便利的玩家相关操作 */
interface PlayerStateManager {
  /** 设置玩家状态 */
  set(key: string, value: Value): Promise<void>;
  
  /** 获取玩家状态 */
  get(key: string): Value | undefined;
  
  /** 获取玩家所有状态 */
  getAll(): Record<string, Value>;
  
  /** 批量更新玩家状态 */
  update(data: Record<string, Value>): Promise<void>;
  
  /** 删除玩家状态 */
  delete(key: string): Promise<void>;
}

/** 游戏实体类型示例 */
interface BulletData {
  owner: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  timestamp: number;
}

interface PlayerPosition {
  x: number;
  y: number;
  timestamp: number;
}

interface GameConfig {
  mapSize: 'small' | 'medium' | 'large';
  difficulty: 'easy' | 'normal' | 'hard';
  maxRounds: number;
  allowSpectators?: boolean;
  teamSettings?: {
    maxTeamSize: number;
    autoBalance: boolean;
  };
}
```

##### `ErrorResponse`

错误响应。

```typescript
interface ErrorResponse {
  /** 错误码 */
  code: number;
  
  /** 错误消息 */
  message: string;
  
  /** 错误详情（可选） */
  details?: string;
}
```

---

### 错误处理

#### 错误码定义

| 错误码范围 | 类别 | 说明 |
|-----------|------|------|
| 1000-1099 | 认证相关 | JWT验证、权限等问题 |
| 1100-1199 | 房间相关 | 房间不存在、已满等问题 |
| 1200-1299 | 状态同步 | 状态更新、权限等问题 |
| 1300-1399 | 网络相关 | 连接、超时等问题 |

#### 常见错误码

- `1001`: 无效的JWT Token
- `1002`: Token已过期
- `1101`: 房间不存在
- `1102`: 房间已满
- `1103`: 需要邀请码
- `1104`: 邀请码无效
- `1201`: 无权限更新状态
- `1202`: 状态值无效
- `1301`: 连接超时
- `1302`: 网络错误

#### 错误处理最佳实践

```typescript
// 1. 全局错误监听
client.on('error', (error: ErrorResponse) => {
  switch (error.code) {
    case 1001:
    case 1002:
      // Token相关错误，重新登录
      redirectToLogin();
      break;
    case 1101:
      showMessage('房间不存在');
      break;
    case 1102:
      showMessage('房间已满');
      break;
    default:
      showMessage('发生未知错误');
  }
});

// 2. 操作级错误处理
try {
  const room = await client.joinRoom('room-123');
} catch (error) {
  if (error.code === 1101) {
    console.log('房间不存在，创建新房间');
    const newRoom = await client.createRoom({
      name: 'New Game',
      gameMode: 'battle',
      maxPlayers: 4,
      visibility: RoomVisibility.PUBLIC
    });
  }
}
```

---

### 完整示例

#### 游戏大厅示例

```typescript
import { RealSyncClient, RoomStatus, RoomVisibility } from 'realsync-sdk';

class GameLobby {
  private client: RealSyncClient;
  private currentRoom: Room | null = null;

  constructor() {
    this.client = new RealSyncClient({
      apiKey: 'ak_1a2b3c4d5e6f7g8h9i0j', // ✨ 纯客户端开发
      tokenProvider: () => this.getAuthToken(),
      debug: process.env.NODE_ENV === 'development'
    });

    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.client.on('connected', () => {
      console.log('Connected to RealSync');
      this.loadRoomList();
    });

    this.client.on('error', (error) => {
      console.error('RealSync error:', error);
      this.handleError(error);
    });
  }

  async connect() {
    await this.client.connectAsync();
  }

  async loadRoomList() {
    try {
      const result = await this.client.getRoomList({
        statusFilter: RoomStatus.WAITING,
        visibilityFilter: RoomVisibility.PUBLIC,
        page: 1,
        pageSize: 20,
        sortBy: 'CREATED_AT',
        sortDescending: true
      });

      this.displayRooms(result.rooms);
      this.updatePagination(result.pagination);
    } catch (error) {
      console.error('Failed to load room list:', error);
    }
  }

  async createRoom(name: string, gameMode: string, maxPlayers: number) {
    try {
      const result = await this.client.createRoom({
        name,
        gameMode,
        maxPlayers,
        visibility: RoomVisibility.PUBLIC,
        initialState: {
          gamePhase: 'waiting',
          countdown: 60,
          allowSpectators: true,
          playerList: [],
          gameConfig: {
            mapSize: 'medium',
            difficulty: 'normal',
            maxRounds: 5
          }
        }
      });

      // 自动加入创建的房间
      await this.joinRoom(result.roomInfo.roomId);
    } catch (error) {
      console.error('Failed to create room:', error);
    }
  }

  async joinRoom(roomId: string) {
    try {
      const result = await this.client.joinRoom(roomId);
      this.currentRoom = result.room;
      
      console.log(`我的PlayerId: ${result.playerId}`);
      console.log(`房间内其他玩家:`, result.otherPlayers);
      
      this.setupRoomEventListeners();
      this.switchToGameView();
    } catch (error) {
      console.error('Failed to join room:', error);
    }
  }

  private setupRoomEventListeners() {
    if (!this.currentRoom) return;

    this.currentRoom.on('stateChange', (patches, sourcePlayerId) => {
      this.handleStateUpdate(patches, sourcePlayerId);
    });

    this.currentRoom.on('playerJoined', (playerInfo, roomInfo) => {
      this.addPlayerToUI(playerInfo);
      this.updatePlayerCount(roomInfo.playerCount, roomInfo.maxPlayers);
    });

    this.currentRoom.on('playerLeft', (playerId, roomInfo) => {
      this.removePlayerFromUI(playerId);
      this.updatePlayerCount(roomInfo.playerCount, roomInfo.maxPlayers);
    });
  }

  private handleStateUpdate(patches: StatePatches, sourcePlayerId: number) {
    Object.entries(patches).forEach(([key, value]) => {
      switch (key) {
        case 'countdown':
          this.updateCountdown(value as number);
          break;
        case 'gamePhase':
          this.updateGamePhase(value as string);
          break;
        default:
          if (key.startsWith('player_') && key.includes('_position')) {
            // 例如: "player_1_position" -> playerId = 1
            const playerId = parseInt(key.split('_')[1]);
            const position = value as { x: number; y: number };
            this.updatePlayerPosition(playerId, position);
          }
      }
    });
  }

  // UI 更新方法
  private displayRooms(rooms: RoomInfo[]) { /* 实现UI更新 */ }
  private updatePagination(pagination: PaginationInfo) { /* 实现分页UI */ }
  private switchToGameView() { /* 切换到游戏界面 */ }
  private addPlayerToUI(playerInfo: PlayerInfo) { /* 添加玩家到UI */ }
  private removePlayerFromUI(playerId: number) { /* 从UI移除玩家 */ }
  private updatePlayerCount(current: number, max: number) { /* 更新玩家数显示 */ }
  private updateCountdown(seconds: number) { /* 更新倒计时显示 */ }
  private updateGamePhase(phase: string) { /* 更新游戏阶段 */ }
  private updatePlayerPosition(playerId: number, position: any) { /* 更新玩家位置 */ }
  private handleError(error: ErrorResponse) { /* 处理错误 */ }
  private async getAuthToken(): Promise<string> { /* 获取认证Token */ return 'token'; }
}
```

#### 游戏内同步示例

```typescript
class GameSession {
  private room: Room;
  private playerId: number;

  constructor(room: Room, playerId: number) {
    this.room = room;
    this.playerId = playerId;
    this.setupGameLogic();
  }

  private setupGameLogic() {
    // 监听游戏状态变化
    this.room.on('stateChange', (patches, sourcePlayerId) => {
      if (sourcePlayerId !== this.playerId) {
        // 处理其他玩家的状态更新
        this.handleRemotePlayerUpdate(patches, sourcePlayerId);
      }
    });

    // 本地游戏循环
    setInterval(() => {
      this.gameLoop();
    }, 1000 / 60); // 60 FPS
  }

  // 玩家移动 - 使用分段式API
  async movePlayer(x: number, y: number) {
    await this.room.state.set(`player_${this.playerId}_position`, {
      x, y, timestamp: Date.now()
    });
  }

  // 玩家射击 - 使用分段式API
  async fireWeapon(targetX: number, targetY: number) {
    const bulletId = `bullet_${this.playerId}_${Date.now()}`;
    await this.room.state.set(bulletId, {
      owner: this.playerId,
      startX: this.playerX,
      startY: this.playerY,
      targetX,
      targetY,
      timestamp: Date.now()
    });
  }

  // 游戏循环
  private gameLoop() {
    // 本地游戏逻辑更新
    this.updateLocalPlayerPosition();
    this.updateBullets();
    this.checkCollisions();
    this.render();
  }

  private handleRemotePlayerUpdate(patches: StatePatches, sourcePlayerId: number) {
    Object.entries(patches).forEach(([key, value]) => {
      if (key.startsWith('player_') && key.includes('_position')) {
        const position = value as { x: number; y: number; timestamp: number };
        this.updateRemotePlayerPosition(sourcePlayerId, position);
      } else if (key.startsWith('bullet_')) {
        const bullet = value as BulletData;
        this.spawnBullet(bullet);
      }
    });
  }

  // 游戏逻辑实现
  private updateLocalPlayerPosition() { /* 本地玩家位置更新 */ }
  private updateBullets() { /* 子弹更新 */ }
  private checkCollisions() { /* 碰撞检测 */ }
  private render() { /* 渲染游戏画面 */ }
  private updateRemotePlayerPosition(playerId: number, position: any) { /* 更新远程玩家位置 */ }
  private spawnBullet(bullet: any) { /* 生成子弹 */ }
}
```

---

## C# SDK

> 🚧 **开发中** - C# SDK的详细API文档正在开发中，将支持以下特性：
> 
> - Unity集成优化
> - 主线程调度器
> - 协程和async/await双重支持
> - Inspector友好的配置
> - 完整的类型安全

### 预览API

```csharp
// 基本用法预览
var client = new RealSyncClient(new ClientOptions {
    // 🔑 必需：应用API密钥
    ApiKey = "ak_1a2b3c4d5e6f7g8h9i0j", // 从RealSync控制台获取
    
    // 🌐 可选：服务器地址
    ServerUrl = "wss://connect.realsync.io",
    
    // 🔐 必需：用户身份令牌提供者
    TokenProvider = () => Task.FromResult(GetAuthToken()),
    
    // ⚙️ 可选配置
    ReconnectAttempts = 5,
    ReconnectDelay = 1000,
    HeartbeatInterval = 30000,
    Debug = false
});

await client.ConnectAsync();
var roomList = await client.GetRoomListAsync(new GetRoomListRequest { ... });
var room = await client.JoinRoomAsync("room-123");

// 事件监听
room.OnStateChange += (patches, sourcePlayerId) => {
    // Unity主线程中处理状态更新
};
```

#### Unity环境配置示例

```csharp
// Unity ScriptableObject配置
[CreateAssetMenu(fileName = "RealSyncConfig", menuName = "RealSync/Config")]
public class RealSyncConfig : ScriptableObject
{
    [Header("🔑 认证配置")]
    [SerializeField] private string apiKey = "ak_your_api_key_here";
    
    [Header("🌐 连接配置")]
    [SerializeField] private string serverUrl = "wss://connect.realsync.io";
    
    [Header("⚙️ 性能配置")]
    [SerializeField] private int reconnectAttempts = 5;
    [SerializeField] private int reconnectDelay = 1000;
    [SerializeField] private bool debugMode = false;

    public ClientOptions GetClientOptions()
    {
        return new ClientOptions
        {
            ApiKey = apiKey,
            ServerUrl = serverUrl,
            TokenProvider = async () => await GetUserToken(),
            ReconnectAttempts = reconnectAttempts,
            ReconnectDelay = reconnectDelay,
            Debug = debugMode
        };
    }
    
    private async Task<string> GetUserToken()
    {
        // 从Unity Authentication或自定义认证系统获取token
        // 示例使用Unity Authentication
        if (AuthenticationService.Instance.IsSignedIn)
        {
            return await AuthenticationService.Instance.GetAccessTokenAsync();
        }
        
        throw new InvalidOperationException("User not authenticated");
    }
}

// Unity游戏管理器
public class GameManager : MonoBehaviour
{
    [SerializeField] private RealSyncConfig config;
    private RealSyncClient client;
    
    async void Start()
    {
        // ✨ 纯客户端开发：API密钥可以安全地包含在Unity构建中
        client = new RealSyncClient(config.GetClientOptions());
        
        try
        {
            await client.ConnectAsync();
            Debug.Log("✅ Connected to RealSync");
        }
        catch (Exception e)
        {
            Debug.LogError($"❌ Failed to connect: {e.Message}");
        }
    }
}
```

> 📝 **计划发布时间**: 2024年Q1  
> 📧 **反馈**: 如需提前体验或提供反馈，请联系开发团队

---

## 更新日志

### v1.0.0 (2024-01-01)
- ✨ 初始版本发布
- 🚀 TypeScript SDK完整API
- 📚 完整API文档
- 🔧 基础错误处理机制

---

## 支持与反馈

- 📖 **文档**: [RealSync 官方文档](../design/architecture.md)
- 🐛 **Bug报告**: [GitHub Issues](https://github.com/realsync/realsync/issues)
- 💬 **社区讨论**: [Discord社区](https://discord.gg/realsync)
- 📧 **邮件支持**: support@realsync.io 
# RealSync - 实时多人游戏同步框架

> **让每个游戏开发者都能轻松构建稳定、高性能的多人在线游戏**

RealSync 是一款为小型/UGC游戏开发者设计的、开箱即用、免后端的实时同步解决方案。通过简单易用的SDK和强大的云端基础设施，让开发者能够快速构建从小型休闲游戏到io类的多种多人游戏。

## ✨ 核心特色

### 🚀 **纯客户端开发**
- **零后端门槛**: 像Firebase一样，支持完全的前端开发
- **API密钥安全**: 设计为客户端安全，可直接在前端使用
- **快速上手**: 几行代码即可实现多人游戏功能

### 🎮 **直观的开发体验**
- **分段式API**: `room.state.set('playerHealth', 85)`
- **智能网络优化**: SDK内部自动批量合并，保证性能
- **TypeScript友好**: 完整的类型定义和智能提示

### 🏗️ **灵活的架构设计**
- **多租户支持**: 完善的应用隔离和权限控制
- **可扩展架构**: 支持未来独立状态服务和云函数扩展
- **跨平台SDK**: 支持Web、Unity等多平台

## 🚦 快速开始

### 安装SDK

```bash
npm install realsync-sdk
```

### 10分钟上手体验

```typescript
import { RealSyncClient, RoomVisibility } from 'realsync-sdk';

// 1. 初始化客户端
const client = new RealSyncClient({
  apiKey: 'your-api-key',
  tokenProvider: async () => await getAuthToken()
});

// 2. 连接服务器
await client.connect();

// 3. 创建房间
const room = await client.createRoom({
  name: '我的游戏房间',
  gameMode: 'battle',
  maxPlayers: 4,
  visibility: RoomVisibility.PUBLIC
});

// 4. 实时状态同步
await room.state.set('gameStarted', true);
await room.state.set('currentPlayer', 1);

// 5. 监听状态变化
room.onStateChange((event) => {
  console.log('状态更新:', event.patches);
});
```

## 🏛️ 项目架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Client SDKs                            │
│   Web SDK    │   Unity SDK   │   React Native SDK         │
├─────────────────────────────────────────────────────────────┤
│                     Gateway API                             │
│           WebSocket + HTTP RESTful API                     │
├─────────────────────────────────────────────────────────────┤
│                  Business Services                          │
│   Room Service   │   Game Session   │   Cloud Functions   │
├─────────────────────────────────────────────────────────────┤
│                  Storage & Compute                          │
│   Redis Cluster  │   State Service  │   Serverless        │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

- **前端**: TypeScript + WebSocket + Protocol Buffers
- **后端**: Node.js + Redis Cluster + WebSocket
- **数据存储**: Redis + 多维度索引设计
- **消息协议**: Protocol Buffers (跨语言一致性)
- **网络优化**: 自动批量合并 + 智能冲突解决

## 📂 项目结构

```
/realsync/
├── apps/
│   └── gateway/              # Node.js 网关服务
├── packages/
│   ├── sdk-ts/               # TypeScript 客户端SDK
│   ├── sdk-csharp/           # C# 客户端SDK (规划中)
│   └── protocol/             # Protobuf 协议定义
├── examples/
│   └── simple-game/          # 多人画板演示
├── docs/                     # 技术文档
└── README.md
```

## 🛠️ 开发环境搭建

### 环境要求

- Node.js >= 18.0.0
- Redis >= 6.0
- pnpm >= 8.0.0

### 克隆并启动项目

```bash
# 克隆项目
git clone <repository-url>
cd realsync

# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 启动网关服务
cd apps/gateway
cp .env.example .env
# 编辑 .env 文件配置Redis等
pnpm dev

# 启动演示游戏（新终端）
cd examples/simple-game
pnpm dev
```

### 环境配置

在 `apps/gateway/.env` 中配置：

```env
PORT=8080
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key-here
HEARTBEAT_INTERVAL=30000
MAX_CONNECTIONS=10000
```

## 🎨 演示项目

我们提供了一个完整的多人协作画板演示，展示了RealSync的核心功能：

- **实时状态同步**: 多人同时绘画，实时看到其他玩家的笔画
- **房间管理**: 创建、加入、离开房间
- **玩家管理**: 显示在线玩家列表，房主权限
- **乐观更新**: 本地操作立即生效，保证流畅体验

启动演示：

```bash
# 启动网关服务
cd apps/gateway && pnpm dev

# 启动演示游戏
cd examples/simple-game && pnpm dev
```

打开多个浏览器窗口测试多人功能！

## 📖 API参考

### 客户端初始化

```typescript
const client = new RealSyncClient({
  apiKey: string;                    // 应用API密钥
  serverUrl?: string;                // 服务器地址
  tokenProvider: () => Promise<string>; // 用户认证令牌提供者
  reconnectAttempts?: number;        // 重连次数
  reconnectDelay?: number;           // 重连延迟
  heartbeatInterval?: number;        // 心跳间隔
  debug?: boolean;                   // 调试模式
});
```

### 房间管理

```typescript
// 创建房间
const room = await client.createRoom({
  name: string;              // 房间名称
  gameMode: string;          // 游戏模式
  maxPlayers: number;        // 最大玩家数
  visibility?: RoomVisibility; // 可见性
  customData?: Record<string, any>; // 自定义数据
});

// 加入房间
const room = await client.joinRoom({
  roomId: string;            // 房间ID
  displayName: string;       // 显示名称
  playerMetadata?: Record<string, any>; // 玩家元数据
});

// 列出房间
const rooms = await client.listRooms({
  gameMode?: string;         // 按游戏模式筛选
  visibility?: RoomVisibility; // 按可见性筛选
  limit?: number;            // 限制返回数量
});
```

### 状态同步

```typescript
// 设置状态
await room.state.set('playerHealth', 100);
await room.state.set('player.position', { x: 10, y: 20 });

// 获取状态
const health = room.state.get('playerHealth');
const position = room.state.get('player.position');

// 数值操作
await room.state.increment('score', 10);

// 数组操作
await room.state.append('chatMessages', ['Hello World']);

// 批量操作
await room.state.batch([
  { operation: 'set', path: 'gameState', value: 'playing' },
  { operation: 'increment', path: 'round', value: 1 }
]);

// 监听状态变化
room.state.onChange((patches) => {
  console.log('状态变更:', patches);
});

// 监听特定路径变化
room.state.onPathChange('playerHealth', (value) => {
  console.log('血量变化:', value);
});
```

### 事件监听

```typescript
// 监听玩家加入
room.onPlayerJoined((event) => {
  console.log(`${event.player.displayName} 加入了游戏`);
});

// 监听玩家离开
room.onPlayerLeft((event) => {
  console.log(`玩家 ${event.playerId} 离开了游戏`);
});

// 监听状态变更
room.onStateChange((event) => {
  console.log('收到状态更新:', event.patches);
});
```

## 🔧 开发指南

### SDK开发

```bash
# 开发TypeScript SDK
cd packages/sdk-ts
pnpm dev

# 构建SDK
pnpm build
```

### 网关服务开发

```bash
# 开发网关服务
cd apps/gateway
pnpm dev

# 类型检查
pnpm type-check
```

### 协议开发

```bash
# 编译Protocol Buffers
cd packages/protocol
pnpm build
```

## 🧪 测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm --filter @realsync/gateway test
pnpm --filter realsync-sdk test
```

## 📊 性能指标

当前MVP版本性能目标：

- **房间容量**: 单房间支持 2-12 人
- **状态字段**: 10,000+ 个状态字段
- **更新频率**: 80 次/秒状态更新
- **延迟**: < 50ms 状态同步延迟
- **并发**: 单服务器支持 1000+ 并发连接

## 🛣️ 发展路线

### 📋 第一阶段 - 核心MVP (当前)
- ✅ TypeScript SDK
- ✅ 基础房间管理和状态同步
- ✅ 演示项目
- 🔄 压力测试和优化

### 🎮 第二阶段 - 功能完善
- Unity C# SDK开发
- 微信小游戏适配
- 开发者控制台
- 性能优化和监控

### ☁️ 第三阶段 - 云端扩展
- 云函数托管平台
- 独立游戏状态服务
- 全球化部署
- 高级分析工具

### 🌐 第四阶段 - 生态完善
- 游戏引擎深度集成
- 第三方服务集成
- 开放平台
- 企业级功能

## 🤝 贡献指南

我们欢迎社区贡献！请查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解如何参与开发。

### 开发规范

- **TypeScript**: 严格类型检查，使用ESLint
- **命名约定**: 驼峰命名，接口以`I`开头
- **提交信息**: 使用 `feat/fix/docs/refactor` 前缀
- **代码覆盖率**: 核心模块 > 80%

## 📝 许可证

MIT License - 查看 [LICENSE](./LICENSE) 文件了解详细信息。

## 🔗 相关链接

- [技术文档](./docs/)
- [API参考](./docs/design/sdk-api-reference.md)
- [架构设计](./docs/design/architecture.md)
- [协议设计](./docs/design/protocol-design.md)

## 💡 支持

- 📧 Email: support@realsync.io
- 💬 Discord: [RealSync Community](https://discord.gg/realsync)
- 🐛 Bug Reports: [GitHub Issues](https://github.com/realsync/realsync/issues)

---

**让我们一起构建更好的多人游戏体验！** 🎮✨
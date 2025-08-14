# RealSync 贡献指南

感谢您对 RealSync 项目的关注！我们非常欢迎社区的贡献，无论是代码、文档、Bug报告还是功能建议。

## 🤝 如何贡献

### 报告Bug

如果您发现了Bug，请：

1. 检查 [Issues](https://github.com/realsync/realsync/issues) 确认没有重复
2. 创建新的Issue，包含：
   - 清晰的Bug描述
   - 复现步骤
   - 期望结果 vs 实际结果
   - 环境信息（OS、Node.js版本等）
   - 错误日志（如果有）

### 功能建议

对于新功能建议：

1. 先在 [Issues](https://github.com/realsync/realsync/issues) 中讨论
2. 描述功能的用例和价值
3. 考虑对现有API的影响
4. 等待维护者反馈后再开始开发

### 代码贡献

1. **Fork** 项目
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 **Pull Request**

## 🛠️ 开发环境设置

### 环境要求

- Node.js >= 18.0.0
- Redis >= 6.0
- pnpm >= 8.0.0

### 初始化项目

```bash
# 克隆您的fork
git clone https://github.com/your-username/realsync.git
cd realsync

# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test
```

### 启动开发环境

```bash
# 启动Redis（如果没有运行）
redis-server

# 启动网关服务
cd apps/gateway
cp .env.example .env
pnpm dev

# 启动演示项目（新终端）
cd examples/simple-game
pnpm dev
```

## 📝 代码规范

### TypeScript规范

- 使用严格的TypeScript配置
- 所有公共API必须有类型定义
- 优先使用interface而不是type
- 接口命名以`I`开头（如`IPlayerData`）

```typescript
// ✅ 好的例子
interface IPlayerData {
  playerId: number;
  displayName: string;
  isOnline: boolean;
}

// ❌ 避免的例子
type PlayerData = {
  playerId: any;
  displayName: any;
}
```

### 命名约定

- **变量/函数**: camelCase (`getUserData`)
- **类/接口**: PascalCase (`RealSyncClient`, `IUserData`)
- **常量**: UPPER_SNAKE_CASE (`MAX_PLAYERS`)
- **文件名**: kebab-case (`real-sync-client.ts`)

### 代码组织

```typescript
// 文件顶部：导入
import { ... } from '...';

// 类型定义
interface ILocalTypes {
  // ...
}

// 主要实现
export class MyClass {
  // 公共属性
  public readonly id: string;
  
  // 私有属性
  private config: IConfig;
  
  // 构造函数
  constructor(config: IConfig) {
    // ...
  }
  
  // 公共方法
  public async doSomething(): Promise<void> {
    // ...
  }
  
  // 私有方法
  private helperMethod(): void {
    // ...
  }
}
```

### 错误处理

```typescript
// ✅ 明确的错误类型
class RealSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'RealSyncError';
  }
}

// ✅ 适当的错误边界
public async connect(): Promise<void> {
  try {
    await this.establishConnection();
  } catch (error) {
    throw new RealSyncError(
      'Failed to connect to server',
      'CONNECTION_FAILED',
      { originalError: error }
    );
  }
}
```

## 🧪 测试规范

### 测试覆盖率要求

- 核心模块：> 80%
- SDK公共API：> 90%
- 工具函数：> 95%

### 测试文件组织

```
src/
├── services/
│   ├── room.service.ts
│   └── room.service.test.ts
├── utils/
│   ├── redis-keys.ts
│   └── redis-keys.test.ts
```

### 测试示例

```typescript
describe('RoomService', () => {
  let roomService: RoomService;
  let mockRedis: jest.Mocked<RedisService>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    roomService = new RoomService(mockRedis);
  });

  describe('createRoom', () => {
    it('should create room with valid parameters', async () => {
      // Arrange
      const roomData = {
        name: 'Test Room',
        gameMode: 'test',
        maxPlayers: 4,
        visibility: 'PUBLIC' as const
      };

      // Act
      const result = await roomService.createRoom('app123', 'user456', roomData);

      // Assert
      expect(result.roomId).toMatch(/^room_\d+_[a-z0-9]+$/);
      expect(result.metadata.name).toBe('Test Room');
    });
  });
});
```

## 📝 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### 类型

- `feat`: 新功能
- `fix`: Bug修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 添加或修改测试
- `chore`: 构建过程或辅助工具的变动

### 示例

```
feat(sdk): add room state subscription
fix(gateway): resolve memory leak in websocket connections
docs(readme): update quick start guide
test(room-service): add unit tests for room creation
```

## 🔍 Pull Request 指南

### PR标题

遵循提交信息规范，清晰描述更改内容。

### PR描述模板

```markdown
## 变更类型
- [ ] Bug修复
- [ ] 新功能
- [ ] 破坏性变更
- [ ] 文档更新

## 变更描述
<!-- 简要描述此PR的内容 -->

## 测试
- [ ] 添加了新的单元测试
- [ ] 所有现有测试通过
- [ ] 手动测试通过

## 检查清单
- [ ] 代码遵循项目编码规范
- [ ] 自我审查了代码
- [ ] 添加了必要的注释
- [ ] 更新了相关文档
- [ ] 测试覆盖率达标

## 截图/GIF
<!-- 如果适用，添加截图或GIF演示 -->
```

### 代码审查流程

1. **自动检查**: CI会自动运行测试、类型检查、代码规范检查
2. **人工审查**: 至少需要一个维护者的批准
3. **测试验证**: 确保所有测试通过
4. **文档检查**: 确保API变更有对应的文档更新

## 📚 文档贡献

### 文档类型

- **API文档**: 在代码中使用JSDoc
- **用户指南**: Markdown文档
- **示例代码**: 完整可运行的示例

### 文档规范

```typescript
/**
 * 创建新的游戏房间
 * 
 * @param params - 房间创建参数
 * @param params.name - 房间名称，1-50字符
 * @param params.gameMode - 游戏模式标识符
 * @param params.maxPlayers - 最大玩家数，2-100
 * @param params.visibility - 房间可见性
 * @returns Promise<RoomInstance> 房间实例
 * 
 * @example
 * ```typescript
 * const room = await client.createRoom({
 *   name: '我的房间',
 *   gameMode: 'battle',
 *   maxPlayers: 8,
 *   visibility: RoomVisibility.PUBLIC
 * });
 * ```
 * 
 * @throws {RealSyncError} 当参数无效或创建失败时
 */
public async createRoom(params: CreateRoomParams): Promise<RoomInstance>
```

## 🐛 调试指南

### 启用调试模式

```typescript
// 客户端调试
const client = new RealSyncClient({
  // ...
  debug: true
});

// 服务端调试
DEBUG=realsync:* pnpm dev
```

### 常见问题排查

1. **连接问题**
   - 检查Redis是否运行
   - 检查端口是否被占用
   - 检查防火墙设置

2. **认证问题**
   - 验证JWT密钥配置
   - 检查token格式和有效期

3. **状态同步问题**
   - 检查网络连接状态
   - 查看浏览器控制台错误
   - 启用SDK调试模式

## 📞 获取帮助

如果您在贡献过程中遇到问题：

1. 查看 [文档](./docs/)
2. 搜索现有 [Issues](https://github.com/realsync/realsync/issues)
3. 在 [Discussions](https://github.com/realsync/realsync/discussions) 中提问
4. 联系维护者

## 🙏 致谢

感谢所有为 RealSync 项目做出贡献的开发者！

您的贡献让这个项目变得更好。 🎉
import 'dotenv/config';
import { GatewayService } from './services/gateway.service';
import { GatewayConfig } from './types';

async function main() {
  // 从环境变量读取配置
  const config: GatewayConfig = {
    port: parseInt(process.env.PORT || '8080'),
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret-key',
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000'),
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '10000')
  };

  console.log('Starting RealSync Gateway...');
  console.log(`Configuration:`, {
    port: config.port,
    redisUrl: config.redisUrl.replace(/\/\/.*@/, '//***@'), // 隐藏密码
    heartbeatInterval: config.heartbeatInterval,
    maxConnections: config.maxConnections
  });

  const gateway = new GatewayService(config);

  // 优雅关闭处理
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await gateway.stop();
      console.log('Gateway stopped successfully');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await gateway.start();
    
    // 定期打印统计信息
    setInterval(() => {
      const stats = gateway.getStats();
      console.log(`Stats: ${stats.totalConnections} connections, ${stats.authenticatedConnections} authenticated, ${stats.activeRooms} active rooms`);
    }, 60000); // 每分钟打印一次

  } catch (error) {
    console.error('Failed to start gateway:', error);
    process.exit(1);
  }
}

// 启动服务
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
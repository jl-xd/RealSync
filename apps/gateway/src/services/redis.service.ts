import Redis from 'ioredis';

export class RedisService {
  private static instance: RedisService;
  private redis: Redis;
  private subscriber: Redis;

  private constructor(redisUrl: string) {
    // 主连接用于读写操作
    this.redis = new Redis(redisUrl, {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    // 订阅连接用于pub/sub
    this.subscriber = new Redis(redisUrl, {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.setupErrorHandlers();
  }

  public static getInstance(redisUrl?: string): RedisService {
    if (!RedisService.instance) {
      if (!redisUrl) {
        throw new Error('Redis URL is required for first initialization');
      }
      RedisService.instance = new RedisService(redisUrl);
    }
    return RedisService.instance;
  }

  private setupErrorHandlers(): void {
    this.redis.on('error', (err) => {
      console.error('Redis error:', err);
    });

    this.subscriber.on('error', (err) => {
      console.error('Redis subscriber error:', err);
    });

    this.redis.on('connect', () => {
      console.log('Redis connected');
    });

    this.subscriber.on('connect', () => {
      console.log('Redis subscriber connected');
    });
  }

  public async connect(): Promise<void> {
    await Promise.all([
      this.redis.connect(),
      this.subscriber.connect()
    ]);
  }

  public async disconnect(): Promise<void> {
    await Promise.all([
      this.redis.disconnect(),
      this.subscriber.disconnect()
    ]);
  }

  // === 基础操作 ===
  
  public async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  public async set(key: string, value: string, ttl?: number): Promise<'OK'> {
    if (ttl) {
      return this.redis.setex(key, ttl, value);
    }
    return this.redis.set(key, value);
  }

  public async del(key: string): Promise<number> {
    return this.redis.del(key);
  }

  public async exists(key: string): Promise<number> {
    return this.redis.exists(key);
  }

  // === Hash操作 ===
  
  public async hget(key: string, field: string): Promise<string | null> {
    return this.redis.hget(key, field);
  }

  public async hset(key: string, field: string, value: string): Promise<number> {
    return this.redis.hset(key, field, value);
  }

  public async hmset(key: string, data: Record<string, string>): Promise<'OK'> {
    return this.redis.hmset(key, data);
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }

  public async hdel(key: string, field: string): Promise<number> {
    return this.redis.hdel(key, field);
  }

  public async hlen(key: string): Promise<number> {
    return this.redis.hlen(key);
  }

  // === Set操作 ===
  
  public async sadd(key: string, member: string): Promise<number> {
    return this.redis.sadd(key, member);
  }

  public async srem(key: string, member: string): Promise<number> {
    return this.redis.srem(key, member);
  }

  public async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  public async scard(key: string): Promise<number> {
    return this.redis.scard(key);
  }

  // === 有序集合操作 ===
  
  public async zadd(key: string, score: number, member: string): Promise<number> {
    return this.redis.zadd(key, score, member);
  }

  public async zrem(key: string, member: string): Promise<number> {
    return this.redis.zrem(key, member);
  }

  public async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.zrange(key, start, stop);
  }

  public async zcard(key: string): Promise<number> {
    return this.redis.zcard(key);
  }

  // === Pub/Sub操作 ===
  
  public async publish(channel: string, message: string): Promise<number> {
    return this.redis.publish(channel, message);
  }

  public async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        callback(message);
      }
    });
  }

  public async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  // === 事务操作 ===
  
  public async multi(commands: Array<() => Promise<any>>): Promise<any[]> {
    const pipeline = this.redis.multi();
    
    for (const cmd of commands) {
      await cmd.call(pipeline);
    }
    
    const results = await pipeline.exec();
    if (!results) {
      throw new Error('Transaction failed');
    }
    
    return results.map(([err, result]) => {
      if (err) throw err;
      return result;
    });
  }

  // === Lua脚本执行 ===
  
  public async eval(script: string, keys: string[], args: string[]): Promise<any> {
    return this.redis.eval(script, keys.length, ...keys, ...args);
  }

  // 获取原始Redis客户端（用于复杂操作）
  public getClient(): Redis {
    return this.redis;
  }

  public getSubscriber(): Redis {
    return this.subscriber;
  }
}
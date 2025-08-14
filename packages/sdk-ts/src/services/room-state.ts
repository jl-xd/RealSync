import { StatePatch, StateUpdateOptions, EventListener } from '../types';

/**
 * 房间状态管理器
 * 提供便捷的状态读写API
 */
export class RoomState {
  private state: Record<string, any> = {};
  private updateCallback: ((patches: StatePatch[], options?: StateUpdateOptions) => Promise<void>) | null = null;
  private listeners: Record<string, EventListener[]> = {};

  constructor() {
    this.state = {};
  }

  /**
   * 设置状态更新回调
   */
  public setUpdateCallback(callback: (patches: StatePatch[], options?: StateUpdateOptions) => Promise<void>): void {
    this.updateCallback = callback;
  }

  /**
   * 应用状态补丁（来自服务器）
   */
  public applyPatches(patches: StatePatch[]): void {
    for (const patch of patches) {
      this.applyPatch(patch);
    }
    
    // 触发变更事件
    this.emit('change', patches);
  }

  /**
   * 设置状态值
   */
  public async set(path: string, value: any, options?: StateUpdateOptions): Promise<void> {
    const patch: StatePatch = { path, value, op: 'SET' };
    
    // 乐观更新
    if (!options?.skipOptimisticUpdate) {
      this.applyPatch(patch);
    }
    
    // 发送到服务器
    if (this.updateCallback) {
      await this.updateCallback([patch], options);
    }
  }

  /**
   * 获取状态值
   */
  public get(path: string): any {
    return this.getValueByPath(this.state, path);
  }

  /**
   * 删除状态键
   */
  public async delete(path: string, options?: StateUpdateOptions): Promise<void> {
    const patch: StatePatch = { path, value: null, op: 'DELETE' };
    
    // 乐观更新
    if (!options?.skipOptimisticUpdate) {
      this.applyPatch(patch);
    }
    
    // 发送到服务器
    if (this.updateCallback) {
      await this.updateCallback([patch], options);
    }
  }

  /**
   * 数值增加
   */
  public async increment(path: string, value: number, options?: StateUpdateOptions): Promise<void> {
    const patch: StatePatch = { path, value, op: 'INCREMENT' };
    
    // 乐观更新
    if (!options?.skipOptimisticUpdate) {
      const current = this.get(path) || 0;
      this.setValueByPath(this.state, path, current + value);
    }
    
    // 发送到服务器
    if (this.updateCallback) {
      await this.updateCallback([patch], options);
    }
  }

  /**
   * 数组追加
   */
  public async append(path: string, items: any[], options?: StateUpdateOptions): Promise<void> {
    const patch: StatePatch = { path, value: items, op: 'APPEND' };
    
    // 乐观更新
    if (!options?.skipOptimisticUpdate) {
      const current = this.get(path) || [];
      if (Array.isArray(current)) {
        this.setValueByPath(this.state, path, [...current, ...items]);
      }
    }
    
    // 发送到服务器
    if (this.updateCallback) {
      await this.updateCallback([patch], options);
    }
  }

  /**
   * 批量更新
   */
  public async batch(updates: Array<{
    operation: 'set' | 'delete' | 'increment' | 'append';
    path: string;
    value?: any;
  }>, options?: StateUpdateOptions): Promise<void> {
    const patches: StatePatch[] = updates.map(update => {
      const opMap = {
        'set': 'SET',
        'delete': 'DELETE',
        'increment': 'INCREMENT',
        'append': 'APPEND'
      } as const;
      
      return {
        path: update.path,
        value: update.value,
        op: opMap[update.operation]
      };
    });

    // 乐观更新
    if (!options?.skipOptimisticUpdate) {
      this.applyPatches(patches);
    }

    // 发送到服务器
    if (this.updateCallback) {
      await this.updateCallback(patches, options);
    }
  }

  /**
   * 获取完整状态
   */
  public getAll(): Record<string, any> {
    return { ...this.state };
  }

  /**
   * 设置完整状态（用于初始化）
   */
  public setState(newState: Record<string, any>): void {
    this.state = { ...newState };
    this.emit('change', []);
  }

  /**
   * 清空状态
   */
  public clear(): void {
    this.state = {};
    this.emit('change', []);
  }

  /**
   * 监听状态变更
   */
  public onChange(listener: EventListener<StatePatch[]>): () => void {
    this.on('change', listener);
    return () => this.off('change', listener);
  }

  /**
   * 监听特定路径的变更
   */
  public onPathChange(path: string, listener: EventListener<any>): () => void {
    const wrappedListener = (patches: StatePatch[]) => {
      for (const patch of patches) {
        if (patch.path === path || patch.path.startsWith(path + '.')) {
          listener(this.get(path));
          break;
        }
      }
    };
    
    this.on('change', wrappedListener);
    return () => this.off('change', wrappedListener);
  }

  // 私有方法

  private applyPatch(patch: StatePatch): void {
    const { path, value, op } = patch;
    
    switch (op) {
      case 'SET':
        this.setValueByPath(this.state, path, value);
        break;
      case 'DELETE':
        this.deleteValueByPath(this.state, path);
        break;
      case 'INCREMENT':
        const current = this.getValueByPath(this.state, path) || 0;
        this.setValueByPath(this.state, path, current + value);
        break;
      case 'APPEND':
        const currentArray = this.getValueByPath(this.state, path) || [];
        if (Array.isArray(currentArray)) {
          this.setValueByPath(this.state, path, [...currentArray, ...value]);
        }
        break;
    }
  }

  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  private setValueByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  private deleteValueByPath(obj: any, path: string): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        return; // 路径不存在
      }
      current = current[key];
    }
    
    delete current[keys[keys.length - 1]];
  }

  // 事件系统
  private on(event: string, listener: EventListener): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  private off(event: string, listener: EventListener): void {
    if (this.listeners[event]) {
      const index = this.listeners[event].indexOf(listener);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error('Error in state change listener:', error);
        }
      });
    }
  }
}
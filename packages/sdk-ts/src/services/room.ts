import {
  Room,
  Player,
  StatePatch,
  StateChangeEvent,
  PlayerJoinedEvent,
  PlayerLeftEvent,
  RoomUpdatedEvent,
  EventListener,
  StateUpdateOptions
} from '../types';
import { RoomState } from './room-state';

/**
 * 房间实例
 * 代表用户当前加入的房间
 */
export class RoomInstance {
  public readonly roomId: string;
  public readonly state: RoomState;
  
  private roomInfo: Room;
  private currentPlayer: Player | null = null;
  private players: Map<number, Player> = new Map();
  private listeners: Record<string, EventListener[]> = {};
  private sendMessage: (type: string, payload: any) => Promise<any>;

  constructor(
    roomId: string,
    roomInfo: Room,
    currentPlayer: Player,
    allPlayers: Player[],
    initialState: Record<string, any>,
    sendMessage: (type: string, payload: any) => Promise<any>
  ) {
    this.roomId = roomId;
    this.roomInfo = roomInfo;
    this.currentPlayer = currentPlayer;
    this.sendMessage = sendMessage;
    
    // 初始化玩家列表
    for (const player of allPlayers) {
      this.players.set(player.playerId, player);
    }
    
    // 初始化状态管理器
    this.state = new RoomState();
    this.state.setState(initialState);
    this.state.setUpdateCallback(this.handleStateUpdate.bind(this));
  }

  /**
   * 获取房间信息
   */
  public getRoomInfo(): Room {
    return { ...this.roomInfo };
  }

  /**
   * 获取当前玩家信息
   */
  public getCurrentPlayer(): Player | null {
    return this.currentPlayer ? { ...this.currentPlayer } : null;
  }

  /**
   * 获取所有玩家
   */
  public getAllPlayers(): Player[] {
    return Array.from(this.players.values()).map(p => ({ ...p }));
  }

  /**
   * 根据ID获取玩家
   */
  public getPlayer(playerId: number): Player | null {
    const player = this.players.get(playerId);
    return player ? { ...player } : null;
  }

  /**
   * 检查是否为房主
   */
  public isHost(): boolean {
    return this.currentPlayer?.isHost ?? false;
  }

  /**
   * 离开房间
   */
  public async leave(): Promise<void> {
    await this.sendMessage('leave_room', {});
  }

  /**
   * 监听状态变更事件
   */
  public onStateChange(listener: EventListener<StateChangeEvent>): () => void {
    this.on('stateChange', listener);
    return () => this.off('stateChange', listener);
  }

  /**
   * 监听玩家加入事件
   */
  public onPlayerJoined(listener: EventListener<PlayerJoinedEvent>): () => void {
    this.on('playerJoined', listener);
    return () => this.off('playerJoined', listener);
  }

  /**
   * 监听玩家离开事件
   */
  public onPlayerLeft(listener: EventListener<PlayerLeftEvent>): () => void {
    this.on('playerLeft', listener);
    return () => this.off('playerLeft', listener);
  }

  /**
   * 监听房间信息更新事件
   */
  public onRoomUpdated(listener: EventListener<RoomUpdatedEvent>): () => void {
    this.on('roomUpdated', listener);
    return () => this.off('roomUpdated', listener);
  }

  /**
   * 处理状态变更事件（内部方法）
   */
  public handleStateChangeEvent(event: StateChangeEvent): void {
    // 应用状态变更
    this.state.applyPatches(event.patches);
    
    // 触发事件
    this.emit('stateChange', event);
  }

  /**
   * 处理玩家加入事件（内部方法）
   */
  public handlePlayerJoinedEvent(event: PlayerJoinedEvent): void {
    const { player } = event;
    this.players.set(player.playerId, player);
    this.roomInfo.currentPlayers = this.players.size;
    
    this.emit('playerJoined', event);
  }

  /**
   * 处理玩家离开事件（内部方法）
   */
  public handlePlayerLeftEvent(event: PlayerLeftEvent): void {
    const { playerId } = event;
    this.players.delete(playerId);
    this.roomInfo.currentPlayers = this.players.size;
    
    this.emit('playerLeft', event);
  }

  /**
   * 处理房间更新事件（内部方法）
   */
  public handleRoomUpdatedEvent(event: RoomUpdatedEvent): void {
    this.roomInfo = event.room;
    this.emit('roomUpdated', event);
  }

  // 私有方法

  private async handleStateUpdate(patches: StatePatch[], options?: StateUpdateOptions): Promise<void> {
    await this.sendMessage('update_state', {
      patches
    });
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
          console.error('Error in room event listener:', error);
        }
      });
    }
  }
}
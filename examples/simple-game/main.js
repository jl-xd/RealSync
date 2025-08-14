import { RealSyncClient, RoomVisibility, ConnectionState } from 'realsync-sdk';
import jwt from 'jsonwebtoken';

class DrawingGame {
    constructor() {
        this.client = null;
        this.room = null;
        this.canvas = null;
        this.ctx = null;
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentSize = 3;
        this.lastX = 0;
        this.lastY = 0;
        
        this.init();
    }

    init() {
        // 获取DOM元素
        this.canvas = document.getElementById('drawingCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // 设置画布样式
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // 绑定事件
        this.bindEvents();
        
        // 初始化客户端
        this.initClient();
    }

    bindEvents() {
        // 画布事件
        this.canvas.addEventListener('mousedown', this.startDrawing.bind(this));
        this.canvas.addEventListener('mousemove', this.draw.bind(this));
        this.canvas.addEventListener('mouseup', this.stopDrawing.bind(this));
        this.canvas.addEventListener('mouseout', this.stopDrawing.bind(this));

        // 控制按钮
        document.getElementById('createRoomBtn').addEventListener('click', this.createRoom.bind(this));
        document.getElementById('joinRoomBtn').addEventListener('click', this.joinRoom.bind(this));
        document.getElementById('leaveRoomBtn').addEventListener('click', this.leaveRoom.bind(this));
        document.getElementById('clearCanvasBtn').addEventListener('click', this.clearCanvas.bind(this));

        // 颜色选择
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelector('.color-btn.active').classList.remove('active');
                e.target.classList.add('active');
                this.currentColor = e.target.dataset.color;
            });
        });

        // 画笔大小
        const brushSize = document.getElementById('brushSize');
        const brushSizeValue = document.getElementById('brushSizeValue');
        brushSize.addEventListener('input', (e) => {
            this.currentSize = parseInt(e.target.value);
            brushSizeValue.textContent = `${this.currentSize}px`;
        });
    }

    async initClient() {
        try {
            // 创建简单的用户token（实际项目中应该从认证服务获取）
            const mockToken = jwt.sign(
                { openId: `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}` },
                'your-jwt-secret-key'
            );

            this.client = new RealSyncClient({
                apiKey: 'ak_1234567890abcdefghij', // 演示用的API密钥
                serverUrl: 'ws://localhost:8080', // 本地开发服务器
                tokenProvider: async () => mockToken,
                debug: true
            });

            // 监听连接状态
            this.client.onConnectionStateChanged(this.updateConnectionStatus.bind(this));
            
            // 监听错误
            this.client.onError((error) => {
                this.showError(`连接错误: ${error.message}`);
            });

            // 连接到服务器
            this.updateConnectionStatus(ConnectionState.CONNECTING);
            await this.client.connect();
            
            this.showSuccess('已连接到服务器');
            
        } catch (error) {
            this.showError(`连接失败: ${error.message}`);
            console.error('Connection failed:', error);
        }
    }

    updateConnectionStatus(state) {
        const statusElement = document.getElementById('connectionStatus');
        const statusText = document.getElementById('statusText');
        
        statusElement.className = 'connection-status';
        
        switch (state) {
            case ConnectionState.CONNECTED:
            case ConnectionState.AUTHENTICATED:
                statusElement.classList.add('connected');
                statusText.textContent = '已连接';
                document.getElementById('createRoomBtn').disabled = false;
                break;
            case ConnectionState.CONNECTING:
            case ConnectionState.RECONNECTING:
                statusElement.classList.add('connecting');
                statusText.textContent = '连接中...';
                document.getElementById('createRoomBtn').disabled = true;
                break;
            default:
                statusElement.classList.add('disconnected');
                statusText.textContent = '未连接';
                document.getElementById('createRoomBtn').disabled = true;
        }
    }

    async createRoom() {
        if (!this.client || !this.client.isConnected()) {
            this.showError('请先连接到服务器');
            return;
        }

        const roomName = document.getElementById('roomName').value.trim();
        const displayName = document.getElementById('displayName').value.trim();
        
        if (!roomName || !displayName) {
            this.showError('请输入房间名称和昵称');
            return;
        }

        try {
            this.setLoading(true);
            
            this.room = await this.client.createRoom({
                name: roomName,
                gameMode: 'drawing',
                maxPlayers: 8,
                visibility: RoomVisibility.PUBLIC
            });

            // 设置房间事件监听
            this.setupRoomEvents();
            
            // 更新UI
            this.updateRoomUI();
            this.updatePlayersUI();
            
            this.showSuccess(`房间 "${roomName}" 创建成功！`);
            
        } catch (error) {
            this.showError(`创建房间失败: ${error.message}`);
        } finally {
            this.setLoading(false);
        }
    }

    async joinRoom() {
        // 简化版本：这里可以扩展为输入房间ID的功能
        this.showError('加入房间功能待实现');
    }

    async leaveRoom() {
        if (!this.room) return;

        try {
            await this.room.leave();
            this.room = null;
            this.updateRoomUI();
            this.updatePlayersUI();
            this.clearCanvasLocal();
            this.showSuccess('已离开房间');
        } catch (error) {
            this.showError(`离开房间失败: ${error.message}`);
        }
    }

    setupRoomEvents() {
        if (!this.room) return;

        // 监听状态变更
        this.room.onStateChange((event) => {
            console.log('State change:', event);
            this.handleStateChange(event);
        });

        // 监听玩家加入
        this.room.onPlayerJoined((event) => {
            console.log('Player joined:', event);
            this.updatePlayersUI();
            this.showSuccess(`${event.player.displayName} 加入了房间`);
        });

        // 监听玩家离开
        this.room.onPlayerLeft((event) => {
            console.log('Player left:', event);
            this.updatePlayersUI();
            this.showSuccess(`玩家 ${event.playerId} 离开了房间`);
        });

        // 监听状态变化
        this.room.state.onChange((patches) => {
            console.log('State patches:', patches);
        });
    }

    handleStateChange(event) {
        for (const patch of event.patches) {
            if (patch.path.startsWith('drawings.')) {
                // 处理绘画数据
                const drawingData = patch.value;
                if (drawingData && drawingData.type === 'stroke') {
                    this.drawStroke(drawingData);
                }
            } else if (patch.path === 'clearCanvas') {
                // 清空画布
                this.clearCanvasLocal();
            }
        }
    }

    startDrawing(e) {
        if (!this.room) return;
        
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        this.lastX = e.clientX - rect.left;
        this.lastY = e.clientY - rect.top;
    }

    draw(e) {
        if (!this.isDrawing || !this.room) return;

        const rect = this.canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        // 本地绘制（乐观更新）
        this.drawLine(this.lastX, this.lastY, currentX, currentY, this.currentColor, this.currentSize);

        // 发送绘画数据到服务器
        const strokeData = {
            type: 'stroke',
            fromX: this.lastX,
            fromY: this.lastY,
            toX: currentX,
            toY: currentY,
            color: this.currentColor,
            size: this.currentSize,
            playerId: this.room.getCurrentPlayer()?.playerId,
            timestamp: Date.now()
        };

        // 使用时间戳作为唯一标识
        const strokeId = `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        this.room.state.set(`drawings.${strokeId}`, strokeData).catch(error => {
            console.error('Failed to send drawing data:', error);
        });

        this.lastX = currentX;
        this.lastY = currentY;
    }

    stopDrawing() {
        this.isDrawing = false;
    }

    drawLine(fromX, fromY, toX, toY, color, size) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = size;
        this.ctx.beginPath();
        this.ctx.moveTo(fromX, fromY);
        this.ctx.lineTo(toX, toY);
        this.ctx.stroke();
    }

    drawStroke(strokeData) {
        // 不要重复绘制自己的笔画
        const currentPlayer = this.room?.getCurrentPlayer();
        if (currentPlayer && strokeData.playerId === currentPlayer.playerId) {
            return;
        }

        this.drawLine(
            strokeData.fromX,
            strokeData.fromY,
            strokeData.toX,
            strokeData.toY,
            strokeData.color,
            strokeData.size
        );
    }

    async clearCanvas() {
        if (!this.room) return;

        try {
            // 清空本地画布
            this.clearCanvasLocal();
            
            // 发送清空指令到服务器
            await this.room.state.set('clearCanvas', Date.now());
            
        } catch (error) {
            this.showError(`清空画布失败: ${error.message}`);
        }
    }

    clearCanvasLocal() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    updateRoomUI() {
        const roomInfo = document.getElementById('roomInfo');
        const createBtn = document.getElementById('createRoomBtn');
        const joinBtn = document.getElementById('joinRoomBtn');
        const leaveBtn = document.getElementById('leaveRoomBtn');

        if (this.room) {
            const room = this.room.getRoomInfo();
            roomInfo.innerHTML = `
                <strong>房间:</strong> ${room.name}<br>
                <strong>ID:</strong> ${room.roomId}<br>
                <strong>玩家:</strong> ${room.currentPlayers}/${room.maxPlayers}
            `;
            roomInfo.style.display = 'block';
            createBtn.style.display = 'none';
            joinBtn.style.display = 'none';
            leaveBtn.style.display = 'inline-block';
        } else {
            roomInfo.style.display = 'none';
            createBtn.style.display = 'inline-block';
            joinBtn.style.display = 'inline-block';
            leaveBtn.style.display = 'none';
        }
    }

    updatePlayersUI() {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '';

        if (!this.room) return;

        const players = this.room.getAllPlayers();
        const currentPlayer = this.room.getCurrentPlayer();

        players.forEach(player => {
            const li = document.createElement('li');
            li.className = 'player-item';
            
            if (player.isHost) {
                li.classList.add('host');
            }
            
            if (currentPlayer && player.playerId === currentPlayer.playerId) {
                li.classList.add('current');
            }

            li.innerHTML = `
                <span>${player.displayName}</span>
                ${player.isHost ? '<span class="host-badge">房主</span>' : ''}
            `;
            
            playersList.appendChild(li);
        });
    }

    setLoading(isLoading) {
        const sidebar = document.querySelector('.sidebar');
        if (isLoading) {
            sidebar.classList.add('loading');
        } else {
            sidebar.classList.remove('loading');
        }
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showMessage(message, type) {
        const container = document.getElementById('errorContainer');
        const div = document.createElement('div');
        div.className = type === 'error' ? 'error-message' : 'success-message';
        div.textContent = message;
        
        container.appendChild(div);
        
        // 3秒后自动删除
        setTimeout(() => {
            if (div.parentNode) {
                div.parentNode.removeChild(div);
            }
        }, 3000);
    }
}

// 启动游戏
new DrawingGame();
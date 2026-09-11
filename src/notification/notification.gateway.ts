import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  sendScanCompleteNotification(data: {
    totalCount: number;
    duration: number;
    timestamp: Date;
  }) {
    this.server.emit('scanComplete', {
      ...data,
      message: `4h scan complete: ${data.totalCount} signals in ${data.duration}ms`,
    });
  }

  sendScanErrorNotification(error: string) {
    this.server.emit('scanError', {
      message: '4h scan failed',
      error,
      timestamp: new Date(),
    });
  }

  sendScanProgress(data: {
    current: number;
    total: number;
    symbol: string;
    scanType: string;
  }) {
    this.server.emit('scanProgress', data);
  }

  sendNewListing(data: {
    symbol: string;
    exchange: string;
    listedDate: number;
    title: string;
  }) {
    this.server.emit('newListing', {
      ...data,
      message: `New listing: ${data.symbol} on ${data.exchange}`,
      timestamp: new Date(),
    });
  }

  sendPumpAlert(data: {
    symbol: string;
    exchange: string;
    severity: string;
    pumpScore: number;
    priceChange1h: number;
    priceChange4h: number;
    currentPrice: number;
    reasons: string[];
  }) {
    this.server.emit('pumpAlert', {
      ...data,
      message: `🚨 ${data.severity} pump detected: ${data.symbol} (+${data.priceChange1h.toFixed(2)}% 1h, score ${data.pumpScore})`,
      timestamp: new Date(),
    });
  }

  sendDumpAlert(data: {
    symbol: string;
    exchange: string;
    severity: string;
    dumpScore: number;
    priceChange1h: number;
    priceChange4h: number;
    currentPrice: number;
    reasons: string[];
  }) {
    this.server.emit('dumpAlert', {
      ...data,
      message: `🔻 ${data.severity} dump detected: ${data.symbol} (${data.priceChange1h.toFixed(2)}% 1h, score ${data.dumpScore})`,
      timestamp: new Date(),
    });
  }

  sendPreMoveAlert(data: {
    symbol: string;
    type: 'PUMP' | 'DUMP';
    strength: string;
    confidence: number;
    longLiqValue: number;
    shortLiqValue: number;
    imbalanceRatio: number;
    currentPrice: number | null;
    windowMs: number;
    reasons: string[];
  }) {
    const emoji = data.type === 'PUMP' ? '📈' : '📉';
    const dir = data.type === 'PUMP' ? 'upward' : 'downward';
    this.server.emit('preMoveAlert', {
      ...data,
      message:
        `${emoji} ${data.strength} pre-${data.type.toLowerCase()} signal: ${data.symbol} | ` +
        `confidence ${data.confidence.toFixed(0)}% | ${dir} move likely in next ${this.formatWindow(data.windowMs)}`,
      timestamp: new Date(),
    });
  }

  private formatWindow(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
    return `${minutes}m`;
  }
}

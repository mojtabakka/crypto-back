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

  sendPriceAlert(data: {
    userId: number;
    username: string;
    alertId: number;
    symbol: string;
    targetPrice: number;
    currentPrice: number;
    condition: string;
    note: string | null;
  }) {
    this.server.emit('priceAlert', {
      ...data,
      message: `Price Alert: ${data.symbol} is ${data.condition} ${data.targetPrice} (current: ${data.currentPrice})`,
      timestamp: new Date(),
    });
  }

  sendCorrelationAlert(data: {
    symbol: string;
    benchmark: string;
    correlation: number;
    previous: number;
    direction: string;
  }) {
    this.server.emit('correlationAlert', {
      ...data,
      message: `Rotation: ${data.symbol} correlation with ${data.benchmark} moved ${data.previous} -> ${data.correlation}`,
      timestamp: new Date(),
    });
  }

  sendTradeExecuted(data: {
    username: string;
    symbol: string;
    side: string;
    entryPrice: number;
    quantity: number;
    reason: string;
    leverage: number;
  }) {
    this.server.emit('tradeExecuted', {
      ...data,
      message: `${data.side} ${data.symbol} @ ${data.entryPrice} (${data.reason})`,
      timestamp: new Date(),
    });
  }

  sendTradeClosed(data: {
    username: string;
    symbol: string;
    side: string;
    entryPrice: number;
    exitPrice: number;
    pnlPercent: number;
    reason: string;
    durationMs: number;
  }) {
    this.server.emit('tradeClosed', {
      ...data,
      message: `Closed ${data.side} ${data.symbol} @ ${data.exitPrice} (${data.pnlPercent.toFixed(2)}%)`,
      timestamp: new Date(),
    });
  }
}

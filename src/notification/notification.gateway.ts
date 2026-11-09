import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    credentials: true,
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

  /**
   * The Safe-Sell page asks for `{ channel: 'safeSellSignal' }`. Acknowledge
   * every subscription so the client can rely on the event contract.
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() body: { channel?: string } | undefined,
    @ConnectedSocket() client: Socket,
  ) {
    const channel = body?.channel ?? 'unknown';
    this.logger.debug(`Client ${client.id} subscribed to ${channel}`);
    return { event: 'subscribed', data: { channel } };
  }

  sendSafeSellSignal(data: {
    symbol: string;
    exchange: string;
    direction: string;
    severity: string;
    safeSellScore: number;
    priceChange1h: number;
    priceChange4h: number;
    currentPrice: number;
    reasons: string[];
    message: string;
    timestamp: string;
  }) {
    this.server.emit('safeSellSignal', data);
  }

  sendPumpAlert(data: {
    symbol: string;
    score: number;
    severity: string;
  }) {
    this.server.emit('pumpAlert', {
      ...data,
      message: `Pump detected: ${data.symbol} (${data.severity})`,
      timestamp: new Date(),
    });
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
}

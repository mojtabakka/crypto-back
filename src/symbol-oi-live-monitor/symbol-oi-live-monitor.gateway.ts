/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-argument */
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'ws';
import { SymbolOiLiveMonitorService } from './symbol-oi-live-monitor.service';
import type {
  LiveOIStatus,
  LiveOMonitorSubscribe,
  LiveOMonitorUnsubscribe,
} from './types/symbol-oi-live.types';

export class SymbolOiLiveMonitorGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SymbolOiLiveMonitorGateway.name);

  @WebSocketServer()
  wss: Server;

  constructor(private readonly monitorService: SymbolOiLiveMonitorService) {
    // Listen to status changes from the service and broadcast to subscribed clients
    this.monitorService.onStatusChange((status: any) => {
      this.broadcastStatus(status.symbol, status);
    });
  }

  handleConnection(client: any) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: any) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Unsubscribe client from all symbols
    const subscribed = this.getClientSubscriptions(client);
    subscribed.forEach((symbol) => {
      this.monitorService.unsubscribe(symbol);
      this.broadcastToClient(client, symbol, null);
    });
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: any, data: LiveOMonitorSubscribe): void {
    const symbol = data.symbol.toUpperCase();
    this.logger.log(`Client ${client.id} subscribing to: ${symbol}`);

    // Subscribe to symbol monitoring
    this.monitorService.subscribe(symbol);

    // Track client subscription
    this.addClientSubscription(client, symbol);

    // Send initial status
    const status = this.monitorService.getStatus(symbol);
    if (status) {
      this.broadcastToClient(client, symbol, status);
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: any, data: LiveOMonitorUnsubscribe): void {
    const symbol = data.symbol.toUpperCase();
    this.logger.log(`Client ${client.id} unsubscribing from: ${symbol}`);

    this.monitorService.unsubscribe(symbol);
    this.removeClientSubscription(client, symbol);
    this.broadcastToClient(client, symbol, null);
  }

  // Broadcast status update to all clients subscribed to a symbol
  broadcastStatus(symbol: string, status: LiveOIStatus): void {
    this.wss.clients.forEach((client: any) => {
      if (this.isClientSubscribedTo(client, symbol)) {
        client.send(
          JSON.stringify({
            type: 'status_update',
            symbol,
            data: status,
          }),
        );
      }
    });
  }

  // Broadcast to a specific client
  broadcastToClient(
    client: any,
    symbol: string,
    status: LiveOIStatus | null,
  ): void {
    if (client.readyState === 1) {
      client.send(
        JSON.stringify({
          type: 'status_update',
          symbol,
          data: status,
        }),
      );
    }
  }

  // Client subscription tracking
  private clientSubscriptions = new Map<string, Set<string>>();

  private addClientSubscription(client: any, symbol: string): void {
    const subs = this.clientSubscriptions.get(client.id) ?? new Set();
    subs.add(symbol);
    this.clientSubscriptions.set(client.id, subs);
  }

  private removeClientSubscription(client: any, symbol: string): void {
    const subs = this.clientSubscriptions.get(client.id);
    if (!subs) return;
    subs.delete(symbol);
    if (subs.size === 0) {
      this.clientSubscriptions.delete(client.id);
    }
  }

  private getClientSubscriptions(client: any): string[] {
    const subs = this.clientSubscriptions.get(client.id);
    return subs ? Array.from(subs) : [];
  }

  private isClientSubscribedTo(client: any, symbol: string): boolean {
    const subs = this.clientSubscriptions.get(client.id);
    return subs ? subs.has(symbol) : false;
  }
}

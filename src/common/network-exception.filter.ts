import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { Response } from 'express';

const NETWORK_CODES = [
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ERR_NETWORK',
];

/**
 * Turns upstream connectivity failures into an honest 503.
 *
 * Without this, a blocked exchange host produced an opaque 500 for every
 * market endpoint. The UI can then distinguish "our bug" from "the exchange is
 * unreachable from this machine".
 */
@Catch()
export class NetworkExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('NetworkExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    if (axios.isAxiosError(exception)) {
      const error = exception as AxiosError;
      const code = error.code ?? '';
      const upstreamStatus = error.response?.status;
      const isNetwork =
        !upstreamStatus ||
        NETWORK_CODES.includes(code) ||
        upstreamStatus >= 500;

      if (isNetwork) {
        const hostname = error.config?.url
          ? new URL(error.config.url, 'https://unknown').hostname
          : 'unknown';

        this.logger.warn(
          `Upstream unreachable: ${hostname} (${code || `HTTP ${upstreamStatus}`})`,
        );

        response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: 'Service Unavailable',
          message:
            'Upstream market data is unreachable from this host. Check the network/proxy and retry.',
          upstream: hostname,
        });
        return;
      }
    }

    this.logger.error(
      exception instanceof Error
        ? exception.stack ?? exception.message
        : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}

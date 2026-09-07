import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

import { AppModule } from './app.module';

async function bootstrap() {
  const logDir = process.env.LOG_DIR ?? './logs';

  const winstonLogger = WinstonModule.createLogger({
    level: process.env.LOG_LEVEL ?? 'debug',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.ms(),
      winston.format.errors({ stack: true }),
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.ms(),
          winston.format.colorize({ all: true }),
          winston.format.printf(
            (info) =>
              `${info.timestamp} ${info.level} [${info.context ?? 'App'}] ${info.message} ${info.ms ?? ''}`,
          ),
        ),
      }),
      new winston.transports.DailyRotateFile({
        dirname: `${logDir}/error`,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        ),
      }),
      new winston.transports.DailyRotateFile({
        dirname: `${logDir}/combined`,
        filename: 'combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        ),
      }),
      new winston.transports.DailyRotateFile({
        dirname: `${logDir}/info`,
        filename: 'info-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  });

  const app = await NestFactory.create(AppModule, {
    logger: winstonLogger,
  });

  app.useLogger(winstonLogger);

  const port = Number(process.env.PORT ?? 3000);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Crypto Volume API')
    .setDescription('Crypto market analysis and news API')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  await app.listen(port, '0.0.0.0');
  winstonLogger.log({
    level: 'info',
    message: `Application is running on: http://localhost:${port}/api`,
  });
}
bootstrap();

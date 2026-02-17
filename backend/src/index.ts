/**
 * ELD Backend Server
 *
 * Production-ready Express server with:
 * - Structured logging (Winston)
 * - Security middleware (Helmet)
 * - Request validation (Zod)
 * - Error handling
 * - Health checks
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { authenticateToken } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { correlationMiddleware } from './middleware/correlation';
import {
  authRateLimiter,
  eventIngestionRateLimiter,
  queryRateLimiter,
  strictRateLimiter,
} from './middleware/rate-limit';
import { connectRedis, disconnectRedis } from './config/redis';
import { swaggerSpec } from './config/swagger';
import authRouter from './routes/auth.routes';
import eventsRouter from './routes/events.routes';
import driverLogRoutes from './routes/driver-log.routes';
import hosRoutes from './routes/hos.routes';
import certificationRoutes from './routes/certification.routes';
import outputFileRoutes from './routes/output-file.routes';
import { HealthController } from './controllers/health.controller';
import { asyncHandler } from './utils/async-handler';
import { logger, stream } from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize controllers
const healthController = new HealthController();

// Security middleware
app.use(helmet());

// Correlation ID middleware (must be early in chain for request tracing)
app.use(correlationMiddleware);

// CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'],
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware (Morgan -> Winston)
// Note: Detailed request/response logging handled by correlation middleware
app.use(morgan('combined', { stream }));

// Health check endpoint (unauthenticated, no rate limit)
app.get('/health', asyncHandler(healthController.checkHealth.bind(healthController)));

// API Documentation (Swagger UI)
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Cruzonic ELD API Documentation',
}));

// OpenAPI JSON endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Auth routes (strict rate limiting - 10 req/min per IP to prevent brute force)
app.use(`/api/${API_VERSION}/auth`, authRateLimiter, authRouter);

// Event ingestion routes (100 req/min per device)
app.use(
  `/api/${API_VERSION}/events`,
  eventIngestionRateLimiter,
  authenticateToken,
  eventsRouter
);

// Query endpoints (60 req/min per user)
app.use(`/api/${API_VERSION}/drivers`, queryRateLimiter, driverLogRoutes);
app.use(`/api/${API_VERSION}/hos`, queryRateLimiter, hosRoutes);

// Certification endpoint (strict - 20 req/min per user)
app.use(`/api/${API_VERSION}/certify`, strictRateLimiter, certificationRoutes);

// Output file generation (strict - 20 req/min per user, resource intensive)
app.use(`/api/${API_VERSION}/output-file`, strictRateLimiter, outputFileRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, async () => {
  logger.info('ELD Backend API started', {
    port: PORT,
    apiVersion: API_VERSION,
    environment: NODE_ENV,
    healthCheck: `http://localhost:${PORT}/health`,
    apiDocs: `http://localhost:${PORT}/api-docs`,
  });

  // Initialize Redis for distributed rate limiting
  try {
    await connectRedis();
  } catch (error) {
    logger.warn('Server started without Redis connection', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  const { closeConnections } = await import('./config/supabase');
  await closeConnections();
  await disconnectRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  const { closeConnections } = await import('./config/supabase');
  await closeConnections();
  await disconnectRedis();
  process.exit(0);
});

export default app;

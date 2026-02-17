/**
 * Swagger/OpenAPI Configuration
 *
 * API documentation using OpenAPI 3.0 specification
 */

import swaggerJsdoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Cruzonic ELD Backend API',
    version: '1.0.0',
    description: `
FMCSA-compliant Electronic Logging Device (ELD) backend API for managing driver logs,
hours of service (HOS) calculations, event ingestion, and regulatory compliance.

## Features

- **Authentication & Authorization** - JWT-based auth with role-based access control
- **Event Ingestion** - FMCSA-compliant event recording (7 event types)
- **HOS Calculations** - Real-time hours of service tracking and violation detection
- **Driver Logs** - Daily logs with duty status summaries and certifications
- **Output Files** - FMCSA export file generation for roadside inspections
- **Rate Limiting** - Distributed rate limiting via Redis
- **Structured Logging** - JSON logs with correlation IDs for request tracing
- **Multi-Tenant** - Carrier-based data isolation

## Authentication

Most endpoints require JWT authentication. Include the access token in the Authorization header:

\`\`\`
Authorization: Bearer <access_token>
\`\`\`

Obtain tokens via the \`/api/v1/auth/login\` endpoint.

## Rate Limits

- **Event Ingestion**: 100 requests/minute per device
- **Query Endpoints**: 60 requests/minute per user
- **Auth Endpoints**: 10 requests/minute per IP
- **Strict Endpoints**: 20 requests/minute per user (certify, output-file)

Rate limit headers are included in all responses:
- \`X-RateLimit-Limit\` - Maximum requests allowed in window
- \`X-RateLimit-Remaining\` - Requests remaining in current window
- \`X-RateLimit-Reset\` - Unix timestamp when window resets

When rate limited (429 response), check the \`Retry-After\` header for seconds to wait.

## Correlation IDs

All requests/responses include a \`X-Correlation-Id\` header for distributed tracing.
Include this ID when reporting issues.
    `,
    contact: {
      name: 'Cruzonic Support',
      email: 'support@cruzonic.com',
    },
    license: {
      name: 'Proprietary',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
    {
      url: 'https://api.cruzonic.com',
      description: 'Production server',
    },
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication and authorization endpoints',
    },
    {
      name: 'Events',
      description: 'ELD event ingestion and querying',
    },
    {
      name: 'Driver Logs',
      description: 'Daily driver logs and duty status summaries',
    },
    {
      name: 'HOS',
      description: 'Hours of Service calculations and status',
    },
    {
      name: 'Certification',
      description: 'Driver log certification',
    },
    {
      name: 'Output Files',
      description: 'FMCSA export file generation',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token obtained from /api/v1/auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error type or class',
            example: 'ValidationError',
          },
          message: {
            type: 'string',
            description: 'Human-readable error message',
            example: 'Invalid email format',
          },
          statusCode: {
            type: 'integer',
            description: 'HTTP status code',
            example: 400,
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'ISO 8601 timestamp',
          },
          correlationId: {
            type: 'string',
            format: 'uuid',
            description: 'Request correlation ID for tracing',
          },
        },
        required: ['error', 'message', 'statusCode'],
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          data: {
            type: 'object',
            description: 'Response data (varies by endpoint)',
          },
        },
        required: ['success', 'data'],
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          email: {
            type: 'string',
            format: 'email',
          },
          role: {
            type: 'string',
            enum: ['driver', 'fleet_manager', 'admin', 'support'],
          },
          full_name: {
            type: 'string',
          },
          carrier_id: {
            type: 'string',
            format: 'uuid',
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'driver@example.com',
          },
          password: {
            type: 'string',
            format: 'password',
            minLength: 8,
            example: 'SecurePassword123!',
          },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          user: {
            $ref: '#/components/schemas/User',
          },
          accessToken: {
            type: 'string',
            description: 'JWT access token (expires in 15 minutes)',
          },
          refreshToken: {
            type: 'string',
            description: 'Refresh token (expires in 7 days)',
          },
          expiresIn: {
            type: 'integer',
            description: 'Token expiration time in seconds',
            example: 900,
          },
        },
      },
      SignupRequest: {
        type: 'object',
        required: ['email', 'password', 'full_name', 'role', 'carrier_id'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
          },
          password: {
            type: 'string',
            minLength: 8,
          },
          full_name: {
            type: 'string',
            minLength: 2,
          },
          phone: {
            type: 'string',
            example: '+1234567890',
          },
          role: {
            type: 'string',
            enum: ['driver', 'fleet_manager', 'admin'],
          },
          carrier_id: {
            type: 'string',
            format: 'uuid',
          },
          driver_details: {
            type: 'object',
            description: 'Required if role is driver',
            properties: {
              license_number: {
                type: 'string',
              },
              license_state: {
                type: 'string',
                maxLength: 2,
              },
              license_class: {
                type: 'string',
              },
              license_expiry: {
                type: 'string',
                format: 'date',
              },
              home_terminal_timezone: {
                type: 'string',
                example: 'America/Los_Angeles',
              },
            },
          },
        },
      },
      ELDEvent: {
        type: 'object',
        required: [
          'eventType',
          'eventCode',
          'eventDate',
          'eventTime',
          'eventSequenceIdNumber',
          'eventRecordStatus',
          'eventRecordOrigin',
          'driverId',
          'deviceId',
        ],
        properties: {
          eventType: {
            type: 'integer',
            minimum: 1,
            maximum: 7,
            description: `
1 = Driver Duty Status Change
2 = Intermediate Log
3 = Driver Certification/Recertification
4 = Driver Login/Logout
5 = Engine Power Up/Shut Down
6 = Malfunction and Data Diagnostic
7 = ELD Annotation
            `,
          },
          eventCode: {
            type: 'integer',
            description: 'Event-specific code (varies by eventType)',
          },
          eventDate: {
            type: 'string',
            format: 'date',
            example: '2026-02-15',
          },
          eventTime: {
            type: 'string',
            pattern: '^\\d{2}:\\d{2}:\\d{2}$',
            example: '14:30:00',
          },
          eventSequenceIdNumber: {
            type: 'integer',
            minimum: 1,
            description: 'Sequential event ID for this device',
          },
          eventRecordStatus: {
            type: 'integer',
            enum: [1, 2, 3, 4],
            description: '1=Active, 2=Inactive Changed, 3=Inactive Change Requested, 4=Inactive Changed on Review',
          },
          eventRecordOrigin: {
            type: 'integer',
            enum: [1, 2, 3, 4],
            description: '1=Auto-Recorded, 2=Driver-Recorded, 3=Other User-Recorded, 4=Assumed from Unidentified',
          },
          accumulatedVehicleMiles: {
            type: 'number',
            format: 'double',
            description: 'Total vehicle miles',
          },
          elapsedEngineHours: {
            type: 'number',
            format: 'double',
            description: 'Total engine hours',
          },
          eventLatitude: {
            type: 'number',
            format: 'double',
            minimum: -90,
            maximum: 90,
          },
          eventLongitude: {
            type: 'number',
            format: 'double',
            minimum: -180,
            maximum: 180,
          },
          distanceSinceLastValidCoordinates: {
            type: 'number',
            format: 'double',
            description: 'Distance since last valid GPS coordinates',
          },
          driverId: {
            type: 'string',
            format: 'uuid',
          },
          deviceId: {
            type: 'string',
            description: 'ELD device identifier',
          },
          locationDescription: {
            type: 'string',
            maxLength: 100,
            description: 'Human-readable location description',
          },
          metadata: {
            type: 'object',
            description: 'Additional event-specific data',
          },
        },
      },
      BatchIngestResponse: {
        type: 'object',
        description: 'Result of a batch event ingestion request',
        properties: {
          accepted: {
            type: 'array',
            description: 'Events that were successfully ingested',
            items: {
              type: 'object',
              properties: {
                index: {
                  type: 'integer',
                  description: 'Position of this event in the submitted batch (0-based)',
                },
                eventId: {
                  type: 'string',
                  format: 'uuid',
                },
                sequenceId: {
                  type: 'integer',
                  description: 'Allocated FMCSA sequence ID',
                },
                chainHash: {
                  type: 'string',
                  description: 'SHA-256 chain hash for audit trail continuity',
                },
                eventType: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 7,
                },
              },
            },
          },
          rejected: {
            type: 'array',
            description: 'Events that failed processing with error details',
            items: {
              type: 'object',
              properties: {
                index: {
                  type: 'integer',
                  description: 'Position in the submitted batch (0-based)',
                },
                error: {
                  type: 'string',
                  description: 'Human-readable error message',
                },
                eventType: {
                  type: 'integer',
                  nullable: true,
                },
                eventSequenceId: {
                  type: 'string',
                  nullable: true,
                },
              },
            },
          },
          summary: {
            type: 'object',
            properties: {
              total: {
                type: 'integer',
                description: 'Total events submitted in this batch',
              },
              accepted: {
                type: 'integer',
                description: 'Number of successfully ingested events',
              },
              rejected: {
                type: 'integer',
                description: 'Number of failed events',
              },
              processingTimeMs: {
                type: 'integer',
                description: 'Total processing time in milliseconds',
              },
            },
          },
        },
      },
      HOSStatus: {
        type: 'object',
        properties: {
          driver_id: {
            type: 'string',
            format: 'uuid',
          },
          current_status: {
            type: 'object',
            nullable: true,
            properties: {
              duty_status: {
                type: 'integer',
                enum: [1, 2, 3, 4],
                description: '1=OFF_DUTY, 2=SLEEPER_BERTH, 3=DRIVING, 4=ON_DUTY_NOT_DRIVING',
              },
              duty_status_name: {
                type: 'string',
                enum: ['OFF_DUTY', 'SLEEPER_BERTH', 'DRIVING', 'ON_DUTY_NOT_DRIVING'],
              },
              started_at: {
                type: 'string',
                format: 'date-time',
              },
              duration_minutes: {
                type: 'integer',
              },
            },
          },
          remaining_time: {
            type: 'object',
            properties: {
              driving_minutes: {
                type: 'integer',
                description: 'Minutes remaining for driving today',
              },
              on_duty_window_minutes: {
                type: 'integer',
                description: 'Minutes remaining in 14-hour on-duty window',
              },
              weekly_minutes: {
                type: 'integer',
                description: 'Minutes remaining in 60/70-hour weekly limit',
              },
            },
          },
          breaks: {
            type: 'object',
            properties: {
              break_required: {
                type: 'boolean',
              },
              break_required_in_minutes: {
                type: 'integer',
                nullable: true,
              },
              consecutive_driving_minutes: {
                type: 'integer',
              },
            },
          },
          restart: {
            type: 'object',
            properties: {
              in_34h_restart: {
                type: 'boolean',
              },
              restart_started_at: {
                type: 'string',
                format: 'date-time',
                nullable: true,
              },
              restart_eligible_at: {
                type: 'string',
                format: 'date-time',
                nullable: true,
              },
              restart_progress_minutes: {
                type: 'integer',
              },
            },
          },
          violations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                },
                severity: {
                  type: 'string',
                  enum: ['warning', 'violation'],
                },
                active: {
                  type: 'boolean',
                },
                started_at: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
          },
          calculated_at: {
            type: 'string',
            format: 'date-time',
          },
          hos_ruleset: {
            type: 'string',
            enum: ['60_7', '70_8'],
          },
        },
      },
    },
    responses: {
      UnauthorizedError: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'AuthenticationError',
              message: 'No token provided',
              statusCode: 401,
            },
          },
        },
      },
      ForbiddenError: {
        description: 'Insufficient permissions',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'AuthorizationError',
              message: 'Insufficient permissions',
              statusCode: 403,
            },
          },
        },
      },
      NotFoundError: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'NotFoundError',
              message: 'Driver not found',
              statusCode: 404,
            },
          },
        },
      },
      ValidationError: {
        description: 'Invalid request data',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'ValidationError',
              message: 'Invalid email format',
              statusCode: 400,
            },
          },
        },
      },
      RateLimitError: {
        description: 'Rate limit exceeded',
        headers: {
          'Retry-After': {
            schema: {
              type: 'integer',
            },
            description: 'Seconds to wait before retrying',
          },
          'X-RateLimit-Limit': {
            schema: {
              type: 'integer',
            },
          },
          'X-RateLimit-Remaining': {
            schema: {
              type: 'integer',
            },
          },
          'X-RateLimit-Reset': {
            schema: {
              type: 'integer',
            },
          },
        },
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  example: 'Too Many Requests',
                },
                message: {
                  type: 'string',
                  example: 'Rate limit exceeded. Please try again later.',
                },
                retryAfter: {
                  type: 'integer',
                  example: 45,
                },
                limit: {
                  type: 'integer',
                  example: 100,
                },
                remaining: {
                  type: 'integer',
                  example: 0,
                },
                reset: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
          },
        },
      },
    },
    parameters: {
      CorrelationIdHeader: {
        name: 'X-Correlation-Id',
        in: 'header',
        description: 'Optional correlation ID for request tracing. If not provided, one will be generated.',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      },
      DeviceIdHeader: {
        name: 'x-device-id',
        in: 'header',
        description: 'ELD device identifier (required for event ingestion)',
        required: false,
        schema: {
          type: 'string',
        },
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Paths to files with OpenAPI annotations
};

export const swaggerSpec = swaggerJsdoc(options);

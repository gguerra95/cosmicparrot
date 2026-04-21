import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().default(7),
  UPLOAD_DIR: z.string().default('/data/uploads'),
  MAX_FILE_SIZE: z.coerce.number().default(20 * 1024 * 1024),
  MAX_IMAGE_SIZE: z.coerce.number().default(3 * 1024 * 1024),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@chat.local'),
  APP_URL: z.string().default('http://localhost'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().default(3001),
})

export const config = schema.parse(process.env)

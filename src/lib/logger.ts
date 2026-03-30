type LogLevel = 'info' | 'warn' | 'error'

interface LogContext {
  route?: string
  user?: string
  error?: string
  [key: string]: any
}

function log(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  console.log(JSON.stringify(entry))
}

export const logger = {
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
}

export const CONFIG = {
  port: Number(process.env.PORT || 43117),
  host: String(process.env.HOST || '0.0.0.0'),
  token: process.env.TOKEN || '',
  containerName: process.env.CONTAINER_NAME || 'ftso-v2-deployment-fdc-observer-1',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  recentLimit: Number(process.env.RECENT_LIMIT || 5000),
  statsWindowMinutes: Number(process.env.STATS_WINDOW_MINUTES || 60),
  statsPushIntervalMs: Number(process.env.STATS_PUSH_INTERVAL_MS || 5000),
  dockerSince: process.env.DOCKER_SINCE || '1h',
  dockerUseSudo: process.env.DOCKER_USE_SUDO === '1' || process.env.DOCKER_USE_SUDO === 'true',
  source: (process.env.SOURCE || 'docker').toLowerCase(), // 'docker' | 'file'
  logFile: process.env.LOG_FILE || '',
  tailInitialLines: Number(process.env.TAIL_N || 2000),
};

export function requireToken(): string {
  if (!CONFIG.token) return '';
  return CONFIG.token;
}



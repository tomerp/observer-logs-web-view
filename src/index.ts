import { createServer } from './server';
import { CONFIG } from './config';

const { server } = createServer();

server.listen(CONFIG.port, CONFIG.host, () => {
  // eslint-disable-next-line no-console
  console.log(`observer-logs-web-view listening on http://${CONFIG.host}:${CONFIG.port}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));



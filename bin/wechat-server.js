const Logger = require('log4js');
const server = require('../lib/irc_server.js');

const logger = Logger.getLogger('wechat-server');

server.on('error', (err) => {
  throw err;
});
server.listen(8124, () => {
  logger.info('server bound', server.address());
  server.wxClient.run();
});

function exitHandler(options, exitCode) {
  logger.debug(options.source);
  if (options.cleanup) {
    server.cleanup();
    logger.info('clean');
  }
  if (exitCode !== undefined) logger.info(exitCode);
  if (options.exit) {
    process.exit();
  }
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {cleanup: true, exit: false, source: 'exit'}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit: true, source: 'SIGINT'}));

process.on('SIGUSR1', exitHandler.bind(null, {exit: true, source: 'SIGUSR1'}));
process.on('SIGUSR2', exitHandler.bind(null, {exit: true, source: 'SIGUSR2'}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGTERM', exitHandler.bind(null, {exit: true, source: 'SIGTERM'}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit: true, source: 'uncaughtException'}));

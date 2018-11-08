const Logger = require('log4js');

const logger = Logger.getLogger('wx_plugin');

const WxPluginInterface = function () {};

WxPluginInterface.prototype._handle_msg_hook = (msgType, userName, remarkName, msgId, content) => {
  logger.debug(msgType, userName, remarkName, msgId, content);
};

module.exports = WxPluginInterface;

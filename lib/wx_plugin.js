class WxPluginInterface {
  constructor(name) {
    this._pluginName = name;
  }

  _handle_msg_hook(msgType, userName, remarkName, msgId, content) {

  }
}

module.exports = WxPluginInterface;

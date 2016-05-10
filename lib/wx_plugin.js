var WxPluginInterface = function(name) {
  this._pluginName = name;
}

WxPluginInterface.prototype._handle_msg_hook(msgType, userName, remarkName, msgId, content) {

}

module.exports = WxPluginInterface;

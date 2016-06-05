const net = require('net');
const sprintf = require('sprintf');
const WxClient = require('./wx_client.js');

var wxClient = new WxClient();

var server = net.createServer((c) => {
  // 'connection' listener
  console.log('client connected');
  server.getConnections((err, count) => {
    if(count>1) {
      console.log('不能超过1个连接，关闭中。。。');
      c.write('不能超过1个连接，关闭中。。。\r\n');
      c.end();
    }
    else {
      if(!server.ircHandler) {
        server.ircHandler = new IRCHandler(c, wxClient);
      }
      c.setEncoding('utf-8');
      c.on('end', () => {
        console.log('client disconnected');
      });
      c.on('data', (buffer) => {
        var commandLines = buffer.split('\r\n');
        for(var i=0, len=commandLines.length; i<len-1; i++) {
          var commands = commandLines[i].split(' ');
          server.ircHandler.command_handler(commands[0], commands.slice(1));
        }
      });
    }
  });
});
server.on('error', (err) => {
  throw err;
});
server.listen(8124, () => {
  console.log('server bound');
  wxClient.run();
});

var IRCHandler = function(socket, wxClient) {
  this._user;
  this._nick;
  this._socket = socket
  this.command_handler = this._register_handler;
  this._wxClient = wxClient;
  this._wxClient.add_plugin(new ChatRoomMsgHandleWxPlugin(this));
}

IRCHandler.prototype._register_handler = function(command, args) {
  console.log('command %s args %s', command, args);
  if(command=='NICK') {
    if(args.length<1) {
      this.send(sprintf("431 :No nickname given"));
      return;
    }
    this._nick = args[0];
  }
  else if(command=='USER') {
    if (args.length<4) {
      this.send_461('USER');
      return;
    }
    this._user = args[0];
  }
  else if(command=='QUIT') {
    this._socket.end();
    return;
  }
  if(this._nick && this._user) {
    this.send(sprintf("001 %s :Hi, welcome to IRC", this._nick));
    this.send(sprintf("002 %s :Your host is %s, running version wechat-terminal-%s", this._nick, 'ethans-macbook.local', 'alpha-1'));
    this.send(sprintf("003 %s :This server was created sometime", this._nick));
    this.send(sprintf("004 %s :%s wechat-terminal-%s o o", this._nick, 'ethans-macbook.local', 'alpha-1'));
    this.send(sprintf("251 %s :There are %d users and 0 services on 1 server", this._nick, 1));
    this.send(sprintf("422 %s :MOTD File is missing", this._nick));
    this.command_handler = this._common_handler;
  }
}

IRCHandler.prototype._common_handler = function(command, args) {
  console.log('common command %s args %s', command, args);
  switch(command) {
    case 'PING':
      if (args.length<1) {
        this.send("409 %s :No origin specified", this._nick);
        break;
      }
      this.send(sprintf("PONG %s :%s", 'ethans-macbook.local', args[0]));
      break;
    case 'QUIT':
      if (args.length<1)
        var quitMsg = this._nick;
      else
        var quitMsg = args[0];
      this._socket.end(sprintf("ERROR :%s", quitMsg));
      break;
    case 'LIST':
      var channels = wxClient.list_contacts();
      for(var channel in channels) {
        this.send(sprintf("322 %s %s %d :%s", this._nick, channels[channel]['NickName'], 10, 
            wxClient._get_user_remark_name(channel)));
      }
      this.send(sprintf("323 %s :End of LIST", this._nick));
      break;
    case 'JOIN':
      if (args.length<1) {
        this.send_461('JOIN');
        return;
      }
      var channel = args[0].slice(1);
      var channelID = wxClient.get_userName_from_nickName(channel);
      if(!wxClient.isInContact(channelID)) {
        this.send(sprintf("475 %s %s :Cannot join channel (+k) - bad key", this._nick, channel));
        return;
      }
      this._socket.write(sprintf(":%s!%s@%s %s %s :%s\r\n", this._nick, this._user, '127.0.0.1', 'JOIN', '#'+channel, this._nick));
      this.send(sprintf("332 %s %s :%s", this._nick, channel, wxClient._get_user_remark_name(channel)));
      this.send(sprintf("353 %s = %s :%s", this._nick, channel, 'TODO group members name'));
      this.send(sprintf("366 %s %s :End of NAMES list", this._nick, channel));
      this.curChannelID = channelID;
      this.curChannel = "#"+channel;
      break;
    case 'PART':
      if (args.length<1) {
        this.send_461('PART');
        return;
      }
      channelName = args[0];
      console.log(sprintf(":%s!%s@%s %s %s :%s\r\n", this._nick, this._user, '127.0.0.1', 'PART', channelName, this.       _nick));
      this._socket.write(sprintf(":%s!%s@%s %s %s :%s\r\n", this._nick, this._user, '127.0.0.1', 'PART', channelName, this._nick));
      break;
    case 'NOTICE':
    case 'PRIVMSG':
      if (args.length<1) {
        this.send_461('PRIVMSG');
        return;
      }
      channelID = this.curChannelID;
      msg = args[1];
      wxClient.send_msg(channelID, msg);
      break;
    default:
      this.send(sprintf("421 %s %s :Unknown command", this._nick, command));
  }

}

IRCHandler.prototype.send = function(msg) {
  console.log(sprintf(":%s %s\r\n", 'ethans-macbook.local', msg));
  this._socket.write(sprintf(":%s %s\r\n", 'ethans-macbook.local', msg));
}

IRCHandler.prototype.send_461 = function(command) {
  console.log('send 461 %s :Not enough parameters' % command);
  this.send(sprintf("461 %s %s :Not enough parameters", this._nick, command));
}

IRCHandler.prototype.send_message = function(msg) {
    console.log(sprintf(":%s!%s@%s %s", this._nick, this._user, '127.0.0.1', msg));
    this._socket.write(sprintf(":%s!%s@%s %s", this._nick, this._user, '127.0.0.1', msg));
}

IRCHandler.prototype.send_prvMsg = function(name, channel, msg) {
    var buffer = sprintf(":%s!%s@%s PRIVMSG %s :%s\r\n", name, this._user, '127.0.0.1', channel, msg);
    console.log(buffer);
    this._socket.write(buffer);
}

var ChatRoomMsgHandleWxPlugin = function(irc_handler) {
  this._irc_handler = irc_handler;
  this._queues = {};
}

ChatRoomMsgHandleWxPlugin.prototype._handle_msg_hook = function(msgType, userName, remarkName, msgId, content) {
  if(msgType in [1,3,34,42,47,49,62]) {
    if(msgType!=1)
        content = "msgType "+msgType+" 暂不支持显示的消息";
    this.add_msg(remarkName, msgId, content);
    if(this._irc_handler.curChannelID == userName)
        this.notify(remarkName);
  }
}

ChatRoomMsgHandleWxPlugin.prototype.add_msg = function(remarkName, msgId, content) {
  if(!(remarkName in this._queues))
    this._queues[remarkName] = [];
  this._queues[remarkName].push({'msgId':msgId, 'content':content});
}

ChatRoomMsgHandleWxPlugin.prototype.notify = function(remarkName) {
  while(this._queues[remarkName].length) {
    var msg_info = this._queues[remarkName].shift();
    this._irc_handler.send_prvMsg(remarkName, this._irc_handler.curChannel, msg_info['content']);
  }
}

ChatRoomMsgHandleWxPlugin.prototype.reset_all_queues = function() {
  this._queues = {}
}

ChatRoomMsgHandleWxPlugin.prototype.reset_queue = function(remarkName) {
  if(remarkName in this._queues)
    this._queues[remarkName] = [];
}

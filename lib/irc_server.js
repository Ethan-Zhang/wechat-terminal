const net = require('net');
const sprintf = require('sprintf');
const WxClient = require('./wx_client.js');

var wxClient = new WxClient();

const server = net.createServer((c) => {
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
        server.ircHandler = new IRCHandler(c);
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

var IRCHandler = function(socket) {
  this._user;
  this._nick;
  this._socket = socket
  this.command_handler = this._register_handler;
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
      var channels = wxClient.list_contact();
      for(var channel in channels) {
        this.send(sprintf("322 %s %s %d :%s", this._nick, channel, 10, channels[channel]['NickName']));
      }
      this.send(sprintf("323 %s :End of LIST", this._nick));
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
  this.send(sprintf("461 %s %s :Not enough parameters", this._nick, command));
}

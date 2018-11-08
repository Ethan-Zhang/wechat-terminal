const path = require('path');
const request = require('request');
const querystring = require('querystring');
const qrcode = require('qrcode-terminal');
const xpath = require('xpath');
const DOMParser = require('xmldom').DOMParser;
const fs = require('fs');
const log4js = require('log4js');

const STATUS_ONLINE = 2;
const STATUS_LOGGING = 1;
const STATUS_OFFLINE = 0;

const logger = log4js.getLogger('Client');

const WxClient = function () {
  this.domain = 'wx.qq.com';
  this.deviceid = 'e' + parseInt(Math.random() * 1000000000000000);
  this.online = STATUS_OFFLINE;
  this.uuid = null;
  this.sid = null;
  this.uin = null;
  this.skey = null;
  this.syncKey = null;
  this.syncStr = null;
  this.pass_ticket = null;
  this.myUserName = null;
  this.cookies = [];
  this.members = {};
  this.contactMembers = {};
  this.groups = {};
  this._plugins = [];
  this.load_cache();
};

WxClient.prototype.run = function () {
  this._wx_login();
};

WxClient.prototype.stop = function () {
  this.online = STATUS_OFFLINE;
};

WxClient.prototype._wx_login = function () {
  const url = 'https://' + this.domain + '/';
  const headers = {'Cookie': this.cookies};
  request.get({url: url, headers: headers}, (function (error, response, body) {
    if (!error && response.statusCode === 200) {
      const r_list = body.match(/window\.MMCgi\s*=\s*{\s*isLogin\s*:\s*(!!"1")\s*}/);
      if (r_list && r_list[1] === '!!"1"') {
        this.online = STATUS_ONLINE;
        this._wx_sync_check();
        return;
      }
      this._login_get_uuid();
    }
  }).bind(this));
};

WxClient.prototype.status = function () {
  if (!this.online) {
    logger.info('客户端已下线');
    return 0;
  }
  return 1;
};

WxClient.prototype._login_get_uuid = function () {
  this.online = STATUS_LOGGING;
  const url = 'https://login.weixin.qq.com/jslogin?appid=wx782c26e4c19acffb';
  request(url, (function (error, response, body) {
    if (error || response.statusCode !== 200) {
      this._login_get_uuid();
      return;
    }
    const r_list = body.match(/window\.QRLogin\.code = (\d+); window\.QRLogin\.uuid = "([^"]+)"/);
    if (!r_list) {
      this._login_get_uuid();
      return;
    }
    this.uuid = r_list[2];
    this._gen_qrcode();
  }).bind(this));
};

WxClient.prototype._gen_qrcode = function () {
  const url = 'https://login.weixin.qq.com/l/' + this.uuid;
  qrcode.generate(url, {small: true});
  this._wait_to_login();
};

WxClient.prototype._wait_to_login = function () {
  const login_check_dict = {
    loginicon: true,
    uuid: this.uuid,
    tip: 1,
    '_': Date.now(),
  };
  const login_check_query = querystring.stringify(login_check_dict);
  const url = 'https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login?' + querystring.unescape(login_check_query);
  request(url, (function (error, response, body) {
    if (error || response.statusCode !== 200) {
      logger.error('login error');
      this._login_get_uuid();
      return;
    }
    const r_list = body.match(/window\.(.+?)=(.+?);/g);
    const r_code = r_list[0].match(/window\.(.+?)=(.+?);/);
    const code = r_code[2];
    if (code === '200') {
      logger.info('200 正在登录中...');
      const r_direct = r_list[1].match(/window\.redirect_uri="([^"]+)"/);
      const direct = r_direct[1] + '&fun=new';
      request(direct, (function (error, response, body) {
        const doc = new DOMParser().parseFromString(body);
        this.sid = xpath.select('//wxsid/text()', doc).toString();
        this.uin = xpath.select('//wxuin/text()', doc).toString();
        this.skey = xpath.select('//skey/text()', doc).toString();
        this.pass_ticket = xpath.select('//pass_ticket/text()', doc).toString();
        for (let i = 0, len = response.headers['set-cookie'].length; i < len; i++) {
          const r = response.headers['set-cookie'][i].match(/(.+?)=(.+?);/g);
          this.cookies += r[0];
        }
        this._wx_init();
      }).bind(this));
    }
    else if (code === '201') {
      logger.info('201 已扫码，请点击登录');
      setTimeout(this._wait_to_login.bind(this), 3000);
    }
    else if (code === '408') {
      logger.info('408 登录超时，重新获取二维码');
      this._login_get_uuid();
    }
    else if (code === '500') {
      logger.info('500 登录错误，重新登录');
      this._login_get_uuid();
    }
    else {
      logger.info(code + ' 发生未知错误，退出');

    }
  }).bind(this));
};

WxClient.prototype._wx_init = function () {
  const url = 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxinit?r=' + Date.now() + '&pass_ticket=' + this.pass_ticket;
  const data = {
    'BaseRequest':
      {'Uin': parseInt(this.uin), 'Sid': this.sid, 'Skey': this.skey, 'DeviceID': this.deviceid}
  };
  const headers = {'Cookie': this.cookies};
  request.post({url: url, headers: headers, body: JSON.stringify(data)}, (function (error, response, body) {
    if (error || response.statusCode !== 200) {
      logger.error('init error');
      this._wx_init();
      return;
    }
    const init_dict = JSON.parse(body);
    this.syncKey = init_dict['SyncKey'];
    this._wx_form_syncStr();
    this._parse_contact(init_dict['ContactList']);
    this.myUserName = init_dict['User']['UserName'];
    logger.info('初始化成功，开始监听消息');
    this.online = STATUS_ONLINE;
    this._wx_status_notify();
    this._wx_get_contact();
    this._wx_sync_check();
  }).bind(this));
};

WxClient.prototype._wx_status_notify = function () {
  const url = 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxstatusnotify?pass_ticket=' + this.pass_ticket;
  const data = {
    'BaseRequest':
      {'Uin': parseInt(this.uin), 'Sid': this.sid, 'Skey': this.skey, 'DeviceID': this.deviceid},
    'Code': 3,
    'FromUserName': this.myUserName,
    'ToUserName': this.myUserName,
    'ClientMsgId': Date.now()
  };
  request.post({url: url, body: JSON.stringify(data)}, (function (error, response, body) {
    if (error) {
      logger.error('status notify error');

    }
    else {
      if (response.statusCode !== 200)
        return logger.error('Invaild Status code:', response.statusCode);
      const body_dic = JSON.parse(body);
      if (body_dic['BaseResponse']['Ret'] === 0)
        logger.info('状态同步成功');
      else {
        logger.info('状态同步失败 ' + body_dic['BaseResponse']['ErrMsg']);
      }
    }
  }).bind(this));
};

WxClient.prototype._parse_contact = function (contactList) {
  const groupList = [];
  contactList.forEach(contact => {
    logger.debug(contact['NickName']);
    const userName = contact['UserName'];
    if (userName.startsWith('@@')) {
      if (!(userName in this.groups)) {
        this.groups[userName] = contact;
        this.contactMembers[userName] = contact;
        groupList.push(userName);
      }
    }
    else {
      if (!(userName in this.members)) {
        this.members[userName] = contact;
        this.contactMembers[userName] = contact;
      }
    }
  });
  this._wx_batch_get_contact(groupList);
};

WxClient.prototype._update_contact = function (userName) {
  if (userName.startsWith('@@') && !this.groups.hasOwnProperty(userName))
    this._wx_batch_get_contact([userName]);
};

WxClient.prototype._wx_get_contact = function () {
  const query_dic = {
    'pass_ticket': this.pass_ticket,
    'skey': this.skey,
    'seq': 0,
    'r': Date.now()
  };
  const headers = {'Cookie': this.cookies, 'ContentType': 'application/json; charset=UTF-8'};
  const url = 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxgetcontact?' + querystring.unescape(querystring.stringify(query_dic));
  request.get({url: url, headers: headers}, (function (error, response, body) {
    if (error || response.statusCode !== 200) {
      logger.error('get contact error');
      return;
    }
    const body_dic = JSON.parse(body);
    logger.debug('get ' + body_dic['MemberList'].length + ' contacts');
    this._parse_contact(body_dic['MemberList']);
  }).bind(this));
};

WxClient.prototype._wx_batch_get_contact = function (group_list) {
  const query_dic = {
    'type': 'ex',
    'pass_ticket': this.pass_ticket,
    'r': Date.now()
  };
  const url = 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxbatchgetcontact?' + querystring.unescape(querystring.stringify(query_dic));
  const groupList = [];
  for (let i = 0; i < group_list.length; i++) {
    groupList.push({'UserName': group_list[i], 'ChatRoomId': ''});
  }
  const post_dic = {
    'BaseRequest': {
      'DeviceID': this.deviceid,
      'Sid': this.sid,
      'Skey': this.skey,
      'Uin': this.uin,
    },
    'Count': groupList.length,
    'List': groupList,
  };
  const headers = {'Cookie': this.cookies, 'ContentType': 'application/json; charset=UTF-8'};
  request.post({url: url, headers: headers, body: JSON.stringify(post_dic)}, (function (error, response, body) {
    if (error || response.statusCode !== 200)
      return;
    const body_dic = JSON.parse(body);
    if (body_dic['BaseResponse']['Ret'] === 0) {
      for (let i = 0, len = body_dic['Count']; i < len; i++) {
        const groupUserName = body_dic['ContactList'][i]['UserName'];
        if (!groupUserName.startsWith('@@')) continue;
        if (this.groups[groupUserName] === undefined) this.groups[groupUserName] = body_dic['ContactList'][i];
        this.groups[groupUserName]['groupMembers'] = {};
        for (let j = 0, len_j = body_dic['ContactList'][i]['MemberCount']; j < len_j; j++) {
          const userNameInGroup = body_dic['ContactList'][i]['MemberList'][j]['UserName'];
          this.groups[groupUserName]['groupMembers'][userNameInGroup] = body_dic['ContactList'][i]['MemberList'][j];
        }
      }
    }
  }).bind(this));
};

WxClient.prototype._wx_form_syncStr = function () {
  let syncStr = '';
  for (let i = 0; i < parseInt(this.syncKey['Count']); i++) {
    syncStr += this.syncKey['List'][i]['Key'] + '_' + this.syncKey['List'][i]['Val'];
    if (i !== parseInt(this.syncKey['Count']) - 1)
      syncStr += '|';
  }
  this.syncStr = syncStr;
};

WxClient.prototype._wx_sync_check = function () {
  const query_dic = {
    'r': Date.now(),
    'skey': this.skey,
    'sid': this.sid,
    'uin': this.uin,
    'deviceid': this.deviceid,
    'synckey': this.syncStr,
    '_': Date.now()
  };
  const url = 'https://webpush.weixin.qq.com/cgi-bin/mmwebwx-bin/synccheck?' + querystring.stringify(query_dic);
  const headers = {'Referer': 'https://wx.qq.com/', 'Cookie': this.cookies};
  request.get({url: url, headers: headers}, (function (error, response, body) {
    if (error) {
      logger.error('sync check');
      this._wx_sync_check();

    }
    else {
      if (response.statusCode !== 200) {
        logger.error('Invalid Status code:', response.statusCode);
        this._wx_sync_check();
        return;
      }
      const r = body.match(/window\.synccheck={retcode:"(\d+)",selector:"(\d+)"}/);
      const retcode = r[1];
      const selector = r[2];
      if (retcode === '1100') {
        logger.info('你在手机上登出了微信，再见！');
        this.stop();
      }
      else if (retcode === '1101') {
        logger.info('你在其他地方登录了web微信，再见！');
        this.stop();
      }
      else if (retcode === '0') {
        if (selector === '2') {
          logger.debug('收到了新消息');
          this._wx_sync();
        }
        else if (selector === '0') {
          logger.info('同步检查');
          this._wx_sync_check();
        }
        else if (selector === '7') {
          logger.info('进入或离开聊天界面');
          this._wx_sync();
        }
        else if (selector === '4') {
          logger.info('朋友圈有新动态');
          this._wx_sync_check();
        }
        else {
          logger.info('未知的selector ' + selector);
          this._wx_sync_check();
        }
      }
      else {
        logger.info('出现了严重错误');
        this.stop();
      }
    }
  }).bind(this));
};

WxClient.prototype._wx_sync = function () {
  const query_dic = {
    'sid': this.sid,
    'skey': this.skey,
    'pass_ticket': this.pass_ticket,
    'r': Date.now()
  };
  const url = 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxsync?' + querystring.stringify(query_dic);

  const data = {
    'BaseRequest':
      {
        'Uin': this.uin,
        'Sid': this.sid
      },
    'SyncKey': this.syncKey,
    'rr': Date.now()
  };
  request.post({url: url, body: JSON.stringify(data)}, (function (error, response, body) {
    if (error || response.statusCode !== 200) {
      this._wx_sync_check();
      return;
    }
    const msgBody = JSON.parse(body);
    if (msgBody['BaseResponse']['Ret'] !== 0) {
      this._wx_sync_check();
      return;
    }
    this._wx_sync_check();
    this.syncKey = msgBody['SyncKey'];
    this._wx_form_syncStr();
    this._handle_msg(msgBody['AddMsgList']);
  }).bind(this));
};

const MSG_TYPES = {
  MSGTYPE_TEXT: 1,
  MSGTYPE_IMAGE: 3,
  MSGTYPE_VOICE: 34,
  MSGTYPE_VIDEO: 43,
  MSGTYPE_MICROVIDEO: 62,
  MSGTYPE_EMOTICON: 47,
  MSGTYPE_APP: 49,
  MSGTYPE_VOIPMSG: 50,
  MSGTYPE_VOIPNOTIFY: 52,
  MSGTYPE_VOIPINVITE: 53,
  MSGTYPE_LOCATION: 48,
  MSGTYPE_STATUSNOTIFY: 51,
  MSGTYPE_SYSNOTICE: 9999,
  MSGTYPE_POSSIBLEFRIEND_MSG: 40,
  MSGTYPE_VERIFYMSG: 37,
  MSGTYPE_SHARECARD: 42,
  MSGTYPE_SYS: 1e4,
  MSGTYPE_RECALLED: 10002
};

WxClient.prototype._handle_msg = function (msgs) {
  for (let i = 0, len = msgs.length; i < len; i++) {
    const msgType = msgs[i]['MsgType'];
    const userName = msgs[i]['FromUserName'];
    const name = this._get_user_remark_name(msgs[i]['FromUserName']);
    const msgId = msgs[i]['MsgId'];
    let content = querystring.unescape(msgs[i]['Content']);

    if (userName === this.myUserName)
      continue;

    content = this._prepare_content(userName, content);

    this._plugins.forEach(p => p._handle_msg_hook(msgType, userName, name, msgId, content));

    switch (msgType) {
      case MSG_TYPES.MSGTYPE_TEXT:
        this._show_msg(msgs[i]);
        break;
      case MSG_TYPES.MSGTYPE_IMAGE:
        logger.info(name + ': 发送了一张图片，暂不支持，请前往手机查看');
        break;
      case MSG_TYPES.MSGTYPE_VOICE:
        logger.info(name + ': 发送了一段语音，暂不支持，请前往手机查看');
        break;
      case MSG_TYPES.MSGTYPE_VIDEO:
      case MSG_TYPES.MSGTYPE_MICROVIDEO:
        logger.info(name + ': 发送了一段视频，暂不支持，请前往手机查看');
        break;
      case MSG_TYPES.MSGTYPE_EMOTICON:
        logger.info(name + ': 发送了一个表情，暂不支持，请前往手机查看');
        break;
      case MSG_TYPES.MSGTYPE_LOCATION:
        logger.info(name + ': 分享了一个地址');
        logger.debug(msgs[i]);
        break;
      case MSG_TYPES.MSGTYPE_APP:
        logger.info('%s: 分享了一个链接，请粘贴url到浏览器查看', name);
        logger.info('标题: %s', msgs[i]['FileName']);
        logger.info('链接: %s', msgs[i]['Url']);
        break;
      case MSG_TYPES.MSGTYPE_STATUSNOTIFY:
        logger.info('获取了联系人信息');
        this._update_contact(msgs[i]['ToUserName']);
        break;
      case MSG_TYPES.MSGTYPE_SYSNOTICE:
      case MSG_TYPES.MSGTYPE_SYS:
        logger.info(name + '【系统消息】: ' + content);
        break;
      case MSG_TYPES.MSGTYPE_RECALLED:
        logger.info(name + ': 撤回了一条消息');
        break;
      default:
        logger.info('发现未定义的msgType ' + msgType);
        logger.info(msgs[i]);

    }
  }
};

WxClient.prototype._prepare_content = function (groupName, content) {
  const ret = /^(@[\da-f]{32,64}):/.exec(content);
  if (ret) {
    content = this._get_member_remark_name(groupName, ret[1]) + content.slice(ret[1].length);
  }
  return content;
};

WxClient.prototype._show_msg = function (msg) {
  if (msg) {
    const srcName = this._get_user_remark_name(msg['FromUserName']);
    const dstName = this._get_user_remark_name(msg['ToUserName']);
    const content = this._prepare_content(msg['FromUserName'], msg['Content']);

    logger.info(srcName + ' -> ' + dstName + ': ' + content);
  }
};

WxClient.prototype._get_user_remark_name = function (userName) {
  let remarkName;
  if (userName.indexOf('@@') === 0 && userName in this.groups) {
    remarkName = this.groups[userName]['RemarkName'];
    remarkName = remarkName ? remarkName : this.groups[userName]['NickName'];
  }
  else if (userName.indexOf('@@') === 0 && !(userName in this.groups)) {
    this._wx_batch_get_contact([userName]);
  }
  else if (userName in this.members) {
    remarkName = this.members[userName]['RemarkName'];
    remarkName = remarkName ? remarkName : this.members[userName]['NickName'];
  }

  return remarkName ? remarkName : '未知';
};

WxClient.prototype._get_member_remark_name = function (groupName, userName) {
  let remarkName;
  if (groupName in this.groups && userName in this.groups[groupName]['groupMembers']) {
    remarkName = this.groups[groupName]['groupMembers'][userName]['RemarkName'];
    remarkName = remarkName ? remarkName : this.groups[groupName]['groupMembers'][userName]['NickName'];
  }
  return remarkName ? remarkName : '未知';
};

WxClient.prototype.send_msg = function (toUser, msg) {
  const url = 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxsendmsg?pass_ticket=' + this.pass_ticket;
  const localID = Date.now().toString().slice(0, -4) + parseInt(Math.random() * 10000);
  const data = {
    'BaseRequest':
      {
        'Uin': parseInt(this.uin),
        'Sid': this.sid,
        'Skey': this.skey,
        'DeviceID': this.deviceid
      },
    'Msg':
      {
        'ClientMsgId': localID,
        'Content': msg,
        'FromUserName': this.myUserName,
        'LocalID': localID,
        'ToUserName': toUser,
        'Type': 1
      }
  };
  const headers = {'Cookie': this.cookies, 'ContentType': 'application/json; charset=UTF-8'};
  request.post({url: url, headers: headers, body: JSON.stringify(data)}, (function (error, response) {
    if (error || response.statusCode !== 200) {
      logger.error('send msg error!');
    }
  }).bind(this));
};

WxClient.prototype.list_all_members = function () {
  return this.members;
};

WxClient.prototype.list_members_in_group = function (groupUserName) {
  return this.groups[groupUserName]['groupMembers'];
};

WxClient.prototype.list_contacts = function () {
  return this.contactMembers;
};

WxClient.prototype.isInContact = function (userName) {
  return this.contactMembers.hasOwnProperty(userName);
};

WxClient.prototype.add_plugin = function (plugin) {
  this._plugins.push(plugin);
};

WxClient.prototype.get_userName_from_nickName = function (nickname) {
  const ret = Object.keys(this.contactMembers).filter(userName => nickname === this.contactMembers[userName]['NickName']);
  return ret.length > 0 ? ret[0] : '';
};

const _running_data_path = path.join(__dirname, '../temp/running_data');

WxClient.prototype.load_cache = function () {
  try {
    const dir = path.dirname(_running_data_path);
    if (!fs.existsSync(path.dirname(_running_data_path))) {
      fs.mkdirSync(dir, 0o755);
    }
    const data = JSON.parse(fs.readFileSync(_running_data_path));
    Object.keys(data).forEach(key => this[key] = data[key]);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      logger.warn('fail to load cache, new start');
      logger.warn(e);
    }
  }
};

WxClient.prototype.dump_cache = function () {
  let data;
  if (this.online === STATUS_OFFLINE) {
    data = '{}';
  }
  else {
    data = JSON.stringify({
      deviceid: this.deviceid,
      uuid: this.uuid,
      sid: this.sid,
      uin: this.uin,
      skey: this.skey,
      syncStr: this.syncStr,
      syncKey: this.syncKey,
      pass_ticket: this.pass_ticket,
      myUserName: this.myUserName,
      cookies: this.cookies,
      members: this.members,
      contactMembers: this.contactMembers,
      groups: this.groups
    });
  }
  try {
    fs.writeFileSync(_running_data_path, data);
  } catch (e) {
    logger.error(e);
  }
};

WxClient.prototype.cleanup = function () {
  this.dump_cache();
};

module.exports = WxClient;

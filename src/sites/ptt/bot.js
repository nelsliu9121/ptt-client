import EventEmitter from 'eventemitter3';
import sleep from 'sleep-promise';
import Terminal2 from 'terminal.js-wcwidth';

import key from '../../utils/keyboard';
import {
  getWidth,
  indexOfWidth,
  substrWidth,
} from '../../utils/char';

import defaultConfig from './config';

const setIntevalUntil = (async (_func, _validate, _inteval) => {
  await sleep(_inteval);
  let ret = await _func();
  if (_validate(ret)) return ret;
  else return setIntevalUntil(_func, _validate, _inteval);
});

class Bot extends EventEmitter {
  static initialState = {
    login: false,
  };
  constructor(_config) {
    super();
    const config = {...defaultConfig, ..._config};

    this._parser = config.parser;
    this._term2 = new Terminal2(config.terminal);
    this._state = { ...Bot.initialState };
    this._term2.state.setMode('stringWidth', 'dbcs');

    let Socket;
    switch (config.protocol.toLowerCase()) {
      case 'websocket':
      case 'ws':
      case 'wss':
        Socket = require("../../core/socket").default;
        break;
      case 'telnet':
      case 'ssh':
      default:
        Socket = null;
    }

    if (Socket === null) {
      throw `Invalid protocol: ${config.protocol}`;
    }

    const socket = new Socket(config);
    socket.onconnect = this.emit.bind(this, 'connect');
    socket.onmessage = this.emit.bind(this, 'message');
    socket.connect();

    this.on('message', (msg) => {
      this._term2.write(msg);
      this.emit('redraw', this._term2.toString());
    });
    this._socket = socket;
  }

  get state() {
    return {...this._state};
  }

  async send(msg) {
    return new Promise(resolve => {
      this._socket.send(msg);
      this.once('message', msg => {
        resolve(msg);
      });
    });
  }

  async login(username, password) {
    if (this._state.login) return;
    await this.send(`${username}${key.Enter}${password}${key.Enter}`);
    let ret;
    while ((ret = await this._checkLogin()) === null) {
      await sleep(400);
    }
    if (ret) {
      const { _state: state } = this;
      state.login = true;
      state.position = {
        boardname: "",
      };
    }
    return ret;
  }

  async _checkLogin() {
    const getLine = this._term2.state.getLine.bind(this._term2.state);
    if (getLine(21).str.includes("密碼不對或無此帳號")) {
      this.emit('login.failed');
      return false;
    } else if (getLine(22).str.includes("您想刪除其他重複登入的連線嗎")) {
      await this.send(`y${key.Enter}`);
    } else if (getLine(23).str.includes("按任意鍵繼續")) {
      await this.send(` `);
    } else if (getLine(23).str.includes("您要刪除以上錯誤嘗試的記錄嗎")) {
      await this.send(`y${key.Enter}`);
    } else if (getLine(0).str.includes("主功能表")) {
      this.emit('login.success');
      return true;
    } else {
      await this.send(`q`);
    }
    return null;
  }

  async getArticles(boardname, offset=0) {
    await this.enterBoard(boardname);
    offset |= 0;
    if (offset > 0) {
      offset = Math.max(offset-9, 1);
      await this.send(`$$${offset}${key.Enter}`);
    }
    const getLine = this._term2.state.getLine.bind(this._term2.state);
    let articles = [];
    for(let i=3; i<=22; i++) {
      let line = getLine(i).str;
      articles.push({
        sn:     substrWidth('dbcs', line, 0,   7).trim(),
        push:   substrWidth('dbcs', line, 9,   2).trim(),
        date:   substrWidth('dbcs', line, 11,  5).trim(),
        author: substrWidth('dbcs', line, 17, 12).trim(),
        status: substrWidth('dbcs', line, 30,  2).trim(),
        title:  substrWidth('dbcs', line, 32    ).trim(),
      });
    }
    return articles;
  }

  async getArticle(boardname, sn) {
    await this.enterBoard(boardname);
    const getLine = this._term2.state.getLine.bind(this._term2.state);

    await this.send(`${sn}${key.Enter}${key.Enter}`);

    let article = {
      sn,
      author: getLine(0).str.slice(5, 50).trim(),
      title: getLine(1).str.slice(5).trim(),
      timestamp: getLine(2).str.slice(5).trim(),
      lines: [],
    };

    do {
      for(let i=0; i<23; i++) {
        article.lines.push(getLine(i).str);
      }
      await this.send(key.PgDown);
    } while (!getLine(23).str.includes("100%"));

    const lastLine = article.lines[article.lines.length-1];
    for(let i=0; i<23; i++) {
      if (getLine(i).str == lastLine) {
        for(let j=i+1; j<23; j++) {
          article.lines.push(getLine(j).str);
        }
        break;
      }
    }

    await this.send(key.ArrowLeft);

    return article;
  }

  async enterBoard(boardname) {
    if (this.state.position.boardname.toLowerCase() === boardname.toLowerCase())
      return true;
    await this.send(`s${boardname}${key.Enter} ${key.Home}${key.End}`);
    boardname = boardname.toLowerCase();
    const getLine = this._term2.state.getLine.bind(this._term2.state);
    
    if (getLine(23).str.includes("按任意鍵繼續")) {
      await this.send(` `);
    }
    if (getLine(0).str.toLowerCase().includes(`${boardname}`)) {
      this._state.position.boardname = boardname;
      return true;
    }
    return false;
  }
}

export default Bot;

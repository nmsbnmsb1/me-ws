"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WS = void 0;
const ws_1 = __importDefault(require("ws"));
const Utils = __importStar(require("./utils"));
class WS {
    constructor(options) {
        this.options = options;
        this.status = { name: 'idle', connecting: {}, connected: {}, waitForconnect: {} };
        this.lns = {};
        this.queue = { waits: [], sending: [] };
        this.subscribeStore = {};
    }
    log(evtName, msg) {
        if (typeof this.options.logger === 'function') {
            this.options.logger(evtName, msg);
        }
        else {
            let { title, logger } = this.options.logger;
            let prefix = `${title}`;
            if (evtName === 'connecting')
                logger.info(`[${prefix}] - Connecting to ${this.url}`);
            else if (evtName === 'open')
                logger.info(`[${prefix}] - Connected`);
            else if (evtName === 'ping')
                logger.info(`[${prefix}] - Received PING`);
            else if (evtName === 'send_ping')
                logger.info(`[${prefix}] - Send PING`);
            else if (evtName === 'pong')
                logger.info(`[${prefix}] - Received PONG`);
            else if (evtName === 'error')
                logger.error(`[${prefix}] - Error, ${msg.message}`);
            else if (evtName === 'close')
                logger.error(`[${prefix}] - Closed due to ${msg.closeEventCode}: ${msg.reason}`);
            else if (evtName === 'close_all')
                logger.warn(`[${prefix}] - Manual close`);
        }
    }
    isIdle() {
        return this.status.name === 'idle';
    }
    isConnected() {
        return this.status.name === 'connected';
    }
    toStatus(from, to) {
        if (!from || this.status.name === from) {
            let t = this;
            if (t[this.status.name])
                t[this.status.name]('exit');
            t[to]('enter');
        }
    }
    connecting(action) {
        if (action === 'enter') {
            this.status.name = 'connecting';
            this.log('connecting');
            this.ws = new ws_1.default(this.url, { ...this.options.wsOptions });
            this.ws.once('error', (err) => {
                if (this.ws) {
                    this.ws.removeAllListeners();
                    this.ws.close();
                    this.ws.terminate();
                    this.ws = undefined;
                }
                this.log('error', err);
                this.toStatus('connecting', 'waitForReconnect');
            });
            this.ws.once('open', () => {
                this.log('open');
                this.toStatus('connecting', 'connected');
            });
        }
        else if (action === 'exit') {
            this.ws.removeAllListeners();
        }
    }
    connected(action) {
        if (action === 'enter') {
            this.status.name = 'connected';
            {
                this.ws.on('ping', () => {
                    this.log('ping');
                    if (this.options.pong) {
                        this.options.pong(this);
                    }
                    else {
                        this.ws.pong();
                    }
                });
                this.status.connected.pingT = setInterval(() => {
                    this.log('send_ping');
                    if (typeof this.options.ping === 'function') {
                        this.options.ping(this);
                    }
                    else if (this.options.ping) {
                        this.ws.send(this.options.ping);
                    }
                    else {
                        this.ws.ping();
                    }
                }, this.options.pingInterval);
                this.ws.on('pong', () => {
                    this.log('pong');
                });
            }
            this.ws.on('message', (msg) => {
                let data = this.options.msgParser(msg);
                if (!data)
                    return;
                let isError = data instanceof Error;
                if (isError)
                    this.log('error', data);
                for (let lnid in this.lns) {
                    let { m, cb } = this.lns[lnid];
                    if (m(data))
                        cb(data);
                }
                this.queue.sending = this.queue.sending.filter(({ cb, defer }) => {
                    if (!cb.m(data))
                        return true;
                    cb.cb && cb.cb(data);
                    defer && defer[!isError ? 'resolve' : 'reject'](data);
                    return false;
                });
                this.doQueue();
            });
            this.ws.on('error', (err) => {
                this.log('error', err);
            });
            this.ws.on('close', (closeEventCode, reason) => {
                this.log('close', { closeEventCode, reason });
                this.toStatus('connected', 'waitForReconnect');
            });
            {
                for (let s in this.subscribeStore)
                    this.queue.waits.push({
                        payload: this.subscribeStore[s].subscribePayload,
                        cb: this.subscribeStore[s].subscribeCb,
                    });
                this.doQueue();
            }
        }
        else if (action === 'exit') {
            this.close();
        }
    }
    waitForReconnect(action) {
        if (action === 'enter') {
            this.status.name = 'waitForReconnect';
            this.status.waitForconnect.delayT = setTimeout(() => this.toStatus('waitForReconnect', 'connecting'), this.options.reconnectDelayMS);
        }
        else if (action === 'exit') {
            clearTimeout(this.status.waitForconnect.delayT);
        }
    }
    open(url) {
        if (this.url === url && this.status.name !== 'idle')
            return;
        this.url = url;
        if (this.status.name === 'idle') {
            this.toStatus('idle', 'connecting');
        }
        else if (this.status.name === 'connecting' || this.status.name === 'connected') {
            this.close();
            this.toStatus(undefined, 'waitForReconnect');
        }
        else {
        }
    }
    close() {
        this.status.name = 'idle';
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws.terminate();
            this.ws = undefined;
        }
        clearInterval(this.status.connected.pingT);
        clearTimeout(this.status.waitForconnect.delayT);
        this.queue.waits.unshift(...this.queue.sending);
        this.queue.sending.length = 0;
    }
    terminate() {
        var _a, _b;
        this.close();
        this.lns = {};
        {
            let err = new Error('Connection is closed');
            for (let data of this.queue.waits) {
                ((_a = data.cb) === null || _a === void 0 ? void 0 : _a.cb) && data.cb.cb(err);
                data.defer && data.defer.reject(err);
            }
            for (let data of this.queue.sending) {
                ((_b = data.cb) === null || _b === void 0 ? void 0 : _b.cb) && data.cb.cb(err);
                data.defer && data.defer.reject(err);
            }
            this.queue.waits.length = this.queue.sending.length = 0;
        }
        this.subscribeStore = {};
    }
    listen(lnid, cb) {
        this.lns[lnid] = cb;
    }
    unlisten(lnid) {
        delete this.lns[lnid];
    }
    async send(payload, cb) {
        let defer;
        if (!cb) {
            this.queue.waits.push({ payload });
        }
        else if (cb.cb) {
            this.queue.waits.push({ payload, cb });
        }
        else {
            defer = Utils.defer();
            this.queue.waits.push({ payload, cb, defer });
        }
        if (this.status.name === 'connected')
            this.doQueue();
        return defer === null || defer === void 0 ? void 0 : defer.promise;
    }
    doQueue() {
        let { waits, sending } = this.queue;
        while (waits.length > 0 && sending.length <= this.options.sendConcurrency) {
            let data = waits.shift();
            if (!data.cb) {
                this.ws.send(data.payload);
            }
            else {
                sending.push(data);
                this.ws.send(data.payload);
            }
        }
    }
    async subscribe(subscribePayload, subscribeCb, lnid, lncb) {
        let payloadString = JSON.stringify(subscribePayload);
        if (!this.subscribeStore[payloadString]) {
            this.subscribeStore[payloadString] = { subscribePayload, subscribeCb };
        }
        this.lns[lnid] = lncb;
        return this.send(subscribePayload, subscribeCb);
    }
    async unsubscribe(subscribePayload, unsubscribePayload, unsubscribeCb, lnid) {
        delete this.subscribeStore[JSON.stringify(subscribePayload)];
        delete this.lns[lnid];
        return this.send(unsubscribePayload, unsubscribeCb);
    }
}
exports.WS = WS;
//# sourceMappingURL=ws.js.map
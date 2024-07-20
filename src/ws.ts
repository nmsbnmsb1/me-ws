import WebSocketClient from 'ws';
import * as Utils from './utils';

//选项
export interface IWSOptions {
	wsOptions?: any;
	reconnectDelayMS: number;
	sendConcurrency: number;
	logger?:
		| ((evtName: string, msg?: any) => any)
		| {
				logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
				title: string;
		  };
	pingInterval: number;
	ping?: any | ((ws: WS) => any);
	pong?: (ws: WS) => any;
	msgParser?: (msg: any) => undefined | Error | { [name: string]: any };
}
export type IWSCallBackMatch = (data: any) => boolean;
export type IWSCallBack = (data: any) => any;

export class WS {
	protected ws: WebSocketClient;
	protected url: string;
	protected options: IWSOptions;
	protected status: { name: string; connecting: {}; connected: { pingT?: any }; waitForconnect: { delayT?: any } };
	protected lns: { [lnid: string]: { m: IWSCallBackMatch; cb: IWSCallBack } };
	protected queue: {
		waits: { payload: any; cb?: { m: IWSCallBackMatch; cb?: IWSCallBack }; defer?: any }[];
		sending: any[];
	};
	protected subscribeStore: {
		[payload: string]: { subscribePayload: any; subscribeCb: { m: IWSCallBackMatch; cb?: IWSCallBack } };
	};

	constructor(options: IWSOptions) {
		this.options = options;
		this.status = { name: 'idle', connecting: {}, connected: {}, waitForconnect: {} };
		this.lns = {};
		this.queue = { waits: [], sending: [] };
		this.subscribeStore = {};
	}
	protected log(evtName: string, msg?: any) {
		if (typeof this.options.logger === 'function') {
			this.options.logger(evtName, msg);
		} else {
			let { title, logger } = this.options.logger;
			let prefix = `${title}`;
			if (evtName === 'connecting') logger.info(`[${prefix}] - Connecting to ${this.url}`);
			else if (evtName === 'open') logger.info(`[${prefix}] - Connected`);
			else if (evtName === 'ping') logger.info(`[${prefix}] - Received PING`);
			else if (evtName === 'send_ping') logger.info(`[${prefix}] - Send PING`);
			else if (evtName === 'pong') logger.info(`[${prefix}] - Received PONG`);
			else if (evtName === 'error') logger.error(`[${prefix}] - Error, ${msg.message}`);
			else if (evtName === 'close') logger.error(`[${prefix}] - Closed due to ${msg.closeEventCode}: ${msg.reason}`);
			else if (evtName === 'close_all') logger.warn(`[${prefix}] - Manual close`);
		}
	}
	// MARK: - 状态转换
	public isIdle() {
		return this.status.name === 'idle';
	}
	public isConnected() {
		return this.status.name === 'connected';
	}
	protected toStatus(from: string, to: string) {
		if (!from || this.status.name === from) {
			let t = this as any;
			if (t[this.status.name]) t[this.status.name]('exit');
			t[to]('enter');
		}
	}
	protected connecting(action: 'enter' | 'exit') {
		if (action === 'enter') {
			this.status.name = 'connecting';
			this.log('connecting');
			//连接websocket
			this.ws = new WebSocketClient(this.url, { ...this.options.wsOptions });
			this.ws.once('error', (err) => {
				if (this.ws) {
					this.ws.removeAllListeners();
					this.ws.close();
					this.ws.terminate();
					this.ws = undefined;
				}
				//
				this.log('error', err);
				this.toStatus('connecting', 'waitForReconnect');
			});
			this.ws.once('open', () => {
				this.log('open');
				this.toStatus('connecting', 'connected');
			});
		} else if (action === 'exit') {
			this.ws.removeAllListeners();
		}
	}
	protected connected(action: 'enter' | 'exit') {
		if (action === 'enter') {
			this.status.name = 'connected';
			//ping-pong
			{
				this.ws.on('ping', () => {
					this.log('ping');
					if (this.options.pong) {
						this.options.pong(this);
					} else {
						this.ws.pong();
					}
				});
				this.status.connected.pingT = setInterval(() => {
					this.log('send_ping');
					if (typeof this.options.ping === 'function') {
						this.options.ping(this);
					} else if (this.options.ping) {
						this.ws.send(this.options.ping);
					} else {
						this.ws.ping();
					}
				}, this.options.pingInterval);
				this.ws.on('pong', () => {
					this.log('pong');
				});
			}
			//message-handler
			this.ws.on('message', (msg) => {
				let data = this.options.msgParser(msg);
				if (!data) return;
				//if-error
				let isError = data instanceof Error;
				if (isError) this.log('error', data);
				//call-back
				for (let lnid in this.lns) {
					let { m, cb } = this.lns[lnid];
					if (m(data)) cb(data);
				}
				this.queue.sending = this.queue.sending.filter(({ cb, defer }) => {
					if (!cb.m(data)) return true;
					//
					cb.cb && cb.cb(data);
					defer && defer[!isError ? 'resolve' : 'reject'](data);
					return false;
				});
				this.doQueue();
			});
			this.ws.on('error', (err) => {
				this.log('error', err);
			});
			//disconnect
			this.ws.on('close', (closeEventCode, reason) => {
				this.log('close', { closeEventCode, reason });
				this.toStatus('connected', 'waitForReconnect');
			});
			//重新发送订阅命令
			{
				for (let s in this.subscribeStore)
					this.queue.waits.push({
						payload: this.subscribeStore[s].subscribePayload,
						cb: this.subscribeStore[s].subscribeCb,
					});
				this.doQueue();
			}
		} else if (action === 'exit') {
			this.close();
		}
	}
	protected waitForReconnect(action: 'enter' | 'exit') {
		if (action === 'enter') {
			this.status.name = 'waitForReconnect';
			this.status.waitForconnect.delayT = setTimeout(
				() => this.toStatus('waitForReconnect', 'connecting'),
				this.options.reconnectDelayMS
			);
		} else if (action === 'exit') {
			clearTimeout(this.status.waitForconnect.delayT);
		}
	}
	//open-close-terminate
	public open(url: string) {
		//门卫大爷不让进
		if (this.url === url && this.status.name !== 'idle') return;
		//
		this.url = url;
		if (this.status.name === 'idle') {
			//如果当前闲的，就立即去干活！！
			this.toStatus('idle', 'connecting');
		} else if (this.status.name === 'connecting' || this.status.name === 'connected') {
			//如果已经在干活，先歇歇，再干
			this.close();
			this.toStatus(undefined, 'waitForReconnect');
		} else {
			//已经在歇了，等休息结束，自动去上班
		}
	}
	public close() {
		this.status.name = 'idle';
		if (this.ws) {
			this.ws.removeAllListeners();
			this.ws.close();
			this.ws.terminate();
			this.ws = undefined;
		}
		clearInterval(this.status.connected.pingT);
		clearTimeout(this.status.waitForconnect.delayT);
		//store-queue, 把正在sending的放回waits
		this.queue.waits.unshift(...this.queue.sending);
		this.queue.sending.length = 0;
	}
	public terminate() {
		this.close();
		//清除所有的侦听器
		this.lns = {};
		//kill-queue,全部Reject
		{
			let err = new Error('Connection is closed');
			for (let data of this.queue.waits) {
				data.cb?.cb && data.cb.cb(err);
				data.defer && data.defer.reject(err);
			}
			for (let data of this.queue.sending) {
				data.cb?.cb && data.cb.cb(err);
				data.defer && data.defer.reject(err);
			}
			this.queue.waits.length = this.queue.sending.length = 0;
		}
		//
		this.subscribeStore = {};
	}
	//listen
	public listen(lnid: string, cb: { m: IWSCallBackMatch; cb: IWSCallBack }) {
		this.lns[lnid] = cb;
	}
	public unlisten(lnid: string) {
		delete this.lns[lnid];
	}
	//send
	public async send(payload: any, cb?: { m: IWSCallBackMatch; cb?: IWSCallBack }) {
		//添加到队列
		let defer: any;
		if (!cb) {
			this.queue.waits.push({ payload });
		} else if (cb.cb) {
			this.queue.waits.push({ payload, cb });
		} else {
			defer = Utils.defer();
			this.queue.waits.push({ payload, cb, defer });
		}
		if (this.status.name === 'connected') this.doQueue();
		return defer?.promise;
	}
	protected doQueue() {
		let { waits, sending } = this.queue;
		while (waits.length > 0 && sending.length <= this.options.sendConcurrency) {
			let data = waits.shift();
			//如果不需要回call
			if (!data.cb) {
				//直接send
				this.ws.send(data.payload);
			} else {
				//等待返回
				sending.push(data);
				this.ws.send(data.payload);
			}
		}
	}
	//subscribe
	public async subscribe(
		subscribePayload: any,
		subscribeCb: { m: IWSCallBackMatch; cb?: IWSCallBack },
		lnid: string,
		lncb: { m: IWSCallBackMatch; cb: IWSCallBack }
	) {
		//缓存订阅命令
		let payloadString = JSON.stringify(subscribePayload);
		if (!this.subscribeStore[payloadString]) {
			this.subscribeStore[payloadString] = { subscribePayload, subscribeCb };
		}
		//缓存订阅回调
		this.lns[lnid] = lncb;
		//发送订阅指令
		return this.send(subscribePayload, subscribeCb);
	}
	public async unsubscribe(
		subscribePayload: any,
		unsubscribePayload: any,
		unsubscribeCb: { m: IWSCallBackMatch; cb?: IWSCallBack },
		lnid: string
	) {
		delete this.subscribeStore[JSON.stringify(subscribePayload)];
		delete this.lns[lnid];
		return this.send(unsubscribePayload, unsubscribeCb);
	}
}

import WebSocketClient from 'ws';
export interface IWSOptions {
    wsOptions?: any;
    reconnectDelayMS: number;
    sendConcurrency: number;
    logger?: ((evtName: string, msg?: any) => any) | {
        logger: {
            info: (msg: string) => void;
            warn: (msg: string) => void;
            error: (msg: string) => void;
        };
        title: string;
    };
    pingInterval: number;
    ping?: any | ((ws: WS) => any);
    pong?: (ws: WS) => any;
    msgParser?: (msg: any) => undefined | Error | {
        [name: string]: any;
    };
}
export type IWSCallBackMatch = (data: any) => boolean;
export type IWSCallBack = (data: any) => any;
export declare class WS {
    protected ws: WebSocketClient;
    protected url: string;
    protected options: IWSOptions;
    protected status: {
        name: string;
        connecting: {};
        connected: {
            pingT?: any;
        };
        waitForconnect: {
            delayT?: any;
        };
    };
    protected lns: {
        [lnid: string]: {
            m: IWSCallBackMatch;
            cb: IWSCallBack;
        };
    };
    protected queue: {
        waits: {
            payload: any;
            cb?: {
                m: IWSCallBackMatch;
                cb?: IWSCallBack;
            };
            defer?: any;
        }[];
        sending: any[];
    };
    protected subscribeStore: {
        [payload: string]: {
            subscribePayload: any;
            subscribeCb: {
                m: IWSCallBackMatch;
                cb?: IWSCallBack;
            };
        };
    };
    constructor(options: IWSOptions);
    protected log(evtName: string, msg?: any): void;
    isIdle(): boolean;
    isConnected(): boolean;
    protected toStatus(from: string, to: string): void;
    protected connecting(action: 'enter' | 'exit'): void;
    protected connected(action: 'enter' | 'exit'): void;
    protected waitForReconnect(action: 'enter' | 'exit'): void;
    open(url: string): void;
    close(): void;
    terminate(): void;
    listen(lnid: string, cb: {
        m: IWSCallBackMatch;
        cb: IWSCallBack;
    }): void;
    unlisten(lnid: string): void;
    send(payload: any, cb?: {
        m: IWSCallBackMatch;
        cb?: IWSCallBack;
    }): Promise<any>;
    protected doQueue(): void;
    subscribe(subscribePayload: any, subscribeCb: {
        m: IWSCallBackMatch;
        cb?: IWSCallBack;
    }, lnid: string, lncb: {
        m: IWSCallBackMatch;
        cb: IWSCallBack;
    }): Promise<any>;
    unsubscribe(subscribePayload: any, unsubscribePayload: any, unsubscribeCb: {
        m: IWSCallBackMatch;
        cb?: IWSCallBack;
    }, lnid: string): Promise<any>;
}

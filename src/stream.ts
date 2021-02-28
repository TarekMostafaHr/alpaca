import WebSocket from 'isomorphic-ws'
import EventEmitter from 'eventemitter3'

import urls from './urls.js'

import {
  Bar,
  Channel,
  DataSource,
  DefaultCredentials,
  Quote,
  Trade,
  TradeUpdate,
  Message,
} from './entities.js'

export declare interface Events {
  open: (connection: AlpacaStream) => void
  close: (connection: AlpacaStream) => void
  authenticated: (connection: AlpacaStream) => void
  success: (message: Message) => void
  error: (message: WebSocket.ErrorEvent | Message) => void
  subscription: (message: Message) => void
  message: (data: Object) => void
  trade_updates: (data: TradeUpdate) => void
  trade: (data: Trade) => void
  quote: (data: Quote) => void
  bar: (data: Bar) => void
}

export class AlpacaStream extends EventEmitter {
  private host: string
  private connection: WebSocket
  private authenticated: boolean

  constructor(
    protected params: {
      credentials: DefaultCredentials
      type: 'account' | 'market_data'
      source?: DataSource
    },
  ) {
    // construct EventEmitter
    super()

    // assign the host we will connect to
    switch (params.type) {
      case 'account':
        this.host = params.credentials.paper
          ? urls.websocket.account.replace('api.', 'paper-api.')
          : urls.websocket.account
        break
      case 'market_data':
        this.host = urls.websocket.market_data(this.params.source)
        break
      default:
        this.host = 'unknown'
    }

    this.connection = new WebSocket(this.host)
    this.connection.onopen = () => {
      let message = {}

      switch (this.params.type) {
        case 'account':
          message = {
            action: 'authenticate',
            data: {
              key_id: params.credentials.key,
              secret_key: params.credentials.secret,
            },
          }
          break
        case 'market_data':
          // {"action":"auth","key":"PK*****","secret":"*************"}
          message = { action: 'auth', ...params.credentials }
          break
      }

      this.connection.send(JSON.stringify(message))

      // pass through
      this.emit('open', this)
    }

    // pass through
    this.connection.onclose = () => this.emit('close', this)

    this.connection.onmessage = (event: any) => {
      let parsed = JSON.parse(event.data),
        messages: any[] = this.params.type == 'account' ? [parsed] : parsed

      messages.forEach((message) => {
        // pass the message
        this.emit('message', message)

        // pass authenticated event
        if ('T' in message && message.msg == 'authenticated') {
          this.authenticated = true
          this.emit('authenticated', this)
        } else if ('stream' in message && message.stream == 'authorization') {
          if (message.data.status == 'authorized') {
            this.authenticated = true
            this.emit('authenticated', this)
          }
        }

        // pass trade_updates event
        if ('stream' in message && message.stream == 'trade_updates') {
          this.emit('trade_updates', message.data)
        }

        // pass trade, quote, bar event
        const x: { [index: string]: keyof Events } = {
          success: 'success',
          subscription: 'subscription',
          error: 'error',
          t: 'trade',
          q: 'quote',
          b: 'bar',
        }

        if ('T' in message) {
          this.emit(x[message.T.split('.')[0]], message)
        }
      })
    }

    // pass the error
    this.connection.onerror = (err: WebSocket.ErrorEvent) => {
      this.emit('error', err)
    }
  }

  /**
   * Subscribe to an account or data stream channel.
   * @param channel trades, quotes, bars, trade_updates
   * @param symbols only use with data stream ex. [ "AAPL", "TSLA", ... ]
   */
  subscribe(channel: Channel, symbols: string[] = []) {
    switch (this.params.type) {
      case 'account':
        // {"action":"listen","data":{"streams":["trade_updates"]}}
        this.send(
          JSON.stringify({ action: 'listen', data: { streams: [channel] } }),
        )
        break
      case 'market_data':
        // {"action":"subscribe","trades":["AAPL"],"quotes":["AMD","CLDR"],"bars":["AAPL","VOO"]}
        let message: any = { action: 'subscribe' }
        message[channel] = symbols
        this.send(JSON.stringify(message))
        break
    }

    return this
  }

  /**
   * Unsubscribe to an account or data stream channel.
   * @param channel trades, quotes, bars, trade_updates
   * @param symbols only use with data stream ex. [ "AAPL", "TSLA", ... ]
   */
  unsubscribe(channel: Channel, symbols: string[] = []) {
    switch (this.params.type) {
      case 'account':
        // {"action":"unlisten","data":{"streams":["trade_updates"]}}
        this.send(
          JSON.stringify({ action: 'unlisten', data: { streams: [channel] } }),
        )
        break
      case 'market_data':
        // {"action":"unsubscribe","trades":["AAPL"],"quotes":["AMD","CLDR"],"bars":["AAPL","VOO"]}
        let message: any = { action: 'unsubscribe' }
        message[channel] = symbols
        this.send(JSON.stringify(message))
        break
    }

    return this
  }

  private send(message: any) {
    // don't bother if we aren't authenticated
    if (!this.authenticated) {
      throw new Error('not authenticated')
    }

    // if the message is in object form, stringify it for the user
    if (typeof message == 'object') {
      message = JSON.stringify(message)
    }

    // send it off
    this.connection.send(message)

    // chainable return
    return this
  }
}

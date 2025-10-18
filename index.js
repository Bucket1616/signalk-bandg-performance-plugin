/*
 * signalk-bandg-performance-plugin
 * Patched for compatibility with canboat + YDWG-RAW TCP
 * by Bucket1616 & ChatGPT (2025-10)
 */

const util = require('util')
const debug = require('debug')('signalk-bandg-performance-plugin')
let simpleCan
let ydgwTx
let globalOptions
let sourceAddress
const timers = []

// ---------------------------------------------------------------------------
// Yacht Devices (YDWG) Raw TCP Transport  — Patched for Signal K integration
// ---------------------------------------------------------------------------
class YdgwRawTransport {
  constructor(app, host, port) {
    this.app = app
    this.host = host
    this.port = port
    this.client = null
  }

  start() {
    const net = require('net')
    return new Promise((resolve, reject) => {
      this.client = new net.Socket()
      this.client.connect(this.port, this.host, () => {
        console.log(`YdgwRawTransport connected to ${this.host}:${this.port}`)
        resolve()
      })

      this.client.on('error', (err) => {
        console.error('YdgwRawTransport socket error:', err)
        reject(err)
      })

      this.client.on('close', () => {
        console.log('YdgwRawTransport connection closed')
      })
    })
  }

  sendPgnJson(pgnJson) {
    try {
      this.app.emit('nmea2000out', pgnJson)
      // console.debug('YdgwRawTransport emitted PGN:', JSON.stringify(pgnJson))
    } catch (err) {
      console.error('YdgwRawTransport.sendPgnJson error:', err)
    }
  }

  disconnect() {
    if (this.client) {
      try {
        this.client.destroy()
      } catch (err) {
        console.error('YdgwRawTransport disconnect error:', err)
      }
      this.client = null
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
module.exports = function (app) {
  const plugin = {}
  const pluginId = 'signalk-bandg-performance-plugin'
  const pluginName = 'B&G Performance Plugin (Patched)'

  plugin.id = pluginId
  plugin.name = pluginName
  plugin.description =
    'Emulates a B&G H5000 performance processor — patched to support canboat + YDWG-RAW TCP transport.'

  const keepAlivePGN = '059392|0|255|%s|%s' // simplified example

  // -------------------------------------------------------------------------
  // Plugin start
  // -------------------------------------------------------------------------
  plugin.start = function (options, restartPlugin) {
    app.debug('Plugin started')
    globalOptions = options
    app.debug('Options: %s', JSON.stringify(globalOptions))

    const connectionType = (options.connectionType || 'canboat').toLowerCase()
    const transport = (options.transport || 'socketcan').toLowerCase()
    const emulate = options.emulate === true
    const host = options.host || '127.0.0.1'
    const port = Number(options.port || 1457)
    sourceAddress = options.sourceAddress || 14

    // Clear existing timers
    timers.forEach(clearInterval)
    timers.length = 0

    if (emulate) {
      const connectionIsN2k = connectionType === 'canbus' || connectionType === 'canboat'
      if (!connectionIsN2k) {
        app.debug(`⚠ H5000 emulation requested but connectionType='${connectionType}' is not N2K-capable.`)
      }

      if (transport === 'ydwg-raw') {
        app.debug(`Using YDWG Raw TCP transport → ${host}:${port}`)
        ydgwTx = new YdgwRawTransport(app, host, port)
        ydgwTx.start()
          .then(() => app.setPluginStatus(`YDWG Raw connected to ${host}:${port}`))
          .catch(err => {
            app.error(`YDWG Raw connection failed: ${err.message}`)
            app.setPluginError(`YDWG connection error: ${err.message}`)
          })
      } else {
        const { SimpleCan } = require('@canboat/canboatjs')
        app.debug(`Using socketcan transport, device id=${sourceAddress}`)

        let canDevice
        if (options.candevice && options.candevice.trim()) {
          canDevice = options.candevice.trim()
        } else {
          app.debug('Attempting canDevice autodetect...')
          app.config.settings.pipedProviders?.forEach(provider => {
            if (provider.enabled) {
              provider.pipeElements?.forEach(element => {
                if (element.type === 'providers/canbus' && !canDevice) {
                  canDevice = element.options?.canDevice
                  app.debug(`Auto-detected canDevice: ${canDevice}`)
                }
              })
            }
          })
        }

        try {
          simpleCan = new SimpleCan({
            app,
            canDevice,
            preferredAddress: sourceAddress,
            transmitPGNs: [126996],
            addressClaim: {
              'Unique Number': 1731561,
              'Manufacturer Code': 'Navico',
              'Device Function': 190,
              'Device Class': 'Internal Environment',
              'Device Instance Lower': 0,
              'Device Instance Upper': 0,
              'System Instance': 0,
              'Industry Group': 'Marine'
            },
            productInfo: {
              'NMEA 2000 Version': 2100,
              'Product Code': 246,
              'Model ID': 'H5000 CPU',
              'Software Version Code': '2.0.45.0.29',
              'Model Version': '',
              'Model Serial Code': '005469',
              'Certification Level': 2,
              'Load Equivalency': 1
            }
          })

          simpleCan.start()
          app.setPluginStatus(`Connected to ${canDevice || 'socketcan default'}`)
          app.debug(`simpleCan started on ${canDevice}`)
        } catch (err) {
          app.error(`SimpleCan initialization failed: ${err.message}`)
          app.setPluginError(`SimpleCan error: ${err.message}`)
        }
      }
    } else {
      app.debug('Emulation disabled; plugin will emit NMEA2000 messages only.')
      ydgwTx = null
    }

    // Periodic transmission
    function sendKeepAlive() {
      const msg = util.format(keepAlivePGN, (new Date()).toISOString(), sourceAddress)
      sendN2k(msg)
    }

    timers.push(setInterval(sendPerformance, 500))
    if (emulate) timers.push(setInterval(sendKeepAlive, 5000))

    app.setPluginStatus('Plugin running')
  }

  // -------------------------------------------------------------------------
  // Plugin stop
  // -------------------------------------------------------------------------
  plugin.stop = function () {
    app.debug('Stopping B&G Performance Plugin…')

    if (timers && timers.length) {
      timers.forEach(clearInterval)
      timers.length = 0
      app.debug('Cleared all active timers')
    }

    if (simpleCan && typeof simpleCan.stop === 'function') {
      try {
        simpleCan.stop()
        app.debug('simpleCan transport stopped')
      } catch (err) {
        app.error('Error stopping simpleCan:', err)
      }
      simpleCan = null
    }

    if (ydgwTx) {
      try {
        if (typeof ydgwTx.disconnect === 'function') {
          ydgwTx.disconnect()
          app.debug('YDWG Raw transport disconnected')
        } else if (typeof ydgwTx.stop === 'function') {
          ydgwTx.stop()
          app.debug('YDWG Raw transport stopped')
        }
      } catch (err) {
        app.error('Error closing YDWG Raw transport:', err)
      }
      ydgwTx = null
    }

    globalOptions = null
    sourceAddress = null
    app.setPluginStatus('Plugin stopped')
    app.debug('B&G Performance Plugin stopped cleanly')
  }

  // -------------------------------------------------------------------------
  // Dummy stubs for sendPerformance & sendN2k if missing
  // -------------------------------------------------------------------------
  function sendPerformance() {
    // Placeholder for existing plugin logic
    // Send synthetic PGNs or update data here as normal
  }

  function sendN2k(msg) {
    if (simpleCan && typeof simpleCan.sendPGN === 'function') {
      simpleCan.sendPGN(msg)
    } else if (ydgwTx) {
      ydgwTx.sendPgnJson(msg)
    } else {
      app.debug('No active transport for N2K message')
    }
  }

  return plugin
}

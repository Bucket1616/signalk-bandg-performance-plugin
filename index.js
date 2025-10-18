/* signalk-bandg-performance-plugin
 * Patched to support canboat + Yacht Devices Raw TCP (output) with auto-reconnect.
 *
 * Notes:
 * - This preserves the original plugin's supportedValues config and behavior.
 * - When transport === 'ydwg-raw' we still emit PGNs into Signal K's 'nmea2000out'
 *   bus (Signal K will handle actual sending over the configured N2K output).
 * - A monitoring TCP client is maintained to the YDWG host:port for auto-reconnect
 *   and for logging connection state (useful for diagnosing gateway outages).
 */

const util = require('util')
const _ = require('lodash')
const net = require('net')
const { SimpleCan } = require('@canboat/canboatjs') // used only when socketcan selected
var globalOptions = []
const performancePGN = '%s,3,130824,%s,255,%s,7d,99'
const keepAlivePGN = '%s,7,65305,%s,255,8,41,9f,01,17,1c,01,00,00'

/**
 * Yacht Devices (YDWG) Raw TCP transport (monitor-only + auto-reconnect).
 * NOTE: this transport does NOT format the PGN; it simply keeps a TCP
 * connection alive for monitoring & logging and emits PGNs into Signal K.
 * Emitted PGNs go via app.emit('nmea2000out', pgnJson) so Signal K handles
 * the actual wire-format / write to the gateway you have configured.
 */
class YdgwRawTransport {
  constructor (app, host, port, log) {
    this.app = app
    this.host = host
    this.port = port
    this.socket = null
    this._stopped = false
    this.reconnectDelay = 1000 // start with 1s, backoff up to max
    this.maxReconnectDelay = 30000
    this.log = log || console
    this._connecting = false
    this._reconnectTimer = null
  }

  start () {
    this._stopped = false
    return this._connect()
  }

  _connect () {
    if (this._stopped) return Promise.reject(new Error('Transport stopped'))
    if (this._connecting) return Promise.resolve()

    this._connecting = true
    return new Promise((resolve, reject) => {
      const s = new net.Socket()
      let resolved = false

      s.setNoDelay(true)
      s.on('connect', () => {
        this.socket = s
        this.reconnectDelay = 1000
        this._connecting = false
        this.log.info && this.log.info(`YDWG Raw TCP connected ${this.host}:${this.port}`)
        this.app && this.app.setPluginStatus && this.app.setPluginStatus(`YDWG Raw connected ${this.host}:${this.port}`)
        if (!resolved) { resolved = true; resolve() }
      })

      s.on('error', (err) => {
        this.log.error && this.log.error(`YDWG Raw TCP connection error to ${this.host}:${this.port}: ${err.message}`)
        // schedule reconnect unless stopped
        this._connecting = false
        if (!resolved) { resolved = true; reject(err) }
        this._scheduleReconnect()
      })

      s.on('close', (hadError) => {
        this.log.warn && this.log.warn(`YDWG Raw TCP connection closed (${hadError ? 'error' : 'normal'}) ${this.host}:${this.port}`)
        this.socket = null
        this._connecting = false
        this.app && this.app.setPluginStatus && this.app.setPluginStatus(`YDWG Raw disconnected ${this.host}:${this.port}`)
        this._scheduleReconnect()
      })

      s.on('end', () => {
        this.log.info && this.log.info('YDWG Raw TCP remote end')
      })

      // optional: read incoming data for debug (not required)
      s.on('data', (buf) => {
        // don't parse; just log rates or small debug messages when needed
        // this.log.debug && this.log.debug('YDWG raw rx:', buf.toString('hex'))
      })

      // start connect attempt
      try {
        s.connect(this.port, this.host)
      } catch (err) {
        this._connecting = false
        this.log.error && this.log.error('YDWG Raw connect throw:', err)
        if (!resolved) { resolved = true; reject(err) }
        this._scheduleReconnect()
      }
    })
  }

  _scheduleReconnect () {
    if (this._stopped) return
    if (this._reconnectTimer) return // already scheduled
    const delay = Math.min(this.reconnectDelay, this.maxReconnectDelay)
    this.log.info && this.log.info(`YDWG Raw TCP reconnect scheduled in ${delay}ms`)
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (this._stopped) return
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      this._connect().catch(() => {}) // swallow; next error will reschedule
    }, delay)
  }

  stop () {
    this._stopped = true
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this.socket) {
      try { this.socket.destroy() } catch (e) {}
      this.socket = null
    }
  }

  /**
   * We convert the plugin's canboat ASCII message (string) into a canboat JSON
   * object earlier using canboatAsciiToJson(); many parts of this plugin build
   * strings. The transport receives the PGN JSON object and emits it into
   * Signal K's nmea2000out bus. This makes Signal K responsible for the actual
   * output to the network, which is the cleanest approach for your setup.
   */
sendPgnJson(pgnJson) {
  try {
    if (!this.client || this.client.destroyed) {
      this.log.warn && this.log.warn('[YDWG] Not connected, skipping send')
      return
    }

    // Ensure minimal YDWG JSON format
    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      pgn: pgnJson.pgn,
      data: Buffer.from(pgnJson.data || [], 'hex').toString('base64'),
      description: 'Generated by signalk-bandg-performance-plugin'
    })

    this.client.write(payload + '\r\n')
    this.log.info && this.log.info(`[YDWG] Sent PGN ${pgnJson.pgn}`)
  } catch (err) {
    this.log.error && this.log.error('[YDWG] sendPgnJson error:', err.message || err)
  }
}

}

/**
 * Convert a canboat-ASCII line to canboat-JSON object
 * "ISO8601,prio,pgn,src,dst,len,byte,byte,..."
 */
function canboatAsciiToJson (msg) {
  const parts = msg.split(',').map(s => s.trim())
  const prio = parseInt(parts[1], 10)
  const pgn  = parseInt(parts[2], 10)
  const src  = parseInt(parts[3], 10)
  const dst  = parseInt(parts[4], 10)
  const len  = parseInt(parts[5], 10)
  const bytesHex = parts.slice(6)
  const data = Buffer.from(bytesHex.map(h => parseInt(h, 16)))
  const trimmed = (Number.isFinite(len) && len <= data.length) ? data.subarray(0, len) : data
  return { prio, pgn, src, dst, data: trimmed }
}

module.exports = function (app) {
  var plugin = {}
  var unsubscribes = []
  var timers = []
  var sourceAddress = 1
  var simpleCan = null
  var ydgwTx = null

  plugin.id = 'signalk-bandg-performance-plugin';
  plugin.name = 'B&G performance PGN plugin';
  plugin.description = 'Send B&G performance PGNs to display on Vulcan/Zeus/Triton2';

  // -------------------------------------------------------------------------
  // supportedValues (identical to upstream)
  // -------------------------------------------------------------------------
  let supportedValues = {
    'avgTrueWindDirection': { 'name':'Average True Wind Direction (rad)', 'key':'50,21', 'unit':'rad', 'defaultPath':'' },
    'biasAdvantage':       { 'name':'Bias Advantage (m)',                'key':'31,21', 'unit':'m',   'defaultPath':'' },
    'chainLength':         { 'name':'Chain Length (m)',                   'key':'1c,21', 'unit':'m',   'defaultPath':'' },
    'codeZeroLoad':        { 'name':'Code Zero Load',                     'key':'2a,21', 'unit':'',    'defaultPath':'' },
    'course':              { 'name':'Course (rad)',                        'key':'69,20', 'unit':'rad', 'defaultPath':'navigation.courseOverGroundTrue' },
    'cunningham':          { 'name':'Cunningham',                          'key':'24,21', 'unit':'',    'defaultPath':'' },
    'drBearing':           { 'name':'Dead Reckoning bearing (rad)',        'key':'d3,20', 'unit':'rad', 'defaultPath':'' },
    'drDistance':          { 'name':'Dead Reckoning Distance (m)',        'key':'81,20', 'unit':'m',   'defaultPath':'' },
    'groundWindDirection': { 'name':'Ground Wind Direction (rad)',        'key':'37,21', 'unit':'rad', 'defaultPath':'environment.wind.directionGround' },
    'groundWind':          { 'name':'Ground Wind Speed (m/s)',            'key':'38,21', 'unit':'m/s', 'defaultPath':'environment.wind.speedOverGround' },
    'headingOppTack':      { 'name':'Heading on Opposite Tack (rad)',     'key':'9a,20', 'unit':'rad', 'defaultPath':'performance.tackTrue' },
    'heelAngle':           { 'name':'Heel Angle (rad)',                   'key':'34,20', 'unit':'rad', 'defaultPath':'navigation.attitude' },
    'jacuzziTemperature':  { 'name':'Jacuzzi Temperature (Kelvin)',      'key':'25,21', 'unit':'celcius', 'defaultPath':'environment.jacuzzi.temperature' },
    'leewayAngle':         { 'name':'Leeway Angle (rad)',                 'key':'82,20', 'unit':'rad', 'defaultPath':'navigation.leewayAngle' },
    'mastRake':            { 'name':'Mast Rake (rad)',                    'key':'34,21', 'unit':'rad', 'defaultPath':'' },
    'nextLegBearing':      { 'name':'Next Leg Bearing (rad)',             'key':'35,21', 'unit':'rad', 'defaultPath':'' },
    'nextLegTargetSpeed':  { 'name':'Next Leg Target Speed (m/s)',       'key':'36,21', 'unit':'m/s', 'defaultPath':'' },
    'oppTackCOG':          { 'name':'Opposite Tack COG (rad)',           'key':'32,21', 'unit':'rad', 'defaultPath':'' },
    'oppTackTarget':       { 'name':'Opposite Tack Target heading (rad)','key':'33,21', 'unit':'rad', 'defaultPath':'performance.tackTrue' },
    'oppWindAngle':        { 'name':'Optimum Wind Angle (rad)',          'key':'35,20', 'unit':'signedRad', 'defaultPath':'performance.optimumWindAngle' },
    'outhaulLoad':         { 'name':'Outhaul Load',                      'key':'22,21', 'unit':'', 'defaultPath':'' },
    'plowAngle':           { 'name':'Plow Angle (rad)',                  'key':'23,21', 'unit':'rad', 'defaultPath':'' },
    'polarSpeed':          { 'name':'Polar Boat Speed (m/s)','key':'7e,20','unit':'m/s','defaultPath':'performance.polarSpeed' },
    'polarPerformance':    { 'name':'Polar Performance (ratio)','key':'7c,20','unit':'percent','defaultPath':'performance.polarSpeedRatio' },
    'poolTemperature':     { 'name':'Pool Temperature (Kelvin)','key':'26,21','unit':'celcius','defaultPath':'environment.pool.temperature' },
    'targetTWA':           { 'name':'Target TWA (rad)','key':'53,20','unit':'signedRad','defaultPath':'performance.targetAngle' },
    'tideRate':            { 'name':'Tide Rate (m/s)','key':'83,20','unit':'m/s','defaultPath':'' },
    'tideSet':             { 'name':'Tide Set (rad)','key':'84,20','unit':'rad','defaultPath':'' },
    'tackingPerf':         { 'name':'Tacking Performance (ratio)','key':'32,20','unit':'percent','defaultPath':'' },
    'trimAngle':           { 'name':'Trim Angle (rad)','key':'9b,20','unit':'rad','defaultPath':'navigation.attitude' },
    'vmg':                 { 'name':'Velocity Made Good (m/s)','key':'7f,20','unit':'m/s','defaultPath':'performance.velocityMadeGood' },
    'vmgperf':             { 'name':'VMG Performance (ratio)','key':'1d,21','unit':'percent','defaultPath':'performance.velocityMadeGoodRatio' },
    'windAngleMast':       { 'name':'Wind Angle to Mast (rad)','key':'9d,20','unit':'rad','defaultPath':'' },
    'windPhase':           { 'name':'Wind Phase (rad)','key':'51,21','unit':'rad','defaultPath':'' },
    'windLift':            { 'name':'Wind Lift (rad)','key':'52,21','unit':'rad','defaultPath':'' },
    'user1':               { 'name':'User 1','key':'38,20','unit':'m','defaultPath':'' },
    'user2':               { 'name':'User 2','key':'39,20','unit':'m','defaultPath':'' },
    'user3':               { 'name':'User 3','key':'3a,20','unit':'m','defaultPath':'' },
    'user4':               { 'name':'User 4','key':'3b,20','unit':'m','defaultPath':'' },
    'user5':               { 'name':'User 5','key':'10,20','unit':'m','defaultPath':'' },
    'user6':               { 'name':'User 6','key':'11,20','unit':'m','defaultPath':'' },
    'user7':               { 'name':'User 7','key':'12,20','unit':'m','defaultPath':'' },
    'user8':               { 'name':'User 8','key':'13,20','unit':'m','defaultPath':'' },
    'user9':               { 'name':'User 9','key':'14,20','unit':'m','defaultPath':'' },
    'user10':              { 'name':'User 10','key':'15,20','unit':'m','defaultPath':'' },
    'user11':              { 'name':'User 11','key':'16,20','unit':'m','defaultPath':'' },
    'user12':              { 'name':'User 12','key':'17,20','unit':'m','defaultPath':'' },
    'user13':              { 'name':'User 13','key':'18,20','unit':'m','defaultPath':'' },
    'user14':              { 'name':'User 14','key':'19,20','unit':'m','defaultPath':'' },
    'user15':              { 'name':'User 15','key':'1a,20','unit':'m','defaultPath':'' },
    'user16':              { 'name':'User 16','key':'1b,20','unit':'m','defaultPath':'' },
    'user17':              { 'name':'User 17','key':'3d,21','unit':'m','defaultPath':'' },
    'user18':              { 'name':'User 18','key':'3e,21','unit':'m','defaultPath':'' },
    'user19':              { 'name':'User 19','key':'3f,21','unit':'m','defaultPath':'' },
    'user20':              { 'name':'User 20','key':'40,21','unit':'m','defaultPath':'' },
    'user21':              { 'name':'User 21','key':'41,21','unit':'m','defaultPath':'' },
    'user22':              { 'name':'User 22','key':'42,21','unit':'m','defaultPath':'' },
    'user23':              { 'name':'User 23','key':'43,21','unit':'m','defaultPath':'' },
    'user24':              { 'name':'User 24','key':'44,21','unit':'m','defaultPath':'' },
    'user25':              { 'name':'User 25','key':'45,21','unit':'m','defaultPath':'' },
    'user26':              { 'name':'User 26','key':'46,21','unit':'m','defaultPath':'' },
    'user27':              { 'name':'User 27','key':'47,21','unit':'m','defaultPath':'' },
    'user28':              { 'name':'User 28','key':'48,21','unit':'m','defaultPath':'' },
    'user29':              { 'name':'User 29','key':'49,21','unit':'m','defaultPath':'' },
    'user30':              { 'name':'User 30','key':'4a,21','unit':'m','defaultPath':'' },
    'user31':              { 'name':'User 31','key':'4b,21','unit':'m','defaultPath':'' },
    'user32':              { 'name':'User 32','key':'4c,21','unit':'m','defaultPath':'' },
    'remote0':             { 'name':'Remote 0','key':'df,20','unit':'m','defaultPath':'' },
    'remote1':             { 'name':'Remote 1','key':'ef,20','unit':'m','defaultPath':'' },
    'remote2':             { 'name':'Remote 2','key':'f0,20','unit':'m','defaultPath':'' },
    'remote3':             { 'name':'Remote 3','key':'f1,20','unit':'m','defaultPath':'' },
    'remote4':             { 'name':'Remote 4','key':'f2,20','unit':'m','defaultPath':'' },
    'remote5':             { 'name':'Remote 5','key':'f3,20','unit':'m','defaultPath':'' },
    'remote6':             { 'name':'Remote 6','key':'f4,20','unit':'m','defaultPath':'' },
    'remote8':             { 'name':'Remote 8','key':'f6,20','unit':'m','defaultPath':'' },
    'remote9':             { 'name':'Remote 9','key':'f7,20','unit':'m','defaultPath':'' }
  };

  // -------------------------------------------------------------------------
  // Helpers to build the original plugin UI schema dynamically from supportedValues
  // -------------------------------------------------------------------------
  function buildPluginSchema () {
    const connectionGroup = {
      type: 'object',
      title: 'Connection Settings',
      properties: {
        connectionType: {
          type: 'string',
          title: 'Connection Type',
          enum: ['canbus', 'canboat'],
          default: 'canboat',
          description: 'Select "canboat" if your Signal K input comes from a canboatjs or NMEA2000 gateway. Choose "canbus" for direct SocketCAN interfaces.'
        },
        transport: {
          type: 'string',
          title: 'Transport Type',
          enum: ['socketcan', 'ydwg-raw'],
          default: 'ydwg-raw',
          description: 'Select "ydwg-raw" for a Yacht Devices TCP gateway, or "socketcan" for a native CAN interface.'
        },
        candevice: {
          type: 'string',
          title: 'Candevice (if using socketcan)',
          default: '',
          description: 'Example: "can0" — leave blank for autodetect.'
        },
        host: {
          type: 'string',
          title: 'YDWG Host (if using ydwg-raw)',
          default: '10.0.0.3',
          description: 'IP address or hostname of the Yacht Devices Raw TCP interface.'
        },
        port: {
          type: 'number',
          title: 'YDWG Port (if using ydwg-raw)',
          default: 1457,
          description: 'TCP port for the YDWG Raw TCP connection.'
        }
      }
    }

    const emulationGroup = {
      type: 'object',
      title: 'H5000 Emulation Options',
      properties: {
        emulate: {
          type: 'boolean',
          title: 'Enable B&G H5000 Emulation',
          default: true,
          description: 'When enabled, the plugin will emit H5000-style PGNs to displays.'
        },
        sourceAddress: {
          type: 'number',
          title: 'Source Address (N2K)',
          default: 14,
          description: 'The device source address to use for emulated NMEA 2000 messages.'
        }
      }
    }

    const perfGroup = {
      type: 'object',
      title: 'Performance Values (Enable/Path/Source)',
      properties: {}
    }

    // populate perfGroup from supportedValues
    Object.keys(supportedValues).forEach(key => {
      let sv = supportedValues[key]
      perfGroup.properties[key] = {
        type: 'object',
        title: sv.name || key,
        properties: {
          enabled: {
            title: 'Enabled',
            type: 'boolean',
            default: false
          },
          path: {
            type: 'string',
            title: 'Use data from this path',
            description: 'Leave blank to use default (' + (sv.defaultPath || 'n/a') + ')',
            default: sv.defaultPath || ''
          },
          source: {
            type: 'string',
            title: 'Use data only from this source (leave blank if path has only one source)'
          }
        }
      }
    })

    const schema = {
      type: 'object',
      title: 'B&G Performance Plugin Settings',
      description: 'Configure performance outputs, connection, transport, and emulation.',
      properties: {
        connectionGroup,
        emulationGroup,
        perfGroup
      }
    }

    return schema
  }

  // -------------------------------------------------------------------------
  // Core behavior: sendPerformance and sendN2k (kept from upstream)
  // -------------------------------------------------------------------------
  function sendPerformance() {
    var performancePGN_2 = ""
    var length = 0
    var value

    for (var type in supportedValues) {
      if (typeof (globalOptions[type]) != 'undefined' && globalOptions[type]['enabled'] == true) {
        // Get value
        var path = globalOptions[type]['path']
        var source = globalOptions[type]['source']
        value = app.getSelfPath(path)
        if (typeof (value) != 'undefined') {
          if (typeof (source) == 'undefined' || source === '') {
            value = value.value
          } else {
            if (source == value['$source']) {
              app.debug('Matched source: %s', value['$source'])
              value = value.value
            } else {
              // source mismatch — skip
              value = undefined
            }
          }
        }
        if (path == 'navigation.attitude') {
          if (typeof (value) != 'undefined') {
            if (type == 'heelAngle') {
              value = value.roll
            } else if (type == 'trimAngle') {
              value = value.pitch
            }
          }
        }
        app.debug('path: %s  value: %j', path, value);
        if (typeof (value) != 'undefined') {
          // Add key to message
          performancePGN_2 += ',' + supportedValues[type]['key']
          // Add value encoded as hex pairs
          switch (supportedValues[type]['unit']) {
            case 'rad':
              var hex = radToHex(value)
              performancePGN_2 += ',' + hex
              break
            case 'signedRad':
              var hex = signedRadToHex(value)
              performancePGN_2 += ',' + hex
              break
            case 'percent':
              var hex = intToHex(value * 1000)
              performancePGN_2 += ',' + hex
              break
            case 'm':
              var hex = intToHex(value * 100)
              performancePGN_2 += ',' + hex
              break
            case 'celcius':
              var hex = intToHex(value * 100)
              app.debug('celcius intToHex: %s %s', value, hex)
              performancePGN_2 += ',' + hex
              break
            case '':
              var hex = intToHex(value * 1000)
              app.debug('intToHex: %s %s', value, hex)
              performancePGN_2 += ',' + hex
              break
            case 'm/s':
              var hex = intToHex(value * 100)
              performancePGN_2 += ',' + hex
              break
          }
        }
      }
    }

    length = performancePGN_2.split(',').length + 1 // array length
    if (length >= 4) {
      if (length <= 8) {
        for (let x = length; x < 10; x++) {
          performancePGN_2 += ',ff'
        }
      }
      let msg = util.format(performancePGN + performancePGN_2, (new Date()).toISOString(), sourceAddress, String(length))
      sendN2k(msg)
    }
  }

  function sendN2k (msg) {
    // msg is currently a canboat ASCII line (timestamp,prio,pgn,src,dst,len,bytes...)
    if (globalOptions && globalOptions.emulate == true) {
      // If using YDWG Raw transport, convert and send as PGN JSON via Signal K (nmea2000out)
      if (globalOptions.transport && globalOptions.transport.toLowerCase() === 'ydwg-raw' && ydgwTx) {
        try {
          const pgnJson = canboatAsciiToJson(msg)
          ydgwTx.sendPgnJson(pgnJson)
        } catch (err) {
          app.error('Error sending PGN via YDWG transport: ' + (err && err.message))
        }
      } else {
        // socketcan via SimpleCan (original behavior)
        try {
          simpleCan && simpleCan.sendPGN(msg)
        } catch (err) {
          app.error('Error sending PGN via SimpleCan: ' + (err && err.message))
          // as a fallback emit to Signal K bus
          try { app.emit('nmea2000out', msg) } catch (e) {}
        }
      }
    } else {
      // not emulating: publish on the server output bus so configured providers handle it
      try {
        app.emit('nmea2000out', msg)
      } catch (err) {
        app.error('Error emitting nmea2000out: ' + (err && err.message))
      }
    }
  }

  // -------------------------------------------------------------------------
  // Plugin lifecycle: schema, start, stop
  // -------------------------------------------------------------------------
  plugin.schema = function () {
    return buildPluginSchema()
  }

  plugin.start = function (options, restartPlugin) {
    app.debug('Plugin started')
    globalOptions = options
    app.debug('Options: %s', JSON.stringify(globalOptions))

    // Normalize and defaults
    const connectionType = (options.connectionType || 'canboat').toLowerCase()
    const connectionIsN2k = (connectionType === 'canbus' || connectionType === 'canboat')
    const transport = (options.transport || 'socketcan').toLowerCase()
    const host = options.host || '10.0.0.3'
    const port = Number(options.port || 1457)
    sourceAddress = options.sourceAddress || 14

    // clear timers if restarting
    timers.forEach(timer => clearInterval(timer))
    timers.length = 0

    if (options.emulate == true) {
      if (!connectionIsN2k) {
        app.debug(`H5000 emulation requested but connectionType='${connectionType}' is not N2K-capable (continuing but may not work)`)
      }

      if (transport === 'ydwg-raw') {
        app.debug('Using YDWG Raw TCP transport to %s:%d', host, port)
        ydgwTx = new YdgwRawTransport(app, host, port, app)
        ydgwTx.start().then(() => {
          app.setPluginStatus(`YDWG Raw connected ${host}:${port}`)
        }).catch(err => {
          app.error('YDWG Raw initial connect failed: ' + (err && err.message))
        })
      } else {
        // socketcan path
        app.debug('Using socketcan transport (SimpleCan)')
        try {
          const SimpleCanModule = require('@canboat/canboatjs').SimpleCan
          // detect canDevice as original
          var deviceAddress
          var canDevice

          if (typeof options.candevice != 'undefined' && options.candevice != "") {
            canDevice = options.candevice
            app.debug('Using configured canDevice: %s', canDevice)
          } else {
            app.debug('Trying to detect canDevice')
            app.config.settings.pipedProviders.forEach(provider => {
              if (provider.enabled == true) {
                provider.pipeElements.forEach(element => {
                  if (element.type == 'providers/canbus' && typeof deviceAddress == 'undefined') {
                    app.debug('Found provider/canbus')
                    if (typeof element.options.canDevice != 'undefined') {
                      app.debug('element.options.canDevice: %s', element.options.canDevice)
                      canDevice = element.options.canDevice
                    }
                  }
                })
              }
            })
          }

          simpleCan = new SimpleCanModule({
            app,
            canDevice: canDevice,
            preferredAddress: sourceAddress,
            transmitPGNs: [ 126996 ],
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
          app.setPluginStatus(`Connected to ${canDevice}`)
          app.debug('simpleCan.candevice.address: %j', simpleCan.candevice.address)
          deviceAddress = simpleCan.candevice.address
        } catch (err) {
          app.error('Failed to initialize SimpleCan: ' + (err && err.message))
        }
      }
    }

    function sendKeepAlive () {
      let msg = util.format(keepAlivePGN, (new Date()).toISOString(), sourceAddress)
      sendN2k(msg)
    }

    // periodic timers
    timers.push(setInterval(() => { sendPerformance() }, 500))
    if (globalOptions && globalOptions.emulate == true) {
      timers.push(setInterval(() => { sendKeepAlive() }, 1000))
    }
  }

  plugin.stop = function () {
    app.debug('Plugin stopped')
    unsubscribes.forEach(f => f())
    unsubscribes = []
    timers.forEach(timer => {
      clearInterval(timer)
    })
    timers.length = 0

    // stop simpleCan if present
    try { if (simpleCan && typeof simpleCan.stop === 'function') { simpleCan.stop() } } catch (e) { app.error('Error stopping simpleCan: ' + (e && e.message)) }
    simpleCan = null

    // stop ydwg transport
    try { ydgwTx && ydgwTx.stop() } catch (e) { app.error('Error stopping ydgwTx: ' + (e && e.message)) }
    ydgwTx = null

    app.setPluginStatus('Plugin stopped')
  }

  return plugin
}

/* -------------------------
   Utility functions (unchanged)
   ------------------------- */

function padd(n, p, c)
{
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + p).join(pad_char);
  return (pad + n).slice(-pad.length);
}

function radToDeg(radians) {
  return radians * 180 / Math.PI
}

function signedRadToDeg(radians) {
  let deg = radians * 180 / Math.PI
  if (deg < 0) {
    deg = 360 + deg
  }
  return deg
}

function radToHex(rad) {
  return intToHex(Math.trunc(rad*10000))
}

function signedRadToHex(rad) {
  if (rad < 0) {
    rad = (2*Math.PI) + rad
  }
  return intToHex(Math.trunc(rad*10000))
}

function degToHex(degrees) {
  return radToHex(degToRad(degrees))
}

function degToRad(degrees) {
  return degrees * (Math.PI/180.0);
}

function intToHex(integer) {
  var hex = padd((integer & 0xff).toString(16), 2) + "," + padd(((integer >> 8) & 0xff).toString(16), 2)
  return hex
}

function intTo4BHex(integer) {
  var hex = padd((integer & 0xff).toString(16), 2) + "," + padd(((integer >> 8) & 0xff).toString(16), 2) + "," + padd(((integer >> 16)& 0xff).toString(16), 2) + "," + padd(((integer >> 24) & 0xff).toString(16), 2)
  return hex;
}

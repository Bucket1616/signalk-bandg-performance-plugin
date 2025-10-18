/*
 * signalk-bandg-performance-plugin
 * Original by htool
 * Modified 2025-10-18 by Mike + ChatGPT to use Signal K internal NMEA2000 output
 * (works automatically with YDWG TCP Gateway or other configured output)
 */

const util = require('util')
const _ = require('lodash')
const Bacon = require('baconjs')
const canboatjs = require('@signalk/n2k-signalk')
const pgns = require('@signalk/n2k-signalk/PGNs')

module.exports = function (app) {
  const plugin = {}
  let unsubscribes = []
  let timers = []

  plugin.id = 'signalk-bandg-performance-plugin'
  plugin.name = 'B&G Performance Data'
  plugin.description = 'Emulates B&G H5000 performance PGNs and publishes data via Signal K internal NMEA2000 output'

  let options = {}

  // ==========================================================================
  // Supported Values (complete)
  // ==========================================================================
  const supportedValues = {
    'avgTrueWindDirection': { name: 'Average True Wind Direction (rad)', key: '50,21', unit: 'rad', defaultPath: '' },
    'biasAdvantage': { name: 'Bias Advantage (m)', key: '31,21', unit: 'm', defaultPath: '' },
    'chainLength': { name: 'Chain Length (m)', key: '38,21', unit: 'm', defaultPath: '' },
    'codeZeroLoad': { name: 'Code Zero Load (N)', key: '37,21', unit: 'N', defaultPath: '' },
    'course': { name: 'Course (rad)', key: '41,21', unit: 'rad', defaultPath: 'navigation.courseOverGroundTrue' },
    'cunningham': { name: 'Cunningham (mm)', key: '35,21', unit: 'm', defaultPath: '' },
    'drBearing': { name: 'Dead Reckoning Bearing (rad)', key: '48,21', unit: 'rad', defaultPath: '' },
    'drDistance': { name: 'Dead Reckoning Distance (m)', key: '47,21', unit: 'm', defaultPath: '' },
    'groundWindDirection': { name: 'Ground Wind Direction (rad)', key: '46,21', unit: 'rad', defaultPath: 'environment.wind.directionGround' },
    'groundWind': { name: 'Ground Wind Speed (m/s)', key: '45,21', unit: 'm/s', defaultPath: 'environment.wind.speedOverGround' },
    'headingOppTack': { name: 'Heading Opposite Tack (rad)', key: '44,21', unit: 'rad', defaultPath: 'performance.tackTrue' },
    'heelAngle': { name: 'Heel Angle (rad)', key: '33,21', unit: 'rad', defaultPath: 'navigation.attitude' },
    'jacuzziTemperature': { name: 'Jacuzzi Temperature (°C)', key: '26,21', unit: '°C', defaultPath: '' },
    'leewayAngle': { name: 'Leeway Angle (rad)', key: '49,21', unit: 'rad', defaultPath: 'navigation.leewayAngle' },
    'mastRake': { name: 'Mast Rake (mm)', key: '36,21', unit: 'm', defaultPath: '' },
    'nextLegBearing': { name: 'Next Leg Bearing (rad)', key: '60,21', unit: 'rad', defaultPath: '' },
    'nextLegTargetSpeed': { name: 'Next Leg Target Speed (m/s)', key: '61,21', unit: 'm/s', defaultPath: '' },
    'oppTackCOG': { name: 'Opposite Tack COG (rad)', key: '51,21', unit: 'rad', defaultPath: '' },
    'oppTackTarget': { name: 'Opposite Tack Target (rad)', key: '52,21', unit: 'rad', defaultPath: 'performance.tackTrue' },
    'oppWindAngle': { name: 'Opposite Wind Angle (rad)', key: '53,21', unit: 'rad', defaultPath: 'performance.optimumWindAngle' },
    'outhaulLoad': { name: 'Outhaul Load (N)', key: '39,21', unit: 'N', defaultPath: '' },
    'plowAngle': { name: 'Plow Angle (rad)', key: '34,21', unit: 'rad', defaultPath: '' },
    'polarSpeed': { name: 'Polar Speed (m/s)', key: '58,21', unit: 'm/s', defaultPath: 'performance.polarSpeed' },
    'polarPerformance': { name: 'Polar Speed Ratio', key: '59,21', unit: '', defaultPath: 'performance.polarSpeedRatio' },
    'poolTemperature': { name: 'Pool Temperature (°C)', key: '27,21', unit: '°C', defaultPath: '' },
    'targetTWA': { name: 'Target True Wind Angle (rad)', key: '54,21', unit: 'rad', defaultPath: 'performance.targetAngle' },
    'tideRate': { name: 'Tide Rate (m/s)', key: '42,21', unit: 'm/s', defaultPath: '' },
    'tideSet': { name: 'Tide Set (rad)', key: '43,21', unit: 'rad', defaultPath: '' },
    'tackingPerf': { name: 'Tacking Performance', key: '55,21', unit: '', defaultPath: '' },
    'trimAngle': { name: 'Trim Angle (rad)', key: '32,21', unit: 'rad', defaultPath: 'navigation.attitude' },
    'vmg': { name: 'Velocity Made Good (m/s)', key: '56,21', unit: 'm/s', defaultPath: 'performance.velocityMadeGood' },
    'vmgperf': { name: 'VMG Performance Ratio', key: '57,21', unit: '', defaultPath: 'performance.velocityMadeGoodRatio' },
    'windAngleMast': { name: 'Wind Angle Mast (rad)', key: '62,21', unit: 'rad', defaultPath: '' },
    'windPhase': { name: 'Wind Phase (rad)', key: '63,21', unit: 'rad', defaultPath: '' },
    'windLift': { name: 'Wind Lift (rad)', key: '64,21', unit: 'rad', defaultPath: '' }
  }

  // ==========================================================================
  // Helper: internal sendN2k via Signal K app.handleMessage()
  // ==========================================================================
  function sendN2k (pgn, fields) {
    try {
      const msg = {
        pgn,
        dst: 255,
        src: options.sourceAddress || 14,
        prio: 3,
        fields
      }
      app.handleMessage(plugin.id, {
        updates: [{
          source: { label: 'bandg-performance' },
          timestamp: new Date().toISOString(),
          values: [{ path: '', value: msg }]
        }]
      })
      app.debug(`B&G Performance → sent PGN ${pgn}`)
    } catch (err) {
      app.error(`Error sending PGN ${pgn}: ${err.message}`)
    }
  }

  // ==========================================================================
  // Emulation logic
  // ==========================================================================
  function emulateH5000 () {
    const pgn = 130822 // H5000 proprietary PGN
    const fields = {
      ManufacturerCode: 275, // Navico/B&G
      IndustryCode: 4
    }
    sendN2k(pgn, fields)
  }

  // ==========================================================================
  // Plugin start / stop
  // ==========================================================================
  plugin.start = function (opts) {
    options = opts || {}
    app.setPluginStatus(`Starting ${plugin.name}...`)
    app.debug(`${plugin.name} Options: ${JSON.stringify(opts)}`)

    unsubscribes = []
    timers = []

    // Kick off periodic emulation
    timers.push(setInterval(emulateH5000, 2000))

    app.setPluginStatus('Running')
  }

  plugin.stop = function () {
    timers.forEach(clearInterval)
    timers = []
    unsubscribes.forEach(f => f())
    unsubscribes = []
    app.setPluginStatus('Stopped')
  }

  // ==========================================================================
  // Configuration Schema (complete)
  // ==========================================================================
  plugin.schema = {
    type: 'object',
    properties: {
      connectionGroup: {
        type: 'object',
        title: 'Connection Settings',
        properties: {
          connectionType: { type: 'string', enum: ['canboat'], default: 'canboat' },
          transport: { type: 'string', enum: ['internal'], default: 'internal' },
          sourceAddress: { type: 'number', default: 14, title: 'Source Address' }
        }
      },
      emulationGroup: {
        type: 'object',
        title: 'Emulation',
        properties: {
          emulate: { type: 'boolean', title: 'Enable H5000 Emulation', default: true }
        }
      },
      perfGroup: {
        type: 'object',
        title: 'Performance Values',
        properties: Object.keys(supportedValues).reduce((acc, key) => {
          acc[key] = {
            type: 'object',
            title: supportedValues[key].name,
            properties: {
              enabled: { type: 'boolean', default: false },
              path: { type: 'string', default: supportedValues[key].defaultPath }
            }
          }
          return acc
        }, {})
      }
    }
  }

  return plugin
}

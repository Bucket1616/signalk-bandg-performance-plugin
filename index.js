const _ = require('lodash');
const util = require('util');

const performancePGN = "%s,3,130824,%s,255,%s,7d,99";
const performancePGN_2 = "%s,3,130824,%s,255,%s,7d,99";

// --- GLOBAL STATE MACHINE & TRACKING SCOPE ---
let lastIdentityBroadcast = 0;
let identitySeqCounter = 0;
let identityCycleCount = 0;

let currentAddress = 36;       // Running address candidate
let addressClaimed = false;    // Lock flag once address is won
let searchCeiling = 59;        // Strict ceiling boundary
let handshakeTimer = null;     // Handles the 2-second Wi-Fi silent gate
let incomingListenerActive = false; // Flag to prevent double listener attachment
// ---------------------------------------------

module.exports = function (app) {
  const plugin = {};
  let timers = [];
  let globalOptions = {};
  let simpleCan = null;

  plugin.id = 'signalk-bandg-performance-plugin';  
  plugin.name = 'B&G performance PGN plugin';  
  plugin.description = 'Send B&G performance PGNs to display on Vulcan/Zeus/Triton2';  
  

  let supportedValues = {  
  
    'avgTrueWindDirection': {  
      'name'        : 'Average True Wind Direction (rad)',  
      'key'         : '50,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'biasAdvantage': {  
      'name'        : 'Bias Advantage (m)',  
      'key'         : '31,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'chainLength': {  
      'name'        : 'Chain Length (m)',  
      'key'         : '1c,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'codeZeroLoad': {  
      'name'        : 'Code Zero Load',  
      'key'         : '2a,21',  
      'unit'        : '',  
      'defaultPath' : ''  
    },  
  
    'course': {  
      'name'        : 'Course (rad)',  
      'key'         : '69,20',  
      'unit'        : 'rad',  
      'defaultPath' : 'navigation.courseOverGroundTrue'  
    },  
  
    'cunningham': {  
      'name'        : 'Cunningham',  
      'key'         : '24,21',  
      'unit'        : '',  
      'defaultPath' : ''  
    },  
  
    'drBearing': {  
      'name'        : 'Dead Reckoning bearing (rad)',  
      'key'         : 'd3,20',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'drDistance': {  
      'name'        : 'Dead Reckoning Distance (m)',  
      'key'         : '81,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'groundWindDirection': {  
      'name'        : 'Ground Wind Direction (rad)',  
      'key'         : '37,21',  
      'unit'        : 'rad',  
      'defaultPath' : 'environment.wind.directionGround'  
    },  
  
    'groundWind': {  
      'name'        : 'Ground Wind Speed (m/s)',  
      'key'         : '38,21',  
      'unit'        : 'm/s',  
      'defaultPath' : 'environment.wind.speedOverGround'  
    },  
  
    'headingOppTack': {  
      'name'        : 'Heading on Opposite Tack (True) (rad)',  
      'key'         : '9a,20',  
      'unit'        : 'rad',  
      'defaultPath' : 'performance.tackTrue'  
    },  
  
    'heelAngle': {  
      'name'        : 'Heel Angle (rad)',  
      'key'         : '34,20',  
      'unit'        : 'rad',  
      'defaultPath' : 'navigation.attitude'  
    },  
  
    'jacuzziTemperature': {  
      'name'        : 'Jacuzzi Temperature (Kelvin)',  
      'key'         : '25,21',  
      'unit'        : 'celcius',  
      'defaultPath' : 'environment.jacuzzi.temperature'  
    },  
  
    'leewayAngle': {  
      'name'        : 'Leeway Angle (rad)',  
      'key'         : '82,20',  
      'unit'        : 'rad',  
      'defaultPath' : 'navigation.leewayAngle'  
    },  
  
    'mastRake': {  
      'name'        : 'Mast Rake (rad)',  
      'key'         : '34,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'nextLegBearing': {  
      'name'        : 'Next Leg Bearing (rad)',  
      'key'         : '35,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'nextLegTargetSpeed': {  
      'name'        : 'Next Leg Target Speed (m/s)',  
      'key'         : '36,21',  
      'unit'        : 'm/s',  
      'defaultPath' : ''  
    },  
  
    'oppTackCOG': {  
      'name'        : 'Opposite Tack COG (rad)',  
      'key'         : '32,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'oppTackTarget': {  
      'name'        : 'Opposite Tack Target heading (rad)',  
      'key'         : '33,21',  
      'unit'        : 'rad',  
      'defaultPath' : 'performance.tackTrue'  
    },  
  
    'oppWindAngle': {  
      'name'        : 'Optimum Wind Angle (rad)',  
      'key'         : '35,20',  
      'unit'        : 'signedRad',  
      'defaultPath' : 'performance.optimumWindAngle'  
    },  
  
    'outhaulLoad': {  
      'name'        : 'Outhaul Load',  
      'key'         : '22,21',  
      'unit'        : '',  
      'defaultPath' : ''  
    },  
  
    'plowAngle': {  
      'name'        : 'Plow Angle (rad)',  
      'key'         : '23,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'polarSpeed': {  
      'name'        : 'Polar Boat Speed (m/s)',  
      'key'         : '7e,20',  
      'unit'        : 'm/s',  
      'defaultPath' : 'performance.polarSpeed'  
    },  
  
    'polarPerformance': {  
      'name'        : 'Polar Performance (ratio)',  
      'key'         : '7c,20',  
      'unit'        : 'percent',  
      'defaultPath' : 'performance.polarSpeedRatio'  
    },  
  
    'poolTemperature': {  
      'name'        : 'Pool Temperature (Kelvin)',  
      'key'         : '26,21',  
      'unit'        : 'celcius',  
      'defaultPath' : 'environment.pool.temperature'  
    },  
  
    'targetTWA': {  
      'name'        : 'Target TWA (rad)',  
      'key'         : '53,20',  
      'unit'        : 'signedRad',  
      'defaultPath' : 'performance.targetAngle'  
    },  
  
    'tideRate': {  
      'name'        : 'Tide Rate (m/s)',  
      'key'         : '83,20',  
      'unit'        : 'm/s',  
      'defaultPath' : ''  
    },  
  
    'tideSet': {  
      'name'        : 'Tide Set (rad)',  
      'key'         : '84,20',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'tackingPerf': {  
      'name'        : 'Tacking Performance (ratio)',  
      'key'         : '32,20',  
      'unit'        : 'percent',  
      'defaultPath' : ''  
    },  
  
    'trimAngle': {  
      'name'        : 'Trim Angle (rad)',  
      'key'         : '9b,20',  
      'unit'        : 'rad',  
      'defaultPath' : 'navigation.attitude'  
    },  
  
    'vmg': {  
      'name'        : 'Velocity Made Good (m/s)',  
      'key'         : '7f,20',  
      'unit'        : 'm/s',  
      'defaultPath' : 'performance.velocityMadeGood'  
    },  
  
    'vmgperf': {  
      'name'        : 'VMG Performance (ratio)',  
      'key'         : '1d,21',  
      'unit'        : 'percent',  
      'defaultPath' : 'performance.velocityMadeGoodRatio'  
    },  
  
    'windAngleMast': {  
      'name'        : 'Wind Angle to Mast (rad)',  
      'key'         : '9d,20',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'windPhase': {  
      'name'        : 'Wind Phase (rad)',  
      'key'         : '51,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'windLift': {  
      'name'        : 'Wind Lift (rad)',  
      'key'         : '52,21',  
      'unit'        : 'rad',  
      'defaultPath' : ''  
    },  
  
    'user1': {  
      'name'        : 'User 1',  
      'key'         : '38,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user2': {  
      'name'        : 'User 2',  
      'key'         : '39,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user3': {  
      'name'        : 'User 3',  
      'key'         : '3a,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user4': {  
      'name'        : 'User 4',  
      'key'         : '3b,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user5': {  
      'name'        : 'User 5',  
      'key'         : '10,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user6': {  
      'name'        : 'User 6',  
      'key'         : '11,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user7': {  
      'name'        : 'User 7',  
      'key'         : '12,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user8': {  
      'name'        : 'User 8',  
      'key'         : '13,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user9': {  
      'name'        : 'User 9',  
      'key'         : '14,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user10': {  
      'name'        : 'User 10',  
      'key'         : '15,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user11': {  
      'name'        : 'User 11',  
      'key'         : '16,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user12': {  
      'name'        : 'User 12',  
      'key'         : '17,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user13': {  
      'name'        : 'User 13',  
      'key'         : '18,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user14': {  
      'name'        : 'User 14',  
      'key'         : '19,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user15': {  
      'name'        : 'User 15',  
      'key'         : '1a,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user16': {  
      'name'        : 'User 16',  
      'key'         : '1b,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user17': {  
      'name'        : 'User 17',  
      'key'         : '3d,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user18': {  
      'name'        : 'User 18',  
      'key'         : '3e,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user19': {  
      'name'        : 'User 19',  
      'key'         : '3f,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user20': {  
      'name'        : 'User 20',  
      'key'         : '40,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user21': {  
      'name'        : 'User 21',  
      'key'         : '41,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user22': {  
      'name'        : 'User 22',  
      'key'         : '42,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user23': {  
      'name'        : 'User 23',  
      'key'         : '43,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user24': {  
      'name'        : 'User 24',  
      'key'         : '44,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user25': {  
      'name'        : 'User 25',  
      'key'         : '45,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user26': {  
      'name'        : 'User 26',  
      'key'         : '46,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user27': {  
      'name'        : 'User 27',  
      'key'         : '47,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user28': {  
      'name'        : 'User 28',  
      'key'         : '48,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user29': {  
      'name'        : 'User 29',  
      'key'         : '49,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user30': {  
      'name'        : 'User 30',  
      'key'         : '4a,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user31': {  
      'name'        : 'User 31',  
      'key'         : '4b,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'user32': {  
      'name'        : 'User 32',  
      'key'         : '4c,21',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote0': {  
      'name'        : 'Remote 0',  
      'key'         : 'df,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote1': {  
      'name'        : 'Remote 1',  
      'key'         : 'ef,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote2': {  
      'name'        : 'Remote 2',  
      'key'         : 'f0,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote3': {  
      'name'        : 'Remote 3',  
      'key'         : 'f1,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote4': {  
      'name'        : 'Remote 4',  
      'key'         : 'f2,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote5': {  
      'name'        : 'Remote 5',  
      'key'         : 'f3,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote6': {  
      'name'        : 'Remote 6',  
      'key'         : 'f4,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote8': {  
      'name'        : 'Remote 8',  
      'key'         : 'f6,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    },  
  
    'remote9': {  
      'name'        : 'Remote 9',  
      'key'         : 'f7,20',  
      'unit'        : 'm',  
      'defaultPath' : ''  
    }  
  
  };  
  

  // --- STATE 1 & 2: PROACTIVE DYNAMIC ADDRESS STATE MACHINE ---
  function initiateAddressClaimSequence() {
    if (addressClaimed) return;

    const mode = globalOptions.emulationMode || 'ydwg02';
    if (mode === 'canbus') {
      addressClaimed = true;
      executePostClaimIdentityFlight();
      startPerformanceStreams();
      return;
    }

    if (handshakeTimer) clearTimeout(handshakeTimer);

    const timestamp = new Date().toISOString();
    
    // A. ISO Address Claim (PGN 60928) for our candidate
    const rawAddressClaim = `${timestamp},6,60928,${currentAddress},255,8,50,06,82,04,00,82,00,c0`;

    // B. NEW PROACTIVE NETWORK INTERROGATION: ISO Request (PGN 59904) for Address Claims (0EE00 hex)
    // This forces EVERY silent device on the boat to immediately broadcast its address position!
    const networkQueryRequest = `${timestamp},6,59904,${currentAddress},255,3,00,ee,00`;

    if (app.emit) {
      // Shout our claim and instantly demand everyone else claim their slots
      app.emit('nmea2000out', rawAddressClaim);
      setTimeout(() => {
        app.emit('nmea2000out', networkQueryRequest);
        app.debug(`State Machine: Sent proactive network challenge query from Candidate [${currentAddress}]`);
      }, 5);
    }

    // STATE 1: Open the 2-second safety window. Any silent collision will now wake up and trigger State 2
    handshakeTimer = setTimeout(() => {
      addressClaimed = true;
      console.log(`[B&G Performance] State Machine: Address [${currentAddress}] SUCCESSFULLY CLAIMED and secured.`);
      
      globalOptions.currentAddress = currentAddress;
      if (typeof app.savePluginOptions === 'function') {
        app.savePluginOptions(globalOptions, () => {
          app.debug('State Machine: Winning address configurations saved persistently.');
        });
      }

      executePostClaimIdentityFlight();
      startPerformanceStreams();
    }, 2000); 
  }


  // Hook into sandboxed incoming events to check for node collisions
  function attachIncomingNetworkListener() {
    if (incomingListenerActive) return;

    // FIX: Changed event hook name to 'nmea2000In' to align with modern core architecture
    app.on('nmea2000In', (n2k) => {
      if (addressClaimed) return; // Ignore incoming network traffic once address is secured

      // Extract the raw source address integer out of the Signal K update metadata wrapper
      let incomingSrc = null;
      if (n2k && n2k.updates && n2k.updates[0] && n2k.updates[0].source) {
        incomingSrc = n2k.updates[0].source.src;
      }

      // If another physical device on the backbone is using our candidate address, trigger State 2
      if (incomingSrc !== null && incomingSrc === currentAddress) {
        app.warn(`State Machine: COLLISION DETECTED! Another device is using address [${currentAddress}].`);
        
        // STATE 2: COLLIDE - Clear safety clocks, step up to next candidate address slot
        if (handshakeTimer) clearTimeout(handshakeTimer);
        currentAddress++;

        if (currentAddress > searchCeiling) {
          app.error(`State Machine: CRITICAL CEILING FAILURE - Network range 36-${searchCeiling} is completely full. Cannot claim device ID.`);
          return; // Halt completely to protect boat hardware from data loops
        }

        // Loop back to State 1 with the next address candidate slot
        initiateAddressClaimSequence();
      }
    });

    incomingListenerActive = true;
    app.debug('State Machine: Process-isolated network listener successfully attached to nmea2000In.');
  }

  // --- STATE 3: IDENTIFICATION FLIGHT ---
  function executePostClaimIdentityFlight() {
    try {
      const timestamp = new Date().toISOString();
      // identitySeqCounter is the 3-bit sequence ID for the Fast Packet message
      // It must be incremented per *message*, not per frame.
      // So, store current sequence ID for this message, then increment for the next message.
      const currentSeqId = identitySeqCounter; 
      identitySeqCounter = (identitySeqCounter + 1) % 8; 

      // Helper to pad strings to exactly 32 bytes
      function getPaddedString(str) {
        let arr = Array(32).fill(0); // Fill with null bytes
        for (let i = 0; i < str.length && i < 32; i++) {
          arr[i] = str.charCodeAt(i);
        }
        return arr;
      }

      // Build the strict 134-byte payload for PGN 126996
      let payload = [];
      payload.push(0x35, 0x08); // NMEA Version 2101 (0x0835)
      payload.push(0xc6, 0x11); // Product Code 4550 (0x11C6)
      payload = payload.concat(getPaddedString("H5000 CPU"));
      payload = payload.concat(getPaddedString("2.0.45"));
      payload = payload.concat(getPaddedString("Performance v2"));
      payload = payload.concat(getPaddedString("BKT-1616"));
      payload.push(0x01); // Certification Level
      payload.push(0x01); // Load Equivalency

      const totalBytes = payload.length; // Should be 134 (0x86)

      let frames = [];
      let payloadIdx = 0; // Index into the full payload array
      let frameIdx = 0;   // Index of the current Fast Packet frame (0-N)

      while (payloadIdx < totalBytes) {
        let frameDataBytes = []; // The actual data bytes for this frame (max 7)
        let tpControlByteValue; // The value of the Fast Packet Control Byte

        if (frameIdx === 0) {
          // *** CRITICAL CHANGE HERE FOR THE FIRST FRAME ***
          // Fast Packet Control Byte contains total message length (lower 5 bits) AND sequence ID (upper 3 bits)
          tpControlByteValue = (currentSeqId << 5) | (totalBytes & 0x1F); 
          
          // Add up to 6 bytes of actual payload to this frame.
          // The control byte effectively uses one of the 7 data slots in the first frame.
          for (let i = 0; i < 6 && payloadIdx < totalBytes; i++) {
            frameDataBytes.push(payload[payloadIdx++].toString(16).padStart(2, '0'));
          }
        } else {
          // Subsequent frames: Control Byte contains frame index (lower 5 bits) AND sequence ID (upper 3 bits)
          tpControlByteValue = (currentSeqId << 5) | (frameIdx & 0x1F);
          
          // Add up to 7 bytes of actual payload to this frame
          for (let i = 0; i < 7 && payloadIdx < totalBytes; i++) {
            frameDataBytes.push(payload[payloadIdx++].toString(16).padStart(2, '0'));
          }
        }

        // Pad with 'ff' if this is the last frame and it's not full (common for Actisense string format)
        while (frameDataBytes.length < 7 && payloadIdx >= totalBytes) { 
            frameDataBytes.push('ff');
        }

        const tpControlByteHex = tpControlByteValue.toString(16).padStart(2, '0');
        const dataStr = frameDataBytes.join(',');
        
        // *** CRITICAL CHANGE HERE: tpControlByteHex is the *only* control byte emitted ***
        // We do NOT add totalBytes as a separate data byte.
        frames.push(`${timestamp},6,126996,${currentAddress},255,8,${tpControlByteHex},${dataStr}`);
        frameIdx++;
      }

      // Dispatch frames
      if (app.emit) {
        frames.forEach((frame, idx) => {
          setTimeout(() => {
            app.emit('nmea2000out', frame);
          }, idx * 7); 
        });
        app.debug(`State Machine: Identity broadcast flight dispatched over won address [${currentAddress}]`);
      }
    } catch (err) {
      app.error(`Identity configuration compilation error: ${err.message}`);
    }
  }


  // --- STATE 4: DATA OPERATIONAL PHASE ---
  function startPerformanceStreams() {
    app.debug('State Machine: Handshake complete. Activating twice-a-second calculation engines.');
    
    timers.push(setInterval(() => {  
      // 1. Always execute live boat calculation frames first
      sendPerformance();
      
      const mode = globalOptions.emulationMode || 'ydwg02';
      identityCycleCount++;

      // 2. Strategy A Logic: Trigger identity updates exactly on the 10th loop tick (5 seconds)
      if ((mode === 'ydwg02' || mode === 'standard') && identityCycleCount >= 10) {
        identityCycleCount = 0; // Clear the gate counter

        // Post-Performance Delay Anchor: Wait 50ms for performance buffers to pass before identity streams
        setTimeout(() => {
          executePostClaimIdentityFlight();
        }, 50);
      }
    }, 500));
  }

  plugin.start = function (options, restartData) {
    app.debug('Plugin starting...');
    globalOptions = options;
    
    // Ensure parameters match boundaries, falling back safely if undefined
    currentAddress = options.currentAddress || 36;
    if (currentAddress < 36 || currentAddress > searchCeiling) {
      currentAddress = 36; // Fallback check to reset edge cases
    }
    
    addressClaimed = false;
    identityCycleCount = 0;

    // Bind components based on chosen output channel configuration
    if (options.emulationMode === 'canbus') {
      try {
        const SimpleCan = require('@canboat/canboatjs').SimpleCan;
        simpleCan = new SimpleCan({
          app: app,
          canInterface: options.canInterface || 'can0', // Dynamically loads user value!
          addressClaim: {
            'Unique Number': 1616,
            'Manufacturer Code': 'Navico',
            'Device Function': 130,
            'Device Class': 85
          },
          productInfo: {
            'NMEA 2000 Version': 2101,
            'Product Code': 4550,
            'Model ID': 'H5000 CPU',
            'Software Version Code': '2.0.45',
            'Model Version': 'Performance v2',
            'Model Serial Code': 'BKT-1616'
          }
        });
        simpleCan.start();
      } catch (canErr) {
        app.error(`Failed to initialize native CAN layer: ${canErr.message}`);
      }
    }

    // Activate the State Machine Lifecycle Hooks
    attachIncomingNetworkListener();
    initiateAddressClaimSequence();
  };

  plugin.stop = function () {
    app.debug('Plugin stopping...');
    if (handshakeTimer) clearTimeout(handshakeTimer);
    timers.forEach(clearInterval);
    timers = [];
    if (simpleCan && typeof simpleCan.stop === 'function') {
      simpleCan.stop();
    }
    addressClaimed = false;
    app.debug('Plugin safely deactivated.');
  };

  
  // Dedicated data-delivery routing engine 
  function sendN2k (msg) {
    if (!msg || msg.includes('undefined')) {
      return;
    }

    const mode = globalOptions.emulationMode || 'ydwg02';

    if (mode === 'canbus') {
      if (simpleCan && typeof simpleCan.sendPGN === 'function') {
        simpleCan.sendPGN(msg);
      }
    } 
    else if (mode === 'ydwg02' || mode === 'standard') {
      if (app.emit) {
        // Stamp data using our dynamically determined, verified winning address
        const realignedMsg = msg.replace(/,126996,\d+,/, `,126996,${currentAddress},`)
                                .replace(/,130824,\d+,/, `,130824,${currentAddress},`);
        app.emit('nmea2000out', realignedMsg);
      }
    }
  }

  
   plugin.schema = function() {
    // Construct the base schema each time it's requested
    let generatedSchema = {
      properties: {
        'null': {
          'title': 'Select which data to send and what to use as path and source device. Source device can be specified when a path has multiple value sources. For explanations of the data you can check the B&G H5000 Operation manual here:\nhttps://softwaredownloads.navico.com/BG/downloads/documents/H5000_OM_EN_988-10630-002_w.pdf',
          'type': 'null',
        },
        emulationMode: {
          type: "string",
          title: "Emulation Mode",
          description: "Select how to send B&G H5000 data",
          default: "standard",
          enum: ["standard", "canbus", "ydwg02"],
          enumNames: ["Standard (nmea2000out)", "Direct CANbus (H5000 emulation)", "YDWG-02 Gateway (H5000 via gateway)"]
        },
        canInterface: {
          type: "string",
          title: "CANbus device to use for direct emulation (leave empty for autodetect)",
          description: "Only used when Emulation Mode is set to 'Direct CANbus'"
        },
        currentAddress: { // Corrected from currentddress
          type: "number",
          title: "Source device ID for B&G H5000 emulation",
          default: 55,
          description: "NMEA2000 source address (0-251, 36-55 prefered). Default is 55."
        },
      }
    };

    // Dynamically add all supportedValues to the schema's properties
    Object.keys(supportedValues).forEach(key => {
      let defaultPath = supportedValues[key]['defaultPath'];
      if (defaultPath === '') { // Use strict equality (good practice)
        defaultPath = 'n/a';
      }

      generatedSchema.properties[key] = {
        type: 'object',
        title: supportedValues[key]['name'],
        properties: {
          enabled: {
            title: 'Enabled',
            type: 'boolean',
            default: false
          },
          path: {
            type: 'string',
            title: 'Use data from this path',
            description: 'Leave blank to use default (' + defaultPath + ')',
            default: defaultPath
          },
          source: {
            type: 'string',
            title: 'Use data only from this source (leave blank if path has only one source)'
          }
        }
      };
    });

    // You can uncomment this line to debug the final schema object if needed
    // app.debug('Generated schema: %j', generatedSchema);
    return generatedSchema; // Return the complete schema object
  };



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

  function sendPerformance() {  
    var performancePGN_2 = ""  
    var length = 0  
    var value  
  
    for (var type in supportedValues) {  
      //app.debug('type: %s', type)  
      if (typeof (globalOptions[type]) != 'undefined' && globalOptions[type]['enabled'] == true) {  
        // Get value  
        var path = globalOptions[type]['path']  
        var source = globalOptions[type]['source']  
        // app.debug('globalOptions[%s] enabled  path: %s  source: %s', type, path, source || 'n/a');  
        value = app.getSelfPath(path)  
        if (typeof (value) != 'undefined') {  
          if (typeof (source) == 'undefined') {  
            value = value.value  
          } else {  
            if (source == value['$source']) {  
              app.debug('Matched source: %s', value['$source'])  
              value = value.value  
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
          // We have a path with a working value  
          // app.debug('path: %s  value: %j', path, value);  
          // Add key to msg  
          performancePGN_2 += ',' + supportedValues[type]['key']  
          // Add value  
          switch (supportedValues[type]['unit']) {  
            case 'rad':  
              var hex = radToHex(value)  
              // app.debug('radToDeg: %s radToHex: %s %s', radToDeg(value), value, hex)  
              performancePGN_2 += ',' + hex  
              break  
  
            case 'signedRad':  
              var hex = signedRadToHex(value)  
              // app.debug('radToDeg: %s radToHex: %s %s', signedRadToDeg(value), value, hex)  
              performancePGN_2 += ',' + hex  
              break  
  
            case 'percent':  
              var hex = intToHex(value * 1000) // ratio to percentiles  
              //app.debug('% intToHex: %s %s', value, hex)  
              performancePGN_2 += ',' + hex  
              break  
                
            case 'm':  
              var hex = intToHex(value * 100) // m to cm  
              // app.debug('m intToHex: %s %s', value, hex)  
              performancePGN_2 += ',' + hex  
              break  
  
            case 'celcius':  
              var hex = intToHex(value * 100) // Celcius in Kelvin  
              app.debug('celcius intToHex: %s %s', value, hex)  
              performancePGN_2 += ',' + hex  
              break  
  
            case '':  
              var hex = intToHex(value * 1000)   
              app.debug('intToHex: %s %s', value, hex)  
              performancePGN_2 += ',' + hex  
              break  
  
            case 'm/s':  
              var hex = intToHex(value * 100) // m/s to cm/s  
              //app.debug('intToHex: %s %s', value, hex)  
              performancePGN_2 += ',' + hex  
              break  
  
          }  
        }       
      }  
    }  
  
    // app.debug ('%j', globalOptions)  
    length = performancePGN_2.split(',').length + 1 // array length  
    // app.debug('Msg: performancePGN_2: %s  length: %d', performancePGN_2, length)  
    if (length >= 4) {  
      if (length <= 8) {  
        for (let x = length; x<10; x++) {  
          performancePGN_2 += ',ff'  
          // app.debug('Msg: paddding performancePGN_2: %s  length: %d', performancePGN_2, length)  
        }  
      }  
      // Only format the base header, then append the payload string
      let msg = util.format(performancePGN, (new Date()).toISOString(), currentAddress, String(length)) + performancePGN_2;
      sendN2k(msg);
    }  
  }  
  
  return plugin;
};
/**
 * CrashSense GNSS / GPS Engine
 *
 * Simulates u-blox NEO-6M receiver:
 * - Generates and parses standard NMEA-0183 sentences ($GPGGA, $GPRMC) with strict checksum verification.
 * - Tracks satellite acquisition (TTFF), fix quality, HDOP, and fix age.
 * - Manages NO_FIX, VALID_FIX, and STALE_FIX states.
 * - Preserves last-known valid location with explicit age stamps.
 * - Generates Google Maps URLs only for valid coordinates.
 */

const EventEmitter = require('events');

class GPSEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      GPS_DEFAULT_LAT: config.GPS_DEFAULT_LAT ?? 37.774929,
      GPS_DEFAULT_LNG: config.GPS_DEFAULT_LNG ?? -122.419416,
      GPS_STALE_THRESHOLD_SEC: config.GPS_STALE_THRESHOLD_SEC ?? 60,
      ...config
    };

    this.hasHardwareSignal = true; // Is GPS receiver connected & getting RF
    this.hasFix = true;
    this.lat = this.config.GPS_DEFAULT_LAT;
    this.lng = this.config.GPS_DEFAULT_LNG;
    this.altitudeM = 15.4;
    this.speedKmh = 45.0;
    this.courseDeg = 180.0;
    this.satellites = 8;
    this.hdop = 1.05;

    this.lastValidFix = {
      lat: this.lat,
      lng: this.lng,
      timestamp: Date.now(),
      mapUrl: this.createMapUrl(this.lat, this.lng)
    };

    this.fixTimestamp = Date.now();
  }

  setFixState(hasFix) {
    this.hasFix = Boolean(hasFix);
    if (this.hasFix) {
      this.fixTimestamp = Date.now();
      this.satellites = 8;
      this.lastValidFix = {
        lat: this.lat,
        lng: this.lng,
        timestamp: this.fixTimestamp,
        mapUrl: this.createMapUrl(this.lat, this.lng)
      };
    } else {
      this.satellites = 0;
    }
    this.emit('fix_changed', { hasFix: this.hasFix, satellites: this.satellites });
  }

  setHardwareSignal(connected) {
    this.hasHardwareSignal = Boolean(connected);
    if (!this.hasHardwareSignal) {
      this.hasFix = false;
      this.satellites = 0;
    }
    this.emit('signal_changed', { hasHardwareSignal: this.hasHardwareSignal });
  }

  setCoordinates(lat, lng) {
    if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
      this.lat = lat;
      this.lng = lng;
      if (this.hasFix) {
        this.fixTimestamp = Date.now();
        this.lastValidFix = {
          lat: this.lat,
          lng: this.lng,
          timestamp: this.fixTimestamp,
          mapUrl: this.createMapUrl(this.lat, this.lng)
        };
      }
    }
  }

  // Force fix age to simulate stale condition
  setStaleAgeSec(ageSec) {
    this.hasFix = false; // no current live fix
    this.satellites = 0;
    this.fixTimestamp = Date.now() - (ageSec * 1000);
    this.lastValidFix.timestamp = this.fixTimestamp;
  }

  createMapUrl(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return null;
    }
    // Strict range checks
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  }

  getLocationStatus() {
    const now = Date.now();
    const fixAgeSec = Math.floor((now - this.fixTimestamp) / 1000);
    const isStale = fixAgeSec > this.config.GPS_STALE_THRESHOLD_SEC;

    let status = 'NO_FIX';
    let usableLocation = null;

    if (this.hasFix && !isStale) {
      status = 'VALID_FIX';
      usableLocation = {
        lat: this.lat,
        lng: this.lng,
        mapUrl: this.createMapUrl(this.lat, this.lng),
        fixAgeSec: 0,
        isStale: false
      };
    } else if (this.lastValidFix && this.lastValidFix.lat !== null) {
      const lastFixAgeSec = Math.floor((now - this.lastValidFix.timestamp) / 1000);
      status = 'STALE_FIX';
      usableLocation = {
        lat: this.lastValidFix.lat,
        lng: this.lastValidFix.lng,
        mapUrl: this.lastValidFix.mapUrl,
        fixAgeSec: lastFixAgeSec,
        isStale: true
      };
    } else {
      status = 'NO_FIX';
    }

    return {
      status,
      hasFix: this.hasFix,
      hasHardwareSignal: this.hasHardwareSignal,
      satellites: this.satellites,
      hdop: this.hdop,
      currentFixAgeSec: fixAgeSec,
      location: usableLocation
    };
  }

  // Calculate standard NMEA XOR checksum
  _calculateNMEAChecksum(sentenceWithoutDollar) {
    let checksum = 0;
    for (let i = 0; i < sentenceWithoutDollar.length; i++) {
      checksum ^= sentenceWithoutDollar.charCodeAt(i);
    }
    return checksum.toString(16).toUpperCase().padStart(2, '0');
  }

  // Generate synthetic $GPGGA and $GPRMC sentences
  generateNMEAPacket() {
    const d = new Date();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const timeStr = `${hh}${mm}${ss}.00`;

    if (!this.hasFix) {
      const ggaBody = `GPGGA,${timeStr},,,,,0,00,99.99,,,,,,`;
      const gga = `$${ggaBody}*${this._calculateNMEAChecksum(ggaBody)}`;
      const rmcBody = `GPRMC,${timeStr},V,,,,,,,${d.getUTCDate()}${d.getUTCMonth()+1}${String(d.getUTCFullYear()).slice(-2)},,,N`;
      const rmc = `$${rmcBody}*${this._calculateNMEAChecksum(rmcBody)}`;
      return `${gga}\r\n${rmc}\r\n`;
    }

    // Convert decimal degrees to NMEA DDMM.MMMM format
    const latDeg = Math.floor(Math.abs(this.lat));
    const latMin = (Math.abs(this.lat) - latDeg) * 60;
    const latStr = `${String(latDeg).padStart(2, '0')}${latMin.toFixed(4)}`;
    const latDir = this.lat >= 0 ? 'N' : 'S';

    const lngDeg = Math.floor(Math.abs(this.lng));
    const lngMin = (Math.abs(this.lng) - lngDeg) * 60;
    const lngStr = `${String(lngDeg).padStart(3, '0')}${lngMin.toFixed(4)}`;
    const lngDir = this.lng >= 0 ? 'E' : 'W';

    const ggaBody = `GPGGA,${timeStr},${latStr},${latDir},${lngStr},${lngDir},1,${String(this.satellites).padStart(2, '0')},${this.hdop.toFixed(2)},${this.altitudeM.toFixed(1)},M,0.0,M,,`;
    const gga = `$${ggaBody}*${this._calculateNMEAChecksum(ggaBody)}`;

    const knots = (this.speedKmh / 1.852).toFixed(1);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yr = String(d.getUTCFullYear()).slice(-2);
    const dateStr = `${day}${mon}${yr}`;

    const rmcBody = `GPRMC,${timeStr},A,${latStr},${latDir},${lngStr},${lngDir},${knots},${this.courseDeg.toFixed(1)},${dateStr},,,A`;
    const rmc = `$${rmcBody}*${this._calculateNMEAChecksum(rmcBody)}`;

    return `${gga}\r\n${rmc}\r\n`;
  }

  // Parse incoming NMEA-0183 sentence with checksum validation
  parseNMEA(line) {
    line = line.trim();
    if (!line.startsWith('$')) return { valid: false, error: 'NO_DOLLAR_PREFIX' };

    const starIdx = line.indexOf('*');
    if (starIdx === -1) return { valid: false, error: 'NO_CHECKSUM' };

    const payload = line.substring(1, starIdx);
    const providedChecksum = line.substring(starIdx + 1).toUpperCase();
    const calculatedChecksum = this._calculateNMEAChecksum(payload);

    if (providedChecksum !== calculatedChecksum) {
      return { valid: false, error: 'CHECKSUM_MISMATCH' };
    }

    const parts = payload.split(',');
    const type = parts[0];

    if (type === 'GPRMC' || type === 'GNRMC') {
      const status = parts[2]; // 'A' = valid, 'V' = receiver warning (no fix)
      if (status !== 'A') {
        return { valid: true, type, hasFix: false };
      }

      const rawLat = parts[3];
      const latHem = parts[4];
      const rawLng = parts[5];
      const lngHem = parts[6];

      if (!rawLat || !rawLng) return { valid: true, type, hasFix: false };

      const latDeg = parseInt(rawLat.substring(0, 2), 10);
      const latMin = parseFloat(rawLat.substring(2));
      let lat = latDeg + (latMin / 60);
      if (latHem === 'S') lat = -lat;

      const lngDeg = parseInt(rawLng.substring(0, 3), 10);
      const lngMin = parseFloat(rawLng.substring(3));
      let lng = lngDeg + (lngMin / 60);
      if (lngHem === 'W') lng = -lng;

      this.lat = lat;
      this.lng = lng;
      this.hasFix = true;
      this.fixTimestamp = Date.now();
      this.lastValidFix = {
        lat,
        lng,
        timestamp: this.fixTimestamp,
        mapUrl: this.createMapUrl(lat, lng)
      };

      return { valid: true, type, hasFix: true, lat, lng };
    }

    if (type === 'GPGGA' || type === 'GNGGA') {
      const fixQuality = parseInt(parts[6] || '0', 10);
      const sats = parseInt(parts[7] || '0', 10);
      const hdop = parseFloat(parts[8] || '99.9');

      this.satellites = sats;
      this.hdop = hdop;

      return { valid: true, type, fixQuality, satellites: sats, hdop };
    }

    return { valid: true, type };
  }
}

module.exports = GPSEngine;

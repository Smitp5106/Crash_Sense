#include "GPSManager.h"

GPSManager::GPSManager()
    : _serial(nullptr),
      _bufferIndex(0) {
    _location.fixState = GPS_NO_FIX;
    _location.hasFix = false;
    _location.latitude = 0.0;
    _location.longitude = 0.0;
    _location.satellites = 0;
    _location.hdop = 99.9f;
    _location.fixTimestampMs = 0;
    _location.mapUrl[0] = '\0';

    _lastValidFix = _location;
}

void GPSManager::begin(HardwareSerial& serialPort, uint32_t baud, int8_t rxPin, int8_t txPin) {
    _serial = &serialPort;
    _serial->begin(baud, SERIAL_8N1, rxPin, txPin);
}

void GPSManager::injectMockLocation(double lat, double lng, uint8_t sats) {
    _location.hasFix = true;
    _location.fixState = GPS_VALID_FIX;
    _location.latitude = lat;
    _location.longitude = lng;
    _location.satellites = sats;
    _location.hdop = 1.0f;
    _location.fixTimestampMs = millis();
    formatGoogleMapsUrl(lat, lng, _location.mapUrl, sizeof(_location.mapUrl));

    _lastValidFix = _location;
}

bool GPSManager::verifyChecksum(const char* sentence) {
    if (sentence[0] != '$') return false;
    const char* star = strchr(sentence, '*');
    if (!star) return false;

    uint8_t calculated = 0;
    for (const char* p = sentence + 1; p < star; p++) {
        calculated ^= (uint8_t)(*p);
    }

    uint8_t provided = (uint8_t)strtol(star + 1, nullptr, 16);
    return (calculated == provided);
}

void GPSManager::formatGoogleMapsUrl(double lat, double lng, char* outBuffer, size_t maxLen) {
    if (lat < -90.0 || lat > 90.0 || lng < -180.0 || lng > 180.0) {
        outBuffer[0] = '\0';
        return;
    }
    snprintf(outBuffer, maxLen, "https://maps.google.com/?q=%.6f,%.6f", lat, lng);
}

void GPSManager::parseGPRMC(char* sentence) {
    // $GPRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,x.x,x.x,ddmmyy,,,a*hh
    char* token = strtok(sentence, ",");
    int fieldIndex = 0;
    char status = 'V';
    char rawLat[16] = {0};
    char latHem = 'N';
    char rawLng[16] = {0};
    char lngHem = 'E';

    while (token != nullptr) {
        fieldIndex++;
        if (fieldIndex == 3) status = token[0];
        else if (fieldIndex == 4) strncpy(rawLat, token, sizeof(rawLat) - 1);
        else if (fieldIndex == 5) latHem = token[0];
        else if (fieldIndex == 6) strncpy(rawLng, token, sizeof(rawLng) - 1);
        else if (fieldIndex == 7) lngHem = token[0];
        token = strtok(nullptr, ",");
    }

    if (status == 'A' && strlen(rawLat) > 4 && strlen(rawLng) > 5) {
        // Parse Latitude (DDMM.MMMM)
        double rawLatVal = atof(rawLat);
        int latDeg = (int)(rawLatVal / 100);
        double latMin = rawLatVal - (latDeg * 100);
        double lat = latDeg + (latMin / 60.0);
        if (latHem == 'S') lat = -lat;

        // Parse Longitude (DDDMM.MMMM)
        double rawLngVal = atof(rawLng);
        int lngDeg = (int)(rawLngVal / 100);
        double lngMin = rawLngVal - (lngDeg * 100);
        double lng = lngDeg + (lngMin / 60.0);
        if (lngHem == 'W') lng = -lng;

        _location.hasFix = true;
        _location.latitude = lat;
        _location.longitude = lng;
        _location.fixTimestampMs = millis();
        formatGoogleMapsUrl(lat, lng, _location.mapUrl, sizeof(_location.mapUrl));

        _lastValidFix = _location;
    } else {
        _location.hasFix = false;
    }
}

void GPSManager::parseGPGGA(char* sentence) {
    // $GPGGA,hhmmss.ss,llll.ll,a,yyyyy.yy,a,q,ss,y.y,a.a,M,...
    char* token = strtok(sentence, ",");
    int fieldIndex = 0;
    uint8_t sats = 0;
    float hdop = 99.9f;

    while (token != nullptr) {
        fieldIndex++;
        if (fieldIndex == 8) sats = (uint8_t)atoi(token);
        else if (fieldIndex == 9) hdop = (float)atof(token);
        token = strtok(nullptr, ",");
    }

    _location.satellites = sats;
    _location.hdop = hdop;
}

bool GPSManager::parseNMEALine(const char* line) {
    if (!verifyChecksum(line)) return false;

    char copy[120];
    strncpy(copy, line, sizeof(copy) - 1);
    copy[sizeof(copy) - 1] = '\0';

    if (strncmp(copy + 3, "RMC", 3) == 0) {
        parseGPRMC(copy);
        return true;
    } else if (strncmp(copy + 3, "GGA", 3) == 0) {
        parseGPGGA(copy);
        return true;
    }

    return false;
}

void GPSManager::update() {
    if (!_serial) return;

    while (_serial->available()) {
        char c = (char)_serial->read();
        if (c == '\r') continue;
        if (c == '\n') {
            _lineBuffer[_bufferIndex] = '\0';
            if (_bufferIndex > 6) {
                parseNMEALine(_lineBuffer);
            }
            _bufferIndex = 0;
        } else if (_bufferIndex < sizeof(_lineBuffer) - 1) {
            _lineBuffer[_bufferIndex++] = c;
        }
    }
}

GPSLocation GPSManager::getLocation() {
    uint32_t now = millis();
    uint32_t fixAgeMs = now - _location.fixTimestampMs;

    if (_location.hasFix && fixAgeMs < GPS_STALE_TIMEOUT_MS) {
        _location.fixState = GPS_VALID_FIX;
        return _location;
    } else if (_lastValidFix.hasFix && _lastValidFix.latitude != 0.0) {
        GPSLocation staleLoc = _lastValidFix;
        staleLoc.fixState = GPS_STALE_FIX;
        return staleLoc;
    }

    _location.fixState = GPS_NO_FIX;
    return _location;
}

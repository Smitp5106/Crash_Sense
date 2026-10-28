#ifndef CRASHSENSE_GPS_MANAGER_H
#define CRASHSENSE_GPS_MANAGER_H

#include <Arduino.h>
#include "types.h"
#include "config.h"

class GPSManager {
public:
    GPSManager();
    void begin(HardwareSerial& serialPort = Serial2, uint32_t baud = GPS_BAUD_RATE, int8_t rxPin = PIN_GPS_RX, int8_t txPin = PIN_GPS_TX);
    void update();
    GPSLocation getLocation();
    bool parseNMEALine(const char* line);

    // Mock injection for bench testing without satellites
    void injectMockLocation(double lat, double lng, uint8_t sats = 8);

private:
    HardwareSerial* _serial;
    GPSLocation _location;
    GPSLocation _lastValidFix;
    char _lineBuffer[120];
    uint8_t _bufferIndex;

    bool verifyChecksum(const char* sentence);
    void parseGPRMC(char* sentence);
    void parseGPGGA(char* sentence);
    void formatGoogleMapsUrl(double lat, double lng, char* outBuffer, size_t maxLen);
};

#endif // CRASHSENSE_GPS_MANAGER_H

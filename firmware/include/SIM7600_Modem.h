#ifndef CRASHSENSE_SIM7600_MODEM_H
#define CRASHSENSE_SIM7600_MODEM_H

#include <Arduino.h>
#include "types.h"
#include "config.h"

struct ModemDiagnostics {
    bool isPowered;
    bool isSimReady;
    bool isNetworkRegistered;
    uint8_t signalCSQ;
    uint16_t totalSmsSent;
    uint16_t totalSmsFailed;
};

class SIM7600_Modem {
public:
    SIM7600_Modem();
    bool begin(HardwareSerial& serialPort = Serial1, uint32_t baud = MODEM_BAUD_RATE, int8_t rxPin = PIN_MODEM_RX, int8_t txPin = PIN_MODEM_TX);
    bool checkAT(uint32_t timeoutMs = 1000);
    bool checkSIM();
    bool checkNetworkRegistration();
    uint8_t readSignalQuality();

    bool sendSMS(const char* recipient, const char* message, uint8_t maxRetries = MODEM_RETRY_LIMIT);
    bool initiateMockVoiceCall(const char* recipient);

    ModemDiagnostics getDiagnostics() const { return _diagnostics; }

private:
    HardwareSerial* _serial;
    ModemDiagnostics _diagnostics;

    bool sendCommand(const char* cmd, const char* expectedReply, uint32_t timeoutMs = 2000);
    String readResponse(uint32_t timeoutMs = 3000);
    void flushSerial();
};

#endif // CRASHSENSE_SIM7600_MODEM_H

#include "SIM7600_Modem.h"

SIM7600_Modem::SIM7600_Modem()
    : _serial(nullptr) {
    _diagnostics.isPowered = false;
    _diagnostics.isSimReady = false;
    _diagnostics.isNetworkRegistered = false;
    _diagnostics.signalCSQ = 0;
    _diagnostics.totalSmsSent = 0;
    _diagnostics.totalSmsFailed = 0;
}

void SIM7600_Modem::flushSerial() {
    if (!_serial) return;
    while (_serial->available()) {
        _serial->read();
    }
}

String SIM7600_Modem::readResponse(uint32_t timeoutMs) {
    if (!_serial) return "";
    String resp = "";
    uint32_t start = millis();

    while (millis() - start < timeoutMs) {
        while (_serial->available()) {
            char c = (char)_serial->read();
            resp += c;
        }
        if (resp.indexOf("OK") != -1 || resp.indexOf("ERROR") != -1 || resp.indexOf("> ") != -1) {
            break;
        }
        delay(10);
    }
    return resp;
}

bool SIM7600_Modem::sendCommand(const char* cmd, const char* expectedReply, uint32_t timeoutMs) {
    if (!_serial) return false;
    flushSerial();
    _serial->println(cmd);

    String resp = readResponse(timeoutMs);
    return (resp.indexOf(expectedReply) != -1);
}

bool SIM7600_Modem::begin(HardwareSerial& serialPort, uint32_t baud, int8_t rxPin, int8_t txPin) {
    _serial = &serialPort;
    _serial->begin(baud, SERIAL_8N1, rxPin, txPin);
    delay(500);

    // Test AT command responsiveness
    _diagnostics.isPowered = checkAT();
    if (!_diagnostics.isPowered) {
        return false;
    }

    // Disable command echo
    sendCommand("ATE0", "OK", 1000);

    // Check SIM card readiness
    _diagnostics.isSimReady = checkSIM();

    // Check Cellular network registration
    _diagnostics.isNetworkRegistered = checkNetworkRegistration();

    // Read CSQ signal strength
    _diagnostics.signalCSQ = readSignalQuality();

    // Set SMS format to Text Mode
    sendCommand("AT+CMGF=1", "OK", 1000);

    return true;
}

bool SIM7600_Modem::checkAT(uint32_t timeoutMs) {
    for (int i = 0; i < 3; i++) {
        if (sendCommand("AT", "OK", timeoutMs)) {
            _diagnostics.isPowered = true;
            return true;
        }
        delay(200);
    }
    _diagnostics.isPowered = false;
    return false;
}

bool SIM7600_Modem::checkSIM() {
    bool ready = sendCommand("AT+CPIN?", "READY", 2000);
    _diagnostics.isSimReady = ready;
    return ready;
}

bool SIM7600_Modem::checkNetworkRegistration() {
    flushSerial();
    _serial->println("AT+CREG?");
    String resp = readResponse(2000);

    // CREG: 0,1 (Home) or 0,5 (Roaming)
    bool reg = (resp.indexOf(",1") != -1 || resp.indexOf(",5") != -1);
    _diagnostics.isNetworkRegistered = reg;
    return reg;
}

uint8_t SIM7600_Modem::readSignalQuality() {
    flushSerial();
    _serial->println("AT+CSQ");
    String resp = readResponse(2000);

    int idx = resp.indexOf("+CSQ: ");
    if (idx != -1) {
        int commaIdx = resp.indexOf(',', idx);
        if (commaIdx != -1) {
            String csqStr = resp.substring(idx + 6, commaIdx);
            uint8_t csq = (uint8_t)csqStr.toInt();
            _diagnostics.signalCSQ = csq;
            return csq;
        }
    }
    return 0;
}

bool SIM7600_Modem::sendSMS(const char* recipient, const char* message, uint8_t maxRetries) {
    if (!_serial) return false;

    // Safety guard: ensure SMS text mode
    sendCommand("AT+CMGF=1", "OK", 1000);

    for (uint8_t attempt = 1; attempt <= maxRetries; attempt++) {
        flushSerial();

        // AT+CMGS="<number>"
        _serial->print("AT+CMGS=\"");
        _serial->print(recipient);
        _serial->println("\"");

        // Wait for modem prompt '> '
        String prompt = readResponse(3000);
        if (prompt.indexOf(">") == -1) {
            delay(1000);
            continue;
        }

        // Transmit message body and terminate with Ctrl+Z (0x1A)
        _serial->print(message);
        _serial->write(0x1A);

        // Await confirmation (+CMGS: <ref> and OK)
        String resp = readResponse(10000);
        if (resp.indexOf("+CMGS:") != -1 && resp.indexOf("OK") != -1) {
            _diagnostics.totalSmsSent++;
            return true;
        }

        delay(1500);
    }

    _diagnostics.totalSmsFailed++;
    return false;
}

bool SIM7600_Modem::initiateMockVoiceCall(const char* recipient) {
    if (!_serial) return false;

    // Place call
    _serial->print("ATD");
    _serial->print(recipient);
    _serial->println(";");

    delay(3000); // Ring simulation

    // Hang up call safely
    sendCommand("ATH", "OK", 2000);
    return true;
}

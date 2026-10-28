/**
 * CrashSense SIMCOM SIM7600 4G LTE Modem Engine
 *
 * Emulates the SIM7600 AT-command interface:
 * - AT, AT+CPIN?, AT+CSQ, AT+CREG?, AT+CMGF=1, AT+CMGS="..."
 * - Manages network registration (CREG), signal quality (CSQ), SIM status.
 * - Handles bounded retries, timeouts, network loss, and error recovery.
 * - Logs all AT command transactions with timestamps.
 * - Enforces safe mock dispatch (never dials actual emergency services).
 */

const EventEmitter = require('events');

class ModemEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      MODEM_RETRY_LIMIT: config.MODEM_RETRY_LIMIT ?? 3,
      MODEM_RETRY_INTERVAL_MS: config.MODEM_RETRY_INTERVAL_MS ?? 2000,
      DEFAULT_EMERGENCY_RECIPIENT: config.DEFAULT_EMERGENCY_RECIPIENT ?? "+15550192834",
      CELLULAR_OPERATOR: config.CELLULAR_OPERATOR ?? "MockTel 4G LTE",
      ...config
    };

    // Hardware State
    this.isPowered = true;
    this.simStatus = 'READY'; // 'READY', 'NOT_INSERTED', 'PIN_REQUIRED'
    this.isRegistered = true;  // Network registration (CREG 1 = Home)
    this.signalStrengthCSQ = 22; // 0-31 (22 = ~ -69 dBm, Good 4G signal)
    this.operator = this.config.CELLULAR_OPERATOR;

    // Simulation Fault Injections
    this.forceFailure = false;
    this.simulatedDelayMs = 200;

    // Transaction & Message History
    this.atLog = [];
    this.sentMessages = [];
    this.activeCalls = [];
    this.messageCounter = 100;
  }

  _logAT(cmd, response, status = 'OK') {
    const entry = {
      timestamp: Date.now(),
      cmd,
      response,
      status
    };
    this.atLog.unshift(entry);
    if (this.atLog.length > 100) this.atLog.pop();
    this.emit('at_transaction', entry);
    return entry;
  }

  setPower(powered) {
    this.isPowered = Boolean(powered);
    this._logAT(this.isPowered ? 'POWER_ON' : 'POWER_OFF', this.isPowered ? 'RDY\r\n+CPIN: READY' : 'POWER_DOWN');
    this.emit('status_changed', this.getStatus());
  }

  setRegistration(registered) {
    this.isRegistered = Boolean(registered);
    this._logAT('AT+CREG?', `+CREG: 0,${this.isRegistered ? 1 : 0}\r\nOK`);
    this.emit('status_changed', this.getStatus());
  }

  setSignalCSQ(csq) {
    this.signalStrengthCSQ = Math.max(0, Math.min(31, csq));
    this._logAT('AT+CSQ', `+CSQ: ${this.signalStrengthCSQ},99\r\nOK`);
    this.emit('status_changed', this.getStatus());
  }

  setFailureInjection(fail) {
    this.forceFailure = Boolean(fail);
    this.emit('status_changed', this.getStatus());
  }

  getStatus() {
    return {
      isPowered: this.isPowered,
      simStatus: this.simStatus,
      isRegistered: this.isRegistered,
      signalStrengthCSQ: this.signalStrengthCSQ,
      operator: this.isRegistered ? this.operator : 'NO_SERVICE',
      forceFailure: this.forceFailure,
      totalSent: this.sentMessages.length
    };
  }

  // Execute raw AT command
  executeAT(command) {
    command = (command || '').trim();
    if (!this.isPowered) {
      this._logAT(command, 'ERROR: MODEM_OFFLINE', 'ERROR');
      return { success: false, response: 'ERROR: MODEM_OFFLINE' };
    }

    if (this.forceFailure) {
      this._logAT(command, '+CMS ERROR: 500 (SIMULATED_MODEM_FAILURE)', 'ERROR');
      return { success: false, response: '+CMS ERROR: 500' };
    }

    if (command === 'AT') {
      this._logAT(command, 'OK');
      return { success: true, response: 'OK' };
    }

    if (command === 'AT+CPIN?') {
      const resp = `+CPIN: ${this.simStatus}\r\nOK`;
      this._logAT(command, resp);
      return { success: this.simStatus === 'READY', response: resp };
    }

    if (command === 'AT+CSQ') {
      const resp = `+CSQ: ${this.signalStrengthCSQ},99\r\nOK`;
      this._logAT(command, resp);
      return { success: true, response: resp };
    }

    if (command === 'AT+CREG?') {
      const resp = `+CREG: 0,${this.isRegistered ? 1 : 0}\r\nOK`;
      this._logAT(command, resp);
      return { success: this.isRegistered, response: resp };
    }

    if (command === 'AT+CMGF=1') {
      this._logAT(command, 'OK');
      return { success: true, response: 'OK' };
    }

    if (command.startsWith('AT+COPS?')) {
      const resp = `+COPS: 0,0,"${this.isRegistered ? this.operator : 'NO SERVICE'}",7\r\nOK`;
      this._logAT(command, resp);
      return { success: true, response: resp };
    }

    if (command.startsWith('ATH')) {
      this._logAT(command, 'OK');
      return { success: true, response: 'OK' };
    }

    this._logAT(command, 'OK');
    return { success: true, response: 'OK' };
  }

  // Send SMS with retry support and structured outcome
  async sendSMS(recipient, messageText, options = {}) {
    recipient = recipient || this.config.DEFAULT_EMERGENCY_RECIPIENT;
    const retryLimit = options.retryLimit ?? this.config.MODEM_RETRY_LIMIT;
    let attempt = 0;
    let lastError = null;

    while (attempt < retryLimit) {
      attempt++;
      this._logAT(`AT+CMGS="${recipient}" [Attempt ${attempt}/${retryLimit}]`, '...');

      if (this.simulatedDelayMs > 0) {
        await new Promise(res => setTimeout(res, this.simulatedDelayMs));
      }

      // Check failure conditions
      if (!this.isPowered) {
        lastError = 'MODEM_POWERED_OFF';
        this._logAT(`SMS_DISPATCH`, 'ERROR: Modem hardware is powered down', 'ERROR');
      } else if (!this.isRegistered) {
        lastError = 'NETWORK_REGISTRATION_FAILED (CREG=0)';
        this._logAT(`SMS_DISPATCH`, '+CMS ERROR: 331 (No Network Service)', 'ERROR');
      } else if (this.signalStrengthCSQ === 0 || this.signalStrengthCSQ === 99) {
        lastError = 'INSUFFICIENT_CELLULAR_SIGNAL (CSQ=0/99)';
        this._logAT(`SMS_DISPATCH`, '+CMS ERROR: 332 (Network Timeout)', 'ERROR');
      } else if (this.forceFailure) {
        lastError = 'INJECTED_MODEM_FAILURE';
        this._logAT(`SMS_DISPATCH`, '+CMS ERROR: 500 (Modem Subsystem Error)', 'ERROR');
      } else {
        // Success
        this.messageCounter++;
        const messageRecord = {
          id: `SMS_${this.messageCounter}`,
          recipient,
          messageText,
          status: 'SENT',
          referenceId: this.messageCounter,
          attempts: attempt,
          timestamp: Date.now()
        };

        this.sentMessages.unshift(messageRecord);
        this._logAT(`SMS_DELIVERED`, `+CMGS: ${this.messageCounter}\r\nOK`, 'OK');
        this.emit('sms_sent', messageRecord);
        return {
          success: true,
          status: 'SENT',
          referenceId: this.messageCounter,
          attempts: attempt,
          recipient,
          messageRecord
        };
      }

      if (attempt < retryLimit) {
        await new Promise(res => setTimeout(res, 200));
      }
    }

    // Retries exhausted
    const failRecord = {
      id: `SMS_FAIL_${Date.now()}`,
      recipient,
      messageText,
      status: 'FAILED',
      error: lastError,
      attempts: attempt,
      timestamp: Date.now()
    };

    this.sentMessages.unshift(failRecord);
    this.emit('sms_failed', failRecord);
    return {
      success: false,
      status: 'FAILED',
      error: lastError,
      attempts: attempt,
      recipient,
      messageRecord: failRecord
    };
  }

  // Simulated Voice Call Escalation
  async initiateVoiceCall(recipient) {
    recipient = recipient || this.config.DEFAULT_EMERGENCY_RECIPIENT;
    this._logAT(`ATD${recipient};`, 'DIALING...');

    if (!this.isPowered || !this.isRegistered || this.forceFailure) {
      this._logAT(`ATD${recipient};`, 'NO CARRIER', 'ERROR');
      return { success: false, status: 'NO_CARRIER', error: 'Modem offline or unregistered' };
    }

    const callRecord = {
      id: `CALL_${Date.now()}`,
      recipient,
      status: 'CONNECTED_SIMULATED',
      timestamp: Date.now(),
      note: 'Simulated voice synthesized notification (Test Mode)'
    };

    this.activeCalls.unshift(callRecord);
    this._logAT(`VOICE_ALERT`, `CONNECT 9600 [Mock automated voice message playing: CrashSense Incident Alert]`, 'OK');
    this.emit('call_placed', callRecord);

    return { success: true, status: 'CONNECTED_SIMULATED', callRecord };
  }
}

module.exports = ModemEngine;

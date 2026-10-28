# CrashSense: PC Telematics Simulator & Test Guide

**System:** CrashSense Interactive PC Simulator  
**Runtime:** Pure Standard Node.js (Zero External Dependencies)  
**Document Version:** 1.0.0  

---

## 1. Quick Start: Launching the Interactive Simulator

The CrashSense PC Simulator enables comprehensive, safe, and repeatable verification of the complete accident detection, location management, and cellular alert workflow without requiring physical microcontrollers, collision test rigs, or active SIM cards.

### Start the Simulator Server:
From the workspace root directory, run:
```powershell
npm start --prefix simulator
```
*Or directly via Node.js:*
```powershell
node simulator/server.js
```

### Access the Web Cockpit Dashboard:
Open your web browser and navigate to:
```
http://localhost:3000
```

---

## 2. Interactive Dashboard Features

```
+---------------------------------------------------------------------------------+
|  [PULSE] CrashSense Telematics   [PC SIMULATION MODE] [SSE CONNECTED] [IDLE]    |
+---------------------------------------------------------------------------------+
|  EMERGENCY BANNER: COLLISION DETECTED!   COUNTDOWN: 15s   [CANCEL FALSE ALARM]  |
+------------------------------------+--------------------------------------------+
|  6-DOF IMU (MPU-6050)              |  GNSS LOCATION (NEO-6M)                    |
|  - Accel Mag: 1.00g (Threshold 3.2)|  - Status: VALID FIX (Lat/Lng: 37.77, -122)|
|  - Ax, Ay, Az (Live dynamic bars)  |  - Map Link: https://maps.google.com/?q=...|
|  - Gyro Mag: 0.0 deg/s             |  ------------------------------------------|
|  - Roll / Pitch attitude angles    |  4G LTE CELLULAR MODEM (SIM7600)           |
|  --------------------------------- |  - Power: ON | SIM: READY | CSQ: 22        |
|  VEHICULAR SCENARIOS:              |  - Outgoing SMS Telemetry Payload Preview  |
|  [Normal] [Hard Brake] [Pothole]   |  ------------------------------------------|
|  [Sharp Turn] [Crash] [Rollover]   |  FAULT INJECTIONS: [Sensor] [GPS] [Modem]  |
+------------------------------------+--------------------------------------------+
|  SIM7600 AT COMMAND CONSOLE        |  NEARBY EMERGENCY DIRECTORY (MOCK)         |
|  > AT                              |  - SF General Hospital (0.8 km)            |
|  < OK                              |  - Metro Ambulance Dispatch (1.2 km)       |
|  > AT+CSQ                          |  ------------------------------------------|
|  < +CSQ: 22,99                     |  INCIDENT AUDIT LOG (JSONL / CSV)          |
+------------------------------------+--------------------------------------------+
```

### A. Real-Time Telematics & Gauges
- **Acceleration Magnitude ($\sqrt{a_x^2 + a_y^2 + a_z^2}$):** Displays live $g$-force with an explicit visual threshold indicator at $3.2g$.
- **Jerk Rate ($da/dt$):** Displays instantaneous acceleration derivative in $g/\text{s}$.
- **3-Axis Acceleration Bars ($a_x, a_y, a_z$):** Real-time animated bars reflecting vehicle dynamics.
- **Gyroscope Magnitude & Attitude:** Tracks rotational tumble ($\omega$) and roll/pitch tilt angles.
- **Classification Pipeline Box:** Live output from the multi-stage detection engine (`NORMAL_MOVEMENT`, `POSSIBLE_IMPACT`, `FALSE_ALARM`, `SUSPECTED_ACCIDENT`, `HIGH_SEVERITY_CANDIDATE`, `SENSOR_FAULT`).

### B. Interactive Vehicular Scenarios
Click any scenario button to inject synthetic physical dynamics:
- 🚗 **Normal Driving:** Gentle road vibrations ($0.95g - 1.05g$, low gyro). System remains `IDLE`.
- 🛑 **Hard Braking:** Longitudinal deceleration ($-1.55g$), pitch nose dip, low gyro. Dismissed without false alarm.
- 🕳️ **Bump / Pothole:** Vertical transient impulse ($+2.45g$, $< 110\text{ms}$), driving resumes. Classified and dismissed as `FALSE_ALARM`.
- 🔄 **Sharp Turn:** Lateral centripetal acceleration ($1.25g$), high yaw rate ($75^\circ/\text{s}$). Dismissed without false alarm.
- 💥 **Severe Crash:** Extreme multi-axis collision shock ($> 4.5g$), high jerk ($> 25g/\text{s}$), rotational tumble ($> 200^\circ/\text{s}$), followed by post-impact halt. Triggers **Suspected Accident** and starts cancellation countdown.
- 🔁 **Rollover Crash:** Extreme roll tumble ($> 300^\circ/\text{s}$) with sustained $80^\circ$ attitude roll. Confirmed as **High-Severity Rollover**.

### C. Web Audio Piezo Buzzer & Driver Cancellation
- When in `COUNTDOWN` state, the dashboard automatically activates the Web Audio API synthesizer, generating realistic $2600\text{Hz}$ piezo warning beeps.
- Clicking the large red **CANCEL FALSE ALARM** button halts the countdown, silences the buzzer, transitions the state to `CANCELLED`, and logs the event reason.
- An audio mute toggle (`🔊 Buzzer: ON / 🔇 MUTED`) is provided in the top header.

### D. Fault & Environmental Injections
Test robustness under adverse conditions:
- **MPU6050 I2C Disconnect:** Simulates detached sensor wiring. System enters `SENSOR_FAULT` without false crash detection.
- **GPS No Fix / Loss:** Simulates tunnel or parking structure. Emergency SMS states `GPS: NO_FIX (Searching satellites)`.
- **Simulate Stale GPS Fix (>120s):** Forces location age to $150\text{s}$. Emergency SMS explicitly labels location as `LAST KNOWN Loc (STALE)`.
- **Modem Power / Coverage Loss:** Simulates unpowered SIM7600 or loss of cell tower registration (`CREG: 0`).
- **Inject Modem Error (+CMS 500):** Simulates network transmission rejection. Verifies bounded retries and failure logging.
- **Reset System Baseline:** Restores all sensors and modems to clean operational defaults.

### E. Interactive AT Terminal Console
- Displays live bidirectional AT command transactions between the telematics controller and the modem emulator (`AT`, `AT+CPIN?`, `AT+CREG?`, `AT+CSQ`, `AT+CMGS`).
- Allows entering custom AT commands directly in the input bar.

---

## 3. Running the Automated Scenario Test Suite

The simulator includes an automated test runner verifying all 17 mandatory telematics scenarios.

Execute the test suite via:
```powershell
node simulator/tests/runner.js
```
*Or via npm:*
```powershell
npm test --prefix simulator
```

### Expected Output:
```
================================================================
     CrashSense Telematics Automated Scenario Test Suite       
================================================================
Target: Embedded Collision Detection, GNSS, SIM7600 & Alert Engine

  [PASS] Scenario 1: Normal Movement -> No accident alert
  [PASS] Scenario 2: Sudden Braking -> Candidate evaluated; no automatic assumption of a crash
  [PASS] Scenario 3: Pothole or Bump -> False-alarm logic evaluated
  [PASS] Scenario 4: Sharp Turn -> No automatic crash classification from tilt alone
  [PASS] Scenario 5: Simulated Severe Impact -> Candidate detection and countdown begin
  [PASS] Scenario 6: Button Pressed During Countdown -> Alert cancelled and logged
  [PASS] Scenario 7: Countdown Expires -> Alert workflow starts and dispatches
  [PASS] Scenario 8: GPS Has No Fix -> Alert reports unavailable location
  [PASS] Scenario 9: GPS Fix is Stale -> Location clearly marked stale
  [PASS] Scenario 10: Modem Unavailable -> Failure recorded; retry or fallback policy applied
  [PASS] Scenario 11: SMS Succeeds -> Message status recorded as successful
  [PASS] Scenario 12: SMS Fails -> Failure and retry behavior recorded
  [PASS] Scenario 13: Repeated Trigger -> Duplicate alert prevention works
  [PASS] Scenario 14: Restart During Incident -> State recovery follows documented behavior
  [PASS] Scenario 15: Network Returns -> Recovery proceeds without duplicate alerts
  [PASS] Scenario 16: Sensor Disconnected -> Fault is reported; no false claim of crash detection
  [PASS] Scenario 17: Emergency Service Lookup -> Discovers verified facilities safely

----------------------------------------------------------------
Results: 17 Passed, 0 Failed out of 17 Scenarios
Total Execution Time: ~21s
================================================================
```

---

## 4. Persistent Logging & Audit Trail

Incident events and telemetry snapshots are automatically persisted to disk:
1. **JSON Lines (`simulator/logs/incidents.jsonl`):** Full structured telemetry objects, including peak magnitude, jerk, gyro rates, GPS fix state, coordinates, cancellation reason, and SMS delivery outcomes.
2. **CSV Format (`simulator/logs/incidents.csv`):** Tabular format suitable for importing directly into Microsoft Excel, Python Pandas, or MATLAB for statistical telematics analysis.

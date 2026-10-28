# CrashSense: Comprehensive Telematics Test Report

**Project Title:** CrashSense — Intelligent Accident Detection, Location Tracking, and Emergency Alert System  
**Test Suite:** Automated Telematics Scenario Verification Harness  
**Execution Date:** October 28, 2026  
**Execution Environment:** Node.js v24.11.1 / Windows 64-bit  
**Total Scenarios Verified:** 17  
**Pass Count:** 17 (100%)  
**Fail Count:** 0 (0%)  
**Overall Verdict:** **VERIFIED & OPERATIONAL**  

---

## 1. Executive Summary

This report documents the verification of **CrashSense** across 17 mandatory telematics, kinematic, sensor integrity, and communication failure scenarios. All tests were executed deterministically through the automated scenario test runner (`simulator/tests/runner.js`), testing sensor simulation, multi-stage collision classification, driver cancellation, GNSS fix tracking, SIM7600 AT command emulation, bounded retry policies, and emergency facility lookup.

---

## 2. Test Execution Matrix (Section 7 Requirements)

| Test ID | Scenario Description | Tested Conditions | Expected Behavior | Actual Observed Outcome | Duration | Verdict |
|---|---|---|---|---|---|---|
| **SCN-01** | **Normal Movement** | $a_{\text{mag}} \approx 1.0g$, $\omega < 5^\circ/\text{s}$ | State remains `IDLE`. No alert or buzzer. | State remained `IDLE`; buzzer remained OFF; zero incidents generated. | $153\text{ ms}$ | **PASS** |
| **SCN-02** | **Sudden Braking** | $a_x \approx -1.55g$, $\omega < 20^\circ/\text{s}$ | Candidate evaluated; no automatic assumption of crash. | Classified as non-crash; no countdown triggered; state held `IDLE`. | $467\text{ ms}$ | **PASS** |
| **SCN-03** | **Pothole or Bump** | $a_z \approx 2.45g$ ($< 110\text{ms}$), driving continues | Evaluated as false alarm; dismissed. | Transient impulse detected and dismissed as `FALSE_ALARM`. | $311\text{ ms}$ | **PASS** |
| **SCN-04** | **Sharp Turn** | $a_y \approx 1.25g$, $\omega_z \approx 75^\circ/\text{s}$ | No automatic crash classification from tilt alone. | Turn dynamics evaluated; remained within safe envelope (`NORMAL_MOVEMENT`). | $249\text{ ms}$ | **PASS** |
| **SCN-05** | **Simulated Severe Impact** | $a > 4.2g$, Jerk $> 25g/\text{s}$, $\omega > 200^\circ/\text{s}$ | Candidate confirmed; countdown and buzzer begin. | Collision confirmed; transitioned to `COUNTDOWN`; buzzer activated. | $338\text{ ms}$ | **PASS** |
| **SCN-06** | **Button Pressed in Countdown** | Driver clicks cancel button during active countdown | Alert cancelled; reason recorded; buzzer silenced. | State transitioned to `CANCELLED`; buzzer stopped; reason logged in memory. | $323\text{ ms}$ | **PASS** |
| **SCN-07** | **Countdown Expires** | No cancellation within timeout | State $\to$ `ALERT_PENDING` $\to$ `SENDING` $\to$ `SENT`. | Countdown reached zero; SMS dispatched via modem; state marked `SENT`. | $2647\text{ ms}$ | **PASS** |
| **SCN-08** | **GPS Has No Fix** | 0 satellites acquired ($GPGGA status 0) | Explicit `GPS: NO_FIX` reported. No fabricated coords. | Dispatched SMS explicitly states `GPS: NO_FIX`; no `0,0` map link generated. | $2635\text{ ms}$ | **PASS** |
| **SCN-09** | **GPS Fix is Stale** | Fix age $= 150\text{ s}$ ($> 60\text{ s}$ threshold) | Location clearly marked `STALE` with age stamp. | Dispatched SMS states `LAST KNOWN Loc (STALE, Age: 150s)`. | $2633\text{ ms}$ | **PASS** |
| **SCN-10** | **Modem Unavailable** | Modem hardware powered off (`isPowered = false`) | Failure recorded; retry/fallback applied; state `FAILED`. | Modem offline detected; retries bounded; incident logged as `FAILED`. | $2637\text{ ms}$ | **PASS** |
| **SCN-11** | **SMS Succeeds** | Modem returns `+CMGS: <ref>` and `OK` | SMS status marked `SENT`; reference ID logged. | Status marked `SENT`; reference ID stored; incident persisted. | $2627\text{ ms}$ | **PASS** |
| **SCN-12** | **SMS Fails** | Injected `+CMS ERROR: 500` network failure | Failure and retry behavior recorded. | Retried up to limit; marked `FAILED`; error logged to audit trail. | $2840\text{ ms}$ | **PASS** |
| **SCN-13** | **Repeated Trigger** | Continuous high vibration after collision | Deduplication cooldown prevents duplicate alerts. | Immediate subsequent collision trigger suppressed by cooldown logic. | $744\text{ ms}$ | **PASS** |
| **SCN-14** | **Restart During Incident** | Abrupt system reset during countdown | Clean state recovery to baseline; logs reset anomaly. | System cleanly recovered to `IDLE`; active incident cleared; buzzer muted. | $326\text{ ms}$ | **PASS** |
| **SCN-15** | **Network Returns** | Temporary coverage loss restored | Alert transmits cleanly without duplicates. | After registration restored, system safely returned to clean monitoring. | $2898\text{ ms}$ | **PASS** |
| **SCN-16** | **Sensor Disconnected** | I2C read returns bus error / NaN | Fault reported; no false claim of accident detection. | System transitioned to `SENSOR_FAULT`; no false collision triggered. | $1\text{ ms}$ | **PASS** |
| **SCN-17** | **Emergency Service Lookup** | Valid GPS location provided | Discovers verified facilities safely without auto-dialing. | Resolved nearby hospitals and ambulance providers with distances and contacts. | $0\text{ ms}$ | **PASS** |

---

## 3. Telemetry Payload Verification

During scenario verification, the generated emergency cellular payloads were inspected:

### Case A: Valid GNSS Fix Payload
```
CRASHSENSE ALERT!
ID:INC-20261028-1001
Sev:HIGH
Peak:4.5g
Loc: 37.77493, -122.41942
Map: https://maps.google.com/?q=37.774929,-122.419416
Driver unresp.
```
*Verification:* Valid decimal degree formatting, valid Google Maps link, correct incident ID, and high severity classification.

### Case B: Obstructed GNSS (Tunnel / Garage) Payload
```
CRASHSENSE ALERT!
ID:INC-20261028-1002
Sev:HIGH
Peak:4.2g
GPS: NO_FIX (Searching satellites)
Driver unresp.
```
*Verification:* Explicit `NO_FIX` status indicator. No fabricated coordinates (`0.000000, 0.000000`) and no invalid map links.

### Case C: Stale GNSS Fix Payload
```
CRASHSENSE ALERT!
ID:INC-20261028-1003
Sev:HIGH
Peak:4.8g
LAST KNOWN Loc: 37.77493, -122.41942 (STALE, Age: 150s)
Map: https://maps.google.com/?q=37.774929,-122.419416
Driver unresp.
```
*Verification:* Explicit `LAST KNOWN` labeling with elapsed age in seconds ($150\text{s}$), preventing emergency dispatchers from confusing an old position with current real-time coordinates.

---

## 4. Limitations & Engineering Disclaimers

> [!WARNING]
> **PROTOTYPE VALIDATION BOUNDARIES:**
> 1. **Synthetic vs Real Crash Dynamics:** Synthetic kinematic tests model ideal collision profiles. Real-world automotive crashes exhibit non-linear structural crumple dynamics, complex multi-axis vibrations, and chassis resonances that require calibration in actual vehicle chassis.
> 2. **Emergency Calling Interlocks:** Automated dialing of public emergency services (911/112/999) is strictly blocked in both firmware and simulator. Outgoing communications are restricted to pre-approved test numbers and mock consoles.
> 3. **Non-Certified Prototype:** This prototype is an engineering research proof-of-concept and does not hold ISO 26262 functional safety or automotive OEM certification.

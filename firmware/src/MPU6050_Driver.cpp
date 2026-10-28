#include "MPU6050_Driver.h"

// MPU-6050 Register Map
#define REG_SMPLRT_DIV      0x19
#define REG_CONFIG          0x1A
#define REG_GYRO_CONFIG     0x1B
#define REG_ACCEL_CONFIG    0x1C
#define REG_ACCEL_XOUT_H    0x3B
#define REG_PWR_MGMT_1      0x6B
#define REG_WHO_AM_I        0x75

MPU6050_Driver::MPU6050_Driver()
    : _i2cAddr(MPU6050_I2C_ADDR),
      _connected(false),
      _accelScale(4096.0f),   // Default +-8g -> 4096 LSB/g
      _gyroScale(16.4f),      // Default +-2000 deg/s -> 16.4 LSB/(deg/s)
      _offsetAx(0.0f), _offsetAy(0.0f), _offsetAz(0.0f),
      _offsetGx(0.0f), _offsetGy(0.0f), _offsetGz(0.0f),
      _lastMagnitude(1.0f),
      _lastTimestampMs(0) {}

bool MPU6050_Driver::writeRegister(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(_i2cAddr);
    Wire.write(reg);
    Wire.write(val);
    return (Wire.endTransmission() == 0);
}

bool MPU6050_Driver::readRegisters(uint8_t startReg, uint8_t count, uint8_t* buffer) {
    Wire.beginTransmission(_i2cAddr);
    Wire.write(startReg);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    uint8_t readCount = Wire.requestFrom(_i2cAddr, count);
    if (readCount != count) {
        return false;
    }
    for (uint8_t i = 0; i < count; i++) {
        buffer[i] = Wire.read();
    }
    return true;
}

bool MPU6050_Driver::begin(uint8_t sdaPin, uint8_t sclPin, uint32_t frequency) {
    Wire.begin(sdaPin, sclPin, frequency);
    delay(50);

    // Read WHO_AM_I register (should return 0x68)
    uint8_t whoAmI = 0;
    if (!readRegisters(REG_WHO_AM_I, 1, &whoAmI)) {
        _connected = false;
        return false;
    }

    if (whoAmI != 0x68 && whoAmI != 0x70 && whoAmI != 0x72) {
        // Unknown chip ID
        _connected = false;
        return false;
    }

    // Wake up MPU-6050 (clear sleep bit in PWR_MGMT_1)
    if (!writeRegister(REG_PWR_MGMT_1, 0x01)) { // Auto select PLL with X axis gyroscope reference
        _connected = false;
        return false;
    }
    delay(20);

    // Set sample rate divider to 7 (1kHz / (1 + 7) = 125Hz)
    writeRegister(REG_SMPLRT_DIV, 0x07);

    // Digital Low Pass Filter (DLPF): 44Hz bandwidth
    writeRegister(REG_CONFIG, 0x03);

    // Set Accelerometer to +-8g (AFS_SEL = 2 -> 0x10)
    writeRegister(REG_ACCEL_CONFIG, 0x10);
    _accelScale = 4096.0f;

    // Set Gyroscope to +-2000 deg/s (FS_SEL = 3 -> 0x18)
    writeRegister(REG_GYRO_CONFIG, 0x18);
    _gyroScale = 16.4f;

    _connected = true;
    _lastTimestampMs = millis();
    return true;
}

bool MPU6050_Driver::calibrate(uint16_t sampleCount) {
    if (!_connected) return false;

    float sumAx = 0, sumAy = 0, sumAz = 0;
    float sumGx = 0, sumGy = 0, sumGz = 0;

    for (uint16_t i = 0; i < sampleCount; i++) {
        uint8_t buf[14];
        if (!readRegisters(REG_ACCEL_XOUT_H, 14, buf)) {
            return false;
        }

        int16_t rawAx = (int16_t)((buf[0] << 8) | buf[1]);
        int16_t rawAy = (int16_t)((buf[2] << 8) | buf[3]);
        int16_t rawAz = (int16_t)((buf[4] << 8) | buf[5]);
        int16_t rawGx = (int16_t)((buf[8] << 8) | buf[9]);
        int16_t rawGy = (int16_t)((buf[10] << 8) | buf[11]);
        int16_t rawGz = (int16_t)((buf[12] << 8) | buf[13]);

        sumAx += (float)rawAx / _accelScale;
        sumAy += (float)rawAy / _accelScale;
        sumAz += (float)rawAz / _accelScale;
        sumGx += (float)rawGx / _gyroScale;
        sumGy += (float)rawGy / _gyroScale;
        sumGz += (float)rawGz / _gyroScale;

        delay(5);
    }

    _offsetAx = sumAx / sampleCount;
    _offsetAy = sumAy / sampleCount;
    // Expected gravity on Z is 1.0g when level
    _offsetAz = (sumAz / sampleCount) - 1.0f;

    _offsetGx = sumGx / sampleCount;
    _offsetGy = sumGy / sampleCount;
    _offsetGz = sumGz / sampleCount;

    return true;
}

bool MPU6050_Driver::readSensor(SensorFrame& frame) {
    uint32_t now = millis();
    float dt = (now - _lastTimestampMs) / 1000.0f;
    if (dt <= 0.0001f) dt = 0.001f;
    _lastTimestampMs = now;

    frame.timestampMs = now;

    if (!_connected) {
        frame.isValid = false;
        frame.ax = frame.ay = frame.az = NAN;
        frame.gx = frame.gy = frame.gz = NAN;
        frame.magnitude = frame.jerk = frame.gyroMagnitude = NAN;
        frame.pitch = frame.roll = NAN;
        return false;
    }

    uint8_t buf[14];
    if (!readRegisters(REG_ACCEL_XOUT_H, 14, buf)) {
        _connected = false;
        frame.isValid = false;
        return false;
    }

    int16_t rawAx = (int16_t)((buf[0] << 8) | buf[1]);
    int16_t rawAy = (int16_t)((buf[2] << 8) | buf[3]);
    int16_t rawAz = (int16_t)((buf[4] << 8) | buf[5]);
    int16_t rawGx = (int16_t)((buf[8] << 8) | buf[9]);
    int16_t rawGy = (int16_t)((buf[10] << 8) | buf[11]);
    int16_t rawGz = (int16_t)((buf[12] << 8) | buf[13]);

    frame.isValid = true;
    frame.ax = ((float)rawAx / _accelScale) - _offsetAx;
    frame.ay = ((float)rawAy / _accelScale) - _offsetAy;
    frame.az = ((float)rawAz / _accelScale) - _offsetAz;

    frame.gx = ((float)rawGx / _gyroScale) - _offsetGx;
    frame.gy = ((float)rawGy / _gyroScale) - _offsetGy;
    frame.gz = ((float)rawGz / _gyroScale) - _offsetGz;

    // Magnitude: sqrt(ax^2 + ay^2 + az^2)
    frame.magnitude = sqrtf(frame.ax * frame.ax + frame.ay * frame.ay + frame.az * frame.az);

    // Jerk: |delta_mag| / dt
    frame.jerk = fabsf(frame.magnitude - _lastMagnitude) / dt;
    _lastMagnitude = frame.magnitude;

    // Gyro Magnitude: sqrt(gx^2 + gy^2 + gz^2)
    frame.gyroMagnitude = sqrtf(frame.gx * frame.gx + frame.gy * frame.gy + frame.gz * frame.gz);

    // Pitch & Roll attitude in degrees
    frame.pitch = atan2f(frame.ax, sqrtf(frame.ay * frame.ay + frame.az * frame.az)) * (180.0f / PI);
    frame.roll  = atan2f(frame.ay, sqrtf(frame.ax * frame.ax + frame.az * frame.az)) * (180.0f / PI);

    return true;
}

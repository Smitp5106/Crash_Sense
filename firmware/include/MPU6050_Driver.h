#ifndef CRASHSENSE_MPU6050_DRIVER_H
#define CRASHSENSE_MPU6050_DRIVER_H

#include <Arduino.h>
#include <Wire.h>
#include "types.h"
#include "config.h"

class MPU6050_Driver {
public:
    MPU6050_Driver();
    bool begin(uint8_t sdaPin = PIN_I2C_SDA, uint8_t sclPin = PIN_I2C_SCL, uint32_t frequency = 400000);
    bool calibrate(uint16_t sampleCount = 100);
    bool readSensor(SensorFrame& frame);
    bool isConnected() const { return _connected; }

private:
    uint8_t _i2cAddr;
    bool _connected;
    float _accelScale; // LSB per g
    float _gyroScale;  // LSB per deg/s

    // Offsets
    float _offsetAx;
    float _offsetAy;
    float _offsetAz;
    float _offsetGx;
    float _offsetGy;
    float _offsetGz;

    float _lastMagnitude;
    uint32_t _lastTimestampMs;

    bool writeRegister(uint8_t reg, uint8_t val);
    bool readRegisters(uint8_t startReg, uint8_t count, uint8_t* buffer);
};

#endif // CRASHSENSE_MPU6050_DRIVER_H

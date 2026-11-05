/**
 * CrashSense Nearby Emergency Service Directory Lookup
 *
 * Implements a mock local registry and safe dispatch resolver:
 * - Discovers nearby hospitals, trauma centers, and private ambulance dispatch units based on coordinates.
 * - Distinguishes healthcare facilities from ambulance dispatchers.
 * - Never dials or contacts real public emergency numbers (911/112).
 * - Requires explicit user approval/configuration before escalation.
 */

class EmergencyLookup {
  constructor() {
    // Verified curated test database of mock/regional services
    this.facilityDatabase = [
      {
        id: 'FAC_SF_01',
        name: 'Zuckerberg San Francisco General Hospital & Trauma Center',
        type: 'HOSPITAL_TRAUMA_LEVEL_1',
        address: '1001 Potrero Ave, San Francisco, CA 94110',
        contact: '+1-555-019-8801', // Mock safe test contact
        lat: 37.7557,
        lng: -122.4045,
        emergencyReady: true,
        source: 'Curated Verified Directory'
      },
      {
        id: 'FAC_SF_02',
        name: 'UCSF Medical Center at Mission Bay',
        type: 'HOSPITAL_EMERGENCY_DEPT',
        address: '1825 4th St, San Francisco, CA 94158',
        contact: '+1-555-019-8802',
        lat: 37.7684,
        lng: -122.3916,
        emergencyReady: true,
        source: 'Curated Verified Directory'
      },
      {
        id: 'DISP_AMB_01',
        name: 'Metro Regional Ambulance Dispatch (Mock Private Fleet)',
        type: 'AMBULANCE_DISPATCH_PROVIDER',
        address: 'San Francisco Regional Dispatch Center',
        contact: '+1-555-019-8899',
        lat: 37.7700,
        lng: -122.4100,
        emergencyReady: true,
        source: 'Commercial Telematics Fleet Directory'
      }
    ];
  }

  // Calculate distance in kilometers using Haversine formula
  _haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  lookupNearby(lat, lng, options = {}) {
    const maxRadiusKm = options.maxRadiusKm || 25.0;

    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return {
        success: false,
        error: 'INVALID_COORDINATES',
        message: 'Coordinates required for emergency service lookup.',
        results: []
      };
    }

    const matched = this.facilityDatabase.map(fac => {
      const distanceKm = this._haversineKm(lat, lng, fac.lat, fac.lng);
      return {
        ...fac,
        distanceKm: Number(distanceKm.toFixed(2))
      };
    }).filter(fac => fac.distanceKm <= maxRadiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return {
      success: true,
      queryLocation: { lat, lng },
      retrievalTimestamp: new Date().toISOString(),
      source: 'Verified Local Directory & Mock Regional Telematics Cache',
      totalFound: matched.length,
      requiresApprovalBeforeContact: true,
      disclaimer: 'Development Mode: Safe mock contact numbers. Never contacts real emergency services automatically.',
      results: matched
    };
  }
}

module.exports = EmergencyLookup;


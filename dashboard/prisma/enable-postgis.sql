-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify PostGIS installation
SELECT PostGIS_version();

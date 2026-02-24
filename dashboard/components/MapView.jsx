'use client';

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import L from 'leaflet';

// Fix for default markers in Next.js
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom icons for different location types
const createCustomIcon = (color) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: 25px; height: 25px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });
};

const locationTypeIcons = {
  SINGLE: createCustomIcon('#3B82F6'), // blue
  LISTED: createCustomIcon('#10B981'), // green
  CHAIN: createCustomIcon('#8B5CF6'), // purple
  ONLINE: createCustomIcon('#F59E0B'), // orange
  default: createCustomIcon('#6B7280'), // gray
};

export default function MapView({ locations }) {
  const [selectedBanks, setSelectedBanks] = useState([]);
  const [filteredLocations, setFilteredLocations] = useState(locations);

  // Get unique banks
  const banks = [...new Set(locations.map(loc => loc.bank).filter(Boolean))];

  useEffect(() => {
    if (selectedBanks.length === 0) {
      setFilteredLocations(locations);
    } else {
      setFilteredLocations(
        locations.filter(loc => selectedBanks.includes(loc.bank))
      );
    }
  }, [selectedBanks, locations]);

  const toggleBank = (bank) => {
    setSelectedBanks(prev =>
      prev.includes(bank)
        ? prev.filter(b => b !== bank)
        : [...prev, bank]
    );
  };

  // Calculate center of all locations
  const center = filteredLocations.length > 0
    ? [
        filteredLocations.reduce((sum, loc) => sum + (loc.latitude || 0), 0) / filteredLocations.length,
        filteredLocations.reduce((sum, loc) => sum + (loc.longitude || 0), 0) / filteredLocations.length
      ]
    : [7.8731, 80.7718]; // Sri Lanka center

  return (
    <div>
      {/* Filters and Legend */}
      <div className="p-4 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-900">Filter by Bank</h3>
          <div className="text-xs text-slate-600">
            {filteredLocations.length} of {locations.length} locations
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {banks.map(bank => (
            <button
              key={bank}
              onClick={() => toggleBank(bank)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedBanks.includes(bank) || selectedBanks.length === 0
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {bank}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="pt-3 border-t border-slate-200">
          <div className="flex flex-wrap gap-4">
            <LegendItem color="#3B82F6" label="Single Location" />
            <LegendItem color="#10B981" label="Listed Branches" />
            <LegendItem color="#8B5CF6" label="Chain/Island-wide" />
            <LegendItem color="#F59E0B" label="Online Only" />
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="h-[600px]">
        <MapContainer
          center={center}
          zoom={8}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MarkerClusterGroup>
            {filteredLocations.map((location, index) => {
              if (!location.latitude || !location.longitude) return null;

              const icon = locationTypeIcons[location.locationType] || locationTypeIcons.default;

              return (
                <Marker
                  key={index}
                  position={[location.latitude, location.longitude]}
                  icon={icon}
                >
                  <Popup>
                    <div className="p-2">
                      <h3 className="font-semibold text-slate-900">{location.merchant || 'Unknown Merchant'}</h3>
                      <p className="text-sm text-slate-600 mt-1">{location.discount || 'No discount info'}</p>
                      <p className="text-xs text-slate-500 mt-1">{location.address || 'No address'}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="inline-block px-2 py-1 text-xs font-medium text-slate-700">
                          {location.bank}
                        </span>
                        <span className="inline-block px-2 py-1 text-xs text-slate-600">
                          {location.locationType}
                        </span>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        </MapContainer>
      </div>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-3 h-3 rounded-full border-2 border-white shadow-sm"
        style={{ backgroundColor: color }}
      ></div>
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}

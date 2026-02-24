import dynamicImport from 'next/dynamic';
import { loadGeoData } from '@/lib/data';

// Import MapView dynamically to avoid SSR issues with Leaflet
const MapView = dynamicImport(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[600px] bg-slate-50 rounded-lg border border-slate-200">
      <p className="text-sm text-slate-500">Loading map...</p>
    </div>
  )
});

export const dynamic = 'force-dynamic';

export default function MapPage() {
  const geoData = loadGeoData();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Map View</h1>
        <p className="text-sm text-slate-600 mt-1">View all geocoded offer locations</p>
      </div>

      {/* Map Container */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {geoData.length === 0 ? (
          <div className="flex items-center justify-center h-[600px] bg-slate-50">
            <div className="text-center">
              <p className="text-sm text-slate-600 mb-1">No geocoded locations found</p>
              <p className="text-xs text-slate-500">Run the geocoding process to populate the map</p>
            </div>
          </div>
        ) : (
          <MapView locations={geoData} />
        )}
      </div>
    </div>
  );
}

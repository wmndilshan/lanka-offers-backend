
'use client';
import { useState, useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import Link from 'next/link';

// Fix Leaflet icon issue in Next.js
const icon = L.icon({
    iconUrl: '/images/marker-icon.png',
    shadowUrl: '/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

// Helper to get custom icon based on bank
const getBankIcon = (bank) => {
    // We can return different colored markers here if we had custom images
    // For now returning default
    return icon;
};

export default function OfferMap() {
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Custom fix for Leaflet icons
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        });

        fetchLocations();
    }, []);

    const fetchLocations = async () => {
        try {
            // We need a specialized endpoint for map data to key payload small
            // For now, let's use the offers endpoint with large limit and select specific fields
            // Or better create a new route /api/locations
            // Let's assume we use /api/offers but extracting locations client side for this demo
            // OPTIMIZATION: In production, create /api/locations to return ONLY geojson

            const res = await fetch('/api/offers?limit=1000');
            const data = await res.json();

            // Flatten locations
            const allLocs = data.offers.flatMap(offer =>
                offer.locations.map(loc => ({
                    ...loc,
                    offerTitle: offer.title,
                    offerId: offer.id,
                    merchant: offer.merchantName,
                    category: offer.category,
                    source: offer.source,
                    status: offer.reviewStatus
                }))
            );

            setLocations(allLocs);
        } catch (error) {
            console.error('Failed to fetch map data:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="h-96 flex items-center justify-center bg-gray-100 rounded-lg">Loading Map...</div>;

    return (
        <div className="h-[calc(100vh-200px)] w-full rounded-lg overflow-hidden border shadow-inner">
            <MapContainer
                center={[7.8731, 80.7718]} // Sri Lanka center
                zoom={8}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MarkerClusterGroup chunkedLoading>
                    {locations.map((loc) => (
                        loc.latitude && loc.longitude ? (
                            <Marker
                                key={loc.id}
                                position={[loc.latitude, loc.longitude]}
                            >
                                <Popup>
                                    <div className="min-w-[200px]">
                                        <h3 className="font-bold text-sm">{loc.merchant}</h3>
                                        <p className="text-xs text-gray-600 mb-2">{loc.offerTitle}</p>
                                        <div className="flex gap-1 justify-between items-center mt-2">
                                            <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">{loc.source}</span>
                                            {loc.status && (
                                                <span className={`text-xs px-1.5 py-0.5 rounded ${loc.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                        loc.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                                                    }`}>
                                                    {loc.status.toUpperCase()}
                                                </span>
                                            )}
                                            <Link href={`/admin/offers/${loc.offerId}`} className="text-blue-600 text-xs hover:underline">
                                                View Offer &rarr;
                                            </Link>
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        ) : null
                    ))}
                </MarkerClusterGroup>
            </MapContainer>
        </div>
    );
}

import React, { useEffect, useRef, useState } from 'react';
import ErrorBoundary from './ErrorBoundary';

const GoogleMapsHotspot = ({ ownerId, hotspots = [] }) => {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [error, setError] = useState(null);

  // Ensure hotspots is always an array and handle potential errors
  const safeHotspots = React.useMemo(() => {
    try {
      return Array.isArray(hotspots) ? hotspots : [];
    } catch (err) {
      console.warn('Error processing hotspots data:', err);
      return [];
    }
  }, [hotspots]);

  useEffect(() => {
    // Load Google Maps API
    const loadGoogleMaps = () => {
      if (window.google && window.google.maps) {
        initializeMap();
        return;
      }

      const script = document.createElement('script');
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        setError('Google Maps API key not configured. Please add VITE_GOOGLE_MAPS_API_KEY to your .env file');
        return;
      }
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initializeMap;
      script.onerror = () => setError('Failed to load Google Maps');
      document.head.appendChild(script);
    };

    const initializeMap = () => {
      if (!mapRef.current) return;

      try {
        const mapInstance = new window.google.maps.Map(mapRef.current, {
          zoom: 12,
          center: { lat: 0.3476, lng: 32.5825 }, // Kampala, Uganda coordinates
          mapTypeId: 'roadmap',
          styles: [
            {
              featureType: 'poi',
              elementType: 'labels',
              stylers: [{ visibility: 'off' }]
            }
          ],
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true
        });

        setMap(mapInstance);
        addMarkers(mapInstance);
      } catch (err) {
        setError('Failed to initialize map');
        console.error('Map initialization error:', err);
      }
    };

    const addMarkers = (mapInstance) => {
      const newMarkers = [];
      
      safeHotspots.forEach((hotspot, index) => {
        if (hotspot.latitude && hotspot.longitude) {
          const marker = new window.google.maps.Marker({
            position: {
              lat: parseFloat(hotspot.latitude),
              lng: parseFloat(hotspot.longitude)
            },
            map: mapInstance,
            title: hotspot.name || hotspot.hotspotName || `Hotspot ${index + 1}`,
            icon: {
              url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
                <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="20" cy="20" r="18" fill="#10b981" stroke="#ffffff" stroke-width="3"/>
                  <text x="20" y="26" text-anchor="middle" fill="white" font-family="Arial" font-size="16" font-weight="bold">📶</text>
                </svg>
              `)}`,
              scaledSize: new window.google.maps.Size(40, 40),
              anchor: new window.google.maps.Point(20, 20)
            },
            animation: window.google.maps.Animation.DROP
          });

          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="
                padding: 16px; 
                min-width: 220px; 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #ffffff;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
              ">
                <h3 style="
                  margin: 0 0 12px 0; 
                  color: #1f2937; 
                  font-size: 16px; 
                  font-weight: 600;
                  line-height: 1.4;
                ">
                  ${hotspot.name || hotspot.hotspotName || `Hotspot ${index + 1}`}
                </h3>
                <div style="margin-bottom: 8px;">
                  <span style="
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                    background: ${hotspot.status === 'online' ? '#dcfce7' : '#fef2f2'};
                    color: ${hotspot.status === 'online' ? '#166534' : '#991b1b'};
                  ">
                    ${hotspot.status === 'online' ? '🟢 Online' : '🔴 Offline'}
                  </span>
                </div>
                <p style="
                  margin: 0 0 6px 0; 
                  color: #4b5563; 
                  font-size: 13px;
                  line-height: 1.4;
                ">
                  <strong style="color: #374151;">📍 Location:</strong><br/>
                  ${hotspot.address || 'Location not specified'}
                </p>
                <p style="
                  margin: 0; 
                  color: #6b7280; 
                  font-size: 12px;
                  font-family: 'Monaco', 'Menlo', monospace;
                  background: #f9fafb;
                  padding: 4px 6px;
                  border-radius: 4px;
                ">
                  ${hotspot.latitude}, ${hotspot.longitude}
                </p>
              </div>
            `
          });

          marker.addListener('click', () => {
            infoWindow.open(mapInstance, marker);
          });

          newMarkers.push(marker);
        }
      });

      setMarkers(newMarkers);

      // Fit map to show all markers
      if (newMarkers.length > 0) {
        const bounds = new window.google.maps.LatLngBounds();
        newMarkers.forEach(marker => bounds.extend(marker.getPosition()));
        mapInstance.fitBounds(bounds);
      }
    };

    loadGoogleMaps();

    return () => {
      // Cleanup markers
      markers.forEach(marker => marker.setMap(null));
    };
  }, [safeHotspots, ownerId]);

  if (error) {
    return (
      <div style={{ 
        height: 420, 
        borderRadius: '0 0 20px 20px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'var(--surface-gradient)',
        border: '1px solid var(--stroke)',
        color: 'var(--text-primary)',
        textAlign: 'center',
        padding: '40px 20px'
      }}>
        <div>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
          <h3 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '18px' }}>
            Interactive Hotspot Map
          </h3>
          <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            {safeHotspots.length} hotspot{safeHotspots.length === 1 ? '' : 's'} detected
          </p>
          <div style={{
            background: 'var(--warning)',
            color: '#ffffff',
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            marginBottom: '16px'
          }}>
            ⚠️ Google Maps API key required
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-tertiary)' }}>
            Add REACT_APP_GOOGLE_MAPS_API_KEY to your .env file
          </p>
        </div>
      </div>
    );
  }

  // If no Google Maps API key, show a fallback list view
  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY === 'your_google_maps_api_key_here') {
    return (
      <div style={{ 
        height: 420, 
        borderRadius: '0 0 20px 20px',
        background: 'var(--surface-gradient)',
        border: '1px solid var(--stroke)',
        padding: '20px',
        overflow: 'auto'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          padding: '12px 16px',
          background: 'var(--surface)',
          borderRadius: '12px',
          border: '1px solid var(--stroke)'
        }}>
          <div>
            <h4 style={{ margin: '0 0 4px 0', color: 'var(--text-primary)', fontSize: '16px' }}>
              📍 Hotspot Locations
            </h4>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
              {safeHotspots.length} hotspot{safeHotspots.length === 1 ? '' : 's'} • {safeHotspots.filter(h => h.status === 'online').length} online
            </p>
          </div>
          <div style={{
            padding: '6px 12px',
            background: 'var(--warning)',
            color: '#ffffff',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '600'
          }}>
            API Key Required
          </div>
        </div>
        
        <div style={{ display: 'grid', gap: '12px' }}>
          {safeHotspots.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-muted)'
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📍</div>
              <p style={{ margin: 0, fontSize: '14px' }}>No hotspots found</p>
            </div>
          ) : (
            safeHotspots.map((hotspot, index) => (
              <div key={hotspot.id || index} style={{
                padding: '16px',
                background: 'var(--surface)',
                border: '1px solid var(--stroke)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: hotspot.status === 'online' ? 'var(--success)' : 'var(--danger)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px'
                }}>
                  📶
                </div>
                <div style={{ flex: 1 }}>
                  <h5 style={{ 
                    margin: '0 0 4px 0', 
                    color: 'var(--text-primary)', 
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {hotspot.name || hotspot.hotspotName || `Hotspot ${index + 1}`}
                  </h5>
                  <p style={{ 
                    margin: '0 0 4px 0', 
                    color: 'var(--text-muted)', 
                    fontSize: '12px' 
                  }}>
                    {hotspot.address || 'Location not specified'}
                  </p>
                  <p style={{ 
                    margin: 0, 
                    color: 'var(--text-tertiary)', 
                    fontSize: '11px',
                    fontFamily: 'monospace'
                  }}>
                    {hotspot.latitude}, {hotspot.longitude}
                  </p>
                </div>
                <div style={{
                  padding: '4px 8px',
                  background: hotspot.status === 'online' ? 'var(--success)' : 'var(--danger)',
                  color: '#ffffff',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: '600'
                }}>
                  {hotspot.status === 'online' ? '🟢 Online' : '🔴 Offline'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div 
        ref={mapRef} 
        style={{ 
          height: 420, 
          borderRadius: '0 0 20px 20px',
          border: 'none',
          overflow: 'hidden'
        }} 
      />
      
      {/* Map Controls Overlay with YABA styling */}
      <div style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        background: 'var(--surface-gradient)',
        border: '1px solid var(--stroke)',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        zIndex: 1000,
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ 
          fontSize: '13px', 
          color: 'var(--text-muted)', 
          marginBottom: '4px',
          fontWeight: '500'
        }}>
          📍 {safeHotspots.length} hotspot{safeHotspots.length === 1 ? '' : 's'}
        </div>
        <div style={{ 
          fontSize: '13px', 
          color: 'var(--success)',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <span style={{ 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            backgroundColor: 'var(--success)',
            display: 'inline-block'
          }}></span>
          {safeHotspots.filter(h => h.status === 'online').length} online
        </div>
      </div>
    </div>
  );
};

// Wrap the component in an error boundary
const GoogleMapsHotspotWithErrorBoundary = (props) => (
  <ErrorBoundary fallback={
    <div style={{ 
      height: 420, 
      borderRadius: '0 0 20px 20px',
      background: 'var(--surface-gradient)',
      border: '1px solid var(--stroke)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-primary)',
      textAlign: 'center',
      padding: '20px'
    }}>
      <div>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
        <h3 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '18px' }}>
          Map Error
        </h3>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
          Unable to load the hotspot map. Please refresh the page.
        </p>
      </div>
    </div>
  }>
    <GoogleMapsHotspot {...props} />
  </ErrorBoundary>
);

export default GoogleMapsHotspotWithErrorBoundary;

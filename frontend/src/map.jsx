import React, { useEffect, useMemo, useRef, useState, useCallback, useContext, createContext } from 'react';
import PropTypes from 'prop-types';
import { MapContainer, TileLayer, FeatureGroup, LayersControl, useMap, WMSTileLayer } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
import { Button, IconButton, Tooltip } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import AuthSettings from './components/AuthSettings';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

// Fix for default marker icons in Leaflet
// Create icon paths that work with Vite
const defaultIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

// Set default icon for all markers
L.Marker.prototype.options.icon = defaultIcon;

// Default center for Southland, New Zealand
const defaultCenter = [-46.142, 168.328];

// Base map layer configurations
const baseLayerConfigs = {
  'ESRI World Imagery': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19
  },
  'OpenStreetMap': {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }
};

// Overlay layer configurations
const overlayLayerConfigs = [
  {
    name: 'Southland Imagery 2023',
    type: 'wms',
    url: 'https://maps.es.govt.nz/image/rest/services/Imagery/ImageCache2023/MapServer',
    layers: '0',
    format: 'image/png',
    transparent: true,
    attribution: '© Environment Southland',
    maxZoom: 22,
    minZoom: 0,
    bounds: L.latLngBounds(L.latLng(-47.5, 166), L.latLng(-45.5, 169)),
    opacity: 0.9,
    zIndex: 10,
    requiresAuth: true
  },
  {
    name: 'Slope',
    type: 'esri-image',
    url: 'https://maps.es.govt.nz/server/rest/services/LiDAR/LiDAR_2021_2023_Southland_SLOPE/ImageServer/exportImage',
    attribution: '© Environment Southland',
    maxZoom: 22,
    minZoom: 0,
    bounds: L.latLngBounds(L.latLng(-47.5, 166), L.latLng(-45.5, 169)),
    opacity: 0.7,
    zIndex: 5,
    requiresAuth: true
  },
  {
    name: 'Contours',
    type: 'esri-feature',
    url: 'https://maps.es.govt.nz/server/rest/services/BaseMaps/Contours/MapServer/0',
    attribution: '© Environment Southland',
    maxZoom: 20,
    minZoom: 0,
    bounds: L.latLngBounds(L.latLng(-47.5, 166), L.latLng(-45.5, 169)),
    opacity: 0.8,
    zIndex: 2,
    requiresAuth: true,
    style: {
      color: '#666666',
      weight: 1,
      opacity: 0.7
    }
  }
];

function PolygonSynchroniser({ polygon }) {
  const map = useMap();

  useEffect(() => {
    if (!polygon) {
      return;
    }
    const layer = L.geoJSON(polygon);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1));
    }
  }, [map, polygon]);

  return null;
}

PolygonSynchroniser.propTypes = {
  polygon: PropTypes.oneOfType([PropTypes.object, PropTypes.array])
};

function BenefitRasterLayer({ url }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!url) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const raster = await image.readRasters();
        const geoKeys = image.getGeoKeys();
        const projection = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || 4326;

        const georaster = {
          rasterType: 'geotiff',
          noDataValue: -9999,
          sourceType: 'url',
          projection,
          xmin: image.getBoundingBox()[0],
          ymin: image.getBoundingBox()[1],
          xmax: image.getBoundingBox()[2],
          ymax: image.getBoundingBox()[3],
          pixelWidth: image.getResolution()?.[0],
          pixelHeight: image.getResolution()?.[1],
          values: raster
        };

        const layer = new GeoRasterLayer({
          georaster,
          pixelValuesToColorFn: (values) => {
            const value = values[0];
            if (value === -9999 || Number.isNaN(value) || value <= 0) {
              return null;
            }
            const scaled = Math.min(value / 5, 1);
            const hue = 140 - scaled * 70;
            return `hsla(${hue}, 70%, 50%, 0.65)`;
          },
          opacity: 0.8,
          resolution: 256
        });

        if (!cancelled) {
          if (layerRef.current) {
            map.removeLayer(layerRef.current);
          }
          layer.addTo(map);
          layerRef.current = layer;
        }
      } catch (error) {
        console.error('Failed to render benefit raster', error);
      }
    })();

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, url]);

  return null;
}

BenefitRasterLayer.propTypes = {
  url: PropTypes.string
};

// Create auth context
export const AuthContext = createContext({
  credentials: null,
  setCredentials: () => {}
});

function MapPanel({ polygon, onPolygonChange, benefitRasterUrl }) {
  const [authOpen, setAuthOpen] = useState(false);
  const [credentials, setCredentials] = useState(() => {
    // Load saved credentials from localStorage
    const saved = localStorage.getItem('esriAuth');
    return saved ? JSON.parse(saved) : null;
  });
  
  // Save credentials to localStorage when they change
  useEffect(() => {
    if (credentials) {
      localStorage.setItem('esriAuth', JSON.stringify(credentials));
    } else {
      localStorage.removeItem('esriAuth');
    }
  }, [credentials]);
  
  // Check if any layer requires authentication
  const hasAuthLayers = overlayLayerConfigs.some(layer => layer.requiresAuth);
  const hasAuth = !!credentials;
  
  // Handle authentication save
  const handleAuthSave = (newCredentials) => {
    setCredentials(newCredentials);
    // Here you would typically validate the credentials with the server
    // and get an access token
  };
  
  // Handle logout
  const handleLogout = () => {
    setCredentials(null);
  };
  const mapRef = useRef(null);
  const featureGroupRef = useRef(null);
  const [map, setMap] = useState(null);
  const layerControlRef = useRef(null);
  const [mapError, setMapError] = useState(null);
  
  // Debug function to log layer events
  const logLayerEvent = (eventName, layerName, error = null) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] Layer Event - ${eventName}: ${layerName}`;
    if (error) {
      console.error(message, error);
      setMapError(`${eventName} failed for ${layerName}: ${error.message}`);
    } else {
      console.log(message);
    }
  };

  // Handle polygon changes
  const handleCreated = useCallback((e) => {
    const layer = e.layer;
    const geoJSON = layer.toGeoJSON();
    console.log('Polygon created:', geoJSON);
    onPolygonChange(geoJSON.geometry);
    
    // Handle edit events
    layer.on('edit', () => {
      onPolygonChange(layer.toGeoJSON().geometry);
    });
    
    // Handle delete event
    layer.on('remove', () => {
      onPolygonChange(null);
    });
  }, [onPolygonChange]);

  // Initialize map and layers when component mounts
  useEffect(() => {
    if (!map) return;
    
    try {
      logLayerEvent('Map initialized', 'Base Map');
      
      // Add event listeners for map errors
      map.on('tileerror', (error) => {
        console.error('Tile error:', error);
        setMapError(`Failed to load map tiles: ${error.message || 'Unknown error'}`);
      });
      
      // Log when tiles start loading
      map.on('tileloadstart', (e) => {
        const url = e.tile?.src || 'unknown';
        console.log(`Loading tile from: ${url}`);
      });
      
      // Log when tiles are loaded
      map.on('tileload', (e) => {
        const url = e.tile?.src || 'unknown';
        console.log(`Successfully loaded tile from: ${url}`);
      });
      
    } catch (error) {
      logLayerEvent('Map initialization error', 'Base Map', error);
    }
    
    return () => {
      // Cleanup event listeners
      if (map) {
        map.off('tileerror');
        map.off('tileloadstart');
        map.off('tileload');
      }
    };
  }, [map]);

  // Draw options
  const drawOptions = useMemo(() => ({
    draw: {
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false,
      polyline: false,
      polygon: {
        allowIntersection: false,
        drawError: {
          color: '#e1e100',
          message: '<strong>Error:</strong> Polygon edges cannot cross!',
        },
        shapeOptions: {
          color: '#3388ff',
          weight: 3,
          opacity: 0.8,
          fillOpacity: 0.3,
          fillColor: '#3388ff',
        },
      },
    },
    edit: {
      featureGroup: featureGroupRef.current,
      remove: true,
    },
  }), []);

  // Function to render overlay layers with error boundaries
  const renderOverlayLayers = () => {
    try {
      return overlayLayerConfigs.map((config) => {
        try {
          if (config.type === 'esri-image') {
            return (
              <LayersControl.Overlay 
                key={`overlay-${config.name}`}
                name={config.name}
                checked={false}
              >
                <WMSTileLayer
                  url="https://maps.es.govt.nz/server/rest/services/LiDAR/LiDAR_2021_2023_Southland_SLOPE/ImageServer/WMSServer"
                  layers="0"
                  format="image/png"
                  transparent={true}
                  opacity={config.opacity}
                  zIndex={config.zIndex}
                  attribution={config.attribution}
                  maxZoom={config.maxZoom}
                  minZoom={config.minZoom}
                  bounds={config.bounds}
                />
              </LayersControl.Overlay>
            );
          }
          
          if (config.type === 'wms') {
            // Skip rendering if auth is required but not available
            if (config.requiresAuth && !hasAuth) return null;
            
            // Add auth token to URL if available
            let url = config.url;
            if (config.requiresAuth && hasAuth) {
              // This is a simplified example - in a real app, you'd want to use proper OAuth flow
              url = `${url}?token=${encodeURIComponent(credentials.clientId)}`;
            }
            
            return (
              <LayersControl.Overlay 
                key={`overlay-${config.name}`}
                name={config.name}
                checked={false}
              >
                <WMSTileLayer
                  url={url}
                  layers={config.layers}
                  format={config.format}
                  transparent={config.transparent}
                  opacity={config.opacity}
                  zIndex={config.zIndex}
                  attribution={config.attribution}
                  maxZoom={config.maxZoom}
                  minZoom={config.minZoom}
                  bounds={config.bounds}
                  eventHandlers={{
                    loading: () => logLayerEvent('Loading', config.name),
                    load: () => {
                      logLayerEvent('Loaded', config.name);
                      console.log(`WMS Layer loaded: ${config.name}`, config);
                    },
                    error: (error) => {
                      logLayerEvent('Error', config.name, error);
                      if (config.requiresAuth && !hasAuth) {
                        setMapError(`Authentication required for ${config.name}. Please sign in.`);
                      } else {
                        setMapError(`Failed to load ${config.name}: ${error.message}`);
                      }
                    }
                  }}
                />
              </LayersControl.Overlay>
            );
          }
          
          // Default to standard TileLayer for other layer types
          return (
            <LayersControl.Overlay 
              key={`overlay-${config.name}`}
              name={config.name}
              checked={false}
            >
              <TileLayer
                url={config.url}
                attribution={config.attribution}
                maxZoom={config.maxZoom}
                minZoom={config.minZoom}
                bounds={config.bounds}
                opacity={config.opacity}
                noWrap={true}
                zIndex={config.zIndex}
                eventHandlers={{
                  loading: () => logLayerEvent('Loading', config.name),
                  load: () => {
                    logLayerEvent('Loaded', config.name);
                    console.log(`Layer loaded: ${config.name}`, {
                      url: config.url,
                      bounds: config.bounds,
                      opacity: config.opacity,
                      zIndex: config.zIndex
                    });
                  },
                  error: (error) => logLayerEvent('Error', config.name, error)
                }}
              />
            </LayersControl.Overlay>
          );
        } catch (error) {
          logLayerEvent('Render Error', config.name, error);
          return null; // Skip this layer if there's an error
        }
      });
    } catch (error) {
      console.error('Error rendering overlay layers:', error);
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ credentials, setCredentials }}>
      <div className="map-container" style={{ height: '100%', width: '100%', position: 'relative' }}>
        {hasAuthLayers && (
          <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 1000, display: 'flex', gap: '8px' }}>
            {hasAuth ? (
              <Button 
                variant="contained" 
                color="primary" 
                size="small"
                onClick={handleLogout}
              >
                Logout
              </Button>
            ) : (
              <Button 
                variant="contained" 
                color="primary" 
                size="small"
                onClick={() => setAuthOpen(true)}
              >
                Sign In for More Layers
              </Button>
            )}
            <Tooltip title="Authentication Settings">
              <IconButton 
                onClick={() => setAuthOpen(true)}
                size="small"
                sx={{ backgroundColor: 'white', '&:hover': { backgroundColor: '#f5f5f5' } }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          </div>
        )}
        
        <AuthSettings
          open={authOpen}
          onClose={() => setAuthOpen(false)}
          onSave={handleAuthSave}
          initialCredentials={credentials || {}}
        />
      {mapError && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(255, 0, 0, 0.7)',
          color: 'white',
          padding: '10px',
          borderRadius: '4px',
          zIndex: 1000,
          maxWidth: '80%',
          textAlign: 'center'
        }}>
          Map Error: {mapError}
          <button 
            onClick={() => setMapError(null)}
            style={{
              marginLeft: '10px',
              background: 'white',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 6px',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>
      )}
      <MapContainer
        center={defaultCenter}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        whenCreated={setMap}
        ref={mapRef}
      >
        <LayersControl position="topright" ref={layerControlRef}>
          {/* Base Layers */}
          {Object.entries(baseLayerConfigs).map(([name, config]) => (
            <LayersControl.BaseLayer 
              key={`base-${name}`} 
              name={name}
              checked={name === 'ESRI World Imagery'}
            >
              <TileLayer
                url={config.url}
                attribution={config.attribution}
                maxZoom={config.maxZoom}
                bounds={config.bounds}
              />
            </LayersControl.BaseLayer>
          ))}
          
          {/* Overlay Layers */}
          {renderOverlayLayers()}
        </LayersControl>

        {/* Drawing Tools */}
        <FeatureGroup ref={featureGroupRef}>
          <EditControl
            position="topleft"
            draw={drawOptions.draw}
            edit={drawOptions.edit}
            onCreated={handleCreated}
          />
        </FeatureGroup>

        {/* Additional Components */}
        <PolygonSynchroniser polygon={polygon} />
        {benefitRasterUrl && <BenefitRasterLayer url={benefitRasterUrl} />}
      </MapContainer>
      </div>
    </AuthContext.Provider>
  );
}

MapPanel.propTypes = {
  polygon: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  onPolygonChange: PropTypes.func.isRequired,
  benefitRasterUrl: PropTypes.string
};

export default MapPanel;

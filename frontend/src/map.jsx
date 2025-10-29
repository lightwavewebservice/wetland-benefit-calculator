import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { MapContainer, TileLayer, FeatureGroup, LayersControl, useMap } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
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

// Base map layers
const baseLayers = {
  'ESRI World Imagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19
  }),
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  })
};

// Overlay layers
const overlayLayers = {
  'Southland Imagery 2023': L.tileLayer('https://maps.es.govt.nz/image/rest/services/Imagery/ImageCache2023/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Environment Southland',
    maxZoom: 22,
    minZoom: 0,
    bounds: [[-47.5, 166], [-45.5, 169]]
  }),
  'Slope': L.tileLayer('https://maps.es.govt.nz/image/rest/services/LiDAR/LiDAR_2021_2023_Southland_SLOPE/ImageServer/tile/{z}/{y}/{x}', {
    attribution: '© Environment Southland LiDAR',
    maxZoom: 22,
    minZoom: 0,
    bounds: [[-47.5, 166], [-45.5, 169]],
    opacity: 0.7
  }),
  'Land Use': L.tileLayer('https://maps.es.govt.nz/server/rest/services/Public/Landuse/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Environment Southland',
    maxZoom: 22,
    minZoom: 0,
    bounds: [[-47.5, 166], [-45.5, 169]],
    opacity: 0.7
  }),
  'General Layers': L.tileLayer('https://maps.es.govt.nz/server/rest/services/Public/General/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Environment Southland',
    maxZoom: 22,
    minZoom: 0,
    bounds: [[-47.5, 166], [-45.5, 169]],
    opacity: 0.7
  })
};

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

function MapPanel({ polygon, onPolygonChange, benefitRasterUrl }) {
  const mapRef = useRef(null);
  const featureGroupRef = useRef(null);
  const [map, setMap] = useState(null);

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

  // Initialize map when component mounts
  useEffect(() => {
    return;
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

  return (
    <div style={{ height: '100%', width: '100%', minHeight: '500px' }}>
      <MapContainer
        center={defaultCenter}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        whenCreated={setMap}
        zoomControl={true}
      >
      <FeatureGroup ref={featureGroupRef}>
        <EditControl
          position="topleft"
          draw={drawOptions.draw}
          edit={drawOptions.edit}
          onCreated={handleCreated}
        />
      </FeatureGroup>
      <PolygonSynchroniser polygon={polygon} />
      {benefitRasterUrl && <BenefitRasterLayer url={benefitRasterUrl} />}
      
      {/* Add base layers */}
      <LayersControl position="topright">
        {Object.entries(baseLayers).map(([name, layer]) => (
          <LayersControl.BaseLayer key={name} name={name}>
            <TileLayer
              url={layer._url}
              attribution={layer.options.attribution}
              maxZoom={layer.options.maxZoom}
              bounds={layer.options.bounds}
            />
          </LayersControl.BaseLayer>
        ))}
        
        {/* Add overlay layers */}
        {Object.entries(overlayLayers).map(([name, layer]) => (
          <LayersControl.Overlay key={name} name={name}>
            <TileLayer
              url={layer._url}
              attribution={layer.options.attribution}
              maxZoom={layer.options.maxZoom}
              minZoom={layer.options.minZoom}
              bounds={layer.options.bounds}
            />
          </LayersControl.Overlay>
        ))}
      </LayersControl>
      </MapContainer>
    </div>
  );
}

MapPanel.propTypes = {
  polygon: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  onPolygonChange: PropTypes.func.isRequired,
  benefitRasterUrl: PropTypes.string
};

export default MapPanel;

import React, { useCallback, useMemo, useState } from 'react';
import { Tooltip, Typography } from '@mui/material';
import axios from 'axios';
import Plot from 'react-plotly.js';
import MapPanel from './map.jsx';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
const DEFAULT_DEM_URL =
  'https://maps.es.govt.nz/image/rest/services/LiDAR/Southland_2021_2023_NZVD2016_DEM/ImageServer/export';

const defaultParams = {
  rainfallFactor: 600,
  soilErodibility: 0.28,
  coverBefore: 0.3,
  coverAfter: 0.05,
  supportBefore: 0.5,
  supportAfter: 0.2,
  sedimentDeliveryRatio: 0.6,
  efficiencies: {
    sediment: 0.7,
    nitrogen: 0.4,
    phosphorus: 0.5
  }
};

const SummaryCard = ({ title, value, unit }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
    <p className="text-sm text-slate-500">{title}</p>
    <p className="text-2xl font-semibold text-primary">{value}{unit ? <span className="ml-1 text-base font-medium text-slate-500">{unit}</span> : null}</p>
  </div>
);

const RangeControl = ({ label, value, min = 0, max = 1, step = 0.01, onChange, hint, tooltip = '' }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <Tooltip 
        title={
          <div className="text-slate-800">
            {tooltip}
          </div>
        } 
        arrow
        componentsProps={{
          tooltip: {
            sx: { 
              backgroundColor: 'white',
              color: 'rgb(30 41 59)', // slate-800
              border: '1px solid rgb(226 232 240)', // slate-200
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
              maxWidth: 500,
              '& .MuiTooltip-arrow': {
                color: 'white',
                '&:before': {
                  border: '1px solid rgb(226 232 240)'
                }
              }
            }
          }
        }}
      >
        <span className="text-sm font-medium text-slate-700 cursor-help border-b border-dashed border-slate-400">
          {label}
        </span>
      </Tooltip>
      <span className="text-sm font-semibold text-primary">{value.toFixed(2)}</span>
    </div>
    <input
      id={`range-${label.toLowerCase().replace(/\s+/g, '-')}`}
      name={`range-${label.toLowerCase().replace(/\s+/g, '-')}`}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(parseFloat(event.target.value))}
      className="w-full"
      aria-label={label}
    />
    {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
  </div>
);

const NumberControl = ({ label, value, onChange, step = 0.1, hint, min, tooltip = '' }) => {
  const inputId = `number-${label.toLowerCase().replace(/\s+/g, '-')}`;
  
  return (
    <div className="block space-y-1">
      <Tooltip 
        title={
          <div className="text-slate-800">
            {tooltip}
          </div>
        } 
        arrow
        componentsProps={{
          tooltip: {
            sx: { 
              backgroundColor: 'white',
              color: 'rgb(30 41 59)', // slate-800
              border: '1px solid rgb(226 232 240)', // slate-200
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
              maxWidth: 500,
              '& .MuiTooltip-arrow': {
                color: 'white',
                '&:before': {
                  border: '1px solid rgb(226 232 240)'
                }
              }
            }
          }
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700 cursor-help border-b border-dashed border-slate-400">
          {label}
        </label>
      </Tooltip>
      <input
        id={inputId}
        name={inputId}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded-md border-slate-300 shadow-sm focus:border-primary-300 focus:ring focus:ring-primary-200 focus:ring-opacity-50"
        aria-label={label}
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
};

const formatNumber = (value, decimals = 2) =>
  Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

function App() {
  const [wetlandName, setWetlandName] = useState('Demo Wetland');
  const [userName, setUserName] = useState('');
  const [demUrl, setDemUrl] = useState(DEFAULT_DEM_URL);
  const [polygonGeoJSON, setPolygonGeoJSON] = useState(null);
  const [params, setParams] = useState(defaultParams);
  const [isCalculating, setIsCalculating] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [result, setResult] = useState(null);
  const [rasterUrl, setRasterUrl] = useState(null);
  const [reportUrl, setReportUrl] = useState(null);
  const [toast, setToast] = useState(null);
  const [demTestStatus, setDemTestStatus] = useState(null);

  const setParamValue = useCallback((key, value) => {
    setParams((current) => ({
      ...current,
      [key]: value
    }));
  }, []);

  const setEfficiency = useCallback((key, value) => {
    setParams((current) => ({
      ...current,
      efficiencies: {
        ...current.efficiencies,
        [key]: value
      }
    }));
  }, []);

  const resetOutputs = useCallback(() => {
    setJobId(null);
    setResult(null);
    setRasterUrl(null);
    setReportUrl(null);
  }, []);

  const handleDemUrlChange = useCallback((value) => {
    setDemUrl(value);
    resetOutputs();
    setDemTestStatus(null);
  }, [resetOutputs]);

  const handlePolygonChange = useCallback(
    (geojson) => {
      setPolygonGeoJSON(geojson);
      resetOutputs();
      setDemTestStatus(null);
      if (!geojson) {
        setToast({ type: 'info', message: 'Polygon removed. Draw a new wetland boundary to continue.' });
      }
    },
    [resetOutputs]
  );

  const handleTestDem = async () => {
    if (!demUrl) {
      setDemTestStatus({ ok: false, message: 'Provide a DEM export URL first.' });
      return;
    }
    if (!polygonGeoJSON) {
      setDemTestStatus({ ok: false, message: 'Draw a polygon to test the DEM export.' });
      return;
    }

    try {
      const response = await axios.post(`${API_BASE}/dem/test`, {
        dem_url: demUrl,
        polygon_geojson: polygonGeoJSON
      });
      setDemTestStatus({ ok: true, message: `Success: fetched ${response.data.bytes} bytes.` });
    } catch (error) {
      console.error(error);
      const detail = error?.response?.data?.detail ?? 'DEM test failed.';
      setDemTestStatus({ ok: false, message: detail });
    }
  };

  const handleRunCalculation = async () => {
    if (!demUrl) {
      setToast({ type: 'error', message: 'Provide a DEM export URL before running the calculation.' });
      return;
    }
    if (!polygonGeoJSON) {
      setToast({ type: 'error', message: 'Draw a wetland polygon on the map before running the calculation.' });
      return;
    }

    setIsCalculating(true);
    setToast(null);

    try {
      const payload = {
        dem_url: demUrl,
        wetland_name: wetlandName,
        user_name: userName || null,
        polygon_geojson: polygonGeoJSON,
        rainfall_factor: params.rainfallFactor,
        soil_erodibility: params.soilErodibility,
        cover_management_before: params.coverBefore,
        cover_management_after: params.coverAfter,
        support_practices_before: params.supportBefore,
        support_practices_after: params.supportAfter,
        sediment_delivery_ratio: params.sedimentDeliveryRatio,
        efficiencies: params.efficiencies
      };

      const response = await axios.post(`${API_BASE}/calculate`, payload);
      const data = response.data;
      setResult(data);
      setJobId(data.job_id);
      setRasterUrl(`${API_BASE}${data.raster_download_url}`);
      setReportUrl(`${API_BASE}${data.report_download_url}`);
      setToast({ type: 'success', message: 'Calculation complete. Explore the results below.' });
    } catch (error) {
      console.error(error);
      const detail = error?.response?.data?.detail ?? 'Unexpected error running calculation.';
      setToast({ type: 'error', message: detail });
    } finally {
      setIsCalculating(false);
    }
  };

  const benefitSummary = result?.summary;

  const sedimentPlotData = useMemo(() => {
    if (!benefitSummary) {
      return null;
    }
    return [
      {
        x: ['Sediment (t/yr)'],
        y: [benefitSummary.before.soil_loss_tonnes],
        name: 'Before',
        type: 'bar',
        marker: { color: '#C05621' }
      },
      {
        x: ['Sediment (t/yr)'],
        y: [benefitSummary.after.soil_loss_tonnes],
        name: 'After',
        type: 'bar',
        marker: { color: '#2F855A' }
      }
    ];
  }, [benefitSummary]);

  const nutrientPlotData = useMemo(() => {
    if (!benefitSummary) {
      return null;
    }
    return [
      {
        x: ['Nitrogen (kg/yr)', 'Phosphorus (kg/yr)'],
        y: [benefitSummary.before.nitrogen_load_kg, benefitSummary.before.phosphorus_load_kg],
        name: 'Before',
        type: 'bar',
        marker: { color: '#2B6CB0' }
      },
      {
        x: ['Nitrogen (kg/yr)', 'Phosphorus (kg/yr)'],
        y: [benefitSummary.after.nitrogen_load_kg, benefitSummary.after.phosphorus_load_kg],
        name: 'After',
        type: 'bar',
        marker: { color: '#319795' }
      }
    ];
  }, [benefitSummary]);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Wetland Benefit Calculator</h1>
            <p className="text-sm text-slate-500">Estimate sediment and nutrient reductions from fencing and restoring wetlands.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-primary font-medium">DEM Source: {demUrl ? 'Remote export' : 'Not set'}</span>
            {jobId ? <span className="rounded-full bg-slate-200 px-3 py-1">Job: {jobId.slice(0, 8)}…</span> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 lg:flex-row">
        <section className="w-full lg:w-2/3">
          <div className="h-[540px] overflow-hidden rounded-lg border border-slate-200 shadow">
            <MapPanel
              polygon={polygonGeoJSON}
              onPolygonChange={handlePolygonChange}
              benefitRasterUrl={rasterUrl}
            />
          </div>
        </section>

        <aside className="flex w-full flex-col gap-4 lg:w-1/3">
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Scenario Inputs</h3>
              <Tooltip 
                title={
                  <div className="space-y-2 p-2 max-w-md text-slate-800">
                    <Typography variant="subtitle2" className="font-bold mb-2">How to use these parameters</Typography>
                    <Typography variant="body2" className="mb-2">
                      <strong>Hover over the underlined labels</strong> for detailed information about each parameter, including:
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>Parameter definition and purpose</li>
                        <li>Measurement units and valid ranges</li>
                        <li>Data sources and references</li>
                        <li>Recommended values for Southland conditions</li>
                      </ul>
                    </Typography>
                    <Typography variant="caption" display="block" className="mt-2 pt-2 border-t border-slate-200">
                      <strong>Primary Data Sources:</strong> Environment Southland LiDAR & Imagery Services, NIWA Climate Database, Landcare Research S-Map, Regional Council Monitoring Data
                    </Typography>
                  </div>
                } 
                arrow
                placement="left"
                componentsProps={{
                  tooltip: {
                    sx: { 
                      backgroundColor: 'white',
                      color: 'rgb(30 41 59)', // slate-800
                      border: '1px solid rgb(226 232 240)', // slate-200
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                      maxWidth: 500,
                      '& .MuiTooltip-arrow': {
                        color: 'white',
                        '&:before': {
                          border: '1px solid rgb(226 232 240)'
                        }
                      }
                    }
                  }
                }}
              >
                <span className="text-xs text-slate-600 cursor-help bg-slate-50 px-2 py-1 rounded border border-slate-200 hover:bg-slate-100">
                  ℹ️ Detailed Parameter Information
                </span>
              </Tooltip>
            </div>

            <div className="block space-y-1">
              <label htmlFor="dem-export-url" className="text-sm font-medium text-slate-700">DEM Export URL</label>
              <textarea
                id="dem-export-url"
                name="dem-export-url"
                value={demUrl}
                onChange={(event) => handleDemUrlChange(event.target.value)}
                rows={3}
                className="w-full rounded border border-slate-300 px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Paste the ArcGIS ImageServer export URL here"
                aria-describedby="dem-export-url-help"
              />
              <p id="dem-export-url-help" className="text-xs text-slate-500">
                The URL should point to an ArcGIS ImageServer <code className="font-mono">/export</code> endpoint including format, bbox, and size parameters.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestDem}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Test DEM URL
                </button>
                {demTestStatus ? (
                  <span className={`text-xs ${demTestStatus.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {demTestStatus.message}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="block space-y-1">
              <label htmlFor="wetland-name" className="text-sm font-medium text-slate-700">Wetland Name</label>
              <input
                id="wetland-name"
                name="wetland-name"
                type="text"
                value={wetlandName}
                onChange={(event) => setWetlandName(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                aria-required="true"
              />
            </div>

            <div className="block space-y-1">
              <label htmlFor="analyst-name" className="text-sm font-medium text-slate-700">Analyst Name</label>
              <input
                id="analyst-name"
                name="analyst-name"
                type="text"
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                placeholder="Optional"
                className="w-full rounded border border-slate-300 px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                aria-required="false"
              />
            </div>

            <NumberControl
              label="Rainfall Factor (R)"
              value={params.rainfallFactor}
              onChange={(v) => setParamValue('rainfallFactor', v)}
              step={10}
              min={0}
              hint="MJ mm ha⁻¹ h⁻¹ year⁻¹"
              tooltip={
                <div className="space-y-2">
                  <div>
                    <p className="font-medium">Rainfall-Runoff Erosivity Factor (R)</p>
                    <p className="text-sm">Quantifies the erosive potential of rainfall and runoff based on the kinetic energy and intensity of rainfall events.</p>
                  </div>
                  <div className="text-xs space-y-1 bg-slate-50 p-2 rounded">
                    <p><span className="font-medium">Measurement:</span> MJ·mm·ha⁻¹·h⁻¹·year⁻¹</p>
                    <p><span className="font-medium">Typical Range (Southland):</span> 400-800</p>
                    <p><span className="font-medium">Default Value:</span> 600 (based on Southland average)</p>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">References:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>NIWA High Intensity Rainfall System (HIRDS)</li>
                      <li>Renard et al. (1997) - RUSLE Documentation</li>
                      <li>Environment Southland Climate Records (2010-2023)</li>
                    </ul>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="font-medium">Note:</span> Higher values indicate greater erosion potential. Southland's west coast typically has higher values than eastern areas.
                  </p>
                </div>
              }
            />

            <NumberControl
              label="Soil Erodibility (K)"
              value={params.soilErodibility}
              onChange={(v) => setParamValue('soilErodibility', v)}
              step={0.01}
              min={0}
              hint="t ha h ha⁻¹ MJ⁻¹ mm⁻¹"
              tooltip={
                <div className="space-y-2">
                  <div>
                    <p className="font-medium">Soil Erodibility Factor (K)</p>
                    <p className="text-sm">Measures the inherent susceptibility of soil to erosion when subjected to rainfall and runoff, considering soil texture, structure, and organic matter.</p>
                  </div>
                  <div className="text-xs space-y-1 bg-slate-50 p-2 rounded">
                    <p><span className="font-medium">Measurement:</span> t·ha·h·ha⁻¹·MJ⁻¹·mm⁻¹</p>
                    <p><span className="font-medium">Southland Ranges:</span> 0.1 (stable allophanic soils) to 0.5 (erodible pumice soils)</p>
                    <p><span className="font-medium">Common Pasture Soils:</span> 0.25-0.35</p>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">Data Sources:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Landcare Research S-map (2023)</li>
                      <li>NZ Soil Classification Database</li>
                      <li>Environment Southland Soil Erosion Risk Mapping</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">References:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Hewitt (2010) - New Zealand Soil Classification</li>
                      <li>Lilburne et al. (2012) - S-map Technical Specifications</li>
                      <li>Environment Southland (2021) - Regional Soil Erosion Assessment</li>
                    </ul>
                  </div>
                </div>
              }
            />

            <RangeControl
              label="Cover Management (C) - Before"
              value={params.coverBefore}
              onChange={(v) => setParamValue('coverBefore', v)}
              min={0}
              max={1}
              step={0.01}
              hint="0 = bare soil, 1 = complete cover"
              tooltip={
                <div className="space-y-2">
                  <div>
                    <p className="font-medium">Cover Management Factor - Pre-Intervention (C<sub>before</sub>)</p>
                    <p className="text-sm">Represents the ratio of soil loss from land under specific vegetation cover compared to clean-tilled, continuous fallow conditions.</p>
                  </div>
                  <div className="text-xs space-y-1 bg-slate-50 p-2 rounded">
                    <p><span className="font-medium">Range:</span> 0 (complete protection) to 1 (bare soil)</p>
                    <p><span className="font-medium">Typical Values:</span></p>
                    <ul className="list-disc pl-4">
                      <li>Intensive pasture: 0.1-0.3</li>
                      <li>Sheep/beef pasture: 0.2-0.4</li>
                      <li>Cropping (annual): 0.3-0.8</li>
                      <li>Bare soil: 1.0</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">References:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Renard et al. (1997) - RUSLE Documentation</li>
                      <li>Dymond et al. (2010) - NZ-Specific C-Factors</li>
                      <li>Environment Southland (2022) - Land Use and Erosion Control Guidelines</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    <span className="font-medium">Note:</span> Lower values indicate better ground cover protection. Values should be adjusted based on seasonal variations in vegetation cover.
                  </div>
                </div>
              }
            />

            <RangeControl
              label="Cover Management (C) - After"
              value={params.coverAfter}
              onChange={(v) => setParamValue('coverAfter', v)}
              min={0}
              max={1}
              step={0.01}
              hint="0 = bare soil, 1 = complete cover"
              tooltip={
                <div>
                  <p>Effect of vegetation cover after wetland establishment.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    <strong>Source:</strong> Field assessments, land use data
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <strong>Example:</strong> 0.8 = 80% soil cover (typical for restored wetland)
                  </p>
                </div>
              }
            />

            <RangeControl
              label="Support Practices (P) - Before"
              value={params.supportBefore}
              onChange={(v) => setParamValue('supportBefore', v)}
              min={0}
              max={1}
              step={0.1}
              hint="1 = no support, 0 = maximum protection"
              tooltip={
                <div className="space-y-2">
                  <div>
                    <p className="font-medium">Support Practice Factor - Pre-Intervention (P<sub>before</sub>)</p>
                    <p className="text-sm">Represents the ratio of soil loss with a specific support practice to the corresponding loss with upslope and downslope farming.</p>
                  </div>
                  <div className="text-xs space-y-1 bg-slate-50 p-2 rounded">
                    <p><span className="font-medium">Range:</span> 0 (maximum protection) to 1 (no protection)</p>
                    <p><span className="font-medium">Common Values:</span></p>
                    <ul className="list-disc pl-4">
                      <li>Contour farming: 0.5-0.7</li>
                      <li>Strip cropping: 0.4-0.6</li>
                      <li>Terracing: 0.2-0.5</li>
                      <li>No conservation practice: 1.0</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">References:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Wischmeier & Smith (1978) - Original USLE Documentation</li>
                      <li>Ministry for Primary Industries (2020) - Good Farming Practice Guidelines</li>
                      <li>Environment Southland (2023) - Farm Environmental Plan Templates</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    <span className="font-medium">Note:</span> This factor should be adjusted based on the effectiveness of existing erosion control measures in the catchment.
                  </div>
                </div>
              }
            />

            <RangeControl
              label="Support Practices (P) - After"
              value={params.supportAfter}
              onChange={(v) => setParamValue('supportAfter', v)}
              min={0}
              max={1}
              step={0.1}
              hint="1 = no support, 0 = maximum protection"
              tooltip={
                <div>
                  <p>Effect of support practices after wetland establishment.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    <strong>Source:</strong> Farm management plans, Erosion Control Plans
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <strong>Example:</strong> 0.2 = high erosion control (typical for restored wetland)
                  </p>
                </div>
              }
            />

            <RangeControl
              label="Sediment Delivery Ratio"
              value={params.sedimentDeliveryRatio}
              hint="Fraction of soil loss delivered to water"
              onChange={(value) => setParamValue('sedimentDeliveryRatio', value)}
              tooltip={
                <div className="space-y-2">
                  <div>
                    <p className="font-medium">Sediment Delivery Ratio (SDR)</p>
                    <p className="text-sm">The fraction of gross erosion that is transported from a given area to the catchment outlet, accounting for deposition processes.</p>
                  </div>
                  <div className="text-xs space-y-1 bg-slate-50 p-2 rounded">
                    <p><span className="font-medium">Range:</span> 0 (no delivery) to 1 (100% delivery)</p>
                    <p><span className="font-medium">Southland Catchments:</span></p>
                    <ul className="list-disc pl-4">
                      <li>Mountainous: 0.7-0.9</li>
                      <li>Hill country: 0.4-0.7</li>
                      <li>Plains: 0.1-0.3</li>
                      <li>Wetlands: 0.05-0.2</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">Key Influencing Factors:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Slope and slope length</li>
                      <li>Drainage density</li>
                      <li>Land use and cover</li>
                      <li>Soil type and erodibility</li>
                      <li>Presence of buffers/wetlands</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-medium">References:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Walling (1983) - Sediment Delivery Processes</li>
                      <li>NIWA (2018) - Sediment Yield Estimation for NZ</li>
                      <li>Environment Southland (2022) - Catchment Sediment Budgets</li>
                    </ul>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    <span className="font-medium">Note:</span> Lower values indicate more deposition before reaching waterways. Wetlands typically have very low SDR due to their water retention and sediment trapping capabilities.
                  </div>
                </div>
              }
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <RangeControl
                label="Sediment Efficiency"
                value={params.efficiencies.sediment}
                onChange={(value) => setEfficiency('sediment', value)}
                min={0}
                max={1}
                step={0.05}
                hint="Proportion of sediment retained"
                tooltip={
                  <div className="space-y-2">
                    <div>
                      <p className="font-medium">Wetland Sediment Retention Efficiency</p>
                      <p className="text-sm">The proportion of incoming sediment particles that are trapped and retained within the wetland system.</p>
                    </div>
                    <div className="text-xs space-y-1 bg-slate-50 p-2 rounded">
                      <p><span className="font-medium">Range:</span> 0 (no retention) to 1 (100% retention)</p>
                      <p><span className="font-medium">Typical Efficiency Ranges:</span></p>
                      <ul className="list-disc pl-4">
                        <li>Constructed wetlands: 60-90%</li>
                        <li>Natural wetlands: 70-95%</li>
                        <li>Small particles (&lt;0.002mm): 30-60%</li>
                        <li>Large particles (&gt;0.05mm): 80-99%</li>
                      </ul>
                    </div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <p className="font-medium">Key Factors Affecting Efficiency:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>Wetland size relative to catchment</li>
                        <li>Hydraulic loading rate</li>
                        <li>Particle size distribution</li>
                        <li>Vegetation density and type</li>
                        <li>Hydraulic retention time</li>
                      </ul>
                    </div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <p className="font-medium">References:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>Kadlec & Wallace (2009) - Treatment Wetlands</li>
                        <li>Fisher & Acreman (2004) - Wetland Nutrient Removal</li>
                        <li>Environment Southland (2023) - Wetland Performance Monitoring</li>
                      </ul>
                    </div>
                  </div>
                }
              />

              <RangeControl
                label="Nitrogen Efficiency"
                value={params.efficiencies.nitrogen}
                onChange={(value) => setEfficiency('nitrogen', value)}
                min={0}
                max={1}
                step={0.05}
                hint="Proportion of nitrogen retained"
                tooltip={
                  <div>
                    <p>Proportion of nitrogen retained by the wetland (0-1).</p>
                    <p className="mt-1 text-xs text-slate-500">
                      <strong>Source:</strong> Literature review of wetland nitrogen retention
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      <strong>Typical values:</strong> 0.3-0.7 for Southland wetlands
                    </p>
                  </div>
                }
              />

              <RangeControl
                label="Phosphorus Efficiency"
                value={params.efficiencies.phosphorus}
                onChange={(value) => setEfficiency('phosphorus', value)}
                min={0}
                max={1}
                step={0.05}
                hint="Proportion of phosphorus retained"
                tooltip={
                  <div>
                    <p>Proportion of phosphorus retained by the wetland (0-1).</p>
                    <p className="mt-1 text-xs text-slate-500">
                      <strong>Source:</strong> Literature review of wetland phosphorus retention
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      <strong>Typical values:</strong> 0.5-0.9 for Southland wetlands
                    </p>
                  </div>
                }
              />
            </div>

            <button
              type="button"
              onClick={handleRunCalculation}
              disabled={isCalculating}
              className="mt-2 w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCalculating ? 'Running Calculation…' : 'Run Calculation'}
            </button>

            {toast ? (
              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  toast.type === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : toast.type === 'success'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                {toast.message}
              </div>
            ) : null}
          </div>

          {result ? (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SummaryCard title="Wetland Area" value={`${formatNumber(result.area_hectares)} ha`} />
                <SummaryCard title="Catchment Area" value={`${formatNumber(result.catchment_hectares)} ha`} />
                <SummaryCard title="Avg Slope" value={`${formatNumber(result.average_slope)}°`} />
                <SummaryCard title="Sediment Reduction" value={formatNumber(result.summary.sediment_reduction_tonnes)} unit="t/yr" />
                <SummaryCard title="Nitrogen Reduction" value={formatNumber(result.summary.nitrogen_reduction_kg)} unit="kg/yr" />
                <SummaryCard title="Phosphorus Reduction" value={formatNumber(result.summary.phosphorus_reduction_kg)} unit="kg/yr" />
              </div>

              <div className="flex flex-wrap gap-2">
                {rasterUrl ? (
                  <a
                    href={rasterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Download Benefit Raster
                  </a>
                ) : null}
                {reportUrl ? (
                  <a
                    href={reportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90"
                  >
                    Download PDF Report
                  </a>
                ) : null}
              </div>

              {sedimentPlotData ? (
                <Plot
                  data={sedimentPlotData}
                  layout={{
                    title: 'Sediment Loss Comparison',
                    height: 280,
                    barmode: 'group',
                    margin: { l: 50, r: 20, t: 40, b: 40 },
                    yaxis: { title: 'Tonnes per year' },
                    legend: { orientation: 'h', x: 0, y: 1.1 }
                  }}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: '100%' }}
                />
              ) : null}

              {nutrientPlotData ? (
                <Plot
                  data={nutrientPlotData}
                  layout={{
                    title: 'Nutrient Loading Comparison',
                    height: 280,
                    barmode: 'group',
                    margin: { l: 50, r: 20, t: 40, b: 40 },
                    yaxis: { title: 'Kilograms per year' },
                    legend: { orientation: 'h', x: 0, y: 1.1 }
                  }}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: '100%' }}
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500 shadow-sm">
              Paste a DEM export URL, draw your wetland boundary, adjust parameters, then run the calculation to see results.
            </div>
          )}
        </aside>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Wetland Benefit Calculator Prototype</span>
          <span>Powered by FastAPI, React, Tailwind, Leaflet, and Plotly</span>
        </div>
      </footer>
    </div>
  );
}

export default App;

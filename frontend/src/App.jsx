import React, { useCallback, useMemo, useState } from 'react';
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

const RangeControl = ({ label, value, min = 0, max = 1, step = 0.01, onChange, hint }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-slate-700">{label}</span>
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

const NumberControl = ({ label, value, onChange, step = 0.1, hint, min }) => {
  const inputId = `number-${label.toLowerCase().replace(/\s+/g, '-')}`;
  
  return (
    <div className="block space-y-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {label}
      </label>
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
            <h2 className="text-lg font-semibold text-slate-800">Scenario Inputs</h2>

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
              min={0}
              step={10}
              hint="MJ mm ha⁻¹ h⁻¹ yr⁻¹"
              onChange={(value) => setParamValue('rainfallFactor', value)}
            />

            <RangeControl
              label="Soil Erodibility (K)"
              value={params.soilErodibility}
              min={0.05}
              max={1}
              step={0.01}
              hint="Ton·ha·h / (ha·MJ·mm)"
              onChange={(value) => setParamValue('soilErodibility', value)}
            />

            <RangeControl
              label="Cover Factor Before (C)"
              value={params.coverBefore}
              onChange={(value) => setParamValue('coverBefore', value)}
            />
            <RangeControl
              label="Cover Factor After (C)"
              value={params.coverAfter}
              onChange={(value) => setParamValue('coverAfter', value)}
            />

            <RangeControl
              label="Support Practice Before (P)"
              value={params.supportBefore}
              onChange={(value) => setParamValue('supportBefore', value)}
            />
            <RangeControl
              label="Support Practice After (P)"
              value={params.supportAfter}
              onChange={(value) => setParamValue('supportAfter', value)}
            />

            <RangeControl
              label="Sediment Delivery Ratio"
              value={params.sedimentDeliveryRatio}
              hint="Fraction of soil loss delivered to water"
              onChange={(value) => setParamValue('sedimentDeliveryRatio', value)}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <RangeControl
                label="Sediment Efficiency"
                value={params.efficiencies.sediment}
                onChange={(value) => setEfficiency('sediment', value)}
              />
              <RangeControl
                label="Nitrogen Efficiency"
                value={params.efficiencies.nitrogen}
                onChange={(value) => setEfficiency('nitrogen', value)}
              />
              <RangeControl
                label="Phosphorus Efficiency"
                value={params.efficiencies.phosphorus}
                onChange={(value) => setEfficiency('phosphorus', value)}
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

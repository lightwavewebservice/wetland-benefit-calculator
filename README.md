# Wetland Benefit Calculator

A full-stack application for calculating the benefits of wetland restoration, including sediment and nutrient reduction estimates.

## Features

- Interactive map interface for drawing wetland boundaries
- DEM (Digital Elevation Model) integration for terrain analysis
- Calculation of sediment and nutrient reduction benefits
- Report generation

## Tech Stack

- **Frontend**: React, Leaflet, TailwindCSS
- **Backend**: FastAPI, Python
- **Spatial Analysis**: GDAL, Rasterio, Shapely

## Getting Started

### Prerequisites

- Node.js (for frontend)
- Python 3.8+
- pip (Python package manager)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/wetland-benefit-calculator.git
   cd wetland-benefit-calculator
   ```

2. **Set up the backend**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Set up the frontend**
   ```bash
   cd ../frontend
   npm install
   ```

### Running the Application

1. **Start the backend server**
   ```bash
   cd backend
   uvicorn app.main:app --reload
   ```

2. **Start the frontend development server**
   ```bash
   cd ../frontend
   npm run dev
   ```

3. Open your browser to `http://localhost:5173`

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

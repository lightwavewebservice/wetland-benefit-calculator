from urllib.parse import urlparse, parse_qsl

url = "https://maps.es.govt.nz/image/rest/services/LiDAR/Southland_2021_2023_NZVD2016_DEM/ImageServer/export"
parsed = urlparse(url)
print("path:", parsed.path)
print("query:", parsed.query)
base_params = dict(parse_qsl(parsed.query))
print("base_params:", base_params)

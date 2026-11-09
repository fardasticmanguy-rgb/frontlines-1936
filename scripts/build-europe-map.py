import json
import math
import os
import sys

import shapely
from shapely.geometry import MultiPoint, Point, Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, polylabel, unary_union

LON0, LON1, LAT0, LAT1 = -12.0, 50.0, 29.3, 71.0
UNIT = 34.0
SQUASH = math.cos(math.radians(50))
QUANT = 4
TOLERANCE = 1.0
MIN_PART = 5.0
MIN_LAKE = 120.0
FAR_PART = 75.0
MERGE_BELOW = 150.0
ORPHAN_LIMIT = 30.0

BASE = {
    "DEU": "GER", "AUT": "GER", "CZE": "GER",
    "GBR": "UK", "IMN": "UK", "JEY": "UK", "GGY": "UK", "GIB": "UK", "MLT": "UK",
    "CYP": "UK", "CYN": "UK", "ESB": "UK", "WSB": "UK", "EGY": "UK", "ISR": "UK", "PSX": "UK", "JOR": "UK",
    "FRA": "FRA", "MCO": "FRA", "AND": "FRA", "DZA": "FRA", "TUN": "FRA", "MAR": "FRA", "SYR": "FRA", "LBN": "FRA",
    "RUS": "SOV", "UKR": "SOV", "BLR": "SOV", "MDA": "SOV", "GEO": "SOV", "ARM": "SOV", "AZE": "SOV", "KAZ": "SOV",
    "ITA": "ITA", "SMR": "ITA", "VAT": "ITA", "ALB": "ITA", "LBY": "ITA",
    "POL": "POL", "ESP": "SPA", "TUR": "TUR",
    "IRL": "Ireland", "PRT": "Portugal", "NLD": "Netherlands", "BEL": "Belgium", "LUX": "Luxembourg",
    "CHE": "Switzerland", "LIE": "Switzerland", "DNK": "Denmark", "FRO": "Denmark", "NOR": "Norway", "SWE": "Sweden",
    "FIN": "Finland", "ALD": "Finland", "EST": "Estonia", "LVA": "Latvia", "LTU": "Lithuania",
    "SVK": "Slovakia", "HUN": "Hungary", "ROU": "Romania",
    "SRB": "Yugoslavia", "HRV": "Yugoslavia", "SVN": "Yugoslavia", "BIH": "Yugoslavia", "MNE": "Yugoslavia",
    "MKD": "Yugoslavia", "KOS": "Yugoslavia",
    "BGR": "Bulgaria", "GRC": "Greece", "IRQ": "Iraq", "IRN": "Iran",
}

GER_WEST = [
    (12.0, 55.6), (17.95, 55.6), (17.95, 54.8), (17.72, 54.45), (17.55, 54.15), (17.48, 53.85), (17.35, 53.55),
    (17.05, 53.35), (16.7, 53.2), (16.3, 52.98), (16.0, 52.85), (15.85, 52.65), (15.75, 52.45), (15.82, 52.25),
    (16.05, 52.1), (16.25, 51.85), (16.45, 51.75), (16.7, 51.68), (17.1, 51.6), (17.5, 51.45), (17.8, 51.3),
    (17.85, 51.15), (18.15, 51.05), (18.45, 50.88), (18.6, 50.65), (18.8, 50.45), (19.0, 50.37), (18.88, 50.28),
    (18.7, 50.22), (18.5, 50.15), (18.35, 49.95), (18.3, 49.6), (12.0, 49.6),
]
EAST_PRUSSIA = [
    (18.55, 54.47), (18.42, 54.38), (18.42, 54.25), (18.55, 54.12), (18.82, 54.05), (18.85, 53.8), (19.05, 53.6),
    (19.45, 53.45), (19.85, 53.42), (20.2, 53.33), (20.6, 53.27), (21.0, 53.3), (21.55, 53.45), (22.0, 53.52),
    (22.35, 53.66), (22.6, 53.95), (22.75, 54.3), (22.8, 54.45), (22.8, 55.0), (19.4, 55.0), (18.95, 54.5),
    (18.7, 54.5),
]
MEMEL = [(20.8, 55.28), (21.45, 55.22), (22.1, 55.05), (22.2, 55.3), (21.7, 55.65), (21.25, 55.98), (20.8, 55.98)]
KRESY = [
    (22.5, 53.9), (23.5, 54.15), (24.0, 54.25), (24.5, 54.55), (24.75, 54.8), (25.1, 55.05), (25.6, 55.2),
    (26.2, 55.4), (26.6, 55.68), (27.0, 55.85), (27.6, 55.85), (28.2, 55.75), (28.05, 55.4), (27.75, 55.0),
    (27.35, 54.5), (27.15, 54.15), (27.0, 53.8), (26.95, 53.4), (27.15, 52.9), (27.3, 52.5), (27.2, 52.0),
    (27.3, 51.6), (27.2, 51.2), (26.95, 50.8), (26.8, 50.45), (26.65, 50.3), (26.35, 50.0), (26.2, 49.6),
    (26.15, 49.2), (26.25, 48.85), (26.35, 48.55), (25.9, 48.5), (25.45, 48.38), (25.1, 48.15), (24.8, 47.85),
    (24.5, 48.1), (23.9, 48.6), (23.3, 48.9), (22.9, 49.05), (22.5, 49.1),
]
BESSARABIA = [
    (26.3, 48.6), (27.0, 48.52), (27.6, 48.45), (28.3, 47.95), (28.9, 47.55), (29.2, 47.15), (29.6, 46.8),
    (29.95, 46.5), (30.25, 46.3), (30.6, 46.0), (30.1, 45.1), (28.2, 45.1), (26.5, 48.2),
]
KARELIA = [
    (28.5, 59.9), (29.95, 60.12), (30.4, 60.35), (30.95, 60.6), (31.6, 61.0), (32.2, 61.25), (32.5, 61.6),
    (32.7, 62.0), (32.1, 62.5), (31.3, 62.85), (30.0, 62.85), (28.0, 61.0),
]
SALLA = [(28.9, 66.55), (30.1, 66.55), (30.1, 67.3), (28.9, 67.3)]
PETSAMO = [(28.4, 68.85), (30.1, 68.85), (31.6, 69.35), (32.2, 69.95), (31.0, 70.2), (29.3, 69.85), (28.4, 69.3)]
SOUTH_SLOVAKIA = [
    (17.2, 47.9), (17.8, 48.15), (18.3, 48.2), (18.75, 48.3), (19.4, 48.38), (20.0, 48.5), (20.5, 48.75),
    (21.1, 48.82), (21.5, 48.75), (22.1, 48.75), (22.6, 48.7), (22.6, 47.4), (17.2, 47.4),
]
JULIAN = [
    (13.4, 46.6), (13.75, 46.52), (13.85, 46.35), (14.05, 46.15), (14.1, 45.95), (14.3, 45.8), (14.5, 45.6),
    (14.48, 45.33), (14.3, 45.1), (14.45, 44.5), (13.4, 44.5), (13.0, 45.6),
]
DODECANESE = [(26.4, 37.55), (27.4, 37.55), (28.4, 36.6), (28.4, 35.3), (26.8, 35.3), (26.6, 36.5)]
SPANISH_MOROCCO = [
    (-6.4, 35.95), (-5.3, 36.1), (-2.2, 35.3), (-2.4, 34.95), (-3.9, 34.85), (-5.4, 34.85), (-6.3, 34.95),
]

RULES = [
    ("unit", "RUS", "Kaliningrad", "GER"),
    ("unit", "UKR", "Transcarpathia", "Hungary"),
    ("unit", "UKR", "Chernivtsi", "Romania"),
    ("unit", "BGR", "Dobrich", "Romania"),
    ("unit", "BGR", "Silistra", "Romania"),
    ("poly", {"POL"}, GER_WEST, "GER"),
    ("poly", {"POL"}, EAST_PRUSSIA, "GER"),
    ("poly", {"LTU"}, MEMEL, "GER"),
    ("poly", {"BLR", "UKR", "LTU"}, KRESY, "POL"),
    ("poly", {"UKR", "MDA"}, BESSARABIA, "Romania"),
    ("poly", {"RUS"}, KARELIA, "Finland"),
    ("poly", {"RUS"}, SALLA, "Finland"),
    ("poly", {"RUS"}, PETSAMO, "Finland"),
    ("poly", {"SVK"}, SOUTH_SLOVAKIA, "Hungary"),
    ("poly", {"SVN", "HRV"}, JULIAN, "ITA"),
    ("poly", {"GRC"}, DODECANESE, "ITA"),
    ("poly", {"MAR"}, SPANISH_MOROCCO, "SPA"),
]

SEEDS = [
    ("Berlin", 13.4, 52.52, "GER", 0, "C F1"),
    ("Hamburg", 10.0, 53.55, "GER", 0, "c"),
    ("Bremen", 8.8, 53.08, "GER", 0, ""),
    ("Hanover", 9.73, 52.37, "GER", 0, ""),
    ("Essen", 7.01, 51.45, "GER", 0, "c F1"),
    ("Cologne", 6.96, 50.94, "GER", 0, ""),
    ("Frankfurt", 8.68, 50.11, "GER", 1, "c"),
    ("Saarbrücken", 7.0, 49.23, "GER", 1, ""),
    ("Stuttgart", 9.18, 48.78, "GER", 1, ""),
    ("Munich", 11.58, 48.14, "GER", 0, "c"),
    ("Nuremberg", 11.08, 49.45, "GER", 1, ""),
    ("Kassel", 9.5, 51.31, "GER", 1, ""),
    ("Erfurt", 11.03, 50.98, "GER", 1, ""),
    ("Magdeburg", 11.63, 52.12, "GER", 0, ""),
    ("Leipzig", 12.37, 51.34, "GER", 0, "c F1"),
    ("Dresden", 13.74, 51.05, "GER", 2, ""),
    ("Kiel", 10.13, 54.32, "GER", 0, ""),
    ("Stettin", 14.55, 53.43, "GER", 0, ""),
    ("Rostock", 12.1, 54.09, "GER", 0, ""),
    ("Stolp", 17.03, 54.46, "GER", 0, ""),
    ("Breslau", 17.03, 51.11, "GER", 0, "c T5"),
    ("Gleiwitz", 18.67, 50.29, "GER", 0, ""),
    ("Danzig", 18.65, 54.35, "GER", 0, ""),
    ("Königsberg", 20.5, 54.7, "GER", 1, "c T5"),
    ("Allenstein", 20.48, 53.78, "GER", 1, ""),
    ("Vienna", 16.37, 48.21, "GER", 0, "c"),
    ("Linz", 14.29, 48.31, "GER", 2, ""),
    ("Innsbruck", 11.4, 47.27, "GER", 2, ""),
    ("Graz", 15.44, 47.07, "GER", 2, ""),
    ("Prague", 14.42, 50.08, "GER", 0, "c"),
    ("Pilsen", 13.38, 49.75, "GER", 1, ""),
    ("Brno", 16.6, 49.2, "GER", 1, ""),
    ("Memel", 21.13, 55.71, "GER", 0, ""),

    ("London", -0.13, 51.5, "UK", 0, "C F1"),
    ("Birmingham", -1.9, 52.48, "UK", 0, "c F2"),
    ("Manchester", -2.24, 53.48, "UK", 0, "c F1"),
    ("Newcastle", -1.6, 54.97, "UK", 0, ""),
    ("Glasgow", -4.25, 55.86, "UK", 0, "c"),
    ("Edinburgh", -3.19, 55.95, "UK", 1, ""),
    ("Inverness", -4.22, 57.48, "UK", 2, ""),
    ("Aberdeen", -2.1, 57.15, "UK", 1, ""),
    ("Cardiff", -3.18, 51.48, "UK", 1, ""),
    ("Plymouth", -4.14, 50.37, "UK", 0, ""),
    ("Norwich", 1.3, 52.63, "UK", 0, ""),
    ("Belfast", -5.93, 54.6, "UK", 0, ""),
    ("Valletta", 14.51, 35.9, "UK", 0, "c f x"),
    ("Nicosia", 33.36, 35.17, "UK", 2, "c x"),
    ("Alexandria", 29.92, 31.2, "UK", 0, "c x"),
    ("Cairo", 31.24, 30.06, "UK", 0, "c x"),
    ("Port Said", 32.3, 31.26, "UK", 0, "x"),
    ("Mersa Matruh", 27.24, 31.35, "UK", 0, "x"),
    ("Jerusalem", 35.21, 31.77, "UK", 2, "c x"),
    ("Haifa", 34.99, 32.79, "UK", 0, "x"),
    ("Amman", 35.93, 31.95, "UK", 2, "x"),

    ("Paris", 2.35, 48.86, "FRA", 0, "C F1"),
    ("Lille", 3.06, 50.63, "FRA", 0, "c F1 f"),
    ("Calais", 1.86, 50.95, "FRA", 0, ""),
    ("Rouen", 1.1, 49.44, "FRA", 0, ""),
    ("Reims", 4.03, 49.26, "FRA", 0, ""),
    ("Brest", -4.49, 48.39, "FRA", 0, ""),
    ("Nantes", -1.55, 47.22, "FRA", 0, ""),
    ("Orléans", 1.9, 47.9, "FRA", 0, ""),
    ("Poitiers", 0.34, 46.58, "FRA", 0, ""),
    ("Limoges", 1.26, 45.83, "FRA", 1, ""),
    ("Bordeaux", -0.58, 44.84, "FRA", 1, "c"),
    ("Toulouse", 1.44, 43.6, "FRA", 0, ""),
    ("Montpellier", 3.88, 43.61, "FRA", 0, ""),
    ("Marseille", 5.37, 43.3, "FRA", 0, "c"),
    ("Lyon", 4.83, 45.76, "FRA", 0, "c"),
    ("Strasbourg", 7.75, 48.58, "FRA", 1, "f T5"),
    ("Metz", 6.18, 49.12, "FRA", 0, "f T5"),
    ("Dijon", 5.04, 47.32, "FRA", 0, ""),
    ("Clermont", 3.08, 45.78, "FRA", 2, ""),
    ("Grenoble", 5.72, 45.19, "FRA", 2, ""),
    ("Nice", 7.26, 43.7, "FRA", 2, ""),
    ("Ajaccio", 8.74, 41.92, "FRA", 2, ""),
    ("Algiers", 3.06, 36.75, "FRA", 0, "c x"),
    ("Oran", -0.64, 35.7, "FRA", 0, "x"),
    ("Constantine", 6.61, 36.36, "FRA", 2, "x"),
    ("Laghouat", 2.87, 33.8, "FRA", 0, "x"),
    ("Tunis", 10.18, 36.8, "FRA", 0, "c x"),
    ("Sfax", 10.76, 34.74, "FRA", 0, "x"),
    ("Casablanca", -7.6, 33.57, "FRA", 0, "c x"),
    ("Fez", -5.0, 34.03, "FRA", 2, "x"),
    ("Marrakesh", -8.0, 31.63, "FRA", 2, "x"),
    ("Beirut", 35.5, 33.89, "FRA", 2, "c x"),
    ("Damascus", 36.29, 33.51, "FRA", 0, "c x"),
    ("Aleppo", 37.16, 36.2, "FRA", 0, "x"),
    ("Deir ez-Zor", 40.14, 35.33, "FRA", 0, "x"),

    ("Moscow", 37.62, 55.75, "SOV", 0, "C F1"),
    ("Leningrad", 30.31, 59.94, "SOV", 0, "c F1"),
    ("Kharkov", 36.23, 49.99, "SOV", 0, "c F1"),
    ("Kiev", 30.52, 50.45, "SOV", 0, "c"),
    ("Minsk", 27.56, 53.9, "SOV", 1, ""),
    ("Vitebsk", 30.2, 55.19, "SOV", 1, ""),
    ("Gomel", 31.0, 52.43, "SOV", 1, ""),
    ("Smolensk", 32.05, 54.78, "SOV", 1, ""),
    ("Odessa", 30.73, 46.48, "SOV", 0, ""),
    ("Nikolaev", 32.0, 46.97, "SOV", 0, ""),
    ("Rostov", 39.7, 47.23, "SOV", 0, "c"),
    ("Stalingrad", 44.5, 48.7, "SOV", 0, "c"),
    ("Voronezh", 39.2, 51.67, "SOV", 0, ""),
    ("Kursk", 36.19, 51.73, "SOV", 0, ""),
    ("Poltava", 34.55, 49.59, "SOV", 0, ""),
    ("Dnepropetrovsk", 35.04, 48.46, "SOV", 0, ""),
    ("Stalino", 37.8, 48.0, "SOV", 0, "F1"),
    ("Sevastopol", 33.52, 44.6, "SOV", 2, ""),
    ("Bryansk", 34.36, 53.25, "SOV", 1, ""),
    ("Novgorod", 31.27, 58.52, "SOV", 1, ""),
    ("Pskov", 28.33, 57.82, "SOV", 1, ""),
    ("Zhitomir", 28.66, 50.25, "SOV", 1, ""),
    ("Vinnitsa", 28.47, 49.23, "SOV", 0, ""),
    ("Vologda", 39.9, 59.22, "SOV", 1, ""),
    ("Yaroslavl", 39.87, 57.63, "SOV", 1, ""),
    ("Gorky", 44.0, 56.33, "SOV", 1, "c"),
    ("Kazan", 49.1, 55.79, "SOV", 1, ""),
    ("Kirov", 49.66, 58.6, "SOV", 1, ""),
    ("Kotlas", 46.65, 61.25, "SOV", 1, ""),
    ("Arkhangelsk", 40.54, 64.54, "SOV", 1, ""),
    ("Petrozavodsk", 34.35, 61.8, "SOV", 1, ""),
    ("Kandalaksha", 32.4, 67.15, "SOV", 1, ""),
    ("Murmansk", 33.08, 68.97, "SOV", 2, ""),
    ("Tula", 37.62, 54.19, "SOV", 0, ""),
    ("Ryazan", 39.74, 54.63, "SOV", 0, ""),
    ("Penza", 45.0, 53.2, "SOV", 0, ""),
    ("Saratov", 46.03, 51.53, "SOV", 0, ""),
    ("Kalinin", 35.9, 56.86, "SOV", 1, ""),
    ("Krasnodar", 38.98, 45.04, "SOV", 0, ""),
    ("Stavropol", 41.97, 45.05, "SOV", 0, ""),
    ("Astrakhan", 48.03, 46.35, "SOV", 0, ""),
    ("Grozny", 45.7, 43.32, "SOV", 2, ""),
    ("Tbilisi", 44.8, 41.7, "SOV", 2, "c"),
    ("Baku", 49.87, 40.41, "SOV", 0, "F1"),
    ("Yerevan", 44.51, 40.18, "SOV", 2, ""),
    ("Tambov", 41.45, 52.72, "SOV", 0, ""),

    ("Rome", 12.5, 41.9, "ITA", 0, "C"),
    ("Milan", 9.19, 45.46, "ITA", 0, "c F2"),
    ("Turin", 7.68, 45.07, "ITA", 2, "c F1"),
    ("Genoa", 8.93, 44.41, "ITA", 2, ""),
    ("Venice", 12.33, 45.44, "ITA", 0, "c"),
    ("Bologna", 11.34, 44.49, "ITA", 0, ""),
    ("Florence", 11.25, 43.77, "ITA", 2, ""),
    ("Ancona", 13.52, 43.62, "ITA", 2, ""),
    ("Naples", 14.27, 40.85, "ITA", 0, "c"),
    ("Bari", 16.87, 41.12, "ITA", 0, ""),
    ("Pescara", 14.21, 42.46, "ITA", 2, ""),
    ("Reggio", 15.65, 38.11, "ITA", 2, ""),
    ("Palermo", 13.36, 38.12, "ITA", 2, "c"),
    ("Catania", 15.09, 37.5, "ITA", 2, ""),
    ("Cagliari", 9.11, 39.22, "ITA", 2, ""),
    ("Trieste", 13.77, 45.65, "ITA", 2, ""),
    ("Bolzano", 11.35, 46.5, "ITA", 2, ""),
    ("Tirana", 19.82, 41.33, "ITA", 2, "x"),
    ("Rhodes", 28.22, 36.43, "ITA", 2, "c x"),
    ("Tripoli", 13.18, 32.89, "ITA", 0, "c x"),
    ("Misrata", 15.09, 32.38, "ITA", 0, "x"),
    ("Sirte", 16.59, 31.2, "ITA", 0, "x"),
    ("Benghazi", 20.07, 32.12, "ITA", 0, "c x"),
    ("Tobruk", 23.96, 32.08, "ITA", 0, "x"),

    ("Warsaw", 21.01, 52.23, "POL", 0, "C"),
    ("Kraków", 19.94, 50.06, "POL", 2, "c"),
    ("Katowice", 19.02, 50.26, "POL", 0, "F1"),
    ("Łódź", 19.46, 51.76, "POL", 0, ""),
    ("Poznań", 16.93, 52.41, "POL", 0, "T4"),
    ("Bydgoszcz", 18.0, 53.12, "POL", 0, ""),
    ("Gdynia", 18.53, 54.52, "POL", 1, ""),
    ("Radom", 21.15, 51.4, "POL", 0, ""),
    ("Lwów", 24.03, 49.84, "POL", 0, "c"),
    ("Stanisławów", 24.71, 48.92, "POL", 2, ""),
    ("Tarnopol", 25.6, 49.55, "POL", 0, ""),
    ("Łuck", 25.33, 50.75, "POL", 1, ""),
    ("Wilno", 25.28, 54.69, "POL", 1, ""),
    ("Grodno", 23.83, 53.68, "POL", 1, ""),
    ("Białystok", 23.16, 53.13, "POL", 1, ""),
    ("Brześć", 23.7, 52.1, "POL", 1, ""),
    ("Lublin", 22.57, 51.25, "POL", 0, ""),
    ("Pinsk", 26.1, 52.1, "POL", 1, ""),
    ("Nowogródek", 25.82, 53.6, "POL", 1, ""),

    ("Madrid", -3.7, 40.42, "SPA", 0, "C"),
    ("Barcelona", 2.17, 41.39, "SPA", 0, "c F1"),
    ("Valencia", -0.38, 39.47, "SPA", 0, ""),
    ("Seville", -5.98, 37.39, "SPA", 0, "c"),
    ("Bilbao", -2.93, 43.26, "SPA", 2, ""),
    ("Oviedo", -5.85, 43.36, "SPA", 2, ""),
    ("Zaragoza", -0.89, 41.65, "SPA", 0, ""),
    ("Málaga", -4.42, 36.72, "SPA", 2, ""),
    ("Granada", -3.6, 37.18, "SPA", 2, ""),
    ("A Coruña", -8.41, 43.36, "SPA", 2, ""),
    ("Valladolid", -4.72, 41.65, "SPA", 0, ""),
    ("Badajoz", -6.97, 38.88, "SPA", 0, ""),
    ("Murcia", -1.13, 37.98, "SPA", 2, ""),
    ("Palma", 2.65, 39.57, "SPA", 2, ""),
    ("Tetuán", -5.37, 35.57, "SPA", 2, "x"),

    ("Ankara", 32.86, 39.93, "TUR", 0, "C"),
    ("Istanbul", 28.98, 41.01, "TUR", 0, "c"),
    ("Izmir", 27.14, 38.42, "TUR", 0, "c"),
    ("Bursa", 29.06, 40.18, "TUR", 2, ""),
    ("Edirne", 26.56, 41.67, "TUR", 0, ""),
    ("Eskişehir", 30.52, 39.78, "TUR", 0, ""),
    ("Zonguldak", 31.8, 41.45, "TUR", 1, ""),
    ("Samsun", 36.33, 41.29, "TUR", 1, ""),
    ("Konya", 32.48, 37.87, "TUR", 0, ""),
    ("Antalya", 30.7, 36.9, "TUR", 2, ""),
    ("Adana", 35.32, 37.0, "TUR", 0, ""),
    ("Kayseri", 35.48, 38.73, "TUR", 2, ""),
    ("Sivas", 37.02, 39.75, "TUR", 2, ""),
    ("Gaziantep", 37.38, 37.06, "TUR", 0, ""),
    ("Trabzon", 39.72, 41.0, "TUR", 2, ""),
    ("Erzurum", 41.27, 39.9, "TUR", 2, ""),
    ("Diyarbakır", 40.22, 37.91, "TUR", 2, ""),
    ("Van", 43.38, 38.5, "TUR", 2, ""),

    ("Dublin", -6.26, 53.35, "Ireland", 0, "c"),
    ("Cork", -8.47, 51.9, "Ireland", 0, ""),
    ("Galway", -9.05, 53.27, "Ireland", 1, ""),
    ("Lisbon", -9.14, 38.72, "Portugal", 0, "c"),
    ("Porto", -8.61, 41.15, "Portugal", 2, ""),
    ("Amsterdam", 4.9, 52.37, "Netherlands", 0, "c"),
    ("Groningen", 6.57, 53.22, "Netherlands", 0, ""),
    ("Eindhoven", 5.47, 51.44, "Netherlands", 0, ""),
    ("Brussels", 4.35, 50.85, "Belgium", 0, "c"),
    ("Liège", 5.57, 50.63, "Belgium", 1, "f"),
    ("Luxembourg", 6.13, 49.61, "Luxembourg", 1, ""),
    ("Bern", 7.45, 46.95, "Switzerland", 2, "c T6"),
    ("Zurich", 8.54, 47.37, "Switzerland", 2, "T5"),
    ("Copenhagen", 12.57, 55.68, "Denmark", 0, "c"),
    ("Aarhus", 10.2, 56.16, "Denmark", 0, ""),
    ("Odense", 10.39, 55.4, "Denmark", 0, ""),
    ("Oslo", 10.75, 59.91, "Norway", 1, "c"),
    ("Bergen", 5.32, 60.39, "Norway", 2, ""),
    ("Kristiansand", 8.0, 58.15, "Norway", 2, ""),
    ("Trondheim", 10.4, 63.43, "Norway", 2, ""),
    ("Narvik", 17.43, 68.44, "Norway", 2, ""),
    ("Tromsø", 18.96, 69.65, "Norway", 2, ""),
    ("Stockholm", 18.07, 59.33, "Sweden", 1, "c"),
    ("Gothenburg", 11.97, 57.71, "Sweden", 0, ""),
    ("Malmö", 13.0, 55.6, "Sweden", 0, ""),
    ("Kalmar", 16.36, 56.66, "Sweden", 1, ""),
    ("Visby", 18.29, 57.64, "Sweden", 0, ""),
    ("Karlstad", 13.5, 59.38, "Sweden", 1, ""),
    ("Sundsvall", 17.3, 62.39, "Sweden", 1, ""),
    ("Östersund", 14.64, 63.18, "Sweden", 2, ""),
    ("Umeå", 20.26, 63.83, "Sweden", 1, ""),
    ("Luleå", 22.15, 65.58, "Sweden", 1, ""),
    ("Kiruna", 20.22, 67.86, "Sweden", 2, ""),
    ("Helsinki", 24.94, 60.17, "Finland", 0, "c"),
    ("Turku", 22.27, 60.45, "Finland", 0, ""),
    ("Viipuri", 28.75, 60.71, "Finland", 1, "f T5"),
    ("Sortavala", 30.7, 61.7, "Finland", 1, ""),
    ("Tampere", 23.76, 61.5, "Finland", 1, ""),
    ("Kuopio", 27.68, 62.89, "Finland", 1, ""),
    ("Vaasa", 21.6, 63.1, "Finland", 1, ""),
    ("Oulu", 25.47, 65.01, "Finland", 1, ""),
    ("Rovaniemi", 25.72, 66.5, "Finland", 1, ""),
    ("Petsamo", 31.2, 69.4, "Finland", 2, ""),
    ("Tallinn", 24.75, 59.44, "Estonia", 0, "c"),
    ("Tartu", 26.72, 58.38, "Estonia", 1, ""),
    ("Riga", 24.1, 56.95, "Latvia", 0, "c"),
    ("Liepāja", 21.0, 56.51, "Latvia", 0, ""),
    ("Daugavpils", 26.53, 55.88, "Latvia", 1, ""),
    ("Kaunas", 23.9, 54.9, "Lithuania", 0, "c"),
    ("Šiauliai", 23.32, 55.93, "Lithuania", 0, ""),
    ("Bratislava", 17.11, 48.15, "Slovakia", 0, "c"),
    ("Žilina", 18.74, 49.22, "Slovakia", 2, ""),
    ("Banská Bystrica", 19.15, 48.73, "Slovakia", 2, ""),
    ("Prešov", 21.24, 49.0, "Slovakia", 2, ""),
    ("Budapest", 19.04, 47.5, "Hungary", 0, "c"),
    ("Győr", 17.63, 47.69, "Hungary", 0, ""),
    ("Pécs", 18.23, 46.07, "Hungary", 0, ""),
    ("Szeged", 20.15, 46.25, "Hungary", 0, ""),
    ("Debrecen", 21.63, 47.53, "Hungary", 0, ""),
    ("Košice", 21.26, 48.72, "Hungary", 2, ""),
    ("Ungvár", 22.3, 48.62, "Hungary", 2, ""),
    ("Bucharest", 26.1, 44.43, "Romania", 0, "c F1"),
    ("Ploiești", 26.02, 44.94, "Romania", 0, ""),
    ("Craiova", 23.8, 44.32, "Romania", 0, ""),
    ("Cluj", 23.6, 46.77, "Romania", 2, ""),
    ("Iași", 27.6, 47.16, "Romania", 0, ""),
    ("Cernăuți", 25.94, 48.29, "Romania", 1, ""),
    ("Constanța", 28.63, 44.17, "Romania", 0, ""),
    ("Bazargic", 27.83, 43.57, "Romania", 0, ""),
    ("Galați", 28.05, 45.43, "Romania", 0, ""),
    ("Timișoara", 21.23, 45.75, "Romania", 0, ""),
    ("Chișinău", 28.86, 47.0, "Romania", 0, ""),
    ("Brașov", 25.6, 45.65, "Romania", 2, ""),
    ("Belgrade", 20.46, 44.79, "Yugoslavia", 0, "c"),
    ("Novi Sad", 19.84, 45.25, "Yugoslavia", 0, ""),
    ("Niš", 21.9, 43.32, "Yugoslavia", 2, ""),
    ("Zagreb", 15.98, 45.81, "Yugoslavia", 1, ""),
    ("Sarajevo", 18.41, 43.86, "Yugoslavia", 2, ""),
    ("Podgorica", 19.26, 42.44, "Yugoslavia", 2, ""),
    ("Skopje", 21.43, 41.99, "Yugoslavia", 2, ""),
    ("Split", 16.44, 43.51, "Yugoslavia", 2, ""),
    ("Ljubljana", 14.5, 46.05, "Yugoslavia", 2, ""),
    ("Sofia", 23.32, 42.7, "Bulgaria", 2, "c"),
    ("Varna", 27.91, 43.21, "Bulgaria", 0, ""),
    ("Ruse", 25.97, 43.85, "Bulgaria", 0, ""),
    ("Plovdiv", 24.75, 42.15, "Bulgaria", 1, ""),
    ("Athens", 23.73, 37.98, "Greece", 0, "c"),
    ("Thessaloniki", 22.94, 40.64, "Greece", 2, ""),
    ("Kavala", 24.4, 40.94, "Greece", 2, ""),
    ("Larissa", 22.42, 39.64, "Greece", 0, ""),
    ("Ioannina", 20.85, 39.66, "Greece", 2, ""),
    ("Patras", 21.73, 38.25, "Greece", 2, ""),
    ("Heraklion", 25.13, 35.34, "Greece", 2, ""),
    ("Mosul", 43.13, 36.34, "Iraq", 0, ""),
    ("Kirkuk", 44.39, 35.47, "Iraq", 0, ""),
    ("Baghdad", 44.4, 33.3, "Iraq", 0, "c"),
    ("Basra", 47.8, 30.5, "Iraq", 0, ""),
    ("Tabriz", 46.29, 38.08, "Iran", 2, "c"),
    ("Rasht", 49.58, 37.28, "Iran", 1, ""),
    ("Hamadan", 48.5, 34.8, "Iran", 2, ""),
    ("Kermanshah", 47.06, 34.31, "Iran", 2, ""),
    ("Ahvaz", 48.67, 31.32, "Iran", 0, ""),
]

LINKS = [
    ("London", "Calais"),
    ("Plymouth", "Brest"),
    ("Glasgow", "Belfast"),
    ("Manchester", "Dublin"),
    ("Copenhagen", "Malmö"),
    ("Copenhagen", "Odense"),
    ("Odense", "Aarhus"),
    ("Copenhagen", "Rostock"),
    ("Palermo", "Tunis"),
    ("Catania", "Reggio"),
    ("Catania", "Valletta"),
    ("Valletta", "Tripoli"),
    ("Ajaccio", "Nice"),
    ("Ajaccio", "Cagliari"),
    ("Cagliari", "Rome"),
    ("Cagliari", "Tunis"),
    ("Bari", "Tirana"),
    ("Tallinn", "Helsinki"),
    ("Edirne", "Bursa"),
    ("Istanbul", "Bursa"),
    ("Sevastopol", "Krasnodar"),
    ("Stockholm", "Turku"),
    ("Umeå", "Vaasa"),
    ("Visby", "Kalmar"),
    ("Visby", "Stockholm"),
    ("Málaga", "Tetuán"),
    ("Palma", "Barcelona"),
    ("Palma", "Valencia"),
    ("Heraklion", "Athens"),
    ("Heraklion", "Rhodes"),
    ("Rhodes", "Izmir"),
    ("Nicosia", "Adana"),
    ("Nicosia", "Beirut"),
    ("Kristiansand", "Aarhus"),
    ("Baku", "Astrakhan"),
]

DECOR_COUNTRIES = {"SAU", "KWT"}


def project(lon, lat):
    return ((lon - LON0) * SQUASH * UNIT, (LAT1 - lat) * UNIT)


def project_geometry(g):
    return shapely.transform(g, lambda c: [[(x - LON0) * SQUASH * UNIT, (LAT1 - y) * UNIT] for x, y in c])


def project_ring(points):
    return Polygon([project(lon, lat) for lon, lat in points])


def polygons_of(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type == "MultiPolygon":
        return list(g.geoms)
    if g.geom_type == "GeometryCollection":
        out = []
        for part in g.geoms:
            out.extend(polygons_of(part))
        return out
    return []


def clean(g):
    g = shapely.make_valid(g)
    parts = [p for p in polygons_of(g) if p.area > 1e-6]
    return unary_union(parts) if parts else Polygon()


def load_units(folder):
    extent = project_ring([(LON0, LAT0), (LON1, LAT0), (LON1, LAT1), (LON0, LAT1)])
    with open(os.path.join(folder, "admin1.geojson")) as f:
        data = json.load(f)
    lakes = []
    with open(os.path.join(folder, "lakes.geojson")) as f:
        for feature in json.load(f)["features"]:
            g = clean(project_geometry(shape(feature["geometry"])))
            if g.area >= MIN_LAKE and g.intersects(extent):
                lakes.append(g)
    water = unary_union(lakes) if lakes else Polygon()
    units = []
    for feature in data["features"]:
        props = feature["properties"]
        code = props["adm0_a3"]
        g = shape(feature["geometry"])
        if not g.intersects(box(LON0, LAT0, LON1, LAT1)):
            continue
        g = clean(project_geometry(g))
        g = clean(g.intersection(extent))
        if not water.is_empty:
            g = clean(g.difference(water))
        if g.is_empty:
            continue
        units.append({"code": code, "name": props["name"], "geom": g})
    return units


def assign_countries(units):
    pieces = []
    cutters = [(rule, project_ring(rule[2])) for rule in RULES if rule[0] == "poly"]
    for unit in units:
        if unit["code"] in DECOR_COUNTRIES:
            country = None
        else:
            country = BASE.get(unit["code"])
            if unit["code"] not in BASE:
                print("unmapped", unit["code"], unit["name"], file=sys.stderr)
        for rule in RULES:
            if rule[0] == "unit" and rule[1] == unit["code"] and rule[2] == unit["name"]:
                country = rule[3]
        current = [(unit["geom"], country, unit["code"])]
        for rule, cutter in cutters:
            if unit["code"] not in rule[1]:
                continue
            following = []
            for geom, owner, code in current:
                if not geom.intersects(cutter):
                    following.append((geom, owner, code))
                    continue
                inside = clean(geom.intersection(cutter))
                outside = clean(geom.difference(cutter))
                if not inside.is_empty:
                    following.append((inside, rule[3], code))
                if not outside.is_empty:
                    following.append((outside, owner, code))
            current = following
        pieces.extend(current)
    return pieces


def settle_seeds(pieces):
    countries = {}
    for geom, owner, _ in pieces:
        if owner is not None:
            countries.setdefault(owner, []).append(geom)
    shapes = {owner: unary_union(geoms) for owner, geoms in countries.items()}
    seeds = []
    for name, lon, lat, owner, terrain, flags in SEEDS:
        if owner not in shapes:
            raise SystemExit(f"no land for {owner} ({name})")
        point = Point(project(lon, lat))
        area = shapes[owner]
        if not area.contains(point):
            inner = area.buffer(-1.5)
            target = inner if not inner.is_empty else area
            moved = nearest_points(target, point)[0]
            print(f"moved {name} by {point.distance(moved):.1f}", file=sys.stderr)
            point = moved
        seeds.append({"name": name, "owner": owner, "terrain": terrain, "flags": flags, "point": point})
    missing = sorted(set(shapes) - {s["owner"] for s in seeds})
    if missing:
        raise SystemExit(f"countries without seeds: {missing}")
    return seeds, shapes


def split_pieces(pieces, seeds):
    by_owner = {}
    for index, seed in enumerate(seeds):
        by_owner.setdefault(seed["owner"], []).append(index)
    parts = [[] for _ in seeds]
    decor = []
    for geom, owner, _ in pieces:
        if owner is None:
            decor.append(geom)
            continue
        candidates = by_owner[owner]
        inside = [i for i in candidates if geom.contains(seeds[i]["point"])]
        if len(inside) == 1:
            parts[inside[0]].append(geom)
        elif len(inside) > 1:
            points = MultiPoint([seeds[i]["point"] for i in inside])
            cells = shapely.voronoi_polygons(points, extend_to=geom.envelope.buffer(100))
            for cell in cells.geoms:
                owner_index = next(i for i in inside if cell.contains(seeds[i]["point"]))
                share = clean(geom.intersection(cell))
                if not share.is_empty:
                    parts[owner_index].append(share)
        else:
            for part in polygons_of(geom):
                nearest = min(candidates, key=lambda i: (part.distance(seeds[i]["point"]), i))
                parts[nearest].append(part)
    return [clean(unary_union(p)) for p in parts], decor


def shared_length(a, b):
    return a.buffer(0.3).intersection(b).area


def merge_small(pieces):
    geoms = [p[0] for p in pieces]
    owners = [p[1] for p in pieces]
    codes = [p[2] for p in pieces]
    alive = [True] * len(geoms)
    for _ in range(12):
        changed = False
        tree = shapely.STRtree(geoms)
        order = sorted(range(len(geoms)), key=lambda i: geoms[i].area)
        for i in order:
            if not alive[i] or owners[i] is None or geoms[i].area >= MERGE_BELOW:
                continue
            best = None
            best_score = 0.05
            for j in tree.query(geoms[i].buffer(0.3)):
                j = int(j)
                if j == i or not alive[j] or owners[j] != owners[i]:
                    continue
                score = shared_length(geoms[i], geoms[j])
                if score > best_score:
                    best, best_score = j, score
            if best is not None:
                geoms[best] = clean(unary_union([geoms[best], geoms[i]]))
                alive[i] = False
                changed = True
        if not changed:
            break
    return [(geoms[i], owners[i], codes[i]) for i in range(len(geoms)) if alive[i]]


def repair_coverage(provinces, decor):
    geoms = provinces + decor
    lines = unary_union([g.boundary for g in geoms])
    faces = list(shapely.polygonize(list(polygons_lines(lines))).geoms)
    tree = shapely.STRtree(geoms)
    buckets = [[] for _ in geoms]
    orphans = []
    for face in faces:
        point = face.representative_point()
        hits = [int(j) for j in tree.query(point) if geoms[int(j)].contains(point)]
        if hits:
            buckets[min(hits)].append(face)
        else:
            orphans.append(face)
    for face in orphans:
        if face.area > ORPHAN_LIMIT:
            continue
        best = None
        best_score = 0.0
        for j in tree.query(face.buffer(0.3)):
            j = int(j)
            score = shared_length(face, geoms[j])
            if score > best_score:
                best, best_score = j, score
        if best is not None:
            buckets[best].append(face)
    merged = [clean(unary_union(b)) if b else Polygon() for b in buckets]
    return merged[: len(provinces)], merged[len(provinces) :]


def polygons_lines(lines):
    if lines.geom_type == "LineString":
        return [lines]
    return list(lines.geoms)


def tidy_exclaves(provinces, seeds):
    for _ in range(6):
        changed = False
        tree = shapely.STRtree(provinces)
        for index, geom in enumerate(provinces):
            polys = sorted(polygons_of(geom), key=lambda p: -p.area)
            if len(polys) < 2:
                continue
            keep = [polys[0]]
            for part in polys[1:]:
                best = None
                best_length = 0.0
                for other in tree.query(part):
                    other = int(other)
                    if other == index or seeds[other]["owner"] != seeds[index]["owner"]:
                        continue
                    length = shared_length(part, provinces[other])
                    if length > best_length + 1e-9:
                        best, best_length = other, length
                if best is not None and best_length > 0.5:
                    provinces[best] = clean(unary_union([provinces[best], part]))
                    changed = True
                else:
                    keep.append(part)
            provinces[index] = clean(unary_union(keep))
        if not changed:
            break
    return provinces


def simplify_all(provinces, decor):
    geoms = provinces + decor
    if not shapely.coverage_is_valid(geoms):
        print("coverage not valid, continuing", file=sys.stderr)
    simplified = list(shapely.coverage_simplify(geoms, TOLERANCE))
    return simplified[: len(provinces)], simplified[len(provinces) :]


def quantize_ring(coords):
    out = []
    for x, y in coords:
        q = (round(x * QUANT), round(y * QUANT))
        if not out or out[-1] != q:
            out.append(q)
    while len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def encode_ring(ring):
    values = []
    px, py = 0, 0
    for x, y in ring:
        values.append(x - px)
        values.append(y - py)
        px, py = x, y
    return ",".join(str(v) for v in values)


def province_rings(geom):
    polys = sorted(polygons_of(geom), key=lambda p: -p.area)
    if not polys:
        return [], [], None
    main = polys[0]
    rings = []
    holes = []
    for poly in polys:
        if poly is not main:
            if poly.area < MIN_PART or poly.distance(main) > FAR_PART:
                continue
        poly = orient(poly, 1.0)
        ring = quantize_ring(list(poly.exterior.coords))
        if len(ring) >= 3:
            rings.append(ring)
        for interior in poly.interiors:
            if Polygon(interior).area < MIN_PART:
                continue
            hole = quantize_ring(list(interior.coords))
            if len(hole) >= 3:
                holes.append(hole)
    return rings, holes, main


def anchor_for(seed, main):
    point = seed["point"]
    if main.contains(point) and main.exterior.distance(point) >= 3:
        return point
    label = polylabel(main, 0.5)
    if main.contains(point) and main.exterior.distance(point) >= main.exterior.distance(label) * 0.6:
        return point
    return label


def check_connected(seeds, rings_by_province):
    owners = {}
    for index, rings in enumerate(rings_by_province):
        for ring in rings:
            for k in range(len(ring)):
                a = ring[k]
                b = ring[(k + 1) % len(ring)]
                key = (a, b) if a < b else (b, a)
                owners.setdefault(key, set()).add(index)
    neighbors = [set() for _ in seeds]
    for found in owners.values():
        if len(found) == 2:
            a, b = sorted(found)
            neighbors[a].add(b)
            neighbors[b].add(a)
    names = {s["name"]: i for i, s in enumerate(seeds)}
    for a, b in LINKS:
        neighbors[names[a]].add(names[b])
        neighbors[names[b]].add(names[a])
    seen = {0}
    stack = [0]
    while stack:
        for n in neighbors[stack.pop()]:
            if n not in seen:
                seen.add(n)
                stack.append(n)
    lonely = [seeds[i]["name"] for i in range(len(seeds)) if i not in seen]
    if lonely:
        raise SystemExit(f"disconnected: {lonely}")


def main():
    folder, target = sys.argv[1], sys.argv[2]
    units = load_units(folder)
    pieces = merge_small(assign_countries(units))
    seeds, _ = settle_seeds(pieces)
    provinces, decor = split_pieces(pieces, seeds)
    empty = [seeds[i]["name"] for i, g in enumerate(provinces) if g.is_empty]
    if empty:
        raise SystemExit(f"empty provinces: {empty}")
    provinces, decor = repair_coverage(provinces, decor)
    provinces = tidy_exclaves(provinces, seeds)
    provinces, decor = simplify_all(provinces, decor)
    holes = [seeds[i]["name"] for i, g in enumerate(provinces) if any(p.interiors for p in polygons_of(g))]
    if holes:
        print("holes:", holes, file=sys.stderr)

    rows = []
    rings_by_province = []
    for seed, geom in zip(seeds, provinces):
        rings, holes, main = province_rings(geom)
        if not rings:
            raise SystemExit(f"no rings for {seed['name']}")
        rings_by_province.append(rings)
        anchor = anchor_for(seed, main)
        rows.append(
            [
                seed["name"],
                seed["owner"],
                seed["terrain"],
                seed["flags"],
                round(anchor.x, 1),
                round(anchor.y, 1),
                [encode_ring(r) for r in rings],
                [encode_ring(r) for r in holes],
            ]
        )
    check_connected(seeds, rings_by_province)

    decor_rings = []
    for geom in decor:
        for poly in polygons_of(geom):
            if poly.area < MIN_PART * 4:
                continue
            ring = quantize_ring(list(poly.exterior.coords))
            if len(ring) >= 3:
                decor_rings.append(encode_ring(ring))

    width, height = project(LON1, LAT0)
    lines = [
        f"export const EUROPE_SCALE = {QUANT};",
        f"export const EUROPE_SIZE = [{round(width, 1)}, {round(height, 1)}];",
        "export const EUROPE_PROVINCES = [",
    ]
    for row in rows:
        lines.append("  " + json.dumps(row, ensure_ascii=False, separators=(",", ":")) + ",")
    lines.append("];")
    lines.append("export const EUROPE_LINKS = " + json.dumps(LINKS, ensure_ascii=False, separators=(",", ":")) + ";")
    lines.append("export const EUROPE_DECOR = " + json.dumps(decor_rings, separators=(",", ":")) + ";")
    with open(target, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    vertices = sum(len(r) for rings in rings_by_province for r in rings)
    print(f"{len(rows)} provinces, {vertices} vertices, {os.path.getsize(target)} bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
